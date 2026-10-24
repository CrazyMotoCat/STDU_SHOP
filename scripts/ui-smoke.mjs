import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { root, requireFreePort } from './lib.mjs';
import { withProcesses } from './process-lifecycle.mjs';

const web = resolve(root, 'apps/web');
const requireWeb = createRequire(resolve(web, 'package.json'));
const nextCli = requireWeb.resolve('next/dist/bin/next');
const verificationTask = process.env.UI_SMOKE_TASK_ID ?? 'R1-003';
if (!/^[A-Za-z0-9-]+$/.test(verificationTask))
  throw new Error(
    'UI_SMOKE_TASK_ID must contain only letters, digits, and hyphens.',
  );
const artifacts = resolve(root, 'artifacts/verification', verificationTask);
const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
];

async function reserveEphemeralPort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not obtain a local UI smoke port.');
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  await requireFreePort(address.port);
  return address.port;
}

async function waitForPage(url, signal) {
  const deadline = performance.now() + 45000;
  let lastError;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]),
      });
      if (response.status === 200) return;
      lastError = new Error(`UI server returned HTTP ${response.status}.`);
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
    }
    await delay(200, undefined, { signal });
  }
  throw new Error(
    `Built Next.js UI did not become ready: ${lastError?.message ?? 'deadline exceeded'}.`,
  );
}

function rgb(color) {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  if (hex) {
    const value =
      hex[1].length === 3
        ? [...hex[1]].map((digit) => digit + digit).join('')
        : hex[1];
    return [0, 2, 4].map((offset) =>
      parseInt(value.slice(offset, offset + 2), 16),
    );
  }
  const match =
    /^rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/i.exec(
      color,
    );
  if (!match) throw new Error(`Unsupported computed color: ${color}`);
  return match.slice(1).map(Number);
}

function luminance(color) {
  const [red, green, blue] = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function assertAccessibleMarkup(page) {
  assert.equal(await page.locator('html').getAttribute('lang'), 'ru');
  assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
  assert.equal(
    await page.getByRole('navigation', { name: 'Основная навигация' }).count(),
    1,
  );

  const unnamed = await page
    .locator('button, a, input')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const control = element;
        const name =
          control.getAttribute('aria-label')?.trim() ||
          control.getAttribute('aria-labelledby')?.trim() ||
          control.innerText?.trim() ||
          (control instanceof HTMLInputElement
            ? control.labels?.[0]?.innerText.trim()
            : '');
        return name ? [] : [control.outerHTML.slice(0, 180)];
      }),
    );
  assert.deepEqual(
    unnamed,
    [],
    `Unnamed interactive controls: ${unnamed.join('; ')}`,
  );

  const brokenReferences = await page
    .locator('[aria-controls], [aria-describedby]')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const attributes = ['aria-controls', 'aria-describedby'];
        return attributes.flatMap((attribute) => {
          const references =
            element.getAttribute(attribute)?.split(/\s+/) ?? [];
          return references
            .filter((reference) => !document.getElementById(reference))
            .map((reference) => `${attribute}=${reference}`);
        });
      }),
    );
  assert.deepEqual(
    brokenReferences,
    [],
    `Broken ARIA references: ${brokenReferences.join(', ')}`,
  );

  const duplicateIds = await page.locator('[id]').evaluateAll((elements) => {
    const ids = elements.map((element) => element.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  assert.deepEqual(
    duplicateIds,
    [],
    `Duplicate IDs: ${duplicateIds.join(', ')}`,
  );

  const contrastPairs = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [
      ['body text', '--color-text-primary', '--color-surface-page'],
      ['secondary text', '--color-text-secondary', '--color-surface-page'],
      ['accent text', '--color-accent', '--color-white'],
      ['menu text', '--color-accent-hover', '--color-white'],
      [
        'disabled controls',
        '--color-disabled-text',
        '--color-disabled-surface',
      ],
      ['inverse text', '--color-text-inverse', '--color-deep-navy'],
    ].map(([name, foreground, background]) => ({
      name,
      foreground: style.getPropertyValue(foreground).trim(),
      background: style.getPropertyValue(background).trim(),
    }));
  });
  for (const pair of contrastPairs) {
    const ratio = contrastRatio(pair.foreground, pair.background);
    assert.ok(
      ratio >= 4.5,
      `${pair.name} contrast ${ratio.toFixed(2)} is below WCAG AA.`,
    );
  }

  const showcaseNote = await page
    .locator('.engineering-showcase__note')
    .evaluate((note) => {
      const section = note.closest('.overview-section');
      const backgroundImage = section
        ? getComputedStyle(section).backgroundImage
        : '';
      return {
        foreground: getComputedStyle(note).color,
        backgrounds: backgroundImage.match(/rgba?\([^)]*\)/g) ?? [],
      };
    });
  assert.ok(
    showcaseNote.backgrounds.length > 0,
    'Showcase note must remain over its dark section background.',
  );
  for (const background of showcaseNote.backgrounds) {
    const ratio = contrastRatio(showcaseNote.foreground, background);
    assert.ok(
      ratio >= 4.5,
      `Showcase note contrast ${ratio.toFixed(2)} is below WCAG AA.`,
    );
  }

  const brokenImages = await page.locator('svg[role="img"]').evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const labelledBy =
          element.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
        return (
          !labelledBy.length ||
          labelledBy.some((id) => !document.getElementById(id))
        );
      }).length,
  );
  assert.equal(
    brokenImages,
    0,
    'Illustrations must have accessible names and descriptions.',
  );
}

