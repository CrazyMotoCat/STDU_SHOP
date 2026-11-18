import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { readConfig } from '../config.js';
import { StaffError } from '../identity/errors.js';
import type { StaffRequest } from '../identity/request.js';
import {
  assertCurrentActor,
  assertHasPermission,
} from '../permissions/policy.js';
import { ModificationEvidence } from '../suppliers/suppliers.dto.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import type {
  IngestionCreateInput,
  IngestionCreatePreviewInput,
} from './supplier-ingestion.dto.js';
import {
  SupplierIngestionService,
  type IngestionTx,
} from './supplier-ingestion.service.js';

const readPermissions = ['suppliers.read', 'suppliers.offers.read'];
const createPermissions = [
  ...readPermissions,
  'ingestion.review',
  'suppliers.offers.write',
  'ingestion.createOffer',
];
const duplicateLimit = 20;
const previewLifetimeMs = 10 * 60 * 1000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function fact(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0
    ? value.normalize('NFC').replace(/^ +| +$/g, '') || null
    : null;
}

@Injectable()
export class SupplierCreateService {
  private readonly enabled =
    process.env.SUPPLIER_INGESTION_CREATE_ENABLED === 'true';
  private readonly tokenKey = readConfig(process.env).sessionHmacKey;

  constructor(
    @Inject(SupplierIngestionService)
    private readonly ingestion: SupplierIngestionService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
  ) {}

  private async authorize(
    tx: IngestionTx,
    request: StaffRequest,
    permissions: string[],
  ) {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    await assertCurrentActor(tx, request.staff, 'ingestion.read');
    for (const permission of permissions)
      await assertHasPermission(tx, request.staff.id, permission);
  }

  private async row(tx: IngestionTx, id: string) {
    const row = await tx.ingestionRow.findUnique({
      where: { id },
      include: {
        run: { include: { source: { include: { supplier: true } } } },
        decisions: true,
        application: true,
      },
    });
    if (!row) throw new StaffError('NOT_FOUND');
    return row;
  }

  private eligibility(row: Awaited<ReturnType<SupplierCreateService['row']>>) {
    if (row.application) return 'ALREADY_APPLIED';
    if (
      row.errorCode ||
      !row.normalized ||
      !['COMPLETE', 'PARTIAL'].includes(row.run.state)
    )
      return 'INVALID_CANDIDATE';
    if (row.run.source.state !== 'ENABLED') return 'SOURCE_DISABLED';
    if (row.run.source.version !== row.run.sourceVersion)
      return 'SOURCE_CHANGED';
    if (row.run.source.supplier.state !== 'ACTIVE') return 'SUPPLIER_INACTIVE';
    return null;
  }

  async inspection(request: StaffRequest, id: string) {
    return this.ingestion.db.$transaction(async (tx) => {
      await this.authorize(tx, request, readPermissions);
      const result = await this.row(tx, id);
      const { run, decisions, application, ...row } = result;
      const snapshot: unknown = run.rawSnapshot
        ? JSON.parse(Buffer.from(run.rawSnapshot).toString('utf8'))
        : null;
      const original = Array.isArray(snapshot)
        ? record(snapshot[row.rowNumber - 1])
        : null;
      const sourceBrand = fact(record(row.normalized).source_brand_text);
      const brands = sourceBrand
        ? await tx.brand.findMany({
            where: { state: 'ACTIVE', name: sourceBrand },
            select: { id: true, name: true },
            orderBy: { id: 'asc' },
            take: 2,
          })
        : [];
      return {
        data: {
          row,
          original,
          supplierId: run.source.supplierId,
          decisionEligible:
            this.enabled &&
            !application &&
            this.eligibility(result) === null &&
            row.reviewState === 'PENDING',
          decisionId:
            decisions.find((item) => item.decision === 'ACCEPT')?.id ?? null,
          brands: brands.length === 1 ? brands : [],
        },
      };
    });
  }

  async provenance(request: StaffRequest, id: string) {
    return this.ingestion.db.$transaction(async (tx) => {
      await this.authorize(tx, request, readPermissions);
      const row = await tx.ingestionRow.findUnique({
        where: { id },
        select: { application: true },
      });
      if (!row) throw new StaffError('NOT_FOUND');
      return { data: row.application };
    });
  }

