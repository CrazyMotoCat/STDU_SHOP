import assert from 'node:assert/strict';
import { request as httpsRequest, createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createServer as netServer, connect } from 'node:net';
import selfsigned from 'selfsigned';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { withProcesses } from './process-lifecycle.mjs';
import { root } from './lib.mjs';

export async function reviewUiAcceptance({
  api,
  cookies,
  runId,
  rowId,
  offerId,
  brandId,
  clear,
  identity,
}) {
  const origin = process.env.R1_009A_WEB_ORIGIN;
  assert.match(origin ?? '', /^https:\/\/127\.0\.0\.1:\d+$/);
  const screenshots = resolve(
    root,
    brandId
      ? '.local/r1-009b-create/screenshots'
      : identity
        ? '.local/r1-009b-reconcile-update/screenshots'
        : clear
          ? '.local/r1-009b-clear/screenshots'
          : '.local/r1-009a/screenshots',
  );
  await mkdir(screenshots, { recursive: true });
  const reservation = netServer();
  await new Promise((ok, fail) => {
    reservation.once('error', fail);
    reservation.listen(0, '127.0.0.1', ok);
  });
  const nextPort = reservation.address().port;
  await new Promise((ok) => reservation.close(ok));
  const certificate = await selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    { days: 1, keySize: 2048 },
  );
  const proxy = createServer(
    { key: certificate.private, cert: certificate.cert },
    (req, res) => {
      const upstream = new URL(
        req.url,
        req.url.startsWith('/v1/') ? api : 'http://127.0.0.1:' + nextPort,
      );
      const forwarded = httpRequest(
        upstream,
        {
          method: req.method,
          headers: { ...req.headers, 'x-forwarded-proto': 'https' },
        },
        (reply) => {
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        },
      );
      forwarded.on('error', () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(forwarded);
    },
  );
  const upgrades = new Set();
  proxy.on('upgrade', (req, socket, head) => {
    const upstream = connect(nextPort, '127.0.0.1');
    upgrades.add(socket);
    upgrades.add(upstream);
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => {
      upgrades.delete(socket);
      upstream.destroy();
    });
    upstream.on('close', () => {
      upgrades.delete(upstream);
      socket.destroy();
    });
    upstream.on('connect', () => {
      upstream.write(
        req.method +
          ' ' +
          req.url +
          ' HTTP/' +
          req.httpVersion +
          '\r\n' +
          req.rawHeaders.reduce(
            (lines, value, index) =>
              index % 2 === 0 ? lines + value + ': ' : lines + value + '\r\n',
            '',
          ) +
          '\r\n',
      );
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
  });
  await new Promise((ok, fail) => {
    proxy.once('error', fail);
    proxy.listen(Number(new URL(origin).port), '127.0.0.1', ok);
  });
  try {
    await withProcesses(
      [
        {
          name: 'r1-009a-web',
          command: process.execPath,
          args: [
            resolve(root, 'apps/web/node_modules/next/dist/bin/next'),
            'dev',
            '--hostname',
            '127.0.0.1',
            '--port',
            String(nextPort),
          ],
          cwd: resolve(root, 'apps/web'),
          capture: true,
          env: { NEXT_PUBLIC_API_BASE_URL: '/', NEXT_TELEMETRY_DISABLED: '1' },
        },
      ],
      async () => {
        let ready = false;
        for (let attempt = 0; attempt < 90; attempt++) {
          try {
            ready = await new Promise((resolveReady) => {
              const req = httpsRequest(
                origin + '/staff/suppliers/ingestion',
                { rejectUnauthorized: false, timeout: 2000 },
                (response) => {
                  response.resume();
                  resolveReady(response.statusCode === 200);
                },
              );
              req.on('error', () => resolveReady(false));
              req.on('timeout', () => {
                req.destroy();
                resolveReady(false);
              });
              req.end();
            });
          } catch {
            /* owned server starting */
          }
          if (ready) break;
          await delay(500);
        }
        assert(ready, 'Owned Next server did not become ready');
        const browser = await chromium.launch({ headless: true });
        try {
          const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            ignoreHTTPSErrors: true,
          });
          await context.addCookies(
            cookies.map(([name, value]) => ({
              name,
              value,
              url: origin,
              httpOnly: true,
              sameSite: 'Lax',
              secure: true,
            })),
          );
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          const requests = [];
          page.on('request', (req) => requests.push('REQ ' + req.url()));
          page.on('response', (res) =>
            requests.push('RES ' + res.status() + ' ' + res.url()),
          );
          page.on('requestfailed', (req) => {
            const failure = req.failure()?.errorText;
            // React Strict Mode aborts the initial effect probes. These GETs
            // are independently required to render the workspace/history below.
            const url = new URL(req.url());
            if (
              failure === 'net::ERR_ABORTED' &&
              req.method() === 'GET' &&
              url.origin === origin &&
              (url.pathname === '/v1/staff/auth/me/permissions' ||
                ((clear || identity) &&
                  url.pathname ===
                    '/v1/staff/ingestion/rows/' + rowId + '/edit-history'))
            )
              return;
            errors.push(req.url() + ' ' + failure);
          });
          page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
          });
          await page.goto(origin + '/staff/suppliers/ingestion');
          try {
            const target = page.getByTestId('run-' + runId);
            if (identity) {
              for (
                let pageIndex = 0;
                pageIndex < 4 && !(await target.isVisible());
                pageIndex++
              ) {
                const next = page.getByRole('button', {
                  name: 'Следующие запуски',
                });
                const runs = page.locator('[data-testid^="run-"]');
                await runs.first().waitFor();
                if ((await target.isVisible()) || !(await next.isEnabled()))
                  break;
                const previous = await runs.first().getAttribute('data-testid');
                await next.click();
                if (previous)
                  await page
                    .getByTestId(previous)
                    .waitFor({ state: 'detached' });
              }
            }
            await target.click();
          } catch (error) {
            await page.screenshot({
              path: resolve(screenshots, 'failure.png'),
              fullPage: true,
            });
            await writeFile(
              resolve(screenshots, 'failure.txt'),
              (await page.locator('body').innerText()) +
                '\n' +
                errors.concat(requests).join('\n'),
            );
            throw error;
          }
          if (brandId) {
            await createUiFlow({ page, rowId, brandId, screenshots });
            assert.deepEqual(errors, []);
            await context.close();
            return;
          }
          await page.getByTestId('row-' + rowId).click();
          if (identity) {
            const panel = page
              .locator('details')
              .filter({ hasText: 'Ручная сверка идентичности · UPDATE' });
            await panel.locator('summary').click();
            await panel
              .getByText('Квитанция · ' + identity, { exact: true })
              .waitFor();
            for (const width of [1440, 375]) {
              await page.setViewportSize({ width, height: 1000 });
              assert(
                await page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth,
                ),
                'Identity page overflow',
              );
              await panel.screenshot({
                path: resolve(
                  screenshots,
                  'reconciled-update-' + width + '.png',
                ),
              });
            }
            assert.deepEqual(errors, []);
            await context.close();
            return;
          }
          await page.getByLabel('ID существующего предложения').fill(offerId);
          await page
            .getByRole('button', {
              name: 'Сравнить с предложением',
              exact: true,
            })
            .click();
          await page
            .getByRole('region', { name: 'Сравнение редакций' })
            .locator('table')
            .waitFor();
          if (clear) {
            await clearUiFlow({ page, offerId, screenshots });
            assert.deepEqual(errors, []);
            await context.close();
            return;
          }
          for (const width of [1440, 375]) {
            await page.setViewportSize({ width, height: 1000 });
            assert(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              'Page overflow',
            );
            await page.screenshot({
              path: resolve(screenshots, 'review-' + width + '.png'),
              fullPage: true,
            });
          }
          await page
            .getByLabel('Причина решения')
            .fill('TEST individual review through real browser');
          await page
            .getByRole('button', {
              name: 'Одобрить строку (ACCEPT)',
              exact: true,
            })
            .click();
          await page
            .getByRole('button', {
              name: 'Сравнить с предложением',
              exact: true,
            })
            .click();
          await page
            .getByRole('button', {
              name: 'Применить одобренную строку',
              exact: true,
            })
            .click();
          await page
            .getByRole('button', { name: 'Подтвердить APPLY', exact: true })
            .click();
          await page
            .getByText(
              'Изменения применены. Создана новая редакция предложения.',
              { exact: true },
            )
            .waitFor();
          assert.deepEqual(errors, []);
          await context.close();
        } finally {
          await browser.close();
        }
      },
    );
  } finally {
    for (const socket of upgrades) socket.destroy();
    proxy.closeAllConnections();
    await new Promise((ok) => proxy.close(ok));
  }
}

