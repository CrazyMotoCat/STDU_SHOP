import { createAuditEvent } from '../audit/audit.service.js';
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { StaffError } from '../identity/errors.js';
import type { StaffRequest } from '../identity/request.js';
import {
  assertCurrentActor,
  assertHasPermission,
} from '../permissions/policy.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import {
  copyRevision,
  existingDecimal,
  readFreshnessOverrides,
} from './supplier-apply.service.js';
import type {
  IngestionIdentityConfirmationInput,
  IngestionIdentityExecutionInput,
  IngestionSubmitIdentityInput,
} from './supplier-reconciliation.dto.js';
import {
  SupplierIngestionService,
  type IngestionTx,
} from './supplier-ingestion.service.js';

export const reconciliationRead = ['suppliers.read', 'suppliers.offers.read'];
const reviewRead = [...reconciliationRead, 'ingestion.review'];
export const reconciliationPermissions = {
  submit: [...reviewRead, 'ingestion.reconcile.submit'],
  approve: [...reviewRead, 'ingestion.reconcile.approve'],
  execute: [
    ...reviewRead,
    'suppliers.offers.write',
    'ingestion.reconcile.execute',
  ],
};
const day = 86_400_000;
const duplicateLimit = 20;

type Evidence = {
  id: string;
  source_id: string;
  source_version: number;
  kind: string;
  reference: string;
  artifact_version: string;
  artifact_digest: string;
  attested_at: Date;
  brand_id: string;
  manufacturer_name: string;
  part_number: string;
  modification_evidence: string;
  modification: string | null;
};
type Submission = {
  id: string;
  digest: string;
  source_id: string;
  source_version: number;
  source_hash: string;
  row_id: string;
  row_version: number;
  operation: 'UPDATE' | 'CREATE';
  evidence_id: string;
  decision_id: string;
  requester_id: string;
  supplier_id: string;
  offer_id: string | null;
  offer_version: number | null;
  target_revision_id: string | null;
  duplicate_digest: string;
  archived_duplicate_ids: string[];
  reason: string;
  created_at: Date;
};
type Confirmation = { approver_id: string; created_at: Date; reason: string };

function exact(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFC').replace(/^ +| +$/g, '')
    : null;
}

