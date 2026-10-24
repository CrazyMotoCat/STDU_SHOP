import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { chromium, type Browser, type Page } from 'playwright';
import { generate as generateCertificate } from 'selfsigned';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { IdentityCrypto } from '../src/identity/crypto.js';
import { createApiApp } from '../src/app.factory.js';

type JsonRecord = Record<string, unknown>;
type ApiResult = { status: number; body: JsonRecord; headers: Headers };
type Actor = { id: string; email: string; password: string; agent: StaffAgent };

const apiRoot = resolve(process.cwd(), 'apps/api');
const repoRoot = resolve(apiRoot, '../..');
const webRoot = resolve(repoRoot, 'apps/web');
const require = createRequire(resolve(repoRoot, 'package.json'));
const nextBin = require.resolve('next/dist/bin/next', { paths: [webRoot] });
const adminEmail = process.env.R1_006B_TEST_ADMIN_EMAIL!;
const adminPassword = process.env.R1_006B_TEST_ADMIN_PASSWORD!;
const runtimeDatabaseUrl = process.env.STAFF_DATABASE_URL!;
const ownerDatabaseUrl = process.env.MIGRATION_DATABASE_URL!;

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

function record(value: unknown): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as JsonRecord;
}

function data<T>(result: ApiResult): T {
  return record(result.body.data) as T;
}

class StaffAgent {
  readonly cookies = new Map<string, string>();
  baseUrl = '';
  origin = '';

  remember(response: Response) {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const pair = cookie.split(';', 1)[0] ?? '';
      const split = pair.indexOf('=');
      if (split < 1) continue;
      const name = pair.slice(0, split);
      const value = pair.slice(split + 1);
      if (!value || /max-age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiResult> {
    const headers = new Headers({ Origin: this.origin, ...extraHeaders });
    if (this.cookies.size)
      headers.set(
        'Cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    let requestBody: BodyInit | undefined;
    if (body instanceof FormData) requestBody = body;
    else if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      requestBody = JSON.stringify(body);
    }
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      ...(requestBody === undefined ? {} : { body: requestBody }),
      signal: AbortSignal.timeout(45_000),
    });
    this.remember(response);
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? (JSON.parse(text) as unknown) : {};
    } catch {
      parsed = {};
    }
    return {
      status: response.status,
      body:
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as JsonRecord)
          : {},
      headers: response.headers,
    };
  }

  async csrf() {
    const response = await this.request('GET', '/v1/staff/auth/csrf');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return String(data<{ token: string }>(response).token);
  }

  async write(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return this.request(method, path, body, {
      'X-CSRF-Token': await this.csrf(),
      ...headers,
    });
  }

  async login(email: string, password: string) {
    return this.request(
      'POST',
      '/v1/staff/auth/login',
      { email, password },
      { 'X-CSRF-Token': await this.csrf() },
    );
  }
}

let db: PrismaClient;
let ownerDb: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApp>> | undefined;
let apiPort = 0;
let webPort = 0;
let proxyPort = 0;
let webOrigin = '';
let proxy: Server | undefined;
let nextProcess: ChildProcess | undefined;
let nextLogs = '';
let browser: Browser | undefined;
let page: Page | undefined;
let admin: Actor;
let categoryId = '';
let brandId = '';
let runId = '';
let rowIds: string[] = [];
const runtimeEnabled = Boolean(
  adminEmail &&
  adminPassword &&
  runtimeDatabaseUrl &&
  ownerDatabaseUrl &&
  process.env.REDIS_URL &&
  process.env.INGESTION_INTERNAL_URL &&
  process.env.FILE_STORAGE_ROOT,
);

async function reservePort() {
  const server = createServer();
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return port;
}

function apiAgent() {
  const agent = new StaffAgent();
  agent.baseUrl = `http://127.0.0.1:${apiPort}`;
  agent.origin = webOrigin;
  return agent;
}

function startNext() {
  nextProcess = spawn(
    process.execPath,
    [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_API_BASE_URL: '/staff-api',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    },
  );
  nextProcess.stdout?.on('data', (chunk) => {
    nextLogs = `${nextLogs}${chunk}`.slice(-12_000);
  });
  nextProcess.stderr?.on('data', (chunk) => {
    nextLogs = `${nextLogs}${chunk}`.slice(-12_000);
  });
}

function startProxy(key: string, cert: string) {
  proxy = https.createServer({ key, cert }, (request, response) => {
    const isApi = request.url?.startsWith('/staff-api/') ?? false;
    const targetPort = isApi ? apiPort : webPort;
    const targetPath = isApi
      ? request.url!.slice('/staff-api'.length)
      : (request.url ?? '/');
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        method: request.method,
        path: targetPath,
        headers: {
          ...request.headers,
          host: `127.0.0.1:${targetPort}`,
          'x-forwarded-host': `127.0.0.1:${proxyPort}`,
          'x-forwarded-proto': 'https',
        },
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent)
        response.writeHead(502, { 'content-type': 'text/plain' });
      response.end('Disposable test proxy could not reach its owned service.');
    });
    request.pipe(upstream);
  });
  proxy.on('upgrade', (request, socket, head) => {
    const upstream = http.request({
      hostname: '127.0.0.1',
      port: webPort,
      method: 'GET',
      path: request.url,
      headers: request.headers,
    });
    upstream.on('upgrade', (_response, upstreamSocket, upstreamHead) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      for (const [name, value] of Object.entries(_response.headers)) {
        const values = Array.isArray(value) ? value.join(', ') : value;
        if (values) socket.write(`${name}: ${values}\r\n`);
      }
      socket.write('\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on('error', () => socket.destroy());
    upstream.end();
  });
}

function httpsGet(url: string): Promise<number> {
  return new Promise((accept, reject) => {
    const request = https.get(
      url,
      { rejectUnauthorized: false, timeout: 2_000 },
      (response) => {
        response.resume();
        accept(response.statusCode ?? 500);
      },
    );
    request.on('timeout', () =>
      request.destroy(new Error('HTTPS test server timeout')),
    );
    request.on('error', reject);
  });
}

async function waitForUi() {
  const deadline = Date.now() + 90_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (nextProcess?.exitCode !== null && nextProcess?.exitCode !== undefined)
      throw new Error(`Owned Next dev server exited early: ${nextLogs}`);
    try {
      if ((await httpsGet(`${webOrigin}/staff/catalog/imports`)) === 200)
        return;
    } catch (error) {
      lastError = error;
    }
    await delay(400);
  }
  throw new Error(
    `Owned Next dev UI did not become ready: ${String(lastError)}\n${nextLogs}`,
  );
}