async function createUiFlow({ page, rowId, brandId, screenshots }) {
  let createRequests = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith('/rows/' + rowId + '/create')
    )
      createRequests++;
  });
  await page.getByTestId('row-' + rowId).click();
  const inspect = page.getByRole('button', {
    name: 'Проверить исходные данные для создания',
  });
  await inspect.click();
  await page
    .getByRole('heading', { name: 'Исходные данные', exact: true })
    .waitFor();
  await page
    .getByLabel('Причина решения')
    .fill('TEST confirmed original supplier identity');
  await page
    .getByRole('button', { name: 'Одобрить строку (ACCEPT)', exact: true })
    .click();
  await page
    .getByText('Строка одобрена. Применение выполняется отдельным действием.', {
      exact: true,
    })
    .waitFor();
  assert.equal(createRequests, 0);
  await inspect.click();
  await page.getByLabel('Подтверждённый бренд').selectOption(brandId);
  await page
    .getByRole('button', { name: 'Предпросмотр создания', exact: true })
    .click();
  const proceed = page.getByRole('button', {
    name: 'Подтвердить точную идентичность и перейти к созданию',
  });
  await proceed.waitFor();
  const acknowledgement = page.getByRole('checkbox', {
    name: 'Архивные совпадения проверены',
  });
  await acknowledgement.waitFor();
  assert.equal(await proceed.isEnabled(), false);
  await acknowledgement.check();

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      'CREATE page overflow',
    );
    await page
      .getByRole('region', { name: 'Новое предложение поставщика' })
      .screenshot({
        path: resolve(screenshots, 'create-preview-' + width + '.png'),
      });
  }
  await proceed.click();
  const confirmation = page.getByRole('group', {
    name: 'Подтверждение создания',
  });
  await confirmation.waitFor();
  assert.equal(createRequests, 0);
  await confirmation.screenshot({
    path: resolve(screenshots, 'create-confirm-375.png'),
  });
  await confirmation
    .getByRole('button', { name: 'Подтвердить CREATE', exact: true })
    .click();
  await page
    .getByText('Предложение создано. Сохранена первая редакция.', {
      exact: true,
    })
    .waitFor();
  await page.getByText('Создано из staging', { exact: true }).waitFor();
  assert.equal(createRequests, 1);
  await page
    .getByRole('region', { name: 'Проверка строки 1' })
    .screenshot({ path: resolve(screenshots, 'create-result-375.png') });
}

