import { TextDecoder } from 'node:util';
import { StaffError } from '../identity/errors.js';

const MAX_LINE = 1024 * 1024;
const MAX_META_LINE = 16 * 1024;
const MAX_BATCH_ROWS = 250;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_SHEETS = 20;

export interface SourceCell {
  columnIndex: number;
  cellType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'FORMULA' | 'BLANK';
  rawValue: string;
  numberFormat?: string;
}

export interface ParsedSourceRow {
  sheetIndex: number;
  sourceRowNumber: number;
  cells: SourceCell[];
}

export interface ParsedImportSource {
  sourceFormat: 'CSV' | 'XLSX';
  parserVersion: string;
  sheets: { sheetIndex: number; sheetName: string | null }[];
  rows: ParsedSourceRow[];
  rowCount: number;
  sourceParseIssues: { code: string; message: string }[];
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(value).sort().join('\0') === [...expected].sort().join('\0')
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('record');
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, limit: number, nullable = false) {
  return (
    (nullable && value === null) ||
    (typeof value === 'string' && Array.from(value).length <= limit)
  );
}

function decodeRecord(line: Buffer): Record<string, unknown> {
  if (line.length === 0 || line.length > MAX_LINE || line.includes(0x0d))
    throw new Error('line');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(line);
  const value = record(JSON.parse(text));
  if (value.type !== 'ROW' && line.length > MAX_META_LINE)
    throw new Error('meta-line-size');
  return value;
}

function safeParserError(status: number, body: unknown): StaffError {
  const code =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { code?: unknown }).code
      : null;
  if (
    code === 'ENCODING_REQUIRED' ||
    code === 'INVALID_ENCODING' ||
    code === 'FILE_REJECTED' ||
    code === 'FILE_TOO_LARGE' ||
    code === 'IMPORT_LIMIT_EXCEEDED' ||
    code === 'VALIDATION_ERROR'
  )
    return new StaffError(code);
  if (status === 413) return new StaffError('IMPORT_LIMIT_EXCEEDED');
  if (status === 415) return new StaffError('UNSUPPORTED_MEDIA_TYPE');
  return new StaffError('INGESTION_UNAVAILABLE');
}