function digest(parts: unknown[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

@Injectable()
export class SupplierReconciliationService {
  private readonly updateEnabled =
    process.env.SUPPLIER_INGESTION_RECONCILE_UPDATE_ENABLED === 'true';

  constructor(
    @Inject(SupplierIngestionService)
    private readonly ingestion: SupplierIngestionService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
  ) {}

  private readonly freshnessOverrides = this.updateEnabled
    ? readFreshnessOverrides(process.env.SUPPLIER_INGESTION_EDIT_FRESHNESS_DAYS)
    : {};

  private async auditIdentity(
    tx: IngestionTx,
    request: StaffRequest,
    event: 'submitted' | 'confirmed' | 'executed',
    operation: 'UPDATE' | 'CREATE',
    rowId: string,
    submissionId: string,
  ) {
    await createAuditEvent(tx, {
      actorKind: 'STAFF',
      actorUserId: request.staff!.id,
      action: 'ingestion.identity.' + event,
      outcome: 'SUCCESS',
      reasonCode: 'RECONCILIATION',
      requestId: request.requestId,
      changes: { submissionId, rowId, operation },
    });
  }

  private assertAcknowledged(expected: string[], actual: string[]) {
    if (JSON.stringify(expected) !== JSON.stringify([...actual].sort()))
      throw new StaffError('VERSION_CONFLICT');
  }

  private enabled() {
    if (!this.updateEnabled) throw new StaffError('NOT_FOUND');
  }

  private async authorizeRead(tx: IngestionTx, request: StaffRequest) {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    await assertCurrentActor(tx, request.staff, 'ingestion.read');
    for (const permission of reconciliationRead)
      await assertHasPermission(tx, request.staff.id, permission);
  }

  async inspect(request: StaffRequest, rowId: string) {
    this.enabled();
    return this.ingestion.db.$transaction(async (tx) => {
      await this.authorizeRead(tx, request);
      const row = await tx.ingestionRow.findUnique({
        where: { id: rowId },
        include: {
          run: { include: { source: { include: { supplier: true } } } },
        },
      });
      if (!row) throw new StaffError('NOT_FOUND');
      const source = row.run.source;
      const n = row.normalized as Record<string, unknown> | null;
      return {
        data: {
          rowVersion: row.version,
          decisionEligible:
            row.reviewState === 'PENDING' &&
            !row.errorCode &&
            Boolean(
              exact(n?.manufacturer_name) && exact(n?.original_part_number),
            ) &&
            ['COMPLETE', 'PARTIAL'].includes(row.run.state) &&
            source.state === 'ENABLED' &&
            source.version === row.run.sourceVersion &&
            source.supplier.state === 'ACTIVE',
        },
      };
    });
  }

  async history(request: StaffRequest, rowId: string) {
    return this.ingestion.db.$transaction(async (tx) => {
      await this.authorizeRead(tx, request);
      const items = await tx.$queryRaw<Submission[]>`
        SELECT * FROM public.ingestion_identity_submission WHERE row_id=${rowId}
        ORDER BY created_at DESC,id DESC LIMIT 20
      `;
      return {
        actorId: request.staff!.id,
        data: await Promise.all(
          items.map(async (submission) => {
            const [evidence] = await tx.$queryRaw<Evidence[]>`
          SELECT * FROM public.ingestion_identity_evidence WHERE id=${submission.evidence_id}::uuid
        `;
            const [confirmation] = await this.confirmations(tx, submission.id);
            const [execution] = await tx.$queryRaw<
              { application_id: string }[]
            >`
          SELECT application_id FROM public.ingestion_identity_execution WHERE submission_id=${submission.id}::uuid
        `;
            return {
              submission,
              evidence,
              confirmation: confirmation ?? null,
              execution: execution ?? null,
            };
          }),
        ),
      };
    });
  }

  private confirmations(tx: IngestionTx, submissionId: string) {
    return tx.$queryRaw<Confirmation[]>`
      SELECT approver_id,created_at,reason FROM public.ingestion_identity_confirmation
      WHERE submission_id=${submissionId}::uuid
    `;
  }

  private async loadSubmission(
    tx: IngestionTx,
    rowId: string,
    id: string,
    expectedDigest: string,
  ) {
    const [entry] = await tx.$queryRaw<Submission[]>`
      SELECT * FROM public.ingestion_identity_submission WHERE id=${id}::uuid AND row_id=${rowId} AND operation='UPDATE'
    `;
    if (!entry) throw new StaffError('NOT_FOUND');
    if (entry.digest !== expectedDigest)
      throw new StaffError('VERSION_CONFLICT');
    return entry;
  }

  private async readEvidence(
    tx: IngestionTx,
    id: string,
    sourceId: string,
    sourceVersion: number,
  ) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}::text, 9009))::text`;
    const [item] = await tx.$queryRaw<Evidence[]>`
      SELECT e.* FROM public.ingestion_identity_evidence e
      WHERE e.id=${id}::uuid AND e.source_id=${sourceId}::uuid AND e.source_version=${sourceVersion}
      AND e.attested_at <= clock_timestamp() AND e.attested_at + interval '365 days' > clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM public.ingestion_identity_evidence_revocation r WHERE r.evidence_id=e.id)
    `;
    if (!item) throw new StaffError('INVALID_STATE_TRANSITION');
    return item;
  }

  private async updatePlan(
    tx: IngestionTx,
    rowId: string,
    input: IngestionSubmitIdentityInput,
  ) {
    const ref = await tx.ingestionRow.findUnique({
      where: { id: rowId },
      select: {
        run: {
          select: { sourceId: true, source: { select: { supplierId: true } } },
        },
      },
    });
    if (!ref) throw new StaffError('NOT_FOUND');
    const supplierId = ref.run.source.supplierId;
    await tx.$queryRaw`SELECT id FROM ingestion_source WHERE id=${ref.run.sourceId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM supplier WHERE id=${supplierId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM supplier_offer WHERE id=${input.offerId}::uuid AND supplier_id=${supplierId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM ingestion_row WHERE id=${rowId} FOR UPDATE`;
    const row = await tx.ingestionRow.findUniqueOrThrow({
      where: { id: rowId },
      include: {
        decisions: true,
        application: true,
        run: { include: { source: { include: { supplier: true } } } },
      },
    });
    const offer = await tx.supplierOffer.findUnique({
      where: { id: input.offerId, supplierId },
      include: { currentRevision: true },
    });
    if (!offer) throw new StaffError('NOT_FOUND');
    if (
      row.version !== input.expectedRowVersion ||
      offer.version !== input.expectedOfferVersion ||
      offer.currentRevisionId !== input.expectedOfferRevisionId ||
      row.decisions[0]?.id !== input.decisionId
    )
      throw new StaffError('VERSION_CONFLICT');
    const source = row.run.source;
    if (
      row.application ||
      row.reviewState !== 'ACCEPTED' ||
      row.decisions[0]?.decision !== 'ACCEPT' ||
      row.errorCode ||
      !row.normalized ||
      !['COMPLETE', 'PARTIAL'].includes(row.run.state) ||
      row.sourceHash !== row.run.sourceHash ||
      source.version !== row.run.sourceVersion ||
      source.state !== 'ENABLED' ||
      source.supplier.state !== 'ACTIVE' ||
      offer.state !== 'ACTIVE'
    )
      throw new StaffError('INVALID_STATE_TRANSITION');
    const evidence = await this.readEvidence(
      tx,
      input.evidenceId,
      source.id,
      source.version,
    );
    await tx.$queryRaw`SELECT id FROM brand WHERE id=${evidence.brand_id}::uuid FOR UPDATE`;
    const brand = await tx.brand.findUnique({
      where: { id: evidence.brand_id },
      select: { state: true, name: true },
    });
    const n = row.normalized as Record<string, unknown>;
    const target = offer.currentRevision;
    const manufacturer = exact(n.manufacturer_name);
    const part = exact(n.original_part_number);
    const variant = exact(n.modification);
    const stagedBrand = exact(n.source_brand_text);
    const sku = exact(n.supplier_part_number);
    if (
      !manufacturer ||
      !part ||
      brand?.state !== 'ACTIVE' ||
      manufacturer !== evidence.manufacturer_name ||
      part !== evidence.part_number ||
      (stagedBrand && stagedBrand !== exact(brand.name)) ||
      (row.modificationEvidence === 'SPECIFIED' &&
        (evidence.modification_evidence !== 'SPECIFIED' ||
          variant !== evidence.modification)) ||
      evidence.brand_id !== target.brandId ||
      exact(target.manufacturerName) !== manufacturer ||
      exact(target.originalPartNumber) !== part ||
      evidence.modification_evidence !== target.modificationEvidence ||
      evidence.modification !== exact(target.modification) ||
      (sku &&
        target.supplierPartNumber &&
        sku !== exact(target.supplierPartNumber))
    )
      throw new StaffError('INVALID_STATE_TRANSITION');

    const lookup = () =>
      tx.supplierOffer.findMany({
        where: {
          supplierId,
          id: { not: input.offerId },
          currentRevision: {
            OR: [
              { manufacturerName: manufacturer, originalPartNumber: part },
              ...(sku ? [{ supplierPartNumber: sku }] : []),
            ],
          },
        },
        include: { currentRevision: true },
        orderBy: { id: 'asc' },
        take: duplicateLimit + 1,
      });
    const first = await lookup();
    if (first.length > duplicateLimit)
      throw new StaffError('INVALID_STATE_TRANSITION');
    for (const item of first)
      await tx.$queryRaw`SELECT id FROM supplier_offer WHERE id=${item.id}::uuid FOR SHARE`;
    const candidates = await lookup();
    if (candidates.length > duplicateLimit)
      throw new StaffError('INVALID_STATE_TRANSITION');
    const archived = candidates
      .filter(
        (item) =>
          item.state === 'ARCHIVED' &&
          item.currentRevision.brandId === evidence.brand_id &&
          exact(item.currentRevision.manufacturerName) === manufacturer &&
          exact(item.currentRevision.originalPartNumber) === part &&
          item.currentRevision.modificationEvidence ===
            evidence.modification_evidence &&
          exact(item.currentRevision.modification) === evidence.modification,
      )
      .map(({ id }) => id);
    for (const { state, currentRevision: candidate } of candidates) {
      const clearlyDifferentVariant =
        candidate.brandId === evidence.brand_id &&
        exact(candidate.manufacturerName) === manufacturer &&
        exact(candidate.originalPartNumber) === part &&
        ['SPECIFIED', 'CONFIRMED_NONE'].includes(
          candidate.modificationEvidence,
        ) &&
        (candidate.modificationEvidence !== evidence.modification_evidence ||
          exact(candidate.modification) !== evidence.modification) &&
        (!sku || sku !== exact(candidate.supplierPartNumber));
      if (state === 'ACTIVE' && !clearlyDifferentVariant)
        throw new StaffError('INVALID_STATE_TRANSITION');
    }
    const revision = copyRevision(target, offer.version);
    const received =
      typeof n.source_observed_at === 'string'
        ? Date.parse(n.source_observed_at)
        : NaN;
    const now = Date.now();
    const configuredPriceDays = Number(
      process.env.SUPPLIER_OFFER_FRESHNESS_DAYS,
    );
    const scoped = (
      field: 'purchaseCost' | 'availabilityText' | 'leadTimeText',
      fallback: number,
    ) =>
      Math.min(
        fallback,
        this.freshnessOverrides[source.id]?.[field] ?? Infinity,
        this.freshnessOverrides[supplierId]?.[field] ?? Infinity,
      );
    const priceDays = scoped(
      'purchaseCost',
      Number.isInteger(configuredPriceDays) && configuredPriceDays > 0
        ? Math.min(30, configuredPriceDays)
        : 30,
    );
    const datedFact = (days: number) =>
      Number.isFinite(received) &&
      received <= now &&
      now - received < days * day;
    if (
      typeof n.purchase_cost === 'string' &&
      (revision.purchaseCost == null ||
        existingDecimal(n.purchase_cost) !==
          existingDecimal(revision.purchaseCost))
    ) {
      if (
        !datedFact(priceDays) ||
        typeof n.currency !== 'string' ||
        (revision.currency !== null && revision.currency !== n.currency)
      )
        throw new StaffError('INVALID_STATE_TRANSITION');
      revision.purchaseCost = n.purchase_cost;
      revision.currency = n.currency;
    }
    const nonMonetary = {
      sourceVatText: n.source_vat_text,
      availabilityText: n.availability_text,
      leadTimeText: n.lead_time_text,
      sourceUrl: n.source_url,
    };
    let changed =
      revision.purchaseCost !== target.purchaseCost?.toString() &&
      revision.purchaseCost !== null;
    for (const field of Object.keys(
      nonMonetary,
    ) as (keyof typeof nonMonetary)[]) {
      const value = nonMonetary[field];
      if (typeof value !== 'string' || value === revision[field]) continue;
      if (
        (field === 'availabilityText' &&
          !datedFact(scoped('availabilityText', 7))) ||
        (field === 'leadTimeText' && !datedFact(scoped('leadTimeText', 30)))
      )
        throw new StaffError('INVALID_STATE_TRANSITION');
      changed = true;
      revision[field] = value;
    }
    if (
      revision.purchaseCost !== null &&
      !revision.sourceObservedAt &&
      !revision.expiresAt &&
      Number.isInteger(configuredPriceDays) &&
      configuredPriceDays > 0 &&
      now - target.recordedAt.getTime() >= configuredPriceDays * day
    )
      throw new StaffError('INVALID_STATE_TRANSITION');
    if (!changed) throw new StaffError('INVALID_STATE_TRANSITION');
    const duplicateDigest = digest(
      candidates.map((candidate) => [
        candidate.id,
        candidate.version,
        candidate.currentRevisionId,
        candidate.state,
      ]),
    );
    const planDigest = digest([
      'supplier-identity-reconciliation/update/v1',
      rowId,
      row.version,
      row.sourceHash,
      row.runId,
      source.id,
      source.version,
      supplierId,
      input.decisionId,
      offer.id,
      offer.version,
      offer.currentRevisionId,
      duplicateDigest,
      archived,
      input.reason,
      evidence.id,
      evidence.kind,
      evidence.reference,
      evidence.artifact_version,
      evidence.artifact_digest,
      evidence.attested_at.toISOString(),
      evidence.brand_id,
      evidence.manufacturer_name,
      evidence.part_number,
      evidence.modification_evidence,
      evidence.modification,
    ]);
    return {
      row,
      source,
      offer,
      revision,
      archived,
      duplicateDigest,
      planDigest,
    };
  }

  private approvedInput(entry: Submission): IngestionSubmitIdentityInput {
    return {
      offerId: entry.offer_id!,
      expectedOfferVersion: entry.offer_version!,
      expectedOfferRevisionId: entry.target_revision_id!,
      expectedRowVersion: entry.row_version,
      decisionId: entry.decision_id,
      evidenceId: entry.evidence_id,
      reason: entry.reason,
    };
  }

  submit(
    request: StaffRequest,
    key: string | undefined,
    rowId: string,
    input: IngestionSubmitIdentityInput,
  ) {
    this.enabled();
    if (!input.reason.trim() || input.reason.includes(String.fromCharCode(0)))
      throw new StaffError('VALIDATION_ERROR');
    return this.ingestion.command(
      request,
      key,
      'submitUpdateIdentity',
      'ingestion.read',
      rowId,
      input,
      async (tx) => {
        const plan = await this.updatePlan(tx, rowId, input);
        const id = randomUUID();
        await tx.$executeRaw`
        INSERT INTO public.ingestion_identity_submission
          (id,digest,row_id,operation,source_id,source_version,evidence_id,decision_id,requester_id,
          supplier_id,offer_id,target_revision_id,row_version,offer_version,source_hash,duplicate_digest,reason,archived_duplicate_ids)
        VALUES (${id}::uuid,${plan.planDigest},${rowId},'UPDATE',${plan.source.id}::uuid,${plan.source.version},
          ${input.evidenceId}::uuid,${input.decisionId}::uuid,${request.staff!.id}::uuid,${plan.offer.supplierId}::uuid,
          ${plan.offer.id}::uuid,${plan.offer.currentRevisionId}::uuid,${plan.row.version},${plan.offer.version},
          ${plan.row.sourceHash},${plan.duplicateDigest},${input.reason},${plan.archived}::uuid[])
      `;
        await this.auditIdentity(tx, request, 'submitted', 'UPDATE', rowId, id);
        return {
          status: 201,
          data: {
            id,
            digest: plan.planDigest,
            archivedDuplicateIds: plan.archived,
          },
        };
      },
      reconciliationPermissions.submit,
    );
  }

  approve(
    request: StaffRequest,
    key: string | undefined,
    rowId: string,
    id: string,
    input: IngestionIdentityConfirmationInput,
  ) {
    this.enabled();
    if (!input.reason.trim() || input.reason.includes(String.fromCharCode(0)))
      throw new StaffError('VALIDATION_ERROR');
    return this.ingestion.command(
      request,
      key,
      'approveUpdateIdentity',
      'ingestion.read',
      rowId,
      { id, ...input },
      async (tx) => {
        const entry = await this.loadSubmission(tx, rowId, id, input.digest);
        if (entry.requester_id === request.staff!.id)
          throw new StaffError('FORBIDDEN');
        const plan = await this.updatePlan(
          tx,
          rowId,
          this.approvedInput(entry),
        );
        if (plan.planDigest !== entry.digest)
          throw new StaffError('VERSION_CONFLICT');
        this.assertAcknowledged(plan.archived, input.acknowledgedDuplicateIds);
        if ((await this.confirmations(tx, id)).length)
          throw new StaffError('VERSION_CONFLICT');
        await tx.$executeRaw`
        INSERT INTO public.ingestion_identity_confirmation
          (submission_id,digest,row_id,operation,requester_id,approver_id,reason)
        VALUES (${id}::uuid,${entry.digest},${rowId},'UPDATE',${entry.requester_id}::uuid,
          ${request.staff!.id}::uuid,${input.reason})
      `;
        await this.auditIdentity(tx, request, 'confirmed', 'UPDATE', rowId, id);
        return {
          status: 200,
          data: { id, digest: entry.digest, approved: true },
        };
      },
      reconciliationPermissions.approve,
    );
  }

  executeUpdate(
    request: StaffRequest,
    key: string | undefined,
    rowId: string,
    id: string,
    input: IngestionIdentityExecutionInput,
  ) {
    this.enabled();
    return this.ingestion.command(
      request,
      key,
      'executeUpdateIdentity',
      'ingestion.read',
      rowId,
      { id, ...input },
      async (tx) => {
        const entry = await this.loadSubmission(tx, rowId, id, input.digest);
        const plan = await this.updatePlan(
          tx,
          rowId,
          this.approvedInput(entry),
        );
        if (plan.planDigest !== entry.digest)
          throw new StaffError('VERSION_CONFLICT');
        this.assertAcknowledged(plan.archived, input.acknowledgedDuplicateIds);
        const [confirmation] = await this.confirmations(tx, id);
        if (!confirmation) throw new StaffError('INVALID_STATE_TRANSITION');
        if (confirmation.approver_id === request.staff!.id)
          throw new StaffError('FORBIDDEN');
        const result = await this.suppliers.reviseSupplierOfferInTransaction(
          tx,
          request,
          plan.offer.id,
          plan.revision,
        );
        const revised = result.data.data as {
          revisionId: string;
          version: number;
        };
        const application = await tx.ingestionApplication.create({
          data: {
            id: randomUUID(),
            operation: 'UPDATE',
            rowId,
            sourceId: plan.source.id,
            runId: plan.row.runId,
            decisionId: entry.decision_id,
            actorId: request.staff!.id,
            offerId: plan.offer.id,
            baseRevisionId: plan.offer.currentRevisionId,
            revisionId: revised.revisionId,
            sourceHash: plan.row.sourceHash,
            version: revised.version,
          },
        });
        await tx.$executeRaw`
        INSERT INTO public.ingestion_identity_execution
          (application_id,submission_id,row_id,operation,executor_id,approver_id)
        VALUES (${application.id}::uuid,${entry.id}::uuid,${rowId},'UPDATE',
          ${request.staff!.id}::uuid,${confirmation.approver_id}::uuid)
      `;
        await this.auditIdentity(tx, request, 'executed', 'UPDATE', rowId, id);
        return { status: 200, data: application };
      },
      reconciliationPermissions.execute,
    );
  }
}