async function assertMenuKeyboardAndPointer(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(page.url(), { waitUntil: 'domcontentloaded' });
  const navigation = page.getByRole('navigation', {
    name: 'Основная навигация',
  });
  const equipment = navigation.getByRole('link', {
    name: 'Оборудование',
    exact: true,
  });
  assert.equal(await equipment.getAttribute('href'), '/catalog');
  assert.equal(await equipment.getAttribute('aria-expanded'), null);

  for (const menuId of ['panels', 'engineering']) {
    const trigger = navigation.locator(`[data-menu-trigger="${menuId}"]`);
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(
      (id) =>
        document.activeElement?.getAttribute('data-menu-link') === id &&
        document.activeElement?.getAttribute('data-menu-index') === '0',
      menuId,
    );
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('ArrowDown');
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('data-menu-index'),
      ),
      '1',
    );
    await page.keyboard.press('Home');
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('data-menu-index'),
      ),
      '0',
    );
    await page.keyboard.press('ArrowUp');
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('data-menu-index'),
      ),
      '1',
    );
    await page.keyboard.press('Home');
    await page.keyboard.press('Escape');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    await page.waitForFunction(
      (id) => document.activeElement?.matches(`[data-menu-trigger="${id}"]`),
      menuId,
    );
    assert.equal(
      await trigger.evaluate((node) => node === document.activeElement),
      true,
    );
  }

  const panels = navigation.locator('[data-menu-trigger="panels"]');
  await panels.hover();
  assert.equal(await panels.getAttribute('aria-expanded'), 'true');
  await page.mouse.move(0, 0);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-menu-trigger="panels"]')
        ?.getAttribute('aria-expanded') === 'false',
  );

  // A mouse enters before it clicks. That click must leave the hovered menu
  // open, while keyboard activation remains a toggle (covered above).
  await panels.click();
  assert.equal(await panels.getAttribute('aria-expanded'), 'true');
  await page.mouse.move(0, 0);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-menu-trigger="panels"]')
        ?.getAttribute('aria-expanded') === 'false',
  );
}

async function assertMobileNavigation(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    // Its accessible name changes to "Закрыть меню" after activation.
    const toggle = page.locator('.mobile-menu-toggle');
    await toggle.tap();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    const navigation = page.getByRole('navigation', {
      name: 'Основная навигация',
    });
    assert.equal(await navigation.isVisible(), true);

    const equipment = navigation.getByRole('link', {
      name: 'Оборудование',
      exact: true,
    });
    assert.equal(await equipment.getAttribute('href'), '/catalog');
    await toggle.focus();
    await page.keyboard.press('Tab');
    assert.equal(
      await equipment.evaluate((node) => node === document.activeElement),
      true,
    );
    await page.keyboard.press('Enter');
    await page.waitForURL('**/catalog');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await toggle.tap();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');

    const panels = page.getByRole('button', {
      name: 'Электрощиты',
      exact: true,
    });
    await panels.tap();
    assert.equal(await panels.getAttribute('aria-expanded'), 'true');
    await panels.tap();
    assert.equal(await panels.getAttribute('aria-expanded'), 'false');
    await panels.tap();
    assert.equal(await panels.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await panels.getAttribute('aria-expanded'), 'false');
    assert.equal(
      await panels.evaluate((node) => node === document.activeElement),
      true,
    );
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await page.waitForFunction(() =>
      document.activeElement?.matches('.mobile-menu-toggle'),
    );
    assert.equal(
      await toggle.evaluate((node) => node === document.activeElement),
      true,
    );

    await toggle.tap();
    await panels.tap();
    await page.getByRole('link', { name: 'Перейти к разделу' }).tap();
    assert.equal(new URL(page.url()).hash, '#panels');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  } finally {
    await context.close();
  }
}