export async function parseImportSource(input: {
  content: Buffer;
  filename: string;
  declaredMime: string;
  format: 'CSV' | 'XLSX';
  csvEncoding?: 'UTF-8' | 'WINDOWS-1251';
  csvDelimiter?: ',' | ';' | '\t';
  onRows?: (
    rows: ParsedSourceRow[],
    sheets: ParsedImportSource['sheets'],
  ) => Promise<void>;
}): Promise<ParsedImportSource> {
  const base = process.env.INGESTION_INTERNAL_URL ?? 'http://127.0.0.1:8000';
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new StaffError('INGESTION_UNAVAILABLE');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', 'ingestion'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new StaffError('INGESTION_UNAVAILABLE');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const requestBody = new Uint8Array(input.content.byteLength);
  requestBody.set(input.content);
  try {
    const response = await fetch(
      new URL('/internal/v1/catalog-import/parse', url),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-source-filename': input.filename,
          'x-source-mime': input.declaredMime,
          ...(input.csvEncoding ? { 'x-csv-encoding': input.csvEncoding } : {}),
          ...(input.csvDelimiter
            ? { 'x-csv-delimiter': input.csvDelimiter }
            : {}),
        },
        body: requestBody,
        signal: controller.signal,
        redirect: 'error',
      },
    );
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      throw safeParserError(response.status, body);
    }
    if (
      response.headers
        .get('content-type')
        ?.split(';')[0]
        ?.trim()
        .toLowerCase() !== 'application/x-ndjson'
    )
      throw new StaffError('INGESTION_UNAVAILABLE');
    if (!response.body) throw new StaffError('INGESTION_UNAVAILABLE');

    const rows: ParsedSourceRow[] = [];
    let rowCount = 0;
    const sheets: ParsedImportSource['sheets'] = [];
    const coordinates = new Set<string>();
    let sourceFormat: 'CSV' | 'XLSX' | null = null;
    let parserVersion: string | null = null;
    let sourceParseIssues: ParsedImportSource['sourceParseIssues'] | null =
      null;
    let started = false;
    let terminal = false;
    let pending = Buffer.alloc(0);
    let batchRows = 0;
    let batchBytes = 0;

    const flushRows = async () => {
      if (!rows.length) return;
      if (input.onRows) await input.onRows(rows.splice(0), [...sheets]);
    };

    const consume = async (line: Buffer) => {
      if (terminal) throw new Error('terminal');
      const value = decodeRecord(line);
      if (!started) {
        if (
          !exactKeys(value, ['type', 'protocolVersion', 'sourceFormat']) ||
          value.type !== 'START' ||
          value.protocolVersion !== 1 ||
          !['CSV', 'XLSX'].includes(String(value.sourceFormat))
        )
          throw new Error('start');
        started = true;
        sourceFormat = value.sourceFormat as 'CSV' | 'XLSX';
        if (sourceFormat !== input.format) throw new Error('format');
        return;
      }
      if (value.type === 'SHEET') {
        if (
          !exactKeys(value, ['type', 'sheetIndex', 'sheetName']) ||
          typeof value.sheetIndex !== 'number' ||
          value.sheetIndex !== sheets.length ||
          value.sheetIndex < 0 ||
          value.sheetIndex >= MAX_SHEETS ||
          !boundedString(value.sheetName, 128, true)
        )
          throw new Error('sheet');
        sheets.push({
          sheetIndex: value.sheetIndex,
          sheetName: value.sheetName as string | null,
        });
        return;
      }
      if (value.type === 'ROW') {
        if (
          !exactKeys(value, [
            'type',
            'sheetIndex',
            'sourceRowNumber',
            'cells',
          ]) ||
          typeof value.sheetIndex !== 'number' ||
          !sheets.some((sheet) => sheet.sheetIndex === value.sheetIndex) ||
          !Number.isInteger(value.sourceRowNumber) ||
          Number(value.sourceRowNumber) < 1 ||
          !Array.isArray(value.cells) ||
          value.cells.length > 128
        )
          throw new Error('row');
        const key = `${value.sheetIndex}:${value.sourceRowNumber}`;
        if (coordinates.has(key)) throw new Error('coordinate');
        coordinates.add(key);
        const columns = new Set<number>();
        const cells = value.cells.map((rawCell) => {
          const cell = record(rawCell);
          const keys =
            cell.numberFormat === undefined
              ? ['columnIndex', 'cellType', 'rawValue']
              : ['columnIndex', 'cellType', 'rawValue', 'numberFormat'];
          if (
            !exactKeys(cell, keys) ||
            !Number.isInteger(cell.columnIndex) ||
            Number(cell.columnIndex) < 0 ||
            Number(cell.columnIndex) > 127 ||
            columns.has(Number(cell.columnIndex)) ||
            !['TEXT', 'NUMBER', 'BOOLEAN', 'FORMULA', 'BLANK'].includes(
              String(cell.cellType),
            ) ||
            !boundedString(cell.rawValue, 4000) ||
            (cell.numberFormat !== undefined &&
              !boundedString(cell.numberFormat, 64))
          )
            throw new Error('cell');
          columns.add(Number(cell.columnIndex));
          return cell as unknown as SourceCell;
        });
        const parsedRow = {
          sheetIndex: value.sheetIndex,
          sourceRowNumber: Number(value.sourceRowNumber),
          cells,
        };
        rows.push(parsedRow);
        rowCount += 1;
        batchRows += 1;
        batchBytes += line.length + 1;
        if (
          rowCount > MAX_ROWS ||
          batchRows > MAX_BATCH_ROWS ||
          batchBytes > MAX_BATCH_BYTES
        )
          throw new Error('batch');
        if (batchRows === MAX_BATCH_ROWS) {
          batchRows = 0;
          batchBytes = 0;
          await flushRows();
        }
        return;
      }
      if (value.type === 'COMPLETE' || value.type === 'PARTIAL') {
        const expected = ['type', 'parserVersion', 'sourceParseIssues'];
        if (
          !exactKeys(value, expected) ||
          !boundedString(value.parserVersion, 32) ||
          !Array.isArray(value.sourceParseIssues) ||
          (value.type === 'COMPLETE' && value.sourceParseIssues.length !== 0) ||
          (value.type === 'PARTIAL' &&
            (value.sourceParseIssues.length < 1 ||
              value.sourceParseIssues.length > 256))
        )
          throw new Error('terminal');
        for (const rawIssue of value.sourceParseIssues) {
          const issue = record(rawIssue);
          if (
            !exactKeys(issue, ['code', 'message']) ||
            !boundedString(issue.code, 64) ||
            !boundedString(issue.message, 240)
          )
            throw new Error('issue');
        }
        if (
          Buffer.byteLength(JSON.stringify(value.sourceParseIssues)) >
          MAX_META_LINE
        )
          throw new Error('issue-size');
        parserVersion = value.parserVersion as string;
        sourceParseIssues =
          value.sourceParseIssues as ParsedImportSource['sourceParseIssues'];
        terminal = true;
        return;
      }
      throw new Error('type');
    };

    const reader = response.body.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        pending = Buffer.concat([pending, Buffer.from(next.value)]);
        for (;;) {
          const delimiter = pending.indexOf(0x0a);
          if (delimiter < 0) break;
          const line = pending.subarray(0, delimiter);
          pending = pending.subarray(delimiter + 1);
          await consume(line);
        }
        if (pending.length > MAX_LINE) throw new Error('line-size');
      }
    } finally {
      reader.releaseLock();
    }
    if (
      pending.length !== 0 ||
      !started ||
      !terminal ||
      sourceFormat === null ||
      parserVersion === null ||
      sourceParseIssues === null ||
      sheets.length === 0
    )
      throw new Error('truncated');
    await flushRows();
    return {
      sourceFormat,
      parserVersion,
      sheets,
      rows: input.onRows ? [] : rows,
      rowCount,
      sourceParseIssues,
    };
  } catch (error) {
    if (error instanceof StaffError) throw error;
    if (controller.signal.aborted)
      throw new StaffError('INGESTION_UNAVAILABLE');
    throw new StaffError('INGESTION_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}