  private async evaluate(
    tx: IngestionTx,
    id: string,
    input: IngestionCreatePreviewInput,
  ) {
    const row = await this.row(tx, id);
    const source = row.run.source;
    const normalized = record(row.normalized);
    const brand = await tx.brand.findUnique({
      where: { id: input.brandId },
      select: { id: true, state: true, name: true },
    });
    const sourceBrandText = fact(normalized.source_brand_text);
    const brandMatches = sourceBrandText
      ? await tx.brand.count({
          where: { state: 'ACTIVE', name: sourceBrandText },
        })
      : 0;
    const manufacturerName = fact(normalized.manufacturer_name);
    const originalPartNumber = fact(normalized.original_part_number);
    const modification = fact(normalized.modification);
    // Current adapters may attest SPECIFIED, but never turn UNKNOWN into CONFIRMED_NONE.
    const identity =
      brandMatches === 1 &&
      brand?.state === 'ACTIVE' &&
      sourceBrandText === brand.name &&
      manufacturerName &&
      originalPartNumber &&
      modification &&
      row.modificationEvidence === 'SPECIFIED'
        ? {
            brandId: brand.id,
            brandName: brand.name,
            manufacturerName,
            originalPartNumber,
            modification,
            modificationEvidence: ModificationEvidence.SPECIFIED,
          }
        : null;
    let blockedReason = this.eligibility(row);
    if (input.expectedRowVersion !== row.version)
      throw new StaffError('VERSION_CONFLICT');
    if (
      !blockedReason &&
      (row.reviewState !== 'ACCEPTED' ||
        row.decisions[0]?.decision !== 'ACCEPT' ||
        row.decisions[0].id !== input.decisionId)
    )
      blockedReason = 'NOT_ACCEPTED';
    if (!blockedReason && source.supplierId !== input.supplierId)
      blockedReason = 'SUPPLIER_MISMATCH';
    if (!blockedReason && !identity) blockedReason = 'INCOMPLETE_IDENTITY';
    const supplierPartNumber = fact(normalized.supplier_part_number);
    let duplicates: {
      offerId: string;
      version: number;
      revisionId: string;
      state: string;
    }[] = [];
    const archivedExactIds: string[] = [];
    if (!blockedReason && identity) {
      // Limit output/work after filtering by indexed supplier and exact identifying fields.
      const candidates = await tx.supplierOffer.findMany({
        where: {
          supplierId: source.supplierId,
          currentRevision: {
            OR: [
              { manufacturerName, originalPartNumber },
              ...(supplierPartNumber ? [{ supplierPartNumber }] : []),
            ],
          },
        },
        include: { currentRevision: true },
        orderBy: { id: 'asc' },
        take: duplicateLimit + 1,
      });
      if (candidates.length > duplicateLimit) blockedReason = 'NEEDS_REVIEW';
      for (const candidate of candidates.slice(0, duplicateLimit)) {
        const rev = candidate.currentRevision;
        const exact =
          rev.brandId === identity.brandId &&
          rev.manufacturerName === identity.manufacturerName &&
          rev.originalPartNumber === identity.originalPartNumber &&
          rev.modificationEvidence === identity.modificationEvidence &&
          rev.modification === identity.modification;
        if (candidate.state === 'ARCHIVED' && exact)
          archivedExactIds.push(candidate.id);
        if (candidate.state === 'ACTIVE' && exact)
          blockedReason = 'ACTIVE_DUPLICATE';
        else if (
          candidate.state === 'ACTIVE' &&
          blockedReason !== 'ACTIVE_DUPLICATE'
        ) {
          // A complete, consistently identified different variant is not ambiguous.
          const sameManufacturerPart =
            rev.manufacturerName === manufacturerName &&
            rev.originalPartNumber === originalPartNumber;
          const clearlyDifferentVariant =
            sameManufacturerPart &&
            rev.brandId === identity.brandId &&
            (rev.modificationEvidence === 'CONFIRMED_NONE' ||
              (rev.modificationEvidence === 'SPECIFIED' &&
                rev.modification !== null &&
                rev.modification !== modification)) &&
            (!supplierPartNumber ||
              rev.supplierPartNumber !== supplierPartNumber);
          if (!clearlyDifferentVariant) blockedReason = 'NEEDS_REVIEW';
        }
      }
      duplicates = candidates
        .slice(0, duplicateLimit)
        .filter(
          (item) =>
            item.state !== 'ARCHIVED' || archivedExactIds.includes(item.id),
        )
        .map((item) => ({
          offerId: item.id,
          version: item.version,
          revisionId: item.currentRevisionId,
          state: item.state,
        }));
    }
    return {
      row,
      source,
      normalized,
      identity,
      supplierPartNumber,
      blockedReason,
      duplicates,
      archivedExactIds,
    };
  }

  private signature(
    timestamp: string,
    request: StaffRequest,
    context: Awaited<ReturnType<SupplierCreateService['evaluate']>>,
    input: IngestionCreatePreviewInput,
  ) {
    return createHmac('sha256', this.tokenKey)
      .update(
        JSON.stringify([
          'stdu-create-preview-v1',
          timestamp,
          request.staff!.id,
          request.staff!.sessionId,
          context.row.id,
          context.row.version,
          context.row.sourceHash,
          context.row.runId,
          context.source.id,
          context.source.version,
          input.supplierId,
          input.decisionId,
          context.identity,
          context.duplicates,
        ]),
      )
      .digest();
  }

