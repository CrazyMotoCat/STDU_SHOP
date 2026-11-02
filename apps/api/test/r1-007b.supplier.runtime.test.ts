import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import {
  createServer as createHttpServer,
  request as httpRequest,
  type Server as HttpServer,
} from 'node:http';
import https from 'node:https';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { generate as generateCertificate } from 'selfsigned';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../src/app.factory.js';
import { IdentityCrypto } from '../src/identity/crypto.js';
import type { StaffRequest } from '../src/identity/request.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';

type JsonRecord = Record<string, unknown>;
type ApiResult = { status: number; body: JsonRecord; headers: Headers };
type Actor = { id: string; email: string; password: string; agent: StaffAgent };
type Supplier = {
  id: string;
  version: number;
  revisionId: string;
};
type Offer = {
  id: string;
  version: number;
  currentRevisionId: string;
  currentMatchProposalId: string | null;
};
type Product = { id: string; version: number };

const runtimeEnabled = Boolean(
  process.env.MIGRATION_DATABASE_URL &&
  process.env.STAFF_DATABASE_URL &&
  process.env.REDIS_URL,
);
const repoRoot = resolve(process.cwd());
const webRoot = resolve(repoRoot, 'apps/web');
const require = createRequire(resolve(repoRoot, 'package.json'));
const nextBin = require.resolve('next/dist/bin/next', { paths: [webRoot] });
let origin = '';
const supplierPermissions = [
  'suppliers.read',
  'suppliers.write',
  'suppliers.offers.read',
  'suppliers.offers.write',
  'suppliers.matches.decide',
  'catalog.references.read',
  'catalog.products.read',
  'catalog.products.write',
  'catalog.products.submit',
  'catalog.products.publish',
  'catalog.products.archive',
  'catalog.categories.write',
  'catalog.brands.write',
  'catalog.attributes.write',
  'catalog.products.relations.write',
  'catalog.products.media.write',
  'catalog.products.documents.write',
  'audit.read',
];

class StaffAgent {
  readonly cookies = new Map<string, string>();
  baseUrl = '';

  remember(response: Response) {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const pair = cookie.split(';', 1)[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value || /max-age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    options: { csrf?: string; idempotencyKey?: string } = {},
  ): Promise<ApiResult> {
    const headers = new Headers({ Origin: origin, Accept: 'application/json' });
    if (this.cookies.size)
      headers.set(
        'Cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.csrf) headers.set('X-CSRF-Token', options.csrf);
    if (options.idempotencyKey)
      headers.set('Idempotency-Key', options.idempotencyKey);
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    this.remember(response);
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
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
    const result = await this.request('GET', '/v1/staff/auth/csrf');
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const token = (result.body.data as JsonRecord | undefined)?.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    return token as string;
  }

  async write(
    method: string,
    path: string,
    body: unknown,
    idempotencyKey = `supplier-test-${randomUUID()}`,
  ) {
    return this.request(method, path, body, {
      csrf: await this.csrf(),
      idempotencyKey,
    });
  }

  async writeAndDropHttp201(
    method: string,
    path: string,
    body: unknown,
    idempotencyKey: string,
  ) {
    const csrf = await this.csrf();
    const api = new URL(this.baseUrl);
    let droppedHttp201 = false;
    const proxy = createHttpServer((incoming, outgoing) => {
      const upstream = httpRequest(
        {
          hostname: api.hostname,
          port: Number(api.port),
          path: incoming.url,
          method: incoming.method,
          headers: { ...incoming.headers, host: api.host },
        },
        (response) => {
          if (response.statusCode === 201) {
            response.once('end', () => {
              droppedHttp201 = true;
              outgoing.destroy();
            });
            response.resume();
            return;
          }
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.once('error', () => outgoing.destroy());
      incoming.pipe(upstream);
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const address = proxy.address();
    if (!address || typeof address === 'string')
      throw new Error('Could not start the lost-response test proxy.');

    const originalBaseUrl = this.baseUrl;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      try {
        await this.request(method, path, body, { csrf, idempotencyKey });
      } catch (error) {
        if (droppedHttp201 && error instanceof TypeError) return;
        throw error;
      }
      throw new Error('The test proxy did not drop the HTTP 201 response.');
    } finally {
      this.baseUrl = originalBaseUrl;
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  }
  async login(email: string, password: string) {
    return this.request(
      'POST',
      '/v1/staff/auth/login',
      { email, password },
      { csrf: await this.csrf() },
    );
  }
}

let app: Awaited<ReturnType<typeof createApiApp>> | undefined;
let db: PrismaClient | undefined;
let migrationDb: PrismaClient | undefined;
let apiUrl = '';
let webPort = 0;
let proxyPort = 0;
let browser: Browser | undefined;
let nextProcess: ChildProcess | undefined;
let proxy: HttpServer | undefined;
let nextLogs = '';
let actor: Actor;
let readerWithoutSupplierRead: Actor;

function requiredUrl(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required for R1-007B runtime tests.`);
  return value;
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a JSON object.');
  return value as JsonRecord;
}

function payload(result: ApiResult) {
  return record(result.body.data);
}

async function listenPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Unable to allocate an API test port.');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function startStaffWeb() {
  nextProcess = spawn(
    process.execPath,
    [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: '/staff-api',
        NEXT_TELEMETRY_DISABLED: '1',
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

async function waitForStaffWeb() {
  const deadline = Date.now() + 90_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (nextProcess?.exitCode !== null && nextProcess?.exitCode !== undefined)
      throw new Error(`Owned Next dev server exited early: ${nextLogs}`);
    try {
      if ((await httpsGet(`${origin}/staff/suppliers`)) === 200) return;
      lastError = new Error('The HTTPS test proxy did not return HTTP 200.');
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Owned Next dev UI did not become ready: ${String(lastError)}\n${nextLogs}`,
  );
}

function startProxy(key: string, cert: string) {
  proxy = https.createServer({ key, cert }, (incoming, outgoing) => {
    const isApi = incoming.url?.startsWith('/staff-api/') ?? false;
    const targetPort = isApi ? Number(new URL(apiUrl).port) : webPort;
    const targetPath = isApi
      ? incoming.url!.slice('/staff-api'.length)
      : (incoming.url ?? '/');
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        method: incoming.method,
        path: targetPath,
        headers: {
          ...incoming.headers,
          host: `127.0.0.1:${targetPort}`,
          'x-forwarded-host': `127.0.0.1:${proxyPort}`,
          'x-forwarded-proto': 'https',
        },
      },
      (upstreamResponse) => {
        outgoing.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(outgoing);
      },
    );
    upstream.once('error', () => {
      if (!outgoing.headersSent)
        outgoing.writeHead(502, { 'content-type': 'text/plain' });
      outgoing.end('Disposable test proxy could not reach its owned service.');
    });
    incoming.pipe(upstream);
  });
  proxy.on('upgrade', (incoming, socket, head) => {
    const upstream = httpRequest({
      hostname: '127.0.0.1',
      port: webPort,
      method: 'GET',
      path: incoming.url,
      headers: incoming.headers,
    });
    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      for (const [name, value] of Object.entries(response.headers)) {
        const values = Array.isArray(value) ? value.join(', ') : value;
        if (values) socket.write(`${name}: ${values}\r\n`);
      }
      socket.write('\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.once('error', () => socket.destroy());
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

async function stopStaffWeb() {
  const child = nextProcess;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<boolean>((accept) =>
    child.once('close', () => accept(true)),
  );
  const killTree = async (force: boolean) => {
    if (!child.pid) throw new Error('Owned Next process has no PID.');
    if (process.platform === 'win32') {
      const killer = spawn(
        'taskkill',
        ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      );
      await new Promise<void>((accept, reject) => {
        killer.once('error', reject);
        killer.once('close', () => accept());
      });
      return;
    }
    try {
      process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };

  await killTree(false);
  if (await Promise.race([closed, delay(8_000).then(() => false)])) return;
  await killTree(true);
  if (!(await Promise.race([closed, delay(5_000).then(() => false)])))
    throw new Error(`Owned Next process tree did not stop.\n${nextLogs}`);
}

type BrowserCreateAttempt = {
  idempotencyKey: string | undefined;
  requestBody: string;
  origin: string;
  cookieNames: string[];
  hasCsrfHeader: boolean;
};
type BrowserDroppedCreate = BrowserCreateAttempt & {
  status: number;
  responseBody: JsonRecord;
};
type BrowserCreateObserver = {
  attempts: BrowserCreateAttempt[];
  dropNextCreate: boolean;
  resolveDropped(value: BrowserDroppedCreate): void;
  dropped: Promise<BrowserDroppedCreate>;
};

async function observeSupplierCreates(page: Page) {
  let resolveDropped!: (value: BrowserDroppedCreate) => void;
  const dropped = new Promise<BrowserDroppedCreate>((accept) => {
    resolveDropped = accept;
  });
  const observer: BrowserCreateObserver = {
    attempts: [],
    dropNextCreate: true,
    resolveDropped,
    dropped,
  };
  const supplierCreateUrl = /\/staff-api\/v1\/staff\/suppliers(?:\?.*)?$/;
  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    const headers = await request.allHeaders();
    const cookieHeader = headers.cookie ?? '';
    const attempt: BrowserCreateAttempt = {
      idempotencyKey: headers['idempotency-key'],
      requestBody: request.postData() ?? '',
      origin: headers.origin ?? '',
      cookieNames: cookieHeader
        .split(';')
        .map((cookie) => cookie.trim().split('=', 1)[0] ?? '')
        .filter(Boolean),
      hasCsrfHeader: typeof headers['x-csrf-token'] === 'string',
    };
    observer.attempts.push(attempt);
    if (!observer.dropNextCreate) {
      await route.continue();
      return;
    }

    const upstreamResponse = await route.fetch({ headers });
    const responseText = await upstreamResponse.text();
    let responseBody: JsonRecord;
    try {
      responseBody = record(responseText ? JSON.parse(responseText) : {});
    } catch {
      responseBody = {};
    }
    observer.dropNextCreate = false;
    await route.abort('connectionreset');
    observer.resolveDropped({
      ...attempt,
      status: upstreamResponse.status(),
      responseBody,
    });
  };
  await page.route(supplierCreateUrl, handler);
  return {
    get attempts() {
      return observer.attempts;
    },
    dropped,
    dispose: () => page.unroute(supplierCreateUrl, handler),
  };
}

async function browserLogin(page: Page, email: string, password: string) {
  const diagnostics: string[] = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.includes('/staff-api/'))
      diagnostics.push(`HTTP ${response.status()} ${path}`);
  });
  page.on('requestfailed', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/staff-api/'))
      diagnostics.push(
        `FAILED ${path}: ${request.failure()?.errorText ?? 'unknown'}`,
      );
  });
  page.on('pageerror', (error) =>
    diagnostics.push(`PAGE ${error.name}: ${error.message}`),
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      diagnostics.push(`CONSOLE ${message.text()}`);
  });
  const profile = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/staff-api/v1/staff/auth/me',
    { timeout: 20_000 },
  );
  await page.goto(`${origin}/staff/suppliers`, {
    waitUntil: 'domcontentloaded',
  });
  const profileResponse = await profile;
  expect([200, 401]).toContain(profileResponse.status());
  await page
    .getByRole('heading', { name: 'Рабочее пространство поставщиков' })
    .waitFor();
  await page.getByLabel('Рабочая почта').fill(email);
  await page.getByLabel('Пароль').fill(password);
  const login = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/staff-api/v1/staff/auth/login',
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: 'Войти' }).click();
  let response;
  try {
    response = await login;
  } catch (error) {
    throw new Error(
      `Staff login did not reach its POST. URL: ${page.url()}; alert: ${(await page.getByRole('alert').allTextContents()).join(' | ') || 'none'}; browser: ${diagnostics.join(' || ')}; next: ${nextLogs}`,
      { cause: error },
    );
  }
  expect(response.status()).toBe(200);
  await page.getByRole('heading', { name: 'Поставщики' }).waitFor();
  return diagnostics;
}

