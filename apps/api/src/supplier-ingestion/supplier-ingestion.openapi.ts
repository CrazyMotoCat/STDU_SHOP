import type { SchemaObject } from '@nestjs/swagger';

const text: SchemaObject = { type: 'string' };
const integer: SchemaObject = { type: 'integer' };
const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const timestamp: SchemaObject = { type: 'string', format: 'date-time' };
const hash: SchemaObject = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const nullable = (schema: SchemaObject): SchemaObject => ({
  ...schema,
  nullable: true,
});
const enumeration = (...values: string[]): SchemaObject => ({
  type: 'string',
  enum: values,
});
const array = (items: SchemaObject): SchemaObject => ({ type: 'array', items });
const object = (properties: Record<string, SchemaObject>): SchemaObject => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

const source = object({
  id: uuid,
  supplierId: uuid,
  actorId: uuid,
  adapterVersion: enumeration('fixture-json/1'),
  fixtureKey: enumeration('offers-v1', 'mixed-v1'),
  state: enumeration('ENABLED', 'DISABLED'),
  maxRows: integer,
  maxAttempts: integer,
  timeoutMs: integer,
  version: integer,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const run = object({
  id: uuid,
  sourceId: uuid,
  sourceVersion: integer,
  sourceSnapshot: source,
  actorId: uuid,
  requestId: uuid,
  state: enumeration(
    'QUEUED',
    'RUNNING',
    'RETRY_WAIT',
    'COMPLETE',
    'PARTIAL',
    'FAILED',
  ),
  processed: integer,
  candidateCount: integer,
  errorCount: integer,
  attempts: integer,
  nextAttemptAt: timestamp,
  sourceHash: nullable(hash),
  diagnosticCode: nullable(text),
  version: integer,
  createdAt: timestamp,
  startedAt: nullable(timestamp),
  finishedAt: nullable(timestamp),
});
const row = object({
  id: hash,
  runId: uuid,
  rowNumber: integer,
  sourceHash: hash,
  normalized: nullable({
    type: 'object',
    additionalProperties: nullable(text),
  }),
  warnings: array(text),
  modificationEvidence: nullable(enumeration('SPECIFIED', 'UNKNOWN')),
  errorCode: nullable(enumeration('ROW_INVALID')),
  reviewState: enumeration('PENDING', 'ACCEPTED', 'REJECTED', 'NOT_APPLICABLE'),
  version: integer,
  createdAt: timestamp,
});
const decision = object({
  id: uuid,
  rowId: hash,
  actorId: uuid,
  decision: enumeration('ACCEPT', 'REJECT'),
  reason: text,
  createdAt: timestamp,
});
export const ingestionResponses: Record<string, SchemaObject> = {
  listSources: object({ data: array(source), nextCursor: nullable(uuid) }),
  getSource: object({ data: source }),
  createSource: object({ data: source }),
  updateSource: object({ data: source }),
  requestRun: object({ data: run }),
  listRuns: object({ data: array(run), nextCursor: nullable(uuid) }),
  getRun: object({ data: run }),
  rows: object({ data: array(row), nextAfter: nullable(integer) }),
  decide: object({ data: decision }),
  decisions: object({ data: array(decision) }),
};
export const ingestionErrorSchema: SchemaObject = {
  type: 'object',
  required: ['code', 'message', 'requestId'],
  properties: {
    code: text,
    message: text,
    requestId: uuid,
    fields: array(object({ field: text, code: text })),
  },
};

const application = object({
  id: uuid,
  sourceId: uuid,
  runId: uuid,
  rowId: hash,
  decisionId: uuid,
  actorId: uuid,
  offerId: uuid,
  baseRevisionId: uuid,
  revisionId: uuid,
  sourceHash: hash,
  version: integer,
  createdAt: timestamp,
});
export const ingestionApplyResponses = {
  apply: object({ data: application }),
  applications: object({ data: array(application) }),
  preview: object({
    data: object({
      row,
      offer: object({
        id: uuid,
        supplierId: uuid,
        supplierName: text,
        catalogProductId: nullable(uuid),
        state: enumeration('ACTIVE', 'ARCHIVED'),
        version: integer,
        currentMatchProposalId: nullable(uuid),
        freshness: enumeration('CURRENT', 'STALE', 'UNKNOWN'),
        matchStatus: enumeration('UNMATCHED', 'CURRENT', 'REVIEW_REQUIRED'),
        currentRevision: object({
          id: uuid,
          revisionNo: integer,
          supplierPartNumber: nullable(text),
          offerName: nullable(text),
          sourceBrandText: nullable(text),
          brandId: nullable(uuid),
          manufacturerName: nullable(text),
          originalPartNumber: nullable(text),
          modification: nullable(text),
          modificationEvidence: enumeration(
            'SPECIFIED',
            'CONFIRMED_NONE',
            'UNKNOWN',
          ),
          purchaseCost: nullable(text),
          currency: nullable(text),
          sourceVatText: nullable(text),
          availabilityText: nullable(text),
          leadTimeText: nullable(text),
          sourceObservedAt: nullable(timestamp),
          expiresAt: nullable(timestamp),
          sourceUrl: nullable(text),
          origin: enumeration('MANUAL'),
          recordedAt: timestamp,
          recordedByStaffUserId: uuid,
        }),
      }),
      fields: array(
        object({
          field: text,
          current: nullable(text),
          proposed: nullable(text),
          state: enumeration('NEW', 'CHANGED', 'UNCHANGED', 'MISSING'),
        }),
      ),
      eligible: { type: 'boolean' },
      blockedReason: nullable(text),
      application: nullable(application),
      original: nullable({ type: 'object', additionalProperties: true }),
      conflicts: array(
        object({
          id: uuid,
          actorUserId: nullable(uuid),
          reasonCode: nullable(text),
          createdAt: timestamp,
        }),
      ),
    }),
  }),
};
