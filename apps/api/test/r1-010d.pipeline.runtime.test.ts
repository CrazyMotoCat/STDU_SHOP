import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { IdentityCrypto } from '../src/identity/crypto.js';
import { canonicalJson } from '../src/inquiries/scan-protocol.js';
import { Client } from 'pg';

type Json = Record<string, unknown>;
type QueryRow = Record<string, unknown>;

const MiB = 1024 * 1024;
const origin = 'http://127.0.0.1:3000';
const runId = process.env.R1_010D_TEST_RUN_ID ?? 'local-unconfigured';
const profile = process.env.R1_010D_UPLOAD_PROFILE ?? 'MVP_SAFE';
const profileLimit = profile === 'ENGINEERING_DOCUMENTS' ? 50 * MiB : 10 * MiB;
const runtimeEnabled = Boolean(
  process.env.MIGRATION_DATABASE_URL &&
  process.env.STAFF_DATABASE_URL &&
  process.env.SCAN_DATABASE_URL &&
  process.env.SCAN_OPERATOR_DATABASE_URL &&
  process.env.R1_010D_API_URL &&
  process.env.R1_010D_TEST_RUN_ID,
);

let owner: Client | undefined;
let worker: Client | undefined;
let operator: Client | undefined;
let runtimePrisma: PrismaClient | undefined;
let testRedis: Redis | undefined;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for R1-010D runtime tests.`);
  return value;
}

function parseJson(text: string): Json {
  const value: unknown = text ? JSON.parse(text) : {};
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

async function publicRequest(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const requestHeaders = new Headers({
    Origin: origin,
    Accept: 'application/json',
    ...headers,
  });
  if (body !== undefined && !Buffer.isBuffer(body))
    requestHeaders.set('Content-Type', 'application/json');
  const response = await fetch(new URL(path, requiredEnv('R1_010D_API_URL')), {
    method,
    headers: requestHeaders,
    ...(body === undefined
      ? {}
      : {
          body: Buffer.isBuffer(body)
            ? (body as unknown as BodyInit)
            : JSON.stringify(body),
        }),
  });
  const raw = await response.text();
  return {
    status: response.status,
    body: parseJson(raw),
    headers: response.headers,
    raw,
  };
}

function data<T>(response: { body: Json }) {
  return response.body.data as T;
}

function minimalPdf(size?: number) {
  const build = (stream: Buffer) => {
    const parts: Buffer<ArrayBufferLike>[] = [
      Buffer.from('%PDF-1.7\n', 'ascii'),
    ];
    const offsets: number[] = [];
    let length = parts[0]!.length;
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    ];
    for (const object of objects) {
      offsets.push(length);
      const bytes = Buffer.from(object, 'ascii');
      parts.push(bytes);
      length += bytes.length;
    }
    offsets.push(length);
    const streamPrefix = Buffer.from(
      `4 0 obj\n<< /Length ${String(stream.length).padStart(12, '0')} >>\nstream\n`,
      'ascii',
    );
    const streamSuffix = Buffer.from('\nendstream\nendobj\n', 'ascii');
    parts.push(streamPrefix, stream, streamSuffix);
    length += streamPrefix.length + stream.length + streamSuffix.length;
    const xrefOffset = length;
    let xref = 'xref\n0 5\n0000000000 65535 f \n';
    for (const offset of offsets)
      xref += String(offset).padStart(10, '0') + ' 00000 n \n';
    xref +=
      'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n' +
      xrefOffset +
      '\n%%EOF\n';
    parts.push(Buffer.from(xref, 'ascii'));
    return Buffer.concat(parts);
  };

  const empty = build(Buffer.alloc(0));
  if (size === undefined) return empty;
  if (size < empty.length) throw new Error('PDF fixture size is too small.');
  let streamSize = size - empty.length;
  let content = build(Buffer.alloc(streamSize, 0x20));
  while (content.length > size) {
    streamSize -= content.length - size;
    if (streamSize < 0)
      throw new Error('PDF fixture could not reach its exact byte boundary.');
    content = build(Buffer.alloc(streamSize, 0x20));
  }
  return Buffer.concat([content, Buffer.alloc(size - content.length, 0x20)]);
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

function minimalXlsx(
  extraEntries: Array<{ name: string; data: Buffer }> = [],
  worksheetValue?: string,
) {
  const entries: Array<{ name: string; data: Buffer }> = [
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
      data: Buffer.from(
        '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
      ),
    },
  ];
  if (worksheetValue !== undefined) {
    entries[0]!.data = Buffer.from(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    );
    entries[1]!.data = Buffer.from(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    );
    entries[2]!.data = Buffer.from(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    );
    entries[3]!.data = Buffer.from(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    const escaped = worksheetValue
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    entries.push({
      name: 'xl/worksheets/sheet1.xml',
      data: Buffer.from(
        `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${escaped}</t></is></c></row></sheetData></worksheet>`,
      ),
    });
  }
  entries.push(...extraEntries);
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    local.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
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

function singleStoredZip(nameValue: string, data: Buffer) {
  const name = Buffer.from(nameValue, 'utf8');
  const crc = crc32(data);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  const centralOffset = localHeader.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralHeader.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([localHeader, name, data, centralHeader, name, end]);
}

function nestedArchive(depth: number) {
  let content = Buffer.from('r1-010d bounded archive depth fixture');
  for (let level = 0; level < depth; level++)
    content = singleStoredZip(`nested-${level}.zip`, content);
  return content;
}

// Equivalent to the nested Workbook/XZ scenario described in ClamAV issue 1848.
// Generated from CFB structures and the public EICAR test string only.
function oleWorkbookWithXz(oversized = true) {
  const free = 0xffffffff;
  const end = 0xfffffffe;
  const fatSector = 0xfffffffd;
  const header = Buffer.alloc(512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header);
  [0x3e, 3, 0xfffe, 9, 6].forEach((v, i) =>
    header.writeUInt16LE(v, 24 + i * 2),
  );
  [0, 1, 1, 0, 4096, end, 0, end, 0].forEach((v, i) =>
    header.writeUInt32LE(v, 40 + i * 4),
  );
  for (let i = 0; i < 109; i++)
    header.writeUInt32LE(i === 0 ? 0 : free, 76 + i * 4);
  const fat = Buffer.alloc(512, 0xff);
  [
    fatSector,
    end,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    end,
    11,
    12,
    13,
    14,
    15,
    16,
    17,
    end,
  ].forEach((v, i) => fat.writeUInt32LE(v, i * 4));
  const directory = Buffer.alloc(512);
  function entry(
    index: number,
    name: string,
    kind: number,
    right: number,
    child: number,
    start: number,
    size: number,
  ) {
    const offset = index * 128;
    const encoded = Buffer.from(`${name}\0`, 'utf16le');
    encoded.copy(directory, offset);
    directory.writeUInt16LE(encoded.length, offset + 64);
    directory.writeUInt8(kind, offset + 66);
    directory.writeUInt8(1, offset + 67);
    directory.writeUInt32LE(free, offset + 68);
    directory.writeUInt32LE(right, offset + 72);
    directory.writeUInt32LE(child, offset + 76);
    directory.writeUInt32LE(start, offset + 116);
    directory.writeBigUInt64LE(BigInt(size), offset + 120);
  }
  entry(0, 'Root Entry', 5, free, 1, end, 0);
  entry(1, 'Workbook', 2, 2, free, 2, 4096);
  entry(2, 'Data', 2, free, free, 10, 4096);
  const payload = Buffer.alloc(4096);
  const encoded = oversized
    ? '/Td6WFoAAAFpIt42AgAhASgAAADmoBGzAQBDWDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCoAPM9RaAABWET+51UjkEKZDQEAAAAAAVla'
    : '/Td6WFoAAAFpIt42AgAhAQgAAADYDyMTAQBDWDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCoAPM9RaAABWET+51UjkEKZDQEAAAAAAVla';
  Buffer.from(encoded, 'base64').copy(payload);
  return Buffer.concat([header, fat, directory, Buffer.alloc(4096), payload]);
}

async function createInquiry(label: string) {
  const capability = randomBytes(32).toString('base64url');
  const key = `r1-010d-create-${randomUUID()}`;
  const response = await publicRequest(
    'POST',
    '/v1/public/inquiries',
    {
      kind: 'EQUIPMENT',
      contact: {
        contactName: 'Generated scanner fixture',
        email: `scan-${randomUUID()}@example.invalid`,
        organization: 'Synthetic R1-010D test',
      },
      equipmentLines: [
        { rawTitle: `Generated ${label}`, quantity: '1', unit: 'pcs' },
      ],
      uploadCapability: capability,
    },
    { 'Idempotency-Key': key },
  );
  expect(response.status, response.raw).toBe(201);
  const receipt = data<{ publicReference: string }>(response);
  expect(receipt.publicReference).toBeTruthy();
  const found = await owner!.query<{ id: string }>(
    'SELECT id FROM inquiry WHERE public_reference=$1',
    [receipt.publicReference],
  );
  expect(found.rowCount).toBe(1);
  return { id: found.rows[0]!.id, capability, receipt };
}

async function uploadFixture(
  inquiry: { id: string; capability: string },
  fileName: string,
  mime: string,
  bytes: Buffer,
) {
  const intent = await publicRequest(
    'POST',
    '/v1/public/inquiry-attachments/upload-intents',
    { filename: fileName, declaredMimeType: mime, sizeBytes: bytes.length },
    {
      'Idempotency-Key': `r1-010d-intent-${randomUUID()}`,
      'X-Inquiry-Upload-Capability': inquiry.capability,
    },
  );
  expect(intent.status, intent.raw).toBe(201);
  const receipt = data<{ intentId: string; maxBytes: number }>(intent);
  expect(receipt.maxBytes).toBe(bytes.length);
  const uploaded = await publicRequest(
    'PUT',
    `/v1/public/inquiry-attachments/upload-intents/${receipt.intentId}/content`,
    bytes,
    {
      'Content-Type': 'application/octet-stream',
      'Idempotency-Key': `r1-010d-upload-${randomUUID()}`,
      'X-Inquiry-Upload-Capability': inquiry.capability,
    },
  );
  expect(uploaded.status, fileName + ': ' + uploaded.raw).toBe(201);
  const document = await owner!.query<QueryRow>(
    `SELECT d.id,d.inquiry_id,d.storage_key,d.sha256,d.size_bytes,d.safety_state,
            j.id AS job_id,j.status AS job_status,j.source_storage_key,
            j.source_sha256,j.source_size_bytes,j.version AS job_version,
            j.attempt_count
     FROM inquiry_source_document d
     JOIN inquiry_source_document_scan_job j ON j.source_document_id=d.id
     WHERE d.inquiry_id=$1 AND d.original_filename=$2`,
    [inquiry.id, fileName],
  );
  expect(document.rowCount).toBe(1);
  return document.rows[0]!;
}

async function deferOtherScanJobs(exceptJobId: string) {
  await owner!.query(
    `UPDATE inquiry_source_document_scan_job
     SET available_at=clock_timestamp()+interval '2 hours',
         lease_expires_at=CASE WHEN status='LEASED'
           THEN clock_timestamp()+interval '2 hours' ELSE lease_expires_at END
     WHERE id<>$1 AND status IN ('PENDING','RETRY_WAIT','LEASED')`,
    [exceptJobId],
  );
}

async function waitForDocumentJob(
  originalFilename: string,
  matches: (row: QueryRow) => boolean = () => true,
  timeoutMs = 60_000,
) {
  const deadline = Date.now() + timeoutMs;
  let row: QueryRow | undefined;
  while (Date.now() < deadline) {
    const result = await owner!.query<QueryRow>(
      `SELECT d.id,d.safety_state,j.id AS job_id,j.status,j.attempt_count,
              j.failure_code,j.version
       FROM inquiry_source_document d
       JOIN inquiry_source_document_scan_job j ON j.source_document_id=d.id
       WHERE d.original_filename=$1`,
      [originalFilename],
    );
    row = result.rows[0];
    if (row && matches(row)) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Scanner fixture was not found before timeout: ${JSON.stringify(row)}`,
  );
}

