import {
  syntheticDatabase,
  syntheticScanEnabled,
} from './synthetic-profile.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Pool } from 'pg';
import { UploadMeter } from '../inquiries/inquiries.service.js';

export const LIMIT = 3_000_000;
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const FLAGS = [
  'Executable',
  'InvalidFile',
  'Script',
  'PasswordProtectedFile',
  'RestrictedFileFormat',
  'Macros',
  'XmlExternalEntities',
  'InsecureDeserialization',
  'Html',
  'UnsafeArchive',
  'OleEmbeddedObject',
  'UnwantedAction',
].map((name) => 'Contains' + name);

export type Format = 'pdf' | 'csv' | 'xlsx';
export type Outcome =
  | 'INFECTED'
  | 'SCAN_ERROR'
  | 'SCAN_INDETERMINATE'
  | 'CLEAN_VERIFIED'
  | 'PROVIDER_BLOCKED';

export function normalizeAdvanced(body: unknown, format: Format): Outcome {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return 'SCAN_INDETERMINATE';
  const value = body as Record<string, unknown>;
  const known = new Set([
    'CleanResult',
    'FoundViruses',
    'Successful',
    'VerifiedFileFormat',
    'ContentInformation',
    ...FLAGS,
  ]);
  if (
    Object.keys(value).some((key) => !known.has(key)) ||
    typeof value.CleanResult !== 'boolean' ||
    ('Successful' in value && value.Successful !== true) ||
    FLAGS.some((key) => typeof value[key] !== 'boolean')
  )
    return 'SCAN_INDETERMINATE';
  const findings = value.FoundViruses;
  if (Array.isArray(findings)) {
    if (
      findings.length > 1000 ||
      findings.some((finding: unknown) => {
        if (!finding || typeof finding !== 'object') return true;
        const item = finding as Record<string, unknown>;
        return (
          typeof item.FileName !== 'string' ||
          typeof item.VirusName !== 'string' ||
          !item.VirusName.trim()
        );
      })
    )
      return 'SCAN_INDETERMINATE';
    if (findings.length)
      return value.CleanResult ? 'SCAN_INDETERMINATE' : 'INFECTED';
  } else if (findings !== null || !value.CleanResult)
    return 'SCAN_INDETERMINATE';
  if (
    !value.CleanResult ||
    FLAGS.some((key) => value[key] !== false) ||
    typeof value.VerifiedFileFormat !== 'string' ||
    value.VerifiedFileFormat.toLowerCase().replace(/^\./, '') !== format
  )
    return 'SCAN_INDETERMINATE';
  return 'CLEAN_VERIFIED';
}

async function collect(
  stream: AsyncIterable<Uint8Array>,
  limit: number,
): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error('SCAN_BYTE_LIMIT');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

export async function validateStructure(
  bytes: Buffer,
  format: Format,
): Promise<boolean> {
  if (!bytes.length || bytes.length > LIMIT) return false;
  if (format === 'pdf' && /\/Encrypt\b/.test(bytes.toString('latin1')))
    return false;
  const meter = new UploadMeter(
    bytes.length,
    LIMIT,
    format === 'csv',
    format === 'xlsx',
    format === 'pdf',
  );
  try {
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 16 * 1024)
      chunks.push(bytes.subarray(offset, offset + 16 * 1024));
    await pipeline(
      Readable.from(chunks),
      meter,
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
    const expected = { pdf: 'application/pdf', xlsx: XLSX, csv: 'text/csv' }[
      format
    ];
    if (meter.detectedMime() !== expected) return false;
    if (format === 'csv') {
      const text = bytes.toString('utf8');
      if (
        /^%PDF-|^PK/.test(text) ||
        bytes.some((byte) => byte < 32 && ![9, 10, 13].includes(byte)) ||
        !/[,;]/.test(text)
      )
        return false;
    }
    const valid = await meter.validateStoredStructure('snapshot', {
      readInquiryQuarantineRanges: async (_key, ranges) =>
        ranges.map(({ offset, length }) =>
          bytes.subarray(offset, offset + length),
        ),
    });
    return (
      valid && (format !== 'xlsx' || meter.validateScanArchiveExpansion(bytes))
    );
  } catch {
    return false;
  }
}

type AdvancedRequest = (
  options: import('node:http').RequestOptions,
  onResponse: (response: import('node:http').IncomingMessage) => void,
) => import('node:http').ClientRequest;

