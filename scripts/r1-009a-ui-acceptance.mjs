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

export async function reviewUiAcceptance({ api, cookies, runId, offerId }) {
  const origin = process.env.R1_009A_WEB_ORIGIN;
  assert.match(origin ?? '', /^https:\/\/127\.0\.0\.1:\d+$/);
  const screenshots = resolve(root, '.local/r1-009a/screenshots');
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
            // React Strict Mode cancels the first session probe during effect replay.
            if (
              failure === 'net::ERR_ABORTED' &&
              req.method() === 'GET' &&
              req.url() === origin + '/v1/staff/auth/me/permissions'
            )
              return;
            errors.push(req.url() + ' ' + failure);
          });
          page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
          });
          await page.goto(origin + '/staff/suppliers/ingestion');
          try {
            await page.getByTestId('run-' + runId).click();
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
          await page
            .getByRole('button', { name: 'Строка 1', exact: true })
            .click();
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