async function waitForDatabaseBlocker(blockerPid: number, minimumBlocked = 1) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const [activity] = await ownerDb.$queryRaw<{ blockedCount: number }[]>`
      SELECT count(*)::integer AS "blockedCount"
      FROM pg_stat_activity a
      WHERE a.pid <> pg_backend_pid()
        AND a.wait_event_type = 'Lock'
        AND (
          pg_blocking_pids(a.pid) @> ARRAY[${blockerPid}::integer]
          OR EXISTS (
            SELECT 1
            FROM unnest(pg_blocking_pids(a.pid)) AS parent(pid)
            WHERE pg_blocking_pids(parent.pid) @> ARRAY[${blockerPid}::integer]
          )
        )
    `;
    if ((activity?.blockedCount ?? 0) >= minimumBlocked) return;
    await delay(10);
  }
  const waiting = await ownerDb.$queryRaw<
    {
      pid: number;
      waitEventType: string | null;
      waitEvent: string | null;
      blockingPids: number[];
    }[]
  >`
    SELECT a.pid::integer AS pid, a.wait_event_type AS "waitEventType",
      a.wait_event AS "waitEvent", pg_blocking_pids(a.pid)::integer[] AS "blockingPids"
    FROM pg_stat_activity a
    WHERE a.pid <> pg_backend_pid() AND a.wait_event_type = 'Lock'
  `;
  throw new Error(
    `Expected ${minimumBlocked} operation(s) to block behind PostgreSQL backend ${blockerPid}; observed ${JSON.stringify(waiting)}.`,
  );
}

async function stopNext() {
  if (
    !nextProcess ||
    nextProcess.exitCode !== null ||
    nextProcess.signalCode !== null
  )
    return;
  if (process.platform === 'win32') {
    const killer = spawn(
      'taskkill',
      ['/PID', String(nextProcess.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true },
    );
    await new Promise<void>((accept) => killer.once('close', () => accept()));
  } else if (nextProcess.pid) {
    try {
      process.kill(-nextProcess.pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  const closed = await Promise.race([
    new Promise<boolean>((accept) =>
      nextProcess!.once('close', () => accept(true)),
    ),
    delay(8_000).then(() => false),
  ]);
  if (!closed) {
    if (process.platform === 'win32' && nextProcess.pid) {
      const killer = spawn(
        'taskkill',
        ['/PID', String(nextProcess.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      );
      await new Promise<void>((accept) => killer.once('close', () => accept()));
    } else if (nextProcess.pid) {
      process.kill(-nextProcess.pid, 'SIGKILL');
    }
    const forced = await Promise.race([
      new Promise<boolean>((accept) =>
        nextProcess!.once('close', () => accept(true)),
      ),
      delay(5_000).then(() => false),
    ]);
    if (!forced)
      throw new Error(
        `Owned Next dev process tree remained alive after bounded shutdown.\n${nextLogs}`,
      );
  }
}

async function makeReadOnlyActor(): Promise<Actor> {
  const id = randomUUID();
  const roleId = randomUUID();
  const email = `r1-006b-reader-${randomUUID().slice(0, 8)}@example.invalid`;
  const password = `R1-006B read only ${randomBytes(16).toString('hex')}!`;
  const passwordHash = await new IdentityCrypto().hashPassword(password, email);
  await db.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        id: roleId,
        code: `r1-006b-read-${randomUUID().slice(0, 8)}`,
        name: 'Disposable import read-only fixture',
        state: 'ACTIVE',
      },
    });
    const permission = await tx.permission.findUnique({
      where: { code: 'catalog.products.read' },
      select: { id: true },
    });
    assert(permission);
    await tx.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id },
    });
    await tx.staffUser.create({
      data: {
        id,
        email,
        emailNormalized: email,
        displayName: 'Disposable import reader',
        passwordHash,
        passwordChangeRequired: false,
        state: 'ACTIVE',
      },
    });
    await tx.userRole.create({ data: { staffUserId: id, roleId: role.id } });
  });
  const agent = apiAgent();
  const login = await agent.login(email, password);
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { id, email, password, agent };
}

