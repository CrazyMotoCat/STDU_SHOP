import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { IngestionRun } from '../generated/prisma/client.js';

export interface SourcePolicy {
  supplierId: string;
  adapterVersion: string;
  fixtureKey: string;
  maxRows: number;
  maxAttempts: number;
  timeoutMs: number;
}
export interface ExtractionRow {
  id: string;
  rowNumber: number;
  normalized: Record<string, string | null> | null;
  warnings: string[];
  modificationEvidence: string | null;
  errorCode: string | null;
}
export interface Extraction {
  raw: Buffer;
  hash: string;
  rows: ExtractionRow[];
}
export function policy(run: IngestionRun): SourcePolicy {
  const p = run.sourceSnapshot as unknown as SourcePolicy;
  if (
    !p ||
    p.adapterVersion !== 'fixture-json/1' ||
    !['offers-v1', 'mixed-v1'].includes(p.fixtureKey) ||
    !Number.isInteger(p.maxRows) ||
    p.maxRows < 1 ||
    p.maxRows > 100 ||
    !Number.isInteger(p.maxAttempts) ||
    p.maxAttempts < 1 ||
    p.maxAttempts > 5 ||
    !Number.isInteger(p.timeoutMs) ||
    p.timeoutMs < 100 ||
    p.timeoutMs > 10000
  )
    throw new Error('INGESTION_POLICY_INVALID');
  return p;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INGESTION_PROTOCOL_INVALID');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).sort().join('|') !== [...expected].sort().join('|'))
    throw new Error('INGESTION_PROTOCOL_INVALID');
}
const bounds: Record<string, number> = {
  supplier_part_number: 160,
  offer_name: 240,
  source_brand_text: 160,
  manufacturer_name: 200,
  original_part_number: 160,
  modification: 160,
  purchase_cost: 64,
  currency: 3,
  source_vat_text: 160,
  availability_text: 500,
  lead_time_text: 160,
  source_observed_at: 40,
  source_url: 2048,
};
function normalized(value: unknown): Record<string, string | null> {
  const record = object(value);
  keys(record, Object.keys(bounds));
  for (const [key, max] of Object.entries(bounds)) {
    const v = record[key];
    if (v === null) continue;
    if (
      typeof v !== 'string' ||
      Array.from(v).length > max ||
      !v ||
      v !== v.normalize('NFC') ||
      v !== v.replace(/^ +| +$/g, '') ||
      Array.from(v).some(
        (c) =>
          c.codePointAt(0)! < 32 ||
          c.codePointAt(0) === 127 ||
          (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
      )
    )
      throw new Error('INGESTION_PROTOCOL_INVALID');
  }
  if (
    !record.offer_name &&
    !record.supplier_part_number &&
    !record.original_part_number
  )
    throw new Error('INGESTION_PROTOCOL_INVALID');
  if (
    record.purchase_cost !== null &&
    (!/^(?:[1-9][0-9]*(?:\.[0-9]*[1-9])?|0\.[0-9]*[1-9])$/.test(
      String(record.purchase_cost),
    ) ||
      record.currency === null)
  )
    throw new Error('INGESTION_PROTOCOL_INVALID');
  if (
    record.currency !== null &&
    !['RUB', 'USD', 'EUR'].includes(String(record.currency))
  )
    throw new Error('INGESTION_PROTOCOL_INVALID');
  if (
    record.source_observed_at !== null &&
    (!/(?:Z|[+-]\d\d:\d\d)$/.test(String(record.source_observed_at)) ||
      !Number.isFinite(Date.parse(String(record.source_observed_at))))
  )
    throw new Error('INGESTION_PROTOCOL_INVALID');
  if (record.source_url !== null) {
    const url = new URL(String(record.source_url));
    if (
      url.protocol !== 'https:' ||
      url.host !== 'mock.invalid' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('INGESTION_PROTOCOL_INVALID');
  }
  return record as Record<string, string | null>;
}
export function validateExtraction(
  value: unknown,
  run: IngestionRun,
): Extraction {
  const p = policy(run),
    result = object(value);
  keys(result, [
    'protocol',
    'run_id',
    'adapter_version',
    'source_hash',
    'raw_snapshot',
    'results',
  ]);
  if (
    result.protocol !== 'r1-008b.mock.v1' ||
    result.run_id !== run.id ||
    result.adapter_version !== p.adapterVersion ||
    typeof result.raw_snapshot !== 'string' ||
    result.raw_snapshot.length > 1398104
  )
    throw new Error('INGESTION_PROTOCOL_INVALID');
  const raw = Buffer.from(result.raw_snapshot, 'base64');
  const hash = createHash('sha256').update(raw).digest('hex');
  if (
    raw.length > 1048576 ||
    raw.toString('base64') !== result.raw_snapshot ||
    hash !== result.source_hash ||
    (run.rawSnapshot !== null && !raw.equals(Buffer.from(run.rawSnapshot)))
  )
    throw new Error('INGESTION_PROVENANCE_INVALID');
  const original: unknown = JSON.parse(raw.toString('utf8'));
  if (
    !Array.isArray(original) ||
    !Array.isArray(result.results) ||
    original.length !== result.results.length ||
    original.length > p.maxRows
  )
    throw new Error('INGESTION_LIMIT_EXCEEDED');
  const rows: ExtractionRow[] = result.results.map(
    (value: unknown, index: number) => {
      const row = object(value),
        rowNumber = index + 1;
      if (row.row_number !== rowNumber)
        throw new Error('INGESTION_PROTOCOL_INVALID');
      const id = createHash('sha256')
        .update(run.id + ':' + hash + ':' + p.adapterVersion + ':' + rowNumber)
        .digest('hex');
      if (row.code === 'ROW_INVALID') {
        keys(row, ['row_number', 'code']);
        return {
          id,
          rowNumber,
          normalized: null,
          warnings: [],
          modificationEvidence: null,
          errorCode: 'ROW_INVALID',
        };
      }
      keys(row, [
        'candidate_id',
        'row_number',
        'normalized',
        'identity_status',
        'modification_evidence',
        'warnings',
      ]);
      const data = normalized(row.normalized);
      const warnings = [
        'IDENTITY_UNVERIFIED',
        'NOT_A_BUSINESS_OFFER',
        ...(data.purchase_cost === null ? ['PRICE_UNKNOWN'] : []),
      ];
      if (
        row.candidate_id !== id ||
        row.identity_status !== 'UNVERIFIED' ||
        row.modification_evidence !==
          (data.modification ? 'SPECIFIED' : 'UNKNOWN') ||
        JSON.stringify(row.warnings) !== JSON.stringify(warnings)
      )
        throw new Error('INGESTION_PROTOCOL_INVALID');
      return {
        id,
        rowNumber,
        normalized: data,
        warnings,
        modificationEvidence: String(row.modification_evidence),
        errorCode: null,
      };
    },
  );
  return { raw, hash, rows };
}

@Injectable()
export class SupplierExtractionClient {
  async extract(run: IngestionRun, signal: AbortSignal): Promise<Extraction> {
    const token = process.env.SUPPLIER_INGESTION_TOKEN,
      endpoint = process.env.SUPPLIER_INGESTION_URL;
    if (!token || token.length < 32 || !endpoint)
      throw new Error('INGESTION_CONFIGURATION_REQUIRED');
    const url = new URL(endpoint);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    )
      throw new Error('INGESTION_CONFIGURATION_INVALID');
    const p = policy(run);
    const response = await fetch(
      new URL('/internal/v1/supplier-ingestion/extract', url),
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(p.timeoutMs)]),
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          protocol: 'r1-008b.mock.v1',
          run_id: run.id,
          adapter_version: p.adapterVersion,
          fixture_key: p.fixtureKey,
          raw_snapshot:
            run.rawSnapshot === null
              ? null
              : Buffer.from(run.rawSnapshot).toString('base64'),
        }),
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('INGESTION_UNAVAILABLE');
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 3 * 1048576) throw new Error('INGESTION_LIMIT_EXCEEDED');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return validateExtraction(
      JSON.parse(Buffer.concat(chunks).toString('utf8')),
      run,
    );
  }
}