async function openStaffBrowserPage() {
  if (!nextProcess) {
    const certificate = await generateCertificate(
      [{ name: 'commonName', value: '127.0.0.1' }],
      {
        algorithm: 'sha256',
        extensions: [
          { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
        ],
      },
    );
    startProxy(certificate.private, certificate.cert);
    await new Promise<void>((accept, reject) => {
      proxy!.once('error', reject);
      proxy!.listen(proxyPort, '127.0.0.1', accept);
    });
    startStaffWeb();
    await waitForStaffWeb();
  }
  browser ??= await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  return { context, page: await context.newPage() };
}

async function browserStorage(page: Page) {
  return page.evaluate(() => {
    const snapshot = (storage: Storage) =>
      Object.fromEntries(
        Array.from({ length: storage.length }, (_, index) => {
          const key = storage.key(index);
          return key ? [key, storage.getItem(key)] : ['', null];
        }).filter(([key]) => key),
      );
    return {
      local: snapshot(window.localStorage),
      session: snapshot(window.sessionStorage),
    };
  });
}

async function startApi() {
  app = await createApiApp();
  app.useLogger(false);
  await app.listen(await listenPort(), '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string')
    throw new Error('Supplier API listener did not bind a TCP port.');
  apiUrl = `http://127.0.0.1:${address.port}`;
}

async function restartApi() {
  await app?.close();
  await startApi();
}

async function makeActor(permissions: string[], label: string): Promise<Actor> {
  const id = randomUUID();
  const roleId = randomUUID();
  const email = `r1-007b-${label}-${randomUUID().slice(0, 8)}@example.invalid`;
  const password = `R1-007B disposable ${randomBytes(24).toString('base64url')}!`;
  const passwordHash = await new IdentityCrypto().hashPassword(password, email);
  await db!.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        id: roleId,
        code: `r1-007b-${label}-${randomUUID().slice(0, 8)}`,
        name: `R1-007B ${label}`,
        state: 'ACTIVE',
      },
    });
    const registered = await tx.permission.findMany({
      where: { code: { in: permissions } },
      select: { id: true, code: true },
    });
    expect(registered.map(({ code }) => code).sort()).toEqual(
      [...permissions].sort(),
    );
    await tx.rolePermission.createMany({
      data: registered.map(({ id: permissionId }) => ({
        roleId: role.id,
        permissionId,
      })),
    });
    await tx.staffUser.create({
      data: {
        id,
        email,
        emailNormalized: email.toLowerCase(),
        displayName: `R1-007B ${label}`,
        passwordHash,
        passwordChangeRequired: false,
        state: 'ACTIVE',
      },
    });
    await tx.userRole.create({ data: { staffUserId: id, roleId: role.id } });
  });
  const agent = new StaffAgent();
  agent.baseUrl = apiUrl;
  const login = await agent.login(email, password);
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return { id, email, password, agent };
}

async function makeCategoryAndBrand() {
  const slug = `supplier-${randomUUID().slice(0, 8)}`.toLowerCase();
  const categoryResult = await actor.agent.write(
    'POST',
    '/v1/staff/catalog/categories',
    { slug, name: `Supplier runtime ${slug}` },
  );
  expect(categoryResult.status, JSON.stringify(categoryResult.body)).toBe(201);
  const brandResult = await actor.agent.write(
    'POST',
    '/v1/staff/catalog/brands',
    { slug: `${slug}-brand`, name: `Supplier runtime ${slug} brand` },
  );
  expect(brandResult.status, JSON.stringify(brandResult.body)).toBe(201);
  return {
    categoryId: String(payload(categoryResult).id),
    brandId: String(payload(brandResult).id),
  };
}

async function makeProduct(
  categoryId: string,
  brandId: string,
  suffix: string,
) {
  const productResult = await actor.agent.write(
    'POST',
    '/v1/staff/catalog/products',
    {
      slug: `supplier-${suffix}-${randomUUID().slice(0, 8)}`.toLowerCase(),
      categoryId,
      brandId,
      displayName: `Supplier runtime ${suffix}`,
      manufacturerName: 'Northwind Devices',
      originalPartNumber: `NW-${suffix}`,
      modification: null,
    },
  );
  expect(productResult.status, JSON.stringify(productResult.body)).toBe(201);
  const product = payload(productResult);
  return { id: String(product.id), version: Number(product.version) };
}

