import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { root, requireFreePort } from './lib.mjs';

const web = resolve(root, 'apps/web');
const requireWeb = createRequire(resolve(web, 'package.json'));
const nextCli = requireWeb.resolve('next/dist/bin/next');
const buildId = resolve(web, '.next/BUILD_ID');
const artifacts = resolve(
  process.env.RFQ_SCREENSHOT_DIR ??
    resolve(root, 'artifacts/verification/R1-010A-FINAL'),
);

async function reservePort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  await requireFreePort(address.port);
  return address.port;
}

async function waitForPage(url, child, getOutput) {
  const deadline = performance.now() + 45000;
  let lastError;
  while (performance.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Next.js exited before ready:\n${getOutput()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (response.status === 200) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(
    `Next.js did not become ready: ${lastError?.message}.\n${getOutput()}`,
  );
}

async function withPreviewServer(enabled, operation) {
  assert.ok(
    existsSync(buildId),
    'Run pnpm --filter @stdu/web build before the RFQ browser smoke.',
  );
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverEnv = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
  };
  if (enabled) serverEnv.RFQ_PREVIEW_ENABLED = 'true';
  else delete serverEnv.RFQ_PREVIEW_ENABLED;
  const child = spawn(
    process.execPath,
    [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: web,
      env: serverEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const getOutput = () => output.slice(-5000);

  try {
    await waitForPage(`${baseUrl}/request-quote`, child, getOutput);
    const browser = await chromium.launch({ headless: true });
    try {
      await operation(browser, baseUrl);
    } finally {
      await browser.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((accept) => child.once('exit', accept));
      child.kill('SIGTERM');
      await Promise.race([exited, delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  }
}

async function trackedPage(browser, baseUrl, viewport) {
  const page = await browser.newPage({ viewport });
  const origin = new URL(baseUrl).origin;
  const externalRequests = [];
  const nonGetRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.setDefaultTimeout(10000);
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin)
      externalRequests.push(request.url());
    if (request.method() !== 'GET')
      nonGetRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return {
    page,
    assertQuiet() {
      assert.deepEqual(externalRequests, [], 'Unexpected external requests.');
      assert.deepEqual(nonGetRequests, [], 'Unexpected non-GET requests.');
      assert.deepEqual(consoleErrors, [], 'Browser console errors.');
      assert.deepEqual(pageErrors, [], 'Browser page errors.');
    },
  };
}

async function assertNoOverflow(page, width) {
  const sizes = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    sizes.document <= width && sizes.body <= width,
    `Horizontal overflow: ${JSON.stringify(sizes)}`,
  );
}

async function assertNoindex(page) {
  assert.match(
    (await page.locator('meta[name="robots"]').getAttribute('content')) ?? '',
    /noindex.*nofollow/,
  );
}

async function assertFieldError(page, field, pattern) {
  assert.equal(await field.getAttribute('aria-invalid'), 'true');
  const describedBy = (await field.getAttribute('aria-describedby')) ?? '';
  assert.ok(describedBy, 'Invalid field must reference its inline error.');
  const descriptions = await Promise.all(
    describedBy
      .split(/\s+/)
      .map((id) => page.locator(`[id="${id}"]`).innerText()),
  );
  assert.match(descriptions.join(' '), pattern);
}

async function checkEquipmentFlow(page, baseUrl) {
  const response = await page.goto(
    `${baseUrl}/request-quote?kind=equipment&product=TEST-HINT-ONLY`,
    { waitUntil: 'domcontentloaded' },
  );
  assert.equal(response?.status(), 200);
  await assertNoindex(page);
  assert.equal(
    await page.getByRole('heading', { level: 1 }).innerText(),
    'Запросить коммерческое предложение',
  );
  const productContext = await page
    .getByRole('complementary', { name: 'Контекст перехода' })
    .innerText();
  assert.match(productContext, /TEST-HINT-ONLY/);
  assert.match(productContext, /только подсказка/);
  assert.equal(await page.locator('input[type="file"]').count(), 1);
  assert.equal(
    await page
      .getByRole('button', { name: 'Отправка недоступна' })
      .isDisabled(),
    true,
  );

  const itemName = page.getByLabel('Наименование').first();
  const checkButton = page.getByRole('button', {
    name: /Проверить заполнение/,
  });
  await checkButton.click();
  await assertFieldError(page, itemName, /Добавьте хотя бы одну/);
  const validationSummary = page.getByRole('alert', {
    name: 'Проверьте отмеченные поля',
  });
  assert.match(await validationSummary.innerText(), /Добавьте хотя бы одну/);
  assert.ok(await itemName.getAttribute('aria-describedby'));

  await itemName.fill('Модульный автоматический выключатель');
  await checkButton.click();
  assert.match(
    await page.getByRole('status').innerText(),
    /Проверка доступных полей пройдена/,
  );
  assert.match(
    await page
      .getByText(/Обязательность контактного канала будет определена/)
      .innerText(),
    /контракте/,
  );

  await page.getByLabel('Контактное лицо').fill('Тестовый контакт');
  await page.getByLabel('Email').fill('не-email');
  await page.getByLabel('Телефон').fill('телефон');
  await checkButton.click();
  await assertFieldError(page, page.getByLabel('Email'), /формат email/);
  await assertFieldError(page, page.getByLabel('Телефон'), /формат телефона/);
  assert.match(await validationSummary.innerText(), /формат email/);
  assert.match(await validationSummary.innerText(), /формат телефона/);
  await validationSummary.screenshot({
    path: resolve(artifacts, 'validation-errors-summary.png'),
  });
  await page
    .getByLabel('Email')
    .locator('xpath=..')
    .screenshot({
      path: resolve(artifacts, 'validation-email-field.png'),
    });

  const directions = page.getByRole('group', { name: 'Направление заявки' });
  await directions.getByRole('button', { name: /Электрощиты/ }).press('Enter');
  assert.equal(await validationSummary.count(), 0);
  assert.equal(await page.getByLabel('Email').inputValue(), 'не-email');
  assert.equal(await page.getByLabel('Телефон').inputValue(), 'телефон');
  await directions.getByRole('button', { name: /Оборудование/ }).press('Enter');
  assert.equal(await page.getByLabel('Email').inputValue(), 'не-email');
  await checkButton.click();
  await assertFieldError(page, page.getByLabel('Email'), /формат email/);

  await page.getByLabel('Email').fill('test@example.invalid');
  await page.getByLabel('Телефон').fill('+7 (900) 000-00-00');
  const firstQuantity = page.getByLabel('Количество').first();
  await firstQuantity.fill('0');
  await checkButton.click();
  await assertFieldError(page, firstQuantity, /больше нуля/);
  await firstQuantity.fill('-2');
  await checkButton.click();
  assert.equal(await firstQuantity.getAttribute('aria-invalid'), 'true');
  await firstQuantity.fill('2');

  await page.getByRole('button', { name: 'Добавить позицию' }).click();
  await page.getByLabel('Наименование').nth(1).fill('Реле контроля фаз');
  await page.getByLabel('Количество').nth(1).fill('3');
  await checkButton.click();
  assert.match(
    await page.getByRole('status').innerText(),
    /Проверка доступных полей пройдена/,
  );
  assert.doesNotMatch(
    await page.locator('main').innerText(),
    /Заявка готова к отправке|Успешно отправлено|номер обращения/i,
  );
  const equipmentPreview = page.getByRole('region', {
    name: 'Проверьте детали запроса',
  });
  assert.equal(await equipmentPreview.locator('li').count(), 2);
  assert.match(
    await equipmentPreview.innerText(),
    /Модульный автоматический выключатель/,
  );
  assert.match(await equipmentPreview.innerText(), /Реле контроля фаз/);
  assert.match(await equipmentPreview.innerText(), /test@example\.invalid/);
  assert.match(
    await equipmentPreview.innerText(),
    /подсказка, не подтверждённая позиция/i,
  );
  await equipmentPreview.screenshot({
    path: resolve(artifacts, 'equipment-summary-two-items.png'),
  });

  await page.getByRole('button', { name: 'Удалить позицию 1' }).click();
  assert.equal(
    await page.getByLabel('Наименование').first().inputValue(),
    'Реле контроля фаз',
  );
  assert.equal(await page.getByText('Позиция 01', { exact: true }).count(), 1);

  return checkButton;
}

async function checkPanelsFlow(page) {
  const directions = page.getByRole('group', { name: 'Направление заявки' });
  const panelButton = directions.getByRole('button', { name: /Электрощиты/ });
  await panelButton.focus();
  await page.keyboard.press('Enter');
  assert.equal(await panelButton.getAttribute('aria-pressed'), 'true');
  await page
    .getByLabel('Кратко опишите задачу')
    .fill('Сборка шкафа по проекту заказчика');

  const radios = [
    page.getByRole('radio', { name: /Есть готовый проект/ }),
    page.getByRole('radio', { name: /Изменить типовое решение/ }),
    page.getByRole('radio', { name: /Разработать по ТЗ/ }),
  ];
  await radios[0].focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await radios[1].isChecked(), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await radios[2].isChecked(), true);
  await page.getByRole('checkbox', { name: 'Сборка' }).check();
  await page.getByRole('checkbox', { name: 'Комплектация' }).check();

  const quantity = page.getByLabel('Количество шкафов');
  const checkButton = page.getByRole('button', {
    name: /Проверить заполнение/,
  });
  await quantity.fill('-1');
  await checkButton.click();
  await assertFieldError(page, quantity, /больше нуля/);
  await quantity.fill('4');
  await checkButton.click();
  const summary = page.getByRole('region', {
    name: 'Проверьте детали запроса',
  });
  assert.match(await summary.innerText(), /Разработать по ТЗ/);
  assert.match(
    await summary.innerText(),
    /Комплектация, Сборка|Сборка, Комплектация/,
  );
  assert.match(await summary.innerText(), /Сборка шкафа по проекту заказчика/);
  assert.match(await summary.innerText(), /Тестовый контакт/);
}

async function checkEngineeringFlow(page) {
  const directions = page.getByRole('group', { name: 'Направление заявки' });
  await directions
    .getByRole('button', { name: /Проектирование/ })
    .press('Enter');
  const checkButton = page.getByRole('button', {
    name: /Проверить заполнение/,
  });
  const subject = page.getByLabel('Предмет работ');
  await checkButton.click();
  await assertFieldError(page, subject, /предмет инженерной задачи/);
  assert.match(
    await page
      .getByRole('alert', { name: 'Проверьте отмеченные поля' })
      .innerText(),
    /предмет инженерной задачи/,
  );

  await page.getByLabel('Тип объекта или системы').fill('Система вентиляции');
  const serviceArea = page.getByLabel('Направление работ');
  await subject.fill('Проектирование и настройка управления вентиляцией');
  await serviceArea.selectOption({ label: 'Проектирование ЭОМ' });
  assert.equal(
    await subject.inputValue(),
    'Проектирование и настройка управления вентиляцией',
  );
  await serviceArea.selectOption({ label: 'Автоматизация и диспетчеризация' });
  await page
    .getByLabel('Исходная документация')
    .fill('Схема и перечень сигналов');
  await page.getByLabel('Предполагаемый объём работ').fill('Один объект');
  await page
    .getByLabel('Ожидаемые результаты')
    .fill('Рабочая документация и программа');
  await checkButton.click();

  const summary = page.getByRole('region', {
    name: 'Проверьте детали запроса',
  });
  assert.match(await summary.innerText(), /Автоматизация и диспетчеризация/);
  assert.match(
    await summary.innerText(),
    /Проектирование и настройка управления вентиляцией/,
  );
  assert.match(await summary.innerText(), /Рабочая документация и программа/);
  assert.match(await summary.innerText(), /test@example\.invalid/);
}

async function checkFiles(page, baseUrl) {
  const fileButton = page.getByRole('button', { name: 'Выбрать файлы' });
  const chooserPromise = page.waitForEvent('filechooser');
  await fileButton.press('Enter');
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'спецификация.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,quantity\nАвтомат,2'),
  });

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    {
      name: 'спецификация.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name,quantity\nРеле,1'),
    },
    {
      name: 'проект-с-очень-длинным-наименованием-для-проверки-переноса-строки.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF demo'),
    },
  ]);

  const dropzone = input.locator('xpath=..');
  await dropzone.evaluate((element) => {
    const files = new DataTransfer();
    files.items.add(
      new File(['schema'], 'схема.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    element.dispatchEvent(
      new DragEvent('dragenter', { bubbles: true, dataTransfer: files }),
    );
    element.dispatchEvent(
      new DragEvent('drop', { bubbles: true, dataTransfer: files }),
    );
  });

  const fileList = page.getByRole('list', {
    name: 'Выбранные файлы, локальный предпросмотр',
  });
  assert.equal(await fileList.getByRole('listitem').count(), 4);
  assert.equal(
    await page
      .getByRole('button', { name: 'Удалить файл спецификация.csv' })
      .count(),
    2,
  );
  assert.match(await fileList.innerText(), /Б/);
  assert.match(await fileList.innerText(), /схема\.xlsx/);

  await page.setViewportSize({ width: 375, height: 812 });
  await assertNoOverflow(page, 375);
  await page
    .getByRole('button', { name: 'Удалить файл спецификация.csv' })
    .first()
    .click();
  assert.equal(await fileList.getByRole('listitem').count(), 3);
  await page.getByRole('button', { name: 'Проверить заполнение' }).click();
  assert.equal(
    await page.getByText('3 · локально', { exact: true }).count(),
    1,
  );
  const mobileReview = page.getByRole('region', {
    name: 'Проверьте детали запроса',
  });
  assert.match(
    await mobileReview.innerText(),
    /проект-с-очень-длинным-наименованием-для-проверки-переноса-строки\.pdf/i,
  );
  assert.match(await mobileReview.innerText(), /схема\.xlsx/);
  await mobileReview.screenshot({
    path: resolve(artifacts, 'equipment-summary-files-mobile.png'),
  });
  await assertNoOverflow(page, 375);

  await page.locator('input[type="file"]').setInputFiles({
    name: 'payload.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('ignored'),
  });
  assert.match(
    await page.getByText(/неподдерживаемого формата/).innerText(),
    /неподдерживаемого формата/,
  );
  assert.equal(await fileList.getByRole('listitem').count(), 3);

  const currentUrl = new URL(page.url());
  assert.equal(currentUrl.origin, new URL(baseUrl).origin);
  assert.equal(currentUrl.searchParams.get('product'), 'TEST-HINT-ONLY');
  assert.equal(currentUrl.searchParams.has('email'), false);
  assert.equal(currentUrl.searchParams.has('phone'), false);
  assert.deepEqual(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
    { local: 0, session: 0 },
  );
}

