import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createRequire } from 'node:module';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const requireFromApi = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
const { Client } = requireFromApi('pg');
const Redis = requireFromApi('ioredis');

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const apiUrl = 'http://127.0.0.1:3001';
const proxyUrl = 'http://127.0.0.1:3002';
const webUrl = 'http://127.0.0.1:3000';
const publicOrigin = webUrl;
const storagePrefix = join(tmpdir(), 'stdu-r1-010c-storage-');
const storageRoot = `${storagePrefix}${randomUUID()}`;
const runtimePassword = randomBytes(32).toString('base64url');
const runtimeSecrets = [
  runtimePassword,
  process.env.R1_010C_TEST_PG_PASSWORD ?? '',
  process.env.R1_010C_TEST_REDIS_PASSWORD ?? '',
  randomBytes(32).toString('hex'),
  randomBytes(32).toString('hex'),
];
const privateEmails = new Set();
const processLogs = [];
const reports = [];
const trackedChildren = new Set();
let ownerDatabaseUrl;
let runtimeDatabaseUrl;
let redisUrl;
let database;
let redisFixture;
let proxy;
let browser;
let exitCode = 0;

function redact(text) {
  let safe = text;
  for (const value of [
    ...runtimeSecrets,
    ...(proxy?.observedCapabilities ?? []),
  ]) {
    if (value) safe = safe.replaceAll(value, '[redacted]');
  }
  for (const email of privateEmails)
    safe = safe.replaceAll(email, '[private-email]');
  return safe;
}

function spawnOwned(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let output = '';
  const collect = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-30_000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const closed = new Promise((resolveClosed, rejectClosed) => {
    child.once('error', rejectClosed);
    child.once('close', (code, signal) => resolveClosed({ code, signal }));
  });
  const entry = {
    name,
    child,
    closed,
    get output() {
      return output;
    },
  };
  trackedChildren.add(entry);
  processLogs.push(entry);
  return entry;
}

async function run(command, args, options = {}) {
  const entry = spawnOwned(command, command, args, options);
  const timeoutMs = options.timeoutMs ?? 180_000;
  let timer;
  const result = await Promise.race([
    entry.closed.then((value) => ({ kind: 'closed', value })),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout({ kind: 'timeout' }), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
  if (result.kind === 'timeout') {
    await stopOwned(entry);
    throw new Error(`${command} exceeded ${timeoutMs} ms.`);
  }
  trackedChildren.delete(entry);
  if (result.value.code !== 0)
    throw new Error(
      `${command} exited ${result.value.code ?? result.value.signal}:\n${redact(entry.output).slice(-12_000)}`,
    );
  return entry.output.trim();
}

async function stopOwned(entry) {
  if (!entry?.child?.pid) return;
  if (entry.child.exitCode !== null) {
    trackedChildren.delete(entry);
    return;
  }
  try {
    if (process.platform === 'win32') entry.child.kill('SIGTERM');
    else process.kill(-entry.child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const exited = await Promise.race([
    entry.closed.then(() => true),
    delay(5000).then(() => false),
  ]);
  if (exited) {
    trackedChildren.delete(entry);
    return;
  }
  try {
    if (process.platform === 'win32') entry.child.kill('SIGKILL');
    else process.kill(-entry.child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  await Promise.race([entry.closed, delay(5000)]);
  trackedChildren.delete(entry);
}

async function stopAllOwned() {
  for (const entry of [...trackedChildren].reverse()) await stopOwned(entry);
}

async function assertLoopbackPortFree(port) {
  const server = createNetServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', accept);
  });
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
}

async function waitForHttp(url, child, expectedStatus = 200) {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.child.exitCode !== null && child?.child.exitCode !== undefined)
      throw new Error(
        `${child.name} exited before readiness.\n${redact(child.output).slice(-8000)}`,
      );
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.status === expectedStatus) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError?.message ?? 'unknown error'}`,
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class FaultProxy {
  records = [];
  observedCapabilities = new Set();
  activeFaults = new Set();
  pendingFault;
  server;

  async listen() {
    this.server = createHttpServer((request, response) => {
      void this.forward(request, response);
    });
    await new Promise((accept, reject) => {
      this.server.once('error', reject);
      this.server.listen(3002, '127.0.0.1', accept);
    });
  }

  arm({ mode, method, path }) {
    assert.equal(
      this.pendingFault,
      undefined,
      'Only one fault may be armed at a time.',
    );
    const completed = deferred();
    const released = deferred();
    const fault = { mode, method, path, completed, released, used: false };
    this.activeFaults.add(fault);
    this.pendingFault = fault;
    return {
      response: completed.promise,
      release: () => released.resolve(),
    };
  }

  matchingFault(method, path) {
    const fault = this.pendingFault;
    const pathMatches =
      fault &&
      (fault.path instanceof RegExp
        ? fault.path.test(path)
        : fault.path === path);
    if (!fault || fault.used || fault.method !== method || !pathMatches)
      return undefined;
    fault.used = true;
    this.pendingFault = undefined;
    return fault;
  }

  async forward(request, response) {
    const path = request.url ?? '/';
    const event = {
      method: request.method ?? 'GET',
      path,
      origin: request.headers.origin ?? '',
      idempotencyKey: request.headers['idempotency-key'] ?? '',
      capability: request.headers['x-inquiry-upload-capability'] ?? '',
      bodyBytes: 0,
      bodyHash: undefined,
      status: undefined,
      downstreamClosed: false,
      faulted: false,
    };
    if (event.capability) this.observedCapabilities.add(event.capability);
    const digest = createHash('sha256');
    const createBodyChunks =
      event.method === 'POST' && path === '/v1/public/inquiries' ? [] : null;
    request.on('data', (chunk) => {
      const bytes = Buffer.from(chunk);
      event.bodyBytes += bytes.length;
      digest.update(bytes);
      if (createBodyChunks) createBodyChunks.push(bytes);
    });
    request.once('end', () => {
      event.bodyHash = digest.digest('hex');
      if (createBodyChunks) {
        try {
          const body = JSON.parse(
            Buffer.concat(createBodyChunks).toString('utf8'),
          );
          if (typeof body.uploadCapability === 'string')
            this.observedCapabilities.add(body.uploadCapability);
          if (typeof body.contact?.email === 'string') {
            event.contactEmail = body.contact.email;
            privateEmails.add(body.contact.email);
          }
        } catch {
          // A malformed request is still recorded by hash and status only.
        }
      }
    });
    response.once('close', () => {
      event.downstreamClosed = true;
    });
    this.records.push(event);

    const fault = this.matchingFault(event.method, path);
    event.faulted = Boolean(fault);
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: 3001,
        method: event.method,
        path,
        headers: { ...request.headers, host: '127.0.0.1:3001' },
      },
      (upstreamResponse) => {
        event.status = upstreamResponse.statusCode ?? 0;
        if (!fault) {
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.headers,
          );
          upstreamResponse.pipe(response);
          return;
        }
        const chunks = [];
        upstreamResponse.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        upstreamResponse.once('end', async () => {
          const payload = Buffer.concat(chunks);
          fault.completed.resolve({
            event,
            status: event.status,
            body: payload,
          });
          if (fault.mode === 'drop') {
            response.destroy();
            this.activeFaults.delete(fault);
            return;
          }
          const timeout = setTimeout(() => fault.released.resolve(), 30_000);
          await fault.released.promise;
          clearTimeout(timeout);
          if (response.destroyed) return;
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.headers,
          );
          response.end(payload);
          this.activeFaults.delete(fault);
        });
      },
    );
    upstream.once('error', (error) => {
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(502, { 'content-type': 'text/plain' });
        response.end('Disposable E2E proxy could not reach the API.');
      }
      if (fault && !fault.used) fault.completed.reject(error);
    });
    request.pipe(upstream);
  }

  async close() {
    for (const fault of this.activeFaults) fault.released.resolve();
    if (!this.server?.listening) return;
    await new Promise((accept, reject) =>
      this.server.close((error) => (error ? reject(error) : accept())),
    );
  }

  recordsFor(method, path) {
    return this.records.filter(
      (record) => record.method === method && record.path === path,
    );
  }

  async waitFor(method, path, count = 1, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const matching = this.recordsFor(method, path);
      if (matching.length >= count && matching[count - 1]?.status !== undefined)
        return matching[count - 1];
      await delay(25);
    }
    throw new Error(
      `Timed out waiting for proxied ${method} ${path} #${count}.`,
    );
  }
}

