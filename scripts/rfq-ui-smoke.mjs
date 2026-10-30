import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
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
    // Confirm the server-side NODE_ENV gate wins even if a flag is mis-set.
    RFQ_API_SUBMISSION_ENABLED: 'true',
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

async function withDevelopmentServer(apiUrl, operation) {
  const webPort = await reservePort();
  const baseUrl = `http://127.0.0.1:${webPort}`;
  const serverEnv = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    RFQ_API_SUBMISSION_ENABLED: 'true',
    NEXT_PUBLIC_API_BASE_URL: apiUrl,
  };
  const child = spawn(
    process.execPath,
    [nextCli, 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)],
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

async function withMockInquiryApi(operation) {
  const records = [];
  const origin = { current: '' };
  const intentIds = [
    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    '0f8fad5b-d9cb-469f-a165-70867728950e',
  ];
  let intentCount = 0;
  const server = createHttpServer(async (request, response) => {
    const requestOrigin = request.headers.origin;
    if (
      requestOrigin &&
      (!origin.current || requestOrigin === origin.current)
    ) {
      response.setHeader('Access-Control-Allow-Origin', requestOrigin);
      response.setHeader('Vary', 'Origin');
    }
    response.setHeader(
      'Access-Control-Allow-Methods',
      'POST, PUT, DELETE, OPTIONS',
    );
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Accept, Content-Type, Idempotency-Key, X-Inquiry-Upload-Capability',
    );
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    const chunks = [];
    let bodyBytes = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      bodyBytes += bytes.byteLength;
      chunks.push(bytes);
    }
    const body = Buffer.concat(chunks);
    const record = {
      method: request.method,
      url: request.url ?? '',
      headers: { ...request.headers },
      bodyBytes,
      bodyHash: createHash('sha256').update(body).digest('hex'),
      bodyText:
        request.method === 'POST' && request.url === '/v1/public/inquiries'
          ? body.toString('utf8')
          : undefined,
    };
    records.push(record);

    if (request.method === 'POST' && request.url === '/v1/public/inquiries') {
      response.writeHead(201, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          data: {
            publicReference: 'RFQ-2026-000000000001',
            createdAt: '2026-10-28T02:00:00.000Z',
            message: 'Заявка принята.',
          },
          meta: { requestId: 'b37b4b47-bc89-4acc-a030-82d38d32bfbb' },
        }),
      );
      return;
    }
    if (
      request.method === 'POST' &&
      request.url === '/v1/public/inquiry-attachments/upload-intents'
    ) {
      const intentRequest = JSON.parse(body.toString('utf8'));
      const intentId = intentIds[intentCount++];
      assert.ok(intentId, 'Unexpected upload intent request.');
      response.writeHead(201, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          data: {
            intentId,
            expiresAt: '2026-10-28T02:10:00.000Z',
            maxBytes: intentRequest.sizeBytes,
          },
          meta: { requestId: 'b37b4b47-bc89-4acc-a030-82d38d32bfbb' },
        }),
      );
      return;
    }
    if (
      request.method === 'PUT' &&
      /^\/v1\/public\/inquiry-attachments\/upload-intents\/[0-9a-f-]+\/content$/.test(
        request.url ?? '',
      )
    ) {
      const uploadCount = records.filter(
        (item) => item.method === 'PUT',
      ).length;
      if (uploadCount === 1) {
        response.writeHead(503, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            code: 'DEPENDENCY_UNAVAILABLE',
            message: 'Fixture transient failure',
            requestId: 'b37b4b47-bc89-4acc-a030-82d38d32bfbb',
          }),
        );
        return;
      }
      if (uploadCount === 3) {
        response.writeHead(415, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            code: 'MIME_MISMATCH',
            message: 'Fixture rejected media',
            requestId: 'b37b4b47-bc89-4acc-a030-82d38d32bfbb',
          }),
        );
        return;
      }
      response.writeHead(201, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          data: {
            accepted: true,
            sizeBytes: bodyBytes,
            securityState: 'QUARANTINED',
          },
          meta: { requestId: 'b37b4b47-bc89-4acc-a030-82d38d32bfbb' },
        }),
      );
      return;
    }
    if (
      request.method === 'DELETE' &&
      /^\/v1\/public\/inquiry-attachments\/upload-intents\/[0-9a-f-]+$/.test(
        request.url ?? '',
      )
    ) {
      response.writeHead(204).end();
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        code: 'NOT_FOUND',
        message: 'Fixture route not found',
        requestId: 'b37b4b47-bc89-4acc-a030-82d38d32bfbb',
      }),
    );
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const apiUrl = `http://127.0.0.1:${address.port}`;
  try {
    await operation(apiUrl, records, (webOrigin) => {
      origin.current = webOrigin;
    });
  } finally {
    await new Promise((accept, reject) =>
      server.close((error) => (error ? reject(error) : accept())),
    );
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
    await page.getByLabel(/Контактное лицо/).getAttribute('maxlength'),
    '180',
  );
  assert.equal(await page.getByLabel('Email').getAttribute('maxlength'), '254');
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
  await assertFieldError(page, itemName, /наименование позиции/);
  await assertFieldError(
    page,
    page.getByLabel(/Контактное лицо/),
    /контактное лицо/,
  );
  await assertFieldError(page, page.getByLabel('Email'), /email или телефон/);
  const validationSummary = page.getByRole('alert', {
    name: 'Проверьте отмеченные поля',
  });
  assert.match(await validationSummary.innerText(), /наименование позиции/);
  assert.ok(await itemName.getAttribute('aria-describedby'));

  await itemName.fill('Модульный автоматический выключатель');
  await page.getByLabel(/Контактное лицо/).fill('Тестовый контакт');
  await page.getByLabel('Email').fill('test@example.invalid');
  await checkButton.click();
  assert.match(
    await page.getByRole('status').innerText(),
    /Проверка доступных полей пройдена/,
  );
  await page.getByLabel('Email').fill('');
  await page.getByLabel('Телефон').fill('');
  await checkButton.click();
  await assertFieldError(page, page.getByLabel('Email'), /email или телефон/);
  await page.getByLabel('Телефон').fill('+7 (900) 000-00-00');
  await checkButton.click();
  assert.match(
    await page.getByRole('status').innerText(),
    /Проверка доступных полей пройдена/,
  );
  await page.getByLabel('Предпочтительный способ связи').selectOption('email');
  await checkButton.click();
  await assertFieldError(
    page,
    page.getByLabel('Предпочтительный способ связи'),
    /корректный email/,
  );
  await page.getByLabel('Предпочтительный способ связи').selectOption('phone');
  await checkButton.click();
  assert.match(
    await page.getByRole('status').innerText(),
    /Проверка доступных полей пройдена/,
  );

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
  await page.getByLabel('Количество').nth(1).fill('3,125');
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
  assert.equal(
    await page.getByLabel('Количество').nth(1).inputValue(),
    '3,125',
  );
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

  const addLineButton = page.getByRole('button', { name: 'Добавить позицию' });
  for (let index = 0; index < 49; index += 1) await addLineButton.click();
  assert.equal(await page.getByLabel('Наименование').count(), 50);
  assert.equal(await addLineButton.isDisabled(), true);
  assert.match(
    await page.getByRole('status').innerText(),
    /Достигнут лимит: не более 50 позиций/,
  );
  assert.equal(
    await page.getByLabel('Наименование').first().inputValue(),
    'Реле контроля фаз',
  );
  await page.getByRole('button', { name: 'Удалить позицию 50' }).click();
  assert.equal(await page.getByLabel('Наименование').count(), 49);
  assert.equal(await addLineButton.isDisabled(), false);
  for (let index = 49; index >= 2; index -= 1) {
    await page
      .getByRole('button', { name: `Удалить позицию ${index}` })
      .click();
  }
  assert.equal(await page.getByLabel('Наименование').count(), 1);
  assert.equal(
    await page.getByLabel('Наименование').first().inputValue(),
    'Реле контроля фаз',
  );

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
  await quantity.fill('4,25');
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
  assert.match(await summary.innerText(), /4,25/);
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
    name: 'Выбранные файлы',
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
  assert.equal(await page.getByText('3 · выбраны', { exact: true }).count(), 1);
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
    await page.getByText(/формат не поддерживается/).innerText(),
    /формат не поддерживается/,
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

