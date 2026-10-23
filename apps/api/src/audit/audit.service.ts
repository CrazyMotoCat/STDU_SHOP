import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { DATABASE, PrismaDatabase } from '../database/database.module.js';
import { StaffError } from '../identity/errors.js';

export interface AuditInput {
  actorKind: 'STAFF' | 'ANONYMOUS' | 'OPERATOR';
  actorUserId?: string | null;
  operatorLabel?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
  reasonCode: string | null;
  requestId: string;
  sourceHash?: Buffer | null;
  changes?: Record<string, unknown>;
}

export async function createAuditEvent(
  tx: Prisma.TransactionClient,
  input: AuditInput,
) {
  await tx.auditEvent.create({
    data: {
      id: randomUUID(),
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      operatorLabel: input.operatorLabel ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      requestId: input.requestId,
      sourceHash: input.sourceHash ? new Uint8Array(input.sourceHash) : null,
      changes: (input.changes ?? {}) as Prisma.InputJsonObject,
    },
  });
}

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: PrismaDatabase) {}

  async writeDenied(input: AuditInput) {
    try {
      await this.db.$transaction((tx) => createAuditEvent(tx, input));
    } catch {
      throw new StaffError('AUDIT_UNAVAILABLE');
    }
  }
}