async function assertDisabledFutureActions(page) {
  const heroSearch = page.getByRole('searchbox', {
    name: 'Поиск оборудования на главной',
  });
  const headerSearch = page.getByRole('searchbox', {
    name: 'Поиск в каталоге из шапки',
  });
  const upload = page.getByRole('button', { name: 'Загрузить спецификацию' });
  const quote = page.getByRole('button', { name: 'Запросить КП' });
  assert.equal(await heroSearch.isDisabled(), false);
  assert.equal(await headerSearch.isDisabled(), false);
  for (const search of [heroSearch, headerSearch]) {
    const form = search.locator('xpath=ancestor::form');
    assert.equal(await form.getAttribute('action'), '/catalog');
    assert.equal(await form.getAttribute('method'), 'get');
    assert.equal(await search.getAttribute('name'), 'q');
  }
  assert.equal(await upload.isDisabled(), true);
  assert.equal(await quote.isDisabled(), true);
  assert.match(
    await page.locator('#unavailable-actions').innerText(),
    /пока\s+недоступны/i,
  );
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  assert.equal(await page.locator('form[role="search"]').count(), 2);

  await heroSearch.fill('автоматический выключатель');
  await heroSearch.press('Enter');
  await page.waitForURL(/\/catalog\?q=/);
  assert.equal(
    new URL(page.url()).searchParams.get('q'),
    'автоматический выключатель',
  );
  await page.goto(new URL('/', page.url()).href, {
    waitUntil: 'domcontentloaded',
  });

  await quote.evaluate((button) => button.click());
  await upload.evaluate((button) => button.click());
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(
    await page
      .getByText(/успешно отправлено|заявка создана|файл загружен/i)
      .count(),
    0,
  );
}

async function assertServerRenderedShowcase(baseUrl) {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /aria-label="Этапы инженерной схемы"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Схема инженерного решения/);
}

async function assertEngineeringShowcase(page) {
  const section = page.locator('.engineering-showcase');
  const group = page.getByRole('group', { name: 'Этапы инженерной схемы' });
  const buttons = group.getByRole('button');
  const expected = ['Оборудование', 'Электрощит', 'Инжиниринг'];
  assert.equal(await buttons.count(), expected.length);
  assert.deepEqual(
    await buttons.allTextContents().then((labels) =>
      labels.map((label) =>
        label
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/^\d+\s*/, ''),
      ),
    ),
    expected,
  );

  for (let index = 0; index < expected.length; index += 1) {
    const button = buttons.nth(index);
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.match(
      await section.locator('.engineering-showcase__summary').innerText(),
      new RegExp(
        [
          'Компоненты и обозначения',
          'Компоновка шкафа',
          'Структура системы управления',
        ][index],
      ),
    );
    await section.screenshot({
      path: resolve(artifacts, `showcase-state-0${index + 1}.png`),
      animations: 'disabled',
    });
  }

  await buttons.nth(0).focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await buttons
      .nth(1)
      .evaluate((button) => button === document.activeElement),
    true,
  );
  await page.keyboard.press('Space');
  assert.equal(await buttons.nth(1).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Tab');
  assert.equal(
    await buttons
      .nth(2)
      .evaluate((button) => button === document.activeElement),
    true,
  );
  await page.keyboard.press('Enter');
  assert.equal(await buttons.nth(2).getAttribute('aria-pressed'), 'true');
}

async function assertShowcaseTouch(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const section = page.locator('.engineering-showcase');
    await section.scrollIntoViewIfNeeded();
    const button = page.getByRole('button', { name: 'Инжиниринг' });
    await button.tap();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.match(await section.innerText(), /Структура системы управления/);
  } finally {
    await context.close();
  }
}
async function measureMobilePerformance(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const metrics = { cumulativeLayoutShift: 0, largestContentfulPaint: 0 };
      window.__uiSmokePerformance = metrics;
      if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput)
              metrics.cumulativeLayoutShift += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      }
      if (
        PerformanceObserver.supportedEntryTypes.includes(
          'largest-contentful-paint',
        )
      ) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            metrics.largestContentfulPaint = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      }
    });
    const response = await page.goto(baseUrl, { waitUntil: 'load' });
    assert.equal(response?.status(), 200);
    await page.waitForTimeout(1600);
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const javascriptBytes = performance
        .getEntriesByType('resource')
        .filter(
          (entry) =>
            new URL(entry.name).origin === location.origin &&
            entry.name.endsWith('.js'),
        )
        .reduce((total, entry) => total + entry.encodedBodySize, 0);
      return {
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        largestContentfulPaintMs: Math.round(
          window.__uiSmokePerformance.largestContentfulPaint,
        ),
        cumulativeLayoutShift:
          Math.round(window.__uiSmokePerformance.cumulativeLayoutShift * 1000) /
          1000,
        javascriptKiB: Math.round(javascriptBytes / 1024),
      };
    });
    assert.ok(
      metrics.cumulativeLayoutShift <= 0.1,
      `Mobile cumulative layout shift ${metrics.cumulativeLayoutShift} exceeds 0.1.`,
    );
    console.log(
      `UI mobile performance (375px): DOM-ready ${metrics.domContentLoadedMs}ms, LCP ${metrics.largestContentfulPaintMs}ms, CLS ${metrics.cumulativeLayoutShift}, JavaScript ${metrics.javascriptKiB} KiB encoded.`,
    );
  } finally {
    await context.close();
  }
}