async function loseNextBrowserResponse(page, matcher, method) {
  const received = deferred();
  let used = false;
  const handler = async (route) => {
    if (used || route.request().method() !== method) {
      await route.continue();
      return;
    }
    used = true;
    try {
      const response = await route.fetch();
      const status = response.status();
      await response.body();
      await response.dispose();
      received.resolve({ status });
      await route.abort('failed');
    } catch (error) {
      received.reject(error);
    }
  };
  await page.route(matcher, handler);
  return {
    response: received.promise,
    close: () => page.unroute(matcher, handler),
  };
}

function assertOrigin(event) {
  assert.equal(
    event.origin,
    publicOrigin,
    'Chromium must send the exact allowed Origin.',
  );
}

async function inquiryCount() {
  const result = await database.query(
    'SELECT count(*)::int AS count FROM inquiry',
  );
  return result.rows[0].count;
}

async function getInquiry(reference) {
  const result = await database.query(
    'SELECT id, public_reference, upload_capability_expires_at FROM inquiry WHERE public_reference = $1',
    [reference],
  );
  assert.equal(
    result.rowCount,
    1,
    `Inquiry ${reference} must exist exactly once.`,
  );
  return result.rows[0];
}

async function documentRows(reference) {
  const result = await database.query(
    `SELECT d.id, d.inquiry_id, d.storage_key, d.sha256, d.size_bytes,
            d.safety_state, d.original_filename, d.upload_intent_id
       FROM inquiry_source_document d
       JOIN inquiry i ON i.id = d.inquiry_id
      WHERE i.public_reference = $1
      ORDER BY d.created_at, d.id`,
    [reference],
  );
  return result.rows;
}

async function intentCount(reference) {
  const result = await database.query(
    `SELECT count(*)::int AS count
       FROM inquiry_upload_intent ui
       JOIN inquiry i ON i.id = ui.inquiry_id
      WHERE i.public_reference = $1`,
    [reference],
  );
  return result.rows[0].count;
}

