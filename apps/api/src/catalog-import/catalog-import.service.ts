import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Prisma } from '../generated/prisma/client.js';
import { DATABASE, PrismaDatabase } from '../database/database.module.js';
import {
  AuditService,
  createAuditEvent,
  type AuditInput,
} from '../audit/audit.service.js';
import { StaffError } from '../identity/errors.js';
import type { StaffPrincipal, StaffRequest } from '../identity/request.js';
import {
  CONTROL_ADMIN_PERMISSIONS,
  assertCurrentActor,
  assertHasPermission,
  effectivePermissions,
} from '../permissions/policy.js';
import {
  PrivateFileStorage,
  type OwnedStorageWrite,
} from '../storage/private-file-storage.js';
import type {
  ImportMappingRequest,
  ImportRowDecisionRequest,
  ImportSheetMapping,
} from './catalog-import.types.js';
import { parseImportSource } from './import-parser.client.js';
import {
  CatalogProductService,
  type ImportCatalogCandidate,
} from '../catalog/catalog.product.service.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CSV_MIMES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/octet-stream',
]);
const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);
const REASONS = [
  'DUPLICATE_REVIEWED',
  'SOURCE_INCOMPLETE',
  'DATA_CORRECTED',
  'OTHER',
];
function validation(field: string, code: string) {
  return new StaffError('VALIDATION_ERROR', [{ field, code }]);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw validation(field, 'INVALID_OBJECT');
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  required: string[] = [],
) {
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => !(key in value))
  )
    throw validation('request', 'UNKNOWN_OR_MISSING_FIELD');
}

function uuid(value: unknown, field: string) {
  if (typeof value !== 'string' || !UUID.test(value))
    throw validation(field, 'INVALID_UUID');
  return value.toLowerCase();
}

function pageSize(value: unknown, fallback = 50) {
  const number =
    value === undefined
      ? fallback
      : typeof value === 'string' && /^\d{1,3}$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isInteger(number) || number < 1 || number > 100)
    throw validation('pageSize', 'OUT_OF_RANGE');
  return number;
}