beforeAll(async () => {
  if (!runtimeEnabled) return;
  assert(
    adminEmail && adminPassword && runtimeDatabaseUrl && ownerDatabaseUrl,
    'R1-006B disposable runtime environment is incomplete.',
  );
  apiPort = await reservePort();
  webPort = await reservePort();
  proxyPort = await reservePort();
  webOrigin = `https://127.0.0.1:${proxyPort}`;

  process.env.APP_ENV = 'production';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(apiPort);
  process.env.COOKIE_PROFILE = 'https';
  process.env.STAFF_ORIGINS = webOrigin;
  process.env.PUBLIC_WEB_ORIGIN = webOrigin;
  process.env.TRUSTED_PROXY_ADDRESS = '127.0.0.1';

  db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: runtimeDatabaseUrl }),
  });
  ownerDb = new PrismaClient({
    adapter: new PrismaPg({ connectionString: ownerDatabaseUrl }),
  });
  app = await createApiApp();
  await app.listen(apiPort, '127.0.0.1');

  const category = await db.category.create({
    data: {
      id: randomUUID(),
      slug: `r1006b-${randomUUID().slice(0, 8)}`,
      name: 'Disposable import category',
      state: 'ACTIVE',
    },
  });
  categoryId = category.id;
  const brand = await db.brand.create({
    data: {
      id: randomUUID(),
      slug: `r1006b-brand-${randomUUID().slice(0, 8)}`,
      name: 'Disposable import brand',
      state: 'ACTIVE',
    },
  });
  brandId = brand.id;
  admin = {
    id: '',
    email: adminEmail,
    password: adminPassword,
    agent: apiAgent(),
  };
  const adminLogin = await admin.agent.login(adminEmail, adminPassword);
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
  const adminUser = await ownerDb.staffUser.findUnique({
    where: { emailNormalized: adminEmail.toLowerCase() },
    select: { id: true },
  });
  assert(adminUser, 'Disposable owner principal must exist after login.');
  admin.id = adminUser.id;

  const web = await generateCertificate(
    [{ name: 'commonName', value: '127.0.0.1' }],
    {
      algorithm: 'sha256',
      extensions: [
        { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
      ],
    },
  );
  startProxy(web.private, web.cert);
  await new Promise<void>((accept, reject) => {
    proxy!.once('error', reject);
    proxy!.listen(proxyPort, '127.0.0.1', accept);
  });
  startNext();
  await waitForUi();
}, 120_000);

afterAll(async () => {
  if (!runtimeEnabled) return;
  await browser?.close().catch(() => undefined);
  await stopNext();
  if (proxy?.listening)
    await new Promise<void>((accept, reject) =>
      proxy!.close((error) => (error ? reject(error) : accept())),
    );
  await app?.close();
  await db?.$disconnect();
  await ownerDb?.$disconnect();
}, 30_000);

