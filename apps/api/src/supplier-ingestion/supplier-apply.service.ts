import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  IngestionRow,
  SupplierOfferRevision,
} from '../generated/prisma/client.js';
import { StaffError } from '../identity/errors.js';
import type { StaffRequest } from '../identity/request.js';
import {
  assertCurrentActor,
  assertHasPermission,
} from '../permissions/policy.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import {
  ModificationEvidence,
  type ReviseSupplierOfferDto,
} from '../suppliers/suppliers.dto.js';
import type { IngestionApplyInput } from './supplier-ingestion.dto.js';
import {
  SupplierIngestionService,
  type IngestionTx,
} from './supplier-ingestion.service.js';

const readPermissions = ['suppliers.read', 'suppliers.offers.read'];
const applyPermissions = [
  ...readPermissions,
  'suppliers.offers.write',
  'ingestion.review',
];
const economicFields = [
  ['purchase_cost', 'purchaseCost'],
  ['currency', 'currency'],
  ['source_vat_text', 'sourceVatText'],
  ['availability_text', 'availabilityText'],
  ['lead_time_text', 'leadTimeText'],
  ['source_observed_at', 'sourceObservedAt'],
  ['source_url', 'sourceUrl'],
] as const;
const identityFields = [
  ['supplier_part_number', 'supplierPartNumber'],
  ['source_brand_text', 'sourceBrandText'],
  ['manufacturer_name', 'manufacturerName'],
  ['original_part_number', 'originalPartNumber'],
  ['modification', 'modification'],
] as const;

