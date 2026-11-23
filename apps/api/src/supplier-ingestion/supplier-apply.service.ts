import { Inject, Injectable } from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { readConfig } from '../config.js';
import {
  editableFacts,
  readEdits,
  type EditedField,
  type IngestionEditsPreviewInput,
  type IngestionApplyEditsInput,
} from './supplier-edits.dto.js';
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
  jsonObject,
  SupplierIngestionService,
  type IngestionTx,
} from './supplier-ingestion.service.js';

const legacyApplicationFields = {
  id: true,
  sourceId: true,
  runId: true,
  rowId: true,
  decisionId: true,
  actorId: true,
  offerId: true,
  baseRevisionId: true,
  revisionId: true,
  sourceHash: true,
  version: true,
  createdAt: true,
} as const;

function legacyApplication(
  application:
    | (Record<keyof typeof legacyApplicationFields, unknown> & {
        operation: string;
      })
    | null,
) {
  if (application?.operation !== 'UPDATE') return null;
  return Object.fromEntries(
    Object.keys(legacyApplicationFields).map((field) => [
      field,
      application[field as keyof typeof legacyApplicationFields],
    ]),
  );
}

const readPermissions = ['suppliers.read', 'suppliers.offers.read'];
const applyPermissions = [
  ...readPermissions,
  'suppliers.offers.write',
  'ingestion.review',
];
const editPermissions = [...applyPermissions, 'ingestion.applyEdits'];
const editFields = Object.keys(editableFacts) as EditedField[];
const previewLifetimeMs = 10 * 60 * 1000;

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

export function copyRevision(
  current: SupplierOfferRevision,
  expectedVersion: number,
): ReviseSupplierOfferDto {
  return {
    expectedVersion: expectedVersion,
    supplierPartNumber: current.supplierPartNumber,
    offerName: current.offerName,
    sourceBrandText: current.sourceBrandText,
    brandId: current.brandId,
    manufacturerName: current.manufacturerName,
    originalPartNumber: current.originalPartNumber,
    modification: current.modification,
    modificationEvidence: current.modificationEvidence as ModificationEvidence,
    purchaseCost: current.purchaseCost?.toString() ?? null,
    currency: current.currency,
    sourceVatText: current.sourceVatText,
    availabilityText: current.availabilityText,
    leadTimeText: current.leadTimeText,
    sourceObservedAt: current.sourceObservedAt?.toISOString() ?? null,
    expiresAt: current.expiresAt?.toISOString() ?? null,
    sourceUrl: current.sourceUrl,
  };
}

export function existingDecimal(value: string) {
  const [integer, fraction = ''] = value.split('.');
  return integer + '.' + fraction.replace(/0+$/, '');
}

const freshnessDefaults = {
  purchaseCost: 30,
  availabilityText: 7,
  leadTimeText: 30,
};
type DatedField = keyof typeof freshnessDefaults;
type FreshnessOverrides = Record<string, Partial<Record<DatedField, number>>>;

export function readFreshnessOverrides(
  raw: string | undefined,
): FreshnessOverrides {
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  const policy = facts(value);
  if (policy !== value)
    throw new Error('Supplier edit freshness policy must be an object');
  for (const [id, setting] of Object.entries(policy)) {
    const limits = facts(setting);
    if (
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) ||
      limits !== setting ||
      Object.entries(limits).some(
        ([field, days]) =>
          !Object.hasOwn(freshnessDefaults, field) ||
          typeof days !== 'number' ||
          !Number.isInteger(days) ||
          days < 1 ||
          days > freshnessDefaults[field as DatedField],
      )
    )
      throw new Error('Invalid supplier edit freshness policy');
  }
  return policy as FreshnessOverrides;
}

function freshness(
  value: string | null,
  observedAt: string | null,
  days: number,
  now: number,
  expiresAt?: string | null,
) {
  if (value === null || !observedAt) return 'REQUIRES_REVIEW';
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed) || observed > now) return 'REQUIRES_REVIEW';
  const deadline = observed + days * 86400000;
  return now >=
    (expiresAt ? Math.min(Date.parse(expiresAt), deadline) : deadline)
    ? 'STALE'
    : 'VALID';
}

@Injectable()
export class SupplierApplyService {
  private readonly editsEnabled =
    process.env.SUPPLIER_INGESTION_CLEAR_ENABLED === 'true';
  private readonly tokenKey = readConfig(process.env).sessionHmacKey;
  private readonly freshnessOverrides = this.editsEnabled
    ? readFreshnessOverrides(process.env.SUPPLIER_INGESTION_EDIT_FRESHNESS_DAYS)
    : {};

  private assertEditsEnabled() {
    if (!this.editsEnabled) throw new StaffError('NOT_FOUND');
  }

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