async function waitForBlockedQuery(
  applicationName: string,
  blockingPid: number,
  timeoutMs = 5000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await owner!.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE application_name=$1 AND wait_event_type='Lock'
           AND $2::integer=ANY(pg_blocking_pids(pid))
       ) AS blocked`,
      [applicationName, blockingPid],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `PostgreSQL did not expose the expected lock wait for ${applicationName}.`,
  );
}

class StaffAgent {
  private readonly cookies = new Map<string, string>();

  private remember(response: Response) {
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

  private async csrf() {
    const response = await fetch(
      new URL('/v1/staff/auth/csrf', requiredEnv('R1_010D_API_URL')),
      { headers: { Origin: origin } },
    );
    this.remember(response);
    const body = parseJson(await response.text());
    const token = record(body.data).token;
    if (typeof token !== 'string') throw new Error('Staff CSRF setup failed.');
    return token;
  }

  async request(method: string, path: string, body?: unknown) {
    const response = await this.requestRaw(method, path, body);
    return { status: response.status, body: parseJson(await response.text()) };
  }

  async requestRaw(method: string, path: string, body?: unknown) {
    const headers = new Headers({ Origin: origin, Accept: 'application/json' });
    if (method !== 'GET' && method !== 'HEAD') {
      headers.set('Content-Type', 'application/json');
      headers.set('X-CSRF-Token', await this.csrf());
    }
    if (this.cookies.size)
      headers.set(
        'Cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    const response = await fetch(
      new URL(path, requiredEnv('R1_010D_API_URL')),
      {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    this.remember(response);
    return response;
  }

  async login(email: string, password: string) {
    return this.request('POST', '/v1/staff/auth/login', { email, password });
  }
}

async function makeDownloadActor() {
  const id = randomUUID();
  const roleId = randomUUID();
  const email = `scan-${randomUUID()}@example.invalid`;
  const password = `R1-010D-${randomBytes(24).toString('base64url')}!`;
  const passwordHash = await new IdentityCrypto().hashPassword(password, email);
  await runtimePrisma!.$transaction(async (tx) => {
    await tx.role.create({
      data: {
        id: roleId,
        code: `r1-010d-${randomUUID().slice(0, 10)}`,
        name: 'R1-010D runtime verifier',
        state: 'ACTIVE',
      },
    });
    const codes = [
      'inquiries.read_all',
      'inquiries.contacts.read',
      'inquiries.documents.read',
      'inquiries.documents.download',
    ];
    const permissions = await tx.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    expect(permissions.map(({ code }) => code).sort()).toEqual(
      [...codes].sort(),
    );
    await tx.rolePermission.createMany({
      data: permissions.map(({ id: permissionId }) => ({
        roleId,
        permissionId,
      })),
    });
    await tx.staffUser.create({
      data: {
        id,
        email,
        emailNormalized: email,
        displayName: 'R1-010D runtime verifier',
        passwordHash,
        passwordChangeRequired: false,
        state: 'ACTIVE',
      },
    });
    await tx.userRole.create({ data: { staffUserId: id, roleId } });
  });
  const agent = new StaffAgent();
  const login = await agent.login(email, password);
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return agent;
}

async function waitForTerminalDocuments() {
  const deadline = Date.now() + 12 * 60_000;
  let rows: QueryRow[] = [];
  while (Date.now() < deadline) {
    const result = await owner!.query<QueryRow>(
      `SELECT d.id,d.inquiry_id,d.original_filename,d.safety_state,j.status,j.attempt_count,j.failure_code
       FROM inquiry_source_document d
       JOIN inquiry_source_document_scan_job j ON j.source_document_id=d.id
       WHERE d.original_filename LIKE $1 ORDER BY d.original_filename`,
      [`r1-010d-${runId}-%`],
    );
    rows = result.rows;
    if (
      rows.length &&
      rows.every((row) => ['COMPLETE', 'STOPPED'].includes(String(row.status)))
    )
      return rows;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Scanner jobs did not reach terminal states: ${JSON.stringify(rows)}`,
  );
}

async function clearPublicInquiryCreateRateKeys() {
  if (!testRedis) throw new Error('Disposable R1-010D Redis is not connected.');
  let cursor = '0';
  do {
    const [next, keys] = await testRedis.scan(
      cursor,
      'MATCH',
      'stdu:inquiry:create-*',
      'COUNT',
      '100',
    );
    cursor = next;
    if (keys.length) await testRedis.del(...keys);
  } while (cursor !== '0');
}