async function fillForm(page, { title, email, files = [] }) {
  await page.goto(`${webUrl}/request-quote?case=${encodeURIComponent(title)}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some(
        (button) =>
          button.textContent?.includes('Отправить в тестовую среду') &&
          Object.keys(button).some((key) => key.startsWith('__reactProps$')),
      ),
    { timeout: 30_000 },
  );
  assert.equal(new URL(page.url()).origin, publicOrigin);
  await page.getByLabel('Наименование').first().fill(title);
  await page.getByLabel('Количество').first().fill('2,125');
  await page.getByLabel(/Контактное лицо/).fill(`E2E ${title}`);
  await page.getByLabel('Email').fill(email);
  privateEmails.add(email);
  if (files.length)
    await page.locator('input[type="file"]').setInputFiles(files);
  return page.getByRole('button', { name: 'Отправить в тестовую среду' });
}

async function publicReference(page) {
  const receipt = page.getByText(/Публичный номер:\s*inq-[a-f0-9]{24}/i);
  await receipt.waitFor({ timeout: 30_000 });
  const text = await receipt.innerText();
  const reference = text.match(/inq-[a-f0-9]{24}/i)?.[0];
  assert.ok(reference, 'Public receipt reference must be visible.');
  return { reference, receipt };
}

async function assertStoredDocument(reference, bytes, filename) {
  const rows = await documentRows(reference);
  assert.equal(rows.length, 1);
  const document = rows[0];
  assert.equal(document.safety_state, 'QUARANTINED');
  assert.equal(document.original_filename, filename);
  assert.equal(Number(document.size_bytes), bytes.length);
  assert.equal(
    Buffer.from(document.sha256).toString('hex'),
    createHash('sha256').update(bytes).digest('hex'),
  );
  assert.match(document.storage_key, /^[a-f0-9]{64}$/);
  const path = join(storageRoot, 'inquiry-quarantine', document.storage_key);
  const persisted = await readFile(path);
  assert.deepEqual(
    persisted,
    bytes,
    'Original bytes must remain in private quarantine storage.',
  );
  return document;
}

function validPdf() {
  const parts = [Buffer.from('%PDF-1.7\n', 'ascii')];
  const offsets = [];
  let length = parts[0].length;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ];
  for (const object of objects) {
    offsets.push(length);
    const bytes = Buffer.from(object, 'ascii');
    parts.push(bytes);
    length += bytes.length;
  }
  const xrefOffset = length;
  parts.push(
    Buffer.from(
      [
        'xref\n0 5\n',
        '0000000000 65535 f \n',
        ...offsets.map(
          (offset) => `${String(offset).padStart(10, '0')} 00000 n \n`,
        ),
        'trailer\n<< /Size 5 /Root 1 0 R >>\n',
        `startxref\n${xrefOffset}\n%%EOF\n`,
      ].join(''),
      'ascii',
    ),
  );
  return Buffer.concat(parts);
}

function recordPass(name, detail) {
  reports.push({ name, detail });
  console.log(`PASS ${name}: ${detail}`);
}

async function assertBrowserStorageEmpty(page) {
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    indexedDb: (await indexedDB.databases()).length,
    caches: (await caches.keys()).length,
  }));
  assert.deepEqual(storage, { local: 0, session: 0, indexedDb: 0, caches: 0 });
}

function isExpectedConsoleError({ text, url }) {
  let endpoint;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== proxyUrl) return false;
    endpoint = parsed.pathname;
  } catch {
    return false;
  }
  const contentUpload =
    /^\/v1\/public\/inquiry-attachments\/upload-intents\/[^/]+\/content$/.test(
      endpoint,
    );
  if (/net::ERR_FAILED/i.test(text))
    return (
      endpoint === '/v1/public/inquiries' ||
      /^\/v1\/public\/inquiry-attachments\/upload-intents(?:\/[^/]+(?:\/content)?)?$/.test(
        endpoint,
      )
    );
  if (/status of 404 \(Not Found\)/i.test(text)) return contentUpload;
  if (/status of 400 \(Bad Request\)/i.test(text)) return contentUpload;
  if (/status of 409 \(Conflict\)/i.test(text))
    return /^\/v1\/public\/inquiry-attachments\/upload-intents\/[^/]+$/.test(
      endpoint,
    );
  return false;
}

async function nextAppNavigate(page, href) {
  const before = await page.evaluate(() => performance.timeOrigin);
  const found = await page.evaluate((target) => {
    const start = document.querySelector('main') ?? document.body;
    const fiberKey = Object.keys(start).find((key) =>
      key.startsWith('__reactFiber$'),
    );
    let fiber = fiberKey ? start[fiberKey] : null;
    while (fiber) {
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        const router = props?.value;
        if (
          router &&
          typeof router.push === 'function' &&
          typeof router.refresh === 'function' &&
          typeof router.prefetch === 'function'
        ) {
          router.push(target);
          return true;
        }
      }
      fiber = fiber.return;
    }
    return false;
  }, href);
  assert.equal(
    found,
    true,
    'The live Next App Router must handle this SPA navigation.',
  );
  await page.waitForURL((url) => url.pathname === href, { timeout: 15_000 });
  assert.equal(
    await page.evaluate(() => performance.timeOrigin),
    before,
    'Navigation must not reload the document.',
  );
}

async function scenarioCreate(page) {
  const before = await inquiryCount();
  const title = `Creation ${randomUUID().slice(0, 8)}`;
  const email = `create-${randomUUID()}@example.invalid`;
  const submit = await fillForm(page, { title, email });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${proxyUrl}/v1/public/inquiries` &&
      response.request().method() === 'POST',
  );
  await submit.click();
  const response = await responsePromise;
  assert.equal(response.status(), 201);
  assert.equal(response.headers()['access-control-allow-origin'], publicOrigin);
  const { reference, receipt } = await publicReference(page);
  assert.match(reference, /^inq-[a-f0-9]{24}$/i);
  assert.equal((await inquiryCount()) - before, 1);
  const inquiry = await getInquiry(reference);
  assert.equal(inquiry.public_reference, reference);
  const createEvent = await proxy.waitFor('POST', '/v1/public/inquiries');
  assertOrigin(createEvent);
  await assertBrowserStorageEmpty(page);
  assert.doesNotMatch(await receipt.innerText(), /[0-9a-f]{8}-[0-9a-f-]{27}/i);
  recordPass(
    'E2E-01 Creation',
    `Chromium received real HTTP 201 and PostgreSQL contains exactly one Inquiry (${reference}).`,
  );
  return { reference, inquiry };
}