async function captureAndCheckViewports(page, baseUrl) {
  for (const viewport of [
    ...viewports.slice(0, 2),
    { name: 'laptop', width: 1280, height: 900 },
    viewports[2],
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert.ok(
      dimensions.document <= dimensions.viewport &&
        dimensions.body <= dimensions.viewport,
      `Horizontal overflow at ${viewport.width}px: ${JSON.stringify(dimensions)}`,
    );

    if (
      viewport.name === 'mobile' ||
      viewport.name === 'tablet' ||
      viewport.name === 'desktop'
    ) {
      await page.screenshot({
        path: resolve(artifacts, `home-${viewport.name}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
}

async function main() {
  if (!existsSync(resolve(web, '.next/BUILD_ID')))
    throw new Error(
      'UI smoke requires a production build. Run pnpm build first.',
    );
  await mkdir(artifacts, { recursive: true });
  const port = await reserveEphemeralPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const definition = {
    name: 'web-ui-smoke',
    command: process.execPath,
    args: [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    cwd: web,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
    quiet: true,
  };

  await withProcesses(
    [definition],
    async (signal) => {
      await waitForPage(baseUrl, signal);
      const browser = await chromium.launch({ headless: true });
      const externalRequests = [];
      const pageErrors = [];
      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
        });
        const origin = new URL(baseUrl).origin;
        page.on('request', (request) => {
          if (new URL(request.url()).origin !== origin)
            externalRequests.push(request.url());
        });
        const consoleErrors = [];
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await assertServerRenderedShowcase(baseUrl);
        await measureMobilePerformance(browser, baseUrl);
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await assertAccessibleMarkup(page);
        await assertDisabledFutureActions(page);

        await page.keyboard.press('Tab');
        const skipFocus = await page.evaluate(() => ({
          className: document.activeElement?.className,
          outlineStyle: getComputedStyle(document.activeElement).outlineStyle,
          outlineWidth: getComputedStyle(document.activeElement).outlineWidth,
        }));
        assert.equal(skipFocus.className, 'skip-link');
        assert.equal(skipFocus.outlineStyle, 'solid');
        assert.ok(parseFloat(skipFocus.outlineWidth) >= 2);
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.activeElement?.id === 'main');
        assert.equal(
          await page.locator('#main').evaluate((node) => node.tabIndex),
          -1,
        );
        assert.equal(
          await page
            .locator('#main')
            .evaluate((node) => getComputedStyle(node).outlineStyle),
          'solid',
        );

        await page.emulateMedia({ reducedMotion: 'reduce' });
        const reducedMotion = await page.evaluate(() => ({
          scroll: getComputedStyle(document.documentElement).scrollBehavior,
          spinner: getComputedStyle(document.body).animationDuration,
        }));
        assert.equal(reducedMotion.scroll, 'auto');
        assert.ok(parseFloat(reducedMotion.spinner) <= 0.001);
        const reducedShowcaseMotion = await page.evaluate(() => ({
          transition: getComputedStyle(
            document.querySelector('.engineering-showcase__stage'),
          ).transitionDuration,
          pulse: getComputedStyle(
            document.querySelector('.switchgear-art__pulse'),
          ).animationDuration,
        }));
        assert.ok(parseFloat(reducedShowcaseMotion.transition) <= 0.001);
        assert.ok(parseFloat(reducedShowcaseMotion.pulse) <= 0.001);
        await page.emulateMedia({ reducedMotion: 'no-preference' });

        await assertEngineeringShowcase(page);

        await assertMenuKeyboardAndPointer(page);
        await assertMobileNavigation(browser, baseUrl);
        await assertShowcaseTouch(browser, baseUrl);
        await captureAndCheckViewports(page, baseUrl);

        assert.deepEqual(
          pageErrors,
          [],
          `Browser errors: ${pageErrors.join('; ')}`,
        );
        assert.deepEqual(
          consoleErrors,
          [],
          `Browser console errors: ${consoleErrors.join('; ')}`,
        );
        assert.deepEqual(
          externalRequests,
          [],
          `Unexpected external requests: ${externalRequests.join(', ')}`,
        );
      } finally {
        await browser.close();
      }
    },
    { graceMs: 5000, forceMs: 3000 },
  );

  console.log(
    `PASS UI acceptance (${verificationTask}): SSR, keyboard/ARIA, touch, contrast, unavailable actions, reduced motion, viewports 375/768/1280/1440; screenshots and state frames saved in ${artifacts}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : 'UI acceptance failed.');
  process.exitCode = 1;
});