describe.skipIf(!runtimeEnabled)(
  'R1-010D isolated PostgreSQL/HTTP/ClamAV acceptance',
  () => {
    beforeAll(async () => {
      owner = new Client({
        connectionString: requiredEnv('MIGRATION_DATABASE_URL'),
      });
      worker = new Client({
        connectionString: requiredEnv('SCAN_DATABASE_URL'),
      });
      operator = new Client({
        connectionString: requiredEnv('SCAN_OPERATOR_DATABASE_URL'),
      });
      runtimePrisma = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: requiredEnv('MIGRATION_DATABASE_URL'),
        }),
      });
      testRedis = new Redis(requiredEnv('R1_010D_TEST_REDIS_URL'));
      await Promise.all([
        owner.connect(),
        worker.connect(),
        operator.connect(),
        testRedis.ping(),
      ]);
    });

    beforeEach(async () => clearPublicInquiryCreateRateKeys());

    afterAll(async () => {
      await Promise.all([
        owner?.end(),
        worker?.end(),
        operator?.end(),
        runtimePrisma?.$disconnect(),
        testRedis?.quit(),
      ]);
    });

    it('R1_010D_PINNED_CLAMD_FIXTURES emits generated test-only inputs', () => {
      const wrap = (data: Buffer) =>
        minimalXlsx([{ name: 'xl/embeddings/workbook.bin', data }]);
      const count = minimalXlsx(
        Array.from({ length: 10_100 }, (_, index) => ({
          name: `entries/${index}.txt`,
          data: Buffer.from('a'),
        })),
      );
      const eicar = Buffer.from(
        'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
        'ascii',
      );
      const sizedEntry = (size: number) => {
        const content = Buffer.alloc(size, 0x61);
        eicar.copy(content, content.length - eicar.length);
        return minimalXlsx([{ name: 'embedded/large.bin', data: content }]);
      };
      const fixtures = {
        DIRECT_EICAR: eicar,
        ZIP_EICAR: singleStoredZip('eicar.txt', eicar),
        XLSX_EICAR: minimalXlsx([], eicar.toString('ascii')),
        OLE_LIMIT: wrap(oleWorkbookWithXz()),
        OLE_EICAR: wrap(oleWorkbookWithXz(false)),
        FILE_COUNT: minimalXlsx([{ name: 'embedded/many.zip', data: count }]),
        FILE_SIZE_CONTROL: sizedEntry(MiB),
        FILE_SIZE: sizedEntry(64 * MiB + 1),
        SCAN_SIZE: minimalXlsx(
          Array.from({ length: 5 }, (_, index) => ({
            name: `embedded/expanded-${index}.bin`,
            data: Buffer.alloc(54 * MiB, 0x61 + index),
          })),
        ),
      };
      for (const [name, bytes] of Object.entries(fixtures))
        process.stdout.write(
          `R1_010D_GENERATED_${name}=${bytes.toString('base64')}\n`,
        );
    }, 120_000);

    it('R1_010D_UPLOAD profile bounds and atomic scan-job creation', async () => {
      const activeProfile = requiredEnv('R1_010D_UPLOAD_PROFILE');
      expect(activeProfile).toBe(profile);
      const inquiry = await createInquiry(`${activeProfile} upload batch`);
      const prefix = `r1-010d-${runId}-${activeProfile.toLowerCase()}`;
      const eicarFixture = Buffer.from(
        'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
      );
      expect(eicarFixture).toHaveLength(68);
      const oversized = await publicRequest(
        'POST',
        '/v1/public/inquiry-attachments/upload-intents',
        {
          filename: `${prefix}-over.pdf`,
          declaredMimeType: 'application/pdf',
          sizeBytes: profileLimit + 1,
        },
        {
          'Idempotency-Key': `r1-010d-over-${randomUUID()}`,
          'X-Inquiry-Upload-Capability': inquiry.capability,
        },
      );
      if (activeProfile === 'ENGINEERING_DOCUMENTS') {
        expect(oversized.status, JSON.stringify(oversized.body)).toBe(400);
        expect(oversized.body.code).toBe('VALIDATION_ERROR');
        expect(oversized.body.fields).toContainEqual({
          field: 'sizeBytes',
          code: 'INVALID',
        });
      } else {
        expect(oversized.status, JSON.stringify(oversized.body)).toBe(413);
        expect(oversized.body.code).toBe('FILE_TOO_LARGE');
      }

      const fixtures =
        activeProfile === 'MVP_SAFE'
          ? ([
              [`${prefix}-safe.pdf`, 'application/pdf', minimalPdf()],
              [
                `${prefix}-safe.csv`,
                'text/csv',
                Buffer.from('sku,quantity\nA-1,1\n'),
              ],
              [
                `${prefix}-safe.xlsx`,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                minimalXlsx([], 'synthetic safe'),
              ],
              [`${prefix}-eicar.csv`, 'text/csv', eicarFixture],
              [
                `${prefix}-boundary.pdf`,
                'application/pdf',
                minimalPdf(profileLimit),
              ],
            ] as const)
          : [
              [
                `${prefix}-boundary.pdf`,
                'application/pdf',
                minimalPdf(profileLimit),
              ] as const,
            ];

      const documents: QueryRow[] = [];
      for (const [fileName, mime, bytes] of fixtures)
        documents.push(await uploadFixture(inquiry, fileName, mime, bytes));
      expect(documents).toHaveLength(fixtures.length);
      for (const row of documents) {
        expect(row.safety_state).toBe('QUARANTINED');
        expect(row.job_status).toBe('PENDING');
        expect(row.storage_key).toBe(row.source_storage_key);
        expect(
          Buffer.from(row.sha256 as Buffer).equals(
            Buffer.from(row.source_sha256 as Buffer),
          ),
        ).toBe(true);
        expect(String(row.size_bytes)).toBe(String(row.source_size_bytes));
      }
      expect(inquiry.receipt).not.toHaveProperty('inquiryId');

      if (activeProfile === 'MVP_SAFE') {
        const depthInquiry = await createInquiry(
          `${activeProfile} archive recursion fixture`,
        );
        await uploadFixture(
          depthInquiry,
          `${prefix}-depth.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          minimalXlsx([
            { name: 'embedded/depth.zip', data: nestedArchive(12) },
          ]),
        );

        const manyFiles = minimalXlsx(
          Array.from({ length: 10_100 }, (_, index) => ({
            name: `entries/${index}.txt`,
            data: Buffer.from('a'),
          })),
        );
        await uploadFixture(
          depthInquiry,
          `${prefix}-file-count.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          minimalXlsx([{ name: 'embedded/many.zip', data: manyFiles }]),
        );

        await uploadFixture(
          depthInquiry,
          `${prefix}-ole-limit.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          minimalXlsx([
            {
              name: 'xl/embeddings/workbook.bin',
              data: oleWorkbookWithXz(),
            },
          ]),
        );
        await uploadFixture(
          depthInquiry,
          `${prefix}-cell-eicar.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          minimalXlsx([], eicarFixture.toString('ascii')),
        );

        const legacy =
          documents.find((row) =>
            String(row.original_filename ?? '').endsWith('-safe.pdf'),
          ) ??
          (
            await owner!.query<QueryRow>(
              `SELECT d.id,d.storage_key,d.sha256,d.size_bytes,d.safety_state
           FROM inquiry_source_document d WHERE d.inquiry_id=$1 AND d.original_filename=$2`,
              [inquiry.id, `${prefix}-safe.pdf`],
            )
          ).rows[0]!;
        const legacyId = String(legacy.id);
        await owner!.query(
          'DELETE FROM inquiry_source_document_scan_job WHERE source_document_id=$1',
          [legacyId],
        );
        const backfill = `
        INSERT INTO inquiry_source_document_scan_job (
          id,source_document_id,source_storage_key,source_sha256,source_size_bytes,
          status,attempt_count,version,available_at,created_at,updated_at
        )
        SELECT gen_random_uuid(),id,storage_key,sha256,size_bytes,
               'PENDING',0,1,transaction_timestamp(),transaction_timestamp(),transaction_timestamp()
        FROM inquiry_source_document WHERE safety_state='QUARANTINED'
        ON CONFLICT (source_document_id) DO NOTHING`;
        await owner!.query(backfill);
        await owner!.query(backfill);
        const restored = await owner!.query<QueryRow>(
          `SELECT d.storage_key,d.sha256,d.size_bytes,d.safety_state,j.source_storage_key,
                j.source_sha256,j.source_size_bytes,j.status
         FROM inquiry_source_document d
         JOIN inquiry_source_document_scan_job j ON j.source_document_id=d.id
         WHERE d.id=$1`,
          [legacyId],
        );
        expect(restored.rowCount).toBe(1);
        expect(restored.rows[0]!.status).toBe('PENDING');
        expect(restored.rows[0]!.storage_key).toBe(
          restored.rows[0]!.source_storage_key,
        );
        expect(
          Buffer.from(restored.rows[0]!.sha256 as Buffer).equals(
            Buffer.from(restored.rows[0]!.source_sha256 as Buffer),
          ),
        ).toBe(true);
        expect(String(restored.rows[0]!.size_bytes)).toBe(
          String(restored.rows[0]!.source_size_bytes),
        );

        const recoveryInquiry = await createInquiry(
          `${activeProfile} recovery fixture`,
        );
        await uploadFixture(
          recoveryInquiry,
          `${prefix}-recovery.pdf`,
          'application/pdf',
          minimalPdf(),
        );
        const terminalInquiry = await createInquiry(
          `${activeProfile} historical fixture`,
        );
        const terminal = await uploadFixture(
          terminalInquiry,
          `${prefix}-historical.pdf`,
          'application/pdf',
          minimalPdf(),
        );
        await owner!.query(
          "UPDATE inquiry_source_document SET safety_state='CLEAN' WHERE id=$1",
          [String(terminal.id)],
        );
        await owner!.query(
          'DELETE FROM inquiry_source_document_scan_job WHERE source_document_id=$1',
          [String(terminal.id)],
        );
        await owner!.query(backfill);
        const terminalJob = await owner!.query(
          'SELECT 1 FROM inquiry_source_document_scan_job WHERE source_document_id=$1',
          [String(terminal.id)],
        );
        expect(terminalJob.rowCount).toBe(0);
        // Demonstrate the legacy risk on this disposable database only.
        const legacyActor = await makeDownloadActor();
        const legacyDownload = await legacyActor.requestRaw(
          'GET',
          `/v1/staff/inquiries/${terminalInquiry.id}/documents/${String(terminal.id)}/download`,
        );
        expect(legacyDownload.status).toBe(200);
        expect(legacyDownload.headers.get('content-type')).toContain(
          'application/pdf',
        );
        expect(Buffer.from(await legacyDownload.arrayBuffer())).toEqual(
          minimalPdf(),
        );
      }
    });

    it('R1_010D_DB_ROLE_BOUNDARIES grants only the four intended procedures', async () => {
      for (const client of [owner!, worker!, operator!])
        await client.query('SELECT 1');
      const workerCaps = await worker!.query<{
        can_read_authorized: boolean;
        can_claim: boolean;
        can_finalize: boolean;
        can_retry: boolean;
        can_select: boolean;
        can_update: boolean;
        can_update_source: boolean;
        can_update_source_safety_state: boolean;
      }>(`
      SELECT has_function_privilege(current_user,'inquiry_scan_claim(bytea,uuid)','EXECUTE') AS can_claim,
             has_function_privilege(current_user,'inquiry_scan_read_authorized(uuid,integer,bytea)','EXECUTE') AS can_read_authorized,
             has_function_privilege(current_user,'inquiry_scan_finalize(uuid,integer,bytea,text,text,bytea,bigint,text,text,timestamptz,bytea,integer,boolean,text,text,timestamptz,bytea,integer,boolean,integer,bytea,uuid)','EXECUTE') AS can_finalize,
             has_function_privilege(current_user,'inquiry_scan_retry(uuid,integer,text,text,uuid)','EXECUTE') AS can_retry,
             has_table_privilege(current_user,'inquiry_source_document_scan_job','SELECT') AS can_select,
             has_table_privilege(current_user,'inquiry_source_document_scan_job','UPDATE') AS can_update,
             has_table_privilege(current_user,'inquiry_source_document','UPDATE') AS can_update_source,
             has_column_privilege(current_user,'inquiry_source_document','safety_state','UPDATE') AS can_update_source_safety_state`);
      expect(workerCaps.rows[0]).toMatchObject({
        can_claim: true,
        can_read_authorized: false,
        can_finalize: true,
        can_retry: false,
        can_select: false,
        can_update: false,
        can_update_source: false,
        can_update_source_safety_state: false,
      });
      const operatorCaps = await operator!.query<{
        can_retry: boolean;
        can_claim: boolean;
        can_read_authorized: boolean;
        can_finalize: boolean;
        can_select: boolean;
        can_update: boolean;
        can_update_source: boolean;
        can_update_source_safety_state: boolean;
      }>(`
      SELECT has_function_privilege(current_user,'inquiry_scan_retry(uuid,integer,text,text,uuid)','EXECUTE') AS can_retry,
             has_function_privilege(current_user,'inquiry_scan_claim(bytea,uuid)','EXECUTE') AS can_claim,
             has_function_privilege(current_user,'inquiry_scan_read_authorized(uuid,integer,bytea)','EXECUTE') AS can_read_authorized,
             has_function_privilege(current_user,'inquiry_scan_finalize(uuid,integer,bytea,text,text,bytea,bigint,text,text,timestamptz,bytea,integer,boolean,text,text,timestamptz,bytea,integer,boolean,integer,bytea,uuid)','EXECUTE') AS can_finalize,
             has_table_privilege(current_user,'inquiry_source_document_scan_job','SELECT') AS can_select,
             has_table_privilege(current_user,'inquiry_source_document_scan_job','UPDATE') AS can_update,
             has_table_privilege(current_user,'inquiry_source_document','UPDATE') AS can_update_source,
             has_column_privilege(current_user,'inquiry_source_document','safety_state','UPDATE') AS can_update_source_safety_state`);
      expect(operatorCaps.rows[0]).toMatchObject({
        can_retry: true,
        can_claim: false,
        can_read_authorized: false,
        can_finalize: false,
        can_select: false,
        can_update: false,
        can_update_source: false,
        can_update_source_safety_state: false,
      });
      const runtime = new Client({
        connectionString: requiredEnv('STAFF_DATABASE_URL'),
      });
      await runtime.connect();
      try {
        const runtimeCaps = await runtime.query<{
          can_read: boolean;
          can_claim: boolean;
          can_finalize: boolean;
          can_retry: boolean;
          can_select: boolean;
          can_update: boolean;
          can_update_source: boolean;
          can_update_source_safety_state: boolean;
        }>(`
        SELECT has_function_privilege(current_user,'inquiry_scan_read_authorized(uuid,integer,bytea)','EXECUTE') AS can_read,
               has_function_privilege(current_user,'inquiry_scan_claim(bytea,uuid)','EXECUTE') AS can_claim,
               has_function_privilege(current_user,'inquiry_scan_finalize(uuid,integer,bytea,text,text,bytea,bigint,text,text,timestamptz,bytea,integer,boolean,text,text,timestamptz,bytea,integer,boolean,integer,bytea,uuid)','EXECUTE') AS can_finalize,
               has_function_privilege(current_user,'inquiry_scan_retry(uuid,integer,text,text,uuid)','EXECUTE') AS can_retry,
               has_table_privilege(current_user,'inquiry_source_document_scan_job','SELECT') AS can_select,
               has_table_privilege(current_user,'inquiry_source_document_scan_job','UPDATE') AS can_update,
               has_table_privilege(current_user,'inquiry_source_document','UPDATE') AS can_update_source,
               has_column_privilege(current_user,'inquiry_source_document','safety_state','UPDATE') AS can_update_source_safety_state`);
        expect(runtimeCaps.rows[0]).toMatchObject({
          can_read: true,
          can_claim: false,
          can_finalize: false,
          can_retry: false,
          can_select: false,
          can_update: false,
          can_update_source: false,
          can_update_source_safety_state: false,
        });
        await expect(
          runtime.query(
            "UPDATE inquiry_source_document SET safety_state='CLEAN' WHERE false",
          ),
        ).rejects.toThrow(/permission denied/i);
        const acl = await owner!.query<{
          public_can_update: boolean;
          public_column_can_update: boolean;
          definer_can_update: boolean;
          definer_column_can_update: boolean;
        }>(`
          SELECT COALESCE((
                   SELECT bool_or(privilege_type='UPDATE')
                   FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner)))
                   WHERE grantee=0
                 ),false) AS public_can_update,
                 COALESCE((
                   SELECT bool_or(privilege_type='UPDATE')
                   FROM aclexplode(a.attacl)
                   WHERE grantee=0
                 ),false) AS public_column_can_update,
                 has_table_privilege('stdu_scan_migration_owner','inquiry_source_document','UPDATE') AS definer_can_update,
                 has_column_privilege('stdu_scan_migration_owner','inquiry_source_document','safety_state','UPDATE') AS definer_column_can_update
          FROM pg_class c
          JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='safety_state'
          WHERE c.oid='public.inquiry_source_document'::regclass
        `);
        expect(acl.rows[0]).toEqual({
          public_can_update: false,
          public_column_can_update: false,
          definer_can_update: false,
          definer_column_can_update: true,
        });
        await expect(
          runtime.query(
            'SELECT * FROM inquiry_source_document_scan_job LIMIT 1',
          ),
        ).rejects.toThrow();
      } finally {
        await runtime.end();
      }
      await expect(
        worker!.query('SELECT * FROM inquiry_source_document_scan_job LIMIT 1'),
      ).rejects.toThrow();
      await expect(
        operator!.query(
          'SELECT * FROM inquiry_source_document_scan_job LIMIT 1',
        ),
      ).rejects.toThrow();
    });

    it('R1_010D_DB_PROCEDURES fences concurrent claims, exact replay, exhaustion, and operator OCC', async () => {
      const secondWorker = new Client({
        connectionString: requiredEnv('SCAN_DATABASE_URL'),
      });
      const secondOperator = new Client({
        connectionString: requiredEnv('SCAN_OPERATOR_DATABASE_URL'),
      });
      await Promise.all([secondWorker.connect(), secondOperator.connect()]);
      try {
        const recovery = await owner!.query<{ id: string; version: number }>(
          `SELECT j.id,j.version FROM inquiry_source_document_scan_job j
         JOIN inquiry_source_document d ON d.id=j.source_document_id
         WHERE d.original_filename=$1`,
          [`r1-010d-${runId}-mvp_safe-recovery.pdf`],
        );
        expect(recovery.rowCount).toBe(1);
        const recoveryJobId = recovery.rows[0]!.id;
        const recoveryTokenHash = randomBytes(32);
        await owner!.query(
          `UPDATE inquiry_source_document SET safety_state='SCAN_ERROR'
         WHERE id=(SELECT source_document_id FROM inquiry_source_document_scan_job WHERE id=$1)`,
          [recoveryJobId],
        );
        await owner!.query(
          `UPDATE inquiry_source_document_scan_job
         SET status='LEASED',attempt_count=5,version=5,lease_token_hash=$2,
             lease_expires_at=clock_timestamp()-interval '1 minute',failure_code=NULL,
             completed_job_version=NULL,completed_lease_token_hash=NULL,finalize_fingerprint=NULL,
             completed_at=NULL
         WHERE id=$1`,
          [recoveryJobId, recoveryTokenHash],
        );
        await worker!.query(
          'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
          [randomBytes(32), randomUUID()],
        );
        const stopped = await owner!.query<{
          status: string;
          version: number;
          safety_state: string;
        }>(
          `SELECT j.status,j.version,d.safety_state FROM inquiry_source_document_scan_job j
         JOIN inquiry_source_document d ON d.id=j.source_document_id WHERE j.id=$1`,
          [recoveryJobId],
        );
        expect(stopped.rows[0]).toMatchObject({
          status: 'STOPPED',
          version: 6,
          safety_state: 'SCAN_ERROR',
        });
        const exhaustionAudit = await owner!.query<{ count: string }>(
          `SELECT count(*) FROM audit_event
           WHERE action='inquiry.document.scan_job_control_changed'
             AND entity_id=$1 AND reason_code='SCAN_ATTEMPTS_EXHAUSTED'`,
          [recoveryJobId],
        );
        expect(exhaustionAudit.rows[0]!.count).toBe('1');

        const controlEventsBefore = await owner!.query<{ count: string }>(
          `SELECT count(*) FROM audit_event WHERE action='inquiry.document.scan_job_control_changed'
         AND entity_id=$1 AND reason_code='SCAN_OPERATOR_RETRY'`,
          [recoveryJobId],
        );
        await expect(
          operator!.query(
            'SELECT * FROM inquiry_scan_retry($1::uuid,$2::integer,$3::text,$4::text,$5::uuid)',
            [recoveryJobId, 6, null, 'ci/' + runId, randomUUID()],
          ),
        ).rejects.toThrow('INQUIRY_SCAN_RETRY_ARGUMENT_INVALID');
        const afterNullReason = await owner!.query<{
          status: string;
          version: number;
        }>(
          'SELECT status,version FROM inquiry_source_document_scan_job WHERE id=$1',
          [recoveryJobId],
        );
        expect(afterNullReason.rows[0]).toMatchObject({
          status: 'STOPPED',
          version: 6,
        });
        const retryEventsAfterNull = await owner!.query<{ count: string }>(
          "SELECT count(*) FROM audit_event WHERE action='inquiry.document.scan_job_control_changed'\n" +
            "AND entity_id=$1 AND reason_code='SCAN_OPERATOR_RETRY'",
          [recoveryJobId],
        );
        expect(retryEventsAfterNull.rows[0]!.count).toBe(
          controlEventsBefore.rows[0]!.count,
        );

        const retries = await Promise.allSettled([
          operator!.query(
            'SELECT * FROM inquiry_scan_retry($1::uuid,$2::integer,$3::text,$4::text,$5::uuid)',
            [recoveryJobId, 6, 'SCANNER_RESTORED', 'ci/' + runId, randomUUID()],
          ),
          secondOperator.query(
            'SELECT * FROM inquiry_scan_retry($1::uuid,$2::integer,$3::text,$4::text,$5::uuid)',
            [recoveryJobId, 6, 'SCANNER_RESTORED', `ci/${runId}`, randomUUID()],
          ),
        ]);
        expect(
          retries.filter((entry) => entry.status === 'fulfilled'),
        ).toHaveLength(1);
        expect(
          retries.filter((entry) => entry.status === 'rejected'),
        ).toHaveLength(1);
        const pending = await owner!.query<{
          status: string;
          attempt_count: number;
          version: number;
          safety_state: string;
        }>(
          `SELECT j.status,j.attempt_count,j.version,d.safety_state FROM inquiry_source_document_scan_job j
         JOIN inquiry_source_document d ON d.id=j.source_document_id WHERE j.id=$1`,
          [recoveryJobId],
        );
        expect(pending.rows[0]).toMatchObject({
          status: 'PENDING',
          attempt_count: 0,
          version: 7,
          safety_state: 'SCAN_ERROR',
        });
        const controlEventsAfter = await owner!.query<{ count: string }>(
          `SELECT count(*) FROM audit_event WHERE action='inquiry.document.scan_job_control_changed'
         AND entity_id=$1 AND reason_code='SCAN_OPERATOR_RETRY'`,
          [recoveryJobId],
        );
        expect(
          Number(controlEventsAfter.rows[0]!.count) -
            Number(controlEventsBefore.rows[0]!.count),
        ).toBe(1);
        const correlation = await owner!.query<{ changes: Json }>(
          `SELECT changes FROM audit_event WHERE action='inquiry.document.scan_job_control_changed'
         AND entity_id=$1 AND reason_code='SCAN_OPERATOR_RETRY' ORDER BY occurred_at DESC LIMIT 1`,
          [recoveryJobId],
        );
        expect(correlation.rows[0]!.changes).toMatchObject({
          correlationId: `ci/${runId}`,
          version: 7,
        });

        const firstWorker = new Client({
          connectionString: requiredEnv('SCAN_DATABASE_URL'),
        });
        const racingWorker = new Client({
          connectionString: requiredEnv('SCAN_DATABASE_URL'),
        });
        await Promise.all([firstWorker.connect(), racingWorker.connect()]);
        const raceTokenHashes = [randomBytes(32), randomBytes(32)] as const;
        let firstClaim: QueryRow | undefined;
        let secondClaim: QueryRow | undefined;
        try {
          const claims = await Promise.all([
            firstWorker.query<QueryRow>(
              'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
              [raceTokenHashes[0], randomUUID()],
            ),
            racingWorker.query<QueryRow>(
              'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
              [raceTokenHashes[1], randomUUID()],
            ),
          ]);
          const claimedIds = claims.flatMap((result) =>
            result.rows.map((row) => String(row.job_id)),
          );
          expect(claimedIds.length).toBe(2);
          expect(new Set(claimedIds).size).toBe(2);
          firstClaim = claims[0]!.rows[0];
          secondClaim = claims[1]!.rows[0];
        } finally {
          await Promise.all([firstWorker.end(), racingWorker.end()]);
        }
        const finalize = `SELECT * FROM inquiry_scan_finalize(
        $1::uuid,$2::integer,$3::bytea,$4::text,$5::text,$6::bytea,$7::bigint,
        $8::text,$9::text,$10::timestamptz,$11::bytea,$12::integer,$13::boolean,
        $14::text,$15::text,$16::timestamptz,$17::bytea,$18::integer,$19::boolean,
        $20::integer,$21::bytea,$22::uuid)`;
        const finalizeArgsFor = (claimed: QueryRow, tokenHash: Buffer) => {
          const fpInput = {
            jobId: String(claimed.job_id),
            sourceDocumentId: String(claimed.source_document_id),
            completedJobVersion: Number(claimed.job_version),
            leaseTokenHash: tokenHash.toString('hex'),
            sourceSha256: Buffer.from(
              claimed.expected_sha256 as Buffer,
            ).toString('hex'),
            sourceSizeBytes: String(claimed.expected_size_bytes),
            result: 'RETRY',
            failureCode: 'SCANNER_UNAVAILABLE',
            engineVersion: null,
            signatureDatabaseVersion: null,
            signatureDatabaseDate: null,
            signatureSetFingerprint: null,
            signatureAgeSeconds: null,
            startReady: false,
            endReady: false,
            scanDurationMs: 0,
          };
          const fingerprint = createHash('sha256')
            .update(canonicalJson(fpInput))
            .digest();
          return [
            String(claimed.job_id),
            Number(claimed.job_version),
            tokenHash,
            'RETRY',
            'SCANNER_UNAVAILABLE',
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            false,
            null,
            null,
            null,
            null,
            null,
            false,
            0,
            fingerprint,
            randomUUID(),
          ];
        };
        expect(firstClaim).toBeTruthy();
        expect(secondClaim).toBeTruthy();
        const staleArgs = finalizeArgsFor(firstClaim!, raceTokenHashes[0]);
        await owner!.query(
          "UPDATE inquiry_source_document_scan_job SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [String(firstClaim!.job_id)],
        );
        await expect(worker!.query(finalize, staleArgs)).rejects.toMatchObject({
          message: 'INQUIRY_SCAN_FENCING_CONFLICT',
        });
        const staleSource = await owner!.query<{ safety_state: string }>(
          `SELECT d.safety_state FROM inquiry_source_document d WHERE d.id=$1`,
          [String(firstClaim!.source_document_id)],
        );
        expect(staleSource.rows[0]!.safety_state).toBe('QUARANTINED');

        const claimed = secondClaim!;
        const finalizeArgs = finalizeArgsFor(claimed, raceTokenHashes[1]);
        const sourceAuditBefore = await owner!.query<{ count: string }>(
          `SELECT count(*) FROM audit_event WHERE action='inquiry.document.scan_state_changed'
         AND entity_id=$1`,
          [String(claimed.source_document_id)],
        );
        const finalized = await worker!.query<{
          job_status: string;
          replayed: boolean;
        }>(finalize, finalizeArgs);
        expect(finalized.rows[0]).toMatchObject({
          job_status: 'RETRY_WAIT',
          replayed: false,
        });
        const auditAfterFirst = await owner!.query<{ count: string }>(
          `SELECT count(*) FROM audit_event WHERE action='inquiry.document.scan_job_control_changed'
         AND entity_id=$1`,
          [String(claimed.job_id)],
        );
        const replay = await worker!.query<{
          job_status: string;
          replayed: boolean;
        }>(finalize, finalizeArgs);
        expect(replay.rows[0]).toMatchObject({
          job_status: 'RETRY_WAIT',
          replayed: true,
        });
        const auditAfterReplay = await owner!.query<{ count: string }>(
          `SELECT count(*) FROM audit_event WHERE action='inquiry.document.scan_job_control_changed'
         AND entity_id=$1`,
          [String(claimed.job_id)],
        );
        expect(auditAfterReplay.rows[0]!.count).toBe(
          auditAfterFirst.rows[0]!.count,
        );
        const sourceAuditAfter = await owner!.query<{ count: string }>(
          `SELECT count(*) FROM audit_event WHERE action='inquiry.document.scan_state_changed'
         AND entity_id=$1`,
          [String(claimed.source_document_id)],
        );
        expect(sourceAuditAfter.rows[0]!.count).toBe(
          sourceAuditBefore.rows[0]!.count,
        );
        await owner!.query(
          "UPDATE inquiry_source_document_scan_job SET available_at=clock_timestamp() WHERE id=$1 AND status='RETRY_WAIT'",
          [String(claimed.job_id)],
        );
        await owner!.query(
          `UPDATE inquiry_source_document_scan_job j SET lease_expires_at=clock_timestamp()-interval '1 second'
         FROM inquiry_source_document d WHERE d.id=j.source_document_id
           AND d.original_filename LIKE $1 AND j.status='LEASED'`,
          [`r1-010d-${runId}-%`],
        );
      } finally {
        await Promise.all([secondWorker.end(), secondOperator.end()]);
      }
    });

    it('R1_010D_DB_COMPLETENESS_POLICY denies a valid worker CLEAN without mutations', async () => {
      const inquiry = await createInquiry('completeness policy fixture');
      const bytes = minimalPdf(4096);
      const document = await uploadFixture(
        inquiry,
        `r1-010d-${runId}-completeness.pdf`,
        'application/pdf',
        bytes,
      );
      const jobId = String(document.job_id);
      await deferOtherScanJobs(jobId);
      const secondWorker = new Client({
        connectionString: requiredEnv('SCAN_DATABASE_URL'),
      });
      const runtime = new Client({
        connectionString: requiredEnv('STAFF_DATABASE_URL'),
      });
      await Promise.all([secondWorker.connect(), runtime.connect()]);
      try {
        const tokenHash = randomBytes(32);
        const claim = await worker!.query<QueryRow>(
          'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
          [tokenHash, randomUUID()],
        );
        expect(claim.rowCount).toBe(1);
        const row = claim.rows[0]!;
        expect(String(row.job_id)).toBe(jobId);
        const timestamp = new Date();
        const signatureFingerprint = createHash('sha256')
          .update(
            JSON.stringify(['ClamAV 1.4.6', '12345', timestamp.toISOString()]),
          )
          .digest();
        const finalize = `SELECT * FROM inquiry_scan_finalize(
          $1::uuid,$2::integer,$3::bytea,$4::text,$5::text,$6::bytea,$7::bigint,
          $8::text,$9::text,$10::timestamptz,$11::bytea,$12::integer,$13::boolean,
          $14::text,$15::text,$16::timestamptz,$17::bytea,$18::integer,$19::boolean,
          $20::integer,$21::bytea,$22::uuid)`;
        const argsFor = (result: 'CLEAN' | 'REJECTED') => {
          const canonical = {
            jobId,
            sourceDocumentId: String(row.source_document_id),
            completedJobVersion: Number(row.job_version),
            leaseTokenHash: tokenHash.toString('hex'),
            sourceSha256: Buffer.from(row.expected_sha256 as Buffer).toString(
              'hex',
            ),
            sourceSizeBytes: String(row.expected_size_bytes),
            result,
            failureCode: null,
            engineVersion: 'ClamAV 1.4.6',
            signatureDatabaseVersion: '12345',
            signatureDatabaseDate: timestamp.toISOString(),
            signatureSetFingerprint: signatureFingerprint.toString('hex'),
            signatureAgeSeconds: 0,
            startReady: true,
            endReady: true,
            scanDurationMs: 0,
          };
          return [
            jobId,
            Number(row.job_version),
            tokenHash,
            result,
            null,
            row.expected_sha256,
            row.expected_size_bytes,
            'ClamAV 1.4.6',
            '12345',
            timestamp,
            signatureFingerprint,
            0,
            true,
            'ClamAV 1.4.6',
            '12345',
            timestamp,
            signatureFingerprint,
            0,
            true,
            0,
            createHash('sha256').update(canonicalJson(canonical)).digest(),
            randomUUID(),
          ];
        };
        const snapshot = async () =>
          (
            await owner!.query(
              `SELECT j.status,j.version,d.safety_state,
            (SELECT count(*) FROM audit_event WHERE entity_id IN (j.id,d.id)) AS audit_count
           FROM inquiry_source_document_scan_job j JOIN inquiry_source_document d ON d.id=j.source_document_id
           WHERE j.id=$1`,
              [jobId],
            )
          ).rows[0];
        const before = await snapshot();
        const clean = argsFor('CLEAN');
        for (const call of [
          () => worker!.query(finalize, clean),
          () => worker!.query(finalize, clean),
        ])
          await expect(call()).rejects.toThrow(
            'INQUIRY_SCAN_COMPLETENESS_POLICY_DENIED',
          );
        const concurrent = await Promise.allSettled([
          worker!.query(finalize, clean),
          secondWorker.query(finalize, clean),
        ]);
        expect(
          concurrent.every(
            (x) =>
              x.status === 'rejected' &&
              String(x.reason).includes(
                'INQUIRY_SCAN_COMPLETENESS_POLICY_DENIED',
              ),
          ),
        ).toBe(true);
        const stale = [...clean];
        stale[1] = Number(row.job_version) - 1;
        await expect(worker!.query(finalize, stale)).rejects.toThrow(
          'INQUIRY_SCAN_COMPLETENESS_POLICY_DENIED',
        );
        await expect(runtime.query(finalize, clean)).rejects.toThrow(
          /permission denied/i,
        );
        await expect(operator!.query(finalize, clean)).rejects.toThrow(
          /permission denied/i,
        );
        expect(await snapshot()).toEqual(before);
        expect(before).toMatchObject({
          status: 'LEASED',
          safety_state: 'QUARANTINED',
        });
        const staff = await makeDownloadActor();
        const denied = await staff.request(
          'GET',
          `/v1/staff/inquiries/${String(inquiry.id)}/documents/${String(document.id)}/download`,
        );
        expect(denied.status).toBe(404);
        expect(denied.body.code).toBe('FILE_NOT_ACCESSIBLE');
        // The same lease and attestation must actually finalize a permitted result.
        const rejectedArgs = argsFor('REJECTED');
        const rejected = await worker!.query(finalize, rejectedArgs);
        expect(rejected.rows[0]).toMatchObject({ source_state: 'REJECTED' });
        const replay = await worker!.query(finalize, rejectedArgs);
        expect(replay.rows[0]).toMatchObject({
          source_state: 'REJECTED',
          replayed: true,
        });
        // Synthetic historical replay metadata: all three replay keys match
        // the CLEAN command, so the policy guard must precede replay itself.
        await owner!.query(
          'UPDATE inquiry_source_document_scan_job SET finalize_fingerprint=$2 WHERE id=$1',
          [jobId, clean[20]],
        );
        const beforeReplayDenial = await snapshot();
        await expect(worker!.query(finalize, clean)).rejects.toThrow(
          'INQUIRY_SCAN_COMPLETENESS_POLICY_DENIED',
        );
        expect(await snapshot()).toEqual(beforeReplayDenial);
      } finally {
        await Promise.all([secondWorker.end(), runtime.end()]);
      }
    });

    it('R1_010D_DB_SAME_ROW_LOCK_AND_AUDIT proves lease fencing and atomic failure', async () => {
      const inquiry = await createInquiry('same-row lock fixture');
      const document = await uploadFixture(
        inquiry,
        `r1-010d-${runId}-same-row.pdf`,
        'application/pdf',
        minimalPdf(4096),
      );
      const jobId = String(document.job_id);
      await deferOtherScanJobs(jobId);

      const claimantA = new Client({
        connectionString: requiredEnv('SCAN_DATABASE_URL'),
      });
      const claimantB = new Client({
        connectionString: requiredEnv('SCAN_DATABASE_URL'),
      });
      const blockerApp = `r1d_${randomUUID().replaceAll('-', '')}`;
      const blockedFinalizer = new Client({
        connectionString: requiredEnv('SCAN_DATABASE_URL'),
      });
      await Promise.all([
        claimantA.connect(),
        claimantB.connect(),
        blockedFinalizer.connect(),
      ]);
      await blockedFinalizer.query('SELECT set_config($1,$2,false)', [
        'application_name',
        blockerApp,
      ]);
      try {
        const tokenHashes = [randomBytes(32), randomBytes(32)] as const;
        let rowLockHeld = false;
        await owner!.query('BEGIN');
        rowLockHeld = true;
        try {
          await owner!.query(
            'SELECT id FROM inquiry_source_document_scan_job WHERE id=$1 FOR UPDATE',
            [jobId],
          );
          const skipped = await claimantA.query(
            'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
            [tokenHashes[0], randomUUID()],
          );
          expect(skipped.rowCount).toBe(0);
          await owner!.query('COMMIT');
          rowLockHeld = false;
        } finally {
          if (rowLockHeld) await owner!.query('ROLLBACK');
        }

        const concurrentClaims = await Promise.all([
          claimantA.query<QueryRow>(
            'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
            [tokenHashes[0], randomUUID()],
          ),
          claimantB.query<QueryRow>(
            'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
            [tokenHashes[1], randomUUID()],
          ),
        ]);
        const winners = concurrentClaims.flatMap((result, index) =>
          result.rows.map((row) => ({
            row,
            tokenHash: tokenHashes[index]!,
          })),
        );
        expect(winners).toHaveLength(1);
        const first = winners[0]!;
        expect(String(first.row.job_id)).toBe(jobId);

        const finalize = `SELECT * FROM inquiry_scan_finalize(
          $1::uuid,$2::integer,$3::bytea,$4::text,$5::text,$6::bytea,$7::bigint,
          $8::text,$9::text,$10::timestamptz,$11::bytea,$12::integer,$13::boolean,
          $14::text,$15::text,$16::timestamptz,$17::bytea,$18::integer,$19::boolean,
          $20::integer,$21::bytea,$22::uuid)`;
        const makeFinalizeArgs = (
          claimed: QueryRow,
          tokenHash: Buffer,
          requestId = randomUUID(),
          result = 'RETRY',
          failureCode: string | null = 'SCANNER_UNAVAILABLE',
        ) => {
          const canonicalResult = {
            jobId: String(claimed.job_id),
            sourceDocumentId: String(claimed.source_document_id),
            completedJobVersion: Number(claimed.job_version),
            leaseTokenHash: tokenHash.toString('hex'),
            sourceSha256: Buffer.from(
              claimed.expected_sha256 as Buffer,
            ).toString('hex'),
            sourceSizeBytes: String(claimed.expected_size_bytes),
            result,
            failureCode,
            engineVersion: null,
            signatureDatabaseVersion: null,
            signatureDatabaseDate: null,
            signatureSetFingerprint: null,
            signatureAgeSeconds: null,
            startReady: false,
            endReady: false,
            scanDurationMs: 0,
          };
          const fingerprint = createHash('sha256')
            .update(canonicalJson(canonicalResult))
            .digest();
          return [
            String(claimed.job_id),
            Number(claimed.job_version),
            tokenHash,
            result,
            failureCode,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            false,
            null,
            null,
            null,
            null,
            null,
            false,
            0,
            fingerprint,
            requestId,
          ];
        };

        const firstArgs = makeFinalizeArgs(first.row, first.tokenHash);
        const auditBeforeNullResult = await owner!.query<{ count: string }>(
          'SELECT count(*) FROM audit_event WHERE entity_id=$1',
          [jobId],
        );
        const nullResultArgs = [...firstArgs];
        nullResultArgs[3] = null;
        await expect(claimantA.query(finalize, nullResultArgs)).rejects.toThrow(
          'INQUIRY_SCAN_FINALIZE_ARGUMENT_INVALID',
        );
        const unchangedAfterNullResult = await owner!.query<{
          status: string;
          version: number;
          safety_state: string;
          audit_count: string;
        }>(
          'SELECT j.status,j.version,d.safety_state,\n' +
            '(SELECT count(*) FROM audit_event a WHERE a.entity_id=j.id) AS audit_count\n' +
            'FROM inquiry_source_document_scan_job j\n' +
            'JOIN inquiry_source_document d ON d.id=j.source_document_id WHERE j.id=$1',
          [jobId],
        );
        expect(unchangedAfterNullResult.rows[0]).toMatchObject({
          status: 'LEASED',
          version: Number(first.row.job_version),
          safety_state: 'QUARANTINED',
          audit_count: auditBeforeNullResult.rows[0]!.count,
        });
        let finalizeLockHeld = false;
        await owner!.query('BEGIN');
        finalizeLockHeld = true;
        try {
          const pidResult = await owner!.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid',
          );
          await owner!.query(
            'SELECT id FROM inquiry_source_document_scan_job WHERE id=$1 FOR UPDATE',
            [jobId],
          );
          const blocked = blockedFinalizer.query(finalize, [
            ...firstArgs.slice(0, -1),
            randomUUID(),
          ]);
          await waitForBlockedQuery(blockerApp, Number(pidResult.rows[0]!.pid));
          await owner!.query(
            `UPDATE inquiry_source_document_scan_job
             SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
            [jobId],
          );
          await owner!.query('COMMIT');
          finalizeLockHeld = false;
          await expect(blocked).rejects.toMatchObject({
            message: 'INQUIRY_SCAN_FENCING_CONFLICT',
          });
        } finally {
          if (finalizeLockHeld) await owner!.query('ROLLBACK');
        }

        const replacementTokenHash = randomBytes(32);
        const replacementResult = await claimantB.query<QueryRow>(
          'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
          [replacementTokenHash, randomUUID()],
        );
        expect(replacementResult.rowCount).toBe(1);
        const replacement = replacementResult.rows[0]!;
        expect(String(replacement.job_id)).toBe(jobId);
        expect(Number(replacement.job_version)).toBe(
          Number(first.row.job_version) + 1,
        );
        await expect(
          claimantA.query(finalize, firstArgs),
        ).rejects.toMatchObject({ message: 'INQUIRY_SCAN_FENCING_CONFLICT' });

        const requestId = randomUUID();
        const retryArgs = makeFinalizeArgs(
          replacement,
          replacementTokenHash,
          requestId,
        );
        const suffix = randomUUID().replaceAll('-', '');
        const triggerName = `r1_010d_fail_${suffix}`;
        const functionName = `r1_010d_fail_fn_${suffix}`;
        await owner!.query(`
          CREATE FUNCTION public.${functionName}() RETURNS trigger
          LANGUAGE plpgsql AS $body$
          BEGIN
            IF NEW.request_id='${requestId}'::uuid THEN
              RAISE EXCEPTION 'R1_010D_AUDIT_INJECTED_FAILURE';
            END IF;
            RETURN NEW;
          END;
          $body$;
          CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_event
          FOR EACH ROW EXECUTE FUNCTION public.${functionName}();
        `);
        try {
          await expect(
            blockedFinalizer.query(finalize, retryArgs),
          ).rejects.toThrow('R1_010D_AUDIT_INJECTED_FAILURE');
        } finally {
          await owner!.query(
            `DROP TRIGGER IF EXISTS ${triggerName} ON audit_event;
             DROP FUNCTION IF EXISTS public.${functionName}();`,
          );
        }
        const unchanged = await owner!.query<{
          status: string;
          version: number;
          safety_state: string;
          audit_count: string;
        }>(
          `SELECT j.status,j.version,d.safety_state,
                  (SELECT count(*) FROM audit_event a WHERE a.request_id=$2) AS audit_count
           FROM inquiry_source_document_scan_job j
           JOIN inquiry_source_document d ON d.id=j.source_document_id
           WHERE j.id=$1`,
          [jobId, requestId],
        );
        expect(unchanged.rows[0]).toMatchObject({
          status: 'LEASED',
          version: Number(replacement.job_version),
          safety_state: 'QUARANTINED',
          audit_count: '0',
        });

        const firstFinalize = await blockedFinalizer.query<{
          job_status: string;
          replayed: boolean;
        }>(finalize, retryArgs);
        expect(firstFinalize.rows[0]).toMatchObject({
          job_status: 'RETRY_WAIT',
          replayed: false,
        });
        const auditAfterFinalize = await owner!.query<{ count: string }>(
          `SELECT count(*) FROM audit_event WHERE action='inquiry.document.scan_job_control_changed'
           AND entity_id=$1`,
          [jobId],
        );
        const replay = await blockedFinalizer.query<{
          job_status: string;
          replayed: boolean;
        }>(finalize, retryArgs);
        expect(replay.rows[0]).toMatchObject({
          job_status: 'RETRY_WAIT',
          replayed: true,
        });
        const auditAfterReplay = await owner!.query<{ count: string }>(
          `SELECT count(*) FROM audit_event WHERE action='inquiry.document.scan_job_control_changed'
           AND entity_id=$1`,
          [jobId],
        );
        expect(auditAfterReplay.rows[0]!.count).toBe(
          auditAfterFinalize.rows[0]!.count,
        );
        const sourceAfterReplay = await owner!.query<{
          safety_state: string;
        }>('SELECT safety_state FROM inquiry_source_document WHERE id=$1', [
          String(replacement.source_document_id),
        ]);
        expect(sourceAfterReplay.rows[0]!.safety_state).toBe('QUARANTINED');

        const sourceAuditInquiry = await createInquiry(
          'source audit rollback fixture',
        );
        const sourceAuditDocument = await uploadFixture(
          sourceAuditInquiry,
          `r1-010d-${runId}-source-audit-rollback.pdf`,
          'application/pdf',
          minimalPdf(2048),
        );
        const sourceAuditJobId = String(sourceAuditDocument.job_id);
        await deferOtherScanJobs(sourceAuditJobId);
        const sourceAuditToken = randomBytes(32);
        const sourceAuditClaim = await claimantA.query<QueryRow>(
          'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
          [sourceAuditToken, randomUUID()],
        );
        expect(sourceAuditClaim.rowCount).toBe(1);
        const sourceAuditRequestId = randomUUID();
        const sourceAuditArgs = makeFinalizeArgs(
          sourceAuditClaim.rows[0]!,
          sourceAuditToken,
          sourceAuditRequestId,
          'SCAN_ERROR',
          'INTERNAL_ERROR',
        );
        const sourceTriggerSuffix = randomUUID().replaceAll('-', '');
        const sourceTriggerName = `r1_010d_source_audit_${sourceTriggerSuffix}`;
        const sourceFunctionName = `r1_010d_source_audit_fn_${sourceTriggerSuffix}`;
        await owner!.query(`
          CREATE FUNCTION public.${sourceFunctionName}() RETURNS trigger
          LANGUAGE plpgsql AS $body$
          BEGIN
            IF NEW.action='inquiry.document.scan_state_changed'
               AND NEW.request_id='${sourceAuditRequestId}'::uuid THEN
              RAISE EXCEPTION 'R1_010D_SOURCE_AUDIT_INJECTED_FAILURE';
            END IF;
            RETURN NEW;
          END;
          $body$;
          CREATE TRIGGER ${sourceTriggerName} BEFORE INSERT ON audit_event
          FOR EACH ROW EXECUTE FUNCTION public.${sourceFunctionName}();
        `);
        try {
          await expect(
            claimantA.query(finalize, sourceAuditArgs),
          ).rejects.toThrow('R1_010D_SOURCE_AUDIT_INJECTED_FAILURE');
        } finally {
          await owner!.query(
            `DROP TRIGGER IF EXISTS ${sourceTriggerName} ON audit_event;
             DROP FUNCTION IF EXISTS public.${sourceFunctionName}();`,
          );
        }
        const sourceAuditAfterFailure = await owner!.query<{
          status: string;
          version: number;
          safety_state: string;
          audit_count: string;
        }>(
          `SELECT j.status,j.version,d.safety_state,
                  (SELECT count(*) FROM audit_event a WHERE a.request_id=$2) AS audit_count
           FROM inquiry_source_document_scan_job j
           JOIN inquiry_source_document d ON d.id=j.source_document_id
           WHERE j.id=$1`,
          [sourceAuditJobId, sourceAuditRequestId],
        );
        expect(sourceAuditAfterFailure.rows[0]).toMatchObject({
          status: 'LEASED',
          version: Number(sourceAuditClaim.rows[0]!.job_version),
          safety_state: 'QUARANTINED',
          audit_count: '0',
        });
      } finally {
        await Promise.all([
          claimantA.end(),
          claimantB.end(),
          blockedFinalizer.end(),
        ]);
      }

      await owner!.query(
        `UPDATE inquiry_source_document_scan_job j
         SET available_at=clock_timestamp(),
             lease_expires_at=CASE WHEN j.status='LEASED'
               THEN clock_timestamp()-interval '1 second' ELSE j.lease_expires_at END
         FROM inquiry_source_document d
         WHERE d.id=j.source_document_id AND d.original_filename LIKE $1
           AND j.status IN ('PENDING','RETRY_WAIT','LEASED')`,
        [`r1-010d-${runId}-%`],
      );
    });

    it('R1_010D_DB_SOURCE_MISMATCH_AUDIT does not mislabel corruption as exhaustion', async () => {
      const inquiry = await createInquiry('source mismatch fixture');
      const document = await uploadFixture(
        inquiry,
        `r1-010d-${runId}-source-mismatch.pdf`,
        'application/pdf',
        minimalPdf(1024),
      );
      await deferOtherScanJobs(String(document.job_id));
      const changedHash = randomBytes(32);
      if (changedHash.equals(Buffer.from(document.sha256 as Buffer)))
        changedHash[0] = (changedHash[0] ?? 0) ^ 0xff;
      await owner!.query(
        'UPDATE inquiry_source_document_scan_job SET source_sha256=$2 WHERE id=$1',
        [String(document.job_id), changedHash],
      );
      const claim = await worker!.query(
        'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
        [randomBytes(32), randomUUID()],
      );
      expect(claim.rowCount).toBe(0);
      const final = await owner!.query<{
        status: string;
        failure_code: string;
        safety_state: string;
      }>(
        `SELECT j.status,j.failure_code,d.safety_state
         FROM inquiry_source_document_scan_job j
         JOIN inquiry_source_document d ON d.id=j.source_document_id WHERE j.id=$1`,
        [String(document.job_id)],
      );
      expect(final.rows[0]).toMatchObject({
        status: 'STOPPED',
        failure_code: 'SOURCE_MISMATCH',
        safety_state: 'SCAN_ERROR',
      });
      const audit = await owner!.query<{
        action: string;
        reason_code: string;
      }>(`SELECT action,reason_code FROM audit_event WHERE entity_id=$1`, [
        String(document.id),
      ]);
      expect(audit.rows).toHaveLength(2);
      expect(audit.rows).toEqual(
        expect.arrayContaining([
          {
            action: 'inquiry.upload.completed',
            reason_code: 'UPLOAD_ACCEPTED',
          },
          {
            action: 'inquiry.document.scan_state_changed',
            reason_code: 'INTERNAL_ERROR',
          },
        ]),
      );
    });

    it('R1_010D_SCAN_HARD_TIMEOUT_PREP isolates one job for the short-deadline fixture', async () => {
      const inquiry = await createInquiry('short timeout fixture');
      const originalFilename = `r1-010d-${runId}-hard-timeout.pdf`;
      const document = await uploadFixture(
        inquiry,
        originalFilename,
        'application/pdf',
        minimalPdf(128 * 1024),
      );
      await deferOtherScanJobs(String(document.job_id));
      expect(document.safety_state).toBe('QUARANTINED');
      expect(document.job_status).toBe('PENDING');
    });

    it('R1_010D_SCAN_HARD_TIMEOUT_VERIFY records a bounded timeout without CLEAN', async () => {
      const row = await waitForDocumentJob(
        `r1-010d-${runId}-hard-timeout.pdf`,
        (candidate) => candidate.status === 'RETRY_WAIT',
        15_000,
      );
      expect(row).toMatchObject({
        status: 'RETRY_WAIT',
        failure_code: 'SCAN_TIMEOUT',
        attempt_count: 1,
        safety_state: 'QUARANTINED',
      });
      const events = await owner!.query<{ reason_code: string }>(
        `SELECT reason_code FROM audit_event WHERE action='inquiry.document.scan_job_control_changed'
         AND entity_id=$1 ORDER BY occurred_at`,
        [String(row.job_id)],
      );
      expect(events.rows.map((event) => event.reason_code)).toEqual([
        'SCAN_ATTEMPT_CLAIMED',
        'SCAN_RETRY_SCHEDULED',
      ]);
    }, 20_000);

    it('R1_010D_SCAN_RESTART_PREP isolates one job for process-kill recovery', async () => {
      const inquiry = await createInquiry('worker restart fixture');
      const originalFilename = `r1-010d-${runId}-restart.pdf`;
      const document = await uploadFixture(
        inquiry,
        originalFilename,
        'application/pdf',
        minimalPdf(128 * 1024),
      );
      await deferOtherScanJobs(String(document.job_id));
      expect(document.safety_state).toBe('QUARANTINED');
      expect(document.job_status).toBe('PENDING');
    });

    it('R1_010D_SCAN_RESTART_VERIFY confirms lease recovery and graceful retry', async () => {
      const row = await waitForDocumentJob(
        `r1-010d-${runId}-restart.pdf`,
        (candidate) => candidate.status === 'RETRY_WAIT',
        15_000,
      );
      expect(row).toMatchObject({
        status: 'RETRY_WAIT',
        failure_code: 'STREAM_INTERRUPTED',
        attempt_count: 2,
        safety_state: 'QUARANTINED',
      });
      const events = await owner!.query<{ reason_code: string }>(
        `SELECT reason_code FROM audit_event WHERE action='inquiry.document.scan_job_control_changed'
         AND entity_id=$1 ORDER BY occurred_at`,
        [String(row.job_id)],
      );
      expect(events.rows.map((event) => event.reason_code)).toEqual([
        'SCAN_ATTEMPT_CLAIMED',
        'SCAN_ATTEMPT_CLAIMED',
        'SCAN_RETRY_SCHEDULED',
      ]);
    }, 20_000);

    for (const mode of [
      'unavailable',
      'scratch',
      'oom',
      'instance',
      'malformed',
      'stale',
      'timeout',
      'statfs',
      'config',
      'cgroupmissing',
      'cgroupmalformed',
    ]) {
      it(`R1_010D_RESOURCE_${mode}_PREP creates a quarantined fixture`, async () => {
        const inquiry = await createInquiry('resource failure fixture');
        const document = await uploadFixture(
          inquiry,
          `r1-010d-${runId}-resource-${mode}.pdf`,
          'application/pdf',
          minimalPdf(4096),
        );
        await deferOtherScanJobs(String(document.job_id));
        expect(document.safety_state).toBe('QUARANTINED');
      });

      it(`R1_010D_RESOURCE_${mode}_VERIFY denies CLEAN after resource probe failure`, async () => {
        const row = await waitForDocumentJob(
          `r1-010d-${runId}-resource-${mode}.pdf`,
          (candidate) => candidate.status === 'STOPPED',
          20_000,
        );
        expect(row).toMatchObject({
          status: 'STOPPED',
          safety_state: 'SCAN_ERROR',
          failure_code: 'SIGNATURES_CHANGED',
        });
        const audit = await owner!.query<{
          outcome: string;
          reason_code: string;
        }>(
          `SELECT outcome,reason_code FROM audit_event WHERE action='inquiry.document.scan_state_changed' AND entity_id=$1`,
          [String(row.id)],
        );
        expect(audit.rows).toEqual([
          { outcome: 'FAILURE', reason_code: 'INTERNAL_ERROR' },
        ]);
      }, 25_000);
    }

    it('R1_010D_RESOURCE_before_PREP creates a quarantined fixture', async () => {
      const inquiry = await createInquiry('resource unavailable before claim');
      const document = await uploadFixture(
        inquiry,
        `r1-010d-${runId}-resource-before.pdf`,
        'application/pdf',
        minimalPdf(4096),
      );
      await deferOtherScanJobs(String(document.job_id));
      expect(document.safety_state).toBe('QUARANTINED');
    });

    it('R1_010D_RESOURCE_before_VERIFY leaves the job unclaimed without a probe', async () => {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const row = await waitForDocumentJob(
        `r1-010d-${runId}-resource-before.pdf`,
        () => true,
        1000,
      );
      expect(row).toMatchObject({
        status: 'PENDING',
        safety_state: 'QUARANTINED',
        attempt_count: 0,
      });
      const audit = await owner!.query<{ count: string }>(
        `SELECT count(*) FROM audit_event WHERE (entity_id=$1 AND action='inquiry.document.scan_state_changed') OR (entity_id=$2 AND action='inquiry.document.scan_job_control_changed')`,
        [String(row.id), String(row.job_id)],
      );
      expect(audit.rows[0]!.count).toBe('0');
    }, 10_000);

    it('R1_010D_SCAN_OFFLINE leaves documents fail-closed and does not claim work', async () => {
      const inquiry = await createInquiry('scanner unavailable fixture');
      const offlineFilename = `r1-010d-${runId}-offline.pdf`;
      const uploaded = await uploadFixture(
        inquiry,
        offlineFilename,
        'application/pdf',
        minimalPdf(4096),
      );
      expect(uploaded).toMatchObject({
        safety_state: 'QUARANTINED',
        job_status: 'PENDING',
        attempt_count: 0,
      });
      const before = await owner!.query<{
        id: string;
        safety_state: string;
        status: string;
        attempt_count: number;
      }>(
        `SELECT d.id,d.safety_state,j.status,j.attempt_count FROM inquiry_source_document d
         JOIN inquiry_source_document_scan_job j ON j.source_document_id=d.id
        WHERE d.id=$1`,
        [String(uploaded.id)],
      );
      expect(before.rowCount).toBe(1);
      expect(before.rows[0]).toMatchObject({
        safety_state: 'QUARANTINED',
        status: 'PENDING',
        attempt_count: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const after = await owner!.query<{
        id: string;
        safety_state: string;
        status: string;
        attempt_count: number;
      }>(
        `SELECT d.id,d.safety_state,j.status,j.attempt_count FROM inquiry_source_document d
         JOIN inquiry_source_document_scan_job j ON j.source_document_id=d.id
        WHERE d.id=$1`,
        [String(uploaded.id)],
      );
      expect(after.rows).toEqual(before.rows);
    }, 10_000);

    it(
      'R1_010D_SCAN_FINAL fails closed for unproven completeness, rejects EICAR, and denies downloads',
      async () => {
        const rows = await waitForTerminalDocuments();
        expect(rows.length).toBeGreaterThan(0);
        for (const suffix of [
          '-depth.xlsx',
          '-file-count.xlsx',
          '-ole-limit.xlsx',
        ]) {
          expect(
            rows.filter((row) =>
              String(row.original_filename).endsWith(suffix),
            ),
          ).toHaveLength(1);
        }
        for (const row of rows) {
          const name = String(row.original_filename);
          if (name.endsWith('-eicar.csv')) {
            expect(row.safety_state).toBe('REJECTED');
          } else if (
            name.endsWith('-depth.xlsx') ||
            name.endsWith('-file-count.xlsx') ||
            name.endsWith('-ole-limit.xlsx')
          ) {
            expect(row.safety_state).toBe('SCAN_ERROR');
            expect(row.failure_code).toBe('SCAN_LIMIT_EXCEEDED');
            const stateAudit = await owner!.query<{ reason_code: string }>(
              `SELECT reason_code FROM audit_event
             WHERE action='inquiry.document.scan_state_changed' AND entity_id=$1`,
              [String(row.id)],
            );
            expect(stateAudit.rows.map((event) => event.reason_code)).toEqual([
              'INTERNAL_ERROR',
            ]);
            const falseExhaustionAudit = await owner!.query<{ count: string }>(
              `SELECT count(*) FROM audit_event
             WHERE action='inquiry.document.scan_job_control_changed'
               AND entity_id=(SELECT id FROM inquiry_source_document_scan_job WHERE source_document_id=$1)
               AND reason_code='SCAN_ATTEMPTS_EXHAUSTED'`,
              [String(row.id)],
            );
            expect(falseExhaustionAudit.rows[0]!.count).toBe('0');
          } else if (
            name.includes('-boundary.pdf') ||
            name.endsWith('-safe.pdf') ||
            name.endsWith('-safe.csv') ||
            name.endsWith('-safe.xlsx') ||
            name.endsWith('-cell-eicar.xlsx')
          ) {
            expect(row.safety_state).toBe('SCAN_ERROR');
            expect(row.failure_code).toBe('ENCRYPTED_OR_UNSCANNABLE');
          } else if (
            name.endsWith('-recovery.pdf') ||
            name.endsWith('-resource-before.pdf') ||
            name.endsWith('-offline.pdf')
          ) {
            expect(row.safety_state).toBe('SCAN_ERROR');
            expect(row.failure_code).toBe('ENCRYPTED_OR_UNSCANNABLE');
          }
          if (row.status === 'COMPLETE')
            expect(Number(row.attempt_count)).toBeGreaterThan(0);
        }

        const eicar = rows.find((row) =>
          String(row.original_filename).endsWith('-eicar.csv'),
        );
        expect(eicar).toBeTruthy();
        const inquiry = await owner!.query<{ inquiry_id: string }>(
          'SELECT inquiry_id FROM inquiry_source_document WHERE id=$1',
          [String(eicar!.id)],
        );
        const publicLookup = await publicRequest(
          'GET',
          `/v1/public/inquiries/${inquiry.rows[0]!.inquiry_id}`,
        );
        expect(publicLookup.status).toBe(404);
        const staff = await makeDownloadActor();
        const denied = await staff.request(
          'GET',
          `/v1/staff/inquiries/${inquiry.rows[0]!.inquiry_id}/documents/${String(eicar!.id)}/download`,
        );
        expect(denied.status).toBe(404);
        expect(denied.body.code).toBe('FILE_NOT_ACCESSIBLE');
        // The temporary completeness restriction also denies clean-looking
        // originals; this is a functional limitation, not successful scanning.
        for (const suffix of ['-safe.pdf', '-safe.csv', '-safe.xlsx']) {
          const document = rows.find((row) =>
            String(row.original_filename).endsWith(suffix),
          );
          expect(document, suffix).toBeTruthy();
          expect(document!.safety_state).toBe('SCAN_ERROR');
          expect(document!.failure_code).toBe('ENCRYPTED_OR_UNSCANNABLE');
          const parent = await owner!.query<{ inquiry_id: string }>(
            'SELECT inquiry_id FROM inquiry_source_document WHERE id=$1',
            [String(document!.id)],
          );
          const download = await staff.request(
            'GET',
            `/v1/staff/inquiries/${parent.rows[0]!.inquiry_id}/documents/${String(document!.id)}/download`,
          );
          expect(download.status).toBe(404);
          expect(download.body.code).toBe('FILE_NOT_ACCESSIBLE');
          const audit = await owner!.query<{ reason_code: string }>(
            `SELECT reason_code FROM audit_event
             WHERE action='inquiry.document.scan_state_changed' AND entity_id=$1`,
            [String(document!.id)],
          );
          expect(audit.rows.map((event) => event.reason_code)).toEqual([
            'INTERNAL_ERROR',
          ]);
        }
      },
      13 * 60_000,
    );
  },
);