async function scenarioUpload(page) {
  const before = await inquiryCount();
  const bytes = validPdf();
  const title = `Upload ${randomUUID().slice(0, 8)}`;
  const filename = `spec-${randomUUID().slice(0, 8)}.pdf`;
  const submit = await fillForm(page, {
    title,
    email: `upload-${randomUUID()}@example.invalid`,
    files: [{ name: filename, mimeType: 'application/pdf', buffer: bytes }],
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${proxyUrl}/v1/public/inquiries` &&
      response.request().method() === 'POST',
  );
  await submit.click();
  const createResponse = await responsePromise;
  assert.equal(createResponse.status(), 201);
  const { reference } = await publicReference(page);
  const fileRow = page.getByRole('listitem').filter({ hasText: filename });
  await fileRow
    .getByText(/Принят · карантин до проверки безопасности/)
    .waitFor({ timeout: 30_000 });
  assert.equal((await inquiryCount()) - before, 1);
  const document = await assertStoredDocument(reference, bytes, filename);
  const intentCountForInquiry = await intentCount(reference);
  assert.equal(intentCountForInquiry, 1);
  const noPublicContentRoute = await fetch(
    `${proxyUrl}/v1/public/inquiry-attachments/upload-intents/${document.upload_intent_id}/content`,
    { headers: { Origin: publicOrigin } },
  );
  const anonymousStaffDownload = await fetch(
    `${proxyUrl}/v1/staff/inquiries/${document.inquiry_id}/documents/${document.id}/download`,
    { headers: { Origin: publicOrigin } },
  );
  assert.equal(noPublicContentRoute.status, 404);
  assert.notEqual(anonymousStaffDownload.status, 200);
  assert.equal(await page.getByText(/Публичный номер:/).count(), 1);
  const publicGet = await fetch(
    `${proxyUrl}/v1/public/inquiries/${reference}`,
    {
      headers: { Origin: publicOrigin },
    },
  );
  assert.equal(
    publicGet.status,
    404,
    'Public receipt reference must not expose inquiry status.',
  );
  await assertBrowserStorageEmpty(page);
  recordPass(
    'E2E-02 Upload',
    `Valid generated PDF reached NestJS, was stored byte-for-byte in private storage, SHA-256/size matched, document stayed QUARANTINED, and anonymous download was denied.`,
  );
}

async function scenarioDoubleSubmit(page) {
  const before = await inquiryCount();
  const beforeRequests = proxy.recordsFor(
    'POST',
    '/v1/public/inquiries',
  ).length;
  const title = `Double ${randomUUID().slice(0, 8)}`;
  const email = `double-${randomUUID()}@example.invalid`;
  const submit = await fillForm(page, { title, email });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${proxyUrl}/v1/public/inquiries` &&
      response.request().method() === 'POST',
  );
  await submit.evaluate((button) => {
    button.click();
    button.click();
  });
  const response = await responsePromise;
  assert.equal(response.status(), 201);
  const { reference } = await publicReference(page);
  await delay(150);
  assert.equal((await inquiryCount()) - before, 1);
  assert.equal(
    proxy.recordsFor('POST', '/v1/public/inquiries').length - beforeRequests,
    1,
  );
  assert.equal(await page.getByText(/Публичный номер:/).count(), 1);
  assert.equal(
    await database
      .query(
        "SELECT count(*)::int AS count FROM inquiry_command_idempotency WHERE actor_kind='PUBLIC' AND operation_scope='public:create'",
      )
      .then((result) => result.rows[0].count),
    before + 1,
  );
  assert.equal((await getInquiry(reference)).public_reference, reference);
  recordPass(
    'E2E-03 Double submit',
    'Two synchronous browser clicks produced one CreateInquiry, one PostgreSQL row and one public receipt.',
  );
}

async function scenarioUnknownCreate(page) {
  const before = await inquiryCount();
  const beforeRequests = proxy.recordsFor(
    'POST',
    '/v1/public/inquiries',
  ).length;
  const title = `Create replay ${randomUUID().slice(0, 8)}`;
  const submit = await fillForm(page, {
    title,
    email: `create-replay-${randomUUID()}@example.invalid`,
  });
  const fault = await loseNextBrowserResponse(
    page,
    `${proxyUrl}/v1/public/inquiries`,
    'POST',
  );
  await submit.click();
  const dropped = await fault.response;
  assert.equal(
    dropped.status,
    201,
    'NestJS must commit before the response is lost.',
  );
  const originalCreate = proxy
    .recordsFor('POST', '/v1/public/inquiries')
    .at(-1);
  assert.equal(
    proxy.recordsFor('POST', '/v1/public/inquiries').length,
    beforeRequests + 1,
  );
  assert.ok(originalCreate);
  assert.equal(originalCreate.status, 201);
  assertOrigin(originalCreate);
  await page
    .getByRole('button', { name: 'Повторить ту же отправку' })
    .waitFor({ timeout: 15_000 });
  assert.equal((await inquiryCount()) - before, 1);
  await page.getByRole('button', { name: 'Повторить ту же отправку' }).click();
  const retry = await page.waitForResponse(
    (response) =>
      response.url() === `${proxyUrl}/v1/public/inquiries` &&
      response.request().method() === 'POST',
  );
  assert.equal(retry.status(), 201);
  await fault.close();
  const { reference } = await publicReference(page);
  const creates = proxy.recordsFor('POST', '/v1/public/inquiries').slice(-2);
  assert.equal(creates.length, 2);
  assert.equal(creates[0].idempotencyKey, creates[1].idempotencyKey);
  assert.equal(creates[0].bodyHash, creates[1].bodyHash);
  assert.equal((await inquiryCount()) - before, 1);
  assert.equal((await getInquiry(reference)).public_reference, reference);
  recordPass(
    'E2E-04 Unknown creation',
    'The committed 201 response was lost before reaching the page; exact key/body replay returned the same receipt without creating a second Inquiry.',
  );
}

async function scenarioUnknownUpload(page, { expireCapability = false } = {}) {
  const before = await inquiryCount();
  const bytes = validPdf();
  const title = `${expireCapability ? 'Expired' : 'Upload replay'} ${randomUUID().slice(0, 8)}`;
  const filename = `${expireCapability ? 'expired' : 'replay'}-${randomUUID().slice(0, 8)}.pdf`;
  const submit = await fillForm(page, {
    title,
    email: `${expireCapability ? 'expired' : 'upload-replay'}-${randomUUID()}@example.invalid`,
    files: [{ name: filename, mimeType: 'application/pdf', buffer: bytes }],
  });
  const fault = await loseNextBrowserResponse(
    page,
    /http:\/\/127\.0\.0\.1:3002\/v1\/public\/inquiry-attachments\/upload-intents\/[^/]+\/content$/,
    'PUT',
  );
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${proxyUrl}/v1/public/inquiries` &&
      response.request().method() === 'POST',
  );
  await submit.click();
  assert.equal((await createResponsePromise).status(), 201);
  const { reference } = await publicReference(page);
  const dropped = await fault.response;
  assert.equal(
    dropped.status,
    201,
    'NestJS must accept bytes before upload response is lost.',
  );
  const originalUpload = proxy.records
    .filter(
      (record) => record.method === 'PUT' && record.path.endsWith('/content'),
    )
    .at(-1);
  assert.ok(originalUpload);
  assertOrigin(originalUpload);
  await page
    .getByRole('button', { name: 'Повторить файл' })
    .waitFor({ timeout: 15_000 });
  await page.getByText(/Результат загрузки не подтверждён/).waitFor();
  const originalDocument = await assertStoredDocument(
    reference,
    bytes,
    filename,
  );
  assert.equal((await inquiryCount()) - before, 1);
  if (expireCapability) {
    const databaseName = await database.query(
      'SELECT current_database() AS name',
    );
    assert.equal(databaseName.rows[0]?.name, 'stdu_r1_010c_e2e');
    await database.query('BEGIN');
    try {
      // Simulate the 24-hour TTL only in this disposable database. The
      // submission guard intentionally prevents changing expiry in normal use.
      await database.query('SET LOCAL session_replication_role = replica');
      const expired = await database.query(
        "UPDATE inquiry SET upload_capability_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
        [originalDocument.inquiry_id],
      );
      assert.equal(expired.rowCount, 1);
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }
  }
  await page.getByRole('button', { name: 'Повторить файл' }).click();
  const replayResponse = await page.waitForResponse(
    (response) =>
      response.url() === `${proxyUrl}${originalUpload.path}` &&
      response.request().method() === 'PUT',
  );
  if (expireCapability) {
    assert.equal(replayResponse.status(), 404);
    await page.getByText(/Результат загрузки не подтверждён/).waitFor();
    await fault.close();
    assert.equal(await page.getByText('Не приложен').count(), 0);
    assert.equal((await documentRows(reference)).length, 1);
    assert.equal((await inquiryCount()) - before, 1);
    recordPass(
      'E2E-06 Expired replay',
      'An expired capability made replay unavailable (real API 404); the UI retained UNKNOWN and the database retained the quarantined file, without claiming it was missing.',
    );
    return;
  }
  assert.equal(replayResponse.status(), 201);
  await page.getByText(/Принят · карантин до проверки безопасности/).waitFor();
  await fault.close();
  assert.equal((await documentRows(reference)).length, 1);
  assert.equal((await inquiryCount()) - before, 1);
  const uploads = proxy.records.filter(
    (record) => record.method === 'PUT' && record.path === originalUpload.path,
  );
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].idempotencyKey, uploads[1].idempotencyKey);
  assert.equal(uploads[0].bodyHash, uploads[1].bodyHash);
  recordPass(
    'E2E-05 Unknown upload',
    'The accepted upload response was dropped; exact intent/key/File replay returned the stored receipt and kept one Inquiry/document.',
  );
}

async function scenarioNavigation(page, stage) {
  const beforeCount = await inquiryCount();
  const title = `Navigation ${stage} ${randomUUID().slice(0, 8)}`;
  const hasFile = stage !== 'create';
  const bytes = validPdf();
  const filename = `navigation-${stage}-${randomUUID().slice(0, 6)}.pdf`;
  const submit = await fillForm(page, {
    title,
    email: `navigation-${stage}-${randomUUID()}@example.invalid`,
    files: hasFile
      ? [{ name: filename, mimeType: 'application/pdf', buffer: bytes }]
      : [],
  });
  const method =
    stage === 'create' ? 'POST' : stage === 'intent' ? 'POST' : 'PUT';
  const path =
    stage === 'create'
      ? '/v1/public/inquiries'
      : stage === 'intent'
        ? '/v1/public/inquiry-attachments/upload-intents'
        : /\/v1\/public\/inquiry-attachments\/upload-intents\/[^/]+\/content/;
  const hold = proxy.arm({ mode: 'hold', method, path });
  if (stage !== 'create') {
    const created = page.waitForResponse(
      (response) =>
        response.url() === `${proxyUrl}/v1/public/inquiries` &&
        response.request().method() === 'POST',
    );
    await submit.click();
    assert.equal((await created).status(), 201);
  } else {
    await submit.click();
  }
  const held = await hold.response;
  assert.equal(held.status, 201);
  assertOrigin(held.event);
  const heldReceipt = JSON.parse(held.body.toString('utf8'))?.data;
  const referenceText =
    stage === 'create'
      ? String(heldReceipt?.publicReference ?? '')
      : await page
          .getByText(/Публичный номер:/)
          .first()
          .innerText()
          .catch(() => '');
  const reference = referenceText.match(/inq-[a-f0-9]{24}/i)?.[0];
  const documentBefore = reference ? await documentRows(reference) : [];
  const countBeforeNavigation = await inquiryCount();
  const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  await nextAppNavigate(page, '/panels');
  await delay(75);
  hold.release();
  await delay(350);
  assert.equal(
    await page.evaluate(() => performance.timeOrigin),
    documentTimeOrigin,
  );
  assert.equal(
    held.event.downstreamClosed,
    true,
    'Route unmount must abort the browser request.',
  );

  if (stage === 'create') {
    assert.equal(countBeforeNavigation - beforeCount, 1);
    assert.ok(reference);
    const countAfter = await inquiryCount();
    assert.equal(
      countAfter - beforeCount,
      1,
      'Aborting the browser request must not duplicate a committed create.',
    );
    await page.goBack();
    await page.waitForURL((url) => url.pathname === '/request-quote');
    await page
      .getByText(
        /Результат предыдущей отправки не подтверждён: заявка могла быть создана/,
      )
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', {
          name: /Отправить в тестовую среду|Повторить ту же отправку/,
        })
        .isDisabled(),
      true,
    );
    recordPass(
      'E2E-07a SPA during create',
      'App Router unmounted the form after the server committed; returning showed the unconfirmed-create warning and disabled new submission.',
    );
  } else if (stage === 'intent') {
    assert.ok(reference);
    assert.equal(
      await intentCount(reference),
      1,
      'Upload intent must be durable before route change.',
    );
    const after = proxy.records.length;
    await delay(350);
    assert.equal(
      proxy.records.length,
      after,
      'Unmount must stop additional upload requests.',
    );
    assert.equal((await documentRows(reference)).length, 0);
    await page.goBack();
    await page.waitForURL((url) => url.pathname === '/request-quote');
    recordPass(
      'E2E-07b SPA during upload intent',
      'App Router aborted a held real intent response; the committed intent remained, and no bytes request followed unmount.',
    );
  } else {
    assert.ok(reference);
    assert.equal(
      documentBefore.length,
      1,
      'Bytes and document must be committed before response is held.',
    );
    assert.equal(documentBefore[0].safety_state, 'QUARANTINED');
    assert.equal((await documentRows(reference)).length, 1);
    const after = proxy.records.length;
    await delay(350);
    assert.equal(
      proxy.records.length,
      after,
      'Unmount must stop any later request after bytes upload.',
    );
    await page.goBack();
    await page.waitForURL((url) => url.pathname === '/request-quote');
    recordPass(
      'E2E-07c SPA during upload bytes',
      'App Router aborted the held bytes response after NestJS persisted the quarantined document; no follow-up request ran after unmount.',
    );
  }
}

async function scenarioPartialFailure(page) {
  const before = await inquiryCount();
  const goodBytes = validPdf();
  const badBytes = Buffer.from('This file is not a PDF document.', 'utf8');
  const goodName = `good-${randomUUID().slice(0, 6)}.pdf`;
  const badName = `invalid-${randomUUID().slice(0, 6)}.pdf`;
  const submit = await fillForm(page, {
    title: `Partial ${randomUUID().slice(0, 8)}`,
    email: `partial-${randomUUID()}@example.invalid`,
    files: [
      { name: goodName, mimeType: 'application/pdf', buffer: goodBytes },
      { name: badName, mimeType: 'application/pdf', buffer: badBytes },
    ],
  });
  const created = page.waitForResponse(
    (response) =>
      response.url() === `${proxyUrl}/v1/public/inquiries` &&
      response.request().method() === 'POST',
  );
  await submit.click();
  assert.equal((await created).status(), 201);
  const { reference } = await publicReference(page);
  await page
    .getByRole('button', { name: `Продолжить без файла ${badName}` })
    .waitFor({ timeout: 30_000 });
  assert.equal((await inquiryCount()) - before, 1);
  assert.equal(await intentCount(reference), 2);
  assert.equal((await documentRows(reference)).length, 1);
  await assertStoredDocument(reference, goodBytes, goodName);
  const goodRow = page.getByRole('listitem').filter({ hasText: goodName });
  const badRow = page.getByRole('listitem').filter({ hasText: badName });
  await goodRow
    .getByText(/Принят · карантин до проверки безопасности/)
    .waitFor();
  await badRow
    .getByText('Сервер не принял файл. Заявка создана, файл не приложен.')
    .waitFor();
  await page
    .getByRole('button', { name: `Продолжить без файла ${badName}` })
    .click();
  await page.getByText('Не приложен').waitFor();
  assert.equal((await inquiryCount()) - before, 1);
  assert.equal((await documentRows(reference)).length, 1);
  recordPass(
    'E2E-08 Partial failure',
    'Two actual uploads produced one quarantined success and one real API validation refusal, with per-file state and one Inquiry.',
  );
}

async function scenarioProductionDisabled() {
  const buildEnv = {
    ...process.env,
    NODE_ENV: 'production',
    RFQ_PREVIEW_ENABLED: 'true',
    RFQ_API_SUBMISSION_ENABLED: 'true',
    NEXT_PUBLIC_API_BASE_URL: apiUrl,
    NEXT_TELEMETRY_DISABLED: '1',
  };
  await run('pnpm', ['--filter', '@stdu/web', 'build'], {
    cwd: repoRoot,
    env: buildEnv,
    timeoutMs: 600_000,
  });
  const server = spawnOwned(
    'production Next.js',
    'pnpm',
    [
      '--filter',
      '@stdu/web',
      'exec',
      'next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3100',
    ],
    { cwd: repoRoot, env: buildEnv },
  );
  await waitForHttp('http://127.0.0.1:3100/request-quote', server);
  const productionBrowser = await chromium.launch({ headless: true });
  try {
    const page = await productionBrowser.newPage();
    const apiPosts = [];
    page.on('request', (request) => {
      if (request.url().startsWith(`${apiUrl}/`) && request.method() !== 'GET')
        apiPosts.push(request.url());
    });
    const response = await page.goto('http://127.0.0.1:3100/request-quote', {
      waitUntil: 'domcontentloaded',
    });
    assert.equal(response?.status(), 200);
    assert.equal(
      await page
        .getByRole('heading', { name: 'Запросить коммерческое предложение' })
        .count(),
      1,
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Отправка недоступна' })
        .isDisabled(),
      true,
    );
    assert.deepEqual(apiPosts, []);
    await assertBrowserStorageEmpty(page);
  } finally {
    await productionBrowser.close();
    await stopOwned(server);
  }
  recordPass(
    'E2E-09 Production disabled',
    'Production preview flag and submission flag were both forced true; production still rendered the unavailable, disabled action and emitted no API request.',
  );
}

async function scenarioPrivacy(page) {
  const bytes = validPdf();
  const filename = `private-${randomUUID().slice(0, 6)}.pdf`;
  const submit = await fillForm(page, {
    title: `Privacy ${randomUUID().slice(0, 8)}`,
    email: `privacy-${randomUUID()}@example.invalid`,
    files: [{ name: filename, mimeType: 'application/pdf', buffer: bytes }],
  });
  const createResponse = page.waitForResponse(
    (response) =>
      response.url() === `${proxyUrl}/v1/public/inquiries` &&
      response.request().method() === 'POST',
  );
  await submit.click();
  assert.equal((await createResponse).status(), 201);
  const { reference, receipt } = await publicReference(page);
  await page
    .getByRole('listitem')
    .filter({ hasText: filename })
    .getByText(/Принят · карантин до проверки безопасности/)
    .waitFor({ timeout: 30_000 });
  await assertBrowserStorageEmpty(page);
  const text = await receipt.innerText();
  assert.doesNotMatch(
    text,
    /[0-9a-f]{8}-[0-9a-f-]{27}/i,
    'Receipt must not reveal internal UUIDs.',
  );
  assert.doesNotMatch(
    text,
    new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.doesNotMatch(page.url(), /capability|upload/i);
  const createRecord = proxy.recordsFor('POST', '/v1/public/inquiries').at(-1);
  assertOrigin(createRecord);
  const capability = [...proxy.observedCapabilities].at(-1);
  assert.ok(capability);
  assert.equal(
    proxy.records.some((record) => record.path.includes(capability)),
    false,
  );
  assert.equal(text.includes(capability), false);
  const publicDocument = await documentRows(reference);
  assert.equal(publicDocument.length, 1);
  const apiOutput = processLogs.map((entry) => entry.output).join('\n');
  for (const secret of [
    ...runtimeSecrets,
    ...proxy.observedCapabilities,
    ...privateEmails,
  ])
    assert.equal(
      apiOutput.includes(secret),
      false,
      'No test secret or contact email may appear in service logs.',
    );
  assert.equal(apiOutput.includes(bytes.toString('base64')), false);
  recordPass(
    'E2E-10 Privacy',
    'Capability stayed out of URL/receipt/storage/logs; browser persistence was empty, internal IDs stayed private, and file bytes were not persisted in browser storage.',
  );
}

async function scenarioOriginProtection() {
  const before = await inquiryCount();
  const response = await fetch(`${apiUrl}/v1/public/inquiries`, {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.invalid',
      'Content-Type': 'application/json',
      'Idempotency-Key': `origin-e2e-${randomUUID()}`,
    },
    body: JSON.stringify({
      kind: 'EQUIPMENT',
      contact: { contactName: 'Origin check', email: 'origin@example.invalid' },
      equipmentLines: [
        { rawTitle: 'Origin check item', quantity: '1', unit: 'pcs' },
      ],
    }),
  });
  assert.equal(response.status, 403);
  assert.equal(await inquiryCount(), before);
  recordPass(
    'Origin/CSRF boundary',
    'A disallowed Origin was rejected by NestJS and created no inquiry.',
  );
}

async function setup() {
  assert.equal(
    process.version,
    'v24.19.0',
    'Runner must use the repository Node.js toolchain.',
  );
  assert.equal(await run('pnpm', ['--version']), '11.25.0');
  for (const port of [3000, 3001, 3002, 3100])
    await assertLoopbackPortFree(port);
  console.log(
    'PASS container loopback ports 3000, 3001, 3002 and 3100 are free; no Windows host ports are published.',
  );

  const pgPassword = process.env.R1_010C_TEST_PG_PASSWORD;
  const cachePassword = process.env.R1_010C_TEST_REDIS_PASSWORD;
  assert.ok(pgPassword && pgPassword.length >= 32);
  assert.ok(cachePassword && cachePassword.length >= 32);
  ownerDatabaseUrl = `postgresql://postgres:${encodeURIComponent(pgPassword)}@postgres:5432/stdu_r1_010c_e2e`;
  runtimeDatabaseUrl = `postgresql://stdu_runtime:${encodeURIComponent(runtimePassword)}@postgres:5432/stdu_r1_010c_e2e`;
  redisUrl = `redis://default:${encodeURIComponent(cachePassword)}@redis:6379/0`;
  redisFixture = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });
  await redisFixture.ping();
  const migrationEnv = {
    ...process.env,
    MIGRATION_DATABASE_URL: ownerDatabaseUrl,
    STDU_RUNTIME_PASSWORD: runtimePassword,
  };
  await run('pnpm', ['--filter', '@stdu/api', 'db:generate'], {
    env: migrationEnv,
    timeoutMs: 180_000,
  });
  await run('pnpm', ['--filter', '@stdu/api', 'db:runtime-role:init'], {
    env: migrationEnv,
    timeoutMs: 60_000,
  });
  await run('pnpm', ['--filter', '@stdu/api', 'db:migrate:deploy'], {
    env: migrationEnv,
    timeoutMs: 180_000,
  });

  database = new Client({
    connectionString: ownerDatabaseUrl,
    connectionTimeoutMillis: 3000,
    query_timeout: 10_000,
  });
  await database.connect();
  assert.equal(
    await inquiryCount(),
    0,
    'Disposable database must start empty.',
  );
  await mkdir(storageRoot, { recursive: true });
  await mkdir(join(storageRoot, 'inquiry-quarantine'), { recursive: true });

  const apiEnv = {
    ...process.env,
    APP_ENV: 'development',
    COOKIE_PROFILE: 'loopback',
    HOST: '127.0.0.1',
    PORT: '3001',
    STAFF_ORIGINS: publicOrigin,
    STAFF_DATABASE_URL: runtimeDatabaseUrl,
    MIGRATION_DATABASE_URL: ownerDatabaseUrl,
    REDIS_URL: redisUrl,
    SESSION_HMAC_KEY: runtimeSecrets[3],
    RATE_LIMIT_KEY: runtimeSecrets[4],
    INQUIRY_PUBLIC_ENABLED: 'true',
    INQUIRY_UPLOAD_PROFILE: 'MVP_SAFE',
    FILE_STORAGE_ROOT: storageRoot,
  };
  const api = spawnOwned(
    'NestJS API',
    'pnpm',
    ['--filter', '@stdu/api', 'exec', 'tsx', 'src/main.ts'],
    { cwd: repoRoot, env: apiEnv },
  );
  await waitForHttp(`${apiUrl}/health/ready`, api);
  proxy = new FaultProxy();
  await proxy.listen();

  const webEnv = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    RFQ_PREVIEW_ENABLED: 'true',
    RFQ_API_SUBMISSION_ENABLED: 'true',
    NEXT_PUBLIC_API_BASE_URL: proxyUrl,
  };
  const next = spawnOwned(
    'Next.js development',
    'pnpm',
    [
      '--filter',
      '@stdu/web',
      'exec',
      'next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3000',
    ],
    { cwd: repoRoot, env: webEnv },
  );
  await waitForHttp(`${webUrl}/request-quote`, next);
  browser = await chromium.launch({ headless: true });
}

