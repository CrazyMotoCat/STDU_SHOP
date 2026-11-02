import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { root, requireFreePort } from './lib.mjs';
import { withProcesses } from './process-lifecycle.mjs';

const web = resolve(root, 'apps/web');
const requireWeb = createRequire(resolve(web, 'package.json'));
const nextCli = requireWeb.resolve('next/dist/bin/next');
const artifacts = resolve(root, 'artifacts/verification/VIS-CAT-01/after');
const categories = [
  { slug: 'switchgear', name: 'Низковольтное оборудование', sortOrder: 10 },
  { slug: 'automation', name: 'Промышленная автоматика', sortOrder: 20 },
  { slug: 'measurement', name: 'Измерительные приборы', sortOrder: 30 },
];
const breakers = {
  slug: 'breakers',
  name: 'Автоматические выключатели',
  sortOrder: 10,
};
const contactors = { slug: 'contactors', name: 'Контакторы', sortOrder: 20 };
const priceDisplay = { kind: 'ON_REQUEST', label: 'Цена по запросу' };
const sampleCards = [
  {
    slug: 'breaker-acb-100',
    displayName: 'Автоматический выключатель ACB-100',
    brand: { name: 'Acme Electric', slug: 'acme-electric' },
    manufacturerName: 'Acme Electrical Systems',
    originalPartNumber: 'ACB-100',
    modification: 'ACB-100C',
    category: { name: breakers.name, slug: breakers.slug },
    priceDisplay,
  },
  {
    slug: 'breaker-mcb-32',
    displayName: 'Модульный выключатель MCB-32',
    brand: { name: 'Northstar', slug: 'northstar' },
    manufacturerName: 'Northstar Controls',
    originalPartNumber: 'MCB-32',
    modification: null,
    category: { name: breakers.name, slug: breakers.slug },
    priceDisplay,
  },
  {
    slug: 'industrial-rccb-vis-cat-fixture',
    displayName:
      'Устройство защитного отключения селективное четырёхполюсное для промышленной автоматики',
    brand: { name: 'VIS-CAT Fixture', slug: 'vis-cat-fixture' },
    manufacturerName: 'Изолированная тестовая позиция',
    originalPartNumber: 'VIS-CAT-01-DEMO-4P-RCD-125A-SELECTIVE-REFERENCE-2026',
    modification: '125 A / 4P',
    category: { name: breakers.name, slug: breakers.slug },
    priceDisplay,
  },
];
const sampleProduct = {
  ...sampleCards[0],
  summary: 'Воздушный автоматический выключатель для низковольтных систем.',
  description:
    'Трёхполюсное исполнение. Пример изолированной UI-smoke фикстуры.',
  attributes: [
    {
      valueType: 'CatalogAttributeValueDECIMAL',
      attributeCode: 'rated_current',
      label: 'Номинальный ток',
      value: '100',
      unitCode: 'A',
      unitLabel: 'А',
      comparable: true,
    },
    {
      valueType: 'CatalogAttributeValueBOOLEAN',
      attributeCode: 'remote_trip',
      label: 'Дистанционное отключение',
      value: true,
      unitCode: null,
      unitLabel: null,
      comparable: false,
    },
  ],
  relations: [
    {
      relationType: 'ACCESSORY',
      target: {
        ...sampleCards[1],
        displayName: 'Расцепитель для MCB-32',
      },
    },
    {
      relationType: 'COMPATIBLE_EQUIPMENT',
      target: sampleCards[1],
    },
  ],
};
const longSampleProduct = {
  ...sampleCards[2],
  summary: 'Изолированная фикстура для проверки длинной карточки товара.',
  description: null,
  attributes: [],
  relations: [],
};
const observedQueries = [];

async function reservePort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not reserve a loopback port.');
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  await requireFreePort(address.port);
  return address.port;
}

function json(response, payload, status = 200) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function envelope(data, meta) {
  return {
    data,
    meta: { requestId: '00000000-0000-4000-8000-000000000005', ...meta },
  };
}