  private async lockTarget(tx: IngestionTx, rowId: string, offerId: string) {
    // Source lock prevents disabling or replacing the source during manual APPLY.
    const rowRef = await tx.ingestionRow.findUnique({
      where: { id: rowId },
      select: { run: { select: { sourceId: true } } },
    });
    if (!rowRef) throw new StaffError('NOT_FOUND');
    await tx.$queryRaw`SELECT id FROM ingestion_source WHERE id=${rowRef.run.sourceId}::uuid FOR SHARE`;
    const offerRef = await tx.supplierOffer.findUnique({
      where: { id: offerId },
      select: { supplierId: true },
    });
    if (!offerRef) throw new StaffError('NOT_FOUND');
    // Same supplier -> offer ordering as every existing R1-007 offer mutation.
    await tx.$queryRaw`SELECT id FROM supplier WHERE id=${offerRef.supplierId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM supplier_offer WHERE id=${offerId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM ingestion_row WHERE id=${rowId} FOR UPDATE`;
  }

  private async context(
    tx: IngestionTx,
    rowId: string,
    offerId: string,
    legacy = true,
  ) {
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
      legacy &&
      !blockedReason &&
      normalized.purchase_cost != null &&
      offer.currentRevision.currency !== null &&
      normalized.currency !== offer.currentRevision.currency
    )
      blockedReason = 'CURRENCY_MISMATCH';
    const fields = comparison(row, offer.currentRevision);
    if (
      legacy &&
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
    if (
      !legacy &&
      (blockedReason === null || blockedReason === 'NOT_ACCEPTED')
    ) {
      if (row.sourceHash !== run.sourceHash) blockedReason = 'SOURCE_CHANGED';
      const brandId = offer.currentRevision.brandId;
      const brand = brandId
        ? await tx.brand.findUnique({
            where: { id: brandId },
            select: { state: true, name: true },
          })
        : null;
      const matchesBrand =
        brand?.state === 'ACTIVE' &&
        brand.name.normalize('NFC').replace(/^ +| +$/g, '') ===
          offer.currentRevision.sourceBrandText
            ?.normalize('NFC')
            .replace(/^ +| +$/g, '');
      if (
        !matchesBrand &&
        (blockedReason === null || blockedReason === 'NOT_ACCEPTED')
      )
        blockedReason = 'IDENTITY_MISMATCH';
    }
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
            application: legacyApplication(context.application),
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
          where: { rowId, operation: 'UPDATE' },
          select: legacyApplicationFields,
          take: 1,
        }),
      };
    });
  }

  private async editPlan(
    tx: IngestionTx,
    rowId: string,
    input: IngestionEditsPreviewInput,
  ) {
    const context = await this.context(tx, rowId, input.offerId, false);
    const { currentRevision } = context.offer;
    const revision = copyRevision(currentRevision, input.expectedOfferVersion);
    const normalized = facts(context.row.normalized);
    const edits = readEdits(input.edits);
    const now = Date.now();
    const configured = Number(process.env.SUPPLIER_OFFER_FRESHNESS_DAYS);
    const supplierLimits = this.freshnessOverrides[context.offer.supplierId];
    const sourceLimits = this.freshnessOverrides[context.run.sourceId];
    const days = (field: DatedField) =>
      Math.min(
        freshnessDefaults[field],
        supplierLimits?.[field] ?? Infinity,
        sourceLimits?.[field] ?? Infinity,
      );
    const costDays = Math.min(
      days('purchaseCost'),
      Number.isInteger(configured) && configured > 0 ? configured : Infinity,
    );
    const timeLimits: Partial<Record<EditedField, number>> = {
      purchaseCost: costDays,
      currency: costDays,
      availabilityText: days('availabilityText'),
      leadTimeText: days('leadTimeText'),
    };
    let blockedReason = context.blockedReason;
    if (
      context.row.version !== input.expectedRowVersion ||
      context.offer.version !== input.expectedOfferVersion ||
      context.offer.currentRevisionId !== input.expectedOfferRevisionId ||
      context.decisions[0]?.id !== input.decisionId
    )
      blockedReason = 'VERSION_CONFLICT';

    const observed =
      typeof normalized.source_observed_at === 'string'
        ? normalized.source_observed_at
        : null;
    const fields = editFields.map((field) => {
      const current = revision[field] ?? null;
      const fact = normalized[editableFacts[field]];
      const proposed = typeof fact === 'string' && fact.trim() ? fact : null;
      const edit = edits[field];
      const limit = timeLimits[field];
      const sourceFreshness = limit
        ? freshness(proposed, observed, limit, now)
        : null;
      const currentFreshness = limit
        ? freshness(
            current,
            revision.sourceObservedAt ?? null,
            limit,
            now,
            revision.expiresAt,
          )
        : null;
      if (edit?.op === 'SET') {
        if (proposed !== edit.value) blockedReason ??= 'UNVERIFIED_SET';
        else if (sourceFreshness && sourceFreshness !== 'VALID')
          blockedReason ??= 'STALE_OR_UNDATED_FACT';
        else revision[field] = proposed;
      }
      if (edit?.op === 'CLEAR') revision[field] = null;
      return {
        field,
        current,
        proposed,
        result: revision[field] ?? null,
        currentFreshness,
        sourceFreshness,
        resultFreshness: limit
          ? freshness(
              revision[field] ?? null,
              revision.sourceObservedAt ?? null,
              limit,
              now,
              revision.expiresAt,
            )
          : null,
      };
    });

    const touchedPrice = edits.purchaseCost || edits.currency;
    if (
      touchedPrice &&
      (revision.purchaseCost === null) !== (revision.currency === null)
    )
      blockedReason ??= 'INCONSISTENT_PRICE_CURRENCY';
    if (
      edits.purchaseCost?.op === 'SET' &&
      (typeof normalized.currency !== 'string' ||
        revision.currency !== normalized.currency)
    )
      blockedReason ??= 'CURRENCY_MISMATCH';
    if (
      edits.currency?.op === 'SET' &&
      (edits.purchaseCost?.op !== 'SET' ||
        (currentRevision.currency !== null &&
          revision.currency !== currentRevision.currency))
    )
      blockedReason ??= 'CURRENCY_MISMATCH';
    if (
      !revision.sourceObservedAt &&
      !revision.expiresAt &&
      revision.purchaseCost !== null &&
      Number.isInteger(configured) &&
      configured > 0 &&
      now >= currentRevision.recordedAt.getTime() + configured * 86400000
    )
      blockedReason ??= 'STALE_OR_UNDATED_FACT';
    const clearsMoney =
      edits.purchaseCost?.op === 'CLEAR' || edits.currency?.op === 'CLEAR';
    const raw = context.run.rawSnapshot;
    let evidence: {
      sourceHash: string;
      sourceVersion: number;
      rowNumber: number;
      capturedAt: string;
      observedAt: string;
    } | null = null;
    if (
      raw &&
      context.run.finishedAt &&
      createHash('sha256').update(raw).digest('hex') === context.row.sourceHash
    ) {
      const snapshot: unknown = JSON.parse(Buffer.from(raw).toString('utf8'));
      const rawRow = Array.isArray(snapshot)
        ? facts(snapshot[context.row.rowNumber - 1])
        : {};
      const capturedAt = context.run.finishedAt.toISOString();
      const observedAt =
        typeof rawRow.source_observed_at === 'string'
          ? rawRow.source_observed_at
          : null;
      if (
        Object.hasOwn(rawRow, 'purchase_cost') &&
        rawRow.purchase_cost === null &&
        Object.hasOwn(rawRow, 'currency') &&
        rawRow.currency === null &&
        observedAt !== null &&
        Date.parse(observedAt) === Date.parse(observed ?? '') &&
        Date.parse(observedAt) <= Date.parse(capturedAt) &&
        freshness('evidence', observedAt, costDays, now) === 'VALID'
      ) {
        evidence = {
          sourceHash: context.row.sourceHash,
          sourceVersion: context.run.sourceVersion,
          rowNumber: context.row.rowNumber,
          capturedAt,
          observedAt,
        };
      }
    }
    if (
      (clearsMoney || input.evidenceHash !== undefined) &&
      (!evidence || input.evidenceHash !== evidence.sourceHash)
    )
      blockedReason ??= 'PRICE_CLEAR_EVIDENCE_REQUIRED';
    const changed = fields.some(({ field, current, result }) =>
      field === 'purchaseCost' && current !== null && result !== null
        ? existingDecimal(current) !== existingDecimal(result)
        : current !== result,
    );
    if (!changed) blockedReason ??= 'NO_CHANGED_FIELDS';
    return { context, revision, fields, blockedReason, evidence, edits };
  }

  private signature(
    request: StaffRequest,
    rowId: string,
    input: IngestionEditsPreviewInput,
    plan: Awaited<ReturnType<SupplierApplyService['editPlan']>>,
    issuedAt: string,
  ) {
    const edits = editFields.map((field) => plan.edits[field] ?? null);
    return createHmac('sha256', this.tokenKey)
      .update(
        JSON.stringify([
          'ingestion-edit-v1',
          issuedAt,
          request.staff!.id,
          request.staff!.sessionId,
          rowId,
          input.offerId,
          input.decisionId,
          input.expectedRowVersion,
          input.expectedOfferVersion,
          input.expectedOfferRevisionId,
          plan.context.run.sourceId,
          plan.context.run.sourceVersion,
          plan.context.row.sourceHash,
          edits,
          input.evidenceHash ?? null,
        ]),
      )
      .digest();
  }

  private async authorizeEdits(tx: IngestionTx, request: StaffRequest) {
    await this.authorize(tx, request);
    for (const code of editPermissions.filter(
      (code) => !readPermissions.includes(code),
    ))
      await assertHasPermission(tx, request.staff!.id, code);
  }

  async editHistory(request: StaffRequest, rowId: string) {
    return this.ingestion.db.$transaction(async (tx) => {
      await this.authorize(tx, request);
      const application = await tx.ingestionApplication.findUnique({
        where: { rowId },
        include: { edits: true, baseRevision: true, revision: true },
      });
      if (!application?.edits || !application.baseRevision)
        return { data: null };
      return {
        data: {
          applicationId: application.id,
          baseRevisionId: application.baseRevision.id,
          revisionId: application.revision.id,
          edits: application.edits.edits,
          evidence: application.edits.evidence,
          fields: editFields.map((field) => ({
            field,
            before: text(application.baseRevision![field]),
            after: text(application.revision[field]),
          })),
        },
      };
    });
  }

  async editInspection(request: StaffRequest, rowId: string, offerId: string) {
    this.assertEditsEnabled();
    return this.ingestion.db.$transaction(
      async (tx) => {
        await this.authorizeEdits(tx, request);
        const { row, blockedReason } = await this.context(
          tx,
          rowId,
          offerId,
          false,
        );
        return {
          data: {
            rowVersion: row.version,
            decisionEligible:
              row.reviewState === 'PENDING' && blockedReason === 'NOT_ACCEPTED',
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async editPreview(
    request: StaffRequest,
    rowId: string,
    input: IngestionEditsPreviewInput,
  ) {
    this.assertEditsEnabled();
    return this.ingestion.db.$transaction(
      async (tx) => {
        await this.authorizeEdits(tx, request);
        const plan = await this.editPlan(tx, rowId, input);
        const time = Date.now().toString();
        return {
          data: {
            fields: plan.fields,
            evidence: plan.evidence,
            blockedReason: plan.blockedReason,
            previewToken: plan.blockedReason
              ? null
              : time +
                '.' +
                this.signature(request, rowId, input, plan, time).toString(
                  'hex',
                ),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async applyEdits(
    request: StaffRequest,
    key: string | undefined,
    rowId: string,
    input: IngestionApplyEditsInput,
  ) {
    this.assertEditsEnabled();
    return this.ingestion.command(
      request,
      key,
      'applyEdits',
      'ingestion.read',
      rowId,
      input,
      async (tx) => {
        await this.lockTarget(tx, rowId, input.offerId);
        const plan = await this.editPlan(tx, rowId, input);
        const [issuedAt, mac] = input.previewToken.split('.') as [
          string,
          string,
        ];
        const age = Date.now() - Number(issuedAt);
        if (
          age < 0 ||
          age > previewLifetimeMs ||
          !timingSafeEqual(
            Buffer.from(mac, 'hex'),
            this.signature(request, rowId, input, plan, issuedAt),
          ) ||
          plan.blockedReason === 'VERSION_CONFLICT'
        )
          throw new StaffError('VERSION_CONFLICT');
        if (plan.blockedReason)
          throw new StaffError('INVALID_STATE_TRANSITION');
        const { data } = await this.suppliers.reviseSupplierOfferInTransaction(
          tx,
          request,
          input.offerId,
          plan.revision,
        );
        const revised = data.data as {
          id: string;
          revisionId: string;
          version: number;
        };
        const application = await tx.ingestionApplication.create({
          data: {
            id: randomUUID(),
            operation: 'UPDATE',
            sourceId: plan.context.run.sourceId,
            runId: plan.context.row.runId,
            rowId,
            decisionId: input.decisionId,
            actorId: request.staff!.id,
            offerId: input.offerId,
            baseRevisionId: input.expectedOfferRevisionId,
            revisionId: revised.revisionId,
            version: revised.version,
            sourceHash: plan.context.row.sourceHash,
          },
        });
        await tx.ingestionApplicationEdits.create({
          data: {
            applicationId: application.id,
            edits: jsonObject(plan.edits),
            evidence: jsonObject({
              sourceVersion: plan.context.run.sourceVersion,
              rowNumber: plan.context.row.rowNumber,
              priceEvidence: input.evidenceHash ? plan.evidence : null,
            }),
          },
        });
        return { status: 200, data: application };
      },
      editPermissions,
    );
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
        await this.lockTarget(tx, rowId, input.offerId);
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
        const revision = copyRevision(current, input.expectedOfferVersion);
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
        return { status: 200, data: legacyApplication(application) };
      },
      applyPermissions,
    );
  }
}