  private assertEnabled() {
    if (!this.enabled) throw new StaffError('FORBIDDEN');
  }

  async preview(
    request: StaffRequest,
    id: string,
    input: IngestionCreatePreviewInput,
  ) {
    return this.ingestion.db.$transaction(async (tx) => {
      await this.authorize(tx, request, createPermissions);
      this.assertEnabled();
      const context = await this.evaluate(tx, id, input);
      const timestamp = Date.now().toString();
      return {
        data: {
          eligible: context.blockedReason === null,
          blockedReason: context.blockedReason,
          previewToken:
            context.blockedReason === null
              ? timestamp +
                '.' +
                this.signature(timestamp, request, context, input).toString(
                  'hex',
                )
              : null,
          identity: context.identity,
          duplicates: context.duplicates,
          supplierId: context.source.supplierId,
        },
      };
    });
  }

  async create(
    request: StaffRequest,
    key: string | undefined,
    id: string,
    input: IngestionCreateInput,
  ) {
    this.assertEnabled();
    return this.ingestion.command(
      request,
      key,
      'createOffer',
      'ingestion.read',
      id,
      input,
      async (tx) => {
        const rowRef = await tx.ingestionRow.findUnique({
          where: { id },
          select: {
            run: {
              select: {
                sourceId: true,
                source: { select: { supplierId: true } },
              },
            },
          },
        });
        if (!rowRef) throw new StaffError('NOT_FOUND');
        if (rowRef.run.source.supplierId !== input.supplierId)
          throw new StaffError('INVALID_STATE_TRANSITION');
        await tx.$queryRaw`SELECT id FROM ingestion_source WHERE id=${rowRef.run.sourceId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM supplier WHERE id=${input.supplierId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM ingestion_row WHERE id=${id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM brand WHERE id=${input.brandId}::uuid FOR UPDATE`;
        const previewState = await this.evaluate(tx, id, input);
        // Legacy offer archive locks the offer without taking the supplier lock.
        for (const { offerId } of previewState.duplicates)
          await tx.$queryRaw`SELECT id FROM supplier_offer WHERE id=${offerId}::uuid FOR SHARE`;
        const context = await this.evaluate(tx, id, input);
        const [timestamp, mac] = input.previewToken.split('.');
        const time = Number(timestamp);
        const now = Date.now();
        if (
          !timestamp ||
          !mac ||
          !Number.isSafeInteger(time) ||
          time > now ||
          now - time > previewLifetimeMs ||
          !timingSafeEqual(
            Buffer.from(mac, 'hex'),
            this.signature(timestamp, request, context, input),
          )
        )
          throw new StaffError('VERSION_CONFLICT');
        if (context.blockedReason || !context.identity)
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (
          JSON.stringify([...input.acknowledgedDuplicateIds].sort()) !==
          JSON.stringify([...context.archivedExactIds].sort())
        )
          throw new StaffError('INVALID_STATE_TRANSITION');
        const n = context.normalized;
        const { identity } = context;
        const actorId = request.staff!.id;
        const result = await this.suppliers.createSupplierOfferInTransaction(
          tx,
          request,
          actorId,
          {
            supplierId: input.supplierId,
            brandId: identity.brandId,
            manufacturerName: identity.manufacturerName,
            originalPartNumber: identity.originalPartNumber,
            modification: identity.modification,
            modificationEvidence: identity.modificationEvidence,
            supplierPartNumber: context.supplierPartNumber,
            sourceBrandText: fact(n.source_brand_text),
            offerName: fact(n.offer_name),
            purchaseCost: fact(n.purchase_cost),
            currency: fact(n.currency),
            sourceVatText: fact(n.source_vat_text),
            availabilityText: fact(n.availability_text),
            leadTimeText: fact(n.lead_time_text),
            sourceObservedAt: fact(n.source_observed_at),
            sourceUrl: fact(n.source_url),
            expiresAt: null,
          },
        );
        const created = result.data.data as {
          id: string;
          revisionId: string;
          version: number;
        };
        const application = await tx.ingestionApplication.create({
          data: {
            id: randomUUID(),
            operation: 'CREATE',
            sourceId: context.source.id,
            runId: context.row.runId,
            rowId: id,
            decisionId: input.decisionId,
            actorId,
            offerId: created.id,
            revisionId: created.revisionId,
            baseRevisionId: null,
            version: created.version,
            sourceHash: context.row.sourceHash,
          },
        });
        return { status: 201, data: application };
      },
      createPermissions,
    );
  }
}
