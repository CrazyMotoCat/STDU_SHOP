import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { Prisma as PrismaRuntime } from '../generated/prisma/client.js';
import { createAuditEvent } from '../audit/audit.service.js';
import { DATABASE, PrismaDatabase } from '../database/database.module.js';
import { StaffError } from '../identity/errors.js';
import type { StaffRequest } from '../identity/request.js';
import {
  assertCurrentActor,
  assertHasPermission,
} from '../permissions/policy.js';
import { isIso3166Alpha2, isIso4217Currency } from './iso-codes.js';
import type {
  ArchiveSupplierDto,
  CreateMatchProposalDto,
  CreateSupplierDto,
  CreateSupplierOfferDto,
  DecideMatchProposalDto,
  OfferListQueryDto,
  ProposalListQueryDto,
  ReviseSupplierOfferDto,
  SupplierListQueryDto,
  UnlinkMatchDto,
  UpdateSupplierDto,
} from './suppliers.dto.js';

type Tx = Prisma.TransactionClient;
type MutationResult = { status: number; body: Record<string, unknown> };
type Cursor = { v: 1; fingerprint: string; [key: string]: unknown };
type IdentityEvidence = 'SPECIFIED' | 'CONFIRMED_NONE' | 'UNKNOWN';
type MatchTuple = {
  brandId: string | null;
  manufacturerName: string | null;
  originalPartNumber: string | null;
  modification: string | null;
};

const ALLOWED_PROFILE_FIELDS = [
  'legalName',
  'shortName',
  'taxIdentifier',
  'taxJurisdiction',
  'contactName',
  'email',
  'phone',
  'website',
  'internalNotes',
] as const;
const ALLOWED_OFFER_FIELDS = [
  'supplierPartNumber',
  'offerName',
  'sourceBrandText',
  'brandId',
  'manufacturerName',
  'originalPartNumber',
  'modification',
  'modificationEvidence',
  'purchaseCost',
  'currency',
  'sourceVatText',
  'availabilityText',
  'leadTimeText',
  'sourceObservedAt',
  'expiresAt',
  'sourceUrl',
] as const;

const MUTATION_PERMISSIONS: Record<string, readonly string[]> = {
  createSupplier: ['suppliers.write'],
  updateSupplier: ['suppliers.write'],
  archiveSupplier: ['suppliers.write'],
  createSupplierOffer: ['suppliers.offers.write'],
  reviseSupplierOffer: ['suppliers.offers.write'],
  archiveSupplierOffer: ['suppliers.offers.write'],
  createSupplierMatchProposal: [
    'suppliers.matches.decide',
    'suppliers.offers.read',
    'suppliers.read',
    'catalog.products.read',
    'catalog.references.read',
  ],
  decideSupplierMatchProposal: [
    'suppliers.matches.decide',
    'suppliers.offers.read',
    'suppliers.read',
    'catalog.products.read',
    'catalog.references.read',
  ],
  unlinkSupplierOfferMatch: [
    'suppliers.matches.decide',
    'suppliers.offers.read',
    'suppliers.read',
    'catalog.products.read',
    'catalog.references.read',
  ],
};
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = /^(?:[1-9][0-9]*(?:\.[0-9]*[1-9])?|0\.[0-9]*[1-9])$/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value))
      throw new StaffError('VALIDATION_ERROR');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new StaffError('VALIDATION_ERROR');
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function encodeCursor(value: Cursor) {
  return Buffer.from(canonicalJson(value), 'utf8').toString('base64url');
}

function decodeCursor<T extends Cursor>(
  value: string | undefined,
  fingerprint: string,
): T | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value))
    throw new StaffError('VALIDATION_ERROR');
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as T;
    if (decoded.v !== 1 || decoded.fingerprint !== fingerprint)
      throw new StaffError('VALIDATION_ERROR');
    return decoded;
  } catch (error) {
    if (error instanceof StaffError) throw error;
    throw new StaffError('VALIDATION_ERROR');
  }
}

function fingerprint(value: unknown) {
  return sha256(canonicalJson(value)).toString('base64url');
}

function cursorId(value: Cursor | null) {
  const id = value?.id;
  if (typeof id !== 'string' || !UUID_V4.test(id))
    throw new StaffError('VALIDATION_ERROR');
  return id;
}

function text(value: string | null | undefined) {
  if (value == null) return value ?? null;
  return value.normalize('NFC').replace(/^ +| +$/g, '');
}

function requiredText(value: string, max: number) {
  const normalized = text(value) ?? '';
  if (!normalized || normalized.length > max)
    throw new StaffError('VALIDATION_ERROR');
  return normalized;
}

function supplierProfile(value: {
  legalName: string;
  shortName?: string | null;
  taxIdentifier?: string | null;
  taxJurisdiction?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  internalNotes?: string | null;
}) {
  const jurisdiction = value.taxJurisdiction ?? null;
  let identifier = value.taxIdentifier ?? null;
  if ((jurisdiction === null) !== (identifier === null))
    throw new StaffError('VALIDATION_ERROR');
  if (jurisdiction !== null && !isIso3166Alpha2(jurisdiction))
    throw new StaffError('VALIDATION_ERROR');
  if (identifier !== null) {
    if (jurisdiction === 'RU') {
      if (!validRussianInn(identifier))
        throw new StaffError('VALIDATION_ERROR');
    } else {
      identifier = identifier.normalize('NFC').replace(/^ +| +$/g, '');
      if (!identifier || identifier.length > 64)
        throw new StaffError('VALIDATION_ERROR');
    }
  }
  const optional = <T extends string | null | undefined>(
    item: T,
    max: number,
  ) => {
    if (item == null) return null;
    const normalized = text(item);
    if (normalized === null || normalized === '' || normalized.length > max)
      throw new StaffError('VALIDATION_ERROR');
    return normalized;
  };
  return {
    legalName: requiredText(value.legalName, 240),
    shortName: optional(value.shortName, 160),
    taxIdentifier: identifier,
    taxJurisdiction: jurisdiction,
    contactName: optional(value.contactName, 160),
    email: optional(value.email, 254),
    phone: optional(value.phone, 64),
    website: optional(value.website, 2048),
    internalNotes: optional(value.internalNotes, 4000),
  };
}

