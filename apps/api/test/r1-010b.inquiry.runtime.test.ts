import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { deflateRawSync } from 'node:zlib';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createApiApp } from '../src/app.factory.js';
import { IdentityCrypto } from '../src/identity/crypto.js';
import { REDIS } from '../src/database/database.module.js';
import { InquiriesService } from '../src/inquiries/inquiries.service.js';
import {
  PrivateFileStorage,
  PrivateStorageUnavailableError,
} from '../src/storage/private-file-storage.js';
import type { Redis } from 'ioredis';

type Json = Record<string, unknown>;
type ApiResult = {
  status: number;
  body: Json;
  headers: Headers;
  rawBody?: string;
};
type Actor = { id: string; email: string; agent: StaffAgent };

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

const runtimeEnabled = Boolean(
  process.env.MIGRATION_DATABASE_URL &&
  process.env.STAFF_DATABASE_URL &&
  process.env.REDIS_URL,
);
const origin = 'http://127.0.0.1:3000';
const execFileAsync = promisify(execFile);
const allInquiryPermissions = [
  'inquiries.read_assigned',
  'inquiries.read_all',
  'inquiries.contacts.read',
  'inquiries.assign_manager',
  'inquiries.assign_engineer',
  'inquiries.transition',
  'inquiries.comment',
  'inquiries.documents.read',
  'inquiries.documents.download',
];

class StaffAgent {
  baseUrl = '';
  private readonly cookies = new Map<string, string>();
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
    extra: Record<string, string> = {},
  ): Promise<ApiResult> {
    const headers = new Headers({
      Origin: origin,
      Accept: 'application/json',
      ...extra,
    });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = await this.csrf();
      headers.set('X-CSRF-Token', csrf);
    }
    if (this.cookies.size)
      headers.set(
        'Cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    this.remember(response);
    const text = await response.text();
    const parsed = parseJson(text);
    return {
      status: response.status,
      body:
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Json)
          : {},
      headers: response.headers,
      rawBody: text,
    };
  }
  async csrf() {
    const headers = new Headers({ Origin: origin });
    if (this.cookies.size)
      headers.set(
        'Cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    const response = await fetch(new URL('/v1/staff/auth/csrf', this.baseUrl), {
      headers,
    });
    this.remember(response);
    const body = (await response.json()) as Json;
    const token = (body.data as Json | undefined)?.token;
    if (typeof token !== 'string')
      throw new Error(`CSRF request failed: ${JSON.stringify(body)}`);
    return token;
  }
  async login(email: string, password: string) {
    return this.request('POST', '/v1/staff/auth/login', { email, password });
  }
  async write(
    method: string,
    path: string,
    body: unknown,
    idempotencyKey = `inq-test-${randomUUID()}`,
    ifMatch?: string,
  ) {
    return this.request(method, path, body, {
      'Idempotency-Key': idempotencyKey,
      ...(ifMatch ? { 'If-Match': ifMatch } : {}),
    });
  }
}

let app: Awaited<ReturnType<typeof createApiApp>> | undefined;
let ownerDb: PrismaClient | undefined;
let runtimeDb: PrismaClient | undefined;
let runtimeRedis: Redis | undefined;
let apiUrl = '';
let fullActor: Actor;
let redactedReader: Actor;
let assignedReader: Actor;
let assignedEditor: Actor;
let actionOnly: Actor;

function env(key: string) {
  const value = process.env[key];
  if (!value)
    throw new Error(`${key} is required for disposable Inquiry runtime tests.`);
  return value;
}

async function restartOwnedTestRedis() {
  const prefix = [
    'compose',
    '-p',
    env('R1_010B_TEST_COMPOSE_PROJECT'),
    '-f',
    env('R1_010B_TEST_COMPOSE_FILE'),
  ];
  const { stdout } = await execFileAsync(
    'docker',
    [...prefix, 'ps', '-q', 'redis'],
    { timeout: 10_000, windowsHide: true },
  );
  const containerId = stdout.trim();
  if (!containerId)
    throw new Error('Owned disposable Redis container is missing.');
  const inspected = await execFileAsync('docker', ['inspect', containerId], {
    timeout: 10_000,
    windowsHide: true,
  });
  const [container] = JSON.parse(inspected.stdout) as {
    Config?: { Labels?: Record<string, string> };
  }[];
  if (
    container?.Config?.Labels?.['com.docker.compose.project'] !==
      env('R1_010B_TEST_COMPOSE_PROJECT') ||
    container.Config.Labels['com.docker.compose.service'] !== 'redis'
  )
    throw new Error(
      'Refusing to restart a container outside the disposable Redis project.',
    );
  await execFileAsync('docker', [...prefix, 'restart', 'redis'], {
    timeout: 30_000,
    windowsHide: true,
  });
}
function data<T>(result: ApiResult): T {
  return result.body.data as T;
}
function obj(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

async function listenPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Unable to reserve Inquiry API test port.');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function startApi() {
  app = await createApiApp();
  app.useLogger(['error', 'warn']);
  await app.listen(await listenPort(), '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string')
    throw new Error('Inquiry API did not bind a TCP port.');
  apiUrl = `http://127.0.0.1:${address.port}`;
  runtimeRedis = app.get<Redis>(REDIS);
  for (const actor of [
    fullActor,
    redactedReader,
    assignedReader,
    assignedEditor,
    actionOnly,
  ])
    if (actor) actor.agent.baseUrl = apiUrl;
}

async function clearInquiryRateKeys() {
  if (!runtimeRedis)
    throw new Error('Disposable inquiry Redis is not connected.');
  let cursor = '0';
  do {
    const [next, keys] = await runtimeRedis.scan(
      cursor,
      'MATCH',
      'stdu:inquiry:*',
      'COUNT',
      '100',
    );
    cursor = next;
    if (keys.length) await runtimeRedis.del(...keys);
  } while (cursor !== '0');
}

async function makeActor(permissions: string[], label: string): Promise<Actor> {
  const id = randomUUID();
  const roleId = randomUUID();
  const email = `r1-010b-${label}-${randomUUID().slice(0, 8)}@example.invalid`;
  const password = `R1-010B runtime ${randomBytes(24).toString('base64url')}!`;
  const passwordHash = await new IdentityCrypto().hashPassword(password, email);
  await ownerDb!.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        id: roleId,
        code: `r1-010b-${label}-${randomUUID().slice(0, 8)}`,
        name: `R1-010B ${label}`,
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
        emailNormalized: email,
        displayName: `R1-010B ${label}`,
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
  return { id, email, agent };
}

function equipmentPayload(title = 'MCCB 3P 100A') {
  return {
    kind: 'EQUIPMENT',
    contact: {
      contactName: 'Alex Buyer',
      email: 'buyer@example.invalid',
      organization: 'Example Integrator',
    },
    equipmentLines: [
      {
        rawTitle: title,
        quantity: '2.5',
        unit: 'pcs',
        notes: 'Original wording retained',
      },
    ],
  };
}

function minimalPdf() {
  const parts = [Buffer.from('%PDF-1.7\n', 'ascii')];
  const offsets: number[] = [];
  let length = parts[0]!.length;
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
  const xref = [
    'xref\n0 5\n',
    '0000000000 65535 f \n',
    ...offsets.map(
      (offset) => `${String(offset).padStart(10, '0')} 00000 n \n`,
    ),
    'trailer\n<< /Size 5 /Root 1 0 R >>\n',
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join('');
  parts.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(parts);
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function minimalXlsx(compressWorkbook = false, forgeLocalHeader = false) {
  const entries = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.concat([
        Buffer.from(
          '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/>',
        ),
        ...(compressWorkbook ? [Buffer.alloc(2 * 1024 * 1024, 0x20)] : []),
        Buffer.from('</workbook>'),
      ]),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
      ),
    },
  ];
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const method = compressWorkbook && entry.name === 'xl/workbook.xml' ? 8 : 0;
    const compressed = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const crc = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    local.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(
      forgeLocalHeader && entry.name === 'xl/workbook.xml'
        ? offset + 1
        : offset,
      42,
    );
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