async function makeSupplier(name: string, taxIdentifier?: string) {
  const response = await actor.agent.write('POST', '/v1/staff/suppliers', {
    legalName: name,
    ...(taxIdentifier ? { taxIdentifier, taxJurisdiction: 'RU' } : {}),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return payload(response) as unknown as Supplier;
}

function validRussianInn10() {
  const first = String(randomInt(1, 10));
  const base = first + String(randomInt(0, 100_000_000)).padStart(8, '0');
  const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const checksum =
    ([...base].reduce(
      (sum, digit, index) => sum + Number(digit) * weights[index]!,
      0,
    ) %
      11) %
    10;
  return `${base}${checksum}`;
}

async function makeOffer(
  supplierId: string,
  brandId: string,
  partNumber: string,
  purchaseCost = '123.45',
  currency = 'RUB',
) {
  const response = await actor.agent.write(
    'POST',
    '/v1/staff/supplier-offers',
    {
      supplierId,
      brandId,
      manufacturerName: 'Northwind Devices',
      originalPartNumber: partNumber,
      modification: null,
      modificationEvidence: 'CONFIRMED_NONE',
      purchaseCost,
      currency,
      sourceObservedAt: new Date().toISOString(),
    },
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const created = payload(response);
  return {
    ...(created as unknown as Offer),
    currentRevisionId: String(created.revisionId),
  };
}

async function propose(offer: Offer, product: Product, key?: string) {
  return actor.agent.write(
    'POST',
    `/v1/staff/supplier-offers/${offer.id}/match-proposals`,
    {
      productId: product.id,
      expectedOfferVersion: offer.version,
      expectedProductVersion: product.version,
    },
    key,
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function holdRowLock(table: 'brand' | 'supplier', id: string) {
  const acquired = deferred<number>();
  const release = deferred<void>();
  const done = migrationDb!.$transaction(async (tx) => {
    const sessions = await tx.$queryRaw<{ pid: number }[]>`
      SELECT pg_backend_pid()::int AS pid
    `;
    const pid = sessions[0]?.pid;
    if (!pid) throw new Error('Unable to identify the PostgreSQL lock holder.');
    if (table === 'brand')
      await tx.$queryRaw`SELECT id FROM brand WHERE id = ${id}::uuid FOR UPDATE`;
    else
      await tx.$queryRaw`SELECT id FROM supplier WHERE id = ${id}::uuid FOR UPDATE`;
    acquired.resolve(pid);
    await release.promise;
  });
  const pid = await acquired.promise;
  return { pid, done, release: () => release.resolve() };
}

async function waitForBlockedQueries(
  sqlFragment: string,
  blockerPid: number,
  expectedCount = 1,
) {
  let blockingSessions: { pid: number; query: string; blockers: number[] }[] =
    [];
  for (let attempt = 0; attempt < 120; attempt += 1) {
    blockingSessions = await migrationDb!.$queryRaw<
      { pid: number; query: string; blockers: number[] }[]
    >`
      SELECT pid::int, query, pg_blocking_pids(pid)::int[] AS blockers
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND wait_event_type = 'Lock'
    `;
    const blocked = blockingSessions.filter(({ query }) =>
      query.toLowerCase().includes(sqlFragment.toLowerCase()),
    );
    if (blocked.length >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for ${expectedCount} PostgreSQL statements matching ${sqlFragment} to block on backend ${blockerPid}. Blocking sessions: ${JSON.stringify(blockingSessions)}`,
  );
}

describe.skipIf(!runtimeEnabled)('R1-007B disposable PostgreSQL + HTTP', () => {
  beforeAll(async () => {
    webPort = await listenPort();
    proxyPort = await listenPort();
    origin = `https://127.0.0.1:${proxyPort}`;
    process.env.APP_ENV = 'production';
    process.env.HOST = '127.0.0.1';
    process.env.PORT = '3001';
    process.env.COOKIE_PROFILE = 'https';
    process.env.STAFF_ORIGINS = origin;
    process.env.PUBLIC_WEB_ORIGIN = origin;
    process.env.TRUSTED_PROXY_ADDRESS = '127.0.0.1';
    process.env.STAFF_DATABASE_URL = requiredUrl('STAFF_DATABASE_URL');
    process.env.REDIS_URL = requiredUrl('REDIS_URL');
    process.env.SESSION_HMAC_KEY = randomBytes(32).toString('hex');
    process.env.RATE_LIMIT_KEY = randomBytes(32).toString('hex');

    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: requiredUrl('STAFF_DATABASE_URL'),
      }),
    });
    migrationDb = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
      }),
    });
    await db.$connect();
    await migrationDb.$connect();
    await startApi();
    actor = await makeActor(supplierPermissions, 'full');
    readerWithoutSupplierRead = await makeActor(
      ['suppliers.offers.read'],
      'missing-supplier-read',
    );
  }, 120_000);

  afterAll(async () => {
    await browser?.close().catch(() => undefined);
    await stopStaffWeb();
    if (proxy?.listening)
      await new Promise<void>((accept, reject) =>
        proxy!.close((error) => (error ? reject(error) : accept())),
      );
    await app?.close();
    await db?.$disconnect();
    await migrationDb?.$disconnect();
  });

  it('SUP-01/02/03: lost create response replays one durable supplier operation', async () => {
    const key = `tax-retry-${randomUUID()}`;
    const createBody = {
      legalName: '  Northwind Trading  ',
      taxIdentifier: '7707083893',
      taxJurisdiction: 'RU',
    };
    await expect(
      actor.agent.writeAndDropHttp201(
        'POST',
        '/v1/staff/suppliers',
        createBody,
        key,
      ),
    ).resolves.toBeUndefined();

    const committed = await db!.supplier.findFirstOrThrow({
      where: {
        taxIdentifier: createBody.taxIdentifier,
        taxJurisdiction: createBody.taxJurisdiction,
      },
      select: { id: true },
    });
    expect(
      await db!.supplier.count({
        where: {
          taxIdentifier: createBody.taxIdentifier,
          taxJurisdiction: createBody.taxJurisdiction,
        },
      }),
    ).toBe(1);

    await restartApi();
    actor.agent.baseUrl = apiUrl;
    readerWithoutSupplierRead.agent.baseUrl = apiUrl;

    const offerBeforeSupplierArchive = await actor.agent.write(
      'POST',
      '/v1/staff/supplier-offers',
      {
        supplierId: committed.id,
        brandId: null,
        manufacturerName: null,
        originalPartNumber: null,
        modification: null,
        modificationEvidence: 'UNKNOWN',
      },
    );
    expect(offerBeforeSupplierArchive.status).toBe(201);

    const replay = await actor.agent.write(
      'POST',
      '/v1/staff/suppliers',
      createBody,
      key,
    );
    expect(replay.status).toBe(201);
    const supplier = payload(replay) as unknown as Supplier;
    expect(supplier.id).toBe(committed.id);
    const profile = await actor.agent.request(
      'GET',
      `/v1/staff/suppliers/${supplier.id}`,
    );
    expect(profile.status).toBe(200);
    expect(payload(profile).legalName).toBe('Northwind Trading');
    expect(await db!.supplier.count({ where: { id: supplier.id } })).toBe(1);
    expect(
      await db!.supplierRevision.count({ where: { supplierId: supplier.id } }),
    ).toBe(1);
    expect(
      await db!.supplierCommandIdempotency.count({
        where: {
          actorStaffUserId: actor.id,
          scope: 'R1-007',
          idempotencyKey: key,
        },
      }),
    ).toBe(1);
    expect(
      await db!.auditEvent.count({
        where: { action: 'supplier.created', entityId: supplier.id },
      }),
    ).toBe(1);
    expect(
      await db!.supplierOffer.count({ where: { supplierId: supplier.id } }),
    ).toBe(1);
    const createdUpdatedAt = new Date(
      String(payload(profile).updatedAt),
    ).getTime();
    const reused = await actor.agent.write(
      'POST',
      '/v1/staff/suppliers',
      { ...createBody, legalName: 'Different name' },
      key,
    );
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const updateKey = `supplier-update-${randomUUID()}`;
    const conflict = await actor.agent.write(
      'PATCH',
      `/v1/staff/suppliers/${supplier.id}`,
      { ...createBody, expectedVersion: 99 },
      updateKey,
    );
    expect(conflict.status).toBe(409);
    const conflictReplay = await actor.agent.write(
      'PATCH',
      `/v1/staff/suppliers/${supplier.id}`,
      { ...createBody, expectedVersion: 99 },
      updateKey,
    );
    expect(conflictReplay).toMatchObject({
      status: conflict.status,
      body: conflict.body,
    });
    expect(
      await db!.supplierRevision.count({ where: { supplierId: supplier.id } }),
    ).toBe(1);

    await db!
      .$queryRaw`SELECT clock_timestamp() AS completed_at FROM pg_sleep(0.01)`;
    const archived = await actor.agent.write(
      'POST',
      `/v1/staff/suppliers/${supplier.id}/archive`,
      { expectedVersion: 1, reasonCode: 'DUPLICATE_ENTRY' },
    );
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const archivedProfile = await actor.agent.request(
      'GET',
      `/v1/staff/suppliers/${supplier.id}`,
    );
    expect(archivedProfile.status).toBe(200);
    expect(
      new Date(String(payload(archivedProfile).updatedAt)).getTime(),
    ).toBeGreaterThan(createdUpdatedAt);
    const offerForArchivedSupplier = await actor.agent.write(
      'POST',
      '/v1/staff/supplier-offers',
      {
        supplierId: supplier.id,
        brandId: null,
        manufacturerName: null,
        originalPartNumber: null,
        modification: null,
        modificationEvidence: 'UNKNOWN',
      },
    );
    expect(offerForArchivedSupplier.status).toBe(404);
    const reviseArchivedSupplierOffer = await actor.agent.write(
      'PATCH',
      `/v1/staff/supplier-offers/${String(payload(offerBeforeSupplierArchive).id)}`,
      {
        expectedVersion: 1,
        brandId: null,
        manufacturerName: null,
        originalPartNumber: null,
        modification: null,
        modificationEvidence: 'UNKNOWN',
      },
    );
    expect(reviseArchivedSupplierOffer.status).toBe(409);
    const replacement = await makeSupplier(
      'Northwind Trading Recreated',
      '7707083893',
    );
    expect(replacement.id).not.toBe(supplier.id);
    const invalidInn = await actor.agent.write('POST', '/v1/staff/suppliers', {
      legalName: 'Invalid Russian Tax Identity',
      taxIdentifier: '7707083894',
      taxJurisdiction: 'RU',
    });
    expect(invalidInn.status).toBe(400);
  });

  it('Q0-01 browser: a dropped committed create keeps identity across double-click, logout/login, and reload', async () => {
    const { context, page } = await openStaffBrowserPage();
    const observed = await observeSupplierCreates(page);
    const legalName = `Browser retry ${randomUUID()}`;
    const shortName = `browser-${randomUUID().slice(0, 8)}`;
    const taxIdentifier = validRussianInn10();
    const expectedBody = {
      legalName,
      shortName,
      taxIdentifier,
      taxJurisdiction: 'RU',
    };

    try {
      const browserDiagnostics = await browserLogin(
        page,
        actor.email,
        actor.password,
      );
      await page.getByLabel('Юридическое или торговое имя').fill(legalName);
      await page.getByLabel('Короткое имя').fill(shortName);
      await page.getByLabel('Налоговый идентификатор').fill(taxIdentifier);
      const failedCreate = page.waitForEvent(
        'requestfailed',
        (request) =>
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/staff-api/v1/staff/suppliers',
      );

      await page
        .getByRole('button', { name: 'Создать поставщика' })
        .evaluate((button: HTMLButtonElement) => {
          button.click();
          button.click();
        });

      const dropped = await observed.dropped;
      expect((await failedCreate).failure()?.errorText).toBeTruthy();
      expect(
        dropped.status,
        JSON.stringify({
          responseBody: dropped.responseBody,
          origin: dropped.origin,
          cookieNames: dropped.cookieNames,
          hasCsrfHeader: dropped.hasCsrfHeader,
        }),
      ).toBe(201);
      expect(dropped.origin).toBe(origin);
      expect(dropped.cookieNames).toContain('__Host-stdu_staff');
      expect(dropped.hasCsrfHeader).toBe(true);
      const committedResponse = record(dropped.responseBody.data);
      const supplierId = String(committedResponse.id);
      expect(supplierId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(observed.attempts).toHaveLength(1);
      const originalAttempt = observed.attempts[0]!;
      expect(originalAttempt.idempotencyKey).toMatch(/^staff-[0-9a-f-]{36}$/i);
      expect(JSON.parse(originalAttempt.requestBody)).toEqual(expectedBody);

      const alert = page.locator('p[role="alert"]');
      await alert.waitFor({ state: 'visible' });
      expect(
        await alert.textContent(),
        JSON.stringify({
          url: page.url(),
          browserDiagnostics,
          buttons: await page.getByRole('button').allTextContents(),
        }),
      ).toContain('Результат создания не подтверждён');
      const storageAfterDrop = await browserStorage(page);
      const serializedStorage = JSON.stringify(storageAfterDrop);
      expect(serializedStorage).not.toContain(legalName);
      expect(serializedStorage).not.toContain(shortName);
      expect(serializedStorage).not.toContain(taxIdentifier);
      expect(serializedStorage).not.toContain(actor.password);
      const storedAttempt = Object.entries(storageAfterDrop.session).find(
        ([key]) => key.startsWith('stdu.staff.suppliers.create.v1:'),
      );
      expect(storedAttempt).toBeDefined();
      const attemptState = JSON.parse(String(storedAttempt?.[1])) as JsonRecord;
      expect(attemptState.idempotencyKey).toBe(originalAttempt.idempotencyKey);
      expect(attemptState.bodyHash).toMatch(/^[a-f0-9]{64}$/);

      const committed = await db!.supplier.findUniqueOrThrow({
        where: { id: supplierId },
      });
      expect(committed.legalName).toBe(legalName);
      expect(await db!.supplierRevision.count({ where: { supplierId } })).toBe(
        1,
      );
      await page
        .waitForFunction(
          () => {
            const button = Array.from(document.querySelectorAll('button')).find(
              (candidate) => candidate.textContent?.trim() === 'Выйти',
            );
            return Boolean(button && !button.disabled);
          },
          undefined,
          { timeout: 1_000 },
        )
        .catch(async (error: unknown) => {
          throw new Error(
            JSON.stringify({
              url: page.url(),
              alert: await page.locator('p[role="alert"]').textContent(),
              logoutDisabled: await page
                .getByRole('button', { name: 'Выйти' })
                .isDisabled(),
              browserDiagnostics,
            }),
            { cause: error },
          );
        });

      const logoutResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith('/v1/staff/auth/logout'),
        { timeout: 20_000 },
      );
      await page.getByRole('button', { name: 'Выйти' }).click();
      expect((await logoutResponse).status()).toBe(200);
      await browserLogin(page, actor.email, actor.password);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Поставщики' }).waitFor();
      expect(await page.locator('input[name="legalName"]').inputValue()).toBe(
        '',
      );
      const storageAfterReload = await browserStorage(page);
      expect(JSON.stringify(storageAfterReload)).not.toContain(legalName);
      expect(JSON.stringify(storageAfterReload)).not.toContain(taxIdentifier);
      expect(JSON.stringify(storageAfterReload.session)).toContain(
        originalAttempt.idempotencyKey,
      );

      await page.getByLabel('Юридическое или торговое имя').fill(legalName);
      await page.getByLabel('Короткое имя').fill(shortName);
      await page.getByLabel('Налоговый идентификатор').fill(taxIdentifier);
      await page.getByRole('button', { name: 'Создать поставщика' }).click();
      await page
        .getByRole('heading', { name: 'Карточка поставщика' })
        .waitFor();
      await page.getByRole('heading', { name: legalName, level: 2 }).waitFor();

      expect(observed.attempts).toHaveLength(2);
      expect(observed.attempts[1]!.idempotencyKey).toBe(
        originalAttempt.idempotencyKey,
      );
      expect(observed.attempts[1]!.requestBody).toBe(
        originalAttempt.requestBody,
      );
      expect(new URL(page.url()).pathname).toBe(
        `/staff/suppliers/${supplierId}`,
      );
      expect(await db!.supplier.count({ where: { legalName } })).toBe(1);
      expect(await db!.supplierRevision.count({ where: { supplierId } })).toBe(
        1,
      );
      expect(
        await db!.supplierCommandIdempotency.count({
          where: {
            actorStaffUserId: actor.id,
            scope: 'R1-007',
            idempotencyKey: originalAttempt.idempotencyKey,
          },
        }),
      ).toBe(1);
      expect(
        await db!.auditEvent.count({
          where: { action: 'supplier.created', entityId: supplierId },
        }),
      ).toBe(1);
      const storageAfterSuccess = await browserStorage(page);
      expect(
        Object.keys(storageAfterSuccess.session).some((key) =>
          key.startsWith('stdu.staff.suppliers.create.v1:'),
        ),
      ).toBe(false);
    } finally {
      await observed.dispose();
      await context.close();
    }
  }, 120_000);

  it('Q0-01 browser: changed supplier data requires cancel or explicit new-operation confirmation', async () => {
    const { context, page } = await openStaffBrowserPage();
    const observed = await observeSupplierCreates(page);
    const originalName = `Browser changed original ${randomUUID()}`;
    const changedName = `Browser changed confirmed ${randomUUID()}`;
    const originalTaxIdentifier = validRussianInn10();
    const changedTaxIdentifier = validRussianInn10();

    try {
      const browserDiagnostics = await browserLogin(
        page,
        actor.email,
        actor.password,
      );
      await page.getByLabel('Юридическое или торговое имя').fill(originalName);
      await page
        .getByLabel('Налоговый идентификатор')
        .fill(originalTaxIdentifier);
      const failedCreate = page.waitForEvent(
        'requestfailed',
        (request) =>
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/staff-api/v1/staff/suppliers',
      );
      await page.getByRole('button', { name: 'Создать поставщика' }).click();
      const dropped = await observed.dropped;
      expect((await failedCreate).failure()?.errorText).toBeTruthy();
      expect(
        dropped.status,
        JSON.stringify({
          responseBody: dropped.responseBody,
          origin: dropped.origin,
          cookieNames: dropped.cookieNames,
          hasCsrfHeader: dropped.hasCsrfHeader,
        }),
      ).toBe(201);
      expect(dropped.origin).toBe(origin);
      expect(dropped.cookieNames).toContain('__Host-stdu_staff');
      expect(dropped.hasCsrfHeader).toBe(true);
      const originalData = record(dropped.responseBody.data);
      const originalSupplierId = String(originalData.id);
      await page
        .waitForFunction(
          () =>
            document
              .querySelector('[role="alert"]')
              ?.textContent?.includes('Результат создания не подтверждён'),
          undefined,
          { timeout: 3_000 },
        )
        .catch(async (error: unknown) => {
          throw new Error(
            JSON.stringify({
              url: page.url(),
              alerts: await page.getByRole('alert').allTextContents(),
              buttons: await page.getByRole('button').allTextContents(),
              browserDiagnostics,
            }),
            { cause: error },
          );
        });
      expect(await page.locator('p[role="alert"]').textContent()).toContain(
        'Результат создания не подтверждён',
      );
      await page
        .waitForFunction(
          () => {
            const button = Array.from(document.querySelectorAll('button')).find(
              (candidate) =>
                candidate.textContent?.trim() === 'Создать поставщика',
            );
            return Boolean(button && !button.disabled);
          },
          undefined,
          { timeout: 1_000 },
        )
        .catch(async (error: unknown) => {
          throw new Error(
            JSON.stringify({
              url: page.url(),
              alert: await page.locator('p[role="alert"]').textContent(),
              createDisabled: await page
                .getByRole('button', { name: 'Создать поставщика' })
                .isDisabled(),
              browserDiagnostics,
            }),
            { cause: error },
          );
        });

      await page.getByLabel('Юридическое или торговое имя').fill(changedName);
      await page
        .getByLabel('Налоговый идентификатор')
        .fill(changedTaxIdentifier);
      const cancelDialog = page.waitForEvent('dialog');
      const cancelClick = page
        .getByRole('button', { name: 'Создать поставщика' })
        .click();
      const canceled = await cancelDialog;
      expect(canceled.type()).toBe('confirm');
      await canceled.dismiss();
      await cancelClick;
      expect(await page.locator('p[role="alert"]').textContent()).toContain(
        'Изменённые данные не отправлены',
      );
      expect(observed.attempts).toHaveLength(1);
      const originalKey = observed.attempts[0]!.idempotencyKey;
      expect(originalKey).toBeDefined();
      expect(JSON.stringify(await browserStorage(page))).toContain(originalKey);

      await page.waitForFunction(() => {
        const button = Array.from(document.querySelectorAll('button')).find(
          (candidate) => candidate.textContent?.trim() === 'Создать поставщика',
        );
        return Boolean(button && !button.disabled);
      });
      const confirmDialog = page.waitForEvent('dialog');
      const confirmClick = page
        .getByRole('button', { name: 'Создать поставщика' })
        .click();
      const confirmed = await confirmDialog;
      expect(confirmed.type()).toBe('confirm');
      await confirmed.accept();
      await confirmClick;
      await page
        .getByRole('heading', { name: 'Карточка поставщика' })
        .waitFor();
      await page
        .getByRole('heading', { name: changedName, level: 2 })
        .waitFor();

      expect(observed.attempts).toHaveLength(2);
      const replacementAttempt = observed.attempts[1]!;
      expect(replacementAttempt.idempotencyKey).toMatch(
        /^staff-[0-9a-f-]{36}$/i,
      );
      expect(replacementAttempt.idempotencyKey).not.toBe(originalKey);
      expect(JSON.parse(replacementAttempt.requestBody)).toMatchObject({
        legalName: changedName,
      });
      expect(
        await db!.supplier.count({ where: { id: originalSupplierId } }),
      ).toBe(1);
      const confirmedSupplier = await db!.supplier.findFirstOrThrow({
        where: { legalName: changedName },
        select: { id: true },
      });
      expect(
        await db!.supplier.count({
          where: { legalName: { in: [originalName, changedName] } },
        }),
      ).toBe(2);
      for (const [supplierId, idempotencyKey] of [
        [originalSupplierId, originalKey],
        [confirmedSupplier.id, replacementAttempt.idempotencyKey],
      ] as const) {
        expect(
          await db!.supplierRevision.count({ where: { supplierId } }),
        ).toBe(1);
        expect(
          await db!.supplierCommandIdempotency.count({
            where: {
              actorStaffUserId: actor.id,
              scope: 'R1-007',
              idempotencyKey,
            },
          }),
        ).toBe(1);
        expect(
          await db!.auditEvent.count({
            where: { action: 'supplier.created', entityId: supplierId },
          }),
        ).toBe(1);
      }
      expect(
        Object.keys((await browserStorage(page)).session).some((key) =>
          key.startsWith('stdu.staff.suppliers.create.v1:'),
        ),
      ).toBe(false);
    } finally {
      await observed.dispose();
      await context.close();
    }
  }, 120_000);

  it('SUP-03: concurrent same-key create requests replay one supplier and audit event', async () => {
    const key = `supplier-double-submit-${randomUUID()}`;
    const createBody = { legalName: `Concurrent same key ${randomUUID()}` };
    const [first, second] = await Promise.all([
      actor.agent.write('POST', '/v1/staff/suppliers', createBody, key),
      actor.agent.write('POST', '/v1/staff/suppliers', createBody, key),
    ]);
    expect(first.status).toBe(201);
    expect(second).toMatchObject({ status: 201, body: first.body });
    const supplier = payload(first) as unknown as Supplier;
    expect(await db!.supplier.count({ where: { id: supplier.id } })).toBe(1);
    expect(
      await db!.supplierRevision.count({ where: { supplierId: supplier.id } }),
    ).toBe(1);
    expect(
      await db!.supplierCommandIdempotency.count({
        where: {
          actorStaffUserId: actor.id,
          scope: 'R1-007',
          idempotencyKey: key,
        },
      }),
    ).toBe(1);
    expect(
      await db!.auditEvent.count({
        where: { action: 'supplier.created', entityId: supplier.id },
      }),
    ).toBe(1);
  });

  it('SUP-01/02: concurrent duplicate tax identity registration serializes to one active supplier', async () => {
    const taxIdentifier = validRussianInn10();
    const attempts = await Promise.all(
      ['one', 'two'].map((label) =>
        actor.agent.write(
          'POST',
          '/v1/staff/suppliers',
          {
            legalName: `Concurrent ${label} ${randomUUID()}`,
            taxIdentifier,
            taxJurisdiction: 'RU',
          },
          `tax-race-${label}-${randomUUID()}`,
        ),
      ),
    );
    expect(attempts.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(
      await db!.supplier.count({
        where: {
          state: 'ACTIVE',
          taxIdentifier,
          taxJurisdiction: 'RU',
        },
      }),
    ).toBe(1);
  });

  it('SUP-01: rejects unassigned ISO jurisdictions and currencies at HTTP and database boundaries', async () => {
    const badJurisdiction = await actor.agent.write(
      'POST',
      '/v1/staff/suppliers',
      {
        legalName: 'Invalid ISO Jurisdiction',
        taxIdentifier: 'AB-123',
        taxJurisdiction: 'ZZ',
      },
    );
    expect(badJurisdiction.status).toBe(400);

    const badCurrency = await actor.agent.write(
      'POST',
      '/v1/staff/supplier-offers',
      {
        supplierId: (await makeSupplier('Invalid ISO Currency')).id,
        brandId: null,
        manufacturerName: null,
        originalPartNumber: null,
        modification: null,
        modificationEvidence: 'UNKNOWN',
        purchaseCost: '12.5',
        currency: 'ZZZ',
      },
    );
    expect(badCurrency.status).toBe(400);
    expect(
      await migrationDb!.$queryRaw<[{ valid: boolean }]>`
        SELECT supplier_iso_3166_alpha2_valid('ZZ') AS valid
      `,
    ).toEqual([{ valid: false }]);
    expect(
      await migrationDb!.$queryRaw<[{ valid: boolean }]>`
        SELECT supplier_iso_4217_currency_valid('ZZZ') AS valid
      `,
    ).toEqual([{ valid: false }]);
    expect(
      await migrationDb!.$queryRaw<[{ valid: boolean }]>`
        SELECT supplier_iso_3166_alpha2_valid('AX') AS valid
      `,
    ).toEqual([{ valid: true }]);
    expect(
      await migrationDb!.$queryRaw<[{ valid: boolean }]>`
        SELECT supplier_iso_4217_currency_valid('USD') AS valid
      `,
    ).toEqual([{ valid: true }]);
    const supplier = await makeSupplier('Database ISO Constraint');
    await expect(
      migrationDb!.$executeRaw`
        UPDATE supplier
        SET tax_identifier = 'AB-123', tax_jurisdiction = 'ZZ'
        WHERE id = ${supplier.id}::uuid
      `,
    ).rejects.toThrow(/supplier_tax_jurisdiction_check/);
    const incompleteOffer = await actor.agent.write(
      'POST',
      '/v1/staff/supplier-offers',
      {
        supplierId: supplier.id,
        brandId: null,
        manufacturerName: null,
        originalPartNumber: null,
        modification: null,
        modificationEvidence: 'UNKNOWN',
      },
    );
    expect(incompleteOffer.status).toBe(201);
    await expect(
      migrationDb!.$executeRaw`
        INSERT INTO supplier_offer_revision (
          id, offer_id, revision_no, modification_evidence,
          currency, origin, recorded_by_staff_user_id
        ) VALUES (
          ${randomUUID()}::uuid, ${String(payload(incompleteOffer).id)}::uuid,
          99, 'UNKNOWN', 'ZZZ', 'MANUAL', ${actor.id}::uuid
        )
      `,
    ).rejects.toThrow(/supplier_offer_revision_currency_check/);
  });

  it('SUP-02: PATCH accepts a partial supplier profile and retains omitted fields', async () => {
    const supplier = await makeSupplier('Partial Supplier Update');
    const response = await actor.agent.write(
      'PATCH',
      `/v1/staff/suppliers/${supplier.id}`,
      {
        expectedVersion: 1,
        shortName: 'Partial Update',
      },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(payload(response)).toMatchObject({ id: supplier.id, version: 2 });
    const profile = await actor.agent.request(
      'GET',
      `/v1/staff/suppliers/${supplier.id}`,
    );
    expect(profile.status).toBe(200);
    expect(payload(profile)).toMatchObject({
      legalName: 'Partial Supplier Update',
      shortName: 'Partial Update',
    });
  });

  it('SUP-04/05/06: supplier permissions are conjunctive and private offer costs remain staff-only', async () => {
    const denied = await readerWithoutSupplierRead.agent.request(
      'GET',
      '/v1/staff/supplier-offers',
    );
    expect(denied.status).toBe(403);
    const supplier = await makeSupplier('Supplier Read Boundary');
    const profile = await actor.agent.request(
      'GET',
      `/v1/staff/suppliers/${supplier.id}`,
    );
    expect(profile.status).toBe(200);
    expect(profile.headers.get('cache-control')).toBe('no-store');
    const missingPublicSurface = await fetch(
      new URL('/v1/public/supplier-offers', apiUrl),
    );
    expect(missingPublicSurface.status).toBe(404);
    expect(JSON.stringify(profile.body)).not.toContain('purchaseCost');
  });

  it('SUP-04: a stale permission snapshot cannot authorize a mutation after its live grant is absent', async () => {
    const session = await db!.staffSession.findFirstOrThrow({
      where: { staffUserId: readerWithoutSupplierRead.id, revokedAt: null },
      select: { id: true, authVersion: true },
    });
    const staleSnapshot = {
      requestId: randomUUID(),
      staff: {
        id: readerWithoutSupplierRead.id,
        email: readerWithoutSupplierRead.email,
        displayName: 'Stale supplier writer',
        passwordChangeRequired: false,
        authVersion: session.authVersion,
        sessionId: session.id,
        permissionCodes: ['suppliers.write'],
      },
    } as unknown as StaffRequest;
    const key = `revoked-grant-${randomUUID()}`;
    const service = app!.get(SuppliersService);
    await expect(
      service.createSupplier(staleSnapshot, key, {
        legalName: `Stale grant ${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await db!.supplierCommandIdempotency.count({
        where: {
          actorStaffUserId: readerWithoutSupplierRead.id,
          idempotencyKey: key,
        },
      }),
    ).toBe(0);
    expect(
      await db!.auditEvent.count({
        where: {
          actorUserId: readerWithoutSupplierRead.id,
          action: 'supplier.created',
        },
      }),
    ).toBe(0);
  });

  it('SUP-07/08/09: exact manual proposals retain history, approve one item, and unlink returns a sanitized receipt', async () => {
    const { categoryId, brandId } = await makeCategoryAndBrand();
    const supplier = await makeSupplier('Manual Match Supplier');
    const incomplete = await actor.agent.write(
      'POST',
      '/v1/staff/supplier-offers',
      {
        supplierId: supplier.id,
        brandId: null,
        manufacturerName: null,
        originalPartNumber: null,
        modification: null,
        modificationEvidence: 'UNKNOWN',
      },
    );
    expect(incomplete.status).toBe(201);
    const incompleteCandidates = await actor.agent.request(
      'GET',
      `/v1/staff/supplier-offers/${String(payload(incomplete).id)}/match-candidates`,
    );
    expect(incompleteCandidates.status).toBe(200);
    expect(incompleteCandidates.body.data).toEqual({
      identityComplete: false,
      reasonCode: 'INCOMPLETE_IDENTITY',
      candidates: [],
    });
    const product = await makeProduct(categoryId, brandId, 'MANUAL-1');
    const offer = await makeOffer(supplier.id, brandId, 'NW-MANUAL-1');
    const offerUpdatedAtBefore = await db!.supplierOffer.findUniqueOrThrow({
      where: { id: offer.id },
      select: { updatedAt: true },
    });
    const candidates = await actor.agent.request(
      'GET',
      `/v1/staff/supplier-offers/${offer.id}/match-candidates`,
    );
    expect(candidates.status).toBe(200);
    expect(candidates.body.data).toMatchObject({
      identityComplete: true,
      reasonCode: null,
      candidates: expect.arrayContaining([
        expect.objectContaining({
          productId: product.id,
          identityEvidenceKind: 'STRICT_IDENTITY_EXACT',
        }),
      ]),
    });
    const proposed = await propose(offer, product);
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);
    const proposal = record(proposed.body.data);
    expect(proposal.state).toBe('PENDING');
    expect(proposal.currentForOffer).toBe(false);
    const rejected = await actor.agent.write(
      'POST',
      `/v1/staff/supplier-match-proposals/${proposal.id}/decision`,
      {
        decision: 'REJECT',
        expectedVersion: 1,
        expectedOfferVersion: 1,
        expectedProductVersion: product.version,
        expectedCurrentMatchProposalId: null,
        reasonCode: 'STAFF_REJECTED',
      },
    );
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const replacement = await propose(offer, product);
    expect(replacement.status, JSON.stringify(replacement.body)).toBe(201);
    const secondProposal = record(replacement.body.data);
    expect(secondProposal.id).not.toBe(proposal.id);
    const approved = await actor.agent.write(
      'POST',
      `/v1/staff/supplier-match-proposals/${secondProposal.id}/decision`,
      {
        decision: 'APPROVE',
        expectedVersion: 1,
        expectedOfferVersion: 1,
        expectedProductVersion: product.version,
        expectedCurrentMatchProposalId: null,
        reasonCode: 'IDENTITY_CONFIRMED',
      },
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const current = await actor.agent.request(
      'GET',
      `/v1/staff/supplier-offers/${offer.id}`,
    );
    expect(current.status).toBe(200);
    expect(record(current.body.data).matchStatus).toBe('CURRENT');
    expect(record(current.body.data).currentMatchProposalId).toBe(
      secondProposal.id,
    );
    expect(record(current.body.data).currentRevision).toHaveProperty(
      'purchaseCost',
    );
    const currentMatches = await actor.agent.request(
      'GET',
      `/v1/staff/supplier-offers?catalogProductId=${product.id}&matchStatus=CURRENT`,
    );
    expect(currentMatches.status).toBe(200);
    expect(
      (currentMatches.body.data as JsonRecord[]).map((row) => row.id),
    ).toContain(offer.id);
    const reviewRequiredMatches = await actor.agent.request(
      'GET',
      `/v1/staff/supplier-offers?catalogProductId=${product.id}&matchStatus=REVIEW_REQUIRED`,
    );
    expect(reviewRequiredMatches.status).toBe(200);
    expect(
      (reviewRequiredMatches.body.data as JsonRecord[]).map((row) => row.id),
    ).not.toContain(offer.id);

    const unlinkKey = `unlink-${randomUUID()}`;
    const unlinkBody = {
      expectedVersion: 2,
      expectedCurrentMatchProposalId: secondProposal.id,
      reasonCode: 'MATCH_REVIEWED',
      reason: 'Staff requested manual unlink.',
    };
    const unlinked = await actor.agent.write(
      'POST',
      `/v1/staff/supplier-offers/${offer.id}/match/unlink`,
      unlinkBody,
      unlinkKey,
    );
    expect(unlinked.status, JSON.stringify(unlinked.body)).toBe(200);
    expect(unlinked.body.data).toEqual({
      id: offer.id,
      version: 3,
    });
    expect(JSON.stringify(unlinked.body)).not.toContain('purchaseCost');
    const unlinkReplay = await actor.agent.write(
      'POST',
      `/v1/staff/supplier-offers/${offer.id}/match/unlink`,
      unlinkBody,
      unlinkKey,
    );
    expect(unlinkReplay).toMatchObject({
      status: unlinked.status,
      body: unlinked.body,
    });
    const storedReplay = await db!.supplierCommandIdempotency.findFirstOrThrow({
      where: { idempotencyKey: unlinkKey },
    });
    expect(JSON.stringify(storedReplay.responseBody)).not.toContain(
      'purchaseCost',
    );
    const afterUnlink = await actor.agent.request(
      'GET',
      `/v1/staff/supplier-offers/${offer.id}`,
    );
    expect(record(afterUnlink.body.data).currentMatchProposalId).toBeNull();
    expect(record(afterUnlink.body.data).matchStatus).toBe('UNMATCHED');
    const offerUpdatedAtAfter = await db!.supplierOffer.findUniqueOrThrow({
      where: { id: offer.id },
      select: { updatedAt: true },
    });
    expect(offerUpdatedAtAfter.updatedAt.getTime()).toBeGreaterThan(
      offerUpdatedAtBefore.updatedAt.getTime(),
    );
    const offerAudit = await actor.agent.request(
      'GET',
      `/v1/staff/supplier-offers/${offer.id}/audit?limit=50`,
    );
    expect(offerAudit.status, JSON.stringify(offerAudit.body)).toBe(200);
    const auditActions = (offerAudit.body.data as JsonRecord[]).map((row) =>
      String(row.action),
    );
    expect(auditActions).toEqual(
      expect.arrayContaining([
        'supplier_offer.created',
        'supplier_match.proposed',
        'supplier_match.approved',
        'supplier_match.unlinked',
      ]),
    );
    expect(JSON.stringify(offerAudit.body)).not.toContain('purchaseCost');
    expect(JSON.stringify(offerAudit.body)).not.toContain('123.45');
    await expect(
      migrationDb!
        .$executeRaw`UPDATE supplier_offer_revision SET offer_name = 'tampered' WHERE id = ${offer.currentRevisionId}::uuid`,
    ).rejects.toThrow(/IMMUTABLE_HISTORY/);
    await expect(
      migrationDb!.$executeRaw`
        INSERT INTO product_match_proposal (
          id, offer_id, offer_revision_id, proposed_product_id,
          offer_identity_snapshot, product_identity_snapshot,
          evidence_kind, state, created_by_staff_user_id
        ) VALUES (
          ${randomUUID()}::uuid, ${offer.id}::uuid, ${offer.currentRevisionId}::uuid,
          ${product.id}::uuid, '{}'::jsonb, '{}'::jsonb,
          'STRICT_IDENTITY_EXACT', 'PENDING', ${actor.id}::uuid
        )
      `,
    ).rejects.toThrow(/product_match_proposal_snapshots_check/);
    const offerSnapshot = {
      brandId,
      manufacturerName: 'Northwind Devices',
      originalPartNumber: 'NW-MANUAL-1',
      modification: null,
      modificationEvidence: 'CONFIRMED_NONE',
    };
    const productSnapshot = {
      brandId,
      manufacturerName: 'Northwind Devices',
      originalPartNumber: 'NW-MANUAL-1',
      modification: null,
    };
    await expect(
      migrationDb!.$executeRaw`
        INSERT INTO product_match_proposal (
          id, offer_id, offer_revision_id, proposed_product_id,
          offer_identity_snapshot, product_identity_snapshot,
          evidence_kind, state, created_by_staff_user_id,
          decided_by_staff_user_id, decided_at, decision_reason_code
        ) VALUES (
          ${randomUUID()}::uuid, ${offer.id}::uuid, ${offer.currentRevisionId}::uuid,
          ${product.id}::uuid, ${JSON.stringify(offerSnapshot)}::jsonb,
          ${JSON.stringify(productSnapshot)}::jsonb,
          'STRICT_IDENTITY_EXACT', 'APPROVED', ${actor.id}::uuid,
          ${actor.id}::uuid, clock_timestamp(), 'IDENTITY_CONFIRMED'
        )
      `,
    ).rejects.toThrow(/IMMUTABLE_HISTORY/);
    await expect(
      migrationDb!.$executeRaw`
        INSERT INTO product_match_proposal (
          id, offer_id, offer_revision_id, proposed_product_id,
          offer_identity_snapshot, product_identity_snapshot,
          evidence_kind, state, created_by_staff_user_id
        ) VALUES (
          ${randomUUID()}::uuid, ${offer.id}::uuid, ${offer.currentRevisionId}::uuid,
          ${product.id}::uuid,
          ${JSON.stringify({ ...offerSnapshot, manufacturerName: { unsafe: true } })}::jsonb,
          ${JSON.stringify(productSnapshot)}::jsonb,
          'STRICT_IDENTITY_EXACT', 'PENDING', ${actor.id}::uuid
        )
      `,
    ).rejects.toThrow(/product_match_proposal_snapshots_check/);
  });

  it('SUP-10/11/12: current identity is exact, duplicate pending proposals are denied, and stale OCC cannot mutate history', async () => {
    const { categoryId, brandId } = await makeCategoryAndBrand();
    const supplier = await makeSupplier('Strict Identity Supplier');
    const product = await makeProduct(categoryId, brandId, 'STRICT-1');
    const offer = await makeOffer(supplier.id, brandId, 'NW-STRICT-1');
    const race = await Promise.all([
      propose(offer, product),
      propose(offer, product),
    ]);
    expect(race.map((item) => item.status).sort()).toEqual([201, 409]);
    const duplicate = race.find((item) => item.status === 409)!;
    expect(duplicate.body.code).toBe('MATCH_ALREADY_PENDING');
    const count = await db!.productMatchProposal.count({
      where: { offerId: offer.id, proposedProductId: product.id },
    });
    expect(count).toBe(1);
    const staleUpdate = await actor.agent.write(
      'PATCH',
      `/v1/staff/supplier-offers/${offer.id}`,
      {
        expectedVersion: 99,
        brandId,
        manufacturerName: 'Changed Northwind Devices',
        originalPartNumber: 'NW-STRICT-1',
        modification: null,
        modificationEvidence: 'CONFIRMED_NONE',
      },
    );
    expect(staleUpdate.status).toBe(409);
    expect(
      await db!.supplierOfferRevision.count({ where: { offerId: offer.id } }),
    ).toBe(1);
  });

  it('SUP-03/04: brand archival serializes with offer creation and revision', async () => {
    const supplier = await makeSupplier('Brand Lock Supplier');
    const concurrentActor = await makeActor(supplierPermissions, 'brand-race');
    const first = await makeCategoryAndBrand();
    const createLock = await holdRowLock('brand', first.brandId);
    try {
      const archive = actor.agent.write(
        'POST',
        `/v1/staff/catalog/brands/${first.brandId}/archive`,
        { expectedVersion: 1 },
      );
      await waitForBlockedQueries('FROM brand WHERE id', createLock.pid);
      const create = concurrentActor.agent.write(
        'POST',
        '/v1/staff/supplier-offers',
        {
          supplierId: supplier.id,
          brandId: first.brandId,
          manufacturerName: 'Northwind Devices',
          originalPartNumber: 'NW-BRAND-CREATE-RACE',
          modification: null,
          modificationEvidence: 'CONFIRMED_NONE',
          purchaseCost: '123.45',
          currency: 'RUB',
          sourceObservedAt: new Date().toISOString(),
        },
      );
      await waitForBlockedQueries('FOR SHARE', createLock.pid);
      createLock.release();
      await createLock.done;
      const [archived, created] = await Promise.all([archive, create]);
      expect(archived.status, JSON.stringify(archived.body)).toBe(200);
      expect(created.status).toBe(404);
      expect(
        await db!.supplierOffer.count({ where: { supplierId: supplier.id } }),
      ).toBe(0);
    } finally {
      createLock.release();
      await createLock.done;
    }

    const second = await makeCategoryAndBrand();
    const offer = await makeOffer(
      supplier.id,
      second.brandId,
      'NW-BRAND-REVISION-RACE',
    );
    const revisionLock = await holdRowLock('brand', second.brandId);
    try {
      const archive = actor.agent.write(
        'POST',
        `/v1/staff/catalog/brands/${second.brandId}/archive`,
        { expectedVersion: 1 },
      );
      await waitForBlockedQueries('FROM brand WHERE id', revisionLock.pid);
      const revise = concurrentActor.agent.write(
        'PATCH',
        `/v1/staff/supplier-offers/${offer.id}`,
        {
          expectedVersion: offer.version,
          brandId: second.brandId,
          manufacturerName: 'Northwind Devices',
          originalPartNumber: 'NW-BRAND-REVISION-RACE-UPDATED',
          modification: null,
          modificationEvidence: 'CONFIRMED_NONE',
          purchaseCost: '123.45',
          currency: 'RUB',
          sourceObservedAt: new Date().toISOString(),
        },
      );
      await waitForBlockedQueries('FOR SHARE', revisionLock.pid);
      revisionLock.release();
      await revisionLock.done;
      const [archived, revised] = await Promise.all([archive, revise]);
      expect(archived.status, JSON.stringify(archived.body)).toBe(200);
      expect(revised.status).toBe(404);
      expect(
        await db!.supplierOfferRevision.count({ where: { offerId: offer.id } }),
      ).toBe(1);
    } finally {
      revisionLock.release();
      await revisionLock.done;
    }
  });

  it('SUP-03/07/08: supplier archival serializes with proposal creation and approval', async () => {
    const concurrentActor = await makeActor(
      supplierPermissions,
      'supplier-race',
    );
    const first = await makeCategoryAndBrand();
    const supplierForProposal = await makeSupplier('Proposal Archive Race');
    const proposalProduct = await makeProduct(
      first.categoryId,
      first.brandId,
      'SUPPLIER-ARCHIVE-PROPOSAL-RACE',
    );
    const proposalOffer = await makeOffer(
      supplierForProposal.id,
      first.brandId,
      'NW-SUPPLIER-ARCHIVE-PROPOSAL-RACE',
    );
    const creationLock = await holdRowLock('supplier', supplierForProposal.id);
    try {
      const archive = actor.agent.write(
        'POST',
        `/v1/staff/suppliers/${supplierForProposal.id}/archive`,
        { expectedVersion: 1, reasonCode: 'RACE_ARCHIVE' },
      );
      await waitForBlockedQueries('FROM supplier WHERE id', creationLock.pid);
      const proposal = concurrentActor.agent.write(
        'POST',
        `/v1/staff/supplier-offers/${proposalOffer.id}/match-proposals`,
        {
          productId: proposalProduct.id,
          expectedOfferVersion: proposalOffer.version,
          expectedProductVersion: proposalProduct.version,
        },
        `proposal-race-${randomUUID()}`,
      );
      await waitForBlockedQueries(
        'FROM supplier WHERE id',
        creationLock.pid,
        2,
      );
      creationLock.release();
      await creationLock.done;
      const [archived, created] = await Promise.all([archive, proposal]);
      expect(archived.status, JSON.stringify(archived.body)).toBe(200);
      expect(created.status).toBe(409);
      expect(created.body.code).toBe('INVALID_STATE_TRANSITION');
      expect(
        await db!.productMatchProposal.count({
          where: { offerId: proposalOffer.id },
        }),
      ).toBe(0);
    } finally {
      creationLock.release();
      await creationLock.done;
    }

    const second = await makeCategoryAndBrand();
    const supplierForDecision = await makeSupplier('Decision Archive Race');
    const decisionProduct = await makeProduct(
      second.categoryId,
      second.brandId,
      'SUPPLIER-ARCHIVE-DECISION-RACE',
    );
    const decisionOffer = await makeOffer(
      supplierForDecision.id,
      second.brandId,
      'NW-SUPPLIER-ARCHIVE-DECISION-RACE',
    );
    const pendingResult = await propose(decisionOffer, decisionProduct);
    expect(pendingResult.status).toBe(201);
    const pendingId = String(record(pendingResult.body.data).id);
    const decisionLock = await holdRowLock('supplier', supplierForDecision.id);
    try {
      const archive = actor.agent.write(
        'POST',
        `/v1/staff/suppliers/${supplierForDecision.id}/archive`,
        { expectedVersion: 1, reasonCode: 'RACE_ARCHIVE' },
      );
      await waitForBlockedQueries('FROM supplier WHERE id', decisionLock.pid);
      const approval = concurrentActor.agent.write(
        'POST',
        `/v1/staff/supplier-match-proposals/${pendingId}/decision`,
        {
          decision: 'APPROVE',
          expectedVersion: 1,
          expectedOfferVersion: decisionOffer.version,
          expectedProductVersion: decisionProduct.version,
          expectedCurrentMatchProposalId: null,
          reasonCode: 'IDENTITY_CONFIRMED',
        },
      );
      await waitForBlockedQueries(
        `FROM supplier WHERE id = $1::uuid FOR UPDATE`,
        decisionLock.pid,
        2,
      );
      decisionLock.release();
      await decisionLock.done;
      const [archived, approved] = await Promise.all([archive, approval]);
      expect(archived.status, JSON.stringify(archived.body)).toBe(200);
      expect(approved.status).toBe(409);
      expect(approved.body.code).toBe('INVALID_STATE_TRANSITION');
      expect(
        await db!.productMatchProposal.findUniqueOrThrow({
          where: { id: pendingId },
          select: { state: true },
        }),
      ).toEqual({ state: 'PENDING' });
      expect(
        await db!.supplierOffer.findUniqueOrThrow({
          where: { id: decisionOffer.id },
          select: { currentMatchProposalId: true },
        }),
      ).toEqual({ currentMatchProposalId: null });
    } finally {
      decisionLock.release();
      await decisionLock.done;
    }
  });

  it('SUP-13/14: purchase-cost keyset pagination keeps currency groups separate and ordered', async () => {
    const supplier = await makeSupplier(
      `Currency Sort ${randomUUID().slice(0, 6)}`,
    );
    const { brandId } = await makeCategoryAndBrand();
    const rub = await makeOffer(
      supplier.id,
      brandId,
      `RUB-${randomUUID().slice(0, 6)}`,
      '2',
      'RUB',
    );
    const cny = await makeOffer(
      supplier.id,
      brandId,
      `CNY-${randomUUID().slice(0, 6)}`,
      '1',
      'CNY',
    );
    const usd = await makeOffer(
      supplier.id,
      brandId,
      `USD-${randomUUID().slice(0, 6)}`,
      '3',
      'USD',
    );
    const response = await actor.agent.request(
      'GET',
      `/v1/staff/supplier-offers?supplierId=${supplier.id}&sortBy=purchaseCost&sortDirection=ASC&limit=2`,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const firstPage = response.body.data as JsonRecord[];
    const cursor = (response.body.meta as JsonRecord).nextCursor;
    expect(firstPage).toHaveLength(2);
    expect(typeof cursor).toBe('string');
    const next = await actor.agent.request(
      'GET',
      `/v1/staff/supplier-offers?supplierId=${supplier.id}&sortBy=purchaseCost&sortDirection=ASC&limit=2&cursor=${encodeURIComponent(String(cursor))}`,
    );
    expect(next.status).toBe(200);
    const all = [...firstPage, ...(next.body.data as JsonRecord[])];
    const groupCurrencies = all.map((item) => {
      const revision = record(item.currentRevision);
      return revision.currency;
    });
    expect(groupCurrencies.indexOf('CNY')).toBeLessThan(
      groupCurrencies.indexOf('RUB'),
    );
    expect(groupCurrencies.indexOf('RUB')).toBeLessThan(
      groupCurrencies.indexOf('USD'),
    );
    expect(all.map((item) => item.id)).toContain(rub.id);
    expect(all.map((item) => item.id)).toContain(cny.id);
    expect(all.map((item) => item.id)).toContain(usd.id);
  });
});