async function clearUiFlow({ page, offerId, screenshots }) {
  await page
    .getByLabel('Причина решения')
    .fill('TEST source withdrew its quotation');
  await page
    .getByRole('button', { name: 'Одобрить строку (ACCEPT)', exact: true })
    .click();
  await page
    .getByText('Строка одобрена. Применение выполняется отдельным действием.', {
      exact: true,
    })
    .waitFor();
  await page.getByLabel('ID существующего предложения').fill(offerId);
  await page
    .getByRole('button', { name: 'Сравнить с предложением', exact: true })
    .click();
  await page.getByText('Явные правки предложения', { exact: true }).click();
  await page
    .getByLabel('Закупочная цена', { exact: true })
    .selectOption('CLEAR');
  await page
    .getByLabel('Причина · Закупочная цена', { exact: true })
    .fill('TEST withdrawal');
  await page.getByLabel('Валюта', { exact: true }).selectOption('CLEAR');
  await page
    .getByLabel('Причина · Валюта', { exact: true })
    .fill('TEST withdrawn quote currency');
  const preview = page.getByRole('button', {
    name: 'Проверить явные правки',
    exact: true,
  });
  await preview.click();
  await page
    .getByRole('button', { name: 'Подтвердить основание из снимка источника' })
    .click();
  await preview.click();
  const confirmation = page.getByRole('checkbox', {
    name: 'Подтверждаю показанные изменения и очистку перечисленных полей',
  });
  await confirmation.waitFor();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      'CLEAR page overflow',
    );
    await confirmation.locator('xpath=ancestor::details').screenshot({
      path: resolve(screenshots, 'clear-preview-' + width + '.png'),
    });
  }
  await confirmation.check();
  await page
    .getByRole('button', { name: 'Применить явные правки', exact: true })
    .click();
  await page
    .getByText('Явные правки применены. Создана новая редакция.', {
      exact: true,
    })
    .waitFor();
  await page.getByText('История явных правок', { exact: true }).click();
  await page.getByText('Причина · TEST withdrawal', { exact: true }).waitFor();
}