function facts(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
function comparison(row: IngestionRow, current: SupplierOfferRevision) {
  const normalized = facts(row.normalized);
  return [...identityFields, ...economicFields].map(([sourceField, field]) => {
    const before = text(current[field]);
    const proposed =
      field === 'currency' && normalized.purchase_cost == null
        ? null
        : text(normalized[sourceField]);
    return {
      field,
      current: before,
      proposed,
      state:
        proposed === null
          ? 'MISSING'
          : before === null
            ? 'NEW'
            : before === proposed
              ? 'UNCHANGED'
              : 'CHANGED',
    };
  });
}
function identityMatches(row: IngestionRow, current: SupplierOfferRevision) {
  const normalized = facts(row.normalized);
  if (
    row.modificationEvidence !== 'SPECIFIED' ||
    current.modificationEvidence !== 'SPECIFIED'
  )
    return false;
  return identityFields.every(
    ([sourceField, field]) =>
      typeof normalized[sourceField] === 'string' &&
      normalized[sourceField] !== '' &&
      normalized[sourceField] === current[field],
  );
}

@Injectable()
export class SupplierApplyService {
  constructor(
    @Inject(SupplierIngestionService)
    private readonly ingestion: SupplierIngestionService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
  ) {}

  private async authorize(tx: IngestionTx, request: StaffRequest) {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    await assertCurrentActor(tx, request.staff, 'ingestion.read');
    for (const permission of readPermissions)
      await assertHasPermission(tx, request.staff.id, permission);
  }

  private async context(tx: IngestionTx, rowId: string, offerId: string) {
    const row = await tx.ingestionRow.findUnique({
      where: { id: rowId },
      include: {
        run: { include: { source: { include: { supplier: true } } } },
        decisions: true,
        application: true,
      },
    });
    const offer = await tx.supplierOffer.findUnique({
      where: { id: offerId },
      include: {
        currentRevision: true,
        supplier: true,
      },
    });
    if (!row || !offer) throw new StaffError('NOT_FOUND');
    const { run, decisions, application, ...staged } = row;
    let blockedReason: string | null = null;
    if (
      row.errorCode ||
      !row.normalized ||
      !['COMPLETE', 'PARTIAL'].includes(run.state)
    )
      blockedReason = 'INVALID_CANDIDATE';
    else if (application) blockedReason = 'ALREADY_APPLIED';
    else if (run.source.state !== 'ENABLED') blockedReason = 'SOURCE_DISABLED';
    else if (run.source.version !== run.sourceVersion)
      blockedReason = 'SOURCE_CHANGED';
    else if (run.source.supplierId !== offer.supplierId)
      blockedReason = 'SUPPLIER_MISMATCH';
    else if (offer.supplier.state !== 'ACTIVE')
      blockedReason = 'SUPPLIER_INACTIVE';
    else if (offer.state !== 'ACTIVE') blockedReason = 'OFFER_INACTIVE';
    else if (!identityMatches(row, offer.currentRevision))
      blockedReason = 'IDENTITY_MISMATCH';
    const normalized = facts(row.normalized);
    if (
      !blockedReason &&
      normalized.purchase_cost != null &&
      offer.currentRevision.currency !== null &&
      normalized.currency !== offer.currentRevision.currency
    )
      blockedReason = 'CURRENCY_MISMATCH';
    const fields = comparison(row, offer.currentRevision);
    if (
      !blockedReason &&
      !fields.some(
        (field) =>
          economicFields.some(([, name]) => name === field.field) &&
          ['NEW', 'CHANGED'].includes(field.state),
      )
    )
      blockedReason = 'NO_CHANGED_FIELDS';
    if (
      !blockedReason &&
      (row.reviewState !== 'ACCEPTED' || decisions[0]?.decision !== 'ACCEPT')
    )
      blockedReason = 'NOT_ACCEPTED';
    return {
      row: staged,
      run,
      offer,
      decisions,
      application,
      fields,
      blockedReason,
    };
  }

  async preview(request: StaffRequest, rowId: string, offerId: string) {
    return this.ingestion.db.$transaction(
      async (tx) => {
        await this.authorize(tx, request);
        const context = await this.context(tx, rowId, offerId);
        let original: Record<string, unknown> | null = null;
        // A single bounded source row is sufficient for review. Never return the snapshot.
        const snapshot = context.run.rawSnapshot;
        if (snapshot) {
          const parsed: unknown = JSON.parse(
            Buffer.from(snapshot).toString('utf8'),
          );
          if (Array.isArray(parsed))
            original = facts(parsed[context.row.rowNumber - 1]);
        }
        const conflicts = await tx.auditEvent.findMany({
          where: {
            action: 'ingestion.command.denied',
            changes: { path: ['rowId'], equals: rowId },
          },
          select: {
            id: true,
            actorUserId: true,
            reasonCode: true,
            occurredAt: true,
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 20,
        });
        return {
          data: {
            row: context.row,
            offer: (
              await this.suppliers.getSupplierOfferInTransaction(
                tx,
                request,
                offerId,
              )
            ).data,
            fields: context.fields,
            eligible: context.blockedReason === null,
            blockedReason: context.blockedReason,
            application: context.application,
            original,
            conflicts: conflicts.map(({ occurredAt, ...entry }) => ({
              ...entry,
              createdAt: occurredAt,
            })),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async applications(request: StaffRequest, rowId: string) {
    return this.ingestion.db.$transaction(async (tx) => {
      await this.authorize(tx, request);
      if (
        !(await tx.ingestionRow.findUnique({
          where: { id: rowId },
          select: { id: true },
        }))
      )
        throw new StaffError('NOT_FOUND');
      return {
        data: await tx.ingestionApplication.findMany({
          where: { rowId },
          take: 1,
        }),
      };
    });
  }

  async apply(
    request: StaffRequest,
    key: string | undefined,
    rowId: string,
    input: IngestionApplyInput,
  ) {
    return this.ingestion.command(
      request,
      key,
      'apply',
      'ingestion.read',
      rowId,
      input,
      async (tx) => {
        // Source lock prevents disabling or replacing the source during manual APPLY.
        const rowRef = await tx.ingestionRow.findUnique({
          where: { id: rowId },
          select: { run: { select: { sourceId: true } } },
        });
        if (!rowRef) throw new StaffError('NOT_FOUND');
        await tx.$queryRaw`SELECT id FROM ingestion_source WHERE id=${rowRef.run.sourceId}::uuid FOR SHARE`;
        const offerRef = await tx.supplierOffer.findUnique({
          where: { id: input.offerId },
          select: { supplierId: true },
        });
        if (!offerRef) throw new StaffError('NOT_FOUND');
        // Same supplier -> offer ordering as every existing R1-007 offer mutation.
        await tx.$queryRaw`SELECT id FROM supplier WHERE id=${offerRef.supplierId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM supplier_offer WHERE id=${input.offerId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM ingestion_row WHERE id=${rowId} FOR UPDATE`;
        const context = await this.context(tx, rowId, input.offerId);
        if (
          context.row.version !== input.expectedRowVersion ||
          context.offer.version !== input.expectedOfferVersion ||
          context.offer.currentRevisionId !== input.expectedOfferRevisionId
        )
          throw new StaffError('VERSION_CONFLICT');
        if (
          context.decisions[0]?.id !== input.decisionId ||
          context.blockedReason
        )
          throw new StaffError('INVALID_STATE_TRANSITION');
        const current = context.offer.currentRevision;
        const normalized = facts(context.row.normalized);
        const revision: ReviseSupplierOfferDto = {
          expectedVersion: input.expectedOfferVersion,
          supplierPartNumber: current.supplierPartNumber,
          offerName: current.offerName,
          sourceBrandText: current.sourceBrandText,
          brandId: current.brandId,
          manufacturerName: current.manufacturerName,
          originalPartNumber: current.originalPartNumber,
          modification: current.modification,
          modificationEvidence:
            current.modificationEvidence as ModificationEvidence,
          purchaseCost: current.purchaseCost?.toString() ?? null,
          currency: current.currency,
          sourceVatText: current.sourceVatText,
          availabilityText: current.availabilityText,
          leadTimeText: current.leadTimeText,
          sourceObservedAt: current.sourceObservedAt?.toISOString() ?? null,
          expiresAt: current.expiresAt?.toISOString() ?? null,
          sourceUrl: current.sourceUrl,
        };
        for (const [sourceField, field] of economicFields) {
          // Currency without an explicit price is not a price update.
          if (field === 'currency' && normalized.purchase_cost == null)
            continue;
          const value = normalized[sourceField];
          if (typeof value === 'string') revision[field] = value;
        }
        const result = await this.suppliers.reviseSupplierOfferInTransaction(
          tx,
          request,
          input.offerId,
          revision,
        );
        const revised = result.data.data as {
          id: string;
          revisionId: string;
          version: number;
        };
        const application = await tx.ingestionApplication.create({
          data: {
            id: randomUUID(),
            sourceId: context.run.sourceId,
            runId: context.row.runId,
            rowId,
            decisionId: input.decisionId,
            actorId: request.staff!.id,
            offerId: input.offerId,
            baseRevisionId: input.expectedOfferRevisionId,
            revisionId: revised.revisionId,
            version: revised.version,
            sourceHash: context.row.sourceHash,
          },
        });
        return { status: 200, data: application };
      },
      applyPermissions,
    );
  }
}