async function runScenarios() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const pageErrors = [];
  const consoleErrors = [];
  const unexpectedOrigins = new Set();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push({
        text: message.text(),
        url: message.location().url,
      });
  });
  page.on('request', (request) => {
    const origin = new URL(request.url()).origin;
    if (![publicOrigin, proxyUrl].includes(origin))
      unexpectedOrigins.add(origin);
  });

  await scenarioCreate(page);
  await redisFixture.flushdb();
  await scenarioUpload(page);
  await redisFixture.flushdb();
  await scenarioDoubleSubmit(page);
  await redisFixture.flushdb();
  await scenarioUnknownCreate(page);
  await redisFixture.flushdb();
  await scenarioUnknownUpload(page);
  await redisFixture.flushdb();
  await scenarioUnknownUpload(page, { expireCapability: true });
  await redisFixture.flushdb();
  await scenarioNavigation(page, 'create');
  await redisFixture.flushdb();
  await scenarioNavigation(page, 'intent');
  await redisFixture.flushdb();
  await scenarioNavigation(page, 'bytes');
  await redisFixture.flushdb();
  await scenarioPartialFailure(page);
  await redisFixture.flushdb();
  await scenarioPrivacy(page);
  await redisFixture.flushdb();
  await scenarioOriginProtection();

  assert.deepEqual(
    pageErrors,
    [],
    `Chromium page errors: ${pageErrors.join('\n')}`,
  );
  assert.deepEqual(
    [...unexpectedOrigins],
    [],
    'Browser must not send data to third-party origins.',
  );
  const unexpectedConsoleErrors = consoleErrors.filter(
    (error) => !isExpectedConsoleError(error),
  );
  assert.equal(
    proxy.records.filter(
      (record) => record.method === 'PUT' && record.status === 404,
    ).length,
    1,
    'The expired-capability replay must be the only expected 404 upload response.',
  );
  assert.equal(
    proxy.records.filter(
      (record) => record.method === 'PUT' && record.status === 400,
    ).length,
    1,
    'The invalid PDF must be the only expected 400 upload response.',
  );
  assert.equal(
    proxy.records.filter(
      (record) => record.method === 'DELETE' && record.status === 409,
    ).length,
    1,
    'The rejected intent cancel must be the only expected 409 response.',
  );
  assert.deepEqual(
    unexpectedConsoleErrors,
    [],
    `Unexpected Chromium console errors: ${JSON.stringify(unexpectedConsoleErrors)}`,
  );
  await context.close();
}