async function runApiIntegrationPreview(apiUrl, records, setWebOrigin) {
  await mkdir(artifacts, { recursive: true });
  await withDevelopmentServer(apiUrl, async (browser, baseUrl) => {
    setWebOrigin(new URL(baseUrl).origin);
    const consoleMessages = [];
    const consoleErrors = [];
    const expectedFixtureResponseWarnings = [];
    const browserErrors = [];
    const unexpectedRequests = [];
    const desktop = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    desktop.on('request', (request) => {
      const requestOrigin = new URL(request.url()).origin;
      if (
        requestOrigin !== new URL(baseUrl).origin &&
        requestOrigin !== new URL(apiUrl).origin
      )
        unexpectedRequests.push(request.url());
    });
    desktop.on('console', (message) => {
      consoleMessages.push(message.text());
      if (message.type() === 'error') {
        if (
          message.text().includes('503 (Service Unavailable)') ||
          message.text().includes('415 (Unsupported Media Type)')
        )
          expectedFixtureResponseWarnings.push(message.text());
        else consoleErrors.push(message.text());
      }
    });
    desktop.on('pageerror', (error) => browserErrors.push(error.message));
    desktop.setDefaultTimeout(15000);
    const response = await desktop.goto(`${baseUrl}/request-quote`, {
      waitUntil: 'domcontentloaded',
    });
    assert.equal(response?.status(), 200);
    await assertNoindex(desktop);
    await assertNoOverflow(desktop, 1440);
    await desktop.screenshot({
      path: resolve(artifacts, 'request-quote-api-desktop.png'),
      caret: 'initial',
      style: 'nextjs-portal { display: none !important; }',
    });
    assert.equal(
      await desktop
        .getByRole('button', { name: 'Отправить в тестовую среду' })
        .isEnabled(),
      true,
    );

    await desktop
      .getByLabel('Наименование')
      .first()
      .fill('Тестовый автомат защиты');
    await desktop.getByLabel('Количество').first().fill('2,125');
    await desktop.getByLabel(/Контактное лицо/).fill('Тестовый контакт');
    await desktop.getByLabel('Email').fill('test@example.invalid');
    await desktop.locator('input[type="file"]').setInputFiles({
      name: 'fixture.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 test fixture'),
    });
    await desktop
      .getByRole('button', { name: 'Отправить в тестовую среду' })
      .click();
    await desktop.getByRole('button', { name: 'Повторить файл' }).waitFor();

    const createRequests = records.filter(
      (record) =>
        record.method === 'POST' && record.url === '/v1/public/inquiries',
    );
    assert.equal(createRequests.length, 1);
    const createBody = JSON.parse(createRequests[0].bodyText);
    assert.equal(createBody.kind, 'EQUIPMENT');
    assert.equal(createBody.equipmentLines[0].quantity, '2,125');
    assert.equal(createBody.privacyNotice, undefined);
    assert.match(createBody.uploadCapability, /^[A-Za-z0-9_-]{43}$/);
    const capability = createBody.uploadCapability;

    const intentRequests = records.filter(
      (record) =>
        record.method === 'POST' &&
        record.url === '/v1/public/inquiry-attachments/upload-intents',
    );
    assert.equal(intentRequests.length, 1);
    assert.equal(
      intentRequests[0].headers['x-inquiry-upload-capability'],
      capability,
    );
    const uploadRequests = records.filter((record) => record.method === 'PUT');
    assert.equal(uploadRequests.length, 1);
    assert.equal(
      uploadRequests[0].headers['x-inquiry-upload-capability'],
      capability,
    );
    assert.equal(uploadRequests[0].headers['idempotency-key']?.length, 43);
    assert.equal(
      uploadRequests[0].bodyBytes,
      Buffer.byteLength('%PDF-1.7 test fixture'),
    );

    await desktop.getByRole('button', { name: 'Повторить файл' }).click();
    await desktop
      .getByText(/Принят · карантин до проверки безопасности/)
      .waitFor();
    const receiptPanel = desktop.getByText(
      /Публичный номер: RFQ-2026-000000000001/,
    );
    await receiptPanel.waitFor();
    await receiptPanel.scrollIntoViewIfNeeded();
    await assertNoOverflow(desktop, 1440);
    await desktop.screenshot({
      path: resolve(artifacts, 'request-quote-api-receipt-desktop.png'),
      caret: 'initial',
      style: 'nextjs-portal { display: none !important; }',
    });

    const finalUploads = records.filter((record) => record.method === 'PUT');
    assert.equal(finalUploads.length, 2);
    assert.equal(
      finalUploads[0].headers['idempotency-key'],
      finalUploads[1].headers['idempotency-key'],
    );
    assert.equal(finalUploads[0].bodyHash, finalUploads[1].bodyHash);
    assert.equal(
      finalUploads[1].headers['x-inquiry-upload-capability'],
      capability,
    );
    assert.equal(
      records.filter(
        (record) =>
          record.method === 'POST' && record.url === '/v1/public/inquiries',
      ).length,
      1,
      'Retrying a file must never create a second inquiry.',
    );
    assert.equal(
      records.some((record) => record.url.includes(capability)),
      false,
    );
    assert.deepEqual(
      records.map(({ method, url }) => [method, url]),
      [
        ['POST', '/v1/public/inquiries'],
        ['POST', '/v1/public/inquiry-attachments/upload-intents'],
        [
          'PUT',
          '/v1/public/inquiry-attachments/upload-intents/f47ac10b-58cc-4372-a567-0e02b2c3d479/content',
        ],
        [
          'PUT',
          '/v1/public/inquiry-attachments/upload-intents/f47ac10b-58cc-4372-a567-0e02b2c3d479/content',
        ],
      ],
    );
    assert.equal(new URL(desktop.url()).search.includes(capability), false);
    assert.deepEqual(
      await desktop.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
      })),
      { local: 0, session: 0 },
    );
    assert.equal(
      consoleMessages.some((message) => message.includes(capability)),
      false,
    );
    assert.deepEqual(consoleErrors, [], consoleErrors.join('\n'));
    assert.deepEqual(unexpectedRequests, []);
    assert.equal(expectedFixtureResponseWarnings.length, 1);
    assert.deepEqual(browserErrors, []);

    await desktop.reload({ waitUntil: 'domcontentloaded' });
    await desktop.getByLabel('Наименование').first().fill('Тестовый автомат');
    await desktop.getByLabel(/Контактное лицо/).fill('Тестовый контакт');
    await desktop.getByLabel('Email').fill('test@example.invalid');
    await desktop.locator('input[type="file"]').setInputFiles({
      name: 'fixture-rejected.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 rejected fixture'),
    });
    await desktop
      .getByRole('button', { name: 'Отправить в тестовую среду' })
      .click();
    const continueWithoutFile = desktop.getByRole('button', {
      name: 'Продолжить без файла fixture-rejected.pdf',
    });
    await continueWithoutFile.waitFor();
    await continueWithoutFile.click();
    await desktop.getByText('Не приложен').waitFor();
    assert.equal(
      records.filter(
        (record) =>
          record.method === 'POST' && record.url === '/v1/public/inquiries',
      ).length,
      2,
      'Skipping a rejected file must not create another inquiry.',
    );
    assert.equal(
      records.filter(
        (record) =>
          record.method === 'POST' &&
          record.url === '/v1/public/inquiry-attachments/upload-intents',
      ).length,
      2,
      'A deterministic upload rejection must not spend a second intent.',
    );
    assert.equal(records.filter((record) => record.method === 'PUT').length, 3);
    assert.equal(
      records.filter((record) => record.method === 'DELETE').length,
      1,
    );
    assert.equal(expectedFixtureResponseWarnings.length, 2);

    const mobile = await browser.newPage({
      viewport: { width: 375, height: 812 },
    });
    mobile.on('request', (request) => {
      const requestOrigin = new URL(request.url()).origin;
      if (
        requestOrigin !== new URL(baseUrl).origin &&
        requestOrigin !== new URL(apiUrl).origin
      )
        unexpectedRequests.push(request.url());
    });
    mobile.on('console', (message) => {
      consoleMessages.push(message.text());
      if (message.type() === 'error') {
        if (
          message.text().includes('503 (Service Unavailable)') ||
          message.text().includes('415 (Unsupported Media Type)')
        )
          expectedFixtureResponseWarnings.push(message.text());
        else consoleErrors.push(message.text());
      }
    });
    mobile.on('pageerror', (error) => browserErrors.push(error.message));
    const mobileResponse = await mobile.goto(`${baseUrl}/request-quote`, {
      waitUntil: 'domcontentloaded',
    });
    assert.equal(mobileResponse?.status(), 200);
    await assertNoindex(mobile);
    await assertNoOverflow(mobile, 375);
    await mobile.screenshot({
      path: resolve(artifacts, 'request-quote-api-mobile.png'),
      caret: 'initial',
      style: 'nextjs-portal { display: none !important; }',
    });
    assert.equal(
      await mobile
        .getByRole('button', { name: 'Отправить в тестовую среду' })
        .isEnabled(),
      true,
    );
    assert.deepEqual(browserErrors, []);
    assert.deepEqual(consoleErrors, [], consoleErrors.join('\n'));
    assert.deepEqual(unexpectedRequests, []);
    assert.equal(expectedFixtureResponseWarnings.length, 2);
    await mobile.close();
    await desktop.close();
  });
  console.log(
    'RFQ development API browser smoke: create, decimal quantity, upload capability, unknown retry, deterministic rejection recovery, QUARANTINED receipt, no duplicate inquiry, no browser storage and 1440/375 layout passed.',
  );
}

async function main() {
  if (!existsSync(buildId))
    throw new Error(
      'Run pnpm --filter @stdu/web build before this production-mode smoke.',
    );
  await withPreviewServer(true, runEnabledPreview);
  await withPreviewServer(false, runDisabledPreview);
  await withMockInquiryApi(async (apiUrl, records, setWebOrigin) => {
    await runApiIntegrationPreview(apiUrl, records, setWebOrigin);
  });
  console.log(`RFQ screenshots saved to ${artifacts}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