function validRussianInn(value: string) {
  if (!/^(?:[0-9]{10}|[0-9]{12})$/.test(value)) return false;
  const digits = [...value].map(Number);
  const control = (items: number[], weights: number[]) =>
    (items.reduce((sum, digit, index) => sum + digit * weights[index]!, 0) %
      11) %
    10;
  if (digits.length === 10)
    return (
      control(digits.slice(0, 9), [2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[9]
    );
  return (
    control(digits.slice(0, 10), [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) ===
      digits[10] &&
    control(digits.slice(0, 11), [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) ===
      digits[11]
  );
}

function canonicalDecimal(value: { toFixed(): string } | string | null) {
  if (value === null) return null;
  const fixed = typeof value === 'string' ? value : value.toFixed();
  return fixed.includes('.')
    ? fixed.replace(/0+$/, '').replace(/\.$/, '')
    : fixed;
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeSupplier(row: Record<string, unknown>) {
  return {
    id: row.id,
    legalName: row.legalName,
    shortName: row.shortName,
    taxIdentifier: row.taxIdentifier,
    taxJurisdiction: row.taxJurisdiction,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    website: row.website,
    internalNotes: row.internalNotes,
    state: row.state,
    version: row.version,
    currentRevisionId: row.currentRevisionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function supplierRevision(row: Record<string, unknown>) {
  return {
    id: row.id,
    supplierId: row.supplierId,
    revisionNo: row.revisionNo,
    legalName: row.legalName,
    shortName: row.shortName,
    taxIdentifier: row.taxIdentifier,
    taxJurisdiction: row.taxJurisdiction,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    website: row.website,
    internalNotes: row.internalNotes,
    recordedAt: row.recordedAt,
    recordedByStaffUserId: row.recordedByStaffUserId,
  };
}

function offerRevision(row: Record<string, unknown>) {
  return {
    id: row.id,
    revisionNo: row.revisionNo,
    supplierPartNumber: row.supplierPartNumber,
    offerName: row.offerName,
    sourceBrandText: row.sourceBrandText,
    brandId: row.brandId,
    manufacturerName: row.manufacturerName,
    originalPartNumber: row.originalPartNumber,
    modification: row.modification,
    modificationEvidence: row.modificationEvidence,
    purchaseCost: canonicalDecimal(
      row.purchaseCost as { toFixed(): string } | string | null,
    ),
    currency: row.currency,
    sourceVatText: row.sourceVatText,
    availabilityText: row.availabilityText,
    leadTimeText: row.leadTimeText,
    sourceObservedAt: row.sourceObservedAt,
    expiresAt: row.expiresAt,
    sourceUrl: row.sourceUrl,
    origin: row.origin,
    recordedAt: row.recordedAt,
    recordedByStaffUserId: row.recordedByStaffUserId,
  };
}

function matchTuple(value: {
  brandId: string | null;
  manufacturerName: string | null;
  originalPartNumber: string | null;
  modification: string | null;
}): MatchTuple {
  return {
    brandId: value.brandId,
    manufacturerName:
      value.manufacturerName === null ? null : text(value.manufacturerName),
    originalPartNumber:
      value.originalPartNumber === null ? null : text(value.originalPartNumber),
    modification: value.modification === null ? null : text(value.modification),
  };
}

function exactIdentity(a: MatchTuple, b: MatchTuple) {
  return (
    a.brandId === b.brandId &&
    a.manufacturerName === b.manufacturerName &&
    a.originalPartNumber === b.originalPartNumber &&
    a.modification === b.modification &&
    a.brandId !== null &&
    a.manufacturerName !== null &&
    a.manufacturerName !== '' &&
    a.originalPartNumber !== null &&
    a.originalPartNumber !== ''
  );
}

function isMatchableOfferRevision(value: {
  brandId: string | null;
  manufacturerName: string | null;
  originalPartNumber: string | null;
  modification: string | null;
  modificationEvidence: string;
}) {
  const tuple = matchTuple(value);
  return (
    value.modificationEvidence !== 'UNKNOWN' &&
    (value.modificationEvidence !== 'SPECIFIED' ||
      value.modification !== null) &&
    (value.modificationEvidence !== 'CONFIRMED_NONE' ||
      value.modification === null) &&
    tuple.brandId !== null &&
    tuple.manufacturerName !== null &&
    tuple.manufacturerName !== '' &&
    tuple.originalPartNumber !== null &&
    tuple.originalPartNumber !== ''
  );
}

function configuredFreshnessDays() {
  const raw = process.env.SUPPLIER_OFFER_FRESHNESS_DAYS;
  if (!raw || !/^[1-9][0-9]{0,4}$/.test(raw)) return null;
  const days = Number(raw);
  return days <= 36500 ? days : null;
}

function effectiveMatchStatus(
  offer: {
    state: string;
    supplier: { state: string };
    currentMatchProposalId: string | null;
    currentRevision: {
      id: string;
      brandId: string | null;
      manufacturerName: string | null;
      originalPartNumber: string | null;
      modification: string | null;
      modificationEvidence: string;
    };
  },
  proposal: {
    id: string;
    state: string;
    offerRevisionId: string;
    offerIdentitySnapshot: Prisma.JsonValue;
    productIdentitySnapshot: Prisma.JsonValue;
    proposedProduct: {
      brandId: string | null;
      manufacturerName: string | null;
      originalPartNumber: string | null;
      modification: string | null;
      publicationState: string;
      brand: { state: string } | null;
    };
  } | null,
) {
  if (!offer.currentMatchProposalId || !proposal) return 'UNMATCHED';
  if (
    proposal.id !== offer.currentMatchProposalId ||
    proposal.state !== 'APPROVED' ||
    offer.state !== 'ACTIVE' ||
    offer.supplier.state !== 'ACTIVE'
  )
    return 'REVIEW_REQUIRED';
  const expectedOffer = jsonObject(proposal.offerIdentitySnapshot);
  const expectedProduct = jsonObject(proposal.productIdentitySnapshot);
  const currentOffer = matchTuple(offer.currentRevision);
  const currentProduct = matchTuple(proposal.proposedProduct);
  const savedOffer = matchTuple(expectedOffer as unknown as MatchTuple);
  const savedProduct = matchTuple(expectedProduct as unknown as MatchTuple);
  const evidence = offer.currentRevision
    .modificationEvidence as IdentityEvidence;
  if (
    proposal.offerRevisionId !== offer.currentRevision.id ||
    evidence === 'UNKNOWN' ||
    !exactIdentity(currentOffer, currentProduct) ||
    canonicalJson(currentOffer) !== canonicalJson(savedOffer) ||
    canonicalJson(currentProduct) !== canonicalJson(savedProduct) ||
    proposal.proposedProduct.publicationState === 'ARCHIVED' ||
    proposal.proposedProduct.brand?.state !== 'ACTIVE'
  )
    return 'REVIEW_REQUIRED';
  return 'CURRENT';
}

function freshness(
  row: {
    expiresAt: Date | null;
    sourceObservedAt: Date | null;
    recordedAt: Date;
  },
  now = new Date(),
) {
  if (row.expiresAt) return row.expiresAt <= now ? 'STALE' : 'CURRENT';
  const days = configuredFreshnessDays();
  if (days === null) return 'UNKNOWN';
  const reference = row.sourceObservedAt ?? row.recordedAt;
  return reference.getTime() + days * 86400000 <= now.getTime()
    ? 'STALE'
    : 'CURRENT';
}

function offerView(row: {
  id: string;
  supplierId: string;
  state: string;
  version: number;
  currentMatchProposalId: string | null;
  supplier: { legalName: string; state: string };
  currentRevision: Record<string, unknown>;
  currentMatchProposal?: {
    id: string;
    state: string;
    offerRevisionId: string;
    proposedProductId: string;
    offerIdentitySnapshot: Prisma.JsonValue;
    productIdentitySnapshot: Prisma.JsonValue;
    proposedProduct: {
      brandId: string | null;
      manufacturerName: string | null;
      originalPartNumber: string | null;
      modification: string | null;
      publicationState: string;
      brand: { state: string } | null;
    };
  } | null;
}) {
  const proposal = row.currentMatchProposal ?? null;
  const status = effectiveMatchStatus(
    {
      state: row.state,
      supplier: row.supplier,
      currentMatchProposalId: row.currentMatchProposalId,
      currentRevision: row.currentRevision as never,
    },
    proposal,
  );
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierName: row.supplier.legalName,
    catalogProductId: proposal?.proposedProductId ?? null,
    state: row.state,
    version: row.version,
    currentMatchProposalId: row.currentMatchProposalId,
    currentRevision: offerRevision(row.currentRevision),
    freshness: freshness(row.currentRevision as never),
    matchStatus: status,
  };
}

function resultEnvelope(
  data: unknown,
  requestId: string,
  limit?: number,
  nextCursor?: string | null,
) {
  return {
    data,
    meta: {
      requestId,
      ...(limit === undefined ? {} : { limit }),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    },
  };
}

function errorBody(error: StaffError, requestId: string) {
  return {
    code: error.code,
    message: error.message,
    requestId,
    ...(error.fields?.length ? { fields: error.fields } : {}),
  };
}

function asJsonObject(value: Record<string, unknown>) {
  return value as Prisma.InputJsonObject;
}

function safeString(
  value: string | null | undefined,
  max: number,
  optional = true,
) {
  if (value == null) return null;
  const normalized = text(value) ?? '';
  if ((!optional && !normalized) || normalized.length > max)
    throw new StaffError('VALIDATION_ERROR');
  return normalized || null;
}

function offerInput(value: CreateSupplierOfferDto | ReviseSupplierOfferDto) {
  if (
    !Object.prototype.hasOwnProperty.call(value, 'brandId') ||
    !Object.prototype.hasOwnProperty.call(value, 'manufacturerName') ||
    !Object.prototype.hasOwnProperty.call(value, 'originalPartNumber') ||
    !Object.prototype.hasOwnProperty.call(value, 'modification') ||
    !Object.prototype.hasOwnProperty.call(value, 'modificationEvidence')
  )
    throw new StaffError('VALIDATION_ERROR');
  const evidence = value.modificationEvidence;
  const manufacturerName = safeString(value.manufacturerName, 200);
  const originalPartNumber = safeString(value.originalPartNumber, 160);
  const modification = safeString(value.modification, 160);
  if (evidence === 'SPECIFIED' ? !modification : modification !== null)
    throw new StaffError('VALIDATION_ERROR');
  const purchaseCost = value.purchaseCost ?? null;
  const currency = value.currency ?? null;
  if (purchaseCost !== null && (!MONEY.test(purchaseCost) || currency === null))
    throw new StaffError('VALIDATION_ERROR');
  if (currency !== null && !isIso4217Currency(currency))
    throw new StaffError('VALIDATION_ERROR');
  return {
    supplierPartNumber: safeString(value.supplierPartNumber, 160),
    offerName: safeString(value.offerName, 240),
    sourceBrandText: safeString(value.sourceBrandText, 160),
    brandId: value.brandId,
    manufacturerName,
    originalPartNumber,
    modification,
    modificationEvidence: evidence,
    purchaseCost,
    currency,
    sourceVatText: safeString(value.sourceVatText, 160),
    availabilityText: safeString(value.availabilityText, 500),
    leadTimeText: safeString(value.leadTimeText, 160),
    sourceObservedAt: value.sourceObservedAt
      ? new Date(value.sourceObservedAt)
      : null,
    expiresAt: value.expiresAt ? new Date(value.expiresAt) : null,
    sourceUrl: value.sourceUrl ?? null,
    origin: 'MANUAL',
  };
}

@Injectable()
export class SuppliersService {
  constructor(@Inject(DATABASE) private readonly db: PrismaDatabase) {}

  private require(request: StaffRequest, ...codes: string[]) {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    for (const code of codes)
      if (!request.staff.permissionCodes.includes(code))
        throw new StaffError('FORBIDDEN');
    return request.staff;
  }

  private async lock(
    tx: Tx,
    table:
      | 'supplier'
      | 'supplier_offer'
      | 'product_match_proposal'
      | 'catalog_product'
      | 'brand',
    id: string,
  ) {
    if (table === 'supplier')
      await tx.$queryRaw`SELECT id FROM supplier WHERE id = ${id}::uuid FOR UPDATE`;
    else if (table === 'supplier_offer')
      await tx.$queryRaw`SELECT id FROM supplier_offer WHERE id = ${id}::uuid FOR UPDATE`;
    else if (table === 'product_match_proposal')
      await tx.$queryRaw`SELECT id FROM product_match_proposal WHERE id = ${id}::uuid FOR UPDATE`;
    else if (table === 'catalog_product')
      await tx.$queryRaw`SELECT id FROM catalog_product WHERE id = ${id}::uuid FOR UPDATE`;
    else
      await tx.$queryRaw`SELECT id FROM brand WHERE id = ${id}::uuid FOR SHARE`;
  }

  private async assertTaxIdentityAvailable(
    tx: Tx,
    profile: ReturnType<typeof supplierProfile>,
    exceptId?: string,
  ) {
    if (profile.taxIdentifier === null || profile.taxJurisdiction === null)
      return;
    const lockName = `${profile.taxJurisdiction}\0${profile.taxIdentifier}`;
    const lock = createHash('sha256')
      .update(lockName)
      .digest()
      .readBigInt64BE(0);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock})::text AS "lockAcquired"`;
    const duplicate = await tx.supplier.findFirst({
      where: {
        state: 'ACTIVE',
        taxIdentifier: profile.taxIdentifier,
        taxJurisdiction: profile.taxJurisdiction,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new StaffError('SUPPLIER_IDENTITY_CONFLICT');
  }

  private async mutate(
    request: StaffRequest,
    header: string | undefined,
    operationId: string,
    method: string,
    path: string,
    dto: unknown,
    work: (
      tx: Tx,
      actorId: string,
    ) => Promise<{ status: number; data: unknown }>,
  ): Promise<MutationResult> {
    const requiredPermissions = MUTATION_PERMISSIONS[operationId];
    if (!requiredPermissions)
      throw new Error(
        `Supplier mutation permission policy missing: ${operationId}`,
      );
    const actor = this.require(request, ...requiredPermissions);
    if (!header || header.length < 8 || header.length > 128)
      throw new StaffError('VALIDATION_ERROR');
    const canonical = canonicalJson({
      apiVersion: '1.0.0',
      operationId,
      method,
      path,
      actorId: actor.id,
      dto,
    });
    const digest = sha256(canonical);
    const lock = createHash('sha256')
      .update(`${actor.id}\0R1-007\0${header}`, 'utf8')
      .digest()
      .readBigInt64BE(0);
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock})::text AS "lockAcquired"`;
        await assertCurrentActor(
          tx,
          {
            id: actor.id,
            sessionId: actor.sessionId,
            authVersion: actor.authVersion,
          },
          requiredPermissions[0] ?? null,
        );
        for (const permission of requiredPermissions.slice(1))
          await assertHasPermission(tx, actor.id, permission);
        const key = {
          actorStaffUserId_scope_idempotencyKey: {
            actorStaffUserId: actor.id,
            scope: 'R1-007',
            idempotencyKey: header,
          },
        };
        const prior = await tx.supplierCommandIdempotency.findUnique({
          where: key,
        });
        if (prior) {
          if (!Buffer.from(prior.requestHash).equals(digest))
            throw new StaffError('IDEMPOTENCY_KEY_REUSED');
          return {
            status: prior.responseStatus,
            body: prior.responseBody as Record<string, unknown>,
          };
        }
        let status: number;
        let body: Record<string, unknown>;
        try {
          const result = await work(tx, actor.id);
          status = result.status;
          body = result.data as Record<string, unknown>;
        } catch (error) {
          if (!(error instanceof StaffError) || error.getStatus() !== 409)
            throw error;
          status = 409;
          body = errorBody(error, request.requestId);
        }
        await tx.supplierCommandIdempotency.create({
          data: {
            id: randomUUID(),
            actorStaffUserId: actor.id,
            scope: 'R1-007',
            idempotencyKey: header,
            operationId,
            requestHash: new Uint8Array(digest),
            responseStatus: status,
            responseBody: asJsonObject(body),
          },
        });
        return { status, body };
      },
      { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 },
    );
  }

  private async audit(
    tx: Tx,
    request: StaffRequest,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    reasonCode: string | null,
    changes: Record<string, unknown>,
  ) {
    await createAuditEvent(tx, {
      actorKind: 'STAFF',
      actorUserId: actorId,
      action,
      entityType,
      entityId,
      outcome: 'SUCCESS',
      reasonCode,
      requestId: request.requestId,
      changes,
    });
  }

  async listSuppliers(request: StaffRequest, query: SupplierListQueryDto) {
    this.require(request, 'suppliers.read');
    const limit = query.limit ?? 50;
    const filters = { state: query.state ?? null };
    const cursor = decodeCursor<Cursor & { id: string }>(
      query.cursor,
      fingerprint(filters),
    );
    const rows = await this.db.supplier.findMany({
      where: query.state ? { state: query.state } : { state: 'ACTIVE' },
      ...(cursor
        ? {
            where: {
              ...(query.state ? { state: query.state } : { state: 'ACTIVE' }),
              id: { gt: cursorId(cursor) },
            },
          }
        : {}),
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const nextCursor =
      hasMore && page.length
        ? encodeCursor({
            v: 1,
            fingerprint: fingerprint(filters),
            id: page.at(-1)!.id,
          })
        : null;
    return resultEnvelope(
      page.map((row) => safeSupplier(row as never)),
      request.requestId,
      limit,
      nextCursor,
    );
  }

  async getSupplier(request: StaffRequest, supplierId: string) {
    this.require(request, 'suppliers.read');
    const row = await this.db.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!row) throw new StaffError('NOT_FOUND');
    return resultEnvelope(safeSupplier(row as never), request.requestId);
  }

  async listSupplierRevisions(
    request: StaffRequest,
    supplierId: string,
    query: SupplierListQueryDto,
  ) {
    this.require(request, 'suppliers.read');
    if (
      !(await this.db.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true },
      }))
    )
      throw new StaffError('NOT_FOUND');
    const limit = query.limit ?? 50;
    const filters = { supplierId };
    const cursor = decodeCursor<Cursor & { revisionNo: number }>(
      query.cursor,
      fingerprint(filters),
    );
    const rows = await this.db.supplierRevision.findMany({
      where: {
        supplierId,
        ...(cursor ? { revisionNo: { lt: cursor.revisionNo } } : {}),
      },
      orderBy: { revisionNo: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length
        ? encodeCursor({
            v: 1,
            fingerprint: fingerprint(filters),
            revisionNo: page.at(-1)!.revisionNo,
          })
        : null;
    return resultEnvelope(
      page.map((row) => supplierRevision(row as never)),
      request.requestId,
      limit,
      nextCursor,
    );
  }

  async createSupplier(
    request: StaffRequest,
    key: string | undefined,
    input: CreateSupplierDto,
  ) {
    const profile = supplierProfile(input);
    return this.mutate(
      request,
      key,
      'createSupplier',
      'POST',
      '/v1/staff/suppliers',
      profile,
      async (tx, actorId) => {
        await this.assertTaxIdentityAvailable(tx, profile);
        const id = randomUUID();
        const revisionId = randomUUID();
        await tx.supplier.create({
          data: {
            id,
            ...profile,
            state: 'ACTIVE',
            currentRevisionId: revisionId,
            version: 1,
            createdByStaffUserId: actorId,
            updatedByStaffUserId: actorId,
          },
        });
        await tx.supplierRevision.create({
          data: {
            id: revisionId,
            supplierId: id,
            revisionNo: 1,
            ...profile,
            recordedByStaffUserId: actorId,
          },
        });
        await this.audit(
          tx,
          request,
          actorId,
          'supplier.created',
          'Supplier',
          id,
          null,
          { supplierId: id, revisionId, actorId, version: 1 },
        );
        return {
          status: 201,
          data: resultEnvelope(
            { id, version: 1, revisionId },
            request.requestId,
          ),
        };
      },
    );
  }

  async updateSupplier(
    request: StaffRequest,
    key: string | undefined,
    supplierId: string,
    input: UpdateSupplierDto,
  ) {
    const { expectedVersion, ...changes } = input;
    const path = `/v1/staff/suppliers/${supplierId}`;
    return this.mutate(
      request,
      key,
      'updateSupplier',
      'PATCH',
      path,
      input,
      async (tx, actorId) => {
        await this.lock(tx, 'supplier', supplierId);
        const current = await tx.supplier.findUnique({
          where: { id: supplierId },
        });
        if (!current) throw new StaffError('NOT_FOUND');
        if (current.version !== expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (current.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const merged = supplierProfile({
          legalName: changes.legalName ?? current.legalName,
          shortName:
            changes.shortName === undefined
              ? current.shortName
              : changes.shortName,
          taxIdentifier:
            changes.taxIdentifier === undefined
              ? current.taxIdentifier
              : changes.taxIdentifier,
          taxJurisdiction:
            changes.taxJurisdiction === undefined
              ? current.taxJurisdiction
              : changes.taxJurisdiction,
          contactName:
            changes.contactName === undefined
              ? current.contactName
              : changes.contactName,
          email: changes.email === undefined ? current.email : changes.email,
          phone: changes.phone === undefined ? current.phone : changes.phone,
          website:
            changes.website === undefined ? current.website : changes.website,
          internalNotes:
            changes.internalNotes === undefined
              ? current.internalNotes
              : changes.internalNotes,
        });
        const changedFieldNames = ALLOWED_PROFILE_FIELDS.filter(
          (field) => merged[field] !== current[field],
        ).sort();
        if (!changedFieldNames.length)
          return {
            status: 200,
            data: resultEnvelope(
              {
                id: supplierId,
                version: current.version,
                revisionId: current.currentRevisionId,
              },
              request.requestId,
            ),
          };
        await this.assertTaxIdentityAvailable(tx, merged, supplierId);
        const revisionNo =
          (await tx.supplierRevision.count({ where: { supplierId } })) + 1;
        const revisionId = randomUUID();
        await tx.supplierRevision.create({
          data: {
            id: revisionId,
            supplierId,
            revisionNo,
            ...merged,
            recordedByStaffUserId: actorId,
          },
        });
        const version = current.version + 1;
        await tx.supplier.update({
          where: { id: supplierId },
          data: {
            ...merged,
            currentRevisionId: revisionId,
            version,
            updatedByStaffUserId: actorId,
          },
        });
        await this.audit(
          tx,
          request,
          actorId,
          'supplier.changed',
          'Supplier',
          supplierId,
          null,
          { supplierId, revisionId, actorId, version, changedFieldNames },
        );
        return {
          status: 200,
          data: resultEnvelope(
            { id: supplierId, version, revisionId },
            request.requestId,
          ),
        };
      },
    );
  }

  async archiveSupplier(
    request: StaffRequest,
    key: string | undefined,
    supplierId: string,
    input: ArchiveSupplierDto,
  ) {
    return this.mutate(
      request,
      key,
      'archiveSupplier',
      'POST',
      `/v1/staff/suppliers/${supplierId}/archive`,
      input,
      async (tx, actorId) => {
        await this.lock(tx, 'supplier', supplierId);
        const current = await tx.supplier.findUnique({
          where: { id: supplierId },
        });
        if (!current) throw new StaffError('NOT_FOUND');
        if (current.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (current.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const version = current.version + 1;
        await tx.supplier.update({
          where: { id: supplierId },
          data: {
            state: 'ARCHIVED',
            version,
            updatedByStaffUserId: actorId,
          },
        });
        await this.audit(
          tx,
          request,
          actorId,
          'supplier.archived',
          'Supplier',
          supplierId,
          input.reasonCode,
          { supplierId, actorId, version, reasonCode: input.reasonCode },
        );
        return {
          status: 200,
          data: resultEnvelope({ id: supplierId, version }, request.requestId),
        };
      },
    );
  }

  async listOffersForSupplier(
    request: StaffRequest,
    supplierId: string,
    query: SupplierListQueryDto,
  ) {
    this.require(request, 'suppliers.offers.read', 'suppliers.read');
    if (
      !(await this.db.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true },
      }))
    )
      throw new StaffError('NOT_FOUND');
    const limit = query.limit ?? 50;
    const filters = { supplierId };
    const cursor = decodeCursor<Cursor & { id: string }>(
      query.cursor,
      fingerprint(filters),
    );
    const rows = await this.db.supplierOffer.findMany({
      where: {
        supplierId,
        ...(cursor ? { id: { gt: cursorId(cursor) } } : {}),
      },
      include: {
        supplier: true,
        currentRevision: true,
        currentMatchProposal: {
          include: { proposedProduct: { include: { brand: true } } },
        },
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length
        ? encodeCursor({
            v: 1,
            fingerprint: fingerprint(filters),
            id: page.at(-1)!.id,
          })
        : null;
    return resultEnvelope(
      page.map((row) => offerView(row as never)),
      request.requestId,
      limit,
      nextCursor,
    );
  }

  async listSupplierOffers(request: StaffRequest, query: OfferListQueryDto) {
    this.require(request, 'suppliers.offers.read', 'suppliers.read');
    const filters = {
      supplierId: query.supplierId ?? null,
      catalogProductId: query.catalogProductId ?? null,
      state: query.state ?? 'ACTIVE',
      freshness: query.freshness ?? null,
      matchStatus: query.matchStatus ?? null,
      currency: query.currency ?? null,
      sortBy: query.sortBy ?? 'observedAt',
      sortDirection: query.sortDirection ?? 'DESC',
    };
    const cursor = decodeCursor<
      Cursor & {
        id: string;
        currencyNullRank?: number;
        currency?: string | null;
        costNullRank?: number;
        cost?: string | null;
        supplierName?: string;
        observedAt?: string;
      }
    >(query.cursor, fingerprint(filters));
    const rows = await this.offerPageIds(
      filters,
      cursor,
      (query.limit ?? 50) + 1,
    );
    const hasMore = rows.length > (query.limit ?? 50);
    const ids = rows.slice(0, query.limit ?? 50).map((row) => row.id);
    if (!ids.length)
      return resultEnvelope([], request.requestId, query.limit ?? 50, null);
    const loaded = await this.db.supplierOffer.findMany({
      where: { id: { in: ids } },
      include: {
        supplier: true,
        currentRevision: true,
        currentMatchProposal: {
          include: { proposedProduct: { include: { brand: true } } },
        },
      },
    });
    const byId = new Map(loaded.map((row) => [row.id, row]));
    const page = ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const lastSort = rows[ids.length - 1];
    const nextCursor =
      hasMore && lastSort
        ? encodeCursor({ v: 1, fingerprint: fingerprint(filters), ...lastSort })
        : null;
    return resultEnvelope(
      page.map((row) => offerView(row as never)),
      request.requestId,
      query.limit ?? 50,
      nextCursor,
    );
  }

  private async offerPageIds(
    filters: Record<string, string | null>,
    cursor:
      | (Cursor & {
          id: string;
          currencyNullRank?: number;
          currency?: string | null;
          costNullRank?: number;
          cost?: string | null;
          supplierName?: string;
          observedAt?: string;
        })
      | null,
    take: number,
  ) {
    const conditions: Prisma.Sql[] = [
      PrismaRuntime.sql`o.state = ${filters.state}`,
    ];
    if (filters.state === 'ACTIVE')
      conditions.push(PrismaRuntime.sql`s.state = 'ACTIVE'`);
    if (filters.supplierId)
      conditions.push(
        PrismaRuntime.sql`o.supplier_id = ${filters.supplierId}::uuid`,
      );
    if (filters.catalogProductId)
      conditions.push(
        PrismaRuntime.sql`p.proposed_product_id = ${filters.catalogProductId}::uuid`,
      );
    if (filters.currency)
      conditions.push(PrismaRuntime.sql`r.currency = ${filters.currency}`);
    const freshnessDays = configuredFreshnessDays();
    const freshnessSql = PrismaRuntime.sql`CASE
      WHEN r.expires_at IS NOT NULL AND r.expires_at <= clock_timestamp() THEN 'STALE'
      WHEN r.expires_at IS NOT NULL THEN 'CURRENT'
      WHEN ${freshnessDays}::integer IS NULL THEN 'UNKNOWN'
      WHEN COALESCE(r.source_observed_at,r.recorded_at) + make_interval(days => ${freshnessDays}::integer) <= clock_timestamp() THEN 'STALE'
      ELSE 'CURRENT' END`;
    if (filters.freshness)
      conditions.push(
        PrismaRuntime.sql`(${freshnessSql}) = ${filters.freshness}`,
      );
    const matchSql = PrismaRuntime.sql`CASE
      WHEN o.current_match_proposal_id IS NULL THEN 'UNMATCHED'
      WHEN p.state = 'APPROVED' AND s.state = 'ACTIVE' AND o.state = 'ACTIVE'
        AND cp.publication_state <> 'ARCHIVED' AND b.state = 'ACTIVE'
        AND o.current_revision_id = p.offer_revision_id
        AND r.brand_id::text = p.offer_identity_snapshot->>'brandId'
        AND r.manufacturer_name COLLATE "C" = (p.offer_identity_snapshot->>'manufacturerName') COLLATE "C"
        AND r.original_part_number COLLATE "C" = (p.offer_identity_snapshot->>'originalPartNumber') COLLATE "C"
        AND r.modification COLLATE "C" IS NOT DISTINCT FROM (p.offer_identity_snapshot->>'modification') COLLATE "C"
        AND cp.brand_id::text = p.product_identity_snapshot->>'brandId'
        AND cp.manufacturer_name COLLATE "C" = (p.product_identity_snapshot->>'manufacturerName') COLLATE "C"
        AND cp.original_part_number COLLATE "C" = (p.product_identity_snapshot->>'originalPartNumber') COLLATE "C"
        AND cp.modification COLLATE "C" IS NOT DISTINCT FROM (p.product_identity_snapshot->>'modification') COLLATE "C"
      THEN 'CURRENT' ELSE 'REVIEW_REQUIRED' END`;
    if (filters.matchStatus)
      conditions.push(
        PrismaRuntime.sql`(${matchSql}) = ${filters.matchStatus}`,
      );
    const order =
      filters.sortBy === 'purchaseCost'
        ? PrismaRuntime.sql`CASE WHEN r.currency IS NULL THEN 1 ELSE 0 END ASC,
          COALESCE(r.currency,'') COLLATE "C" ASC,
          CASE WHEN r.purchase_cost IS NULL THEN 1 ELSE 0 END ASC,
          r.purchase_cost ${filters.sortDirection === 'ASC' ? PrismaRuntime.raw('ASC') : PrismaRuntime.raw('DESC')},
          s.legal_name COLLATE "C" ASC, o.id ASC`
        : filters.sortBy === 'supplierName'
          ? PrismaRuntime.sql`s.legal_name COLLATE "C" ${filters.sortDirection === 'ASC' ? PrismaRuntime.raw('ASC') : PrismaRuntime.raw('DESC')}, o.id ASC`
          : PrismaRuntime.sql`COALESCE(r.source_observed_at,r.recorded_at) DESC, o.id ASC`;
    if (cursor) {
      if (
        filters.sortBy === 'purchaseCost' &&
        cursor.currencyNullRank !== undefined &&
        cursor.costNullRank !== undefined &&
        cursor.supplierName !== undefined
      ) {
        const costOp = filters.sortDirection === 'ASC' ? '>' : '<';
        conditions.push(PrismaRuntime.sql`(
          CASE WHEN r.currency IS NULL THEN 1 ELSE 0 END > ${cursor.currencyNullRank}
          OR (CASE WHEN r.currency IS NULL THEN 1 ELSE 0 END = ${cursor.currencyNullRank} AND COALESCE(r.currency,'') COLLATE "C" > COALESCE(${cursor.currency},'') COLLATE "C")
          OR (CASE WHEN r.currency IS NULL THEN 1 ELSE 0 END = ${cursor.currencyNullRank} AND COALESCE(r.currency,'') COLLATE "C" = COALESCE(${cursor.currency},'') COLLATE "C" AND CASE WHEN r.purchase_cost IS NULL THEN 1 ELSE 0 END > ${cursor.costNullRank})
          OR (CASE WHEN r.currency IS NULL THEN 1 ELSE 0 END = ${cursor.currencyNullRank} AND COALESCE(r.currency,'') COLLATE "C" = COALESCE(${cursor.currency},'') COLLATE "C" AND CASE WHEN r.purchase_cost IS NULL THEN 1 ELSE 0 END = ${cursor.costNullRank} AND COALESCE(r.purchase_cost,0::numeric) ${PrismaRuntime.raw(costOp)} COALESCE(${cursor.cost}::numeric,0::numeric))
          OR (CASE WHEN r.currency IS NULL THEN 1 ELSE 0 END = ${cursor.currencyNullRank} AND COALESCE(r.currency,'') COLLATE "C" = COALESCE(${cursor.currency},'') COLLATE "C" AND CASE WHEN r.purchase_cost IS NULL THEN 1 ELSE 0 END = ${cursor.costNullRank} AND COALESCE(r.purchase_cost,0::numeric) = COALESCE(${cursor.cost}::numeric,0::numeric) AND s.legal_name COLLATE "C" > ${cursor.supplierName} COLLATE "C")
          OR (CASE WHEN r.currency IS NULL THEN 1 ELSE 0 END = ${cursor.currencyNullRank} AND COALESCE(r.currency,'') COLLATE "C" = COALESCE(${cursor.currency},'') COLLATE "C" AND CASE WHEN r.purchase_cost IS NULL THEN 1 ELSE 0 END = ${cursor.costNullRank} AND COALESCE(r.purchase_cost,0::numeric) = COALESCE(${cursor.cost}::numeric,0::numeric) AND s.legal_name COLLATE "C" = ${cursor.supplierName} COLLATE "C" AND o.id > ${cursor.id}::uuid)
        )`);
      } else if (
        filters.sortBy === 'supplierName' &&
        cursor.supplierName !== undefined
      ) {
        const op = filters.sortDirection === 'ASC' ? '>' : '<';
        conditions.push(
          PrismaRuntime.sql`(s.legal_name COLLATE "C" ${PrismaRuntime.raw(op)} ${cursor.supplierName} COLLATE "C" OR (s.legal_name COLLATE "C" = ${cursor.supplierName} COLLATE "C" AND o.id > ${cursor.id}::uuid))`,
        );
      } else if (cursor.observedAt) {
        conditions.push(
          PrismaRuntime.sql`(COALESCE(r.source_observed_at,r.recorded_at) < ${new Date(cursor.observedAt)}::timestamptz OR (COALESCE(r.source_observed_at,r.recorded_at) = ${new Date(cursor.observedAt)}::timestamptz AND o.id > ${cursor.id}::uuid))`,
        );
      }
    }
    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        currency: string | null;
        purchaseCost: string | null;
        supplierName: string;
        observedAt: Date;
      }>
    >(PrismaRuntime.sql`
      SELECT o.id::text AS id, r.currency, r.purchase_cost::text AS "purchaseCost",
             s.legal_name AS "supplierName",
             COALESCE(r.source_observed_at,r.recorded_at) AS "observedAt"
      FROM supplier_offer o
      JOIN supplier s ON s.id = o.supplier_id
      JOIN supplier_offer_revision r ON r.id = o.current_revision_id AND r.offer_id = o.id
      LEFT JOIN product_match_proposal p ON p.id = o.current_match_proposal_id
      LEFT JOIN catalog_product cp ON cp.id = p.proposed_product_id
      LEFT JOIN brand b ON b.id = cp.brand_id
      WHERE ${PrismaRuntime.join(conditions, ' AND ')}
      ORDER BY ${order}
      LIMIT ${take}
    `);
    return rows.map((row) => {
      if (filters.sortBy === 'purchaseCost')
        return {
          id: row.id,
          currencyNullRank: row.currency === null ? 1 : 0,
          currency: row.currency,
          costNullRank: row.purchaseCost === null ? 1 : 0,
          cost: row.purchaseCost,
          supplierName: row.supplierName,
        };
      if (filters.sortBy === 'supplierName')
        return { id: row.id, supplierName: row.supplierName };
      return { id: row.id, observedAt: row.observedAt.toISOString() };
    });
  }

  async getSupplierOffer(request: StaffRequest, offerId: string) {
    this.require(request, 'suppliers.offers.read', 'suppliers.read');
    const row = await this.db.supplierOffer.findUnique({
      where: { id: offerId },
      include: {
        supplier: true,
        currentRevision: true,
        currentMatchProposal: {
          include: { proposedProduct: { include: { brand: true } } },
        },
      },
    });
    if (!row) throw new StaffError('NOT_FOUND');
    return resultEnvelope(offerView(row as never), request.requestId);
  }

  async createSupplierOffer(
    request: StaffRequest,
    key: string | undefined,
    input: CreateSupplierOfferDto,
  ) {
    const normalized = offerInput(input);
    return this.mutate(
      request,
      key,
      'createSupplierOffer',
      'POST',
      '/v1/staff/supplier-offers',
      input,
      async (tx, actorId) => {
        await this.lock(tx, 'supplier', input.supplierId);
        const supplier = await tx.supplier.findUnique({
          where: { id: input.supplierId },
        });
        if (!supplier || supplier.state !== 'ACTIVE')
          throw new StaffError('NOT_FOUND');
        await this.assertBrandActive(tx, normalized.brandId);
        const offerId = randomUUID();
        const revisionId = randomUUID();
        await tx.supplierOffer.create({
          data: {
            id: offerId,
            supplierId: input.supplierId,
            state: 'ACTIVE',
            currentRevisionId: revisionId,
            version: 1,
            createdByStaffUserId: actorId,
            updatedByStaffUserId: actorId,
          },
        });
        await tx.supplierOfferRevision.create({
          data: {
            id: revisionId,
            offerId,
            revisionNo: 1,
            ...normalized,
            recordedByStaffUserId: actorId,
          },
        });
        await this.audit(
          tx,
          request,
          actorId,
          'supplier_offer.created',
          'SupplierOffer',
          offerId,
          null,
          {
            supplierId: input.supplierId,
            offerId,
            revisionId,
            actorId,
            version: 1,
          },
        );
        return {
          status: 201,
          data: resultEnvelope(
            { id: offerId, version: 1, revisionId },
            request.requestId,
          ),
        };
      },
    );
  }

  async reviseSupplierOffer(
    request: StaffRequest,
    key: string | undefined,
    offerId: string,
    input: ReviseSupplierOfferDto,
  ) {
    const normalized = offerInput(input);
    return this.mutate(
      request,
      key,
      'reviseSupplierOffer',
      'PATCH',
      `/v1/staff/supplier-offers/${offerId}`,
      input,
      async (tx, actorId) => {
        const supplierRef = await tx.supplierOffer.findUnique({
          where: { id: offerId },
          select: { supplierId: true },
        });
        if (!supplierRef) throw new StaffError('NOT_FOUND');
        await this.lock(tx, 'supplier', supplierRef.supplierId);
        await this.lock(tx, 'supplier_offer', offerId);
        const current = await tx.supplierOffer.findUnique({
          where: { id: offerId },
          include: { supplier: true, currentRevision: true },
        });
        if (!current) throw new StaffError('NOT_FOUND');
        if (current.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (current.state !== 'ACTIVE' || current.supplier.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        await this.assertBrandActive(tx, normalized.brandId);
        const revisionNo =
          (await tx.supplierOfferRevision.count({ where: { offerId } })) + 1;
        const revisionId = randomUUID();
        await tx.supplierOfferRevision.create({
          data: {
            id: revisionId,
            offerId,
            revisionNo,
            ...normalized,
            recordedByStaffUserId: actorId,
          },
        });
        const version = current.version + 1;
        await tx.supplierOffer.update({
          where: { id: offerId },
          data: {
            currentRevisionId: revisionId,
            version,
            updatedByStaffUserId: actorId,
          },
        });
        await this.audit(
          tx,
          request,
          actorId,
          'supplier_offer.revised',
          'SupplierOffer',
          offerId,
          null,
          {
            supplierId: current.supplierId,
            offerId,
            revisionId,
            actorId,
            version,
            changedFieldNames: [...ALLOWED_OFFER_FIELDS].sort(),
          },
        );
        return {
          status: 200,
          data: resultEnvelope(
            { id: offerId, version, revisionId },
            request.requestId,
          ),
        };
      },
    );
  }

  private async assertBrandActive(tx: Tx, brandId: string | null) {
    if (!brandId) return;
    await this.lock(tx, 'brand', brandId);
    const brand = await tx.brand.findUnique({
      where: { id: brandId },
      select: { state: true },
    });
    if (!brand || brand.state !== 'ACTIVE') throw new StaffError('NOT_FOUND');
  }

  async archiveSupplierOffer(
    request: StaffRequest,
    key: string | undefined,
    offerId: string,
    input: ArchiveSupplierDto,
  ) {
    return this.mutate(
      request,
      key,
      'archiveSupplierOffer',
      'POST',
      `/v1/staff/supplier-offers/${offerId}/archive`,
      input,
      async (tx, actorId) => {
        await this.lock(tx, 'supplier_offer', offerId);
        const current = await tx.supplierOffer.findUnique({
          where: { id: offerId },
        });
        if (!current) throw new StaffError('NOT_FOUND');
        if (current.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (current.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const version = current.version + 1;
        await tx.supplierOffer.update({
          where: { id: offerId },
          data: {
            state: 'ARCHIVED',
            version,
            updatedByStaffUserId: actorId,
          },
        });
        await this.audit(
          tx,
          request,
          actorId,
          'supplier_offer.archived',
          'SupplierOffer',
          offerId,
          input.reasonCode,
          {
            supplierId: current.supplierId,
            offerId,
            actorId,
            version,
            reasonCode: input.reasonCode,
          },
        );
        return {
          status: 200,
          data: resultEnvelope({ id: offerId, version }, request.requestId),
        };
      },
    );
  }

  async listSupplierOfferRevisions(
    request: StaffRequest,
    offerId: string,
    query: SupplierListQueryDto,
  ) {
    this.require(request, 'suppliers.offers.read', 'suppliers.read');
    if (
      !(await this.db.supplierOffer.findUnique({
        where: { id: offerId },
        select: { id: true },
      }))
    )
      throw new StaffError('NOT_FOUND');
    const limit = query.limit ?? 50;
    const filters = { offerId };
    const cursor = decodeCursor<Cursor & { revisionNo: number }>(
      query.cursor,
      fingerprint(filters),
    );
    const rows = await this.db.supplierOfferRevision.findMany({
      where: {
        offerId,
        ...(cursor ? { revisionNo: { lt: cursor.revisionNo } } : {}),
      },
      orderBy: { revisionNo: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length
        ? encodeCursor({
            v: 1,
            fingerprint: fingerprint(filters),
            revisionNo: page.at(-1)!.revisionNo,
          })
        : null;
    return resultEnvelope(
      page.map((row) => offerRevision(row as never)),
      request.requestId,
      limit,
      nextCursor,
    );
  }

  private async currentOfferForMatch(tx: Tx, offerId: string) {
    return tx.supplierOffer.findUnique({
      where: { id: offerId },
      include: {
        supplier: true,
        currentRevision: true,
      },
    });
  }

  private async productTuple(tx: Tx, productId: string) {
    return tx.catalogProduct.findUnique({
      where: { id: productId },
      include: { brand: true },
    });
  }

  private async exactCandidates(
    tx: Tx,
    offer: NonNullable<
      Awaited<ReturnType<SuppliersService['currentOfferForMatch']>>
    >,
  ) {
    const revision = offer.currentRevision;
    if (!isMatchableOfferRevision(revision)) return [];
    const tuple = matchTuple(revision);
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        version: number;
        brandId: string;
        brandName: string;
        manufacturerName: string;
        originalPartNumber: string;
        modification: string | null;
      }>
    >`
      SELECT cp.id::text AS id, cp.version, cp.brand_id::text AS "brandId", b.name AS "brandName",
             cp.manufacturer_name AS "manufacturerName", cp.original_part_number AS "originalPartNumber",
             cp.modification
      FROM catalog_product cp JOIN brand b ON b.id = cp.brand_id
      WHERE cp.publication_state <> 'ARCHIVED' AND b.state = 'ACTIVE'
        AND cp.brand_id = ${tuple.brandId}::uuid
        AND cp.manufacturer_name COLLATE "C" = ${tuple.manufacturerName} COLLATE "C"
        AND cp.original_part_number COLLATE "C" = ${tuple.originalPartNumber} COLLATE "C"
        AND cp.modification COLLATE "C" IS NOT DISTINCT FROM ${tuple.modification} COLLATE "C"
      ORDER BY cp.id
      LIMIT 101
    `;
    return rows;
  }

  async listExactSupplierMatchCandidates(
    request: StaffRequest,
    offerId: string,
  ) {
    this.require(
      request,
      'suppliers.offers.read',
      'suppliers.read',
      'catalog.products.read',
      'catalog.references.read',
    );
    const offer = await this.currentOfferForMatch(
      this.db as unknown as Tx,
      offerId,
    );
    if (!offer) throw new StaffError('NOT_FOUND');
    const identityComplete = isMatchableOfferRevision(offer.currentRevision);
    const candidates = await this.exactCandidates(
      this.db as unknown as Tx,
      offer,
    );
    return resultEnvelope(
      {
        identityComplete,
        reasonCode: identityComplete ? null : 'INCOMPLETE_IDENTITY',
        candidates: candidates.map((row) => ({
          productId: row.id,
          productVersion: row.version,
          brandId: row.brandId,
          brandName: row.brandName,
          manufacturerName: row.manufacturerName,
          originalPartNumber: row.originalPartNumber,
          modification: row.modification,
          identityEvidenceKind: 'STRICT_IDENTITY_EXACT',
        })),
      },
      request.requestId,
    );
  }

  async listSupplierMatchProposals(
    request: StaffRequest,
    query: ProposalListQueryDto,
  ) {
    this.require(
      request,
      'suppliers.offers.read',
      'suppliers.read',
      'catalog.products.read',
      'catalog.references.read',
    );
    const limit = query.limit ?? 50;
    const filters = { state: query.state ?? null };
    const cursor = decodeCursor<Cursor & { createdAt: string; id: string }>(
      query.cursor,
      fingerprint(filters),
    );
    const rows = await this.db.productMatchProposal.findMany({
      where: {
        ...(query.state ? { state: query.state } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      include: { offer: { select: { currentMatchProposalId: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length
        ? encodeCursor({
            v: 1,
            fingerprint: fingerprint(filters),
            createdAt: page.at(-1)!.createdAt.toISOString(),
            id: page.at(-1)!.id,
          })
        : null;
    return resultEnvelope(
      page.map((row) => ({
        id: row.id,
        offerId: row.offerId,
        offerRevisionId: row.offerRevisionId,
        productId: row.proposedProductId,
        state: row.state,
        evidenceKind: row.evidenceKind,
        version: row.version,
        createdAt: row.createdAt,
        decidedAt: row.decidedAt,
        decisionReasonCode: row.decisionReasonCode,
        decisionComment: row.decisionComment,
        currentForOffer: row.offer.currentMatchProposalId === row.id,
      })),
      request.requestId,
      limit,
      nextCursor,
    );
  }

  async createSupplierMatchProposal(
    request: StaffRequest,
    key: string | undefined,
    offerId: string,
    input: CreateMatchProposalDto,
  ) {
    return this.mutate(
      request,
      key,
      'createSupplierMatchProposal',
      'POST',
      `/v1/staff/supplier-offers/${offerId}/match-proposals`,
      input,
      async (tx, actorId) => {
        const offerRef = await tx.supplierOffer.findUnique({
          where: { id: offerId },
          select: { supplierId: true },
        });
        if (!offerRef) throw new StaffError('NOT_FOUND');
        await this.lock(tx, 'supplier', offerRef.supplierId);
        await this.lock(tx, 'supplier_offer', offerId);
        await this.lock(tx, 'catalog_product', input.productId);
        const offer = await this.currentOfferForMatch(tx, offerId);
        const product = await this.productTuple(tx, input.productId);
        if (!offer || !product) throw new StaffError('NOT_FOUND');
        if (
          offer.version !== input.expectedOfferVersion ||
          product.version !== input.expectedProductVersion
        )
          throw new StaffError('VERSION_CONFLICT');
        if (
          offer.state !== 'ACTIVE' ||
          offer.supplier.state !== 'ACTIVE' ||
          product.publicationState === 'ARCHIVED' ||
          product.brand?.state !== 'ACTIVE'
        )
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (
          !isMatchableOfferRevision(offer.currentRevision) ||
          !exactIdentity(matchTuple(offer.currentRevision), matchTuple(product))
        )
          throw new StaffError('IDENTITY_CHANGED');
        const pending = await tx.productMatchProposal.findFirst({
          where: {
            offerId,
            offerRevisionId: offer.currentRevisionId,
            proposedProductId: input.productId,
            state: 'PENDING',
          },
          select: { id: true },
        });
        if (pending) throw new StaffError('MATCH_ALREADY_PENDING');
        const proposalId = randomUUID();
        const offerSnapshot = {
          ...matchTuple(offer.currentRevision),
          modificationEvidence: offer.currentRevision.modificationEvidence,
        };
        const productSnapshot = matchTuple(product);
        await tx.productMatchProposal.create({
          data: {
            id: proposalId,
            offerId,
            offerRevisionId: offer.currentRevisionId,
            proposedProductId: input.productId,
            offerIdentitySnapshot: asJsonObject(offerSnapshot),
            productIdentitySnapshot: asJsonObject(productSnapshot),
            evidenceKind: 'STRICT_IDENTITY_EXACT',
            state: 'PENDING',
            version: 1,
            createdByStaffUserId: actorId,
          },
        });
        await this.audit(
          tx,
          request,
          actorId,
          'supplier_match.proposed',
          'ProductMatchProposal',
          proposalId,
          null,
          {
            supplierId: offer.supplierId,
            offerId,
            proposalId,
            productId: input.productId,
            identityEvidenceKind: 'STRICT_IDENTITY_EXACT',
            actorId,
            version: 1,
          },
        );
        return {
          status: 201,
          data: resultEnvelope(
            {
              id: proposalId,
              offerId,
              offerRevisionId: offer.currentRevisionId,
              productId: input.productId,
              state: 'PENDING',
              evidenceKind: 'STRICT_IDENTITY_EXACT',
              version: 1,
              createdAt: new Date().toISOString(),
              decidedAt: null,
              decisionReasonCode: null,
              decisionComment: null,
              currentForOffer: false,
            },
            request.requestId,
          ),
        };
      },
    );
  }

  async decideSupplierMatchProposal(
    request: StaffRequest,
    key: string | undefined,
    proposalId: string,
    input: DecideMatchProposalDto,
  ) {
    return this.mutate(
      request,
      key,
      'decideSupplierMatchProposal',
      'POST',
      `/v1/staff/supplier-match-proposals/${proposalId}/decision`,
      input,
      async (tx, actorId) => {
        const proposalRef = await tx.productMatchProposal.findUnique({
          where: { id: proposalId },
          select: { offerId: true, proposedProductId: true },
        });
        if (!proposalRef) throw new StaffError('NOT_FOUND');
        const offerRef = await tx.supplierOffer.findUnique({
          where: { id: proposalRef.offerId },
          select: { supplierId: true },
        });
        if (!offerRef) throw new StaffError('NOT_FOUND');
        await this.lock(tx, 'supplier', offerRef.supplierId);
        await this.lock(tx, 'supplier_offer', proposalRef.offerId);
        await this.lock(tx, 'catalog_product', proposalRef.proposedProductId);
        await this.lock(tx, 'product_match_proposal', proposalId);
        const proposal = await tx.productMatchProposal.findUnique({
          where: { id: proposalId },
        });
        if (!proposal) throw new StaffError('NOT_FOUND');
        const [offer, product, lockedProposal] = await Promise.all([
          this.currentOfferForMatch(tx, proposalRef.offerId),
          this.productTuple(tx, proposalRef.proposedProductId),
          tx.productMatchProposal.findUnique({ where: { id: proposalId } }),
        ]);
        if (!offer || !product || !lockedProposal)
          throw new StaffError('NOT_FOUND');
        if (
          lockedProposal.version !== input.expectedVersion ||
          offer.version !== input.expectedOfferVersion ||
          product.version !== input.expectedProductVersion ||
          offer.currentMatchProposalId !== input.expectedCurrentMatchProposalId
        )
          throw new StaffError('VERSION_CONFLICT');
        if (lockedProposal.state !== 'PENDING')
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (
          offer.state !== 'ACTIVE' ||
          offer.supplier.state !== 'ACTIVE' ||
          product.publicationState === 'ARCHIVED'
        )
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (input.decision === 'APPROVE') {
          const offerSnapshot = jsonObject(
            lockedProposal.offerIdentitySnapshot,
          );
          const productSnapshot = jsonObject(
            lockedProposal.productIdentitySnapshot,
          );
          const currentOffer = matchTuple(offer.currentRevision);
          const currentProduct = matchTuple(product);
          if (
            offer.currentRevisionId !== lockedProposal.offerRevisionId ||
            offer.currentRevision.modificationEvidence === 'UNKNOWN' ||
            product.brand?.state !== 'ACTIVE' ||
            !exactIdentity(currentOffer, currentProduct) ||
            canonicalJson(currentOffer) !==
              canonicalJson(
                matchTuple(offerSnapshot as unknown as MatchTuple),
              ) ||
            canonicalJson(currentProduct) !==
              canonicalJson(
                matchTuple(productSnapshot as unknown as MatchTuple),
              )
          )
            throw new StaffError('IDENTITY_CHANGED');
        }
        const terminal = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const decidedAt = new Date();
        const version = lockedProposal.version + 1;
        await tx.productMatchProposal.update({
          where: { id: proposalId },
          data: {
            state: terminal,
            decidedByStaffUserId: actorId,
            decidedAt,
            decisionReasonCode: input.reasonCode,
            decisionComment: input.reason ?? null,
            version,
          },
        });
        if (terminal === 'APPROVED')
          await tx.supplierOffer.update({
            where: { id: offer.id },
            data: {
              currentMatchProposalId: proposalId,
              version: offer.version + 1,
              updatedByStaffUserId: actorId,
            },
          });
        await this.audit(
          tx,
          request,
          actorId,
          terminal === 'APPROVED'
            ? 'supplier_match.approved'
            : 'supplier_match.rejected',
          'ProductMatchProposal',
          proposalId,
          input.reasonCode,
          {
            supplierId: offer.supplierId,
            offerId: offer.id,
            proposalId,
            productId: proposal.proposedProductId,
            actorId,
            version,
            outcome: terminal,
            reasonCode: input.reasonCode,
          },
        );
        return {
          status: 200,
          data: resultEnvelope(
            {
              id: proposalId,
              offerId: offer.id,
              offerRevisionId: proposal.offerRevisionId,
              productId: proposal.proposedProductId,
              state: terminal,
              evidenceKind: proposal.evidenceKind,
              version,
              createdAt: proposal.createdAt,
              decidedAt,
              decisionReasonCode: input.reasonCode,
              decisionComment: input.reason ?? null,
              currentForOffer: terminal === 'APPROVED',
            },
            request.requestId,
          ),
        };
      },
    );
  }

  async unlinkSupplierOfferMatch(
    request: StaffRequest,
    key: string | undefined,
    offerId: string,
    input: UnlinkMatchDto,
  ) {
    return this.mutate(
      request,
      key,
      'unlinkSupplierOfferMatch',
      'POST',
      `/v1/staff/supplier-offers/${offerId}/match/unlink`,
      input,
      async (tx, actorId) => {
        await this.lock(tx, 'supplier_offer', offerId);
        const offer = await tx.supplierOffer.findUnique({
          where: { id: offerId },
        });
        if (!offer) throw new StaffError('NOT_FOUND');
        if (
          offer.version !== input.expectedVersion ||
          offer.currentMatchProposalId !== input.expectedCurrentMatchProposalId
        )
          throw new StaffError('VERSION_CONFLICT');
        if (!offer.currentMatchProposalId)
          throw new StaffError('INVALID_STATE_TRANSITION');
        const previousProposalId = offer.currentMatchProposalId;
        const version = offer.version + 1;
        await tx.supplierOffer.update({
          where: { id: offerId },
          data: {
            currentMatchProposalId: null,
            version,
            updatedByStaffUserId: actorId,
          },
        });
        await this.audit(
          tx,
          request,
          actorId,
          'supplier_match.unlinked',
          'SupplierOffer',
          offerId,
          input.reasonCode,
          {
            supplierId: offer.supplierId,
            offerId,
            previousProposalId,
            actorId,
            version,
            reasonCode: input.reasonCode,
          },
        );
        return {
          status: 200,
          data: resultEnvelope({ id: offerId, version }, request.requestId),
        };
      },
    );
  }

  async listSupplierAudit(
    request: StaffRequest,
    supplierId: string,
    query: SupplierListQueryDto,
  ) {
    const actor = this.require(request, 'suppliers.read', 'audit.read');
    const supplier = await this.db.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) throw new StaffError('NOT_FOUND');
    return this.listAudit(
      request,
      actor.id,
      'Supplier',
      supplierId,
      supplierId,
      query,
    );
  }

  async listSupplierOfferAudit(
    request: StaffRequest,
    offerId: string,
    query: SupplierListQueryDto,
  ) {
    const actor = this.require(
      request,
      'suppliers.offers.read',
      'suppliers.read',
      'audit.read',
    );
    const offer = await this.db.supplierOffer.findUnique({
      where: { id: offerId },
      select: { id: true, supplierId: true },
    });
    if (!offer) throw new StaffError('NOT_FOUND');
    return this.listAudit(
      request,
      actor.id,
      'SupplierOffer',
      offerId,
      offer.supplierId,
      query,
    );
  }

  private async listAudit(
    request: StaffRequest,
    actorId: string,
    entityType: 'Supplier' | 'SupplierOffer',
    entityId: string,
    supplierId: string,
    query: SupplierListQueryDto,
  ) {
    const limit = query.limit ?? 50;
    const filters = { entityType, entityId };
    const cursor = decodeCursor<Cursor & { occurredAt: string; id: string }>(
      query.cursor,
      fingerprint(filters),
    );
    await this.db.$transaction(async (tx) => {
      await this.audit(
        tx,
        request,
        actorId,
        'supplier.audit.read',
        entityType,
        entityId,
        null,
        { entityId, actorId, requestId: request.requestId },
      );
    });
    const conditions =
      entityType === 'Supplier'
        ? PrismaRuntime.sql`(entity_type = 'Supplier' AND entity_id = ${entityId}::uuid)
        OR (entity_type IN ('SupplierOffer','ProductMatchProposal') AND changes->>'supplierId' = ${supplierId})`
        : PrismaRuntime.sql`(entity_type = 'SupplierOffer' AND entity_id = ${entityId}::uuid)
        OR (entity_type = 'ProductMatchProposal' AND changes->>'offerId' = ${entityId})`;
    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        action: string;
        entityId: string;
        actorId: string;
        createdAt: Date;
        reasonCode: string | null;
        changes: Prisma.JsonValue;
      }>
    >(PrismaRuntime.sql`
      SELECT id::text, action, entity_id::text AS "entityId", actor_user_id::text AS "actorId",
             occurred_at AS "createdAt", reason_code AS "reasonCode", changes
      FROM audit_event
      WHERE (action LIKE 'supplier.%' OR action LIKE 'supplier_offer.%' OR action LIKE 'supplier_match.%')
        AND (${conditions})
      ${cursor ? PrismaRuntime.sql`AND (occurred_at < ${new Date(cursor.occurredAt)}::timestamptz OR (occurred_at = ${new Date(cursor.occurredAt)}::timestamptz AND id < ${cursor.id}::uuid))` : PrismaRuntime.empty}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ${limit + 1}
    `);
    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length
        ? encodeCursor({
            v: 1,
            fingerprint: fingerprint(filters),
            occurredAt: page.at(-1)!.createdAt.toISOString(),
            id: page.at(-1)!.id,
          })
        : null;
    return resultEnvelope(
      page.map((row) => {
        const changes = jsonObject(row.changes);
        return {
          id: row.id,
          action: row.action,
          entityId: row.entityId,
          actorId: row.actorId,
          createdAt: row.createdAt,
          changedFieldNames: Array.isArray(changes.changedFieldNames)
            ? changes.changedFieldNames
            : [],
          reasonCode: row.reasonCode,
        };
      }),
      request.requestId,
      limit,
      nextCursor,
    );
  }
}