async function main() {
  try {
    await setup();
    await runScenarios();
    await proxy.close();
    proxy = undefined;
    await stopAllOwned();
    await scenarioProductionDisabled();
    console.log(`R1-010C real E2E complete: ${reports.length} checks passed.`);
  } catch (error) {
    exitCode = 1;
    console.error(
      redact(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
    );
    for (const entry of processLogs)
      console.error(
        `${entry.name} log tail:\n${redact(entry.output).slice(-5000)}`,
      );
  } finally {
    await browser?.close().catch(() => undefined);
    await proxy?.close().catch(() => undefined);
    await stopAllOwned().catch((error) => {
      exitCode = 1;
      console.error(
        redact(error instanceof Error ? error.message : String(error)),
      );
    });
    await database?.end().catch(() => undefined);
    await redisFixture?.quit().catch(() => undefined);
    if (storageRoot.startsWith(storagePrefix))
      await rm(storageRoot, { recursive: true, force: true }).catch((error) => {
        exitCode = 1;
        console.error(
          `Could not remove owned private test storage: ${redact(error.message)}`,
        );
      });
    else {
      exitCode = 1;
      console.error(
        'Refusing to remove private test storage outside its generated prefix.',
      );
    }
  }
  process.exitCode = exitCode;
}

await main();