export async function requestAdvanced(
  send: AdvancedRequest,
  apiKey: string,
  bytes: Buffer,
  format: Format,
  timeoutMs = 15_000,
): Promise<Outcome> {
  if (!bytes.length || bytes.length > LIMIT) return 'SCAN_INDETERMINATE';
  const boundary = 'stdu-synthetic-' + randomBytes(16).toString('hex');
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="inputFile"; filename="synthetic.${format}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const headers: Record<string, string> = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': String(prefix.length + bytes.length + suffix.length),
    Apikey: apiKey,
    Accept: 'application/json',
    restrictFileTypes: '.pdf,.csv,.xlsx',
    options: 'blockOfficeXmlOleEmbeddedFile,blockInvalidUris',
  };
  for (const name of [
    'Executables',
    'InvalidFiles',
    'Scripts',
    'PasswordProtectedFiles',
    'Macros',
    'XmlExternalEntities',
    'InsecureDeserialization',
    'Html',
    'UnsafeArchives',
    'OleEmbeddedObject',
    'UnwantedAction',
  ])
    headers['allow' + name] = 'false';
  try {
    const response = await new Promise<import('node:http').IncomingMessage>(
      (resolve, reject) => {
        const req = send(
          {
            path: '/virus/scan/file/advanced',
            method: 'POST',
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          },
          resolve,
        );
        req.once('error', reject);
        req.write(prefix);
        req.write(bytes);
        req.end(suffix);
      },
    );
    if (response.statusCode !== 200) {
      response.destroy();
      return [401, 403, 429].includes(response.statusCode ?? 0)
        ? 'PROVIDER_BLOCKED'
        : 'SCAN_ERROR';
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers['content-type'] ?? '',
      )
    ) {
      response.destroy();
      return 'SCAN_INDETERMINATE';
    }
    const responseBytes = await collect(response, 128 * 1024);
    try {
      return normalizeAdvanced(
        JSON.parse(responseBytes.toString('utf8')),
        format,
      );
    } catch {
      return 'SCAN_INDETERMINATE';
    }
  } catch {
    return 'SCAN_ERROR';
  }
}

export class CloudmersiveAdvancedMockAdapter {
  constructor(
    private readonly port: number,
    private readonly timeoutMs = 15_000,
  ) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535)
      throw new Error('INVALID_MOCK_PORT');
  }

  scan(bytes: Buffer, format: Format): Promise<Outcome> {
    return requestAdvanced(
      (options, callback) =>
        request(
          {
            ...options,
            host: '127.0.0.1',
            port: this.port,
            agent: false,
          },
          callback,
        ),
      'synthetic-mock-only',
      bytes,
      format,
      this.timeoutMs,
    );
  }
}

interface Claim {
  job_id: string;
  job_version: number;
  expected_sha256: Buffer;
  expected_size_bytes: string;
}

async function readSnapshot(
  port: number,
  claim: Claim,
  token: Buffer,
): Promise<Buffer> {
  const response = await new Promise<import('node:http').IncomingMessage>(
    (resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          agent: false,
          port,
          path: '/internal/inquiry-scan/jobs/' + claim.job_id + '/content',
          method: 'POST',
          headers: {
            'x-scan-lease-token': token.toString('base64url'),
            'x-scan-job-version': claim.job_version,
          },
          signal: AbortSignal.timeout(15_000),
        },
        resolve,
      );
      req.once('error', reject);
      req.end();
    },
  );
  if (response.statusCode !== 200) {
    response.destroy();
    throw new Error('SCAN_STREAM_DENIED');
  }
  const bytes = await collect(response, LIMIT);
  if (
    response.trailers['x-scan-stream-status'] !== 'COMPLETE' ||
    bytes.length !== Number(claim.expected_size_bytes) ||
    !createHash('sha256').update(bytes).digest().equals(claim.expected_sha256)
  )
    throw new Error('SCAN_SOURCE_MISMATCH');
  return bytes;
}

export async function scanNext(
  pool: Pool,
  streamPort: number,
  mockPort: number,
  fixtures: ReadonlyMap<string, Format>,
): Promise<Outcome | null> {
  if (!syntheticScanEnabled()) return null;
  const target = await pool.query<{ name: string }>(
    'SELECT current_database() AS name',
  );
  if (target.rows[0]?.name !== syntheticDatabase)
    throw new Error('SEC_API_02_DISPOSABLE_DATABASE_REQUIRED');
  const token = randomBytes(32);
  const tokenHash = createHash('sha256').update(token).digest();
  const { rows } = await pool.query<Claim>(
    'SELECT * FROM inquiry_scan_claim($1,$2)',
    [tokenHash, randomUUID()],
  );
  const claim = rows[0];
  if (!claim) return null;
  const format = fixtures.get(claim.expected_sha256.toString('hex'));
  let bytes: Buffer | undefined;
  let outcome: Outcome = 'SCAN_INDETERMINATE';
  if (format && Number(claim.expected_size_bytes) <= LIMIT) {
    try {
      bytes = await readSnapshot(streamPort, claim, token);
      if (await validateStructure(bytes, format))
        outcome = await new CloudmersiveAdvancedMockAdapter(mockPort).scan(
          bytes,
          format,
        );
    } catch {
      outcome = 'SCAN_ERROR';
    }
  }
  await pool.query('SELECT inquiry_scan_finalize($1,$2,$3,$4,$5,$6,$7)', [
    claim.job_id,
    claim.job_version,
    tokenHash,
    outcome,
    bytes ? createHash('sha256').update(bytes).digest() : null,
    bytes?.length ?? null,
    randomUUID(),
  ]);
  return outcome;
}
