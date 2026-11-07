import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { DATABASE, PrismaDatabase } from '../database/database.module.js';
import { createAuditEvent } from '../audit/audit.service.js';
import { assertCurrentActor } from '../permissions/policy.js';
import { StaffError } from '../identity/errors.js';
import type { StaffRequest } from '../identity/request.js';
import type {
  IngestionSourceInput,
  IngestionSourcePatch,
  IngestionRunInput,
  IngestionDecisionInput,
  IngestionPage,
  IngestionRowsPage,
} from './supplier-ingestion.dto.js';

export type IngestionTx = Prisma.TransactionClient;
export const terminalStates = ['COMPLETE', 'PARTIAL', 'FAILED'];
export function jsonObject(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ':' +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export async function ingestionAudit(
  tx: IngestionTx,
  action: string,
  entityId: string | null,
  reasonCode: string,
  changes: Record<string, unknown> = {},
  request?: StaffRequest,
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE' = 'SUCCESS',
) {
  const entityType = entityId
    ? action.startsWith('ingestion.source.')
      ? 'IngestionSource'
      : action === 'ingestion.row.decided'
        ? 'IngestionDecision'
        : 'IngestionRun'
    : null;
  await createAuditEvent(tx, {
    actorKind: request ? (request.staff ? 'STAFF' : 'ANONYMOUS') : 'OPERATOR',
    actorUserId: request?.staff?.id,
    operatorLabel: request ? null : 'supplier-ingestion-worker',
    action,
    entityType,
    entityId,
    reasonCode,
    changes,
    requestId: request?.requestId ?? randomUUID(),
    outcome,
  });
}

@Injectable()
export class SupplierIngestionService {
  constructor(@Inject(DATABASE) readonly db: PrismaDatabase) {}

  private principal(request: StaffRequest, permission: string) {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    if (!request.staff.permissionCodes.includes(permission))
      throw new StaffError('FORBIDDEN');
    return request.staff;
  }

  private async command(
    request: StaffRequest,
    key: string | undefined,
    operation: string,
    permission: string,
    resource: string,
    input: unknown,
    work: (tx: IngestionTx) => Promise<{ status: number; data: unknown }>,
  ) {
    const actor = this.principal(request, permission);
    if (!key || !/^[\x21-\x7e]{8,128}$/.test(key))
      throw new StaffError('VALIDATION_ERROR');
    const hash = createHash('sha256')
      .update(canonical({ actorId: actor.id, operation, resource, input }))
      .digest('hex');
    const lock = createHash('sha256')
      .update(actor.id + '\0R1-008B\0' + key)
      .digest()
      .readBigInt64BE();
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock})::text`;
        await assertCurrentActor(tx, actor, permission);
        const prior = await tx.ingestionCommand.findUnique({
          where: { actorId_key: { actorId: actor.id, key } },
        });
        if (prior) {
          if (prior.requestHash !== hash)
            throw new StaffError('IDEMPOTENCY_KEY_REUSED');
          return { status: prior.responseStatus, body: prior.responseBody };
        }
        let receipt: { status: number; body: Prisma.InputJsonObject };
        // Domain errors are checked before mutations; save deterministic 409 receipts.
        try {
          const result = await work(tx);
          receipt = {
            status: result.status,
            body: jsonObject({ data: result.data }),
          };
        } catch (error) {
          if (!(error instanceof StaffError) || error.getStatus() !== 409)
            throw error;
          await ingestionAudit(
            tx,
            'ingestion.command.denied',
            null,
            error.code,
            {},
            request,
            'DENIED',
          );
          receipt = {
            status: 409,
            body: {
              code: error.code,
              message: error.message,
              requestId: request.requestId,
            },
          };
        }
        await tx.ingestionCommand.create({
          data: {
            id: randomUUID(),
            actorId: actor.id,
            key,
            requestHash: hash,
            responseStatus: receipt.status,
            responseBody: receipt.body,
          },
        });
        return receipt;
      },
      { maxWait: 5000, timeout: 15000 },
    );
  }

  async listSources(request: StaffRequest, page: IngestionPage) {
    this.principal(request, 'ingestion.read');
    return this.db.$transaction(async (tx) => {
      await assertCurrentActor(tx, request.staff!, 'ingestion.read');
      const limit = page.limit ?? 50;
      const rows = await tx.ingestionSource.findMany({
        where: page.cursor ? { id: { gt: page.cursor } } : {},
        orderBy: { id: 'asc' },
        take: limit + 1,
      });
      return {
        data: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      };
    });
  }
  async getSource(request: StaffRequest, id: string) {
    this.principal(request, 'ingestion.read');
    return this.db.$transaction(async (tx) => {
      await assertCurrentActor(tx, request.staff!, 'ingestion.read');
      const row = await tx.ingestionSource.findUnique({ where: { id } });
      if (!row) throw new StaffError('NOT_FOUND');
      return { data: row };
    });
  }
  async createSource(
    request: StaffRequest,
    key: string | undefined,
    input: IngestionSourceInput,
  ) {
    return this.command(
      request,
      key,
      'createSource',
      'ingestion.sources.write',
      'sources',
      input,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM supplier WHERE id=${input.supplierId}::uuid FOR SHARE`;
        const supplier = await tx.supplier.findUnique({
          where: { id: input.supplierId },
        });
        if (!supplier || supplier.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const source = await tx.ingestionSource.create({
          data: {
            id: randomUUID(),
            ...input,
            state: 'ENABLED',
            actorId: request.staff!.id,
          },
        });
        await tx.ingestionSourceRevision.create({
          data: {
            id: randomUUID(),
            sourceId: source.id,
            version: 1,
            actorId: request.staff!.id,
            snapshot: jsonObject(source),
          },
        });
        await ingestionAudit(
          tx,
          'ingestion.source.created',
          source.id,
          'CREATED',
          { sourceId: source.id, version: 1 },
          request,
        );
        return { status: 201, data: source };
      },
    );
  }
  async updateSource(
    request: StaffRequest,
    key: string | undefined,
    id: string,
    input: IngestionSourcePatch,
  ) {
    return this.command(
      request,
      key,
      'updateSource',
      'ingestion.sources.write',
      id,
      input,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM ingestion_source WHERE id=${id}::uuid FOR UPDATE`;
        const source = await tx.ingestionSource.findUnique({ where: { id } });
        if (!source) throw new StaffError('NOT_FOUND');
        if (source.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        const updated = await tx.ingestionSource.update({
          where: { id },
          data: {
            state: input.state,
            maxRows: input.maxRows,
            maxAttempts: input.maxAttempts,
            timeoutMs: input.timeoutMs,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        await tx.ingestionSourceRevision.create({
          data: {
            id: randomUUID(),
            sourceId: id,
            version: updated.version,
            actorId: request.staff!.id,
            snapshot: jsonObject(updated),
          },
        });
        await ingestionAudit(
          tx,
          'ingestion.source.changed',
          id,
          'CHANGED',
          { sourceId: id, version: updated.version },
          request,
        );
        return { status: 200, data: updated };
      },
    );
  }
  async requestRun(
    request: StaffRequest,
    key: string | undefined,
    input: IngestionRunInput,
  ) {
    return this.command(
      request,
      key,
      'requestRun',
      'ingestion.run',
      input.sourceId,
      input,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM ingestion_source WHERE id=${input.sourceId}::uuid FOR SHARE`;
        const source = await tx.ingestionSource.findUnique({
          where: { id: input.sourceId },
        });
        if (!source) throw new StaffError('NOT_FOUND');
        if (source.version !== input.expectedSourceVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (source.state !== 'ENABLED')
          throw new StaffError('INVALID_STATE_TRANSITION');
        await tx.$queryRaw`SELECT id FROM supplier WHERE id=${source.supplierId}::uuid FOR SHARE`;
        const supplier = await tx.supplier.findUnique({
          where: { id: source.supplierId },
        });
        if (supplier?.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const revision = await tx.ingestionSourceRevision.findUniqueOrThrow({
          where: {
            sourceId_version: { sourceId: source.id, version: source.version },
          },
        });
        const run = await tx.ingestionRun.create({
          omit: { rawSnapshot: true, leaseToken: true, leaseUntil: true },
          data: {
            id: randomUUID(),
            sourceId: source.id,
            sourceVersion: source.version,
            sourceSnapshot: jsonObject(revision.snapshot),
            actorId: request.staff!.id,
            requestId: request.requestId,
            state: 'QUEUED',
          },
        });
        await tx.ingestionOutbox.create({
          data: { id: randomUUID(), runId: run.id },
        });
        await ingestionAudit(
          tx,
          'ingestion.run.requested',
          run.id,
          'REQUESTED',
          { runId: run.id, sourceId: source.id },
          request,
        );
        return { status: 201, data: run };
      },
    );
  }
  async listRuns(request: StaffRequest, page: IngestionPage) {
    this.principal(request, 'ingestion.read');
    return this.db.$transaction(async (tx) => {
      await assertCurrentActor(tx, request.staff!, 'ingestion.read');
      const limit = page.limit ?? 50;
      const rows = await tx.ingestionRun.findMany({
        omit: { rawSnapshot: true, leaseToken: true, leaseUntil: true },
        where: page.cursor ? { id: { gt: page.cursor } } : {},
        orderBy: { id: 'asc' },
        take: limit + 1,
      });
      return {
        data: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      };
    });
  }
  async getRun(request: StaffRequest, id: string) {
    this.principal(request, 'ingestion.read');
    return this.db.$transaction(async (tx) => {
      await assertCurrentActor(tx, request.staff!, 'ingestion.read');
      const run = await tx.ingestionRun.findUnique({
        where: { id },
        omit: { rawSnapshot: true, leaseToken: true, leaseUntil: true },
      });
      if (!run) throw new StaffError('NOT_FOUND');
      return { data: run };
    });
  }
  async rows(request: StaffRequest, id: string, page: IngestionRowsPage) {
    this.principal(request, 'ingestion.read');
    return this.db.$transaction(async (tx) => {
      await assertCurrentActor(tx, request.staff!, 'ingestion.read');
      if (
        !(await tx.ingestionRun.findUnique({
          where: { id },
          select: { id: true },
        }))
      )
        throw new StaffError('NOT_FOUND');
      const limit = page.limit ?? 50;
      const rows = await tx.ingestionRow.findMany({
        where: { runId: id, rowNumber: { gt: page.afterRow ?? 0 } },
        orderBy: { rowNumber: 'asc' },
        take: limit + 1,
      });
      return {
        data: rows.slice(0, limit),
        nextAfter: rows.length > limit ? rows[limit - 1]!.rowNumber : null,
      };
    });
  }
  async decide(
    request: StaffRequest,
    key: string | undefined,
    id: string,
    input: IngestionDecisionInput,
  ) {
    if (
      Array.from(input.reason).some(
        (c) => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127,
      )
    )
      throw new StaffError('VALIDATION_ERROR');
    return this.command(
      request,
      key,
      'decide',
      'ingestion.review',
      id,
      input,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM ingestion_row WHERE id=${id} FOR UPDATE`;
        const row = await tx.ingestionRow.findUnique({ where: { id } });
        if (!row) throw new StaffError('NOT_FOUND');
        if (row.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (row.reviewState !== 'PENDING')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const decision = await tx.ingestionDecision.create({
          data: {
            id: randomUUID(),
            rowId: id,
            actorId: request.staff!.id,
            decision: input.decision,
            reason: input.reason,
          },
        });
        await tx.ingestionRow.update({
          where: { id },
          data: {
            reviewState: input.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
            version: { increment: 1 },
          },
        });
        await ingestionAudit(
          tx,
          'ingestion.row.decided',
          decision.id,
          input.decision,
          { runId: row.runId, rowId: id, version: row.version + 1 },
          request,
        );
        return { status: 200, data: decision };
      },
    );
  }
  async decisions(request: StaffRequest, id: string) {
    this.principal(request, 'ingestion.read');
    return this.db.$transaction(async (tx) => {
      await assertCurrentActor(tx, request.staff!, 'ingestion.read');
      if (!(await tx.ingestionRow.findUnique({ where: { id } })))
        throw new StaffError('NOT_FOUND');
      return {
        data: await tx.ingestionDecision.findMany({
          where: { rowId: id },
          orderBy: { createdAt: 'asc' },
        }),
      };
    });
  }
}