const fixtureServer = createHttpServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (
    request.method !== 'GET' ||
    !url.pathname.startsWith('/v1/public/catalog/')
  ) {
    response.writeHead(404).end();
    return;
  }

  if (url.pathname === '/v1/public/catalog/categories') {
    const parent = url.searchParams.get('parentSlug');
    const cursor = url.searchParams.get('cursor');
    if (cursor === 'fixture-category-outage') {
      response.writeHead(503).end();
      return;
    }
    const rows = parent === 'switchgear' ? [breakers, contactors] : categories;
    const page = !parent && !cursor ? rows.slice(0, 2) : rows;
    json(
      response,
      envelope(page, {
        pageSize: 24,
        nextCursor: !parent && !cursor ? 'fixture-next-page' : null,
      }),
    );
    return;
  }

  if (url.pathname === '/v1/public/catalog/products') {
    observedQueries.push(new URLSearchParams(url.searchParams));
    if (url.searchParams.get('q') === 'fixture-api-outage') {
      response.writeHead(503).end();
      return;
    }
    const filters = url.searchParams.getAll('filter');
    if (
      filters.length &&
      (!url.searchParams.get('categorySlug') ||
        url.searchParams.get('includeDescendants') !== 'false')
    ) {
      json(response, envelope(null, {}), 400);
      return;
    }
    let rows = [...sampleCards];
    const query = url.searchParams.get('q')?.toLowerCase();
    const brand = url.searchParams.get('brandSlug');
    if (query)
      rows = rows.filter((product) =>
        [
          product.displayName,
          product.brand?.name,
          product.manufacturerName,
          product.originalPartNumber,
          product.modification,
        ]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query)),
      );
    if (brand) rows = rows.filter((product) => product.brand?.slug === brand);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 24);
    const start = (page - 1) * pageSize;
    json(
      response,
      envelope(rows.slice(start, start + pageSize), {
        page,
        pageSize,
        total: rows.length,
        totalPages: Math.max(Math.ceil(rows.length / pageSize), 1),
      }),
    );
    return;
  }

  const slug = /^\/v1\/public\/catalog\/products\/([^/]+)$/.exec(
    url.pathname,
  )?.[1];
  if (slug === 'invalid-slug') {
    response.writeHead(400).end();
    return;
  }
  if (slug === 'api-outage') {
    response.writeHead(503).end();
    return;
  }
  if (slug === sampleProduct.slug || slug === longSampleProduct.slug) {
    json(
      response,
      envelope(
        slug === sampleProduct.slug ? sampleProduct : longSampleProduct,
        {},
      ),
    );
    return;
  }
  response.writeHead(404).end();
});

async function waitForPage(url, signal) {
  const deadline = performance.now() + 45_000;
  let lastError;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]),
      });
      if (response.status === 200) return;
      lastError = new Error(`Next returned HTTP ${response.status}.`);
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
    }
    await new Promise((accept) => setTimeout(accept, 200));
  }
  throw new Error(
    `Catalog UI did not become ready: ${lastError?.message ?? 'timeout'}.`,
  );
}

async function captureAndCheck(page, url, name, width, height) {
  await page.setViewportSize({ width, height });
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200, `${url} must render successfully.`);
  assert.equal(await page.locator('html').getAttribute('lang'), 'ru');
  assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    overflow: [...document.body.querySelectorAll('*')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className:
            typeof element.className === 'string' ? element.className : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((element) => element.right > innerWidth + 1 || element.left < -1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 8),
  }));
  await page.screenshot({
    path: resolve(artifacts, `${name}-${width}.png`),
    fullPage: true,
    animations: 'disabled',
  });
  assert.ok(
    dimensions.document <= dimensions.viewport,
    `Horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`,
  );
}

async function assertProductLayout(page, width) {
  const boxes = await page.evaluate(() => ({
    identity: document
      .querySelector('[class*="detailIdentity"]')
      ?.getBoundingClientRect()
      .toJSON(),
    media: document
      .querySelector('[class*="detailMedia"]')
      ?.getBoundingClientRect()
      .toJSON(),
  }));
  assert.ok(boxes.identity && boxes.media, 'Product layout blocks must exist.');
  const fitsSideBySide =
    width >= 1024 && boxes.media.right <= boxes.identity.left;
  const fitsStacked = width < 1024 && boxes.identity.bottom <= boxes.media.top;
  assert.ok(
    fitsSideBySide || fitsStacked,
    `Product media and identity must not overlap at ${width}px: ${JSON.stringify(boxes)}`,
  );
}