async function runEnabledPreview(browser, baseUrl) {
  await mkdir(artifacts, { recursive: true });
  const desktop = await trackedPage(browser, baseUrl, {
    width: 1440,
    height: 1000,
  });
  const response = await desktop.page.goto(
    `${baseUrl}/request-quote?kind=equipment`,
    {
      waitUntil: 'domcontentloaded',
    },
  );
  assert.equal(response?.status(), 200);
  await assertNoindex(desktop.page);
  assert.equal(
    await desktop.page
      .getByRole('group', { name: 'Направление заявки' })
      .getByRole('button')
      .count(),
    3,
  );
  await desktop.page.screenshot({
    path: resolve(artifacts, 'first-screen-desktop.png'),
  });
  await desktop.assertQuiet();

  await checkEquipmentFlow(desktop.page, baseUrl);
  await checkPanelsFlow(desktop.page);
  await checkEngineeringFlow(desktop.page);

  const directions = desktop.page.getByRole('group', {
    name: 'Направление заявки',
  });
  await directions.getByRole('button', { name: /Оборудование/ }).press('Enter');
  assert.equal(await desktop.page.getByLabel('Наименование').count(), 1);
  assert.equal(
    await desktop.page.getByLabel('Наименование').first().inputValue(),
    'Реле контроля фаз',
  );
  await checkFiles(desktop.page, baseUrl);
  desktop.assertQuiet();

  const mobile = await trackedPage(browser, baseUrl, {
    width: 375,
    height: 812,
  });
  const mobileResponse = await mobile.page.goto(
    `${baseUrl}/request-quote?kind=equipment`,
    {
      waitUntil: 'domcontentloaded',
    },
  );
  assert.equal(mobileResponse?.status(), 200);
  await assertNoindex(mobile.page);
  await assertNoOverflow(mobile.page, 375);
  await mobile.page.screenshot({
    path: resolve(artifacts, 'first-screen-mobile.png'),
  });
  const equipmentButton = mobile.page
    .getByRole('group', { name: 'Направление заявки' })
    .getByRole('button', { name: /Оборудование/ });
  await equipmentButton.focus();
  await mobile.page.keyboard.press('Space');
  assert.equal(await equipmentButton.getAttribute('aria-pressed'), 'true');
  assert.equal(
    await equipmentButton.evaluate((element) =>
      element.matches(':focus-visible'),
    ),
    true,
  );
  assert.ok(
    (await equipmentButton.evaluate(
      (element) => element.getBoundingClientRect().height,
    )) >= 44,
  );
  await mobile.page.keyboard.press('Tab');
  const focusedControl = await mobile.page.evaluate(
    () => document.activeElement?.textContent ?? '',
  );
  assert.match(focusedControl, /Электрощиты/);
  const panelsButton = mobile.page
    .getByRole('group', { name: 'Направление заявки' })
    .getByRole('button', { name: /Электрощиты/ });
  await mobile.page.keyboard.press('Enter');
  assert.equal(await panelsButton.getAttribute('aria-pressed'), 'true');
  mobile.assertQuiet();
  await mobile.page.close();
  await desktop.page.close();
  console.log(
    'RFQ enabled preview: equipment, panels, engineering, validation, keyboard, files, noindex and no network submission passed.',
  );
}

async function runDisabledPreview(browser, baseUrl) {
  const { page, assertQuiet } = await trackedPage(browser, baseUrl, {
    width: 1440,
    height: 1000,
  });
  const response = await page.goto(`${baseUrl}/request-quote?kind=equipment`, {
    waitUntil: 'domcontentloaded',
  });
  assert.equal(response?.status(), 200);
  await assertNoindex(page);
  assert.equal(
    await page
      .getByRole('heading', { name: 'Запрос КП пока не подключён' })
      .count(),
    1,
  );
  assert.equal(
    await page.getByRole('heading', { name: 'Что требуется?' }).count(),
    0,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Отправка недоступна' }).count(),
    0,
  );
  assertQuiet();
  await page.close();
  console.log(
    'RFQ disabled preview: production default remains unavailable and no request is sent.',
  );
}

async function main() {
  if (!existsSync(buildId))
    throw new Error(
      'Run pnpm --filter @stdu/web build before this production-mode smoke.',
    );
  await withPreviewServer(true, runEnabledPreview);
  await withPreviewServer(false, runDisabledPreview);
  console.log(`RFQ screenshots saved to ${artifacts}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