function cursor(value: unknown) {
  if (value === undefined) return null;
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw validation('cursor', 'INVALID_CURSOR');
  try {
    const text = Buffer.from(value, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(text);
    const data = object(parsed, 'cursor');
    exactKeys(data, ['createdAt', 'id'], ['createdAt', 'id']);
    if (
      Buffer.from(text).toString('base64url') !== value ||
      typeof data.createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(data.createdAt) ||
      !Number.isFinite(Date.parse(data.createdAt)) ||
      typeof data.id !== 'string' ||
      !UUID.test(data.id)
    )
      throw new Error('cursor');
    return { createdAt: data.createdAt, id: data.id.toLowerCase() };
  } catch {
    throw validation('cursor', 'INVALID_CURSOR');
  }
}

function encodeCursor(value: { id: string; createdAtCursor: string }) {
  return Buffer.from(
    JSON.stringify({ createdAt: value.createdAtCursor, id: value.id }),
    'utf8',
  ).toString('base64url');
}

function decodePositionCursor(value: unknown, kind: 'row' | 'decision') {
  if (value === undefined) return null;
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw validation('cursor', 'INVALID_CURSOR');
  try {
    const text = Buffer.from(value, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(text);
    const data = object(parsed, 'cursor');
    const expected =
      kind === 'row'
        ? ['sheetIndex', 'sourceRowNumber', 'id']
        : ['createdAt', 'id'];
    exactKeys(data, expected, expected);
    if (
      Buffer.from(text).toString('base64url') !== value ||
      typeof data.id !== 'string' ||
      !UUID.test(data.id)
    )
      throw new Error('cursor');
    if (kind === 'row') {
      if (
        !Number.isInteger(data.sheetIndex) ||
        Number(data.sheetIndex) < 0 ||
        Number(data.sheetIndex) > 19 ||
        !Number.isInteger(data.sourceRowNumber) ||
        Number(data.sourceRowNumber) < 1
      )
        throw new Error('cursor');
      return {
        sheetIndex: Number(data.sheetIndex),
        sourceRowNumber: Number(data.sourceRowNumber),
        id: data.id.toLowerCase(),
      };
    }
    if (
      typeof data.createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(data.createdAt) ||
      !Number.isFinite(Date.parse(data.createdAt))
    )
      throw new Error('cursor');
    return { createdAt: data.createdAt, id: data.id.toLowerCase() };
  } catch {
    throw validation('cursor', 'INVALID_CURSOR');
  }
}

function encodeRowCursor(value: {
  id: string;
  sheetIndex: number;
  sourceRowNumber: number;
}) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sanitizeFilename(value: string) {
  const leaf = Array.from(value.replace(/^.*[\\/]/, '').normalize('NFC'))
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join('')
    .trim();
  if (!leaf || leaf.length > 255 || leaf.includes('/') || leaf.includes('\\'))
    throw new StaffError('FILE_REJECTED');
  return leaf;
}

function delimiterFrom(content: Buffer, selected: string | undefined) {
  if (selected) {
    if (![',', ';', '\t'].includes(selected))
      throw validation('csvDelimiter', 'INVALID_ENUM');
    return selected;
  }
  const text = content.subarray(content[0] === 0xef ? 3 : 0).toString('latin1');
  const sample = text.split(/\r?\n/, 25).join('\n');
  const counts = [',', ';', '\t'].map(
    (item) => [item, sample.split(item).length - 1] as const,
  );
  const maximum = Math.max(...counts.map(([, count]) => count));
  const winners = counts.filter(([, count]) => count === maximum && count > 0);
  if (winners.length !== 1) throw new StaffError('ENCODING_REQUIRED');
  return winners[0]![0];
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest();
}

function slugFromName(name: string) {
  const transliteration: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'i',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'kh',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'shch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };
  const stem =
    Array.from(
      name.normalize('NFC').toLowerCase(),
      (char) => transliteration[char] ?? char,
    )
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120)
      .replace(/-+$/g, '') || 'product';
  return `${stem}-${randomUUID().replaceAll('-', '')}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function parseMapping(value: unknown): ImportMappingRequest {
  const input = object(value, 'mapping');
  exactKeys(
    input,
    ['expectedVersion', 'mappingSchemaVersion', 'sheetMappings'],
    ['expectedVersion', 'mappingSchemaVersion', 'sheetMappings'],
  );
  if (
    !Number.isInteger(input.expectedVersion) ||
    Number(input.expectedVersion) < 1
  )
    throw validation('expectedVersion', 'OUT_OF_RANGE');
  if (input.mappingSchemaVersion !== 1)
    throw validation('mappingSchemaVersion', 'UNSUPPORTED_VERSION');
  if (
    !Array.isArray(input.sheetMappings) ||
    input.sheetMappings.length < 1 ||
    input.sheetMappings.length > 20
  )
    throw validation('sheetMappings', 'OUT_OF_RANGE');
  const sheetIndexes = new Set<number>();
  const sheetMappings = input.sheetMappings.map((rawSheet) => {
    const sheet = object(rawSheet, 'sheetMappings');
    exactKeys(
      sheet,
      [
        'sheetIndex',
        'headerRowNumber',
        'fixedCategoryId',
        'fixedBrandId',
        'columnMappings',
        'referenceMappings',
      ],
      ['sheetIndex', 'headerRowNumber', 'columnMappings', 'referenceMappings'],
    );
    if (
      !Number.isInteger(sheet.sheetIndex) ||
      Number(sheet.sheetIndex) < 0 ||
      Number(sheet.sheetIndex) > 19
    )
      throw validation('sheetIndex', 'OUT_OF_RANGE');
    if (
      !Number.isInteger(sheet.headerRowNumber) ||
      Number(sheet.headerRowNumber) < 1
    )
      throw validation('headerRowNumber', 'OUT_OF_RANGE');
    const sheetIndex = Number(sheet.sheetIndex);
    if (sheetIndexes.has(sheetIndex))
      throw validation('sheetIndex', 'DUPLICATE');
    sheetIndexes.add(sheetIndex);
    if (
      !Array.isArray(sheet.columnMappings) ||
      sheet.columnMappings.length > 128
    )
      throw validation('columnMappings', 'OUT_OF_RANGE');
    if (
      !Array.isArray(sheet.referenceMappings) ||
      sheet.referenceMappings.length > 500
    )
      throw validation('referenceMappings', 'OUT_OF_RANGE');
    const targets = new Set<string>();
    const columnMappings = sheet.columnMappings.map((rawColumn) => {
      const column = object(rawColumn, 'columnMappings');
      exactKeys(
        column,
        ['columnIndex', 'target', 'attributeDefinitionId', 'categoryId'],
        ['columnIndex', 'target'],
      );
      if (
        !Number.isInteger(column.columnIndex) ||
        Number(column.columnIndex) < 0 ||
        Number(column.columnIndex) > 127
      )
        throw validation('columnIndex', 'OUT_OF_RANGE');
      const allowed = [
        'displayName',
        'summary',
        'description',
        'brandId',
        'manufacturerName',
        'originalPartNumber',
        'modification',
        'categoryId',
        'attribute',
      ];
      if (typeof column.target !== 'string' || !allowed.includes(column.target))
        throw validation('target', 'INVALID_ENUM');
      const isAttribute = column.target === 'attribute';
      if (
        isAttribute !== 'attributeDefinitionId' in column ||
        isAttribute !== 'categoryId' in column
      )
        throw validation('attributeDefinitionId', 'REQUIRED_FOR_ATTRIBUTE');
      const definitionId = isAttribute
        ? uuid(column.attributeDefinitionId, 'attributeDefinitionId')
        : undefined;
      const categoryId = isAttribute
        ? uuid(column.categoryId, 'categoryId')
        : undefined;
      if (!isAttribute) {
        if (targets.has(column.target)) throw validation('target', 'DUPLICATE');
        targets.add(column.target as string);
      } else {
        const key = `${column.columnIndex}:${categoryId}:${definitionId}`;
        if (targets.has(key))
          throw validation('attributeDefinitionId', 'DUPLICATE');
        targets.add(key);
      }
      return {
        columnIndex: Number(column.columnIndex),
        target:
          column.target as ImportMappingRequest['sheetMappings'][number]['columnMappings'][number]['target'],
        ...(definitionId
          ? { attributeDefinitionId: definitionId, categoryId }
          : {}),
      };
    });
    const referenceKeys = new Set<string>();
    const referenceMappings = sheet.referenceMappings.map((rawReference) => {
      const reference = object(rawReference, 'referenceMappings');
      exactKeys(
        reference,
        ['target', 'sourceValue', 'targetId'],
        ['target', 'sourceValue', 'targetId'],
      );
      if (reference.target !== 'brandId' && reference.target !== 'categoryId')
        throw validation('target', 'INVALID_ENUM');
      if (
        typeof reference.sourceValue !== 'string' ||
        Array.from(reference.sourceValue).length > 240
      )
        throw validation('sourceValue', 'OUT_OF_RANGE');
      const sourceValue = reference.sourceValue
        .normalize('NFC')
        .replace(/^ +| +$/g, '');
      const targetId = uuid(reference.targetId, 'targetId');
      const key = `${reference.target}:${sourceValue}`;
      if (referenceKeys.has(key))
        throw validation('referenceMappings', 'DUPLICATE_SOURCE_VALUE');
      referenceKeys.add(key);
      const target =
        reference.target as ImportSheetMapping['referenceMappings'][number]['target'];
      return { target, sourceValue, targetId };
    });
    const fixedCategoryId =
      sheet.fixedCategoryId === undefined
        ? undefined
        : uuid(sheet.fixedCategoryId, 'fixedCategoryId');
    const fixedBrandId =
      sheet.fixedBrandId === undefined
        ? undefined
        : uuid(sheet.fixedBrandId, 'fixedBrandId');
    if (
      (fixedCategoryId &&
        (columnMappings.some((column) => column.target === 'categoryId') ||
          referenceMappings.some((map) => map.target === 'categoryId'))) ||
      (fixedBrandId &&
        (columnMappings.some((column) => column.target === 'brandId') ||
          referenceMappings.some((map) => map.target === 'brandId')))
    )
      throw validation('sheetMappings', 'FIXED_REFERENCE_MAPPING_CONFLICT');
    if (
      fixedCategoryId &&
      columnMappings.some(
        (column) =>
          column.target === 'attribute' &&
          column.categoryId !== fixedCategoryId,
      )
    )
      throw validation('categoryId', 'ATTRIBUTE_CATEGORY_MISMATCH');
    return {
      sheetIndex,
      headerRowNumber: Number(sheet.headerRowNumber),
      ...(fixedCategoryId ? { fixedCategoryId } : {}),
      ...(fixedBrandId ? { fixedBrandId } : {}),
      columnMappings,
      referenceMappings,
    };
  });
  return {
    expectedVersion: Number(input.expectedVersion),
    mappingSchemaVersion: 1,
    sheetMappings,
  };
}

function parseDecision(value: unknown): ImportRowDecisionRequest {
  const input = object(value, 'decision');
  exactKeys(
    input,
    [
      'expectedRowVersion',
      'action',
      'expectedProductVersion',
      'expectedCurrentRevisionId',
      'reasonCode',
    ],
    ['expectedRowVersion', 'action'],
  );
  if (
    !Number.isInteger(input.expectedRowVersion) ||
    Number(input.expectedRowVersion) < 1
  )
    throw validation('expectedRowVersion', 'OUT_OF_RANGE');
  if (
    !['ACCEPT_CREATE', 'ACCEPT_REVISION', 'REJECT', 'HOLD'].includes(
      String(input.action),
    )
  )
    throw validation('action', 'INVALID_ENUM');
  if (
    (input.expectedProductVersion === undefined) !==
    (input.expectedCurrentRevisionId === undefined)
  )
    throw validation('expectedProductVersion', 'VERSION_PAIR_REQUIRED');
  if (
    input.expectedProductVersion !== undefined &&
    (!Number.isInteger(input.expectedProductVersion) ||
      Number(input.expectedProductVersion) < 1)
  )
    throw validation('expectedProductVersion', 'OUT_OF_RANGE');
  const expectedCurrentRevisionId =
    input.expectedCurrentRevisionId === undefined
      ? undefined
      : uuid(input.expectedCurrentRevisionId, 'expectedCurrentRevisionId');
  if (
    input.reasonCode !== undefined &&
    !REASONS.includes(String(input.reasonCode))
  )
    throw validation('reasonCode', 'INVALID_ENUM');
  if (
    input.action === 'ACCEPT_REVISION' &&
    input.expectedProductVersion === undefined
  )
    throw validation('expectedProductVersion', 'REQUIRED');
  if (
    input.action !== 'ACCEPT_REVISION' &&
    input.expectedProductVersion !== undefined
  )
    throw validation('expectedProductVersion', 'NOT_ALLOWED_FOR_ACTION');
  return {
    expectedRowVersion: Number(input.expectedRowVersion),
    action: input.action as ImportRowDecisionRequest['action'],
    ...(input.expectedProductVersion !== undefined
      ? { expectedProductVersion: Number(input.expectedProductVersion) }
      : {}),
    ...(expectedCurrentRevisionId ? { expectedCurrentRevisionId } : {}),
    ...(input.reasonCode !== undefined
      ? {
          reasonCode:
            input.reasonCode as ImportRowDecisionRequest['reasonCode'],
        }
      : {}),
  };
}

function normalizedCandidate(value: Prisma.JsonValue): ImportCatalogCandidate {
  const candidate = object(value, 'normalizedCandidate');
  const stringValue = (key: string): string | null | undefined => {
    const item = candidate[key];
    if (item === undefined) return undefined;
    if (item === null) return null;
    if (typeof item !== 'string')
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    return item;
  };
  const categoryId = stringValue('categoryId');
  const displayName = stringValue('displayName');
  if (typeof categoryId !== 'string' || typeof displayName !== 'string')
    throw new StaffError('INVALID_STATE_TRANSITION');
  const rawAttributes =
    candidate.attributes === undefined ? [] : candidate.attributes;
  if (!Array.isArray(rawAttributes))
    throw new StaffError('DEPENDENCY_UNAVAILABLE');
  const attributes = rawAttributes.map((raw) => {
    const attribute = object(raw, 'attributes');
    const valueType = attribute.valueType;
    const definitionId = attribute.attributeDefinitionId;
    if (
      typeof definitionId !== 'string' ||
      !['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'].includes(
        String(valueType),
      )
    )
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    const valueKey = (
      {
        TEXT: 'valueText',
        DECIMAL: 'valueDecimal',
        INTEGER: 'valueInteger',
        BOOLEAN: 'valueBoolean',
        ENUM: 'valueEnumCode',
      } as const
    )[valueType as 'TEXT' | 'DECIMAL' | 'INTEGER' | 'BOOLEAN' | 'ENUM'];
    const value = attribute[valueKey];
    if (value === undefined || value === null)
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    return {
      attributeDefinitionId: definitionId,
      valueType:
        valueType as ImportCatalogCandidate['attributes'][number]['valueType'],
      value,
    };
  });
  return {
    categoryId,
    ...(stringValue('brandId') !== undefined
      ? { brandId: stringValue('brandId')! }
      : {}),
    displayName,
    ...(stringValue('summary') !== undefined
      ? { summary: stringValue('summary')! }
      : {}),
    ...(stringValue('description') !== undefined
      ? { description: stringValue('description')! }
      : {}),
    ...(stringValue('manufacturerName') !== undefined
      ? { manufacturerName: stringValue('manufacturerName')! }
      : {}),
    ...(stringValue('originalPartNumber') !== undefined
      ? { originalPartNumber: stringValue('originalPartNumber')! }
      : {}),
    ...(stringValue('modification') !== undefined
      ? { modification: stringValue('modification')! }
      : {}),
    attributes,
  };
}

type Tx = Prisma.TransactionClient;
type ImportRun = Prisma.CatalogImportRunGetPayload<{
  include: { sourceFileVersion: true };
}>;

class CrossOwnerAccessDenied extends Error {
  constructor(
    readonly runId: string | null,
    readonly rowId: string | null,
    readonly ownerStaffUserId: string,
    readonly accessKind: 'READ' | 'MUTATION',
  ) {
    super('Cross-owner access denied.');
  }
}

@Injectable()
export class CatalogImportService {
  constructor(
    @Inject(DATABASE) private readonly db: PrismaDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PrivateFileStorage) private readonly storage: PrivateFileStorage,
    @Inject(CatalogProductService)
    private readonly products: CatalogProductService,
  ) {}

  async upload(
    request: StaffRequest,
    file:
      | { buffer: Buffer; originalname: string; mimetype: string; size: number }
      | undefined,
    keyValue: unknown,
    encodingValue: unknown,
    delimiterValue: unknown,
  ) {
    const actor = this.actor(request);
    let actionError: unknown;
    try {
      const key = uuid(keyValue, 'idempotencyKey');
      if (
        !file ||
        !Buffer.isBuffer(file.buffer) ||
        file.size !== file.buffer.length ||
        !file.size
      )
        throw new StaffError('FILE_REJECTED');
      if (file.size > 10 * 1024 * 1024) throw new StaffError('FILE_TOO_LARGE');
      const filename = sanitizeFilename(file.originalname);
      const extension = filename.split('.').at(-1)?.toLowerCase();
      const format =
        extension === 'csv' ? 'CSV' : extension === 'xlsx' ? 'XLSX' : null;
      if (!format) throw new StaffError('UNSUPPORTED_MEDIA_TYPE');
      const mime = file.mimetype.toLowerCase();
      if (!(format === 'CSV' ? CSV_MIMES : XLSX_MIMES).has(mime))
        throw new StaffError('UNSUPPORTED_MEDIA_TYPE');
      if (
        format === 'XLSX' &&
        (encodingValue !== undefined || delimiterValue !== undefined)
      )
        throw validation('csvOptions', 'XLSX_OPTIONS_FORBIDDEN');
      const encoding =
        format === 'CSV'
          ? encodingValue === undefined
            ? 'UTF-8'
            : encodingValue
          : null;
      if (
        format === 'CSV' &&
        encoding !== 'UTF-8' &&
        encoding !== 'WINDOWS-1251'
      )
        throw validation('csvEncoding', 'INVALID_ENUM');
      const delimiter =
        format === 'CSV'
          ? delimiterFrom(file.buffer, delimiterValue as string | undefined)
          : null;
      if (
        delimiterValue !== undefined &&
        format === 'CSV' &&
        delimiter !== delimiterValue
      )
        throw validation('csvDelimiter', 'INVALID_ENUM');
      const options = { encoding, delimiter };
      const fileHash = sha256(file.buffer);
      const requestHash = sha256(
        canonical({
          actorId: actor.id,
          contentSha256: fileHash.toString('hex'),
          format,
          filename,
          mime,
          options,
        }),
      );

      const replay = await this.db.$transaction(async (tx) => {
        await this.requirePermissions(tx, actor, [
          'catalog.products.read',
          'catalog.products.write',
        ]);
        return tx.catalogImportRun.findUnique({
          where: {
            uploaderStaffUserId_uploadIdempotencyKey: {
              uploaderStaffUserId: actor.id,
              uploadIdempotencyKey: key,
            },
          },
          include: { sourceFileVersion: true },
        });
      });
      if (replay) {
        if (!Buffer.from(replay.uploadRequestHash).equals(requestHash))
          throw new StaffError('IDEMPOTENCY_KEY_REUSED');
        return this.runResponse(replay, request.requestId);
      }

      return await this.createUploadedRun(
        request,
        actor,
        key,
        requestHash,
        fileHash,
        file.size,
        filename,
        mime,
        format,
        options,
        file.buffer,
      );
    } catch (error) {
      actionError = error;
      throw error;
    } finally {
      if (actionError)
        await this.writeDenied(
          request,
          actor,
          'catalog.import.created',
          actionError,
        );
    }
  }

  private async createUploadedRun(
    request: StaffRequest,
    actor: StaffPrincipal,
    idempotencyKey: string,
    requestHash: Buffer,
    fileHash: Buffer,
    size: number,
    filename: string,
    declaredMime: string,
    format: 'CSV' | 'XLSX',
    options: { encoding: unknown; delimiter: string | null },
    content: Buffer,
  ) {
    let write: OwnedStorageWrite | null = null;
    try {
      return await this.db.$transaction(
        async (tx) => {
          await this.requirePermissions(tx, actor, [
            'catalog.products.read',
            'catalog.products.write',
          ]);
          await tx.$queryRaw<{ lockAcquired: string }[]>`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${`${actor.id}:${idempotencyKey}`},0)
            )::text AS "lockAcquired"
          `;
          const prior = await tx.catalogImportRun.findUnique({
            where: {
              uploaderStaffUserId_uploadIdempotencyKey: {
                uploaderStaffUserId: actor.id,
                uploadIdempotencyKey: idempotencyKey,
              },
            },
            include: { sourceFileVersion: true },
          });
          if (prior) {
            if (!Buffer.from(prior.uploadRequestHash).equals(requestHash))
              throw new StaffError('IDEMPOTENCY_KEY_REUSED');
            return this.runResponse(prior, request.requestId);
          }
          await tx.$executeRawUnsafe(`
            CREATE TEMP TABLE catalog_import_parse_row_staging (
              sheet_index integer NOT NULL,
              sheet_name varchar(128),
              source_row_number integer NOT NULL,
              source_cells jsonb NOT NULL,
              candidate_state text NOT NULL,
              validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
              PRIMARY KEY (sheet_index, source_row_number)
            ) ON COMMIT DROP
          `);
          const parsed = await parseImportSource({
            content,
            filename,
            declaredMime,
            format,
            ...(format === 'CSV'
              ? {
                  csvEncoding: options.encoding as 'UTF-8' | 'WINDOWS-1251',
                  csvDelimiter: options.delimiter as ',' | ';' | '\t',
                }
              : {}),
            onRows: async (rows, sheets) => {
              const sheetNames = new Map(
                sheets.map(({ sheetIndex, sheetName }) => [
                  sheetIndex,
                  sheetName,
                ]),
              );
              const stagedRows = rows.map((row) => ({
                sheetIndex: row.sheetIndex,
                sheetName: sheetNames.get(row.sheetIndex) ?? null,
                sourceRowNumber: row.sourceRowNumber,
                sourceCells: row.cells,
                candidateState: 'NEEDS_MAPPING',
                validationIssues: [],
              }));
              try {
                await tx.$executeRaw`
                  INSERT INTO pg_temp.catalog_import_parse_row_staging
                    (sheet_index,sheet_name,source_row_number,source_cells,candidate_state,validation_issues)
                  SELECT r."sheetIndex",r."sheetName",r."sourceRowNumber",r."sourceCells",r."candidateState",r."validationIssues"
                  FROM jsonb_to_recordset(${JSON.stringify(stagedRows)}::jsonb) AS r(
                    "sheetIndex" integer,"sheetName" text,"sourceRowNumber" integer,
                    "sourceCells" jsonb,"candidateState" text,"validationIssues" jsonb
                  )
                `;
              } catch {
                throw new StaffError('DEPENDENCY_UNAVAILABLE');
              }
            },
          });
          for (const issue of parsed.sourceParseIssues) {
            if (issue.code !== 'MALFORMED_CSV') continue;
            const match =
              /^CSV logical record ([1-9][0-9]*) could not be parsed\.$/.exec(
                issue.message,
              );
            if (!match) throw new StaffError('INGESTION_UNAVAILABLE');
            const sourceRowNumber = Number(match[1]);
            try {
              await tx.$executeRaw`
                INSERT INTO pg_temp.catalog_import_parse_row_staging
                  (sheet_index,sheet_name,source_row_number,source_cells,candidate_state,validation_issues)
                VALUES (0,'CSV',${sourceRowNumber},'[]'::jsonb,'INVALID',
                  '[{"field":"source","code":"MALFORMED_CSV"}]'::jsonb)
              `;
            } catch {
              throw new StaffError('INGESTION_UNAVAILABLE');
            }
          }
          const normalizedMime =
            format === 'CSV'
              ? 'text/csv'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          write = await this.storage.writeOwned(Readable.from([content]));
          if (
            write.stored.size !== size ||
            write.stored.sha256 !== fileHash.toString('hex')
          )
            throw new StaffError('DEPENDENCY_UNAVAILABLE');
          const objectId = randomUUID();
          const versionId = randomUUID();
          const runId = randomUUID();
          const now = new Date();
          await tx.fileObject.create({
            data: {
              id: objectId,
              ownerStaffUserId: actor.id,
              displayName: filename,
              visibility: 'PRIVATE',
              state: 'ACTIVE',
              version: 1,
              createdAt: now,
              updatedAt: now,
            },
          });
          await tx.fileVersion.create({
            data: {
              id: versionId,
              fileObjectId: objectId,
              number: 1,
              storageKey: write.stored.key,
              sha256: Uint8Array.from(fileHash),
              sizeBytes: BigInt(size),
              mimeType: normalizedMime,
              originalFilename: filename,
              safetyState: 'UNCHECKED',
              createdByUserId: actor.id,
            },
          });
          const state = parsed.sourceParseIssues.length
            ? 'SOURCE_PARTIAL'
            : 'SOURCE_READY';
          const run = await tx.catalogImportRun.create({
            data: {
              id: runId,
              uploaderStaffUserId: actor.id,
              sourceFileObjectId: objectId,
              sourceFileVersionId: versionId,
              sourceFormat: format,
              sourceEncoding: options.encoding as string | null,
              sourceDelimiter: options.delimiter,
              state,
              parserVersion: parsed.parserVersion,
              sourceParseIssues:
                parsed.sourceParseIssues as Prisma.InputJsonValue,
              uploadIdempotencyKey: idempotencyKey,
              uploadRequestHash: Uint8Array.from(requestHash),
              createdAt: now,
              updatedAt: now,
            },
          });
          await tx.$executeRaw`
            INSERT INTO catalog_import_row (
              id,import_run_id,sheet_index,sheet_name,source_row_number,source_cells,
              normalized_candidate,validation_issues,warnings,candidate_state,version,created_at,updated_at
            )
            SELECT gen_random_uuid(),${run.id}::uuid,sheet_index,sheet_name,source_row_number,source_cells,
              '{}'::jsonb,validation_issues,'[]'::jsonb,candidate_state,1,transaction_timestamp(),transaction_timestamp()
            FROM pg_temp.catalog_import_parse_row_staging
            ORDER BY sheet_index,source_row_number
          `;
          await this.createRequiredAudit(tx, {
            actorKind: 'STAFF',
            actorUserId: actor.id,
            action: 'catalog.import.created',
            entityType: 'CatalogImportRun',
            entityId: run.id,
            outcome: 'SUCCESS',
            reasonCode: null,
            requestId: request.requestId,
            sourceHash: fileHash,
            changes: {
              sourceSha256: fileHash.toString('hex'),
              sourceFormat: format,
              sizeBytes: size,
              state,
              parserVersion: parsed.parserVersion,
              parsedRowCount: parsed.rowCount,
              sourceParseIssueCount: parsed.sourceParseIssues.length,
            },
          });
          const completed = await tx.catalogImportRun.findUnique({
            where: { id: run.id },
            include: { sourceFileVersion: true },
          });
          if (!completed) throw new StaffError('DEPENDENCY_UNAVAILABLE');
          return this.runResponse(completed, request.requestId, tx);
        },
        { isolationLevel: 'ReadCommitted', timeout: 30_000 },
      );
    } catch (error) {
      if (write) {
        try {
          await this.storage.removeOwned(write);
        } catch {
          console.error(
            `requestId=${request.requestId} code=PRIVATE_STORAGE_COMPENSATION_FAILED`,
          );
        }
      }
      throw this.mapError(error);
    }
  }

  async list(
    request: StaffRequest,
    pageSizeValue: unknown,
    cursorValue: unknown,
    ownerValue: unknown,
  ) {
    const actor = this.actor(request);
    const limit = pageSize(pageSizeValue);
    const after = cursor(cursorValue);
    const ownerId =
      ownerValue === undefined
        ? actor.id
        : uuid(ownerValue, 'ownerStaffUserId');
    return this.withCrossOwnerDenialAudit(request, actor, () =>
      this.db.$transaction(async (tx) => {
        await this.requirePermissions(tx, actor, ['catalog.products.read']);
        const crossOwner = ownerId !== actor.id;
        if (crossOwner)
          await this.requireCrossOwner(tx, actor, false, {
            runId: null,
            rowId: null,
            ownerStaffUserId: ownerId,
          });
        const rows = await tx.$queryRaw<
          { id: string; createdAtCursor: string }[]
        >`
        SELECT r.id::text AS id,
          to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtCursor"
        FROM catalog_import_run r
        WHERE r.uploader_staff_user_id=${ownerId}::uuid
          AND (${after?.createdAt ?? null}::timestamptz IS NULL OR (r.created_at,r.id)>(${after?.createdAt ?? null}::timestamptz,${after?.id ?? null}::uuid))
        ORDER BY r.created_at,r.id LIMIT ${limit + 1}
      `;
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const found = await tx.catalogImportRun.findMany({
          where: { id: { in: page.map((row) => row.id) } },
          include: { sourceFileVersion: true },
        });
        const byId = new Map(found.map((run) => [run.id, run]));
        const result = [];
        for (const row of page) {
          const run = byId.get(row.id);
          if (!run) continue;
          if (crossOwner)
            await this.auditCrossOwner(
              tx,
              actor,
              run.id,
              null,
              ownerId,
              'READ',
              request.requestId,
            );
          result.push(
            (await this.runResponse(run, request.requestId, tx)).data,
          );
        }
        const last = page.at(-1);
        return {
          data: result,
          meta: {
            requestId: request.requestId,
            pageSize: limit,
            nextCursor: hasMore && last ? encodeCursor(last) : null,
          },
        };
      }),
    );
  }

  async getRun(request: StaffRequest, runIdValue: string) {
    const actor = this.actor(request);
    const runId = uuid(runIdValue, 'runId');
    return this.withCrossOwnerDenialAudit(request, actor, () =>
      this.db.$transaction(async (tx) => {
        await this.requirePermissions(tx, actor, ['catalog.products.read']);
        const run = await tx.catalogImportRun.findUnique({
          where: { id: runId },
          include: { sourceFileVersion: true },
        });
        if (!run) throw new StaffError('NOT_FOUND');
        if (run.uploaderStaffUserId !== actor.id) {
          await this.requireCrossOwner(tx, actor, false, {
            runId: run.id,
            rowId: null,
            ownerStaffUserId: run.uploaderStaffUserId,
          });
          await this.auditCrossOwner(
            tx,
            actor,
            run.id,
            null,
            run.uploaderStaffUserId,
            'READ',
            request.requestId,
          );
        }
        return this.runResponse(run, request.requestId, tx);
      }),
    );
  }

  async setMapping(request: StaffRequest, runIdValue: string, body: unknown) {
    const actor = this.actor(request);
    let runId: string;
    let mapping: ImportMappingRequest;
    let storedMapping: Pick<
      ImportMappingRequest,
      'mappingSchemaVersion' | 'sheetMappings'
    >;
    try {
      runId = uuid(runIdValue, 'runId');
      mapping = parseMapping(body);
      storedMapping = {
        mappingSchemaVersion: mapping.mappingSchemaVersion,
        sheetMappings: mapping.sheetMappings,
      };
      if (Buffer.byteLength(canonical(storedMapping), 'utf8') > 2 * 1024 * 1024)
        throw validation('sheetMappings', 'OUT_OF_RANGE');
    } catch (error) {
      await this.writeDenied(
        request,
        actor,
        'catalog.import.mapping.changed',
        error,
      );
      throw this.mapError(error);
    }
    try {
      return await this.db.$transaction(
        async (tx) => {
          await this.requirePermissions(tx, actor, [
            'catalog.products.read',
            'catalog.products.write',
            'catalog.references.read',
          ]);
          const run = await tx.catalogImportRun.findUnique({
            where: { id: runId },
            include: { sourceFileVersion: true },
          });
          if (!run) throw new StaffError('NOT_FOUND');
          const crossOwner = run.uploaderStaffUserId !== actor.id;
          if (crossOwner)
            await this.requireCrossOwner(tx, actor, true, {
              runId,
              rowId: null,
              ownerStaffUserId: run.uploaderStaffUserId,
            });
          await tx.$queryRaw`SELECT id FROM catalog_import_run WHERE id=${runId}::uuid FOR UPDATE`;
          const locked = await tx.catalogImportRun.findUnique({
            where: { id: runId },
          });
          if (!locked) throw new StaffError('NOT_FOUND');
          if (locked.version !== mapping.expectedVersion)
            throw new StaffError('VERSION_CONFLICT');
          const terminal = await tx.catalogImportRow.count({
            where: {
              importRunId: runId,
              candidateState: { in: ['APPLIED', 'REJECTED'] },
            },
          });
          if (terminal) throw new StaffError('INVALID_STATE_TRANSITION');

          const rowSheets = await tx.catalogImportRow.groupBy({
            by: ['sheetIndex'],
            where: { importRunId: runId },
          });
          const sourceSheets = new Set(
            rowSheets.map((sheet) => sheet.sheetIndex),
          );
          for (const sheet of mapping.sheetMappings) {
            if (!sourceSheets.has(sheet.sheetIndex))
              throw validation('sheetIndex', 'UNKNOWN_SHEET');
            const header = await tx.catalogImportRow.findFirst({
              where: {
                importRunId: runId,
                sheetIndex: sheet.sheetIndex,
                sourceRowNumber: sheet.headerRowNumber,
              },
              select: { id: true },
            });
            if (!header) throw validation('headerRowNumber', 'UNKNOWN_ROW');
          }
          const mappedSheets = new Set(
            mapping.sheetMappings.map((sheet) => sheet.sheetIndex),
          );
          const categoryIds = new Set<string>();
          const brandIds = new Set<string>();
          const attributePairs = new Map<string, string>();
          for (const sheet of mapping.sheetMappings) {
            if (sheet.fixedCategoryId) categoryIds.add(sheet.fixedCategoryId);
            if (sheet.fixedBrandId) brandIds.add(sheet.fixedBrandId);
            for (const reference of sheet.referenceMappings) {
              (reference.target === 'categoryId' ? categoryIds : brandIds).add(
                reference.targetId,
              );
            }
            for (const column of sheet.columnMappings) {
              if (
                column.target === 'attribute' &&
                column.attributeDefinitionId &&
                column.categoryId
              )
                attributePairs.set(
                  column.attributeDefinitionId,
                  column.categoryId,
                );
            }
          }
          const activeCategories = categoryIds.size
            ? await tx.$queryRaw<
                { id: string }[]
              >`SELECT id::text AS id FROM category WHERE id=ANY(${[...categoryIds]}::uuid[]) AND state='ACTIVE' ORDER BY id FOR SHARE`
            : [];
          const activeBrands = brandIds.size
            ? await tx.$queryRaw<
                { id: string }[]
              >`SELECT id::text AS id FROM brand WHERE id=ANY(${[...brandIds]}::uuid[]) AND state='ACTIVE' ORDER BY id FOR SHARE`
            : [];
          if (
            activeCategories.length !== categoryIds.size ||
            activeBrands.length !== brandIds.size
          )
            throw new StaffError('NOT_FOUND');
          const attributes = attributePairs.size
            ? await tx.$queryRaw<
                { id: string; categoryId: string; state: string }[]
              >`
              SELECT id::text AS id,category_id::text AS "categoryId",state
              FROM attribute_definition WHERE id=ANY(${[...attributePairs.keys()]}::uuid[])
              ORDER BY id FOR SHARE`
            : [];
          if (
            attributes.length !== attributePairs.size ||
            attributes.some(
              (item) =>
                item.state !== 'ACTIVE' ||
                attributePairs.get(item.id) !== item.categoryId,
            )
          )
            throw new StaffError('ATTRIBUTE_NOT_APPLICABLE');

          await tx.catalogImportRow.updateMany({
            where: {
              importRunId: runId,
              candidateState: { notIn: ['APPLIED', 'REJECTED'] },
              sourceCells: { not: [] },
            },
            data: {
              candidateState: 'NEEDS_MAPPING',
              normalizedCandidate: {} as Prisma.InputJsonObject,
              validationIssues: [] as Prisma.InputJsonArray,
              warnings: [] as Prisma.InputJsonArray,
              matchedProductId: null,
              expectedProductVersion: null,
              expectedCurrentRevisionId: null,
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          for (const sheetIndex of sourceSheets) {
            if (!mappedSheets.has(sheetIndex)) {
              await tx.catalogImportRow.updateMany({
                where: {
                  importRunId: runId,
                  sheetIndex,
                  candidateState: { notIn: ['APPLIED', 'REJECTED'] },
                  sourceCells: { not: [] },
                },
                data: {
                  candidateState: 'IGNORED',
                  version: { increment: 1 },
                  updatedAt: new Date(),
                },
              });
              continue;
            }
            const selected = mapping.sheetMappings.find(
              (item) => item.sheetIndex === sheetIndex,
            )!;
            await tx.catalogImportRow.updateMany({
              where: {
                importRunId: runId,
                sheetIndex,
                sourceRowNumber: selected.headerRowNumber,
                candidateState: { notIn: ['APPLIED', 'REJECTED'] },
                sourceCells: { not: [] },
              },
              data: {
                candidateState: 'HEADER',
                version: { increment: 1 },
                updatedAt: new Date(),
              },
            });
          }
          const updated = await tx.catalogImportRun.update({
            where: { id: runId },
            data: {
              mapping: storedMapping as unknown as Prisma.InputJsonObject,
              mappingVersion: { increment: 1 },
              version: { increment: 1 },
              state: 'MAPPED',
              updatedAt: new Date(),
            },
            include: { sourceFileVersion: true },
          });
          const changed = {
            mappingVersion: updated.mappingVersion,
            mappingHash: sha256(canonical(storedMapping)).toString('hex'),
            mappedFieldCount: mapping.sheetMappings.reduce(
              (sum, sheet) =>
                sum +
                sheet.columnMappings.length +
                sheet.referenceMappings.length +
                Number(Boolean(sheet.fixedCategoryId)) +
                Number(Boolean(sheet.fixedBrandId)),
              0,
            ),
            version: updated.version,
          };
          await this.createRequiredAudit(tx, {
            actorKind: 'STAFF',
            actorUserId: actor.id,
            action: 'catalog.import.mapping.changed',
            entityType: 'CatalogImportRun',
            entityId: runId,
            outcome: 'SUCCESS',
            reasonCode: null,
            requestId: request.requestId,
            changes: changed,
          });
          if (crossOwner)
            await this.auditCrossOwner(
              tx,
              actor,
              runId,
              null,
              run.uploaderStaffUserId,
              'MUTATION',
              request.requestId,
            );
          return this.runResponse(updated, request.requestId, tx);
        },
        { isolationLevel: 'ReadCommitted', timeout: 30_000 },
      );
    } catch (error) {
      if (error instanceof CrossOwnerAccessDenied)
        return this.withCrossOwnerDenialAudit(request, actor, async () => {
          throw error;
        });
      await this.writeDenied(
        request,
        actor,
        'catalog.import.mapping.changed',
        error,
      );
      throw this.mapError(error);
    }
  }

  async listRows(
    request: StaffRequest,
    runIdValue: string,
    pageSizeValue: unknown,
    cursorValue: unknown,
  ) {
    const actor = this.actor(request);
    const runId = uuid(runIdValue, 'runId');
    const limit = pageSize(pageSizeValue);
    const after = decodePositionCursor(cursorValue, 'row');
    return this.withCrossOwnerDenialAudit(request, actor, () =>
      this.db.$transaction(async (tx) => {
        await this.requirePermissions(tx, actor, ['catalog.products.read']);
        const run = await tx.catalogImportRun.findUnique({
          where: { id: runId },
        });
        if (!run) throw new StaffError('NOT_FOUND');
        const crossOwner = run.uploaderStaffUserId !== actor.id;
        if (crossOwner) {
          await this.requireCrossOwner(tx, actor, false, {
            runId,
            rowId: null,
            ownerStaffUserId: run.uploaderStaffUserId,
          });
          await this.auditCrossOwner(
            tx,
            actor,
            runId,
            null,
            run.uploaderStaffUserId,
            'READ',
            request.requestId,
          );
        }
        const positions = await tx.$queryRaw<
          { id: string; sheetIndex: number; sourceRowNumber: number }[]
        >`
        SELECT id::text AS id,sheet_index AS "sheetIndex",source_row_number AS "sourceRowNumber"
        FROM catalog_import_row
        WHERE import_run_id=${runId}::uuid
          AND (${after?.sheetIndex ?? null}::integer IS NULL OR
            (sheet_index,source_row_number,id)>(${after?.sheetIndex ?? null}::integer,${after?.sourceRowNumber ?? null}::integer,${after?.id ?? null}::uuid))
        ORDER BY sheet_index,source_row_number,id LIMIT ${limit + 1}
      `;
        const hasMore = positions.length > limit;
        const page = hasMore ? positions.slice(0, limit) : positions;
        const found = await tx.catalogImportRow.findMany({
          where: { id: { in: page.map((item) => item.id) } },
        });
        const byId = new Map(found.map((row) => [row.id, row]));
        const data = page.flatMap((position) => {
          const row = byId.get(position.id);
          if (!row) return [];
          return [
            {
              id: row.id,
              sheetIndex: row.sheetIndex,
              sheetName: row.sheetName,
              sourceRowNumber: row.sourceRowNumber,
              sourceCells: row.sourceCells,
              normalizedCandidate: row.normalizedCandidate,
              validationIssues: row.validationIssues,
              warnings: row.warnings,
              candidateState: row.candidateState,
              matchedProductId: row.matchedProductId,
              expectedProductVersion: row.expectedProductVersion,
              expectedCurrentRevisionId: row.expectedCurrentRevisionId,
              version: row.version,
            },
          ];
        });
        const last = page.at(-1);
        return {
          data,
          meta: {
            requestId: request.requestId,
            pageSize: limit,
            nextCursor: hasMore && last ? encodeRowCursor(last) : null,
          },
        };
      }),
    );
  }

  async history(
    request: StaffRequest,
    runIdValue: string,
    rowIdValue: string,
    pageSizeValue?: unknown,
    cursorValue?: unknown,
  ) {
    const actor = this.actor(request);
    const runId = uuid(runIdValue, 'runId');
    const rowId = uuid(rowIdValue, 'rowId');
    const limit = pageSize(pageSizeValue);
    const after = decodePositionCursor(cursorValue, 'decision');
    return this.withCrossOwnerDenialAudit(request, actor, () =>
      this.db.$transaction(async (tx) => {
        await this.requirePermissions(tx, actor, ['catalog.products.read']);
        const run = await tx.catalogImportRun.findUnique({
          where: { id: runId },
        });
        if (!run) throw new StaffError('NOT_FOUND');
        const row = await tx.catalogImportRow.findFirst({
          where: { id: rowId, importRunId: runId },
        });
        if (!row) throw new StaffError('NOT_FOUND');
        if (run.uploaderStaffUserId !== actor.id) {
          await this.requireCrossOwner(tx, actor, false, {
            runId,
            rowId,
            ownerStaffUserId: run.uploaderStaffUserId,
          });
          await this.auditCrossOwner(
            tx,
            actor,
            runId,
            rowId,
            run.uploaderStaffUserId,
            'READ',
            request.requestId,
          );
        }
        const positions = await tx.$queryRaw<
          { id: string; createdAtCursor: string }[]
        >`
        SELECT id::text AS id,
          to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtCursor"
        FROM catalog_import_decision
        WHERE row_id=${rowId}::uuid
          AND (${after?.createdAt ?? null}::timestamptz IS NULL OR
            (created_at,id)>(${after?.createdAt ?? null}::timestamptz,${after?.id ?? null}::uuid))
        ORDER BY created_at,id LIMIT ${limit + 1}
      `;
        const hasMore = positions.length > limit;
        const page = hasMore ? positions.slice(0, limit) : positions;
        const decisions = await tx.catalogImportDecision.findMany({
          where: { id: { in: page.map((item) => item.id) } },
        });
        const byId = new Map(
          decisions.map((decision) => [decision.id, decision]),
        );
        const data = page.flatMap((position) => {
          const decision = byId.get(position.id);
          return decision ? [this.decisionView(decision)] : [];
        });
        const last = page.at(-1);
        return {
          data,
          meta: {
            requestId: request.requestId,
            pageSize: limit,
            nextCursor: hasMore && last ? encodeCursor(last) : null,
          },
        };
      }),
    );
  }

  async decide(
    request: StaffRequest,
    runIdValue: string,
    rowIdValue: string,
    body: unknown,
    keyValue: unknown,
  ) {
    const actor = this.actor(request);
    let runId: string;
    let rowId: string;
    let idempotencyKey: string;
    let input: ImportRowDecisionRequest;
    let requestHash: Buffer;
    try {
      runId = uuid(runIdValue, 'runId');
      rowId = uuid(rowIdValue, 'rowId');
      idempotencyKey = uuid(keyValue, 'idempotencyKey');
      input = parseDecision(body);
      requestHash = sha256(
        canonical({ actorId: actor.id, runId, rowId, ...input }),
      );
    } catch (error) {
      await this.writeDenied(
        request,
        actor,
        'catalog.import.row.decided',
        error,
      );
      throw this.mapError(error);
    }
    try {
      return await this.db.$transaction(
        async (tx) => {
          await this.requirePermissions(tx, actor, [
            'catalog.products.read',
            'catalog.products.write',
            'catalog.references.read',
          ]);
          const run = await tx.catalogImportRun.findUnique({
            where: { id: runId },
          });
          if (!run) throw new StaffError('NOT_FOUND');
          const crossOwner = run.uploaderStaffUserId !== actor.id;
          if (crossOwner)
            await this.requireCrossOwner(tx, actor, true, {
              runId,
              rowId,
              ownerStaffUserId: run.uploaderStaffUserId,
            });
          await tx.$queryRaw`SELECT id FROM catalog_import_run WHERE id=${runId}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM catalog_import_row WHERE id=${rowId}::uuid AND import_run_id=${runId}::uuid FOR UPDATE`;
          const row = await tx.catalogImportRow.findFirst({
            where: { id: rowId, importRunId: runId },
          });
          if (!row) throw new StaffError('NOT_FOUND');
          const prior = await tx.catalogImportDecision.findUnique({
            where: { rowId_idempotencyKey: { rowId, idempotencyKey } },
          });
          if (prior) {
            if (!Buffer.from(prior.requestHash).equals(requestHash))
              throw new StaffError('IDEMPOTENCY_KEY_REUSED');
            if (prior.outcome === 'CONFLICT')
              throw new StaffError(
                prior.conflictCode as
                  'IMPORT_ROW_CONFLICT' | 'IDENTITY_CONFLICT',
              );
            return {
              data: this.decisionView(prior),
              meta: { requestId: request.requestId },
            };
          }
          if (row.version !== input.expectedRowVersion)
            throw new StaffError('VERSION_CONFLICT');
          if (
            ![
              'PREVIEW_READY',
              'PREVIEW_PARTIAL',
              'COMPLETED_WITH_ISSUES',
            ].includes(run.state)
          )
            throw new StaffError('INVALID_STATE_TRANSITION');
          if (
            ['APPLIED', 'REJECTED', 'HEADER', 'IGNORED'].includes(
              row.candidateState,
            )
          )
            throw new StaffError('INVALID_STATE_TRANSITION');
          if (
            input.action === 'ACCEPT_CREATE' &&
            !['NEW', 'NO_DEDUP_KEY'].includes(row.candidateState)
          )
            throw new StaffError('INVALID_STATE_TRANSITION');
          if (input.action === 'ACCEPT_REVISION') {
            if (
              row.candidateState !== 'EXACT_MATCH' ||
              !row.matchedProductId ||
              row.expectedProductVersion === null ||
              !row.expectedCurrentRevisionId
            )
              throw new StaffError('INVALID_STATE_TRANSITION');
            if (
              input.expectedProductVersion !== row.expectedProductVersion ||
              input.expectedCurrentRevisionId !== row.expectedCurrentRevisionId
            )
              throw new StaffError('VERSION_CONFLICT');
          }
          const candidate = normalizedCandidate(row.normalizedCandidate);
          let targetProductId: string | null = null;
          let resultRevisionId: string | null = null;
          let outcome: 'APPLIED' | 'REJECTED' | 'HELD';
          let nextState: string;
          if (input.action === 'ACCEPT_CREATE') {
            const result = await this.products.createImportProductDraft(
              tx,
              actor,
              request.requestId,
              slugFromName(candidate.displayName),
              candidate,
            );
            targetProductId = result.productId;
            resultRevisionId = result.revisionId;
            outcome = 'APPLIED';
            nextState = 'APPLIED';
          } else if (input.action === 'ACCEPT_REVISION') {
            let result: Awaited<
              ReturnType<CatalogProductService['createImportProductRevision']>
            >;
            try {
              result = await this.products.createImportProductRevision(
                tx,
                actor,
                request.requestId,
                {
                  productId: row.matchedProductId!,
                  expectedProductVersion: input.expectedProductVersion!,
                  expectedCurrentRevisionId: input.expectedCurrentRevisionId!,
                  candidate,
                },
              );
            } catch (error) {
              if (
                error instanceof StaffError &&
                error.code === 'VERSION_CONFLICT'
              )
                throw new StaffError('IMPORT_ROW_CONFLICT');
              throw error;
            }
            targetProductId = result.productId;
            resultRevisionId = result.revisionId;
            outcome = 'APPLIED';
            nextState = 'APPLIED';
          } else if (input.action === 'REJECT') {
            outcome = 'REJECTED';
            nextState = 'REJECTED';
          } else {
            outcome = 'HELD';
            nextState = 'HELD';
          }
          const auditEventId = randomUUID();
          const auditChanges: Record<string, unknown> = {
            runId,
            sheetIndex: row.sheetIndex,
            sourceRowNumber: row.sourceRowNumber,
            action: input.action,
            outcome,
            targetProductId,
            resultRevisionId,
            expectedRowVersion: input.expectedRowVersion,
            ...(input.expectedProductVersion !== undefined
              ? { expectedProductVersion: input.expectedProductVersion }
              : {}),
          };
          try {
            await tx.auditEvent.create({
              data: {
                id: auditEventId,
                actorKind: 'STAFF',
                actorUserId: actor.id,
                action: 'catalog.import.row.decided',
                entityType: 'CatalogImportRow',
                entityId: rowId,
                outcome: 'SUCCESS',
                reasonCode: outcome,
                requestId: request.requestId,
                changes: auditChanges as Prisma.InputJsonObject,
              },
            });
          } catch {
            throw new StaffError('AUDIT_UNAVAILABLE');
          }
          const decision = await tx.catalogImportDecision.create({
            data: {
              id: randomUUID(),
              rowId,
              actorStaffUserId: actor.id,
              idempotencyKey,
              requestHash: Uint8Array.from(requestHash),
              expectedRowVersion: input.expectedRowVersion,
              mappingVersion: run.mappingVersion,
              action: input.action,
              outcome,
              conflictCode: null,
              targetProductId,
              resultRevisionId,
              auditEventId,
              reasonCode: input.reasonCode ?? null,
            },
          });
          await tx.catalogImportRow.update({
            where: { id: rowId },
            data: {
              candidateState: nextState,
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          await this.refreshRunState(tx, runId);
          if (crossOwner)
            await this.auditCrossOwner(
              tx,
              actor,
              runId,
              rowId,
              run.uploaderStaffUserId,
              'MUTATION',
              request.requestId,
            );
          return {
            data: this.decisionView(decision),
            meta: { requestId: request.requestId },
          };
        },
        { isolationLevel: 'ReadCommitted', timeout: 30_000 },
      );
    } catch (error) {
      if (error instanceof CrossOwnerAccessDenied)
        return this.withCrossOwnerDenialAudit(request, actor, async () => {
          throw error;
        });
      const mapped = this.mapError(error);
      if (
        mapped instanceof StaffError &&
        ['IMPORT_ROW_CONFLICT', 'IDENTITY_CONFLICT'].includes(mapped.code)
      ) {
        await this.recordConflict(
          request,
          actor,
          runId,
          rowId,
          idempotencyKey,
          requestHash,
          input,
          mapped.code as 'IMPORT_ROW_CONFLICT' | 'IDENTITY_CONFLICT',
        );
        throw mapped;
      }
      await this.writeDenied(
        request,
        actor,
        'catalog.import.row.decided',
        mapped,
      );
      throw mapped;
    }
  }

  private async recordConflict(
    request: StaffRequest,
    actor: StaffPrincipal,
    runId: string,
    rowId: string,
    idempotencyKey: string,
    requestHash: Buffer,
    input: ImportRowDecisionRequest,
    conflictCode: 'IMPORT_ROW_CONFLICT' | 'IDENTITY_CONFLICT',
  ) {
    await this.db.$transaction(
      async (tx) => {
        await this.requirePermissions(tx, actor, [
          'catalog.products.read',
          'catalog.products.write',
          'catalog.references.read',
        ]);
        const run = await tx.catalogImportRun.findUnique({
          where: { id: runId },
        });
        if (!run) throw new StaffError('NOT_FOUND');
        const crossOwner = run.uploaderStaffUserId !== actor.id;
        if (crossOwner)
          await this.requireCrossOwner(tx, actor, true, {
            runId,
            rowId,
            ownerStaffUserId: run.uploaderStaffUserId,
          });
        await tx.$queryRaw`SELECT id FROM catalog_import_run WHERE id=${runId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM catalog_import_row WHERE id=${rowId}::uuid AND import_run_id=${runId}::uuid FOR UPDATE`;
        const row = await tx.catalogImportRow.findFirst({
          where: { id: rowId, importRunId: runId },
        });
        if (!row) throw new StaffError('NOT_FOUND');
        const prior = await tx.catalogImportDecision.findUnique({
          where: { rowId_idempotencyKey: { rowId, idempotencyKey } },
        });
        if (prior) {
          if (!Buffer.from(prior.requestHash).equals(requestHash))
            throw new StaffError('IDEMPOTENCY_KEY_REUSED');
          if (prior.outcome === 'CONFLICT') return;
          throw new StaffError('VERSION_CONFLICT');
        }
        if (row.version !== input.expectedRowVersion)
          throw new StaffError('VERSION_CONFLICT');
        const auditEventId = randomUUID();
        try {
          await tx.auditEvent.create({
            data: {
              id: auditEventId,
              actorKind: 'STAFF',
              actorUserId: actor.id,
              action: 'catalog.import.row.decided',
              entityType: 'CatalogImportRow',
              entityId: rowId,
              outcome: 'DENIED',
              reasonCode: conflictCode,
              requestId: request.requestId,
              changes: {
                runId,
                sheetIndex: row.sheetIndex,
                sourceRowNumber: row.sourceRowNumber,
                action: input.action,
                outcome: 'CONFLICT',
                targetProductId: null,
                resultRevisionId: null,
                expectedRowVersion: input.expectedRowVersion,
                ...(input.expectedProductVersion !== undefined
                  ? { expectedProductVersion: input.expectedProductVersion }
                  : {}),
              } as Prisma.InputJsonObject,
            },
          });
        } catch {
          throw new StaffError('AUDIT_UNAVAILABLE');
        }
        await tx.catalogImportDecision.create({
          data: {
            id: randomUUID(),
            rowId,
            actorStaffUserId: actor.id,
            idempotencyKey,
            requestHash: Uint8Array.from(requestHash),
            expectedRowVersion: input.expectedRowVersion,
            mappingVersion: run.mappingVersion,
            action: input.action,
            outcome: 'CONFLICT',
            conflictCode,
            targetProductId: null,
            resultRevisionId: null,
            auditEventId,
            reasonCode: input.reasonCode ?? null,
          },
        });
        await tx.catalogImportRow.update({
          where: { id: rowId },
          data: {
            candidateState: 'CONFLICT',
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        await this.refreshRunState(tx, runId);
        if (crossOwner)
          await this.auditCrossOwner(
            tx,
            actor,
            runId,
            rowId,
            run.uploaderStaffUserId,
            'MUTATION',
            request.requestId,
          );
      },
      { isolationLevel: 'ReadCommitted', timeout: 30_000 },
    );
  }

  private async refreshRunState(tx: Tx, runId: string) {
    const run = await tx.catalogImportRun.findUnique({ where: { id: runId } });
    if (!run) throw new StaffError('NOT_FOUND');
    const rows = await tx.catalogImportRow.findMany({
      where: { importRunId: runId },
      select: { candidateState: true },
    });
    const included = rows
      .map(({ candidateState }) => candidateState)
      .filter((state) => state !== 'HEADER' && state !== 'IGNORED');
    const complete = included.every(
      (state) => state === 'APPLIED' || state === 'REJECTED',
    );
    const stillDecidable = included.some((state) =>
      ['NEW', 'EXACT_MATCH', 'NO_DEDUP_KEY'].includes(state),
    );
    let state: string;
    if (complete)
      state =
        run.sourceParseIssues instanceof Array &&
        run.sourceParseIssues.length === 0
          ? 'COMPLETED'
          : 'COMPLETED_WITH_ISSUES';
    else if (!stillDecidable) state = 'COMPLETED_WITH_ISSUES';
    else
      state =
        run.sourceParseIssues instanceof Array && run.sourceParseIssues.length
          ? 'PREVIEW_PARTIAL'
          : 'PREVIEW_READY';
    await tx.catalogImportRun.update({
      where: { id: runId },
      data: { state, version: { increment: 1 }, updatedAt: new Date() },
    });
  }

  private decisionView(decision: {
    id: string;
    rowId: string;
    action: string;
    outcome: string;
    conflictCode: string | null;
    mappingVersion: number;
    targetProductId: string | null;
    resultRevisionId: string | null;
    reasonCode: string | null;
    createdAt: Date;
  }) {
    return {
      id: decision.id,
      rowId: decision.rowId,
      action: decision.action,
      outcome: decision.outcome,
      conflictCode: decision.conflictCode,
      mappingVersion: decision.mappingVersion,
      targetProductId: decision.targetProductId,
      resultRevisionId: decision.resultRevisionId,
      reasonCode: decision.reasonCode,
      createdAt: decision.createdAt.toISOString(),
    };
  }

  async preview(request: StaffRequest, runIdValue: string) {
    const actor = this.actor(request);
    try {
      const runId = uuid(runIdValue, 'runId');
      return await this.db.$transaction(
        async (tx) => {
          await this.requirePermissions(tx, actor, [
            'catalog.products.read',
            'catalog.products.write',
            'catalog.references.read',
          ]);
          const run = await tx.catalogImportRun.findUnique({
            where: { id: runId },
            include: { sourceFileVersion: true },
          });
          if (!run) throw new StaffError('NOT_FOUND');
          const crossOwner = run.uploaderStaffUserId !== actor.id;
          if (crossOwner)
            await this.requireCrossOwner(tx, actor, true, {
              runId,
              rowId: null,
              ownerStaffUserId: run.uploaderStaffUserId,
            });
          await tx.$queryRaw`SELECT id FROM catalog_import_run WHERE id=${runId}::uuid FOR UPDATE`;
          const lockedRun = await tx.catalogImportRun.findUnique({
            where: { id: runId },
          });
          if (!lockedRun) throw new StaffError('NOT_FOUND');
          if (
            !lockedRun.mapping ||
            ![
              'MAPPED',
              'PREVIEW_READY',
              'PREVIEW_PARTIAL',
              'COMPLETED_WITH_ISSUES',
            ].includes(lockedRun.state)
          )
            throw new StaffError('INVALID_STATE_TRANSITION');
          const stored = lockedRun.mapping as unknown as {
            mappingSchemaVersion: number;
            sheetMappings: ImportMappingRequest['sheetMappings'];
          };
          if (
            stored.mappingSchemaVersion !== 1 ||
            !Array.isArray(stored.sheetMappings)
          )
            throw new StaffError('DEPENDENCY_UNAVAILABLE');
          const mappingBySheet = new Map(
            stored.sheetMappings.map((item) => [item.sheetIndex, item]),
          );
          const sourceRows = await tx.catalogImportRow.findMany({
            where: { importRunId: runId },
            orderBy: [{ sheetIndex: 'asc' }, { sourceRowNumber: 'asc' }],
          });
          const categoryIds = new Set<string>();
          const brandIds = new Set<string>();
          const attributeIds = new Set<string>();
          for (const sheet of stored.sheetMappings) {
            if (sheet.fixedCategoryId) categoryIds.add(sheet.fixedCategoryId);
            if (sheet.fixedBrandId) brandIds.add(sheet.fixedBrandId);
            for (const reference of sheet.referenceMappings)
              (reference.target === 'categoryId' ? categoryIds : brandIds).add(
                reference.targetId,
              );
            for (const column of sheet.columnMappings)
              if (column.target === 'attribute' && column.attributeDefinitionId)
                attributeIds.add(column.attributeDefinitionId);
          }
          const activeCategoryRows = categoryIds.size
            ? await tx.$queryRaw<
                { id: string }[]
              >`SELECT id::text AS id FROM category WHERE id=ANY(${[...categoryIds]}::uuid[]) AND state='ACTIVE' ORDER BY id FOR SHARE`
            : [];
          const activeBrandRows = brandIds.size
            ? await tx.$queryRaw<
                { id: string }[]
              >`SELECT id::text AS id FROM brand WHERE id=ANY(${[...brandIds]}::uuid[]) AND state='ACTIVE' ORDER BY id FOR SHARE`
            : [];
          const activeCategories = new Set(
            activeCategoryRows.map(({ id }) => id),
          );
          const activeBrands = new Set(activeBrandRows.map(({ id }) => id));
          const definitions = attributeIds.size
            ? await tx.$queryRaw<
                {
                  id: string;
                  categoryId: string;
                  valueType: string;
                  state: string;
                  enumOptions: Prisma.JsonValue | null;
                }[]
              >`
                SELECT id::text AS id,category_id::text AS "categoryId",
                  value_type AS "valueType",state,enum_options AS "enumOptions"
                FROM attribute_definition WHERE id=ANY(${[...attributeIds]}::uuid[])
                ORDER BY id FOR SHARE
              `
            : [];
          const definitionById = new Map(
            definitions.map((item) => [item.id, item]),
          );

          const prepared: {
            row: (typeof sourceRows)[number];
            state: string;
            candidate: Record<string, unknown>;
            issues: { field: string; code: string }[];
            warnings: { field: string; code: string }[];
            identityKey: string | null;
          }[] = [];
          for (const row of sourceRows) {
            if (['APPLIED', 'REJECTED'].includes(row.candidateState)) continue;
            const sourceCells = row.sourceCells as unknown;
            const validationIssues = row.validationIssues as unknown;
            const sourceInvalid =
              Array.isArray(sourceCells) &&
              sourceCells.length === 0 &&
              Array.isArray(validationIssues) &&
              validationIssues.some(
                (issue) =>
                  issue &&
                  typeof issue === 'object' &&
                  (issue as { field?: unknown }).field === 'source',
              );
            if (sourceInvalid) {
              prepared.push({
                row,
                state: 'INVALID',
                candidate: {},
                issues: validationIssues as { field: string; code: string }[],
                warnings: [],
                identityKey: null,
              });
              continue;
            }
            const sheet = mappingBySheet.get(row.sheetIndex);
            if (!sheet) {
              prepared.push({
                row,
                state: 'IGNORED',
                candidate: {},
                issues: [],
                warnings: [],
                identityKey: null,
              });
              continue;
            }
            if (row.sourceRowNumber === sheet.headerRowNumber) {
              prepared.push({
                row,
                state: 'HEADER',
                candidate: {},
                issues: [],
                warnings: [],
                identityKey: null,
              });
              continue;
            }
            const result = this.normalizeImportRow(
              row.sourceCells as unknown as {
                columnIndex: number;
                cellType: string;
                rawValue: string;
                numberFormat?: string;
              }[],
              sheet,
              activeCategories,
              activeBrands,
              definitionById,
            );
            prepared.push({ row, ...result });
          }
          const duplicateCounts = new Map<string, number>();
          for (const item of prepared)
            if (item.identityKey)
              duplicateCounts.set(
                item.identityKey,
                (duplicateCounts.get(item.identityKey) ?? 0) + 1,
              );
          const duplicateKeys = new Set(
            [...duplicateCounts]
              .filter(([, count]) => count > 1)
              .map(([key]) => key),
          );
          const dedupeCandidates = prepared.filter(
            (item) =>
              item.identityKey &&
              !duplicateKeys.has(item.identityKey) &&
              item.issues.length === 0,
          );
          const matches = new Map<
            string,
            {
              id: string;
              state: string;
              version: number;
              revisionId: string | null;
            }
          >();
          for (let index = 0; index < dedupeCandidates.length; index += 250) {
            const batch = dedupeCandidates.slice(index, index + 250);
            const payload = batch.map((item) => ({
              rowId: item.row.id,
              brandId: item.candidate.brandId,
              manufacturerName: item.candidate.manufacturerName,
              originalPartNumber: item.candidate.originalPartNumber,
              modification: item.candidate.modification,
            }));
            const found = await tx.$queryRaw<
              {
                rowId: string;
                id: string;
                state: string;
                version: number;
                currentDraftRevisionId: string | null;
                publishedRevisionId: string | null;
                pendingRevisionId: string | null;
                rejectedRevisionId: string | null;
              }[]
            >`
            WITH candidate AS (
              SELECT * FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
                AS c("rowId" uuid,"brandId" uuid,"manufacturerName" text,"originalPartNumber" text,"modification" text)
            )
            SELECT c."rowId"::text AS "rowId",p.id::text AS id,p.publication_state AS state,p.version,
              p.current_draft_revision_id::text AS "currentDraftRevisionId",
              p.published_revision_id::text AS "publishedRevisionId",
              p.pending_revision_id::text AS "pendingRevisionId",
              (SELECT r.id::text FROM catalog_product_revision r WHERE r.product_id=p.id AND r.state='REJECTED'
                ORDER BY r.revision_no DESC,r.id DESC LIMIT 1) AS "rejectedRevisionId"
            FROM candidate c JOIN catalog_product p
              ON p.brand_id=c."brandId"
              AND normalize(btrim(p.manufacturer_name,' '),NFC) COLLATE "C"=normalize(btrim(c."manufacturerName",' '),NFC) COLLATE "C"
              AND normalize(btrim(p.original_part_number,' '),NFC) COLLATE "C"=normalize(btrim(c."originalPartNumber",' '),NFC) COLLATE "C"
              AND ((p.modification IS NULL AND c."modification" IS NULL)
                OR (p.modification IS NOT NULL AND c."modification" IS NOT NULL
                  AND normalize(btrim(p.modification,' '),NFC) COLLATE "C"=normalize(btrim(c."modification",' '),NFC) COLLATE "C"))
          `;
            for (const item of found) {
              matches.set(item.rowId, {
                id: item.id,
                state: item.state,
                version: item.version,
                revisionId:
                  item.currentDraftRevisionId ??
                  item.rejectedRevisionId ??
                  item.publishedRevisionId ??
                  item.pendingRevisionId,
              });
            }
          }

          let invalidCount = 0;
          let warningCount = 0;
          for (let index = 0; index < prepared.length; index += 250) {
            const updates = prepared.slice(index, index + 250).map((item) => {
              let state = item.state;
              let matchedProductId: string | null = null;
              let expectedProductVersion: number | null = null;
              let expectedCurrentRevisionId: string | null = null;
              if (
                state === 'NEW' &&
                item.identityKey &&
                duplicateKeys.has(item.identityKey)
              )
                state = 'DUPLICATE_IN_RUN';
              else if (state === 'NEW' && item.identityKey) {
                const match = matches.get(item.row.id);
                if (match) {
                  state =
                    match.state === 'ARCHIVED'
                      ? 'ARCHIVED_MATCH'
                      : 'EXACT_MATCH';
                  matchedProductId = match.id;
                  expectedProductVersion = match.version;
                  expectedCurrentRevisionId = match.revisionId;
                }
              }
              if (item.issues.length) invalidCount += 1;
              if (item.warnings.length) warningCount += 1;
              return {
                id: item.row.id,
                state,
                candidate: item.candidate,
                issues: item.issues,
                warnings: item.warnings,
                matchedProductId,
                expectedProductVersion,
                expectedCurrentRevisionId,
              };
            });
            await tx.$executeRaw`
              WITH changes AS (
                SELECT * FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS c(
                  id uuid,state text,candidate jsonb,issues jsonb,warnings jsonb,
                  "matchedProductId" uuid,"expectedProductVersion" integer,
                  "expectedCurrentRevisionId" uuid
                )
              )
              UPDATE catalog_import_row r SET
                candidate_state=c.state,
                normalized_candidate=c.candidate,
                validation_issues=c.issues,
                warnings=c.warnings,
                matched_product_id=c."matchedProductId",
                expected_product_version=c."expectedProductVersion",
                expected_current_revision_id=c."expectedCurrentRevisionId",
                version=r.version+1,
                updated_at=transaction_timestamp()
              FROM changes c WHERE r.id=c.id
                AND r.candidate_state NOT IN ('APPLIED','REJECTED')
            `;
          }
          const partial =
            invalidCount > 0 ||
            (lockedRun.sourceParseIssues instanceof Array &&
              lockedRun.sourceParseIssues.length > 0);
          const state = partial ? 'PREVIEW_PARTIAL' : 'PREVIEW_READY';
          const updated = await tx.catalogImportRun.update({
            where: { id: runId },
            data: { state, version: { increment: 1 }, updatedAt: new Date() },
            include: { sourceFileVersion: true },
          });
          await this.createRequiredAudit(tx, {
            actorKind: 'STAFF',
            actorUserId: actor.id,
            action: 'catalog.import.preview.completed',
            entityType: 'CatalogImportRun',
            entityId: runId,
            outcome: 'SUCCESS',
            reasonCode: state,
            requestId: request.requestId,
            changes: {
              state,
              parsedRowCount: prepared.length,
              invalidRowCount: invalidCount,
              warningRowCount: warningCount,
              parserVersion: updated.parserVersion,
            },
          });
          if (crossOwner)
            await this.auditCrossOwner(
              tx,
              actor,
              runId,
              null,
              run.uploaderStaffUserId,
              'MUTATION',
              request.requestId,
            );
          return this.runResponse(updated, request.requestId, tx);
        },
        { isolationLevel: 'ReadCommitted', timeout: 60_000 },
      );
    } catch (error) {
      if (error instanceof CrossOwnerAccessDenied)
        return this.withCrossOwnerDenialAudit(request, actor, async () => {
          throw error;
        });
      await this.writeDenied(
        request,
        actor,
        'catalog.import.preview.completed',
        error,
      );
      throw this.mapError(error);
    }
  }

  private normalizeImportRow(
    cells: {
      columnIndex: number;
      cellType: string;
      rawValue: string;
      numberFormat?: string;
    }[],
    sheet: ImportMappingRequest['sheetMappings'][number],
    activeCategories: Set<string>,
    activeBrands: Set<string>,
    definitions: Map<
      string,
      {
        id: string;
        categoryId: string;
        valueType: string;
        state: string;
        enumOptions: Prisma.JsonValue | null;
      }
    >,
  ) {
    const byColumn = new Map(cells.map((cell) => [cell.columnIndex, cell]));
    const values: Record<string, unknown> = {};
    const attributes: Record<string, unknown>[] = [];
    const issues: { field: string; code: string }[] = [];
    const warnings: { field: string; code: string }[] = [];
    let needsMapping = false;
    const readText = (columnIndex: number, field: string, identity = false) => {
      const cell = byColumn.get(columnIndex);
      if (!cell || cell.cellType === 'BLANK') return '';
      if (cell.cellType === 'FORMULA') {
        issues.push({ field, code: 'FORMULA_NOT_ALLOWED' });
        return '';
      }
      if (field === 'originalPartNumber' && cell.cellType === 'NUMBER') {
        const number = Number(cell.rawValue);
        if (
          !Number.isSafeInteger(number) ||
          !/^0+$/.test(cell.numberFormat ?? '')
        ) {
          issues.push({ field, code: 'NUMERIC_IDENTITY_REJECTED' });
          return '';
        }
        warnings.push({ field, code: 'LEADING_ZEROES_RESTORED' });
        return String(number).padStart(cell.numberFormat!.length, '0');
      }
      if (cell.cellType !== 'TEXT') {
        issues.push({
          field,
          code: identity ? 'IDENTITY_TEXT_REQUIRED' : 'TEXT_REQUIRED',
        });
        return '';
      }
      const value = cell.rawValue.normalize('NFC');
      return identity ? value.replace(/^ +| +$/g, '') : value.trim();
    };
    const mapByTarget = new Map(
      sheet.columnMappings
        .filter((item) => item.target !== 'attribute')
        .map((item) => [item.target, item]),
    );
    for (const target of [
      'displayName',
      'summary',
      'description',
      'manufacturerName',
      'originalPartNumber',
      'modification',
    ] as const) {
      const mapping = mapByTarget.get(target);
      if (!mapping) continue;
      const identity = [
        'manufacturerName',
        'originalPartNumber',
        'modification',
      ].includes(target);
      const value = readText(mapping.columnIndex, target, identity);
      const limits: Record<string, number> = {
        displayName: 240,
        summary: 500,
        description: 12000,
        manufacturerName: 200,
        originalPartNumber: 160,
        modification: 160,
      };
      if (value.length > limits[target]!)
        issues.push({ field: target, code: 'OUT_OF_RANGE' });
      if (value.length) values[target] = value;
    }
    if (!values.displayName) {
      if (!mapByTarget.has('displayName')) needsMapping = true;
      else issues.push({ field: 'displayName', code: 'REQUIRED' });
    }
    const findReference = (target: 'brandId' | 'categoryId') => {
      const fixed =
        target === 'categoryId' ? sheet.fixedCategoryId : sheet.fixedBrandId;
      if (fixed) {
        const active =
          target === 'categoryId'
            ? activeCategories.has(fixed)
            : activeBrands.has(fixed);
        if (!active) needsMapping = true;
        return active ? fixed : null;
      }
      const mapping = mapByTarget.get(target);
      if (!mapping) return null;
      const source = readText(mapping.columnIndex, target, true);
      const mapped = sheet.referenceMappings.find(
        (item) => item.target === target && item.sourceValue === source,
      );
      if (!mapped) {
        if (source) needsMapping = true;
        return null;
      }
      const active =
        target === 'categoryId'
          ? activeCategories.has(mapped.targetId)
          : activeBrands.has(mapped.targetId);
      if (!active) needsMapping = true;
      return active ? mapped.targetId : null;
    };
    const categoryId = findReference('categoryId');
    const brandId = findReference('brandId');
    if (categoryId) values.categoryId = categoryId;
    else if (!sheet.fixedCategoryId && !mapByTarget.has('categoryId'))
      needsMapping = true;
    if (brandId) values.brandId = brandId;
    else if (!sheet.fixedBrandId && mapByTarget.has('brandId'))
      needsMapping = true;

    for (const mapping of sheet.columnMappings.filter(
      (item) => item.target === 'attribute',
    )) {
      const cell = byColumn.get(mapping.columnIndex);
      if (!cell || cell.cellType === 'BLANK' || !cell.rawValue.trim()) continue;
      if (cell.cellType === 'FORMULA') {
        issues.push({
          field: `attribute:${mapping.attributeDefinitionId}`,
          code: 'FORMULA_NOT_ALLOWED',
        });
        continue;
      }
      const definition = definitions.get(mapping.attributeDefinitionId!);
      if (
        !definition ||
        definition.state !== 'ACTIVE' ||
        definition.categoryId !== categoryId ||
        mapping.categoryId !== categoryId
      ) {
        issues.push({
          field: `attribute:${mapping.attributeDefinitionId}`,
          code: 'ATTRIBUTE_NOT_APPLICABLE',
        });
        continue;
      }
      const base = {
        categoryId: definition.categoryId,
        attributeDefinitionId: definition.id,
        valueType: definition.valueType,
      };
      const raw = cell.rawValue.normalize('NFC').trim();
      switch (definition.valueType) {
        case 'TEXT':
          if (cell.cellType !== 'TEXT' || Array.from(raw).length > 240)
            issues.push({
              field: `attribute:${definition.id}`,
              code: 'INVALID_TEXT',
            });
          else attributes.push({ ...base, valueText: raw });
          break;
        case 'DECIMAL': {
          const decimal = raw.replace(',', '.');
          if (
            !/^(?:0|-?[1-9][0-9]*)(?:\.[0-9]*[1-9])?$|^-0\.[0-9]*[1-9]$/.test(
              decimal,
            ) ||
            decimal.length > 64
          )
            issues.push({
              field: `attribute:${definition.id}`,
              code: 'INVALID_DECIMAL',
            });
          else attributes.push({ ...base, valueDecimal: decimal });
          break;
        }
        case 'INTEGER': {
          const integer = Number(raw);
          if (
            !/^-?(0|[1-9][0-9]*)$/.test(raw) ||
            !Number.isSafeInteger(integer)
          )
            issues.push({
              field: `attribute:${definition.id}`,
              code: 'INVALID_INTEGER',
            });
          else attributes.push({ ...base, valueInteger: integer });
          break;
        }
        case 'BOOLEAN':
          if (raw !== 'true' && raw !== 'false')
            issues.push({
              field: `attribute:${definition.id}`,
              code: 'INVALID_BOOLEAN',
            });
          else attributes.push({ ...base, valueBoolean: raw === 'true' });
          break;
        case 'ENUM': {
          const options = Array.isArray(definition.enumOptions)
            ? (definition.enumOptions as { code?: unknown }[])
            : [];
          if (!options.some((option) => option.code === raw))
            issues.push({
              field: `attribute:${definition.id}`,
              code: 'INVALID_ENUM',
            });
          else attributes.push({ ...base, valueEnumCode: raw });
          break;
        }
      }
    }
    if (categoryId && attributes.length) values.attributes = attributes;
    if (issues.length)
      return {
        state: 'INVALID',
        candidate: values,
        issues,
        warnings,
        identityKey: null,
      };
    if (needsMapping)
      return {
        state: 'NEEDS_MAPPING',
        candidate: values,
        issues,
        warnings,
        identityKey: null,
      };
    if (!categoryId)
      return {
        state: 'NEEDS_MAPPING',
        candidate: values,
        issues,
        warnings,
        identityKey: null,
      };
    const manufacturer = values.manufacturerName as string | undefined;
    const partNumber = values.originalPartNumber as string | undefined;
    if (!brandId || !manufacturer || !partNumber)
      return {
        state: 'NO_DEDUP_KEY',
        candidate: values,
        issues,
        warnings,
        identityKey: null,
      };
    const tuple = {
      brandId,
      manufacturerName: manufacturer.normalize('NFC').replace(/^ +| +$/g, ''),
      originalPartNumber: partNumber.normalize('NFC').replace(/^ +| +$/g, ''),
      modification:
        (values.modification as string | undefined)
          ?.normalize('NFC')
          .replace(/^ +| +$/g, '') ?? null,
    };
    const identityKey = canonical(tuple);
    values.manufacturerName = tuple.manufacturerName;
    values.originalPartNumber = tuple.originalPartNumber;
    values.modification = tuple.modification;
    return { state: 'NEW', candidate: values, issues, warnings, identityKey };
  }

  private async runResponse(
    run: ImportRun,
    requestId: string,
    tx: Tx | PrismaDatabase = this.db,
  ) {
    const counts = await tx.catalogImportRow.groupBy({
      by: ['candidateState'],
      where: { importRunId: run.id },
      _count: { _all: true },
    });
    const count = (state: string) =>
      counts.find((item) => item.candidateState === state)?._count._all ?? 0;
    const total = counts.reduce((sum, item) => sum + item._count._all, 0);
    const sourceInvalidRows = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM catalog_import_row
      WHERE import_run_id=${run.id}::uuid AND source_cells='[]'::jsonb
        AND validation_issues @> '[{"field":"source"}]'::jsonb
    `;
    return {
      data: {
        id: run.id,
        state: run.state,
        sourceFormat: run.sourceFormat,
        sourceEncoding: run.sourceEncoding,
        sourceDelimiter: run.sourceDelimiter,
        sourceSha256: Buffer.from(run.sourceFileVersion.sha256).toString('hex'),
        originalFilename: run.sourceFileVersion.originalFilename,
        parserVersion: run.parserVersion,
        uploadedAt: run.createdAt.toISOString(),
        version: run.version,
        mappingVersion: run.mappingVersion,
        rowCounts: {
          total,
          sourceInvalid: sourceInvalidRows[0]?.count ?? 0,
          header: count('HEADER'),
          ignored: count('IGNORED'),
          invalid: count('INVALID'),
          ready: count('NEW') + count('EXACT_MATCH') + count('NO_DEDUP_KEY'),
          applied: count('APPLIED'),
          held: count('HELD'),
          rejected: count('REJECTED'),
        },
        sourceParseIssues: run.sourceParseIssues,
      },
      meta: { requestId },
    };
  }

  private actor(request: StaffRequest) {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    return request.staff;
  }

  private async requirePermissions(
    tx: Tx,
    actor: StaffPrincipal,
    permissions: string[],
  ) {
    await assertCurrentActor(tx, actor, permissions[0] ?? null);
    for (const permission of permissions.slice(1))
      await assertHasPermission(tx, actor.id, permission);
  }

  private async requireCrossOwner(
    tx: Tx,
    actor: StaffPrincipal,
    mutation: boolean,
    scope: {
      runId: string | null;
      rowId: string | null;
      ownerStaffUserId: string;
    },
  ) {
    await assertCurrentActor(tx, actor, 'catalog.products.read');
    const effective = await effectivePermissions(tx, actor.id);
    const required = [...CONTROL_ADMIN_PERMISSIONS, 'catalog.products.read'];
    if (required.some((permission) => !effective.includes(permission)))
      throw new CrossOwnerAccessDenied(
        scope.runId,
        scope.rowId,
        scope.ownerStaffUserId,
        mutation ? 'MUTATION' : 'READ',
      );
    if (mutation) {
      for (const permission of [
        'catalog.products.write',
        'catalog.references.read',
      ]) {
        if (!effective.includes(permission))
          throw new CrossOwnerAccessDenied(
            scope.runId,
            scope.rowId,
            scope.ownerStaffUserId,
            'MUTATION',
          );
      }
    }
  }

  private async withCrossOwnerDenialAudit<T>(
    request: StaffRequest,
    actor: StaffPrincipal,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof CrossOwnerAccessDenied)) throw error;
      await this.audit.writeDenied({
        actorKind: 'STAFF',
        actorUserId: actor.id,
        action: 'catalog.import.cross_owner.accessed',
        entityType: error.rowId ? 'CatalogImportRow' : 'CatalogImportRun',
        entityId: error.rowId ?? error.runId,
        outcome: 'DENIED',
        reasonCode: 'NOT_FOUND',
        requestId: request.requestId,
        changes: {
          runId: error.runId,
          rowId: error.rowId,
          ownerStaffUserId: error.ownerStaffUserId,
          accessKind: error.accessKind,
        },
      });
      throw new StaffError('NOT_FOUND');
    }
  }

  private async auditCrossOwner(
    tx: Tx,
    actor: StaffPrincipal,
    runId: string,
    rowId: string | null,
    ownerId: string,
    accessKind: 'READ' | 'MUTATION',
    requestId: string,
  ) {
    await this.createRequiredAudit(tx, {
      actorKind: 'STAFF',
      actorUserId: actor.id,
      action: 'catalog.import.cross_owner.accessed',
      entityType: rowId ? 'CatalogImportRow' : 'CatalogImportRun',
      entityId: rowId ?? runId,
      outcome: 'SUCCESS',
      reasonCode: accessKind,
      requestId,
      changes: { runId, rowId, ownerStaffUserId: ownerId, accessKind },
    });
  }

  private async createRequiredAudit(tx: Tx, input: AuditInput) {
    try {
      await createAuditEvent(tx, input);
    } catch {
      throw new StaffError('AUDIT_UNAVAILABLE');
    }
  }

  private async writeDenied(
    request: StaffRequest,
    actor: StaffPrincipal,
    action: string,
    error: unknown,
  ) {
    const code = error instanceof StaffError ? error.code : 'INTERNAL_ERROR';
    const actionReasons: Record<string, Set<string>> = {
      'catalog.import.created': new Set([
        'AUTH_REQUIRED',
        'FORBIDDEN',
        'ORIGIN_FORBIDDEN',
        'CSRF_INVALID',
        'VALIDATION_ERROR',
        'FILE_REJECTED',
        'FILE_TOO_LARGE',
        'UNSUPPORTED_MEDIA_TYPE',
        'IDEMPOTENCY_KEY_REUSED',
      ]),
      'catalog.import.mapping.changed': new Set([
        'AUTH_REQUIRED',
        'FORBIDDEN',
        'ORIGIN_FORBIDDEN',
        'CSRF_INVALID',
        'VALIDATION_ERROR',
        'NOT_FOUND',
        'VERSION_CONFLICT',
        'INVALID_STATE_TRANSITION',
      ]),
      'catalog.import.preview.completed': new Set([
        'AUTH_REQUIRED',
        'FORBIDDEN',
        'ORIGIN_FORBIDDEN',
        'CSRF_INVALID',
        'VALIDATION_ERROR',
        'NOT_FOUND',
        'INVALID_STATE_TRANSITION',
        'IMPORT_LIMIT_EXCEEDED',
        'ENCODING_REQUIRED',
        'INVALID_ENCODING',
        'FILE_REJECTED',
      ]),
      'catalog.import.row.decided': new Set([
        'AUTH_REQUIRED',
        'FORBIDDEN',
        'ORIGIN_FORBIDDEN',
        'CSRF_INVALID',
        'VALIDATION_ERROR',
        'NOT_FOUND',
        'VERSION_CONFLICT',
        'IMPORT_ROW_CONFLICT',
        'IDENTITY_CONFLICT',
        'INVALID_STATE_TRANSITION',
        'IDEMPOTENCY_KEY_REUSED',
      ]),
    };
    const failures = new Set([
      'DEPENDENCY_UNAVAILABLE',
      'INGESTION_UNAVAILABLE',
      'AUDIT_UNAVAILABLE',
      'INTERNAL_ERROR',
    ]);
    let reason = code;
    let outcome: 'DENIED' | 'FAILURE' = 'DENIED';
    if (failures.has(code)) {
      outcome = 'FAILURE';
      reason =
        code === 'INGESTION_UNAVAILABLE' ? 'DEPENDENCY_UNAVAILABLE' : code;
    } else if (!actionReasons[action]?.has(code)) {
      reason = 'VALIDATION_ERROR';
    }
    await this.audit.writeDenied({
      actorKind: 'STAFF',
      actorUserId: actor.id,
      action,
      outcome,
      reasonCode: reason,
      requestId: request.requestId,
    });
  }

  private mapError(error: unknown): unknown {
    if (error instanceof StaffError) return error;
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('catalog_product_identity_exact_key'))
      return new StaffError('IDENTITY_CONFLICT');
    if (text.includes('catalog_product_slug_key'))
      return new StaffError('SLUG_CONFLICT');
    if (text.includes('IMPORT_MAPPING_LOCKED'))
      return new StaffError('INVALID_STATE_TRANSITION');
    if (
      text.includes('P2002') ||
      text.includes('P2034') ||
      text.includes('P2025')
    )
      return new StaffError('VERSION_CONFLICT');
    if (text.includes('P2003')) return new StaffError('REFERENCE_IN_USE');
    return new StaffError('DEPENDENCY_UNAVAILABLE');
  }
}