async function waitForPortRelease(port) {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await requireFreePort(port);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((accept) => setTimeout(accept, 100));
    }
  }
  throw new Error(
    `The task-owned Next port ${port} remained occupied after shutdown: ${lastError?.message ?? 'unknown error'}`,
  );
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  await new Promise((accept, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', accept);
  });
  const apiAddress = fixtureServer.address();
  if (!apiAddress || typeof apiAddress === 'string')
    throw new Error('Could not start the isolated catalog fixture adapter.');
  const appPort = await reservePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const browserDefinition = {
    name: 'r1-005-next-catalog-smoke',
    command: process.execPath,
    args: [
      nextCli,
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(appPort),
    ],
    cwd: web,
    env: {
      API_INTERNAL_URL: `http://127.0.0.1:${apiAddress.port}`,
      NEXT_TELEMETRY_DISABLED: '1',
    },
    quiet: true,
  };

  try {
    await withProcesses(
      [browserDefinition],
      async (signal) => {
        await waitForPage(`${baseUrl}/catalog`, signal);
        const browser = await chromium.launch({ headless: true });
        const pageErrors = [];
        try {
          const page = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
          });
          page.on('pageerror', (error) => pageErrors.push(error.message));
          await page.goto(`${baseUrl}/catalog`, { waitUntil: 'networkidle' });
          await page
            .getByRole('heading', { name: 'Инженерное оборудование' })
            .waitFor();
          await page
            .getByText('Автоматический выключатель ACB-100')
            .first()
            .waitFor();
          assert.equal(await page.getByText('Цена по запросу').count(), 3);
          await page
            .getByText('VIS-CAT-01-DEMO-4P-RCD-125A-SELECTIVE-REFERENCE-2026')
            .waitFor();
          await page
            .getByRole('link', {
              name: /Загрузить следующую страницу категорий/,
            })
            .waitFor();
          await page.screenshot({
            path: resolve(artifacts, 'catalog-desktop.png'),
            fullPage: true,
            animations: 'disabled',
          });
          for (const width of [1024, 768, 390]) {
            await captureAndCheck(
              page,
              `${baseUrl}/catalog`,
              `catalog-grid-${width}`,
              width,
              900,
            );
          }

          await page
            .getByLabel('Поиск по каталогу', { exact: true })
            .fill('MCB-32');
          await page
            .getByRole('button', { name: /Применить параметры/ })
            .click();
          await page.waitForURL(/q=MCB-32/);
          await page
            .getByText('Модульный выключатель MCB-32')
            .first()
            .waitFor();
          assert.equal(
            await page.getByText('Автоматический выключатель ACB-100').count(),
            0,
          );
          assert.equal(
            await page.locator('article[class*="productTile"]').count(),
            1,
          );
          await captureAndCheck(
            page,
            page.url(),
            'catalog-single-1440',
            1440,
            900,
          );
          await captureAndCheck(
            page,
            page.url(),
            'catalog-single-390',
            390,
            844,
          );
          await page.goto(`${baseUrl}/catalog?brandSlug=northstar`, {
            waitUntil: 'networkidle',
          });
          await page
            .getByText('Модульный выключатель MCB-32')
            .first()
            .waitFor();
          assert.equal(
            await page.getByText('Автоматический выключатель ACB-100').count(),
            0,
          );
          await page.goto(`${baseUrl}/catalog?q=no-such-item`, {
            waitUntil: 'networkidle',
          });
          await page
            .getByRole('heading', { name: 'Ничего не найдено' })
            .waitFor();

          const categoryUrl = `${baseUrl}/catalog/category/breakers?ancestor=switchgear`;
          await page.goto(`${baseUrl}/catalog/category/breakers`, {
            waitUntil: 'networkidle',
          });
          await page
            .getByRole('heading', { name: 'Автоматические выключатели' })
            .first()
            .waitFor();
          await captureAndCheck(
            page,
            page.url(),
            'category-desktop',
            1440,
            1000,
          );
          for (const width of [1024, 768, 390]) {
            await captureAndCheck(
              page,
              `${baseUrl}/catalog/category/breakers`,
              `category-grid-${width}`,
              width,
              900,
            );
          }
          await page.goto(`${categoryUrl}&filter=rated_current%3Aeq%3A100`, {
            waitUntil: 'networkidle',
          });
          await page
            .getByRole('alert')
            .filter({ hasText: 'API / READ' })
            .waitFor();
          assert.equal(
            observedQueries.at(-1)?.get('includeDescendants'),
            null,
            'An omitted includeDescendants value must not be silently defaulted by the frontend.',
          );
          await page.goto(categoryUrl, { waitUntil: 'networkidle' });
          await page
            .getByRole('heading', { name: 'Автоматические выключатели' })
            .first()
            .waitFor();
          await page.getByText('Расширенные технические фильтры').click();
          const filterForm = page.getByRole('region', {
            name: 'Технический фильтр',
          });
          await filterForm
            .getByRole('button', { name: 'Добавить условие' })
            .click();
          await filterForm
            .getByPlaceholder('например voltage')
            .fill('rated_current');
          await filterForm.getByPlaceholder('значение параметра').fill('100');
          await filterForm
            .getByRole('button', { name: /Применить фильтры/ })
            .click();
          await page.waitForURL(/includeDescendants=false/);
          await page
            .getByText('Автоматический выключатель ACB-100')
            .first()
            .waitFor();
          const appliedQuery = observedQueries.at(-1);
          assert.equal(appliedQuery?.get('categorySlug'), 'breakers');
          assert.equal(appliedQuery?.get('includeDescendants'), 'false');
          assert.deepEqual(appliedQuery?.getAll('filter'), [
            'rated_current:eq:100',
          ]);

          await page.getByRole('link', { name: /Таблица/ }).click();
          await page.waitForURL(/view=table/);
          assert.equal(
            new URL(page.url()).searchParams.get('filter'),
            'rated_current:eq:100',
          );
          await page
            .getByRole('table', {
              name: 'Опубликованное оборудование и основные сведения',
            })
            .waitFor();
          const listViewLink = page.getByRole('link', { name: /Список/ });
          await page.getByRole('link', { name: /Плитка/ }).focus();
          await page.keyboard.press('Tab');
          assert.equal(
            await listViewLink.evaluate(
              (element) => element === document.activeElement,
            ),
            true,
            'Keyboard tab order must include the list view switch.',
          );
          await page.keyboard.press('Enter');
          await page.waitForURL(/view=list/);
          await page.locator('[class*="productListItem"]').first().waitFor();
          assert.equal(
            new URL(page.url()).searchParams.get('includeDescendants'),
            'false',
          );
          await captureAndCheck(
            page,
            page.url(),
            'category-list-1440',
            1440,
            900,
          );
          await captureAndCheck(
            page,
            page.url(),
            'category-list-390',
            390,
            844,
          );
          await page.getByRole('link', { name: /Таблица/ }).click();
          await page.waitForURL(/view=table/);

          await captureAndCheck(page, page.url(), 'category-table', 1440, 1000);
          for (const width of [1024, 768, 390]) {
            await captureAndCheck(
              page,
              page.url(),
              `category-table-${width}`,
              width,
              900,
            );
          }
          const mobileTableScroll = await page
            .locator('[class*="tableScroll"]')
            .evaluate((element) => ({
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              tabIndex: element.tabIndex,
            }));
          assert.ok(
            mobileTableScroll.scrollWidth > mobileTableScroll.clientWidth &&
              mobileTableScroll.tabIndex === 0,
            `Mobile table must keep its own keyboard-scrollable viewport: ${JSON.stringify(mobileTableScroll)}`,
          );
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.goto(`${baseUrl}/catalog/product/breaker-acb-100`, {
            waitUntil: 'networkidle',
          });
          await page
            .getByRole('heading', {
              name: 'Автоматический выключатель ACB-100',
              level: 1,
            })
            .waitFor();
          await page.getByText('100 А').waitFor();
          await page.getByRole('heading', { name: 'Аксессуары' }).waitFor();
          await page
            .getByRole('heading', { name: 'Совместимое оборудование' })
            .waitFor();
          assert.equal(
            await page
              .getByRole('button', {
                name: /Запросить коммерческое предложение/,
              })
              .isDisabled(),
            true,
          );
          const desktopProductOrder = await page.evaluate(() => ({
            mediaRight: document
              .querySelector('[class*="detailMedia"]')
              ?.getBoundingClientRect().right,
            identityLeft: document
              .querySelector('[class*="detailIdentity"]')
              ?.getBoundingClientRect().left,
          }));
          assert.ok(
            desktopProductOrder.mediaRight !== undefined &&
              desktopProductOrder.identityLeft !== undefined &&
              desktopProductOrder.mediaRight < desktopProductOrder.identityLeft,
            `Desktop product media must stay beside the identity panel: ${JSON.stringify(desktopProductOrder)}`,
          );
          await assertProductLayout(page, 1440);
          await page.screenshot({
            path: resolve(artifacts, 'product-desktop.png'),
            fullPage: true,
            animations: 'disabled',
          });
          for (const width of [1024, 768, 390]) {
            await captureAndCheck(
              page,
              `${baseUrl}/catalog/product/breaker-acb-100`,
              `product-${width}`,
              width,
              900,
            );
            await assertProductLayout(page, width);
          }

          await captureAndCheck(
            page,
            `${baseUrl}/catalog`,
            'catalog-mobile',
            375,
            812,
          );
          await captureAndCheck(
            page,
            `${baseUrl}/catalog/category/breakers?ancestor=switchgear`,
            'category-mobile',
            375,
            812,
          );
          await captureAndCheck(
            page,
            `${baseUrl}/catalog/product/breaker-acb-100`,
            'product-mobile',
            375,
            812,
          );
          await assertProductLayout(page, 375);
          const mobileProductOrder = await page.evaluate(() => ({
            titleTop: document.querySelector('h1')?.getBoundingClientRect().top,
            mediaTop: document
              .querySelector('[class*="detailMedia"]')
              ?.getBoundingClientRect().top,
          }));
          assert.ok(
            mobileProductOrder.titleTop !== undefined &&
              mobileProductOrder.mediaTop !== undefined &&
              mobileProductOrder.titleTop < mobileProductOrder.mediaTop,
            `Mobile product identity must precede its media placeholder: ${JSON.stringify(mobileProductOrder)}`,
          );
          for (const width of [1440, 1024, 768, 390]) {
            await captureAndCheck(
              page,
              `${baseUrl}/catalog/product/${longSampleProduct.slug}`,
              `product-long-${width}`,
              width,
              900,
            );
            await assertProductLayout(page, width);
          }
          await page
            .getByRole('heading', {
              name: longSampleProduct.displayName,
              level: 1,
            })
            .waitFor();
          await page
            .getByText(longSampleProduct.originalPartNumber, { exact: true })
            .waitFor();
          await page.emulateMedia({ reducedMotion: 'reduce' });
          const reducedAnimation = await page
            .locator('[class*="productImage"]')
            .first()
            .evaluate((element) => {
              element.setAttribute('data-state', 'loading');
              return getComputedStyle(element).animationName;
            });
          assert.equal(reducedAnimation, 'none');
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          const missingProduct = await page.goto(
            `${baseUrl}/catalog/product/not-published`,
            { waitUntil: 'domcontentloaded' },
          );
          assert.equal(missingProduct?.status(), 404);
          assert.match(
            (await page
              .locator('meta[name="robots"]')
              .last()
              .getAttribute('content')) ?? '',
            /noindex/i,
            'Missing catalog products must stay noindex under the public catalog layout.',
          );
          const missingCategory = await page.goto(
            `${baseUrl}/catalog/category/not-published`,
            { waitUntil: 'domcontentloaded' },
          );
          assert.equal(missingCategory?.status(), 404);
          const invalidProduct = await page.goto(
            `${baseUrl}/catalog/product/invalid-slug`,
            { waitUntil: 'domcontentloaded' },
          );
          assert.equal(invalidProduct?.status(), 404);
          const unavailableProduct = await page.goto(
            `${baseUrl}/catalog/product/api-outage`,
            { waitUntil: 'domcontentloaded' },
          );
          assert.equal(unavailableProduct?.status(), 200);
          assert.equal(
            await page
              .getByRole('heading', { name: 'Не удалось загрузить каталог' })
              .count(),
            1,
          );
          const unavailableCategory = await page.goto(
            `${baseUrl}/catalog/category/switchgear?categoryCursor=fixture-category-outage`,
            { waitUntil: 'domcontentloaded' },
          );
          assert.equal(unavailableCategory?.status(), 200);
          assert.equal(
            await page
              .getByRole('heading', { name: 'Не удалось загрузить каталог' })
              .count(),
            1,
          );
          const unavailableSearch = await page.goto(
            `${baseUrl}/catalog?q=fixture-api-outage`,
            { waitUntil: 'domcontentloaded' },
          );
          assert.equal(unavailableSearch?.status(), 200);
          assert.equal(
            await page
              .getByRole('heading', { name: 'Не удалось загрузить каталог' })
              .count(),
            1,
          );
          assert.deepEqual(
            pageErrors,
            [],
            `Browser errors: ${pageErrors.join('; ')}`,
          );
        } finally {
          await browser.close();
        }
      },
      { graceMs: 10_000, forceMs: 5_000 },
    );
    await waitForPortRelease(appPort);
  } finally {
    await new Promise((accept, reject) =>
      fixtureServer.close((error) => (error ? reject(error) : accept())),
    );
  }

  assert.ok(
    observedQueries.length >= 4,
    'The SSR pages must call the public products operation.',
  );
  console.log(
    `PASS R1-005 browser smoke with isolated public API fixture: ${observedQueries.length} product requests; desktop/mobile catalog, category table, and product screenshots saved to ${artifacts}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