describe('R1-006B disposable PostgreSQL + HTTP + Staff UI', () => {
  it.skipIf(!runtimeEnabled)(
    'E2E-03 uploads privately, maps a fixed category/brand, previews, creates DRAFT, and records conflict atomically',
    async () => {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      page = await context.newPage();
      const browserDiagnostics: string[] = [];
      page.on('pageerror', (error) =>
        browserDiagnostics.push(`pageerror: ${error.message}`),
      );
      page.on('console', (message) => {
        if (message.type() === 'error')
          browserDiagnostics.push(`console: ${message.text()}`);
      });
      page.on('response', (response) => {
        if (response.url().includes('/staff-api/'))
          browserDiagnostics.push(
            `api ${response.status()} ${new URL(response.url()).pathname}`,
          );
      });
      let decisionRequest:
        | { url: string; headers: Record<string, string>; body: JsonRecord }
        | undefined;
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          request.url().includes('/rows/') &&
          request.url().endsWith('/decision')
        ) {
          try {
            decisionRequest = {
              url: request.url(),
              headers: request.headers(),
              body: request.postDataJSON() as JsonRecord,
            };
          } catch {
            /* malformed request will be observed by the UI response */
          }
        }
      });
      await page.goto(`${webOrigin}/staff/catalog/imports`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForResponse(
        (response) => response.url().endsWith('/v1/staff/auth/me'),
        { timeout: 10_000 },
      );
      await page.getByLabel('Email').fill(adminEmail);
      await page.getByLabel('Пароль').fill(adminPassword);
      await page.getByRole('button', { name: 'Войти' }).click();
      try {
        await page
          .getByRole('heading', { name: 'Ручной импорт' })
          .waitFor({ timeout: 10_000 });
      } catch {
        throw new Error(
          `Staff UI login did not complete. URL: ${page.url()}; button: ${await page.getByRole('button').first().textContent()}; alert: ${(await page.getByRole('alert').allTextContents()).join(' | ') || 'none'}; browser: ${browserDiagnostics.join(' || ')}`,
        );
      }
      await page.locator('[data-testid="import-file"]').setInputFiles({
        name: 'parts.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          'Название;Производитель;Артикул\nРеле RX;Вендор А;RX-001\nКонтактор CX;Вендор Б;CX-002\nАвтомат AX;Вендор В;AX-003\n',
          'utf8',
        ),
      });
      const uploadResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/v1/staff/catalog/imports'),
        { timeout: 30_000 },
      );
      await page.getByRole('button', { name: 'Загрузить приватно' }).click();
      const uploadResult = await uploadResponse;
      const uploadAlert = await page.getByRole('alert').allTextContents();
      if (
        uploadResult.status() !== 201 ||
        uploadAlert.some((text) => text.trim())
      )
        throw new Error(
          `Staff upload failed with HTTP ${uploadResult.status()}: ${await uploadResult.text()}; alert: ${uploadAlert.join(' | ')}; browser: ${browserDiagnostics.join(' || ')}`,
        );
      await page.getByText(/Источник сохранён приватно/).waitFor();
      await page.getByText('SOURCE_READY').first().waitFor();
      const sourceHash = await page.locator('code').first().textContent();
      assert.match(sourceHash ?? '', /^[a-f0-9]{64}$/);
      const selectedRun = await db.catalogImportRun.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { sourceFileObject: true, sourceFileVersion: true },
      });
      assert(selectedRun);
      runId = selectedRun.id;
      assert.equal(selectedRun.sourceFileObject.visibility, 'PRIVATE');
      assert.equal(selectedRun.sourceFileVersion.safetyState, 'UNCHECKED');
      assert.equal(selectedRun.sourceFileVersion.storageKey.length, 64);
      assert.equal(
        JSON.stringify({
          ...selectedRun,
          sourceFileVersion: undefined,
        }).includes(selectedRun.sourceFileVersion.storageKey),
        false,
      );

      await page.getByLabel('Фиксированная категория').selectOption(categoryId);
      await page.getByLabel('Фиксированный бренд').selectOption(brandId);
      await page.getByLabel('Назначение колонки 1').selectOption('displayName');
      await page
        .getByLabel('Назначение колонки 2')
        .selectOption('manufacturerName');
      await page
        .getByLabel('Назначение колонки 3')
        .selectOption('originalPartNumber');
      await page.getByRole('button', { name: 'Сохранить mapping' }).click();
      await page.getByText('Mapping сохранён с контролем версии.').waitFor();
      const revisionTargetSlug = `revision-fixture-${randomUUID().slice(0, 8)}`;
      const revisionTargetCreate = await admin.agent.write(
        'POST',
        '/v1/staff/catalog/products',
        {
          slug: revisionTargetSlug,
          brandId,
          manufacturerName: 'Вендор В',
          originalPartNumber: 'AX-003',
          categoryId,
          displayName: 'Эталонный автомат AX',
          attributes: [],
        },
      );
      assert.equal(
        revisionTargetCreate.status,
        201,
        JSON.stringify(revisionTargetCreate.body),
      );
      const previewResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/v1\/staff\/catalog\/imports\/[^/]+\/preview$/.test(
            new URL(response.url()).pathname,
          ),
        { timeout: 30_000 },
      );
      await page.getByRole('button', { name: 'Проверить строки' }).click();
      const previewResult = await previewResponse;
      if (previewResult.status() !== 200)
        throw new Error(
          `Staff preview failed with HTTP ${previewResult.status()}: ${await previewResult.text()}; browser: ${browserDiagnostics.join(' || ')}`,
        );
      const previewedRows = await db.catalogImportRow.findMany({
        where: { importRunId: runId },
        orderBy: [{ sheetIndex: 'asc' }, { sourceRowNumber: 'asc' }],
        select: { sourceRowNumber: true, candidateState: true },
      });
      assert.deepEqual(
        previewedRows.map(({ candidateState }) => candidateState),
        ['HEADER', 'NEW', 'NEW', 'EXACT_MATCH'],
        `Preview returned 200 but persisted: ${JSON.stringify(previewedRows)}`,
      );
      await page.getByText('NEW').first().waitFor({ timeout: 10_000 });
      const persistedRows = await db.catalogImportRow.findMany({
        where: { importRunId: runId },
        orderBy: [{ sheetIndex: 'asc' }, { sourceRowNumber: 'asc' }],
      });
      assert.equal(persistedRows.length, 4);
      rowIds = persistedRows.map(({ id }) => id);
      assert.equal(persistedRows[0]?.candidateState, 'HEADER');
      assert.equal(persistedRows[1]?.candidateState, 'NEW');
      assert.equal(
        (persistedRows[1]?.normalizedCandidate as JsonRecord).categoryId,
        categoryId,
      );
      assert.equal(
        (persistedRows[1]?.normalizedCandidate as JsonRecord).brandId,
        brandId,
      );
      assert.equal(
        persistedRows[3]?.matchedProductId,
        String(data<{ id: string }>(revisionTargetCreate).id),
      );

      await page
        .getByTestId('import-row')
        .nth(1)
        .getByRole('button', { name: 'Создать DRAFT' })
        .click();
      await page.getByText('APPLIED').first().waitFor({ timeout: 20_000 });
      const createdDecision = await db.catalogImportDecision.findFirst({
        where: { rowId: rowIds[1] },
      });
      assert(createdDecision?.targetProductId);
      const importedProduct = await db.catalogProduct.findUnique({
        where: { id: createdDecision.targetProductId },
      });
      assert(importedProduct);
      assert.equal(importedProduct.publicationState, 'DRAFT');
      assert(importedProduct.currentDraftRevisionId);
      assert.equal(importedProduct.publishedRevisionId, null);
      assert.match(importedProduct.slug, /^rele-rx-[a-f0-9]{32}$/);
      const publicProducts = (await fetch(
        `http://127.0.0.1:${apiPort}/v1/public/catalog/products?limit=100`,
      ).then((response) => response.json())) as JsonRecord;
      assert(
        !JSON.stringify(publicProducts).includes(importedProduct.slug),
        'Unapproved imported DRAFT must not appear in public catalog.',
      );

      const reader = await makeReadOnlyActor();
      const privateRows = await reader.agent.request(
        'GET',
        `/v1/staff/catalog/imports/${runId}/rows`,
      );
      assert.equal(
        privateRows.status,
        404,
        "catalog.products.read alone must not expose another staff member's source rows.",
      );
      assert(!JSON.stringify(privateRows.body).includes('Контактор CX'));

      const conflictRow = persistedRows[2]!;
      const conflictProduct = await admin.agent.write(
        'POST',
        '/v1/staff/catalog/products',
        {
          slug: `conflict-fixture-${randomUUID().slice(0, 8)}`,
          brandId,
          manufacturerName: 'Вендор Б',
          originalPartNumber: 'CX-002',
          categoryId,
          displayName: 'Предсуществующий товар',
          attributes: [],
        },
      );
      assert.equal(
        conflictProduct.status,
        201,
        JSON.stringify(conflictProduct.body),
      );
      const conflictProductId = data<{ id: string }>(conflictProduct).id;
      await page
        .getByTestId('import-row')
        .nth(2)
        .getByRole('button', { name: 'Создать DRAFT' })
        .click();
      await page
        .getByRole('alert')
        .filter({ hasText: 'IDENTITY_CONFLICT' })
        .waitFor({ timeout: 20_000 });
      assert(
        decisionRequest,
        'UI must send an idempotency key on row decisions.',
      );
      const idempotencyKey = decisionRequest.headers['idempotency-key'];
      assert.match(idempotencyKey ?? '', /^[0-9a-f-]{36}$/i);
      const apiReplay = await admin.agent.request(
        'POST',
        `/v1/staff/catalog/imports/${runId}/rows/${conflictRow.id}/decision`,
        decisionRequest.body,
        {
          'X-CSRF-Token': await admin.agent.csrf(),
          'Idempotency-Key': idempotencyKey!,
        },
      );
      assert.equal(apiReplay.status, 409);
      assert.equal(apiReplay.body.code, 'IDENTITY_CONFLICT');
      const conflictState = await db.catalogImportRow.findUnique({
        where: { id: conflictRow.id },
      });
      assert.equal(conflictState?.candidateState, 'CONFLICT');
      const conflicts = await db.catalogImportDecision.findMany({
        where: { rowId: conflictRow.id },
      });
      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0]?.outcome, 'CONFLICT');
      assert.equal(conflicts[0]?.conflictCode, 'IDENTITY_CONFLICT');
      assert.equal(conflicts[0]?.targetProductId, null);
      const conflictAudit = await db.auditEvent.findUnique({
        where: { id: conflicts[0]!.auditEventId },
      });
      assert.equal(conflictAudit?.outcome, 'DENIED');
      assert.equal(conflictAudit?.reasonCode, 'IDENTITY_CONFLICT');
      assert.equal(conflictAudit?.actorUserId, admin.id);
      const mismatchedActorAuditId = randomUUID();
      const conflictRun = await db.catalogImportRun.findUnique({
        where: { id: runId },
      });
      assert(conflictRun && conflictState);
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.auditEvent.create({
            data: {
              id: mismatchedActorAuditId,
              actorKind: 'STAFF',
              actorUserId: admin.id,
              action: 'catalog.import.row.decided',
              entityType: 'CatalogImportRow',
              entityId: conflictRow.id,
              outcome: 'DENIED',
              reasonCode: 'IDENTITY_CONFLICT',
              requestId: randomUUID(),
              changes: {
                runId,
                sheetIndex: conflictRow.sheetIndex,
                sourceRowNumber: conflictRow.sourceRowNumber,
                action: 'ACCEPT_CREATE',
                outcome: 'CONFLICT',
                targetProductId: null,
                resultRevisionId: null,
                expectedRowVersion: conflictState.version,
              },
            },
          });
          await tx.catalogImportDecision.create({
            data: {
              id: randomUUID(),
              rowId: conflictRow.id,
              actorStaffUserId: reader.id,
              idempotencyKey: randomUUID(),
              requestHash: randomBytes(32),
              expectedRowVersion: conflictState.version,
              mappingVersion: conflictRun.mappingVersion,
              action: 'ACCEPT_CREATE',
              outcome: 'CONFLICT',
              conflictCode: 'IDENTITY_CONFLICT',
              auditEventId: mismatchedActorAuditId,
              reasonCode: null,
            },
          });
        }),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes('IMPORT_CONFLICT_AUDIT_MISMATCH'),
      );
      assert.equal(
        await db.auditEvent.count({ where: { id: mismatchedActorAuditId } }),
        0,
        'A rejected actor mismatch must roll its audit row back too.',
      );
      const mismatchedReasonAuditId = randomUUID();
      const createdProductDecision = await db.catalogImportDecision.findFirst({
        where: { rowId: persistedRows[1]!.id, outcome: 'APPLIED' },
      });
      assert(createdProductDecision?.targetProductId);
      assert(createdProductDecision.resultRevisionId);
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.auditEvent.create({
            data: {
              id: mismatchedReasonAuditId,
              actorKind: 'STAFF',
              actorUserId: admin.id,
              action: 'catalog.import.row.decided',
              entityType: 'CatalogImportRow',
              entityId: persistedRows[1]!.id,
              outcome: 'SUCCESS',
              reasonCode: 'HELD',
              requestId: randomUUID(),
              changes: {
                runId,
                sheetIndex: persistedRows[1]!.sheetIndex,
                sourceRowNumber: persistedRows[1]!.sourceRowNumber,
                action: 'ACCEPT_CREATE',
                outcome: 'APPLIED',
                targetProductId: createdProductDecision.targetProductId,
                resultRevisionId: createdProductDecision.resultRevisionId,
                expectedRowVersion: persistedRows[1]!.version,
              },
            },
          });
          await tx.catalogImportDecision.create({
            data: {
              id: randomUUID(),
              rowId: persistedRows[1]!.id,
              actorStaffUserId: admin.id,
              idempotencyKey: randomUUID(),
              requestHash: randomBytes(32),
              expectedRowVersion: persistedRows[1]!.version,
              mappingVersion: conflictRun!.mappingVersion,
              action: 'ACCEPT_CREATE',
              outcome: 'APPLIED',
              targetProductId: createdProductDecision.targetProductId,
              resultRevisionId: createdProductDecision.resultRevisionId,
              auditEventId: mismatchedReasonAuditId,
              reasonCode: null,
            },
          });
        }),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes('IMPORT_SUCCESS_AUDIT_MISMATCH'),
      );
      assert.equal(
        await db.auditEvent.count({ where: { id: mismatchedReasonAuditId } }),
        0,
        'A mismatched success reason must roll back its audit row too.',
      );
      assert.equal(
        await db.catalogProduct.count({
          where: {
            brandId,
            manufacturerName: 'Вендор Б',
            originalPartNumber: 'CX-002',
          },
        }),
        1,
      );

      const failureRow = persistedRows[3]!;
      await ownerDb.$executeRawUnsafe(
        `CREATE FUNCTION r1_006b_fail_decision_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='catalog.import.row.decided' AND NEW.outcome='SUCCESS' AND NEW.changes->>'action'='HOLD' THEN RAISE EXCEPTION 'injected disposable test audit failure'; END IF; RETURN NEW; END $$`,
      );
      await ownerDb.$executeRawUnsafe(
        `CREATE TRIGGER r1_006b_fail_decision_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION r1_006b_fail_decision_audit()`,
      );
      try {
        const failure = await admin.agent.write(
          'POST',
          `/v1/staff/catalog/imports/${runId}/rows/${failureRow.id}/decision`,
          {
            expectedRowVersion: failureRow.version,
            action: 'HOLD',
            reasonCode: 'OTHER',
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(failure.status, 503, JSON.stringify(failure.body));
        assert.equal(failure.body.code, 'AUDIT_UNAVAILABLE');
      } finally {
        await ownerDb.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS r1_006b_fail_decision_audit ON audit_event`,
        );
        await ownerDb.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS r1_006b_fail_decision_audit()`,
        );
      }
      const unchangedRow = await db.catalogImportRow.findUnique({
        where: { id: failureRow.id },
      });
      assert.equal(unchangedRow?.candidateState, 'EXACT_MATCH');
      assert.equal(unchangedRow?.version, failureRow.version);
      assert.equal(
        await db.catalogImportDecision.count({
          where: { rowId: failureRow.id },
        }),
        0,
      );
      assert.equal(
        await db.auditEvent.count({
          where: {
            entityId: failureRow.id,
            action: 'catalog.import.row.decided',
            outcome: 'SUCCESS',
          },
        }),
        0,
      );

      const revisionRow = persistedRows[3]!;
      const revisionProductId = revisionRow.matchedProductId;
      assert(revisionProductId);
      const revisionRootBefore = await db.catalogProduct.findUnique({
        where: { id: revisionProductId },
      });
      assert(revisionRootBefore?.currentDraftRevisionId);
      const revisionCountBefore = await db.catalogProductRevision.count({
        where: { productId: revisionProductId },
      });
      await page
        .getByTestId('import-row')
        .nth(3)
        .getByRole('button', { name: 'Создать DRAFT-редакцию' })
        .click();
      await page
        .getByTestId('import-row')
        .nth(3)
        .getByText('APPLIED')
        .waitFor({ timeout: 20_000 });
      assert.equal(decisionRequest?.body.action, 'ACCEPT_REVISION');
      const revisionDecision = await db.catalogImportDecision.findFirst({
        where: { rowId: revisionRow.id, action: 'ACCEPT_REVISION' },
      });
      assert(revisionDecision?.resultRevisionId);
      assert.equal(revisionDecision.targetProductId, revisionProductId);
      const importedRevision = await db.catalogProductRevision.findUnique({
        where: { id: revisionDecision.resultRevisionId },
      });
      assert.equal(importedRevision?.state, 'DRAFT');
      const revisionAudit = await db.auditEvent.findFirst({
        where: {
          action: 'catalog.product.revision.created',
          entityId: revisionProductId,
          outcome: 'SUCCESS',
        },
        orderBy: { occurredAt: 'desc' },
      });
      assert(revisionAudit);
      assert.deepEqual((revisionAudit.changes as JsonRecord).changedFields, [
        'displayName',
      ]);
      const revisionRootAfter = await db.catalogProduct.findUnique({
        where: { id: revisionProductId },
      });
      assert.equal(revisionRootAfter?.version, revisionRootBefore.version + 1);
      assert.equal(revisionRootAfter?.pendingRevisionId, null);
      assert.equal(revisionRootAfter?.publishedRevisionId, null);
      assert.equal(
        await db.catalogProductRevision.count({
          where: { productId: revisionProductId },
        }),
        revisionCountBefore + 1,
      );

      const completedWithIssues = await db.catalogImportRun.findUnique({
        where: { id: runId },
      });
      assert.equal(completedWithIssues?.state, 'COMPLETED_WITH_ISSUES');
      const terminalVersions = await db.catalogImportRow.findMany({
        where: { id: { in: [persistedRows[1]!.id, revisionRow.id] } },
        select: { id: true, candidateState: true, version: true },
      });
      const repreview = await admin.agent.write(
        'POST',
        `/v1/staff/catalog/imports/${runId}/preview`,
        {},
      );
      assert.equal(repreview.status, 200, JSON.stringify(repreview.body));
      const reopenedRows = await db.catalogImportRow.findMany({
        where: { id: { in: rowIds } },
        orderBy: [{ sheetIndex: 'asc' }, { sourceRowNumber: 'asc' }],
      });
      const reopenedConflict = reopenedRows.find(
        ({ id }) => id === conflictRow.id,
      );
      assert.equal(reopenedConflict?.candidateState, 'EXACT_MATCH');
      assert.equal(reopenedConflict?.matchedProductId, conflictProductId);
      for (const terminal of terminalVersions) {
        const unchanged = reopenedRows.find(({ id }) => id === terminal.id);
        assert.equal(unchanged?.candidateState, 'APPLIED');
        assert.equal(unchanged?.version, terminal.version);
      }

      const targetId = reopenedConflict?.matchedProductId;
      assert(targetId && reopenedConflict.expectedProductVersion);
      assert(reopenedConflict.expectedCurrentRevisionId);
      const targetBeforeRace = await db.catalogProduct.findUnique({
        where: { id: targetId },
      });
      assert(targetBeforeRace?.currentDraftRevisionId);
      const targetRevisionCountBefore = await db.catalogProductRevision.count({
        where: { productId: targetId },
      });
      let resolveRelease!: () => void;
      const releaseLock = new Promise<void>((resolveLock) => {
        resolveRelease = resolveLock;
      });
      let signalLock!: () => void;
      const lockAcquired = new Promise<void>((resolveLock) => {
        signalLock = resolveLock;
      });
      let blockerPid = 0;
      const blocker = ownerDb.$transaction(
        async (tx) => {
          const [backend] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::integer AS pid
        `;
          assert(backend);
          blockerPid = backend.pid;
          await tx.$queryRaw`
          SELECT id FROM public.catalog_product
          WHERE id=${targetId}::uuid FOR UPDATE
        `;
          signalLock();
          await releaseLock;
        },
        { timeout: 45_000 },
      );
      await lockAcquired;
      const patchAgent = apiAgent();
      const patchLogin = await patchAgent.login(adminEmail, adminPassword);
      assert.equal(patchLogin.status, 200, JSON.stringify(patchLogin.body));
      const patchCsrf = await patchAgent.csrf();
      const importCsrf = await admin.agent.csrf();
      const patchRace = patchAgent
        .request(
          'PATCH',
          `/v1/staff/catalog/products/${targetId}`,
          {
            expectedVersion: targetBeforeRace.version,
            baseRevisionId: targetBeforeRace.currentDraftRevisionId,
            displayName: 'Конкурентное изменение CX',
          },
          { 'X-CSRF-Token': patchCsrf },
        )
        .then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        );
      let importRace:
        Promise<{ result: ApiResult } | { error: unknown }> | undefined;
      let blockerObservationError: unknown;
      try {
        await waitForDatabaseBlocker(blockerPid);
        const raceIdempotencyKey = randomUUID();
        importRace = admin.agent
          .request(
            'POST',
            `/v1/staff/catalog/imports/${runId}/rows/${conflictRow.id}/decision`,
            {
              expectedRowVersion: reopenedConflict.version,
              expectedProductVersion: reopenedConflict.expectedProductVersion,
              expectedCurrentRevisionId:
                reopenedConflict.expectedCurrentRevisionId,
              action: 'ACCEPT_REVISION',
            },
            {
              'X-CSRF-Token': importCsrf,
              'Idempotency-Key': raceIdempotencyKey,
            },
          )
          .then(
            (result) => ({ result }),
            (error: unknown) => ({ error }),
          );
        await waitForDatabaseBlocker(blockerPid, 2);
      } catch (error) {
        blockerObservationError = error;
      } finally {
        resolveRelease();
      }
      await blocker;
      assert(importRace);
      const [patchSettled, importSettled] = await Promise.all([
        patchRace,
        importRace,
      ]);
      if (!('result' in patchSettled))
        throw new Error(
          `Concurrent catalog patch failed: ${String(patchSettled.error)}`,
        );
      if (!('result' in importSettled))
        throw new Error(
          `Concurrent import decision failed: ${String(importSettled.error)}`,
        );
      const patchResult = patchSettled.result;
      const importResult = importSettled.result;
      if (blockerObservationError)
        throw new Error(
          `${String(blockerObservationError)}; patch HTTP ${patchResult.status} ${JSON.stringify(patchResult.body)}; import HTTP ${importResult.status} ${JSON.stringify(importResult.body)}`,
        );
      const patchWon = patchResult.status === 200;
      const importWon = importResult.status === 200;
      assert.notEqual(patchWon, importWon);
      if (patchWon) {
        assert.equal(
          importResult.status,
          409,
          JSON.stringify(importResult.body),
        );
        assert.equal(importResult.body.code, 'IMPORT_ROW_CONFLICT');
      } else {
        assert.equal(patchResult.status, 409, JSON.stringify(patchResult.body));
        assert.equal(patchResult.body.code, 'VERSION_CONFLICT');
      }
      const finalProduct = await db.catalogProduct.findUnique({
        where: { id: targetId },
        include: {
          currentDraftRevision: true,
        },
      });
      assert.equal(finalProduct?.version, targetBeforeRace.version + 1);
      assert.equal(
        await db.catalogProductRevision.count({
          where: { productId: targetId },
        }),
        targetRevisionCountBefore + 1,
      );
      assert.equal(
        finalProduct?.currentDraftRevision?.displayName,
        patchWon ? 'Конкурентное изменение CX' : 'Контактор CX',
      );
      const racedRow = await db.catalogImportRow.findUnique({
        where: { id: conflictRow.id },
      });
      assert.equal(racedRow?.candidateState, patchWon ? 'CONFLICT' : 'APPLIED');
      const racingDecision = await db.catalogImportDecision.findFirst({
        where: {
          rowId: conflictRow.id,
          action: 'ACCEPT_REVISION',
        },
        orderBy: { createdAt: 'desc' },
      });
      assert.equal(racingDecision?.outcome, patchWon ? 'CONFLICT' : 'APPLIED');
      assert(racingDecision);
      const racingAudit = await db.auditEvent.findUnique({
        where: { id: racingDecision.auditEventId },
      });
      assert.equal(racingAudit?.outcome, patchWon ? 'DENIED' : 'SUCCESS');
      assert.equal(
        racingAudit?.reasonCode,
        patchWon ? 'IMPORT_ROW_CONFLICT' : 'APPLIED',
      );
      assert.equal(
        await db.auditEvent.count({
          where: {
            action: 'catalog.product.revision.created',
            entityId: targetId,
            outcome: 'SUCCESS',
          },
        }),
        1,
      );
    },
    120_000,
  );

  it.skipIf(!runtimeEnabled)(
    'replays a private upload idempotently and does not return file storage metadata',
    async () => {
      const agent = admin.agent;
      const key = randomUUID();
      const upload = async () => {
        const form = new FormData();
        form.set(
          'file',
          new Blob(['Name;Part\nPrivate row;P-901\n'], { type: 'text/csv' }),
          'retry.csv',
        );
        form.set('csvEncoding', 'UTF-8');
        form.set('csvDelimiter', ';');
        return agent.write('POST', '/v1/staff/catalog/imports', form, {
          'Idempotency-Key': key,
        });
      };
      const first = await upload();
      const replay = await upload();
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(replay.status, 201, JSON.stringify(replay.body));
      assert.equal(
        data<{ id: string }>(first).id,
        data<{ id: string }>(replay).id,
      );
      const imported = await db.catalogImportRun.findUnique({
        where: { id: data<{ id: string }>(first).id },
        include: { sourceFileVersion: true },
      });
      assert(imported);
      assert.equal(imported.sourceFileVersion.safetyState, 'UNCHECKED');
      assert(
        !JSON.stringify(first.body).includes(
          imported.sourceFileVersion.storageKey,
        ),
      );
      assert(
        !JSON.stringify(first.body).includes(imported.sourceFileVersion.id),
      );
      assert.equal(
        await db.catalogImportRow.count({
          where: { importRunId: imported.id },
        }),
        2,
      );
    },
    30_000,
  );

  it.skipIf(!runtimeEnabled)(
    'keeps source visibility private when run creation races an owner-level visibility update',
    async () => {
      const fileObjectId = randomUUID();
      const fileVersionId = randomUUID();
      const importRunId = randomUUID();
      const idempotencyKey = randomUUID();
      await ownerDb.fileObject.create({
        data: {
          id: fileObjectId,
          ownerStaffUserId: admin.id,
          displayName: 'visibility-race.csv',
          visibility: 'PRIVATE',
          state: 'ACTIVE',
          version: 1,
        },
      });
      await ownerDb.fileVersion.create({
        data: {
          id: fileVersionId,
          fileObjectId,
          number: 1,
          storageKey: randomBytes(32).toString('hex'),
          sha256: randomBytes(32),
          sizeBytes: 1n,
          mimeType: 'text/csv',
          originalFilename: 'visibility-race.csv',
          safetyState: 'UNCHECKED',
          createdByUserId: admin.id,
        },
      });

      let resolveRelease!: () => void;
      const releaseRun = new Promise<void>((resolveWait) => {
        resolveRelease = resolveWait;
      });
      let signalRun!: () => void;
      const runCreated = new Promise<void>((resolveWait) => {
        signalRun = resolveWait;
      });
      let runPid = 0;
      const createRun = db.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::integer AS pid
        `;
        assert(backend);
        runPid = backend.pid;
        await tx.catalogImportRun.create({
          data: {
            id: importRunId,
            uploaderStaffUserId: admin.id,
            sourceFileObjectId: fileObjectId,
            sourceFileVersionId: fileVersionId,
            sourceFormat: 'CSV',
            sourceEncoding: 'UTF-8',
            sourceDelimiter: ';',
            state: 'SOURCE_READY',
            parserVersion: 'visibility-race',
            uploadIdempotencyKey: idempotencyKey,
            uploadRequestHash: randomBytes(32),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        signalRun();
        await releaseRun;
      });
      await runCreated;

      let signalUpdate!: () => void;
      const updateStarted = new Promise<void>((resolveWait) => {
        signalUpdate = resolveWait;
      });
      let updatePid = 0;
      const makePublic = ownerDb.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::integer AS pid
        `;
        assert(backend);
        updatePid = backend.pid;
        signalUpdate();
        await tx.fileObject.update({
          where: { id: fileObjectId },
          data: { visibility: 'PUBLIC' },
        });
      });
      await updateStarted;
      let blockerObservationError: unknown;
      try {
        await waitForDatabaseBlocker(runPid);
      } catch (error) {
        blockerObservationError = error;
      } finally {
        resolveRelease();
      }
      await createRun;
      if (blockerObservationError) {
        await makePublic.catch(() => undefined);
        throw blockerObservationError;
      }
      await assert.rejects(
        makePublic,
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes('IMPORT_SOURCE_FILE_MUST_REMAIN_PRIVATE'),
      );
      assert(updatePid > 0);
      assert.equal(
        (
          await ownerDb.fileObject.findUnique({
            where: { id: fileObjectId },
            select: { visibility: true },
          })
        )?.visibility,
        'PRIVATE',
      );
      assert(
        await ownerDb.catalogImportRun.findUnique({
          where: { id: importRunId },
        }),
      );
    },
    30_000,
  );

  it.skipIf(!runtimeEnabled)(
    'uses the real public file row when a runtime session shadows file_object in pg_temp',
    async () => {
      const fileObjectId = randomUUID();
      const fileVersionId = randomUUID();
      const importRunId = randomUUID();
      const idempotencyKey = randomUUID();
      await ownerDb.fileObject.create({
        data: {
          id: fileObjectId,
          ownerStaffUserId: admin.id,
          displayName: 'shadow-check.csv',
          visibility: 'INTERNAL',
          state: 'ACTIVE',
          version: 1,
        },
      });
      await ownerDb.fileVersion.create({
        data: {
          id: fileVersionId,
          fileObjectId,
          number: 1,
          storageKey: randomBytes(32).toString('hex'),
          sha256: randomBytes(32),
          sizeBytes: 1n,
          mimeType: 'text/csv',
          originalFilename: 'shadow-check.csv',
          safetyState: 'UNCHECKED',
          createdByUserId: admin.id,
        },
      });

      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$executeRaw`
            CREATE TEMP TABLE file_object AS
            SELECT id, owner_staff_user_id, 'PRIVATE'::text AS visibility
            FROM public.file_object WHERE id=${fileObjectId}::uuid
          `;
          await tx.catalogImportRun.create({
            data: {
              id: importRunId,
              uploaderStaffUserId: admin.id,
              sourceFileObjectId: fileObjectId,
              sourceFileVersionId: fileVersionId,
              sourceFormat: 'CSV',
              sourceEncoding: 'UTF-8',
              sourceDelimiter: ';',
              state: 'SOURCE_READY',
              parserVersion: 'shadow-test',
              uploadIdempotencyKey: idempotencyKey,
              uploadRequestHash: randomBytes(32),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes(
            'IMPORT_SOURCE_FILE_MUST_BE_PRIVATE_AND_OWNED',
          ),
      );
      assert.equal(
        await ownerDb.catalogImportRun.findUnique({
          where: { id: importRunId },
        }),
        null,
      );
    },
    30_000,
  );
});