async function publicRequest(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult> {
  const requestHeaders = new Headers({
    Origin: origin,
    Accept: 'application/json',
    ...headers,
  });
  if (body !== undefined && !(body instanceof Uint8Array))
    requestHeaders.set('Content-Type', 'application/json');
  const response = await fetch(new URL(path, apiUrl), {
    method,
    headers: requestHeaders,
    ...(body === undefined
      ? {}
      : {
          body:
            body instanceof Uint8Array
              ? (body as unknown as BodyInit)
              : JSON.stringify(body),
        }),
  });
  const text = await response.text();
  const parsed = parseJson(text);
  return {
    status: response.status,
    body: obj(parsed),
    headers: response.headers,
    rawBody: text,
  };
}

async function publicStreamRequest(
  path: string,
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string>,
) {
  const requestHeaders = new Headers({
    Origin: origin,
    Accept: 'application/json',
    ...headers,
  });
  const response = await fetch(new URL(path, apiUrl), {
    method: 'PUT',
    headers: requestHeaders,
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const text = await response.text();
  const parsed = parseJson(text);
  return {
    status: response.status,
    body: obj(parsed),
    headers: response.headers,
    rawBody: text,
  };
}

async function createInquiry(
  input: Record<string, unknown> = equipmentPayload(),
  key = `inq-create-${randomUUID()}`,
) {
  return publicRequest('POST', '/v1/public/inquiries', input, {
    'Idempotency-Key': key,
  });
}

describe.skipIf(!runtimeEnabled)(
  'R1-010B disposable PostgreSQL + Redis + HTTP',
  () => {
    beforeAll(async () => {
      process.env.APP_ENV = 'development';
      process.env.HOST = '127.0.0.1';
      process.env.PORT = '3001';
      process.env.COOKIE_PROFILE = 'loopback';
      process.env.STAFF_ORIGINS = origin;
      process.env.INQUIRY_PUBLIC_ENABLED = 'true';
      process.env.INQUIRY_UPLOAD_PROFILE = 'MVP_SAFE';
      ownerDb = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: env('MIGRATION_DATABASE_URL'),
        }),
      });
      runtimeDb = new PrismaClient({
        adapter: new PrismaPg({ connectionString: env('STAFF_DATABASE_URL') }),
      });
      await startApi();
      fullActor = await makeActor(allInquiryPermissions, 'full');
      redactedReader = await makeActor(['inquiries.read_all'], 'redacted');
      assignedReader = await makeActor(['inquiries.read_assigned'], 'assigned');
      assignedEditor = await makeActor(
        ['inquiries.read_assigned', 'inquiries.transition'],
        'assigned-editor',
      );
      actionOnly = await makeActor(
        [
          'inquiries.transition',
          'inquiries.documents.read',
          'inquiries.documents.download',
        ],
        'action-only',
      );
    }, 60_000);

    beforeEach(async () => clearInquiryRateKeys());

    afterAll(async () => {
      await app?.close();
      await runtimeDb?.$disconnect();
      await ownerDb?.$disconnect();
    });

    it('REQB-01..06/20: anonymous create is private, durable, exact-replay idempotent, and rejects key reuse', async () => {
      const key = `inq-create-${randomUUID()}`;
      const input = equipmentPayload();
      const first = await createInquiry(input, key);
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(Object.keys(first.body).sort()).toEqual(['data', 'meta']);
      expect(first.body.data).toMatchObject({
        message: 'Your inquiry has been received.',
      });
      const firstReceipt = data<{ publicReference: string; createdAt: string }>(
        first,
      );
      expect(firstReceipt.publicReference).toMatch(/^inq-[a-f0-9]{24}$/);
      expect(JSON.stringify(first.body)).not.toContain('buyer@example.invalid');
      const replay = await createInquiry(input, key);
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(first.body);
      const conflict = await createInquiry(
        equipmentPayload('Different part'),
        key,
      );
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const row = await ownerDb!.inquiry.findUnique({
        where: { publicReference: firstReceipt.publicReference },
        include: { lines: true },
      });
      expect(row?.status).toBe('NEW');
      expect(row?.contactSnapshot).toMatchObject({
        email: 'buyer@example.invalid',
      });
      expect(row?.lines).toHaveLength(1);
      expect(row?.lines[0]?.quantityText).toBe('2.5');
      expect(await ownerDb!.inquiry.count()).toBe(1);
      const publicRead = await publicRequest(
        'GET',
        `/v1/public/inquiries/${row!.id}`,
      );
      expect(publicRead.status).toBe(404);
      expect(
        (
          await publicRequest(
            'GET',
            `/v1/public/inquiries/${firstReceipt.publicReference}`,
          )
        ).status,
      ).toBe(404);
      const privacy = await createInquiry({
        ...input,
        privacyNotice: { version: 'unapproved', accepted: true },
      });
      expect(privacy.status).toBe(400);
      expect(await ownerDb!.inquiry.count()).toBe(1);
    });

    it('REQB-01/20: concurrent identical public create requests commit one inquiry and replay one receipt', async () => {
      const before = await ownerDb!.inquiry.count();
      const key = `inq-concurrent-${randomUUID()}`;
      const input = equipmentPayload('Concurrent public submission');
      const [left, right] = await Promise.all([
        createInquiry(input, key),
        createInquiry(input, key),
      ]);
      expect([left.status, right.status]).toEqual([201, 201]);
      expect(left.body).toEqual(right.body);
      expect(await ownerDb!.inquiry.count()).toBe(before + 1);
      const reference = data<{ publicReference: string }>(left).publicReference;
      const row = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      expect(
        await ownerDb!.auditEvent.count({
          where: { action: 'inquiry.created', entityId: row.id },
        }),
      ).toBe(1);

      const conflictKey = `inq-concurrent-conflict-${randomUUID()}`;
      const beforeConflict = await ownerDb!.inquiry.count();
      const [winner, loser] = await Promise.all([
        createInquiry(equipmentPayload('Concurrent winner A'), conflictKey),
        createInquiry(equipmentPayload('Concurrent winner B'), conflictKey),
      ]);
      expect([winner.status, loser.status].sort()).toEqual([201, 409]);
      expect(
        [winner, loser].find((result) => result.status === 409)?.body.code,
      ).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await ownerDb!.inquiry.count()).toBe(beforeConflict + 1);
    });

    it('REQB-20: public creation fails closed when Redis rate limiting is unavailable', async () => {
      const before = await ownerDb!.inquiry.count();
      const evalSpy = vi
        .spyOn(runtimeRedis!, 'eval')
        .mockRejectedValue(new Error('controlled Redis outage'));
      try {
        const response = await createInquiry(
          equipmentPayload('Redis outage fail closed'),
        );
        expect(response.status).toBe(503);
      } finally {
        evalSpy.mockRestore();
      }
      expect(await ownerDb!.inquiry.count()).toBe(before);
    });

    it('REQB-17/18/20: upload-intent idempotency replays the exact public receipt', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('upload-intent exact replay'),
        uploadCapability: capability,
      });
      expect(created.status).toBe(201);
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const scope = `public:upload-intent:${inquiry.id}`;
      const auditBaseline = await ownerDb!.auditEvent.count({
        where: { action: 'inquiry.upload_intent.created' },
      });
      const key = `inq-intent-replay-${randomUUID()}`;
      const requestWithKey = () =>
        publicRequest(
          'POST',
          '/v1/public/inquiry-attachments/upload-intents',
          {
            filename: 'spec.csv',
            declaredMimeType: 'text/csv',
            sizeBytes: 12,
          },
          {
            'Idempotency-Key': key,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
      const first = await requestWithKey();
      const replay = await requestWithKey();
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(first.body);
      expect(Object.keys(obj(first.body.data)).sort()).toEqual([
        'expiresAt',
        'intentId',
        'maxBytes',
      ]);
      expect(JSON.stringify(replay.body)).not.toContain('__stduInternal');
      expect(
        await ownerDb!.inquiryUploadIntent.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(1);
      expect(
        await ownerDb!.auditEvent.count({
          where: { action: 'inquiry.upload_intent.created' },
        }),
      ).toBe(auditBaseline + 1);
      const receipt = await ownerDb!.inquiryCommandIdempotency.findFirstOrThrow(
        { where: { operationScope: scope } },
      );
      expect(receipt.responseReceipt).toMatchObject({
        __stduInternal: { kind: 'inquiry-source-quota-v1' },
        response: first.body,
      });
    });

    it('REQB-17/20/34: a concurrent retry cannot reuse a quota ticket while rollback settlement releases it', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('Quota compensation'),
        uploadCapability: capability,
      });
      expect(created.status).toBe(201);
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const scope = `public:upload-intent:${inquiry.id}`;
      const uploadAuditBaseline = await ownerDb!.auditEvent.count({
        where: { action: 'inquiry.upload_intent.created' },
      });
      const key = `inq-quota-rollback-${randomUUID()}`;
      const functionName = `r1_010b_fail_receipt_${randomUUID().replaceAll('-', '')}`;
      const triggerName = `r1_010b_fail_receipt_${randomUUID().replaceAll('-', '')}`;
      const sequenceName = `r1_010b_fail_once_${randomUUID().replaceAll('-', '')}`;
      const payload = {
        filename: 'spec.csv',
        declaredMimeType: 'text/csv',
        sizeBytes: 12,
      };
      const uploadIntentRequest = () =>
        publicRequest(
          'POST',
          '/v1/public/inquiry-attachments/upload-intents',
          payload,
          {
            'Idempotency-Key': key,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
      let releaseCompensation!: () => void;
      let reportCompensationStarted!: () => void;
      const compensationGate = new Promise<void>((resolve) => {
        releaseCompensation = resolve;
      });
      const compensationStarted = new Promise<void>((resolve) => {
        reportCompensationStarted = resolve;
      });
      const service = app!.get(InquiriesService);
      const originalFinish = Reflect.get(
        service,
        'finishSourceQuotaReservation',
      ) as (reservation: unknown, committed: boolean) => Promise<void>;
      let blockRelease = true;
      Reflect.set(
        service,
        'finishSourceQuotaReservation',
        async (reservation: { scope?: string }, committed: boolean) => {
          if (blockRelease && !committed && reservation.scope === scope) {
            blockRelease = false;
            reportCompensationStarted();
            await compensationGate;
          }
          await originalFinish.call(service, reservation, committed);
        },
      );
      let firstPromise: Promise<ApiResult> | undefined;
      let retryPromise: Promise<ApiResult> | undefined;
      try {
        await ownerDb!.$executeRawUnsafe(
          `CREATE SEQUENCE public."${sequenceName}" START WITH 1`,
        );
        await ownerDb!.$executeRawUnsafe(
          `GRANT USAGE, SELECT ON SEQUENCE public."${sequenceName}" TO stdu_runtime`,
        );
        await ownerDb!.$executeRawUnsafe(
          `CREATE FUNCTION public."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_scope = '${scope}' AND nextval('public."${sequenceName}"') = 1 THEN RAISE EXCEPTION 'controlled idempotency receipt failure' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END $$`,
        );
        await ownerDb!.$executeRawUnsafe(
          `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON inquiry_command_idempotency FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()`,
        );
        firstPromise = uploadIntentRequest();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          compensationStarted,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Quota compensation did not start.')),
              5000,
            );
          }),
        ]).finally(() => clearTimeout(timeout));
        retryPromise = uploadIntentRequest();
        await expect
          .poll(
            async () => {
              const lockWaits = await ownerDb!.$queryRaw<{ count: bigint }[]>`
              SELECT count(*)::bigint AS count
              FROM pg_stat_activity
              WHERE datname = current_database()
                AND wait_event_type = 'Lock'
                AND query ILIKE '%pg_advisory_xact_lock%'
            `;
              return Number(lockWaits[0]?.count ?? 0n);
            },
            { timeout: 5000, interval: 25 },
          )
          .toBeGreaterThan(0);
        releaseCompensation();
        const [failed, retry] = await Promise.all([firstPromise, retryPromise]);
        expect(failed.status).toBe(500);
        expect(retry.status, JSON.stringify(retry.body)).toBe(201);
      } finally {
        releaseCompensation();
        if (firstPromise) await firstPromise.catch(() => undefined);
        if (retryPromise) await retryPromise.catch(() => undefined);
        Reflect.deleteProperty(service, 'finishSourceQuotaReservation');
        await ownerDb!.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON inquiry_command_idempotency`,
        );
        await ownerDb!.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS public."${functionName}"()`,
        );
        await ownerDb!.$executeRawUnsafe(
          `DROP SEQUENCE IF EXISTS public."${sequenceName}"`,
        );
      }

      const failedRows = await ownerDb!.inquiryUploadIntent.count({
        where: { inquiryId: inquiry.id },
      });
      const failedReceipts = await ownerDb!.inquiryCommandIdempotency.count({
        where: { operationScope: scope },
      });
      const failedAudits = await ownerDb!.auditEvent.count({
        where: { action: 'inquiry.upload_intent.created' },
      });
      expect(failedRows).toBe(1);
      expect(failedReceipts).toBe(1);
      expect(failedAudits).toBe(uploadAuditBaseline + 1);

      const quotaKeys: string[] = [];
      let cursor = '0';
      do {
        const [next, keys] = await runtimeRedis!.scan(
          cursor,
          'MATCH',
          'stdu:inquiry:intent-hour:*',
          'COUNT',
          '100',
        );
        cursor = next;
        quotaKeys.push(...keys);
      } while (cursor !== '0');
      expect(quotaKeys).toHaveLength(1);
      expect(await runtimeRedis!.get(quotaKeys[0]!)).toBe('1');
      const byteKeys: string[] = [];
      cursor = '0';
      do {
        const [next, keys] = await runtimeRedis!.scan(
          cursor,
          'MATCH',
          'stdu:inquiry:bytes-day:*',
          'COUNT',
          '100',
        );
        cursor = next;
        byteKeys.push(...keys);
      } while (cursor !== '0');
      expect(byteKeys).toHaveLength(1);
      expect(await runtimeRedis!.get(byteKeys[0]!)).toBe('12');
    });

    it('REQB-17/20/34: a cross-source retry charges only the committed quota reservation after rollback', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('Cross-source quota compensation'),
        uploadCapability: capability,
      });
      expect(created.status).toBe(201);
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const scope = `public:upload-intent:${inquiry.id}`;
      const uploadAuditBaseline = await ownerDb!.auditEvent.count({
        where: { action: 'inquiry.upload_intent.created' },
      });
      const key = `inq-cross-source-quota-${randomUUID()}`;
      const functionName = `r1_010b_fail_receipt_${randomUUID().replaceAll('-', '')}`;
      const triggerName = `r1_010b_fail_receipt_${randomUUID().replaceAll('-', '')}`;
      const sequenceName = `r1_010b_fail_once_${randomUUID().replaceAll('-', '')}`;
      const payload = {
        filename: 'spec.csv',
        declaredMimeType: 'text/csv',
        sizeBytes: 12,
      };
      const service = app!.get(InquiriesService);
      const directRequest = (remoteAddress: string) =>
        ({
          requestId: randomUUID(),
          path: '/v1/public/inquiry-attachments/upload-intents',
          headers: { origin },
          socket: { remoteAddress },
        }) as never;
      const sourceAAddress = '198.51.100.31';
      const sourceBAddress = '198.51.100.32';
      const rateLimitKey = Buffer.from(env('RATE_LIMIT_KEY'), 'hex');
      const sourceHash = (address: string) =>
        createHmac('sha256', rateLimitKey)
          .update(`inquiry-source:v1:\0${address}`)
          .digest('hex');
      const sourceA = sourceHash(sourceAAddress);
      const sourceB = sourceHash(sourceBAddress);
      const keyHash = createHash('sha256').update(key).digest('hex');
      const uploadIntentRequest = (address: string) =>
        service.createUploadIntent(
          directRequest(address),
          key,
          capability,
          payload,
        );

      let releaseSettlement!: () => void;
      let reportSettlementStarted!: () => void;
      const settlementGate = new Promise<void>((resolve) => {
        releaseSettlement = resolve;
      });
      const settlementStarted = new Promise<void>((resolve) => {
        reportSettlementStarted = resolve;
      });
      let sourceAReservation: Record<string, unknown> | undefined;
      let sourceBReservation: Record<string, unknown> | undefined;
      const originalSettle = Reflect.get(
        service,
        'settleSourceQuotaAfterTransactionFailure',
      ) as (reservation: unknown) => Promise<void>;
      Reflect.set(
        service,
        'settleSourceQuotaAfterTransactionFailure',
        async (reservation: unknown) => {
          reportSettlementStarted();
          await settlementGate;
          await originalSettle.call(service, reservation);
        },
      );
      let firstPromise: Promise<unknown> | undefined;
      let retryPromise:
        Promise<{ status: number; body: Record<string, unknown> }> | undefined;
      try {
        await ownerDb!.$executeRawUnsafe(
          `CREATE SEQUENCE public."${sequenceName}" START WITH 1`,
        );
        await ownerDb!.$executeRawUnsafe(
          `GRANT USAGE, SELECT ON SEQUENCE public."${sequenceName}" TO stdu_runtime`,
        );
        await ownerDb!.$executeRawUnsafe(
          `CREATE FUNCTION public."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_scope = '${scope}' AND nextval('public."${sequenceName}"') = 1 THEN RAISE EXCEPTION 'controlled idempotency receipt failure' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END $$`,
        );
        await ownerDb!.$executeRawUnsafe(
          `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON inquiry_command_idempotency FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()`,
        );
        firstPromise = uploadIntentRequest(sourceAAddress);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          settlementStarted,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Quota settlement did not start.')),
              5000,
            );
          }),
        ]).finally(() => clearTimeout(timeout));

        const pendingSetKeys: string[] = [];
        let scanCursor = '0';
        do {
          const [nextCursor, keys] = await runtimeRedis!.scan(
            scanCursor,
            'MATCH',
            `stdu:inquiry:quota-pending:${sourceA}:*`,
            'COUNT',
            '100',
          );
          scanCursor = nextCursor;
          pendingSetKeys.push(...keys);
        } while (scanCursor !== '0');
        const pendingTickets = (
          await Promise.all(
            pendingSetKeys.map((pendingSetKey) =>
              runtimeRedis!.smembers(pendingSetKey),
            ),
          )
        ).flat();
        const pendingRecords = await Promise.all(
          pendingTickets.map(async (ticketKey) => {
            const raw = await runtimeRedis!.get(ticketKey);
            return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          }),
        );
        sourceAReservation =
          pendingRecords.find(
            (record) =>
              record?.source === sourceA &&
              record.scope === scope &&
              record.keyHash === keyHash,
          ) ?? undefined;
        expect(sourceAReservation).toMatchObject({ state: 'PENDING' });

        retryPromise = uploadIntentRequest(sourceBAddress);
        const retry = await retryPromise;
        expect(retry.status).toBe(201);
        const reservationKeys: string[] = [];
        scanCursor = '0';
        do {
          const [nextCursor, keys] = await runtimeRedis!.scan(
            scanCursor,
            'MATCH',
            'stdu:inquiry:quota-reservation:*',
            'COUNT',
            '100',
          );
          scanCursor = nextCursor;
          reservationKeys.push(...keys);
        } while (scanCursor !== '0');
        const durableReservations = await Promise.all(
          reservationKeys.map(async (ticketKey) => {
            const raw = await runtimeRedis!.get(ticketKey);
            return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          }),
        );
        sourceBReservation =
          durableReservations.find(
            (record) =>
              record?.source === sourceB &&
              record.scope === scope &&
              record.keyHash === keyHash,
          ) ?? undefined;
        expect(sourceBReservation).toMatchObject({ state: 'COMMITTED' });
        releaseSettlement();
        await expect(firstPromise).rejects.toBeDefined();
      } finally {
        releaseSettlement();
        if (firstPromise) await firstPromise.catch(() => undefined);
        if (retryPromise) await retryPromise.catch(() => undefined);
        Reflect.deleteProperty(
          service,
          'settleSourceQuotaAfterTransactionFailure',
        );
        await ownerDb!.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON inquiry_command_idempotency`,
        );
        await ownerDb!.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS public."${functionName}"()`,
        );
        await ownerDb!.$executeRawUnsafe(
          `DROP SEQUENCE IF EXISTS public."${sequenceName}"`,
        );
      }

      const failedRows = await ownerDb!.inquiryUploadIntent.count({
        where: { inquiryId: inquiry.id },
      });
      const receipts = await ownerDb!.inquiryCommandIdempotency.count({
        where: { operationScope: scope },
      });
      const audits = await ownerDb!.auditEvent.count({
        where: { action: 'inquiry.upload_intent.created' },
      });
      expect(failedRows).toBe(1);
      expect(receipts).toBe(1);
      expect(audits).toBe(uploadAuditBaseline + 1);

      expect(await runtimeRedis!.get(String(sourceAReservation!.dayKey))).toBe(
        '0',
      );
      expect(await runtimeRedis!.get(String(sourceAReservation!.hourKey))).toBe(
        '0',
      );
      expect(await runtimeRedis!.get(String(sourceBReservation!.dayKey))).toBe(
        '12',
      );
      expect(await runtimeRedis!.get(String(sourceBReservation!.hourKey))).toBe(
        '1',
      );
    });

    it('REQB-27/34: a request queued across UTC rollover uses the day sampled after the source quota lock', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('UTC quota boundary'),
        uploadCapability: capability,
      });
      expect(created.status).toBe(201);
      const createIntent = async (key: string, sizeBytes: number) =>
        publicRequest(
          'POST',
          '/v1/public/inquiry-attachments/upload-intents',
          {
            filename: 'spec.csv',
            declaredMimeType: 'text/csv',
            sizeBytes,
          },
          {
            'Idempotency-Key': key,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
      const first = await createIntent(
        `inq-quota-day-first-${randomUUID()}`,
        12,
      );
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      let cursor = '0';
      const dayKeys: string[] = [];
      do {
        const [next, keys] = await runtimeRedis!.scan(
          cursor,
          'MATCH',
          'stdu:inquiry:bytes-day:*',
          'COUNT',
          '100',
        );
        cursor = next;
        dayKeys.push(...keys);
      } while (cursor !== '0');
      expect(dayKeys).toHaveLength(1);
      const source = dayKeys[0]!.match(
        /^stdu:inquiry:bytes-day:([a-f0-9]{64}):\d{4}-\d{2}-\d{2}$/,
      )?.[1];
      expect(source).toBeDefined();
      const quotaLock = createHash('sha256')
        .update(`${source}\0R1-010\0public:upload-source-quota\0source`, 'utf8')
        .digest()
        .readBigInt64BE(0);
      let releaseLock!: () => void;
      let reportLockAcquired!: () => void;
      const releaseGate = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const lockAcquired = new Promise<void>((resolve) => {
        reportLockAcquired = resolve;
      });
      const lockTransaction = ownerDb!.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(${quotaLock})::text AS "lockAcquired"`;
          reportLockAcquired();
          await releaseGate;
        },
        { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10_000 },
      );
      await lockAcquired;
      const service = app!.get(InquiriesService);
      const originalReadDay = Reflect.get(service, 'sourceQuotaUtcDay') as (
        tx: unknown,
      ) => Promise<string>;
      let dayRead = false;
      const nextUtcDay = '2099-01-01';
      Reflect.set(service, 'sourceQuotaUtcDay', async () => {
        dayRead = true;
        return nextUtcDay;
      });
      const queued = createIntent(`inq-quota-day-next-${randomUUID()}`, 15);
      try {
        await expect
          .poll(
            async () => {
              const waits = await ownerDb!.$queryRaw<{ count: bigint }[]>`
                SELECT count(*)::bigint AS count
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND wait_event_type = 'Lock'
                  AND query ILIKE '%pg_advisory_xact_lock%'
              `;
              return Number(waits[0]?.count ?? 0n);
            },
            { timeout: 5000, interval: 25 },
          )
          .toBeGreaterThan(0);
        expect(dayRead).toBe(false);
        releaseLock();
        await lockTransaction;
        const next = await queued;
        expect(next.status, JSON.stringify(next.body)).toBe(201);
        expect(dayRead).toBe(true);
        cursor = '0';
        const nextDayKeys: string[] = [];
        do {
          const [nextCursor, keys] = await runtimeRedis!.scan(
            cursor,
            'MATCH',
            `stdu:inquiry:bytes-day:*:${nextUtcDay}`,
            'COUNT',
            '100',
          );
          cursor = nextCursor;
          nextDayKeys.push(...keys);
        } while (cursor !== '0');
        expect(nextDayKeys).toHaveLength(1);
        expect(await runtimeRedis!.get(nextDayKeys[0]!)).toBe('15');
      } finally {
        releaseLock();
        await lockTransaction.catch(() => undefined);
        await queued.catch(() => undefined);
        Reflect.set(service, 'sourceQuotaUtcDay', originalReadDay);
      }
    });

    it('REQB-27/34: daily byte and hourly intent quotas survive an owned Redis restart', async () => {
      const inquiries: { id: string; capability: string }[] = [];
      const intentReceipts: {
        inquiryId: string;
        capability: string;
        key: string;
        request: Json;
        response: Json;
      }[] = [];
      for (let index = 0; index < 5; index++) {
        const capability = randomBytes(32).toString('base64url');
        const created = await createInquiry({
          ...equipmentPayload(`Redis restart quota ${index}`),
          uploadCapability: capability,
        });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
          where: {
            publicReference: data<{ publicReference: string }>(created)
              .publicReference,
          },
        });
        inquiries.push({ id: inquiry.id, capability });
        for (let slot = 0; slot < 2; slot++) {
          const key = `inq-quota-persist-${index}-${slot}-${randomUUID()}`;
          const payload = {
            filename: `spec-${index}-${slot}.csv`,
            declaredMimeType: 'text/csv',
            sizeBytes: 10 * 1024 * 1024,
          };
          const result = await publicRequest(
            'POST',
            '/v1/public/inquiry-attachments/upload-intents',
            payload,
            {
              'Idempotency-Key': key,
              'X-Inquiry-Upload-Capability': capability,
            },
          );
          expect(result.status, JSON.stringify(result.body)).toBe(201);
          if (index === 4 && slot === 1)
            intentReceipts.push({
              inquiryId: inquiry.id,
              capability,
              key,
              request: payload,
              response: result.body,
            });
        }
      }
      expect(inquiries).toHaveLength(5);
      expect(intentReceipts).toHaveLength(1);
      const replayCase = intentReceipts[0]!;
      const findOneKey = async (pattern: string) => {
        let cursor = '0';
        const found: string[] = [];
        do {
          const [next, keys] = await runtimeRedis!.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            '100',
          );
          cursor = next;
          found.push(...keys);
        } while (cursor !== '0');
        expect(found).toHaveLength(1);
        return found[0]!;
      };
      const hourKey = await findOneKey('stdu:inquiry:intent-hour:*');
      const dayKey = await findOneKey('stdu:inquiry:bytes-day:*');
      expect(await runtimeRedis!.get(hourKey)).toBe('10');
      expect(await runtimeRedis!.get(dayKey)).toBe(String(100 * 1024 * 1024));

      await app!.close();
      app = undefined;
      await restartOwnedTestRedis();
      await startApi();
      await expect
        .poll(() => runtimeRedis!.ping(), { timeout: 10_000, interval: 50 })
        .toBe('PONG');
      expect(await runtimeRedis!.get(hourKey)).toBe('10');
      expect(await runtimeRedis!.get(dayKey)).toBe(String(100 * 1024 * 1024));

      const replay = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        replayCase.request,
        {
          'Idempotency-Key': replayCase.key,
          'X-Inquiry-Upload-Capability': replayCase.capability,
        },
      );
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(replayCase.response);
      expect(await runtimeRedis!.get(hourKey)).toBe('10');
      expect(await runtimeRedis!.get(dayKey)).toBe(String(100 * 1024 * 1024));
      const denied = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: 'next.csv',
          declaredMimeType: 'text/csv',
          sizeBytes: 1,
        },
        {
          'Idempotency-Key': `inq-quota-persist-denied-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': replayCase.capability,
        },
      );
      expect(denied.status).toBe(429);
      expect(
        await ownerDb!.inquiryUploadIntent.count({
          where: { inquiryId: replayCase.inquiryId },
        }),
      ).toBe(2);
    });

    it('REQB-04/05/16/40: union kinds, quantity strings, contact channels and current pointers are validated', async () => {
      const panels = await createInquiry({
        kind: 'PANELS',
        contact: { contactName: 'Panel Buyer', phone: '+79990000000' },
        panels: {
          requestType: 'DEVELOP_FROM_BRIEF',
          description: 'Design a control cabinet',
          expectedDeliverables: undefined,
        },
      });
      expect(panels.status).toBe(201);
      const engineering = await createInquiry({
        kind: 'ENGINEERING',
        contact: {
          contactName: 'Engineer Buyer',
          email: 'engineer@example.invalid',
        },
        engineering: {
          technicalTask: 'Review an existing automation system',
          expectedDeliverables: 'I/O list and design notes',
        },
      });
      expect(engineering.status).toBe(201);
      const malformed = await createInquiry({
        ...equipmentPayload(),
        panels: {
          requestType: 'PROJECT_READY',
          description: 'conflicting kind shape',
        },
      });
      expect(malformed.status).toBe(400);
      const noContact = await createInquiry({
        ...equipmentPayload(),
        contact: { contactName: 'No channel' },
      });
      expect(noContact.status).toBe(400);
      const oversizedWorkItem = await createInquiry({
        kind: 'PANELS',
        contact: { contactName: 'Panel Buyer', phone: '+79990000000' },
        panels: {
          requestType: 'DEVELOP_FROM_BRIEF',
          description: 'Design a control cabinet',
          requestedWork: ['x'.repeat(501)],
        },
      });
      expect(oversizedWorkItem.status).toBe(400);
      const zeroQuantity = await createInquiry({
        ...equipmentPayload(),
        equipmentLines: [{ rawTitle: 'zero', quantity: '0', unit: 'pcs' }],
      });
      expect(zeroQuantity.status).toBe(400);
      const savedEngineering = await ownerDb!.inquiry.findUnique({
        where: {
          publicReference: data<{ publicReference: string }>(engineering)
            .publicReference,
        },
      });
      expect(savedEngineering?.kindDetails).toMatchObject({
        type: 'ENGINEERING',
        expectedDeliverables: 'I/O list and design notes',
      });
    });

    it('REQB-07..11/14: capability issues one-use private intents and files remain QUARANTINED without a scanner', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload(),
        uploadCapability: capability,
      });
      expect(created.status).toBe(201);
      expect(Object.keys(obj(created.body.data)).sort()).toEqual([
        'createdAt',
        'message',
        'publicReference',
      ]);
      const reference = data<{ publicReference: string }>(
        created,
      ).publicReference;
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      const pdf = minimalPdf();
      const intent = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'panel-spec.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: pdf.length,
          expectedSha256: createHash('sha256').update(pdf).digest('hex'),
        },
        {
          'Idempotency-Key': `inq-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(intent.status, JSON.stringify(intent.body)).toBe(201);
      const intentId = String((intent.body.data as Json).intentId);
      await expect(
        runtimeDb!.inquiryUploadIntent.update({
          where: { id: intentId },
          data: { safeFilename: 'rewritten.pdf' },
        }),
      ).rejects.toThrow(/INQUIRY_UPLOAD_INTENT_DECLARATION_IMMUTABLE/);
      await expect(
        runtimeDb!.inquiryUploadIntent.delete({ where: { id: intentId } }),
      ).rejects.toThrow(/INQUIRY_UPLOAD_INTENT_RETENTION_REQUIRED/);
      const uploadKey = `inq-upload-${randomUUID()}`;
      const upload = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
        pdf,
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': uploadKey,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(upload.status, JSON.stringify(upload.body)).toBe(201);
      await expect(
        runtimeDb!.inquiryUploadIntent.update({
          where: { id: intentId },
          data: { state: 'ISSUED', version: { increment: 1 } },
        }),
      ).rejects.toThrow(/INQUIRY_UPLOAD_INTENT_TRANSITION_INVALID/);
      expect(upload.body.data).toMatchObject({
        accepted: true,
        securityState: 'QUARANTINED',
      });
      const replay = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
        pdf,
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': uploadKey,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(upload.body);
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(1);
      const document = await ownerDb!.inquirySourceDocument.findFirstOrThrow({
        where: { inquiryId: inquiry.id },
      });
      expect(document.safetyState).toBe('QUARANTINED');
      expect(document.storageKey).toMatch(/^[a-f0-9]{64}$/);
      expect(document.sizeBytes).toBe(BigInt(pdf.length));
      expect(Buffer.from(document.sha256).toString('hex')).toBe(
        createHash('sha256').update(pdf).digest('hex'),
      );
      expect(document.detectedMimeType).toBe('application/pdf');
      expect(document.originalFilename).toBe('panel-spec.pdf');
      expect(document.uploaderKind).toBe('ANONYMOUS');
      expect(document.uploadChannel).toBe('PUBLIC_WEB');
      const savedIntent = await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
        where: { id: intentId },
      });
      expect(savedIntent.state).toBe('CONSUMED');
      expect(savedIntent.receivingStartedAt).toBeInstanceOf(Date);
      expect(savedIntent.receivingDeadlineAt).toBeInstanceOf(Date);
      const newKeyReplay = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
        pdf,
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': `inq-upload-new-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(newKeyReplay.status).toBe(409);
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(1);
      await ownerDb!.inquiryUploadIntent.update({
        where: { id: intentId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await app?.close();
      await startApi();
      const replayAfterExpiryAndRestart = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
        pdf,
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': uploadKey,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(replayAfterExpiryAndRestart.status).toBe(201);
      expect(replayAfterExpiryAndRestart.body).toEqual(upload.body);
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(1);
      const wrongCapability = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'x.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: 8,
        },
        {
          'Idempotency-Key': `inq-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': randomBytes(32).toString('base64url'),
        },
      );
      expect(wrongCapability.status).toBe(404);
      const publicIdRead = await publicRequest(
        'GET',
        `/v1/public/inquiries/${inquiry.id}`,
      );
      const publicReferenceRead = await publicRequest(
        'GET',
        `/v1/public/inquiries/${reference}`,
      );
      expect(publicIdRead.status).toBe(404);
      expect(publicReferenceRead.status).toBe(404);

      const expiredCapability = randomBytes(32).toString('base64url');
      const expiredInquiryId = randomUUID();
      const expiredInquiry = await ownerDb!.inquiry.create({
        data: {
          id: expiredInquiryId,
          publicReference: `inq-${randomBytes(12).toString('hex')}`,
          channel: 'PUBLIC_WEB',
          kind: 'EQUIPMENT',
          status: 'NEW',
          contactSnapshot: { contactName: 'Test Buyer' },
          kindDetails: { version: 1, equipmentLines: [] },
          uploadProfileCode: 'MVP_SAFE',
          uploadCapabilityHash: createHash('sha256')
            .update(expiredCapability)
            .digest(),
          uploadCapabilityExpiresAt: new Date(Date.now() - 1000),
        },
      });
      const expiredCapabilityIntent = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: 'expired.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: 8,
        },
        {
          'Idempotency-Key': `inq-expired-cap-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': expiredCapability,
        },
      );
      expect(expiredCapabilityIntent.status).toBe(404);
      expect(
        await ownerDb!.inquiryUploadIntent.count({
          where: { inquiryId: expiredInquiry.id },
        }),
      ).toBe(0);

      const revokedCapability = randomBytes(32).toString('base64url');
      const revokedCreated = await createInquiry({
        ...equipmentPayload('revoked attachment capability'),
        uploadCapability: revokedCapability,
      });
      const revokedInquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(revokedCreated)
            .publicReference,
        },
      });
      const intentKey = `inq-revoked-cap-${randomUUID()}`;
      const beforeRevokeIntent = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: 'revoked.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: 8,
        },
        {
          'Idempotency-Key': intentKey,
          'X-Inquiry-Upload-Capability': revokedCapability,
        },
      );
      expect(beforeRevokeIntent.status).toBe(201);
      const uploadIntentId = String(obj(beforeRevokeIntent.body.data).intentId);
      const closeRevoked = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${revokedInquiry.id}/transition`,
        { toStatus: 'CLOSED', reasonCode: 'SPAM' },
        `inq-revoke-cap-close-${randomUUID()}`,
        '"1"',
      );
      expect(closeRevoked.status).toBe(200);
      const revokedState = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { id: revokedInquiry.id },
        select: {
          uploadCapabilityHash: true,
          uploadCapabilityExpiresAt: true,
        },
      });
      expect(revokedState.uploadCapabilityHash).toBeNull();
      expect(revokedState.uploadCapabilityExpiresAt).toBeNull();
      const revokedCapabilityIntent = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: 'revoked.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: 8,
        },
        {
          'Idempotency-Key': intentKey,
          'X-Inquiry-Upload-Capability': revokedCapability,
        },
      );
      expect(revokedCapabilityIntent.status).toBe(404);
      const uploadAfterRevoke = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${uploadIntentId}/content`,
        minimalPdf(),
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': `inq-revoked-upload-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': revokedCapability,
        },
      );
      expect(uploadAfterRevoke.status).toBe(404);
      const cancelAfterRevoke = await publicRequest(
        'DELETE',
        `/v1/public/inquiry-attachments/upload-intents/${uploadIntentId}`,
        undefined,
        {
          'Idempotency-Key': `inq-revoked-cancel-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': revokedCapability,
        },
      );
      expect(cancelAfterRevoke.status).toBe(404);
      await expect(
        ownerDb!.inquiry.update({
          where: { id: revokedInquiry.id },
          data: {
            uploadCapabilityHash: createHash('sha256')
              .update(randomBytes(32))
              .digest(),
            uploadCapabilityExpiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ).rejects.toThrow('INQUIRY_UPLOAD_CAPABILITY_IMMUTABLE');

      const otherCapability = randomBytes(32).toString('base64url');
      await createInquiry({
        ...equipmentPayload('capability cannot cross inquiry'),
        uploadCapability: otherCapability,
      });
      const otherIntent = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: 'x.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: 8,
        },
        {
          'Idempotency-Key': `inq-cross-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': otherCapability,
        },
      );
      const foreignIntentId = String(obj(otherIntent.body.data).intentId);
      const crossInquiry = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${foreignIntentId}/content`,
        minimalPdf(),
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': `inq-cross-upload-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(otherIntent.status).toBe(201);
      expect(crossInquiry.status).toBe(404);
    });

    it('REQB-35: runtime SQL cannot start receiving before now or after the intent expires', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('receiving start guard'),
        uploadCapability: capability,
      });
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const createIntent = async (filename: string) => {
        const result = await publicRequest(
          'POST',
          '/v1/public/inquiry-attachments/upload-intents',
          { filename, declaredMimeType: 'text/csv', sizeBytes: 12 },
          {
            'Idempotency-Key': `inq-receiving-guard-${randomUUID()}`,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
        expect(result.status).toBe(201);
        return String(obj(result.body.data).intentId);
      };
      const futureIntentId = await createIntent('future.csv');
      const futureStart = new Date(Date.now() + 60_000);
      await expect(
        runtimeDb!.inquiryUploadIntent.update({
          where: { id: futureIntentId },
          data: {
            state: 'RECEIVING',
            receivingStartedAt: futureStart,
            receivingDeadlineAt: new Date(futureStart.getTime() + 15 * 60_000),
            version: { increment: 1 },
          },
        }),
      ).rejects.toThrow(/INQUIRY_UPLOAD_INTENT_RECEIVING_BOUND_REQUIRED/);

      const expiredIntentId = await createIntent('expired.csv');
      const expiredAt = new Date(Date.now() - 1000);
      await ownerDb!.inquiryUploadIntent.update({
        where: { id: expiredIntentId },
        data: { expiresAt: expiredAt },
      });
      const startNow = new Date();
      await expect(
        runtimeDb!.inquiryUploadIntent.update({
          where: { id: expiredIntentId },
          data: {
            state: 'RECEIVING',
            receivingStartedAt: startNow,
            receivingDeadlineAt: new Date(startNow.getTime() + 15 * 60_000),
            version: { increment: 1 },
          },
        }),
      ).rejects.toThrow(/INQUIRY_UPLOAD_INTENT_RECEIVING_BOUND_REQUIRED/);
      const backdatedStart = new Date(expiredAt.getTime() - 1000);
      await expect(
        runtimeDb!.inquiryUploadIntent.update({
          where: { id: expiredIntentId },
          data: {
            state: 'RECEIVING',
            receivingStartedAt: backdatedStart,
            receivingDeadlineAt: new Date(
              backdatedStart.getTime() + 15 * 60_000,
            ),
            version: { increment: 1 },
          },
        }),
      ).rejects.toThrow(/INQUIRY_UPLOAD_INTENT_RECEIVING_BOUND_REQUIRED/);
      expect(
        await ownerDb!.inquiryUploadIntent.count({
          where: { inquiryId: inquiry.id, state: 'ISSUED' },
        }),
      ).toBe(2);
    });

    it('REQB-09/27/35: one stream atomically owns an ISSUED intent and its reservation survives start expiry', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload(),
        uploadCapability: capability,
      });
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const pdf = minimalPdf();
      const intentResult = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'slow.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: pdf.length,
        },
        {
          'Idempotency-Key': `inq-slow-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      const intentId = String(obj(intentResult.body.data).intentId);
      expect(intentResult.status).toBe(201);

      let releaseBody!: () => void;
      const bodyGate = new Promise<void>((resolve) => {
        releaseBody = resolve;
      });
      let streamStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        streamStarted = resolve;
      });
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(pdf.subarray(0, 12));
          streamStarted();
          await bodyGate;
          controller.enqueue(pdf.subarray(12));
          controller.close();
        },
      });
      const uploadKey = `inq-slow-upload-${randomUUID()}`;
      const uploadPromise = fetch(
        new URL(
          `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
          apiUrl,
        ),
        {
          method: 'PUT',
          headers: new Headers({
            Origin: origin,
            Accept: 'application/json',
            'Content-Type': 'application/octet-stream',
            'Idempotency-Key': uploadKey,
            'X-Inquiry-Upload-Capability': capability,
          }),
          body,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' },
      );
      let uploaded: Response | undefined;
      try {
        await started;
        await expect
          .poll(
            async () =>
              (
                await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
                  where: { id: intentId },
                })
              ).state,
          )
          .toBe('RECEIVING');
        await ownerDb!.inquiryUploadIntent.update({
          where: { id: intentId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await runtimeRedis!.del(`stdu:inquiry:upload-command:${intentId}`);
        const uploadLockKey = `stdu:inquiry:upload-command:${intentId}`;
        const competingUpload = await publicRequest(
          'PUT',
          `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
          pdf,
          {
            'Content-Type': 'application/octet-stream',
            'Idempotency-Key': `inq-duplicate-upload-${randomUUID()}`,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
        expect(competingUpload.status).toBe(409);
        expect(await runtimeRedis!.get(uploadLockKey)).toBeNull();
        const sameKeyWithoutLock = await publicRequest(
          'PUT',
          `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
          pdf,
          {
            'Content-Type': 'application/octet-stream',
            'Idempotency-Key': uploadKey,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
        expect(sameKeyWithoutLock.status).toBe(409);
        expect(await runtimeRedis!.get(uploadLockKey)).toBeNull();
        const cancelWhileReceiving = await publicRequest(
          'DELETE',
          `/v1/public/inquiry-attachments/upload-intents/${intentId}`,
          undefined,
          {
            'Idempotency-Key': `inq-cancel-receiving-${randomUUID()}`,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
        expect(cancelWhileReceiving.status).toBe(409);
        expect(
          (
            await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
              where: { id: intentId },
            })
          ).state,
        ).toBe('RECEIVING');
        const extraIntents = await Promise.all(
          Array.from({ length: 4 }, (_, index) =>
            publicRequest(
              'POST',
              `/v1/public/inquiry-attachments/upload-intents`,
              {
                filename: `reserved-${index}.csv`,
                declaredMimeType: 'text/csv',
                sizeBytes: 1024,
              },
              {
                'Idempotency-Key': `inq-extra-intent-${randomUUID()}`,
                'X-Inquiry-Upload-Capability': capability,
              },
            ),
          ),
        );
        expect(extraIntents.every((result) => result.status === 201)).toBe(
          true,
        );
        const overLimit = await publicRequest(
          'POST',
          `/v1/public/inquiry-attachments/upload-intents`,
          {
            filename: 'over.csv',
            declaredMimeType: 'text/csv',
            sizeBytes: 1024,
          },
          {
            'Idempotency-Key': `inq-extra-intent-${randomUUID()}`,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
        expect(overLimit.status).toBe(413);
      } finally {
        releaseBody();
        uploaded = await uploadPromise;
      }
      expect(uploaded?.status).toBe(201);
      expect(
        (
          await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
            where: { id: intentId },
          })
        ).state,
      ).toBe('CONSUMED');
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(1);
    });

    it('REQB-09/18: capability revocation during RECEIVING prevents intent consumption and document creation', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('revoke while receiving'),
        uploadCapability: capability,
      });
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const bytes = minimalPdf();
      const intentResponse = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: 'revocation-race.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: bytes.length,
        },
        {
          'Idempotency-Key': `inq-revoke-race-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(intentResponse.status).toBe(201);
      const intentId = String(obj(intentResponse.body.data).intentId);
      let releaseBody!: () => void;
      let markStarted!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseBody = resolve;
      });
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 10));
          markStarted();
          void gate.then(() => {
            controller.enqueue(bytes.subarray(10));
            controller.close();
          });
        },
      });
      const upload = publicStreamRequest(
        `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
        body,
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': `inq-revoke-race-upload-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      try {
        await started;
        await expect
          .poll(
            async () =>
              (
                await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
                  where: { id: intentId },
                })
              ).state,
          )
          .toBe('RECEIVING');
        const close = await fullActor.agent.write(
          'POST',
          `/v1/staff/inquiries/${inquiry.id}/transition`,
          { toStatus: 'CLOSED', reasonCode: 'CUSTOMER_WITHDRAWN' },
          `inq-revoke-race-close-${randomUUID()}`,
          '"1"',
        );
        expect(close.status).toBe(200);
      } finally {
        releaseBody();
      }
      const uploadResult = await upload;
      expect(uploadResult.status).toBe(404);
      expect(uploadResult.body.code).toBe('FILE_NOT_ACCESSIBLE');
      expect(
        (
          await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
            where: { id: intentId },
          })
        ).state,
      ).toBe('FAILED');
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(0);
      expect(
        await ownerDb!.auditEvent.findFirstOrThrow({
          where: {
            action: 'inquiry.upload.rejected',
            entityId: intentId,
          },
          select: { outcome: true },
        }),
      ).toEqual({ outcome: 'DENIED' });
    });

    it('REQB-35: an expired receiving deadline rejects before creating storage or Redis ownership', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('expired receiving deadline'),
        uploadCapability: capability,
      });
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const pdf = minimalPdf();
      const intentResult = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: 'expired-stream.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: pdf.length,
        },
        {
          'Idempotency-Key': `inq-expired-stream-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(intentResult.status).toBe(201);
      const intentId = String(obj(intentResult.body.data).intentId);
      await ownerDb!.inquiryUploadIntent.update({
        where: { id: intentId },
        data: {
          state: 'RECEIVING',
          receivingStartedAt: new Date(Date.now() - 20 * 60_000),
          receivingDeadlineAt: new Date(Date.now() - 5 * 60_000),
          version: { increment: 1 },
        },
      });
      const storage = app!.get(PrivateFileStorage);
      const write = vi.spyOn(storage, 'writeInquiryQuarantineOwned');
      const idempotencyKey = `inq-expired-stream-upload-${randomUUID()}`;
      let result: ApiResult;
      try {
        result = await publicRequest(
          'PUT',
          `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
          pdf,
          {
            'Content-Type': 'application/octet-stream',
            'Idempotency-Key': idempotencyKey,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
      } finally {
        write.mockRestore();
      }
      expect(result.status).toBe(409);
      expect(write).not.toHaveBeenCalled();
      expect(
        await runtimeRedis!.get(`stdu:inquiry:upload-command:${intentId}`),
      ).toBeNull();
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(0);
    });

    it('REQB-17/18/19: concurrent identical upload requests with one key commit once and replay the exact receipt', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('concurrent same-key upload'),
        uploadCapability: capability,
      });
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const bytes = Buffer.from('SKU,quantity\nSAME-KEY,2\n');
      const uploadKey = `inq-concurrent-upload-${randomUUID()}`;
      const intent = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'same-key.csv',
          declaredMimeType: 'text/csv',
          sizeBytes: bytes.length,
          expectedSha256: createHash('sha256').update(bytes).digest('hex'),
        },
        {
          'Idempotency-Key': `inq-concurrent-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      const intentId = String(obj(intent.body.data).intentId);
      const path = `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`;
      let releaseFirst!: () => void;
      let markBodyStarted!: () => void;
      const firstCanFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const bodyStarted = new Promise<void>((resolve) => {
        markBodyStarted = resolve;
      });
      const firstBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 5));
          markBodyStarted();
          void firstCanFinish.then(() => {
            controller.enqueue(bytes.subarray(5));
            controller.close();
          });
        },
      });
      const headers = {
        'Content-Type': 'application/octet-stream',
        'Idempotency-Key': uploadKey,
        'X-Inquiry-Upload-Capability': capability,
      };
      const first = publicStreamRequest(path, firstBody, headers);
      try {
        await bodyStarted;
        let state = '';
        for (let attempt = 0; attempt < 100; attempt++) {
          state = (
            await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
              where: { id: intentId },
            })
          ).state;
          if (state === 'RECEIVING') break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(state).toBe('RECEIVING');
        const second = await publicRequest('PUT', path, bytes, headers);
        expect(second.status, JSON.stringify(second.body)).toBe(201);
        releaseFirst();
        const firstResult = await first;
        expect(firstResult.status, JSON.stringify(firstResult.body)).toBe(201);
        expect(firstResult.body).toEqual(second.body);
        expect(
          await ownerDb!.inquirySourceDocument.count({
            where: { inquiryId: inquiry.id },
          }),
        ).toBe(1);
        expect(
          (
            await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
              where: { id: intentId },
            })
          ).state,
        ).toBe('CONSUMED');
      } finally {
        releaseFirst();
        await first.catch(() => undefined);
      }
    });

    it('REQB-27/34: concurrent reservations serialize and the source/day quota never widens after a profile increase', async () => {
      process.env.INQUIRY_UPLOAD_PROFILE = 'MVP_SAFE';
      const slotCapability = randomBytes(32).toString('base64url');
      await createInquiry({
        ...equipmentPayload('Concurrent quota'),
        uploadCapability: slotCapability,
      });
      const sameInquiry = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          publicRequest(
            'POST',
            `/v1/public/inquiry-attachments/upload-intents`,
            {
              filename: `slot-${index}.csv`,
              declaredMimeType: 'text/csv',
              sizeBytes: 1024,
            },
            {
              'Idempotency-Key': `inq-slot-${randomUUID()}`,
              'X-Inquiry-Upload-Capability': slotCapability,
            },
          ),
        ),
      );
      expect(
        sameInquiry.filter((result) => result.status === 201),
      ).toHaveLength(5);
      expect(
        sameInquiry.filter((result) => result.status === 413),
      ).toHaveLength(1);
      expect(
        sameInquiry
          .filter((result) => result.status === 201)
          .every((result) => obj(result.body.data).maxBytes === 1024),
      ).toBe(true);
      const overMvpFileBoundary = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: 'over-mvp.csv',
          declaredMimeType: 'text/csv',
          sizeBytes: 10 * 1024 * 1024 + 1,
        },
        {
          'Idempotency-Key': `inq-over-mvp-profile-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': slotCapability,
        },
      );
      expect(overMvpFileBoundary.status).toBe(413);

      await clearInquiryRateKeys();
      const lowInquiries = await Promise.all(
        Array.from({ length: 2 }, async (_, index) => {
          const capability = randomBytes(32).toString('base64url');
          const created = await createInquiry({
            ...equipmentPayload(`Low-profile ${index}`),
            uploadCapability: capability,
          });
          return {
            capability,
            row: await ownerDb!.inquiry.findUniqueOrThrow({
              where: {
                publicReference: data<{ publicReference: string }>(created)
                  .publicReference,
              },
            }),
          };
        }),
      );
      const lowReservations: ApiResult[] = [];
      const lowDeclaredSizes = [10, 10, 5].map((mib) => mib * 1024 * 1024);
      for (const low of lowInquiries) {
        for (const bytes of lowDeclaredSizes) {
          lowReservations.push(
            await publicRequest(
              'POST',
              `/v1/public/inquiry-attachments/upload-intents`,
              {
                filename: `low-${randomUUID()}.csv`,
                declaredMimeType: 'text/csv',
                sizeBytes: bytes,
              },
              {
                'Idempotency-Key': `inq-low-${randomUUID()}`,
                'X-Inquiry-Upload-Capability': low.capability,
              },
            ),
          );
        }
      }
      expect(lowReservations.every((result) => result.status === 201)).toBe(
        true,
      );
      expect(
        lowReservations.every(
          (result, index) =>
            obj(result.body.data).maxBytes ===
            lowDeclaredSizes[index % lowDeclaredSizes.length],
        ),
      ).toBe(true);

      process.env.INQUIRY_UPLOAD_PROFILE = 'ENGINEERING_DOCUMENTS';
      const highInquiries = await Promise.all(
        Array.from({ length: 3 }, async (_, index) => {
          const capability = randomBytes(32).toString('base64url');
          await createInquiry({
            ...equipmentPayload(`High-profile ${index}`),
            uploadCapability: capability,
          });
          return { capability };
        }),
      );
      const highAttempts: ApiResult[] = [];
      for (const [index, { capability }] of highInquiries.entries()) {
        highAttempts.push(
          await publicRequest(
            'POST',
            `/v1/public/inquiry-attachments/upload-intents`,
            {
              filename: `high-${index}.csv`,
              declaredMimeType: 'text/csv',
              sizeBytes: (index < 2 ? 50 : 1) * 1024 * 1024,
            },
            {
              'Idempotency-Key': `inq-high-${randomUUID()}`,
              'X-Inquiry-Upload-Capability': capability,
            },
          ),
        );
      }
      expect(
        highAttempts.filter((result) => result.status === 201),
      ).toHaveLength(1);
      expect(
        highAttempts.filter((result) => result.status === 429),
      ).toHaveLength(2);
      const acceptedEngineeringIntent = highAttempts.find(
        (result) => result.status === 201,
      )!;
      expect(obj(acceptedEngineeringIntent.body.data).maxBytes).toBe(
        50 * 1024 * 1024,
      );
      await clearInquiryRateKeys();
      const boundaryCapability = randomBytes(32).toString('base64url');
      await createInquiry({
        ...equipmentPayload('Exact engineering file boundary'),
        uploadCapability: boundaryCapability,
      });
      const exactFileBoundary = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: 'exact-50-mib.csv',
          declaredMimeType: 'text/csv',
          sizeBytes: 50 * 1024 * 1024,
        },
        {
          'Idempotency-Key': `inq-exact-50-mib-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': boundaryCapability,
        },
      );
      expect(exactFileBoundary.status).toBe(201);
      expect(obj(exactFileBoundary.body.data).maxBytes).toBe(50 * 1024 * 1024);
      const overFileBoundary = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'over-profile.csv',
          declaredMimeType: 'text/csv',
          sizeBytes: 50 * 1024 * 1024 + 1,
        },
        {
          'Idempotency-Key': `inq-over-profile-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': boundaryCapability,
        },
      );
      expect(overFileBoundary.status).toBe(400);
      process.env.INQUIRY_UPLOAD_PROFILE = 'MVP_SAFE';
    });

    it('REQB-09/10/13/14: unsupported files are rejected, cancellation is durable, and capability grants no read', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload(),
        uploadCapability: capability,
      });
      const reference = data<{ publicReference: string }>(
        created,
      ).publicReference;
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      const unsupported = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'project.dwg',
          declaredMimeType: 'application/acad',
          sizeBytes: 10,
        },
        {
          'Idempotency-Key': `inq-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(unsupported.status).toBe(400);
      const mismatchBytes = Buffer.from('SKU,quantity\nABC-1,2\n');
      const mismatchIntent = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'mismatch.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: mismatchBytes.length,
        },
        {
          'Idempotency-Key': `inq-mismatch-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(mismatchIntent.status).toBe(201);
      const mismatchId = String(obj(mismatchIntent.body.data).intentId);
      const mismatchUpload = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${mismatchId}/content`,
        mismatchBytes,
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': `inq-mismatch-upload-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(mismatchUpload.status).toBe(400);
      expect(
        (
          await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
            where: { id: mismatchId },
          })
        ).state,
      ).toBe('FAILED');
      const intent = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        { filename: 'scope.csv', declaredMimeType: 'text/csv', sizeBytes: 16 },
        {
          'Idempotency-Key': `inq-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(intent.status).toBe(201);
      const intentId = String((intent.body.data as Json).intentId);
      const cancelKey = `inq-cancel-${randomUUID()}`;
      const cancelPath = `/v1/public/inquiry-attachments/upload-intents/${intentId}`;
      const cancelled = await publicRequest('DELETE', cancelPath, undefined, {
        'Idempotency-Key': cancelKey,
        'X-Inquiry-Upload-Capability': capability,
      });
      expect(cancelled.status).toBe(204);
      const replay = await publicRequest('DELETE', cancelPath, undefined, {
        'Idempotency-Key': cancelKey,
        'X-Inquiry-Upload-Capability': capability,
      });
      expect(replay.status).toBe(204);
      expect(
        (
          await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
            where: { id: intentId },
          })
        ).state,
      ).toBe('CANCELLED');
      expect(
        (
          await publicRequest(
            'GET',
            `/v1/public/inquiries/${inquiry.id}/attachments`,
          )
        ).status,
      ).toBe(404);
    });

    it('REQB-08/09/10: CSV validation checks the complete streamed file, not only its sniff prefix', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload(),
        uploadCapability: capability,
      });
      const reference = data<{ publicReference: string }>(
        created,
      ).publicReference;
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      const bytes = Buffer.concat([
        Buffer.alloc(8192, 0x61),
        Buffer.from([0xff]),
      ]);
      const intent = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'invalid-utf8.csv',
          declaredMimeType: 'text/csv',
          sizeBytes: bytes.length,
          expectedSha256: createHash('sha256').update(bytes).digest('hex'),
        },
        {
          'Idempotency-Key': `inq-csv-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(intent.status).toBe(201);
      const intentId = String(obj(intent.body.data).intentId);
      const upload = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
        bytes,
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': `inq-csv-upload-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(upload.status).toBe(400);
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(0);
      expect(
        (
          await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
            where: { id: intentId },
          })
        ).state,
      ).toBe('FAILED');
    });

    it('REQB-10: malformed signatures are rejected and compressed XLSX-like content stays quarantined', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('format validation'),
        uploadCapability: capability,
      });
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const upload = async (
        filename: string,
        declaredMimeType: string,
        bytes: Buffer,
      ) => {
        const intent = await publicRequest(
          'POST',
          '/v1/public/inquiry-attachments/upload-intents',
          { filename, declaredMimeType, sizeBytes: bytes.length },
          {
            'Idempotency-Key': 'inq-format-intent-' + randomUUID(),
            'X-Inquiry-Upload-Capability': capability,
          },
        );
        expect(intent.status, JSON.stringify(intent.body)).toBe(201);
        const intentId = String(obj(intent.body.data).intentId);
        return publicRequest(
          'PUT',
          '/v1/public/inquiry-attachments/upload-intents/' +
            intentId +
            '/content',
          bytes,
          {
            'Content-Type': 'application/octet-stream',
            'Idempotency-Key': 'inq-format-upload-' + randomUUID(),
            'X-Inquiry-Upload-Capability': capability,
          },
        );
      };
      expect(
        (
          await upload(
            'invalid.pdf',
            'application/pdf',
            Buffer.from('%PDF-1.7\\n'),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await upload(
            'marker-only.pdf',
            'application/pdf',
            Buffer.from(
              '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> %%EOF\n',
            ),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await upload(
            'invalid.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            Buffer.from([0x50, 0x4b, 0x03, 0x04]),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await upload(
            'forged-directory.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            minimalXlsx(false, true),
          )
        ).status,
      ).toBe(400);
      const bombLike = await upload(
        'large-expansion.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        minimalXlsx(true),
      );
      expect(bombLike.status, JSON.stringify(bombLike.body)).toBe(201);
      const document = await ownerDb!.inquirySourceDocument.findFirstOrThrow({
        where: { inquiryId: inquiry.id },
      });
      expect(document.safetyState).toBe('QUARANTINED');
      expect(document.detectedMimeType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      const markerCsv = Buffer.from(
        `value\n${'xref 0 0 '.repeat(64 * 1024)}\n`,
      );
      const markerUpload = await upload(
        'xref-markers.csv',
        'text/csv',
        markerCsv,
      );
      expect(markerUpload.status, JSON.stringify(markerUpload.body)).toBe(201);
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(2);
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id, safetyState: 'QUARANTINED' },
        }),
      ).toBe(2);
    });

    it('REQB-23: failed exact-object cleanup emits a sanitized operations diagnostic', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('owned cleanup diagnostic'),
        uploadCapability: capability,
      });
      expect(created.status).toBe(201);
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const bytes = Buffer.from('SKU,quantity\nCLEANUP-1,1\n');
      const intent = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: 'cleanup.csv',
          declaredMimeType: 'text/csv',
          sizeBytes: bytes.length,
          expectedSha256: '0'.repeat(64),
        },
        {
          'Idempotency-Key': `inq-cleanup-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(intent.status).toBe(201);
      const intentId = String(obj(intent.body.data).intentId);
      const storage = app!.get(PrivateFileStorage);
      const originalWrite = storage.writeInquiryQuarantineOwned.bind(storage);
      const write = vi
        .spyOn(storage, 'writeInquiryQuarantineOwned')
        .mockImplementation(async (source, onPipelineReady) => {
          ownedWrite = await originalWrite(source, onPipelineReady);
          return ownedWrite;
        });
      let ownedWrite:
        | Awaited<ReturnType<PrivateFileStorage['writeInquiryQuarantineOwned']>>
        | undefined;
      const remove = vi
        .spyOn(storage, 'removeOwned')
        .mockRejectedValueOnce(new Error('controlled exact cleanup failure'));
      const service = app!.get(InquiriesService);
      const logger = Reflect.get(service, 'logger') as {
        warn: (message: string) => void;
      };
      const warning = vi.spyOn(logger, 'warn');
      let result: ApiResult;
      try {
        result = await publicRequest(
          'PUT',
          `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
          bytes,
          {
            'Content-Type': 'application/octet-stream',
            'Idempotency-Key': `inq-cleanup-upload-${randomUUID()}`,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
        expect(result.status).toBe(400);
        expect(ownedWrite).toBeDefined();
        expect(warning).toHaveBeenCalledWith(
          expect.stringContaining(
            'result=ORPHAN_RETAINED_PRIVATE; owned sweeper required.',
          ),
        );
        expect(warning.mock.calls.flat().join(' ')).not.toContain(
          ownedWrite?.stored.key,
        );
        expect(
          await ownerDb!.inquirySourceDocument.count({
            where: { inquiryId: inquiry.id },
          }),
        ).toBe(0);
      } finally {
        write.mockRestore();
        remove.mockRestore();
        warning.mockRestore();
        if (ownedWrite) await storage.removeOwned(ownedWrite);
      }
    });

    it('REQB-15/23: streamed size overflow and StoragePort failure keep the Inquiry and leave no attached file', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('upload fault boundaries'),
        uploadCapability: capability,
      });
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const bytes = Buffer.from('SKU,quantity\nFAULT-1,1\n');
      const overDeclared = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'overflow.csv',
          declaredMimeType: 'text/csv',
          sizeBytes: bytes.length - 1,
        },
        {
          'Idempotency-Key': `inq-overflow-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      const overflowIntentId = String(obj(overDeclared.body.data).intentId);
      const overflow = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${overflowIntentId}/content`,
        bytes,
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': `inq-overflow-upload-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(overflow.status).toBe(400);
      expect(
        (
          await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
            where: { id: overflowIntentId },
          })
        ).state,
      ).toBe('FAILED');
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(0);

      const storageFailureIntent = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'storage-failure.csv',
          declaredMimeType: 'text/csv',
          sizeBytes: bytes.length,
        },
        {
          'Idempotency-Key': `inq-storage-failure-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(storageFailureIntent.status).toBe(201);
      const storageFailureIntentId = String(
        obj(storageFailureIntent.body.data).intentId,
      );
      const storage = app!.get(PrivateFileStorage);
      const originalWrite = storage.writeInquiryQuarantineOwned.bind(storage);
      storage.writeInquiryQuarantineOwned = async () => {
        throw new PrivateStorageUnavailableError(
          new Error('controlled private storage failure'),
        );
      };
      let failedUpload: ApiResult;
      try {
        failedUpload = await publicRequest(
          'PUT',
          `/v1/public/inquiry-attachments/upload-intents/${storageFailureIntentId}/content`,
          bytes,
          {
            'Content-Type': 'application/octet-stream',
            'Idempotency-Key': `inq-storage-failure-upload-${randomUUID()}`,
            'X-Inquiry-Upload-Capability': capability,
          },
        );
      } finally {
        storage.writeInquiryQuarantineOwned = originalWrite;
      }
      expect(failedUpload.status).toBe(503);
      expect(failedUpload.body.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(
        (
          await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
            where: { id: storageFailureIntentId },
          })
        ).state,
      ).toBe('FAILED');
      expect(
        await ownerDb!.inquirySourceDocument.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(0);
      expect(
        await ownerDb!.inquiry.findUnique({ where: { id: inquiry.id } }),
      ).not.toBeNull();
      expect(
        await ownerDb!.auditEvent.findFirstOrThrow({
          where: {
            entityId: storageFailureIntentId,
            action: 'inquiry.upload.rejected',
          },
          select: { outcome: true, reasonCode: true },
        }),
      ).toEqual({ outcome: 'FAILURE', reasonCode: 'DEPENDENCY_UNAVAILABLE' });
    });

    it('REQB-12/15/28/31/33: staff scope, contact redaction, OCC, assignment, stage deadlines and comments are enforced', async () => {
      const created = await createInquiry();
      const reference = data<{ publicReference: string }>(
        created,
      ).publicReference;
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      const redacted = await redactedReader.agent.request(
        'GET',
        `/v1/staff/inquiries/${inquiry.id}`,
      );
      expect(redacted.status).toBe(200);
      expect(redacted.body.data).not.toHaveProperty('contact');
      const assignedBefore = await assignedReader.agent.request(
        'GET',
        `/v1/staff/inquiries/${inquiry.id}`,
      );
      expect(assignedBefore.status).toBe(404);
      const readlessExisting = await actionOnly.agent.request(
        'GET',
        `/v1/staff/inquiries/${inquiry.id}`,
      );
      const readlessMissing = await actionOnly.agent.request(
        'GET',
        `/v1/staff/inquiries/${randomUUID()}`,
      );
      expect(readlessExisting.status).toBe(403);
      expect(readlessMissing.status).toBe(403);
      const readlessMutation = await actionOnly.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/transition`,
        { toStatus: 'TRIAGE', reasonCode: 'TRIAGE_STARTED' },
        `inq-readless-${randomUUID()}`,
        '"1"',
      );
      expect(readlessMutation.status).toBe(403);
      const readlessDownload = await actionOnly.agent.request(
        'GET',
        `/v1/staff/inquiries/${inquiry.id}/documents/${randomUUID()}/download`,
      );
      expect(readlessDownload.status).toBe(403);
      const detail = await fullActor.agent.request(
        'GET',
        `/v1/staff/inquiries/${inquiry.id}`,
      );
      expect(detail.status).toBe(200);
      expect(detail.headers.get('etag')).toBe('"1"');
      expect((detail.body.data as Json).contact).toMatchObject({
        email: 'buyer@example.invalid',
      });
      const manager = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/inquiries/${inquiry.id}/manager`,
        { staffUserId: assignedReader.id },
        `inq-assign-${randomUUID()}`,
        '"1"',
      );
      expect(manager.status, JSON.stringify(manager.body)).toBe(200);
      expect((manager.body.data as Json).version).toBe(2);
      expect(manager.headers.get('etag')).toBe('"2"');
      const assignedAfter = await assignedReader.agent.request(
        'GET',
        `/v1/staff/inquiries/${inquiry.id}`,
      );
      expect(assignedAfter.status).toBe(200);
      const stale = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/inquiries/${inquiry.id}/engineer`,
        { staffUserId: assignedReader.id },
        `inq-stale-${randomUUID()}`,
        '"1"',
      );
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('VERSION_CONFLICT');
      const deadline = '1999-12-31T23:59:59Z';
      const invalidDate = await fullActor.agent.write(
        'PUT',
        '/v1/staff/inquiries/' + inquiry.id + '/stage-deadline',
        { stageDueAt: '2030' },
        'inq-due-invalid-' + randomUUID(),
        '"2"',
      );
      expect(invalidDate.status).toBe(400);
      const setDue = await fullActor.agent.write(
        'PUT',
        `/v1/staff/inquiries/${inquiry.id}/stage-deadline`,
        { stageDueAt: deadline },
        `inq-due-${randomUUID()}`,
        '"2"',
      );
      expect(setDue.status).toBe(200);
      expect(
        (
          await ownerDb!.inquiry.findUniqueOrThrow({
            where: { id: inquiry.id },
            select: { stageDueAt: true },
          })
        ).stageDueAt?.toISOString(),
      ).toBe(new Date(deadline).toISOString());
      const transitionKey = `inq-transition-${randomUUID()}`;
      const transitioned = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/transition`,
        { toStatus: 'TRIAGE', reasonCode: 'TRIAGE_STARTED' },
        transitionKey,
        '"3"',
      );
      expect(transitioned.status).toBe(200);
      const replay = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/transition`,
        { toStatus: 'TRIAGE', reasonCode: 'TRIAGE_STARTED' },
        transitionKey,
        '"3"',
      );
      expect(replay.body).toEqual(transitioned.body);
      const stored = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { id: inquiry.id },
      });
      expect(stored.status).toBe('TRIAGE');
      expect(stored.version).toBe(4);
      expect(stored.stageDueAt).toBeNull();
      const whitespaceComment = await fullActor.agent.write(
        'POST',
        '/v1/staff/inquiries/' + inquiry.id + '/comments',
        { body: '   \t  ' },
        'inq-comment-whitespace-' + randomUUID(),
      );
      expect(whitespaceComment.status).toBe(400);
      const commentKey = `inq-comment-${randomUUID()}`;
      const comment = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/comments`,
        { body: 'Internal engineering note.' },
        commentKey,
      );
      expect(comment.status).toBe(201);
      const commentReplay = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/comments`,
        { body: 'Internal engineering note.' },
        commentKey,
      );
      expect(commentReplay.body).toEqual(comment.body);
      const pagedBodies: string[] = [];
      for (const body of ['older note', 'newer note']) {
        const added = await fullActor.agent.write(
          'POST',
          `/v1/staff/inquiries/${inquiry.id}/comments`,
          { body },
          `inq-comment-page-${randomUUID()}`,
        );
        expect(added.status).toBe(201);
      }
      let commentCursor: string | null = null;
      for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
        const page = await fullActor.agent.request(
          'GET',
          `/v1/staff/inquiries/${inquiry.id}/comments?limit=1${commentCursor ? `&cursor=${encodeURIComponent(commentCursor)}` : ''}`,
        );
        expect(page.status).toBe(200);
        const pageData = page.body.data as Json[];
        expect(pageData).toHaveLength(1);
        pagedBodies.push(String(pageData[0]!.body));
        commentCursor = (page.body.meta as Json).nextCursor as string | null;
      }
      expect(new Set(pagedBodies).size).toBe(3);
      expect(pagedBodies).toContain('Internal engineering note.');
      expect(pagedBodies).toContain('older note');
      expect(pagedBodies).toContain('newer note');
      expect(
        await ownerDb!.inquiryComment.count({
          where: { inquiryId: inquiry.id },
        }),
      ).toBe(3);
      const command = await ownerDb!.inquiryCommandIdempotency.findFirstOrThrow(
        { where: { operationScope: 'staff:createStaffInquiryComment' } },
      );
      expect(JSON.stringify(command.responseReceipt)).not.toContain(
        'Internal engineering note.',
      );
      const audit = await ownerDb!.auditEvent.findFirstOrThrow({
        where: { action: 'inquiry.comment.created' },
      });
      expect(audit.changes).toEqual({ changedFields: ['body'] });
    });

    it('REQB-26/28/31: assignment targets and workflow transitions require eligible active staff', async () => {
      const unassignable = await makeActor([], 'unassignable-target');
      const blocked = await makeActor(
        ['inquiries.read_assigned'],
        'blocked-target',
      );
      await ownerDb!.staffUser.update({
        where: { id: blocked.id },
        data: { state: 'BLOCKED', blockedAt: new Date() },
      });
      const created = await createInquiry();
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const invalidAssignment = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/inquiries/${inquiry.id}/manager`,
        { staffUserId: unassignable.id },
        `inq-unassignable-${randomUUID()}`,
        '"1"',
      );
      expect(invalidAssignment.status).toBe(422);
      const blockedAssignment = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/inquiries/${inquiry.id}/manager`,
        { staffUserId: blocked.id },
        `inq-blocked-target-${randomUUID()}`,
        '"1"',
      );
      expect(blockedAssignment.status).toBe(422);
      const invalidTransitionPair = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/transition`,
        { toStatus: 'TRIAGE', reasonCode: 'ENGINEERING_STARTED' },
        `inq-invalid-transition-pair-${randomUUID()}`,
        '"1"',
      );
      expect(invalidTransitionPair.status).toBe(400);
      const missingManager = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/transition`,
        { toStatus: 'TRIAGE', reasonCode: 'TRIAGE_STARTED' },
        `inq-missing-manager-${randomUUID()}`,
        '"1"',
      );
      expect(missingManager.status).toBe(409);
      expect(missingManager.body.code).toBe('INVALID_STATE_TRANSITION');
      let row = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { id: inquiry.id },
      });
      expect(row.version).toBe(1);
      expect(row.status).toBe('NEW');

      const manager = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/inquiries/${inquiry.id}/manager`,
        { staffUserId: assignedReader.id },
        `inq-manager-for-transition-${randomUUID()}`,
        '"1"',
      );
      expect(manager.status).toBe(200);
      const triage = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/transition`,
        { toStatus: 'TRIAGE', reasonCode: 'TRIAGE_STARTED' },
        `inq-to-triage-${randomUUID()}`,
        '"2"',
      );
      expect(triage.status).toBe(200);
      const missingEngineer = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/transition`,
        { toStatus: 'ENGINEERING_REVIEW', reasonCode: 'ENGINEERING_STARTED' },
        `inq-missing-engineer-${randomUUID()}`,
        '"3"',
      );
      expect(missingEngineer.status).toBe(409);
      expect(missingEngineer.body.code).toBe('INVALID_STATE_TRANSITION');
      row = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { id: inquiry.id },
      });
      expect(row.version).toBe(3);
      expect(row.status).toBe('TRIAGE');
      const engineer = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/inquiries/${inquiry.id}/engineer`,
        { staffUserId: assignedReader.id },
        `inq-engineer-for-transition-${randomUUID()}`,
        '"3"',
      );
      expect(engineer.status).toBe(200);
      const engineering = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/transition`,
        { toStatus: 'ENGINEERING_REVIEW', reasonCode: 'ENGINEERING_STARTED' },
        `inq-to-engineering-${randomUUID()}`,
        '"4"',
      );
      expect(engineering.status).toBe(200);
      expect(engineering.headers.get('etag')).toBe('"5"');
    });

    it('REQB-28: assignment waits for the R1-002 account writer lock and rejects a target blocked before assignment', async () => {
      const target = await makeActor(
        ['inquiries.read_assigned'],
        'assign-race-target',
      );
      const created = await createInquiry();
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      let releaseWriter!: () => void;
      let reportWriterLock!: () => void;
      const writerGate = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const writerLocked = new Promise<void>((resolve) => {
        reportWriterLock = resolve;
      });
      const blockTarget = ownerDb!.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(1398031445,2)::text AS "lockAcquired"`;
        reportWriterLock();
        await writerGate;
        await tx.$executeRaw`UPDATE staff_user
          SET state='BLOCKED', blocked_at=clock_timestamp(),
              auth_version=auth_version+1, version=version+1,
              updated_at=clock_timestamp()
          WHERE id=${target.id}::uuid`;
      });
      let assignment: Promise<ApiResult> | undefined;
      try {
        let lockTimeout: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          writerLocked,
          new Promise<never>((_resolve, reject) => {
            lockTimeout = setTimeout(
              () => reject(new Error('Account writer lock was not acquired.')),
              5000,
            );
          }),
        ]).finally(() => clearTimeout(lockTimeout));
        assignment = fullActor.agent.write(
          'PATCH',
          `/v1/staff/inquiries/${inquiry.id}/manager`,
          { staffUserId: target.id },
          `inq-assign-race-${randomUUID()}`,
          '"1"',
        );
        await expect
          .poll(
            async () => {
              const waits = await ownerDb!.$queryRaw<{ count: bigint }[]>`
              SELECT count(*)::bigint AS count
              FROM pg_stat_activity
              WHERE datname = current_database()
                AND wait_event_type = 'Lock'
                AND query ILIKE '%pg_advisory_xact_lock%'
            `;
              return Number(waits[0]?.count ?? 0n);
            },
            { timeout: 5000, interval: 25 },
          )
          .toBeGreaterThan(0);
        releaseWriter();
        await blockTarget;
        const response = await assignment;
        expect(response.status).toBe(422);
        expect(
          await ownerDb!.inquiry.findUniqueOrThrow({
            where: { id: inquiry.id },
            select: { assignedManagerUserId: true, version: true },
          }),
        ).toEqual({ assignedManagerUserId: null, version: 1 });
      } finally {
        releaseWriter();
        await blockTarget.catch(() => undefined);
        if (assignment) await assignment.catch(() => undefined);
      }
    });

    it('REQB-28/31: concurrent aggregate mutations serialize on the inquiry version and audit one conflict', async () => {
      const created = await createInquiry();
      const reference = data<{ publicReference: string }>(
        created,
      ).publicReference;
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      const [manager, engineer] = await Promise.all([
        fullActor.agent.write(
          'PATCH',
          `/v1/staff/inquiries/${inquiry.id}/manager`,
          { staffUserId: assignedReader.id },
          `inq-race-manager-${randomUUID()}`,
          '"1"',
        ),
        fullActor.agent.write(
          'PATCH',
          `/v1/staff/inquiries/${inquiry.id}/engineer`,
          { staffUserId: assignedReader.id },
          `inq-race-engineer-${randomUUID()}`,
          '"1"',
        ),
      ]);
      expect([manager.status, engineer.status].sort()).toEqual([200, 409]);
      const stored = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { id: inquiry.id },
      });
      expect(stored.version).toBe(2);
      const auditRows = await ownerDb!.auditEvent.findMany({
        where: {
          entityId: inquiry.id,
          action: {
            in: ['inquiry.manager.assigned', 'inquiry.engineer.assigned'],
          },
        },
      });
      expect(
        auditRows.filter(({ outcome }) => outcome === 'SUCCESS'),
      ).toHaveLength(1);
      expect(
        auditRows.filter(({ outcome }) => outcome === 'DENIED'),
      ).toHaveLength(1);
    });

    it('REQB-12/20: staff command replay is denied after the actor loses inquiry scope', async () => {
      const created = await createInquiry();
      const reference = data<{ publicReference: string }>(
        created,
      ).publicReference;
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      const assigned = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/inquiries/${inquiry.id}/manager`,
        { staffUserId: assignedEditor.id },
        `inq-scope-assign-${randomUUID()}`,
        '"1"',
      );
      expect(assigned.status).toBe(200);
      const key = `inq-scope-replay-${randomUUID()}`;
      const payload = {
        stageDueAt: new Date(Date.now() + 3600_000).toISOString(),
      };
      const initial = await assignedEditor.agent.write(
        'PUT',
        `/v1/staff/inquiries/${inquiry.id}/stage-deadline`,
        payload,
        key,
        '"2"',
      );
      expect(initial.status).toBe(200);
      await ownerDb!.inquiry.update({
        where: { id: inquiry.id },
        data: { assignedManagerUserId: null, version: 3 },
      });
      const replay = await assignedEditor.agent.write(
        'PUT',
        `/v1/staff/inquiries/${inquiry.id}/stage-deadline`,
        payload,
        key,
        '"2"',
      );
      expect(replay.status).toBe(404);
      expect(
        await ownerDb!.inquiryCommandIdempotency.count({
          where: {
            actorKind: 'STAFF',
            actorStaffUserId: assignedEditor.id,
            operationScope: 'staff:setInquiryStageDeadline',
          },
        }),
      ).toBe(1);
    });

    it('REQB-29/30/37/38/41: all typed pre-quote closure reasons are terminal and do not create quotes or orders', async () => {
      const cases = [
        { reasonCode: 'DUPLICATE', target: 'NEW', path: [] as string[] },
        {
          reasonCode: 'CUSTOMER_WITHDRAWN',
          target: 'TRIAGE',
          path: ['TRIAGE'],
        },
        {
          reasonCode: 'OUT_OF_SCOPE',
          target: 'NEEDS_CLARIFICATION',
          path: ['TRIAGE', 'NEEDS_CLARIFICATION'],
        },
        {
          reasonCode: 'SPAM',
          target: 'ENGINEERING_REVIEW',
          path: ['TRIAGE', 'ENGINEERING_REVIEW'],
        },
        {
          reasonCode: 'NOT_FEASIBLE',
          target: 'READY_FOR_QUOTE',
          path: ['TRIAGE', 'ENGINEERING_REVIEW', 'READY_FOR_QUOTE'],
        },
      ];
      for (const { reasonCode, target, path } of cases) {
        const created = await createInquiry();
        const publicReference = data<{ publicReference: string }>(
          created,
        ).publicReference;
        const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
          where: { publicReference },
        });
        const manager = await fullActor.agent.write(
          'PATCH',
          `/v1/staff/inquiries/${inquiry.id}/manager`,
          { staffUserId: assignedReader.id },
          `inq-close-manager-${reasonCode}-${randomUUID()}`,
          '"1"',
        );
        expect(manager.status).toBe(200);
        const engineer = await fullActor.agent.write(
          'PATCH',
          `/v1/staff/inquiries/${inquiry.id}/engineer`,
          { staffUserId: assignedReader.id },
          `inq-close-engineer-${reasonCode}-${randomUUID()}`,
          '"2"',
        );
        expect(engineer.status).toBe(200);
        let version = 3;
        let from = 'NEW';
        for (const to of path) {
          const reason =
            to === 'TRIAGE'
              ? 'TRIAGE_STARTED'
              : to === 'NEEDS_CLARIFICATION'
                ? 'MORE_INFORMATION_REQUIRED'
                : to === 'ENGINEERING_REVIEW'
                  ? 'ENGINEERING_STARTED'
                  : 'ENGINEERING_COMPLETE';
          const moved = await fullActor.agent.write(
            'POST',
            `/v1/staff/inquiries/${inquiry.id}/transition`,
            { toStatus: to, reasonCode: reason },
            `inq-close-pre-${reasonCode}-${randomUUID()}`,
            `"${version}"`,
          );
          expect(moved.status, JSON.stringify(moved.body)).toBe(200);
          version++;
          from = to;
        }
        expect(from).toBe(target);
        const due = await fullActor.agent.write(
          'PUT',
          `/v1/staff/inquiries/${inquiry.id}/stage-deadline`,
          { stageDueAt: new Date(Date.now() + 3600_000).toISOString() },
          `inq-close-due-${reasonCode}-${randomUUID()}`,
          `"${version}"`,
        );
        expect(due.status).toBe(200);
        version++;
        const key = `inq-close-${reasonCode}-${randomUUID()}`;
        const result = await fullActor.agent.write(
          'POST',
          `/v1/staff/inquiries/${inquiry.id}/transition`,
          { toStatus: 'CLOSED', reasonCode },
          key,
          `"${version}"`,
        );
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        const replay = await fullActor.agent.write(
          'POST',
          `/v1/staff/inquiries/${inquiry.id}/transition`,
          { toStatus: 'CLOSED', reasonCode },
          key,
          `"${version}"`,
        );
        expect(replay.body).toEqual(result.body);
        const row = await ownerDb!.inquiry.findUniqueOrThrow({
          where: { id: inquiry.id },
        });
        expect(row.status).toBe('CLOSED');
        expect(row.version).toBe(version + 1);
        expect(row.stageDueAt).toBeNull();
        const reopen = await fullActor.agent.write(
          'POST',
          `/v1/staff/inquiries/${inquiry.id}/transition`,
          { toStatus: 'TRIAGE', reasonCode: 'TRIAGE_STARTED' },
          `inq-reopen-${randomUUID()}`,
          `"${version + 1}"`,
        );
        expect(reopen.status).toBe(409);
        const terminalDeadline = await fullActor.agent.write(
          'PUT',
          '/v1/staff/inquiries/' + inquiry.id + '/stage-deadline',
          { stageDueAt: new Date(Date.now() + 3600_000).toISOString() },
          'inq-terminal-deadline-' + randomUUID(),
          '"' + (version + 1) + '"',
        );
        expect(terminalDeadline.status).toBe(409);
        expect(terminalDeadline.body.code).toBe('INVALID_STATE_TRANSITION');
        const terminalDeadlineAudit =
          await ownerDb!.auditEvent.findFirstOrThrow({
            where: {
              action: 'inquiry.stage_deadline.changed',
              entityId: inquiry.id,
              outcome: 'DENIED',
              reasonCode: 'INVALID_STATE_TRANSITION',
            },
          });
        expect(terminalDeadlineAudit.entityId).toBe(inquiry.id);
        const closureAudit = await ownerDb!.auditEvent.findFirstOrThrow({
          where: {
            action: 'inquiry.closed_without_quote',
            entityId: inquiry.id,
            outcome: 'SUCCESS',
          },
        });
        expect(closureAudit.reasonCode).toBe(reasonCode);
      }
      const tables = await ownerDb!.$queryRaw<
        { quoteTables: string[] }[]
      >`SELECT tablename AS "quoteTables" FROM pg_tables WHERE schemaname='public' AND tablename IN ('sales_order','quote','quote_revision')`;
      expect(tables).toHaveLength(0);
    });

    it('REQB-26/32/41: QUOTE_SENT remains quote-lifecycle owned and stale concurrent closure has one success audit', async () => {
      const created = await createInquiry();
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const invalidQuote = await fullActor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/transition`,
        { toStatus: 'QUOTE_SENT', reasonCode: 'QUOTE_SENT' },
        `inq-quote-forbidden-${randomUUID()}`,
        '"1"',
      );
      expect(invalidQuote.status).toBe(400);
      expect(invalidQuote.body.code).toBe('VALIDATION_ERROR');
      const [left, right] = await Promise.all([
        fullActor.agent.write(
          'POST',
          `/v1/staff/inquiries/${inquiry.id}/transition`,
          { toStatus: 'CLOSED', reasonCode: 'SPAM' },
          `inq-close-race-a-${randomUUID()}`,
          '"1"',
        ),
        fullActor.agent.write(
          'POST',
          `/v1/staff/inquiries/${inquiry.id}/transition`,
          { toStatus: 'CLOSED', reasonCode: 'DUPLICATE' },
          `inq-close-race-b-${randomUUID()}`,
          '"1"',
        ),
      ]);
      expect([left.status, right.status].sort()).toEqual([200, 409]);
      const auditRows = await ownerDb!.auditEvent.findMany({
        where: { entityId: inquiry.id, action: 'inquiry.closed_without_quote' },
      });
      expect(
        auditRows.filter(({ outcome }) => outcome === 'SUCCESS'),
      ).toHaveLength(1);
      expect(
        auditRows.filter(({ outcome }) => outcome === 'DENIED'),
      ).toHaveLength(1);
      const noAssignedScope = await assignedEditor.agent.write(
        'POST',
        `/v1/staff/inquiries/${inquiry.id}/transition`,
        { toStatus: 'CLOSED', reasonCode: 'SPAM' },
        `inq-close-scope-${randomUUID()}`,
        '"2"',
      );
      expect(noAssignedScope.status).toBe(404);
      expect(
        (
          await ownerDb!.inquiry.findUniqueOrThrow({
            where: { id: inquiry.id },
          })
        ).status,
      ).toBe('CLOSED');
    });

    it('REQB-14/15: only document metadata is readable and no download is possible while files are quarantined', async () => {
      const inquiry = await ownerDb!.inquiry.findFirstOrThrow({
        where: { sourceDocuments: { some: {} } },
      });
      const documents = await fullActor.agent.request(
        'GET',
        `/v1/staff/inquiries/${inquiry.id}/documents`,
      );
      expect(documents.status).toBe(200);
      const first = (documents.body.data as Json[])[0]!;
      expect(first.securityState).toBe('QUARANTINED');
      expect(first).not.toHaveProperty('storageKey');
      const denied = await fullActor.agent.request(
        'GET',
        `/v1/staff/inquiries/${inquiry.id}/documents/${String(first.id)}/download`,
      );
      expect(denied.status).toBe(404);
      expect(denied.body.code).toBe('FILE_NOT_ACCESSIBLE');
    });

    it('REQB-22: CLEAN download requires inquiry scope and both document permissions, and streams protected bytes', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('clean download boundary'),
        uploadCapability: capability,
      });
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const bytes = minimalPdf();
      const intent = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'clean-fixture.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: bytes.length,
        },
        {
          'Idempotency-Key': `inq-clean-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      const intentId = String(obj(intent.body.data).intentId);
      const uploaded = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
        bytes,
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': `inq-clean-upload-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
      const document = await ownerDb!.inquirySourceDocument.findFirstOrThrow({
        where: { inquiryId: inquiry.id },
      });
      await ownerDb!.inquirySourceDocument.update({
        where: { id: document.id },
        data: { safetyState: 'CLEAN' },
      });
      const path = `/v1/staff/inquiries/${inquiry.id}/documents/${document.id}/download`;
      const missingReadPermission = await makeActor(
        ['inquiries.read_all', 'inquiries.documents.download'],
        'download-only',
      );
      const missingDownloadPermission = await makeActor(
        ['inquiries.read_all', 'inquiries.documents.read'],
        'read-only-documents',
      );
      const outOfScope = await makeActor(
        [
          'inquiries.read_assigned',
          'inquiries.documents.read',
          'inquiries.documents.download',
        ],
        'assigned-documents',
      );
      expect(
        (await missingReadPermission.agent.request('GET', path)).status,
      ).toBe(403);
      expect(
        (await missingDownloadPermission.agent.request('GET', path)).status,
      ).toBe(403);
      expect((await outOfScope.agent.request('GET', path)).status).toBe(404);
      const download = await fullActor.agent.request('GET', path);
      expect(download.status, JSON.stringify(download.body)).toBe(200);
      expect(download.rawBody).toBe(bytes.toString('utf8'));
      expect(download.headers.get('cache-control')).toContain('no-store');
      expect(download.headers.get('content-disposition')).toMatch(
        /^attachment;/,
      );
      expect(download.headers.get('x-content-type-options')).toBe('nosniff');
      const successAuditsBeforeMissingObject = await ownerDb!.auditEvent.count({
        where: {
          action: 'inquiry.document.downloaded',
          entityId: document.id,
          outcome: 'SUCCESS',
        },
      });
      await new PrivateFileStorage().removeInquiryQuarantineObject(
        document.storageKey,
      );
      const missingObject = await fullActor.agent.request('GET', path);
      expect(missingObject.status).toBe(503);
      expect(
        await ownerDb!.auditEvent.count({
          where: {
            action: 'inquiry.document.downloaded',
            entityId: document.id,
            outcome: 'SUCCESS',
          },
        }),
      ).toBe(successAuditsBeforeMissingObject);
      expect(
        (
          await fullActor.agent.request(
            'GET',
            '/v1/staff/inquiries/' + inquiry.id + '/documents',
          )
        ).status,
      ).toBe(200);
    });

    it('REQB-21: scanner state is not writable by the API runtime and original document fields remain immutable', async () => {
      const capability = randomBytes(32).toString('base64url');
      const created = await createInquiry({
        ...equipmentPayload('scanner boundary'),
        uploadCapability: capability,
      });
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: {
          publicReference: data<{ publicReference: string }>(created)
            .publicReference,
        },
      });
      const pdf = minimalPdf();
      const intent = await publicRequest(
        'POST',
        `/v1/public/inquiry-attachments/upload-intents`,
        {
          filename: 'scanner.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: pdf.length,
        },
        {
          'Idempotency-Key': `inq-scanner-intent-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      const intentId = String(obj(intent.body.data).intentId);
      const upload = await publicRequest(
        'PUT',
        `/v1/public/inquiry-attachments/upload-intents/${intentId}/content`,
        pdf,
        {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': `inq-scanner-upload-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': capability,
        },
      );
      expect(upload.status, JSON.stringify(upload.body)).toBe(201);
      const document = await ownerDb!.inquirySourceDocument.findFirstOrThrow({
        where: { inquiryId: inquiry.id },
      });
      await expect(
        runtimeDb!.inquirySourceDocument.update({
          where: { id: document.id },
          data: { safetyState: 'CLEAN' },
        }),
      ).rejects.toThrow();
      await expect(
        runtimeDb!.inquirySourceDocument.create({
          data: {
            id: randomUUID(),
            inquiryId: document.inquiryId,
            uploadIntentId: document.uploadIntentId,
            uploaderKind: 'ANONYMOUS',
            uploadChannel: 'PUBLIC_WEB',
            storageKey: randomBytes(32).toString('hex'),
            sha256: document.sha256,
            sizeBytes: document.sizeBytes,
            detectedMimeType: document.detectedMimeType,
            originalFilename: document.originalFilename,
            safetyState: 'CLEAN',
            uploadedAt: document.uploadedAt,
          },
        }),
      ).rejects.toThrow(/INQUIRY_SOURCE_DOCUMENT_INITIAL_STATE_INVALID/);
      await ownerDb!.inquirySourceDocument.update({
        where: { id: document.id },
        data: { safetyState: 'CLEAN' },
      });
      await expect(
        ownerDb!.inquirySourceDocument.update({
          where: { id: document.id },
          data: { originalFilename: 'changed.pdf' },
        }),
      ).rejects.toThrow(/INQUIRY_SOURCE_DOCUMENT_IMMUTABLE/);
      expect(
        (
          await ownerDb!.inquirySourceDocument.findUniqueOrThrow({
            where: { id: document.id },
          })
        ).safetyState,
      ).toBe('CLEAN');
    });

    it('REQB-17/24: bounded cleanup deletes only expired idempotency receipts and leaves domain history intact', async () => {
      const created = await createInquiry(
        equipmentPayload('idempotency cleanup sentinel'),
      );
      const reference = data<{ publicReference: string }>(
        created,
      ).publicReference;
      const inquiry = await ownerDb!.inquiry.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      const now = Date.now();
      const createdAt = new Date(now - 60 * 86400_000);
      const expiresAt = new Date(createdAt.getTime() + 29 * 86400_000);
      const expiredData = Array.from({ length: 501 }, () => ({
        id: randomUUID(),
        actorKind: 'PUBLIC',
        actorStaffUserId: null,
        operationScope: 'test:expired-cleanup',
        idempotencyKeyHash: new Uint8Array(randomBytes(32)),
        requestHash: new Uint8Array(randomBytes(32)),
        httpStatus: 201,
        responseReceipt: {
          data: { accepted: true },
          meta: { requestId: randomUUID() },
        },
        createdAt,
        expiresAt,
      }));
      const expiredIds = expiredData.map(({ id }) => id);
      await ownerDb!.inquiryCommandIdempotency.createMany({
        data: expiredData,
      });
      const activeCleanupId = randomUUID();
      await ownerDb!.inquiryCommandIdempotency.create({
        data: {
          id: activeCleanupId,
          actorKind: 'PUBLIC',
          actorStaffUserId: null,
          operationScope: 'test:active-cleanup',
          idempotencyKeyHash: new Uint8Array(randomBytes(32)),
          requestHash: new Uint8Array(randomBytes(32)),
          httpStatus: 201,
          responseReceipt: {
            data: { accepted: true },
            meta: { requestId: randomUUID() },
          },
          createdAt: new Date(now),
          expiresAt: new Date(now + 86400_000),
        },
      });
      const oldIntentId = randomUUID();
      await ownerDb!.inquiryUploadIntent.create({
        data: {
          id: oldIntentId,
          inquiryId: inquiry.id,
          state: 'EXPIRED',
          safeFilename: 'expired.csv',
          declaredMimeType: 'text/csv',
          declaredSizeBytes: 1n,
          expectedSha256: null,
          expiresAt,
          version: 1,
          createdAt,
        },
      });
      const receivingIntentId = randomUUID();
      const receivingStartedAt = new Date(Date.now() - 16 * 60_000);
      const receivingDeadlineAt = new Date(
        receivingStartedAt.getTime() + 15 * 60_000,
      );
      await ownerDb!.inquiryUploadIntent.create({
        data: {
          id: receivingIntentId,
          inquiryId: inquiry.id,
          state: 'RECEIVING',
          safeFilename: 'abandoned.pdf',
          declaredMimeType: 'application/pdf',
          declaredSizeBytes: 100n,
          expectedSha256: null,
          expiresAt: new Date(Date.now() - 60_000),
          receivingStartedAt,
          receivingDeadlineAt,
          version: 2,
        },
      });
      const cleanup = Reflect.get(
        app!.get(InquiriesService),
        'cleanupExpiredCommandRecords',
      ) as () => Promise<void>;
      await cleanup.call(app!.get(InquiriesService));
      expect(
        await ownerDb!.inquiryCommandIdempotency.count({
          where: { id: { in: expiredIds } },
        }),
      ).toBe(1);
      expect(
        await ownerDb!.inquiryCommandIdempotency.findUnique({
          where: { id: activeCleanupId },
        }),
      ).not.toBeNull();
      await cleanup.call(app!.get(InquiriesService));
      expect(
        await ownerDb!.inquiryCommandIdempotency.count({
          where: { id: { in: expiredIds } },
        }),
      ).toBe(0);
      const cleanupIntents = Reflect.get(
        app!.get(InquiriesService),
        'cleanupInquiryIntents',
      ) as () => Promise<void>;
      await cleanupIntents.call(app!.get(InquiriesService));
      expect(
        await ownerDb!.inquiryUploadIntent.findUnique({
          where: { id: oldIntentId },
        }),
      ).toBeNull();
      const abandoned = await ownerDb!.inquiryUploadIntent.findUniqueOrThrow({
        where: { id: receivingIntentId },
      });
      expect(abandoned.state).toBe('FAILED');
      expect(abandoned.receivingStartedAt).toEqual(receivingStartedAt);
      expect(abandoned.receivingDeadlineAt).toEqual(receivingDeadlineAt);
      expect(
        await ownerDb!.auditEvent.count({
          where: {
            entityType: 'InquiryUploadIntent',
            entityId: receivingIntentId,
            action: 'inquiry.upload.rejected',
          },
        }),
      ).toBe(1);
      expect(
        await ownerDb!.inquiry.findUnique({ where: { id: inquiry.id } }),
      ).not.toBeNull();
      expect(
        await ownerDb!.auditEvent.count({
          where: { entityType: 'Inquiry', entityId: inquiry.id },
        }),
      ).toBe(1);
    });

    it('REQB-01/21: durable public create replay survives API restart and exact origin is enforced', async () => {
      const key = `inq-restart-${randomUUID()}`;
      const payload = equipmentPayload('Retried after restart');
      const initial = await createInquiry(payload, key);
      expect(initial.status).toBe(201);
      await app?.close();
      await startApi();
      const replay = await createInquiry(payload, key);
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(initial.body);
      const wrongOrigin = await publicRequest(
        'POST',
        '/v1/public/inquiries',
        equipmentPayload(),
        {
          'Idempotency-Key': `inq-origin-${randomUUID()}`,
          Origin: 'https://attacker.invalid',
        },
      );
      expect(wrongOrigin.status).toBe(403);
      expect(
        await ownerDb!.inquiry.count({
          where: {
            contactSnapshot: { path: ['contactName'], equals: 'Alex Buyer' },
          },
        }),
      ).toBeGreaterThan(0);
    });

    it('REQB-05/06/20: create retries replay at the source limit and spoofed X-Forwarded-For cannot evade it', async () => {
      const payload = equipmentPayload('source rate boundary');
      const existingMatches = await ownerDb!.inquiry.count({
        where: {
          contactSnapshot: { path: ['contactName'], equals: 'Alex Buyer' },
        },
      });
      const firstKey = `inq-rate-first-${randomUUID()}`;
      const first = await createInquiry(payload, firstKey);
      expect(first.status).toBe(201);
      for (let index = 1; index < 5; index++)
        expect(
          (await createInquiry(equipmentPayload(`source rate ${index}`)))
            .status,
        ).toBe(201);
      const blocked = await publicRequest(
        'POST',
        '/v1/public/inquiries',
        equipmentPayload('spoofed address'),
        {
          'Idempotency-Key': `inq-rate-blocked-${randomUUID()}`,
          'X-Forwarded-For': `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
        },
      );
      expect(blocked.status).toBe(429);
      const replay = await publicRequest(
        'POST',
        '/v1/public/inquiries',
        payload,
        {
          'Idempotency-Key': firstKey,
          'X-Forwarded-For': '203.0.113.250',
        },
      );
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(first.body);
      expect(
        await ownerDb!.inquiry.count({
          where: {
            contactSnapshot: { path: ['contactName'], equals: 'Alex Buyer' },
          },
        }),
      ).toBe(existingMatches + 5);
    });
  },
);
