import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService, createAuditEvent } from '../audit/audit.service.js';
import { DATABASE, PrismaDatabase } from '../database/database.module.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  assertCurrentActor,
  assertHasPermission,
  effectivePermissions,
} from '../permissions/policy.js';
import { StaffError } from '../identity/errors.js';
import type { StaffPrincipal, StaffRequest } from '../identity/request.js';
import {
  CatalogProductReviewDecisionDto,
  CatalogProductMediaInputDto,
  CatalogProductDocumentInputDto,
  CreateCatalogProductDto,
  PatchCatalogProductDraftDto,
  ReplaceCatalogProductDocumentsDto,
  ReplaceCatalogProductMediaDto,
  ReplaceCatalogProductRelationsDto,
  SubmitCatalogProductDto,
} from './catalog.dto.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ATTRIBUTE_CODE = /^[a-z][a-z0-9_]{1,79}$/;
const ENUM_CODE = /^[a-z][a-z0-9_-]{0,79}$/;
const DECIMAL = /^(?:0|-?[1-9][0-9]*)(?:\.[0-9]*[1-9])?$|^-0\.[0-9]*[1-9]$/;
const PUBLIC_CATEGORY_CURSOR_SORT =
  /^(0|[1-9][0-9]*):([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const STAFF_STATES = ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED'];

type ProductState = string;
type AttrType = 'TEXT' | 'DECIMAL' | 'INTEGER' | 'BOOLEAN' | 'ENUM';
type RelationType = 'ACCESSORY' | 'COMPATIBLE_EQUIPMENT';
type RelationTargetInput = {
  targetProductId: string;
  targetRevisionId: string;
  relationType: string;
  sortOrder: number;
};

interface Cursor {
  createdAt: string;
  id: string;
}

interface ProductRoot {
  id: string;
  slug: string;
  publicationState: ProductState;
  brandId: string | null;
  manufacturerName: string | null;
  originalPartNumber: string | null;
  modification: string | null;
  publishedRevisionId: string | null;
  pendingRevisionId: string | null;
  currentDraftRevisionId: string | null;
  version: number;
}

interface LockedReference {
  id: string;
  state: string;
  name: string;
  slug: string;
}

interface LockedAttribute {
  id: string;
  categoryId: string;
  code: string;
  label: string;
  valueType: string;
  unitCode: string | null;
  unitLabel: string | null;
  enumOptions: { code: string; label: string }[] | null;
  filterable: boolean;
  searchable: boolean;
  comparable: boolean;
  state: string;
}

interface RevisionRecord {
  id: string;
  productId: string;
  revisionNo: number;
  sourceRevisionId: string | null;
  brandId: string | null;
  categoryId: string;
  state: string;
  displayName: string;
  summary: string | null;
  description: string | null;
  brandNameSnapshot: string | null;
  brandSlugSnapshot: string | null;
  categoryNameSnapshot: string;
  categorySlugSnapshot: string;
  manufacturerNameSnapshot: string | null;
  originalPartNumberSnapshot: string | null;
  modificationSnapshot: string | null;
  createdByUserId: string;
  createdAt: Date;
  submittedByUserId: string | null;
  submittedAt: Date | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decision: string | null;
  decisionReason: string | null;
  publishedAt: Date | null;
}

interface AttributeValueRecord {
  attributeDefinitionId: string;
  categoryId: string;
  valueType: string;
  codeSnapshot: string;
  labelSnapshot: string;
  unitCodeSnapshot: string | null;
  unitLabelSnapshot: string | null;
  comparableSnapshot: boolean;
  textValue: string | null;
  numericValue: Prisma.Decimal | null;
  booleanValue: boolean | null;
  enumCodeValue: string | null;
  enumLabelSnapshot: string | null;
}

interface InputAttribute {
  attributeDefinitionId: string;
  valueType: AttrType;
  value: unknown;
}

interface RevisionSeed {
  categoryId: string;
  brandId: string | null;
  displayName: string;
  summary: string | null;
  description: string | null;
  manufacturerName: string | null;
  originalPartNumber: string | null;
  modification: string | null;
  attributes: InputAttribute[];
}

function validation(field: string, code: string): StaffError {
  return new StaffError('VALIDATION_ERROR', [{ field, code }]);
}

function uuid(value: string, field = 'id') {
  if (!UUID.test(value)) throw validation(field, 'INVALID_UUID');
  return value.toLowerCase();
}

function clean(value: string | null | undefined, max: number, field: string) {
  if (value == null) return null;
  const result = value.normalize('NFC').trim();
  if (Array.from(result).length < 1 || Array.from(result).length > max)
    throw validation(field, 'OUT_OF_RANGE');
  return result;
}

function normalizeIdentity(
  value: string | null | undefined,
  max: number,
  field: string,
) {
  if (value == null) return null;
  const normalized = value.normalize('NFC').replace(/^ +| +$/g, '');
  if (!normalized || Array.from(normalized).length > max)
    throw validation(field, 'OUT_OF_RANGE');
  return normalized;
}

function pageLimit(value: unknown, fallback = 50, max = 100) {
  const parsed =
    value === undefined
      ? fallback
      : typeof value === 'string' && /^[0-9]{1,3}$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max)
    throw validation('limit', 'OUT_OF_RANGE');
  return parsed;
}

function pageNumber(
  value: unknown,
  fallback: number,
  max: number,
  field: string,
) {
  const parsed =
    value === undefined
      ? fallback
      : typeof value === 'string' && /^[0-9]{1,5}$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max)
    throw validation(field, 'OUT_OF_RANGE');
  return parsed;
}

function decodeStaffCursor(value: unknown): Cursor | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw validation('cursor', 'INVALID_CURSOR');
  try {
    const text = Buffer.from(value, 'base64url').toString('utf8');
    const decoded: unknown = JSON.parse(text);
    if (
      Buffer.from(text).toString('base64url') !== value ||
      !decoded ||
      typeof decoded !== 'object' ||
      Array.isArray(decoded)
    )
      throw new Error();
    const record = decoded as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(',') !== 'createdAt,id' ||
      typeof record.createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(record.createdAt) ||
      !Number.isFinite(Date.parse(record.createdAt)) ||
      typeof record.id !== 'string' ||
      !UUID.test(record.id)
    )
      throw new Error();
    return { createdAt: record.createdAt, id: record.id.toLowerCase() };
  } catch {
    throw validation('cursor', 'INVALID_CURSOR');
  }
}

function encodeStaffCursor(row: { id: string; createdAtCursor: string }) {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAtCursor, id: row.id }),
    'utf8',
  ).toString('base64url');
}

function decodePublicCategoryCursor(value: unknown) {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw validation('cursor', 'INVALID_CURSOR');
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const match = PUBLIC_CATEGORY_CURSOR_SORT.exec(decoded);
    if (
      !match ||
      Buffer.from(decoded).toString('base64url') !== value ||
      Number(match[1]) > 2147483647
    )
      throw new Error();
    return { sortOrder: Number(match[1]), slug: match[2]! };
  } catch {
    throw validation('cursor', 'INVALID_CURSOR');
  }
}

function encodePublicCategoryCursor(row: { sortOrder: number; slug: string }) {
  return Buffer.from(`${row.sortOrder}:${row.slug}`, 'utf8').toString(
    'base64url',
  );
}

function allowedActionError(action: string, code: string) {
  const common = new Set([
    'AUTH_REQUIRED',
    'FORBIDDEN',
    'PASSWORD_CHANGE_REQUIRED',
    'ORIGIN_FORBIDDEN',
    'CSRF_INVALID',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_ERROR',
  ]);
  const byAction: Record<string, string[]> = {
    'catalog.product.created': [
      'IDENTITY_CONFLICT',
      'SLUG_CONFLICT',
      'NOT_FOUND',
    ],
    'catalog.product.revision.created': [
      'NOT_FOUND',
      'VERSION_CONFLICT',
      'IDENTITY_CONFLICT',
      'SLUG_CONFLICT',
      'ATTRIBUTE_NOT_APPLICABLE',
      'FILE_NOT_ACCESSIBLE',
      'REFERENCE_IN_USE',
    ],
    'catalog.product.submitted': [
      'NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'PUBLICATION_NOT_READY',
    ],
    'catalog.product.reviewed': [
      'NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'PUBLICATION_NOT_READY',
      'REFERENCE_IN_USE',
    ],
    'catalog.product.archived': [
      'NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
    ],
    'catalog.product.relations.changed': [
      'NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'REFERENCE_IN_USE',
    ],
    'catalog.product.media.changed': [
      'NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'FILE_NOT_ACCESSIBLE',
    ],
    'catalog.product.documents.changed': [
      'NOT_FOUND',
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'FILE_NOT_ACCESSIBLE',
    ],
  };
  if (common.has(code) || byAction[action]?.includes(code)) return code;
  if (code === 'INTERNAL_ERROR' || code === 'DEPENDENCY_UNAVAILABLE')
    return code;
  if (byAction[action]?.includes('VERSION_CONFLICT')) return 'VERSION_CONFLICT';
  return 'VALIDATION_ERROR';
}

function toAttributeInput(row: AttributeValueRecord): InputAttribute {
  let value: unknown;
  const valueType = row.valueType as AttrType;
  switch (valueType) {
    case 'TEXT':
      value = row.textValue;
      break;
    case 'DECIMAL':
      value = row.numericValue?.toString();
      break;
    case 'INTEGER':
      value = Number(row.numericValue?.toString());
      break;
    case 'BOOLEAN':
      value = row.booleanValue;
      break;
    case 'ENUM':
      value = { code: row.enumCodeValue };
      break;
  }
  return {
    attributeDefinitionId: row.attributeDefinitionId,
    valueType,
    value,
  };
}

@Injectable()
export class CatalogProductService {
  constructor(
    @Inject(DATABASE) private readonly db: PrismaDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listProducts(
    request: StaffRequest,
    limitValue: unknown,
    cursorValue: unknown,
    stateValue: unknown,
    categoryIdValue: unknown,
  ) {
    const limit = pageLimit(limitValue);
    const cursor = decodeStaffCursor(cursorValue);
    const state = stateValue === undefined ? undefined : String(stateValue);
    if (state !== undefined && !STAFF_STATES.includes(state))
      throw validation('publicationState', 'INVALID_ENUM');
    const categoryId =
      categoryIdValue === undefined
        ? undefined
        : uuid(String(categoryIdValue), 'categoryId');
    if (state === 'ARCHIVED' && categoryId)
      throw validation('categoryId', 'INCOMPATIBLE_WITH_ARCHIVED');
    const stateWhere =
      state === 'DRAFT'
        ? Prisma.sql`p.current_draft_revision_id IS NOT NULL`
        : state === 'PENDING_REVIEW'
          ? Prisma.sql`p.pending_revision_id IS NOT NULL`
          : state === 'PUBLISHED'
            ? Prisma.sql`p.published_revision_id IS NOT NULL`
            : state === 'ARCHIVED'
              ? Prisma.sql`p.publication_state='ARCHIVED'`
              : Prisma.sql`TRUE`;
    const categoryWhere = !categoryId
      ? Prisma.sql`TRUE`
      : state === 'DRAFT'
        ? Prisma.sql`EXISTS (SELECT 1 FROM catalog_product_revision r WHERE r.id=p.current_draft_revision_id AND r.product_id=p.id AND r.category_id=${categoryId}::uuid)`
        : state === 'PENDING_REVIEW'
          ? Prisma.sql`EXISTS (SELECT 1 FROM catalog_product_revision r WHERE r.id=p.pending_revision_id AND r.product_id=p.id AND r.category_id=${categoryId}::uuid)`
          : state === 'PUBLISHED'
            ? Prisma.sql`EXISTS (SELECT 1 FROM catalog_product_revision r WHERE r.id=p.published_revision_id AND r.product_id=p.id AND r.category_id=${categoryId}::uuid)`
            : Prisma.sql`(
              EXISTS (SELECT 1 FROM catalog_product_revision r WHERE r.id=p.current_draft_revision_id AND r.product_id=p.id AND r.category_id=${categoryId}::uuid)
              OR EXISTS (SELECT 1 FROM catalog_product_revision r WHERE r.id=p.pending_revision_id AND r.product_id=p.id AND r.category_id=${categoryId}::uuid)
              OR EXISTS (SELECT 1 FROM catalog_product_revision r WHERE r.id=p.published_revision_id AND r.product_id=p.id AND r.category_id=${categoryId}::uuid)
            )`;
    const after = cursor
      ? Prisma.sql`(p.created_at,p.id)>(${cursor.createdAt}::timestamptz,${cursor.id}::uuid)`
      : Prisma.sql`TRUE`;
    const rows = await this.db.$queryRaw<
      (ProductRoot & { createdAtCursor: string })[]
    >`
      SELECT p.id::text AS id,p.slug,p.publication_state AS "publicationState",
        p.brand_id::text AS "brandId",p.manufacturer_name AS "manufacturerName",
        p.original_part_number AS "originalPartNumber",p.modification,
        p.published_revision_id::text AS "publishedRevisionId",
        p.pending_revision_id::text AS "pendingRevisionId",
        p.current_draft_revision_id::text AS "currentDraftRevisionId",p.version,
        to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtCursor"
      FROM catalog_product p
      WHERE ${stateWhere} AND ${categoryWhere} AND ${after}
      ORDER BY p.created_at ASC,p.id ASC LIMIT ${limit + 1}
    `;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map((row) => {
        const { createdAtCursor, ...product } = row;
        void createdAtCursor;
        return product;
      }),
      meta: {
        requestId: request.requestId,
        limit,
        nextCursor: hasMore ? encodeStaffCursor(page.at(-1)!) : null,
      },
    };
  }

  async createProduct(request: StaffRequest, input: CreateCatalogProductDto) {
    const rootId = randomUUID();
    const revisionId = randomUUID();
    const actor = this.principal(request);
    const slug = input.slug;
    const categoryId = uuid(input.categoryId, 'categoryId');
    const brandId =
      input.brandId == null ? null : uuid(input.brandId, 'brandId');
    const fields = this.seedFromCreate(input);
    if (!SLUG.test(slug)) throw validation('slug', 'INVALID_SLUG');
    const result = await this.command(
      request,
      'catalog.products.write',
      'catalog.product.created',
      'CatalogProduct',
      async (tx) => {
        const references = await this.lockReferences(
          tx,
          brandId,
          categoryId,
          fields.attributes.map((attribute) => attribute.attributeDefinitionId),
        );
        const brand = brandId ? references.brand : null;
        const category = references.category;
        if (
          !category ||
          category.state !== 'ACTIVE' ||
          (brandId && brand?.state !== 'ACTIVE')
        )
          throw new StaffError('NOT_FOUND');
        const revisionSeed: RevisionSeed = { ...fields, brandId, categoryId };
        this.validateAttributeInputs(
          revisionSeed.attributes,
          references.attributes,
        );
        await tx.catalogProduct.create({
          data: {
            id: rootId,
            slug,
            publicationState: 'DRAFT',
            brandId,
            manufacturerName: fields.manufacturerName,
            originalPartNumber: fields.originalPartNumber,
            modification: fields.modification,
            currentDraftRevisionId: revisionId,
          },
        });
        await this.insertRevision(tx, {
          id: revisionId,
          productId: rootId,
          revisionNo: 1,
          sourceRevisionId: null,
          seed: revisionSeed,
          brand,
          category,
          actorId: actor.id,
        });
        await this.insertAttributes(
          tx,
          revisionId,
          categoryId,
          revisionSeed.attributes,
          references.attributes,
          actor.id,
        );
        return {
          value: { id: rootId, version: 1 },
          entityId: rootId,
          changes: {
            revisionId,
            changedFields: [
              'attributes',
              'brandId',
              'categoryId',
              'description',
              'displayName',
              'manufacturerName',
              'modification',
              'originalPartNumber',
              'slug',
              'summary',
            ],
            version: 1,
            changeSource: 'CREATE',
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async getProduct(request: StaffRequest, productIdValue: string) {
    const productId = uuid(productIdValue, 'productId');
    return this.db.$transaction(
      async (tx) => {
        const root = await tx.catalogProduct.findUnique({
          where: { id: productId },
        });
        if (!root) throw new StaffError('NOT_FOUND');
        const revisions = await tx.catalogProductRevision.findMany({
          where: { productId },
          orderBy: [{ revisionNo: 'desc' }, { id: 'desc' }],
          take: 1000,
          include: { attributeValues: true },
        });
        const byId = new Map(
          revisions.map((revision) => [revision.id, revision]),
        );
        const view = (revisionId: string | null) => {
          const revision = revisionId ? byId.get(revisionId) : undefined;
          return revision ? this.serializeRevision(revision) : null;
        };
        return {
          data: {
            id: root.id,
            slug: root.slug,
            publicationState: root.publicationState,
            brandId: root.brandId,
            manufacturerName: root.manufacturerName,
            originalPartNumber: root.originalPartNumber,
            modification: root.modification,
            publishedRevisionId: root.publishedRevisionId,
            pendingRevisionId: root.pendingRevisionId,
            currentDraftRevisionId: root.currentDraftRevisionId,
            version: root.version,
            publishedRevision: view(root.publishedRevisionId),
            pendingRevision: view(root.pendingRevisionId),
            editorRevision: view(root.currentDraftRevisionId),
            revisionHistory: revisions.map((revision) =>
              this.serializeRevision(revision),
            ),
          },
          meta: { requestId: request.requestId },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async patchProduct(
    request: StaffRequest,
    productIdValue: string,
    input: PatchCatalogProductDraftDto,
  ) {
    const productId = uuid(productIdValue, 'productId');
    const baseRevisionId = uuid(input.baseRevisionId, 'baseRevisionId');
    const actor = this.principal(request);
    const result = await this.command(
      request,
      'catalog.products.write',
      'catalog.product.revision.created',
      'CatalogProduct',
      async (tx) => {
        const targetIds = await this.relationTargetIdsForRevision(
          tx,
          productId,
          baseRevisionId,
        );
        await this.lockProductRoots(tx, [productId, ...targetIds]);
        const root = await this.lockedProduct(tx, productId);
        if (!root) throw new StaffError('NOT_FOUND');
        if (root.version !== input.expectedVersion) {
          throw new StaffError('VERSION_CONFLICT');
        }
        if (root.publicationState === 'ARCHIVED')
          throw new StaffError('VERSION_CONFLICT');
        if (root.pendingRevisionId) throw new StaffError('VERSION_CONFLICT');
        const base = await tx.catalogProductRevision.findFirst({
          where: { id: baseRevisionId, productId },
          include: {
            attributeValues: true,
            media: true,
            documents: true,
            sourceRelations: true,
          },
        });
        if (
          !base ||
          !this.isAllowedBase(
            root,
            base.id,
            base.state,
            base.createdAt,
            await this.latestRejected(tx, productId, root.publishedRevisionId),
          )
        )
          throw new StaffError('VERSION_CONFLICT');
        const seed = this.seedFromPatch(base, input);
        const values =
          input.attributes === undefined
            ? base.attributeValues.map(toAttributeInput)
            : input.attributes;
        seed.attributes = values;
        const identityHasSubmitted =
          (await tx.catalogProductRevision.count({
            where: { productId, submittedAt: { not: null } },
          })) > 0;
        const identityChanged =
          seed.brandId !== root.brandId ||
          seed.manufacturerName !== root.manufacturerName ||
          seed.originalPartNumber !== root.originalPartNumber ||
          seed.modification !== root.modification;
        if (identityHasSubmitted && identityChanged)
          throw new StaffError('VERSION_CONFLICT');
        const references = await this.lockReferences(
          tx,
          seed.brandId,
          seed.categoryId,
          seed.attributes.map((attribute) => attribute.attributeDefinitionId),
        );
        if (
          references.category?.state !== 'ACTIVE' ||
          (seed.brandId && references.brand?.state !== 'ACTIVE')
        )
          throw new StaffError('REFERENCE_IN_USE');
        this.validateAttributeInputs(
          seed.attributes,
          references.attributes,
          seed.categoryId,
        );
        const changedFields = this.changedProductFields(seed, base);
        if (changedFields.length === 0)
          return {
            value: { id: productId, version: root.version },
            skipAudit: true,
          };
        const revisionId = randomUUID();
        const revisionNo = await this.nextRevisionNumber(tx, productId);
        await this.updateRootForDraft(tx, root, revisionId, seed);
        if (root.currentDraftRevisionId)
          await tx.catalogProductRevision.update({
            where: { id: root.currentDraftRevisionId },
            data: { state: 'SUPERSEDED' },
          });
        await this.insertRevision(tx, {
          id: revisionId,
          productId,
          revisionNo,
          sourceRevisionId: base.id,
          seed,
          brand: references.brand,
          category: references.category,
          actorId: actor.id,
        });
        await this.insertAttributes(
          tx,
          revisionId,
          seed.categoryId,
          seed.attributes,
          references.attributes,
          actor.id,
        );
        await this.copyMedia(tx, base.id, revisionId, actor);
        await this.copyDocuments(tx, base.id, revisionId, actor);
        await this.copyCurrentRelations(
          tx,
          base.id,
          revisionId,
          productId,
          actor.id,
        );
        return {
          value: { id: productId, version: root.version + 1 },
          entityId: productId,
          changes: {
            revisionId,
            sourceRevisionId: base.id,
            changedFields,
            version: root.version + 1,
            changeSource: 'PATCH',
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async submitProduct(
    request: StaffRequest,
    productIdValue: string,
    input: SubmitCatalogProductDto,
  ) {
    const productId = uuid(productIdValue, 'productId');
    const actor = this.principal(request);
    const result = await this.command(
      request,
      'catalog.products.submit',
      'catalog.product.submitted',
      'CatalogProductRevision',
      async (tx) => {
        const root = await this.lockProductAndPointerTargets(
          tx,
          productId,
          'currentDraftRevisionId',
        );
        if (!root) throw new StaffError('NOT_FOUND');
        if (root.version !== input.expectedVersion) {
          throw new StaffError('VERSION_CONFLICT');
        }
        if (
          root.publicationState === 'ARCHIVED' ||
          root.pendingRevisionId ||
          !root.currentDraftRevisionId
        )
          throw new StaffError('INVALID_STATE_TRANSITION');
        const revision = await tx.catalogProductRevision.findFirst({
          where: { id: root.currentDraftRevisionId, productId, state: 'DRAFT' },
          include: {
            attributeValues: true,
            sourceRelations: true,
            media: true,
            documents: true,
          },
        });
        if (!revision) throw new StaffError('INVALID_STATE_TRANSITION');
        const refs = await this.lockReferences(
          tx,
          revision.brandId,
          revision.categoryId,
          revision.attributeValues.map(
            ({ attributeDefinitionId }) => attributeDefinitionId,
          ),
        );
        if (
          refs.category?.state !== 'ACTIVE' ||
          (revision.brandId && refs.brand?.state !== 'ACTIVE')
        )
          throw new StaffError('PUBLICATION_NOT_READY');
        this.validateSnapshotAttributes(
          revision.attributeValues,
          refs.attributes,
          revision.categoryId,
        );
        const relations = await this.validateRelationTargets(
          tx,
          productId,
          revision.sourceRelations,
        );
        if (!relations) throw new StaffError('REFERENCE_IN_USE');
        const now = await this.now(tx);
        await tx.catalogProductRevision.update({
          where: { id: revision.id },
          data: {
            state: 'PENDING_REVIEW',
            submittedByUserId: actor.id,
            submittedAt: now,
          },
        });
        const nextState = root.publishedRevisionId
          ? 'PUBLISHED'
          : 'PENDING_REVIEW';
        await tx.catalogProduct.update({
          where: { id: productId },
          data: {
            currentDraftRevisionId: null,
            pendingRevisionId: revision.id,
            publicationState: nextState,
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        return {
          value: { id: productId, version: root.version + 1 },
          entityId: revision.id,
          changes: { revisionId: revision.id, version: root.version + 1 },
        };
      },
    );
    return this.mutation(request, result);
  }

  async decideProduct(
    request: StaffRequest,
    productIdValue: string,
    input: CatalogProductReviewDecisionDto,
  ) {
    const productId = uuid(productIdValue, 'productId');
    const revisionId = uuid(input.revisionId, 'revisionId');
    const actor = this.principal(request);
    const reason =
      input.reason === undefined
        ? undefined
        : clean(input.reason, 1000, 'reason');
    if (
      input.decision === 'PUBLISH' ? reason !== undefined : reason === undefined
    )
      throw validation('reason', 'REQUIRED_FOR_DECISION');
    const result = await this.command(
      request,
      'catalog.products.publish',
      'catalog.product.reviewed',
      'CatalogProductRevision',
      async (tx) => {
        const root = await this.lockProductAndPointerTargets(
          tx,
          productId,
          'pendingRevisionId',
        );
        if (!root) throw new StaffError('NOT_FOUND');
        if (root.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (
          root.publicationState === 'ARCHIVED' ||
          root.pendingRevisionId !== revisionId
        )
          throw new StaffError('INVALID_STATE_TRANSITION');
        const revision = await tx.catalogProductRevision.findFirst({
          where: { id: revisionId, productId, state: 'PENDING_REVIEW' },
          include: {
            attributeValues: true,
            sourceRelations: true,
            media: true,
            documents: true,
          },
        });
        if (!revision) throw new StaffError('INVALID_STATE_TRANSITION');
        if (input.decision === 'PUBLISH') {
          const refs = await this.lockReferences(
            tx,
            revision.brandId,
            revision.categoryId,
            revision.attributeValues.map(
              ({ attributeDefinitionId }) => attributeDefinitionId,
            ),
          );
          if (
            refs.category?.state !== 'ACTIVE' ||
            (revision.brandId && refs.brand?.state !== 'ACTIVE')
          )
            throw new StaffError('PUBLICATION_NOT_READY');
          this.validateSnapshotAttributes(
            revision.attributeValues,
            refs.attributes,
            revision.categoryId,
          );
          if (
            !(await this.validateRelationTargets(
              tx,
              productId,
              revision.sourceRelations,
            ))
          )
            throw new StaffError('REFERENCE_IN_USE');
        }
        const now = await this.now(tx);
        const revisionState =
          input.decision === 'PUBLISH'
            ? 'PUBLISHED'
            : input.decision === 'RETURN_FOR_CHANGES'
              ? 'RETURNED'
              : 'REJECTED';
        await tx.catalogProductRevision.update({
          where: { id: revision.id },
          data: {
            state: revisionState,
            decidedByUserId: actor.id,
            decidedAt: now,
            decision: input.decision,
            decisionReason: reason ?? null,
            publishedAt: input.decision === 'PUBLISH' ? now : null,
          },
        });
        const publishedRevisionId =
          input.decision === 'PUBLISH' ? revision.id : root.publishedRevisionId;
        const nextState = publishedRevisionId ? 'PUBLISHED' : 'DRAFT';
        await tx.catalogProduct.update({
          where: { id: productId },
          data: {
            pendingRevisionId: null,
            publishedRevisionId,
            publicationState: nextState,
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        return {
          value: { id: productId, version: root.version + 1 },
          entityId: revision.id,
          changes: {
            revisionId: revision.id,
            decision: input.decision,
            ...(reason ? { reasonCode: 'REVIEWER_PROVIDED' } : {}),
            version: root.version + 1,
            ...(input.decision === 'PUBLISH'
              ? { publishedRevisionId: revision.id }
              : {}),
          },
          outcome:
            input.decision === 'PUBLISH'
              ? 'PUBLISHED'
              : input.decision === 'RETURN_FOR_CHANGES'
                ? 'RETURN_FOR_CHANGES'
                : 'REJECTED',
        };
      },
    );
    return this.mutation(request, result);
  }

  async archiveProduct(
    request: StaffRequest,
    productIdValue: string,
    input: { expectedVersion: number },
  ) {
    const productId = uuid(productIdValue, 'productId');
    const result = await this.command(
      request,
      'catalog.products.archive',
      'catalog.product.archived',
      'CatalogProduct',
      async (tx) => {
        const root = await this.lockProduct(tx, productId);
        if (!root) throw new StaffError('NOT_FOUND');
        if (root.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (root.publicationState === 'ARCHIVED')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const now = await this.now(tx);
        if (root.pendingRevisionId)
          await tx.catalogProductRevision.update({
            where: { id: root.pendingRevisionId },
            data: { state: 'WITHDRAWN' },
          });
        await tx.catalogProduct.update({
          where: { id: productId },
          data: {
            publicationState: 'ARCHIVED',
            publishedRevisionId: null,
            pendingRevisionId: null,
            currentDraftRevisionId: null,
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        return {
          value: { id: productId, version: root.version + 1 },
          entityId: productId,
          changes: {
            previousState: root.publicationState,
            state: 'ARCHIVED',
            ...(root.publishedRevisionId
              ? { publishedRevisionId: root.publishedRevisionId }
              : {}),
            ...(root.pendingRevisionId
              ? { pendingRevisionId: root.pendingRevisionId }
              : {}),
            version: root.version + 1,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async listProductRelations(request: StaffRequest, productIdValue: string) {
    const revisionId = await this.currentEditorRevisionId(productIdValue);
    const data = revisionId
      ? await this.db.productRelation.findMany({
          where: { sourceRevisionId: revisionId },
          orderBy: [
            { sortOrder: 'asc' },
            { targetProductId: 'asc' },
            { relationType: 'asc' },
          ],
          select: {
            targetProductId: true,
            targetRevisionId: true,
            relationType: true,
            sortOrder: true,
          },
        })
      : [];
    return { data, meta: { requestId: request.requestId } };
  }

  async replaceProductRelations(
    request: StaffRequest,
    productIdValue: string,
    input: ReplaceCatalogProductRelationsDto,
  ) {
    const productId = uuid(productIdValue, 'productId');
    const targets = input.relations.map((row) =>
      uuid(row.targetProductId, 'targetProductId'),
    );
    const actor = this.principal(request);
    if (
      new Set(input.relations.map(({ sortOrder }) => sortOrder)).size !==
        input.relations.length ||
      new Set(
        input.relations.map(
          ({ targetProductId, relationType }) =>
            `${targetProductId}:${relationType}`,
        ),
      ).size !== input.relations.length
    )
      throw validation('relations', 'DUPLICATE_RELATION');
    const result = await this.command(
      request,
      'catalog.products.relations.write',
      'catalog.product.relations.changed',
      'CatalogProductRevision',
      async (tx) => {
        await this.lockProductRoots(tx, [productId, ...targets]);
        const root = await this.lockedProduct(tx, productId);
        if (!root) throw new StaffError('NOT_FOUND');
        if (root.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        const seedContext = await this.resolveDraftBase(tx, root);
        const exactTargets = await this.validateRelationTargets(
          tx,
          productId,
          input.relations,
        );
        if (!exactTargets) throw new StaffError('REFERENCE_IN_USE');
        if (
          this.sameRelations(
            seedContext.revision.sourceRelations,
            input.relations,
          )
        )
          return {
            value: { id: productId, version: root.version },
            skipAudit: true,
          };
        const draft = await this.appendDraft(
          tx,
          root,
          seedContext.revision,
          actor,
          {
            replaceRelations: input.relations,
          },
        );
        return {
          value: { id: productId, version: root.version + 1 },
          entityType: 'CatalogProductRevision',
          entityId: draft.revisionId,
          changes: {
            revisionId: draft.revisionId,
            addedCount: input.relations.length,
            removedCount: draft.previousRelationCount,
            version: root.version + 1,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async listProductMedia(request: StaffRequest, productIdValue: string) {
    const actor = this.principal(request);
    const rows = await this.db.$transaction(async (tx) => {
      await assertCurrentActor(tx, actor, 'files.metadata.read');
      const revisionId = await this.currentEditorRevisionId(productIdValue, tx);
      if (!revisionId) return [];
      const media = await tx.productMedia.findMany({
        where: { productRevisionId: revisionId },
        orderBy: [{ sortOrder: 'asc' }, { fileVersionId: 'asc' }],
      });
      for (const row of media)
        if (!(await this.fileAccessible(tx, actor, row.fileVersionId)))
          throw new StaffError('FILE_NOT_ACCESSIBLE');
      return media;
    });
    return {
      data: rows.map(
        ({ fileVersionId, altText, caption, sortOrder, isPrimary }) => ({
          fileVersionId,
          altText,
          caption,
          sortOrder,
          isPrimary,
        }),
      ),
      meta: { requestId: request.requestId },
    };
  }

  async replaceProductMedia(
    request: StaffRequest,
    productIdValue: string,
    input: ReplaceCatalogProductMediaDto,
  ) {
    const productId = uuid(productIdValue, 'productId');
    const actor = this.principal(request);
    this.validateMedia(input.items);
    const result = await this.command(
      request,
      ['catalog.products.media.write', 'files.metadata.read'],
      'catalog.product.media.changed',
      'ProductMedia',
      async (tx) => {
        const context = await this.lockProductAndDraftBase(tx, productId);
        if (!context) throw new StaffError('NOT_FOUND');
        const root = context.root;
        if (!root) throw new StaffError('NOT_FOUND');
        if (root.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        for (const item of input.items)
          if (!(await this.fileAccessible(tx, actor, item.fileVersionId)))
            throw new StaffError('FILE_NOT_ACCESSIBLE');
        if (this.sameMedia(context.revision.media, input.items))
          return {
            value: { id: productId, version: root.version },
            skipAudit: true,
          };
        const draft = await this.appendDraft(
          tx,
          root,
          context.revision,
          actor,
          {
            replaceMedia: input.items,
          },
        );
        return {
          value: { id: productId, version: root.version + 1 },
          entityType: 'ProductMedia',
          entityId: draft.revisionId,
          changes: {
            revisionId: draft.revisionId,
            addedCount: input.items.length,
            removedCount: draft.previousMediaCount,
            version: root.version + 1,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async listProductDocuments(request: StaffRequest, productIdValue: string) {
    const actor = this.principal(request);
    const rows = await this.db.$transaction(async (tx) => {
      await assertCurrentActor(tx, actor, 'files.metadata.read');
      const revisionId = await this.currentEditorRevisionId(productIdValue, tx);
      if (!revisionId) return [];
      const documents = await tx.productDocumentVersion.findMany({
        where: { productRevisionId: revisionId },
        orderBy: [{ sortOrder: 'asc' }, { fileVersionId: 'asc' }],
      });
      for (const row of documents)
        if (!(await this.fileAccessible(tx, actor, row.fileVersionId)))
          throw new StaffError('FILE_NOT_ACCESSIBLE');
      return documents;
    });
    return {
      data: rows.map(
        ({ fileVersionId, documentKind, displayName, locale, sortOrder }) => ({
          fileVersionId,
          documentKind,
          displayName,
          locale,
          sortOrder,
        }),
      ),
      meta: { requestId: request.requestId },
    };
  }

  async replaceProductDocuments(
    request: StaffRequest,
    productIdValue: string,
    input: ReplaceCatalogProductDocumentsDto,
  ) {
    const productId = uuid(productIdValue, 'productId');
    const actor = this.principal(request);
    this.validateDocuments(input.items);
    const result = await this.command(
      request,
      ['catalog.products.documents.write', 'files.metadata.read'],
      'catalog.product.documents.changed',
      'ProductDocumentVersion',
      async (tx) => {
        const context = await this.lockProductAndDraftBase(tx, productId);
        if (!context) throw new StaffError('NOT_FOUND');
        const root = context.root;
        if (!root) throw new StaffError('NOT_FOUND');
        if (root.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        for (const item of input.items)
          if (!(await this.fileAccessible(tx, actor, item.fileVersionId)))
            throw new StaffError('FILE_NOT_ACCESSIBLE');
        if (this.sameDocuments(context.revision.documents, input.items))
          return {
            value: { id: productId, version: root.version },
            skipAudit: true,
          };
        const draft = await this.appendDraft(
          tx,
          root,
          context.revision,
          actor,
          {
            replaceDocuments: input.items,
          },
        );
        return {
          value: { id: productId, version: root.version + 1 },
          entityType: 'ProductDocumentVersion',
          entityId: draft.revisionId,
          changes: {
            revisionId: draft.revisionId,
            addedCount: input.items.length,
            removedCount: draft.previousDocumentCount,
            version: root.version + 1,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  private principal(request: StaffRequest): StaffPrincipal {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    return request.staff;
  }

  private mutation(
    request: StaffRequest,
    value: { id: string; version: number },
  ) {
    return { data: value, meta: { requestId: request.requestId } };
  }

  private async command<T>(
    request: StaffRequest,
    required: string | string[],
    action: string,
    entityType: string,
    work: (tx: Prisma.TransactionClient) => Promise<{
      value: T;
      entityType?: string;
      entityId?: string;
      changes?: Record<string, unknown>;
      outcome?: 'PUBLISHED' | 'RETURN_FOR_CHANGES' | 'REJECTED';
      skipAudit?: boolean;
    }>,
  ): Promise<T> {
    const actor = this.principal(request);
    try {
      return await this.db.$transaction(
        async (tx) => {
          const requiredPermissions = Array.isArray(required)
            ? required
            : [required];
          await assertCurrentActor(tx, actor, requiredPermissions[0] ?? null);
          for (const permission of requiredPermissions.slice(1))
            await assertHasPermission(tx, actor.id, permission);
          const result = await work(tx);
          if (!result.skipAudit)
            try {
              await createAuditEvent(tx, {
                actorKind: 'STAFF',
                actorUserId: actor.id,
                action,
                entityType: result.entityType ?? entityType,
                entityId: result.entityId ?? null,
                outcome: 'SUCCESS',
                reasonCode: result.outcome ?? null,
                requestId: request.requestId,
                changes: result.changes ?? {},
              });
            } catch {
              throw new StaffError('AUDIT_UNAVAILABLE');
            }
          return result.value;
        },
        { isolationLevel: 'ReadCommitted' },
      );
    } catch (error) {
      const mapped = this.mapError(error, action);
      if (
        !(mapped instanceof StaffError) ||
        mapped.code !== 'AUDIT_UNAVAILABLE'
      )
        await this.deny(request, action, mapped);
      throw mapped;
    }
  }

  private async deny(request: StaffRequest, action: string, error: unknown) {
    const code = error instanceof StaffError ? error.code : 'INTERNAL_ERROR';
    const auditCode = allowedActionError(action, code);
    await this.audit.writeDenied({
      actorKind: 'STAFF',
      actorUserId: this.principal(request).id,
      action,
      outcome:
        auditCode === 'INTERNAL_ERROR' || auditCode === 'DEPENDENCY_UNAVAILABLE'
          ? 'FAILURE'
          : 'DENIED',
      reasonCode: auditCode,
      requestId: request.requestId,
    });
  }

  private mapError(error: unknown, action: string): unknown {
    if (error instanceof StaffError) return error;
    let diagnostic =
      error instanceof Error ? error.message : String(error ?? 'unknown');
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      diagnostic = `${diagnostic} ${JSON.stringify(error.meta ?? {})}`;
      if (error.code === 'P2002') {
        const target = JSON.stringify(error.meta?.target ?? '');
        if (target.includes('slug')) return new StaffError('SLUG_CONFLICT');
        if (target.includes('catalog_product_identity_exact_key'))
          return new StaffError('IDENTITY_CONFLICT');
        if (target.includes('product_relation'))
          return new StaffError('REFERENCE_IN_USE');
        if (
          action === 'catalog.product.created' ||
          action === 'catalog.product.revision.created'
        )
          return new StaffError('IDENTITY_CONFLICT');
        return new StaffError('VERSION_CONFLICT');
      }
      if (error.code === 'P2025') return new StaffError('NOT_FOUND');
      if (error.code === 'P2003') return new StaffError('REFERENCE_IN_USE');
      if (error.code === 'P2034') return new StaffError('VERSION_CONFLICT');
    }
    for (const code of [
      'CATEGORY_CYCLE',
      'CATEGORY_INACTIVE_PARENT',
      'CATEGORY_INACTIVE',
      'ATTRIBUTE_NOT_APPLICABLE',
      'ATTRIBUTE_IN_USE',
      'REFERENCE_IN_USE',
      'IMMUTABLE_REVISION',
      'IMMUTABLE_REVISION_CONTENT',
      'RELATION_TARGET_INVALID',
      'RELATION_TARGET_REVISION_STALE',
      'REVISION_NOT_EDITABLE',
      'PRODUCT_NOT_EDITABLE',
      'INVALID_STATE_TRANSITION',
      'REVISION_REFERENCE_SNAPSHOT_MISMATCH',
      'CATALOG_WORKFLOW_INCONSISTENT',
      'PUBLICATION_NOT_READY',
    ]) {
      if (!diagnostic.includes(code)) continue;
      if (code === 'CATEGORY_CYCLE') return new StaffError('CATEGORY_CYCLE');
      if (code === 'ATTRIBUTE_NOT_APPLICABLE')
        return new StaffError('ATTRIBUTE_NOT_APPLICABLE');
      if (code === 'CATEGORY_INACTIVE_PARENT' || code === 'CATEGORY_INACTIVE')
        return new StaffError('REFERENCE_IN_USE');
      if (
        code === 'RELATION_TARGET_INVALID' ||
        code === 'RELATION_TARGET_REVISION_STALE'
      )
        return new StaffError('REFERENCE_IN_USE');
      if (code === 'PUBLICATION_NOT_READY')
        return new StaffError('PUBLICATION_NOT_READY');
      if (code === 'ATTRIBUTE_IN_USE')
        return new StaffError('REFERENCE_IN_USE');
      if (
        code === 'IMMUTABLE_REVISION' ||
        code === 'IMMUTABLE_REVISION_CONTENT'
      )
        return new StaffError('INVALID_STATE_TRANSITION');
      if (code === 'INVALID_STATE_TRANSITION')
        return new StaffError('INVALID_STATE_TRANSITION');
      return new StaffError('VERSION_CONFLICT');
    }
    return new StaffError('DEPENDENCY_UNAVAILABLE');
  }

  private async lockProduct(tx: Prisma.TransactionClient, productId: string) {
    const rows = await tx.$queryRaw<ProductRoot[]>`
      SELECT id::text AS id,slug,publication_state AS "publicationState",
        brand_id::text AS "brandId",manufacturer_name AS "manufacturerName",
        original_part_number AS "originalPartNumber",modification,
        published_revision_id::text AS "publishedRevisionId",
        pending_revision_id::text AS "pendingRevisionId",
        current_draft_revision_id::text AS "currentDraftRevisionId",version
      FROM catalog_product WHERE id=${productId}::uuid FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async lockedProduct(tx: Prisma.TransactionClient, productId: string) {
    return tx.catalogProduct.findUnique({ where: { id: productId } });
  }

  private async relationTargetIdsForRevision(
    tx: Prisma.TransactionClient,
    productId: string,
    revisionId: string | null,
  ) {
    if (!revisionId) return [];
    const rows = await tx.$queryRaw<{ targetProductId: string }[]>`
      SELECT rel.target_product_id::text AS "targetProductId"
      FROM product_relation rel
      JOIN catalog_product_revision r ON r.id=rel.source_revision_id
      WHERE r.product_id=${productId}::uuid AND r.id=${revisionId}::uuid
      ORDER BY rel.target_product_id
    `;
    return [...new Set(rows.map(({ targetProductId }) => targetProductId))];
  }

  private async lockProductAndPointerTargets(
    tx: Prisma.TransactionClient,
    productId: string,
    pointer: 'currentDraftRevisionId' | 'pendingRevisionId',
  ) {
    const before = await tx.catalogProduct.findUnique({
      where: { id: productId },
    });
    if (!before) return null;
    const revisionId = before[pointer];
    const targetIds = await this.relationTargetIdsForRevision(
      tx,
      productId,
      revisionId,
    );
    await this.lockProductRoots(tx, [productId, ...targetIds]);
    const root = await this.lockedProduct(tx, productId);
    if (!root) return null;
    if (root[pointer] !== revisionId) {
      throw new StaffError('VERSION_CONFLICT');
    }
    const afterTargetIds = await this.relationTargetIdsForRevision(
      tx,
      productId,
      root[pointer],
    );
    if (targetIds.join(',') !== afterTargetIds.join(',')) {
      throw new StaffError('VERSION_CONFLICT');
    }
    return root;
  }

  private async lockProductAndDraftBase(
    tx: Prisma.TransactionClient,
    productId: string,
  ) {
    const before = await tx.catalogProduct.findUnique({
      where: { id: productId },
    });
    if (!before) return null;
    const latest = before.currentDraftRevisionId
      ? null
      : await this.latestRejected(tx, productId, before.publishedRevisionId);
    const candidateRevisionId =
      before.currentDraftRevisionId ?? latest?.id ?? before.publishedRevisionId;
    const targetIds = await this.relationTargetIdsForRevision(
      tx,
      productId,
      candidateRevisionId,
    );
    await this.lockProductRoots(tx, [productId, ...targetIds]);
    const root = await this.lockedProduct(tx, productId);
    if (!root) return null;
    const context = await this.resolveDraftBase(tx, root);
    if (context.revision.id !== candidateRevisionId)
      throw new StaffError('VERSION_CONFLICT');
    const afterTargetIds = await this.relationTargetIdsForRevision(
      tx,
      productId,
      context.revision.id,
    );
    if (targetIds.join(',') !== afterTargetIds.join(','))
      throw new StaffError('VERSION_CONFLICT');
    return { root, ...context };
  }

  private async lockProductRoots(
    tx: Prisma.TransactionClient,
    productIds: string[],
  ) {
    for (const productId of [...new Set(productIds)].sort())
      await tx.$queryRaw`SELECT id FROM catalog_product WHERE id=${productId}::uuid FOR UPDATE`;
  }

  private async validateRelationTargets(
    tx: Prisma.TransactionClient,
    sourceProductId: string,
    relations: RelationTargetInput[],
  ) {
    for (const relation of relations) {
      const targetProductId = uuid(relation.targetProductId, 'targetProductId');
      const targetRevisionId = uuid(
        relation.targetRevisionId,
        'targetRevisionId',
      );
      if (targetProductId === sourceProductId) return false;
      const rows = await tx.$queryRaw<{ current: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM catalog_product p
          JOIN catalog_product_revision r ON r.id=p.published_revision_id AND r.product_id=p.id
          WHERE p.id=${targetProductId}::uuid AND p.publication_state<>'ARCHIVED'
            AND p.published_revision_id=${targetRevisionId}::uuid AND r.state='PUBLISHED'
        ) AS current
      `;
      if (!rows[0]?.current) return false;
    }
    return true;
  }

  private async lockCurrentRelationTargets(
    tx: Prisma.TransactionClient,
    sourceProductId: string,
    sourceRevisionId: string,
  ) {
    const relations = await tx.productRelation.findMany({
      where: { sourceRevisionId },
      select: {
        targetProductId: true,
        targetRevisionId: true,
        relationType: true,
        sortOrder: true,
      },
      orderBy: [{ targetProductId: 'asc' }, { relationType: 'asc' }],
    });
    await this.lockProductRoots(tx, [
      sourceProductId,
      ...relations.map(({ targetProductId }) => targetProductId),
    ]);
    return this.validateRelationTargets(tx, sourceProductId, relations);
  }

  private async now(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ now: Date }[]>`
      SELECT clock_timestamp() AS now
    `;
    if (!rows[0]) throw new StaffError('DEPENDENCY_UNAVAILABLE');
    return rows[0].now;
  }

  private seedFromCreate(input: CreateCatalogProductDto): RevisionSeed {
    return {
      categoryId: uuid(input.categoryId, 'categoryId'),
      brandId: input.brandId == null ? null : uuid(input.brandId, 'brandId'),
      displayName: clean(input.displayName, 240, 'displayName')!,
      summary:
        input.summary == null ? null : clean(input.summary, 500, 'summary'),
      description:
        input.description == null
          ? null
          : clean(input.description, 20000, 'description'),
      manufacturerName: normalizeIdentity(
        input.manufacturerName,
        200,
        'manufacturerName',
      ),
      originalPartNumber: normalizeIdentity(
        input.originalPartNumber,
        160,
        'originalPartNumber',
      ),
      modification: normalizeIdentity(input.modification, 160, 'modification'),
      attributes: input.attributes ?? [],
    };
  }

  private seedFromPatch(
    base: RevisionRecord,
    input: PatchCatalogProductDraftDto,
  ): RevisionSeed {
    return {
      categoryId:
        input.categoryId === undefined
          ? base.categoryId
          : uuid(input.categoryId, 'categoryId'),
      brandId:
        input.brandId === undefined
          ? base.brandId
          : input.brandId === null
            ? null
            : uuid(input.brandId, 'brandId'),
      displayName:
        input.displayName === undefined
          ? base.displayName
          : clean(input.displayName, 240, 'displayName')!,
      summary:
        input.summary === undefined
          ? base.summary
          : input.summary === null
            ? null
            : clean(input.summary, 500, 'summary'),
      description:
        input.description === undefined
          ? base.description
          : input.description === null
            ? null
            : clean(input.description, 20000, 'description'),
      manufacturerName:
        input.manufacturerName === undefined
          ? base.manufacturerNameSnapshot
          : normalizeIdentity(input.manufacturerName, 200, 'manufacturerName'),
      originalPartNumber:
        input.originalPartNumber === undefined
          ? base.originalPartNumberSnapshot
          : normalizeIdentity(
              input.originalPartNumber,
              160,
              'originalPartNumber',
            ),
      modification:
        input.modification === undefined
          ? base.modificationSnapshot
          : normalizeIdentity(input.modification, 160, 'modification'),
      attributes: input.attributes ?? [],
    };
  }

  private async lockReferences(
    tx: Prisma.TransactionClient,
    brandId: string | null,
    categoryId: string,
    attributeIds: string[],
  ) {
    let brand: LockedReference | null = null;
    if (brandId) {
      const rows = await tx.$queryRaw<LockedReference[]>`
        SELECT id::text AS id,state,name,slug FROM brand
        WHERE id=${brandId}::uuid FOR SHARE
      `;
      brand = rows[0] ?? null;
    }
    const categories = await tx.$queryRaw<LockedReference[]>`
      SELECT id::text AS id,state,name,slug FROM category
      WHERE id=${categoryId}::uuid FOR SHARE
    `;
    const category = categories[0] ?? null;
    const ids = [
      ...new Set(
        attributeIds.map((value) => uuid(value, 'attributeDefinitionId')),
      ),
    ].sort();
    const attributes = ids.length
      ? await tx.$queryRaw<LockedAttribute[]>`
          SELECT id::text AS id,category_id::text AS "categoryId",code,label,
            value_type AS "valueType",unit_code AS "unitCode",unit_label AS "unitLabel",
            enum_options AS "enumOptions",filterable,searchable,comparable,state
          FROM attribute_definition WHERE id=ANY(${ids}::uuid[])
          ORDER BY id FOR SHARE
        `
      : [];
    return { brand, category, attributes };
  }

  private validateAttributeInputs(
    inputs: InputAttribute[],
    definitions: LockedAttribute[],
    categoryId?: string,
  ) {
    if (!Array.isArray(inputs) || inputs.length > 300)
      throw validation('attributes', 'OUT_OF_RANGE');
    const unique = new Set<string>();
    const byId = new Map(definitions.map((row) => [row.id, row]));
    for (const input of inputs) {
      if (!input || typeof input !== 'object')
        throw validation('attributes', 'INVALID_VALUE');
      const attributeId = uuid(
        input.attributeDefinitionId,
        'attributeDefinitionId',
      );
      if (unique.has(attributeId))
        throw validation('attributes', 'DUPLICATE_ATTRIBUTE');
      unique.add(attributeId);
      const definition = byId.get(attributeId);
      if (
        !definition ||
        definition.state !== 'ACTIVE' ||
        (categoryId && definition.categoryId !== categoryId) ||
        definition.valueType !== input.valueType
      )
        throw new StaffError('ATTRIBUTE_NOT_APPLICABLE');
      const value = input.value;
      switch (definition.valueType) {
        case 'TEXT':
          if (typeof value !== 'string' || Array.from(value).length > 240)
            throw validation('attributes.value', 'INVALID_TEXT');
          break;
        case 'DECIMAL':
          if (
            typeof value !== 'string' ||
            value.length > 64 ||
            !DECIMAL.test(value)
          )
            throw validation('attributes.value', 'INVALID_DECIMAL');
          break;
        case 'INTEGER':
          if (typeof value !== 'number' || !Number.isSafeInteger(value))
            throw validation('attributes.value', 'INVALID_INTEGER');
          break;
        case 'BOOLEAN':
          if (typeof value !== 'boolean')
            throw validation('attributes.value', 'INVALID_BOOLEAN');
          break;
        case 'ENUM': {
          if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            Object.keys(value).join(',') !== 'code' ||
            typeof (value as { code?: unknown }).code !== 'string' ||
            !ENUM_CODE.test((value as { code: string }).code) ||
            !definition.enumOptions?.some(
              (option) => option.code === (value as { code: string }).code,
            )
          )
            throw validation('attributes.value', 'INVALID_ENUM');
          break;
        }
      }
    }
  }

  private validateSnapshotAttributes(
    values: AttributeValueRecord[],
    definitions: LockedAttribute[],
    categoryId: string,
  ) {
    for (const value of values) {
      const definition = definitions.find(
        ({ id: candidate }) => candidate === value.attributeDefinitionId,
      );
      if (
        !definition ||
        definition.state !== 'ACTIVE' ||
        definition.categoryId !== categoryId ||
        definition.valueType !== value.valueType ||
        definition.code !== value.codeSnapshot ||
        definition.unitCode !== value.unitCodeSnapshot ||
        definition.unitLabel !== value.unitLabelSnapshot
      )
        throw new StaffError('PUBLICATION_NOT_READY');
    }
  }

  private async insertRevision(
    tx: Prisma.TransactionClient,
    input: {
      id: string;
      productId: string;
      revisionNo: number;
      sourceRevisionId: string | null;
      seed: RevisionSeed;
      brand: LockedReference | null;
      category: LockedReference | null;
      actorId: string;
    },
  ) {
    if (!input.category) throw new StaffError('REFERENCE_IN_USE');
    await tx.catalogProductRevision.create({
      data: {
        id: input.id,
        productId: input.productId,
        revisionNo: input.revisionNo,
        sourceRevisionId: input.sourceRevisionId,
        brandId: input.seed.brandId,
        categoryId: input.seed.categoryId,
        state: 'DRAFT',
        displayName: input.seed.displayName,
        summary: input.seed.summary,
        description: input.seed.description,
        brandNameSnapshot: input.brand?.name ?? null,
        brandSlugSnapshot: input.brand?.slug ?? null,
        categoryNameSnapshot: input.category.name,
        categorySlugSnapshot: input.category.slug,
        manufacturerNameSnapshot: input.seed.manufacturerName,
        originalPartNumberSnapshot: input.seed.originalPartNumber,
        modificationSnapshot: input.seed.modification,
        createdByUserId: input.actorId,
      },
    });
  }

  private async insertAttributes(
    tx: Prisma.TransactionClient,
    revisionId: string,
    categoryId: string,
    inputs: InputAttribute[],
    definitions: LockedAttribute[],
    actorId: string,
  ) {
    this.validateAttributeInputs(inputs, definitions, categoryId);
    const byId = new Map(definitions.map((row) => [row.id, row]));
    for (const input of inputs) {
      const definition = byId.get(input.attributeDefinitionId.toLowerCase())!;
      const common = {
        productRevisionId: revisionId,
        categoryId,
        attributeDefinitionId: definition.id,
        valueType: definition.valueType,
        codeSnapshot: definition.code,
        labelSnapshot: definition.label,
        unitCodeSnapshot: definition.unitCode,
        unitLabelSnapshot: definition.unitLabel,
        filterableSnapshot: definition.filterable,
        searchableSnapshot: definition.searchable,
        comparableSnapshot: definition.comparable,
      };
      const typed =
        definition.valueType === 'TEXT'
          ? { textValue: input.value as string }
          : definition.valueType === 'DECIMAL'
            ? { numericValue: new Prisma.Decimal(input.value as string) }
            : definition.valueType === 'INTEGER'
              ? { numericValue: new Prisma.Decimal(String(input.value)) }
              : definition.valueType === 'BOOLEAN'
                ? { booleanValue: input.value as boolean }
                : {
                    enumCodeValue: (input.value as { code: string }).code,
                    enumLabelSnapshot: definition.enumOptions!.find(
                      ({ code }) =>
                        code === (input.value as { code: string }).code,
                    )!.label,
                  };
      await tx.productAttributeValue.create({ data: { ...common, ...typed } });
    }
    void actorId;
  }

  private async nextRevisionNumber(
    tx: Prisma.TransactionClient,
    productId: string,
  ) {
    const rows = await tx.$queryRaw<{ revisionNo: number }[]>`
      SELECT COALESCE(MAX(revision_no),0)::int + 1 AS "revisionNo"
      FROM catalog_product_revision WHERE product_id=${productId}::uuid
    `;
    return rows[0]?.revisionNo ?? 1;
  }

  private async latestRejected(
    tx: Prisma.TransactionClient,
    productId: string,
    publishedRevisionId: string | null,
  ) {
    const published = publishedRevisionId
      ? await tx.catalogProductRevision.findUnique({
          where: { id: publishedRevisionId },
          select: { createdAt: true },
        })
      : null;
    return tx.catalogProductRevision.findFirst({
      where: {
        productId,
        state: { in: ['RETURNED', 'REJECTED'] },
        ...(published ? { createdAt: { gt: published.createdAt } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { revisionNo: 'desc' }],
      select: { id: true, state: true, createdAt: true },
    });
  }

  private isAllowedBase(
    root: ProductRoot,
    baseId: string,
    baseState: string,
    baseCreatedAt: Date,
    latest: { id: string; state: string; createdAt: Date } | null,
  ) {
    if (root.currentDraftRevisionId)
      return baseId === root.currentDraftRevisionId && baseState === 'DRAFT';
    if (root.pendingRevisionId) return false;
    if (latest) return latest.id === baseId && latest.state === baseState;
    return (
      root.publishedRevisionId === baseId &&
      baseState === 'PUBLISHED' &&
      baseCreatedAt instanceof Date
    );
  }

  private async resolveDraftBase(
    tx: Prisma.TransactionClient,
    root: ProductRoot,
  ) {
    if (root.publicationState === 'ARCHIVED' || root.pendingRevisionId)
      throw new StaffError('INVALID_STATE_TRANSITION');
    let revisionId = root.currentDraftRevisionId;
    if (!revisionId) {
      const latest = await this.latestRejected(
        tx,
        root.id,
        root.publishedRevisionId,
      );
      revisionId = latest?.id ?? root.publishedRevisionId;
    }
    if (!revisionId) throw new StaffError('INVALID_STATE_TRANSITION');
    const revision = await tx.catalogProductRevision.findFirst({
      where: { id: revisionId, productId: root.id },
      include: {
        attributeValues: true,
        media: true,
        documents: true,
        sourceRelations: true,
      },
    });
    if (!revision) throw new StaffError('VERSION_CONFLICT');
    if (
      root.currentDraftRevisionId
        ? revision.state !== 'DRAFT'
        : !['PUBLISHED', 'RETURNED', 'REJECTED'].includes(revision.state)
    )
      throw new StaffError('VERSION_CONFLICT');
    return { revision };
  }

  private seedFromRevision(
    revision: RevisionRecord,
    values: AttributeValueRecord[],
  ): RevisionSeed {
    return {
      categoryId: revision.categoryId,
      brandId: revision.brandId,
      displayName: revision.displayName,
      summary: revision.summary,
      description: revision.description,
      manufacturerName: revision.manufacturerNameSnapshot,
      originalPartNumber: revision.originalPartNumberSnapshot,
      modification: revision.modificationSnapshot,
      attributes: values.map(toAttributeInput),
    };
  }

  private async updateRootForDraft(
    tx: Prisma.TransactionClient,
    root: ProductRoot,
    revisionId: string,
    seed: RevisionSeed,
  ) {
    await tx.catalogProduct.update({
      where: { id: root.id },
      data: {
        brandId: seed.brandId,
        manufacturerName: seed.manufacturerName,
        originalPartNumber: seed.originalPartNumber,
        modification: seed.modification,
        currentDraftRevisionId: revisionId,
        version: { increment: 1 },
        updatedAt: await this.now(tx),
      },
    });
  }

  private changedProductFields(
    seed: RevisionSeed,
    base: RevisionRecord & { attributeValues: AttributeValueRecord[] },
  ) {
    const fields: string[] = [];
    if (seed.brandId !== base.brandId) fields.push('brandId');
    if (seed.manufacturerName !== base.manufacturerNameSnapshot)
      fields.push('manufacturerName');
    if (seed.originalPartNumber !== base.originalPartNumberSnapshot)
      fields.push('originalPartNumber');
    if (seed.modification !== base.modificationSnapshot)
      fields.push('modification');
    if (seed.categoryId !== base.categoryId) fields.push('categoryId');
    if (seed.displayName !== base.displayName) fields.push('displayName');
    if (seed.summary !== base.summary) fields.push('summary');
    if (seed.description !== base.description) fields.push('description');
    if (
      this.attributeSignature(seed.attributes) !==
      this.attributeSignature(base.attributeValues.map(toAttributeInput))
    )
      fields.push('attributes');
    return fields.sort();
  }

  private attributeSignature(values: InputAttribute[]) {
    return JSON.stringify(
      values
        .map(({ attributeDefinitionId, valueType, value }) => ({
          attributeDefinitionId: attributeDefinitionId.toLowerCase(),
          valueType,
          value:
            value && typeof value === 'object' && !Array.isArray(value)
              ? { code: (value as { code: string }).code }
              : value,
        }))
        .sort((left, right) =>
          left.attributeDefinitionId.localeCompare(right.attributeDefinitionId),
        ),
    );
  }

  private sameRelations(
    current: {
      targetProductId: string;
      targetRevisionId: string;
      relationType: string;
      sortOrder: number;
    }[],
    requested: ReplaceCatalogProductRelationsDto['relations'],
  ) {
    const canonical = (rows: ReplaceCatalogProductRelationsDto['relations']) =>
      rows
        .map((row) => ({
          targetProductId: row.targetProductId.toLowerCase(),
          targetRevisionId: row.targetRevisionId.toLowerCase(),
          relationType: row.relationType,
          sortOrder: row.sortOrder,
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder);
    return (
      JSON.stringify(
        canonical(
          current.map((row) => ({
            targetProductId: row.targetProductId,
            targetRevisionId: row.targetRevisionId,
            relationType: row.relationType as RelationType,
            sortOrder: row.sortOrder,
          })),
        ),
      ) === JSON.stringify(canonical(requested))
    );
  }

  private sameMedia(
    current: {
      fileVersionId: string;
      altText: string;
      caption: string | null;
      sortOrder: number;
      isPrimary: boolean;
    }[],
    requested: CatalogProductMediaInputDto[],
  ) {
    const canonical = (rows: CatalogProductMediaInputDto[]) =>
      rows
        .map((row) => ({
          fileVersionId: row.fileVersionId.toLowerCase(),
          altText: clean(row.altText, 240, 'altText'),
          caption:
            row.caption == null ? null : clean(row.caption, 500, 'caption'),
          sortOrder: row.sortOrder,
          isPrimary: row.isPrimary,
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder);
    return (
      JSON.stringify(canonical(current)) ===
      JSON.stringify(canonical(requested))
    );
  }

  private sameDocuments(
    current: {
      fileVersionId: string;
      documentKind: string;
      displayName: string;
      locale: string | null;
      sortOrder: number;
    }[],
    requested: {
      fileVersionId: string;
      documentKind: string;
      displayName: string;
      locale: string | null;
      sortOrder: number;
    }[],
  ) {
    const canonical = (
      rows: {
        fileVersionId: string;
        documentKind: string;
        displayName: string;
        locale: string | null;
        sortOrder: number;
      }[],
    ) =>
      rows
        .map((row) => ({
          fileVersionId: row.fileVersionId.toLowerCase(),
          documentKind: row.documentKind,
          displayName: clean(row.displayName, 240, 'displayName'),
          locale: row.locale == null ? null : clean(row.locale, 35, 'locale'),
          sortOrder: row.sortOrder,
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder);
    return (
      JSON.stringify(canonical(current)) ===
      JSON.stringify(canonical(requested))
    );
  }

  private async copyMedia(
    tx: Prisma.TransactionClient,
    sourceRevisionId: string,
    targetRevisionId: string,
    actor: StaffPrincipal,
  ) {
    const rows = await tx.productMedia.findMany({
      where: { productRevisionId: sourceRevisionId },
      orderBy: [{ sortOrder: 'asc' }, { fileVersionId: 'asc' }],
    });
    for (const row of rows) {
      if (!(await this.fileAccessible(tx, actor, row.fileVersionId)))
        throw new StaffError('FILE_NOT_ACCESSIBLE');
      await tx.productMedia.create({
        data: {
          productRevisionId: targetRevisionId,
          fileVersionId: row.fileVersionId,
          altText: row.altText,
          caption: row.caption,
          sortOrder: row.sortOrder,
          isPrimary: row.isPrimary,
          createdByUserId: actor.id,
        },
      });
    }
  }

  private async copyDocuments(
    tx: Prisma.TransactionClient,
    sourceRevisionId: string,
    targetRevisionId: string,
    actor: StaffPrincipal,
  ) {
    const rows = await tx.productDocumentVersion.findMany({
      where: { productRevisionId: sourceRevisionId },
      orderBy: [{ sortOrder: 'asc' }, { fileVersionId: 'asc' }],
    });
    for (const row of rows) {
      if (!(await this.fileAccessible(tx, actor, row.fileVersionId)))
        throw new StaffError('FILE_NOT_ACCESSIBLE');
      await tx.productDocumentVersion.create({
        data: {
          productRevisionId: targetRevisionId,
          fileVersionId: row.fileVersionId,
          documentKind: row.documentKind,
          displayName: row.displayName,
          locale: row.locale,
          sortOrder: row.sortOrder,
          createdByUserId: actor.id,
        },
      });
    }
  }

  private async copyCurrentRelations(
    tx: Prisma.TransactionClient,
    sourceRevisionId: string,
    targetRevisionId: string,
    sourceProductId: string,
    actorId: string,
  ) {
    const rows = await tx.$queryRaw<
      {
        targetProductId: string;
        targetRevisionId: string;
        relationType: RelationType;
        sortOrder: number;
      }[]
    >`
      SELECT rel.target_product_id::text AS "targetProductId",
        rel.target_revision_id::text AS "targetRevisionId",
        rel.relation_type AS "relationType",rel.sort_order AS "sortOrder"
      FROM product_relation rel
      JOIN catalog_product target ON target.id=rel.target_product_id
        AND target.publication_state <> 'ARCHIVED'
        AND target.published_revision_id=rel.target_revision_id
      JOIN catalog_product_revision target_revision ON target_revision.id=rel.target_revision_id
        AND target_revision.product_id=target.id AND target_revision.state='PUBLISHED'
      WHERE rel.source_revision_id=${sourceRevisionId}::uuid
      ORDER BY rel.sort_order,rel.target_product_id,rel.relation_type
    `;
    for (const row of rows) {
      if (row.targetProductId === sourceProductId) continue;
      await tx.productRelation.create({
        data: {
          sourceRevisionId: targetRevisionId,
          targetProductId: row.targetProductId,
          targetRevisionId: row.targetRevisionId,
          relationType: row.relationType,
          sortOrder: row.sortOrder,
          createdByUserId: actorId,
        },
      });
    }
  }

  private async appendDraft(
    tx: Prisma.TransactionClient,
    root: ProductRoot,
    base: Prisma.CatalogProductRevisionGetPayload<{
      include: {
        attributeValues: true;
        media: true;
        documents: true;
        sourceRelations: true;
      };
    }>,
    actor: StaffPrincipal,
    replacement: {
      replaceRelations?: ReplaceCatalogProductRelationsDto['relations'];
      replaceMedia?: CatalogProductMediaInputDto[];
      replaceDocuments?: CatalogProductDocumentInputDto[];
    },
  ) {
    const seed = this.seedFromRevision(base, base.attributeValues);
    const refs = await this.lockReferences(
      tx,
      seed.brandId,
      seed.categoryId,
      seed.attributes.map(({ attributeDefinitionId }) => attributeDefinitionId),
    );
    if (
      refs.category?.state !== 'ACTIVE' ||
      (seed.brandId && refs.brand?.state !== 'ACTIVE')
    )
      throw new StaffError('REFERENCE_IN_USE');
    this.validateAttributeInputs(
      seed.attributes,
      refs.attributes,
      seed.categoryId,
    );
    const previousRelationCount = base.sourceRelations.length;
    const previousMediaCount = base.media.length;
    const previousDocumentCount = base.documents.length;
    const revisionId = randomUUID();
    const revisionNo = await this.nextRevisionNumber(tx, root.id);
    await this.updateRootForDraft(tx, root, revisionId, seed);
    if (root.currentDraftRevisionId)
      await tx.catalogProductRevision.update({
        where: { id: root.currentDraftRevisionId },
        data: { state: 'SUPERSEDED' },
      });
    await this.insertRevision(tx, {
      id: revisionId,
      productId: root.id,
      revisionNo,
      sourceRevisionId: base.id,
      seed,
      brand: refs.brand,
      category: refs.category,
      actorId: actor.id,
    });
    await this.insertAttributes(
      tx,
      revisionId,
      seed.categoryId,
      seed.attributes,
      refs.attributes,
      actor.id,
    );
    if (replacement.replaceMedia) {
      await this.insertMedia(
        tx,
        revisionId,
        replacement.replaceMedia,
        actor.id,
      );
    } else {
      await this.copyMedia(tx, base.id, revisionId, actor);
    }
    if (replacement.replaceDocuments) {
      await this.insertDocuments(
        tx,
        revisionId,
        replacement.replaceDocuments,
        actor.id,
      );
    } else {
      await this.copyDocuments(tx, base.id, revisionId, actor);
    }
    if (replacement.replaceRelations) {
      await this.insertRelations(
        tx,
        revisionId,
        replacement.replaceRelations,
        actor.id,
      );
    } else {
      await this.copyCurrentRelations(
        tx,
        base.id,
        revisionId,
        root.id,
        actor.id,
      );
    }
    return {
      revisionId,
      previousRelationCount,
      previousMediaCount,
      previousDocumentCount,
    };
  }

  private async insertMedia(
    tx: Prisma.TransactionClient,
    revisionId: string,
    items: CatalogProductMediaInputDto[],
    actorId: string,
  ) {
    for (const item of items)
      await tx.productMedia.create({
        data: {
          productRevisionId: revisionId,
          fileVersionId: uuid(item.fileVersionId, 'fileVersionId'),
          altText: clean(item.altText, 240, 'altText')!,
          caption:
            item.caption == null ? null : clean(item.caption, 500, 'caption'),
          sortOrder: item.sortOrder,
          isPrimary: item.isPrimary,
          createdByUserId: actorId,
        },
      });
  }

  private async insertDocuments(
    tx: Prisma.TransactionClient,
    revisionId: string,
    items: CatalogProductDocumentInputDto[],
    actorId: string,
  ) {
    for (const item of items)
      await tx.productDocumentVersion.create({
        data: {
          productRevisionId: revisionId,
          fileVersionId: uuid(item.fileVersionId, 'fileVersionId'),
          documentKind: item.documentKind,
          displayName: clean(item.displayName, 240, 'displayName')!,
          locale: item.locale == null ? null : clean(item.locale, 35, 'locale'),
          sortOrder: item.sortOrder,
          createdByUserId: actorId,
        },
      });
  }

  private async insertRelations(
    tx: Prisma.TransactionClient,
    revisionId: string,
    items: ReplaceCatalogProductRelationsDto['relations'],
    actorId: string,
  ) {
    for (const item of items)
      await tx.productRelation.create({
        data: {
          sourceRevisionId: revisionId,
          targetProductId: uuid(item.targetProductId, 'targetProductId'),
          targetRevisionId: uuid(item.targetRevisionId, 'targetRevisionId'),
          relationType: item.relationType,
          sortOrder: item.sortOrder,
          createdByUserId: actorId,
        },
      });
  }

  private validateMedia(items: CatalogProductMediaInputDto[]) {
    if (items.some((item) => !Object.hasOwn(item, 'caption')))
      throw validation('items.caption', 'REQUIRED');
    if (
      new Set(items.map(({ sortOrder }) => sortOrder)).size !== items.length ||
      new Set(items.map(({ fileVersionId }) => fileVersionId.toLowerCase()))
        .size !== items.length ||
      items.filter(({ isPrimary }) => isPrimary).length > 1
    )
      throw validation('items', 'DUPLICATE_OR_PRIMARY');
  }

  private validateDocuments(items: CatalogProductDocumentInputDto[]) {
    if (items.some((item) => !Object.hasOwn(item, 'locale')))
      throw validation('items.locale', 'REQUIRED');
    if (
      new Set(items.map(({ sortOrder }) => sortOrder)).size !== items.length ||
      new Set(items.map(({ fileVersionId }) => fileVersionId.toLowerCase()))
        .size !== items.length
    )
      throw validation('items', 'DUPLICATE_DOCUMENT');
  }

  private async fileAccessible(
    tx: Prisma.TransactionClient,
    actor: StaffPrincipal,
    fileVersionIdValue: string,
  ) {
    const fileVersionId = uuid(fileVersionIdValue, 'fileVersionId');
    const canReadSellers = (await effectivePermissions(tx, actor.id)).includes(
      'sellers.read',
    );
    const rows = await tx.$queryRaw<{ accessible: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM file_version v
        JOIN file_object o ON o.id=v.file_object_id
        WHERE v.id=${fileVersionId}::uuid AND o.state='ACTIVE'
          AND (
            o.owner_staff_user_id=${actor.id}::uuid
            OR (o.visibility='INTERNAL'
              AND ${canReadSellers}
              AND EXISTS (
                SELECT 1 FROM file_link l
                WHERE l.file_object_id=o.id AND l.visibility='INTERNAL'
              ))
          )
      ) AS accessible
    `;
    return rows[0]?.accessible === true;
  }

  async listPublicCategoryChildren(
    request: StaffRequest,
    parentSlugValue: unknown,
    cursorValue: unknown,
    pageSizeValue: unknown,
  ) {
    const pageSize = pageLimit(pageSizeValue, 24);
    const cursor = decodePublicCategoryCursor(cursorValue);
    const parentSlug =
      parentSlugValue === undefined ? undefined : String(parentSlugValue);
    if (
      parentSlug !== undefined &&
      (!SLUG.test(parentSlug) || parentSlug.length > 120)
    )
      throw validation('parentSlug', 'INVALID_SLUG');
    let parentId: string | null = null;
    if (parentSlug !== undefined) {
      const parent = await this.db.category.findFirst({
        where: { slug: parentSlug, state: 'ACTIVE' },
        select: { id: true },
      });
      if (!parent) throw new StaffError('NOT_FOUND');
      parentId = parent.id;
    }
    const after = cursor
      ? Prisma.sql`(sort_order,slug)>(${cursor.sortOrder},${cursor.slug})`
      : Prisma.sql`TRUE`;
    const rows = await this.db.$queryRaw<
      { slug: string; name: string; sortOrder: number }[]
    >`
      SELECT slug,name,sort_order AS "sortOrder"
      FROM category
      WHERE state='ACTIVE' AND parent_id IS NOT DISTINCT FROM ${parentId}::uuid
        AND ${after}
      ORDER BY sort_order ASC,slug ASC LIMIT ${pageSize + 1}
    `;
    const hasMore = rows.length > pageSize;
    const data = hasMore ? rows.slice(0, pageSize) : rows;
    return {
      data,
      meta: {
        requestId: request.requestId,
        pageSize,
        nextCursor: hasMore ? encodePublicCategoryCursor(data.at(-1)!) : null,
      },
    };
  }

  async searchPublicProducts(request: StaffRequest, queryValue: unknown) {
    const query =
      queryValue && typeof queryValue === 'object' && !Array.isArray(queryValue)
        ? (queryValue as Record<string, unknown>)
        : {};
    const allowed = new Set([
      'categorySlug',
      'includeDescendants',
      'brandSlug',
      'q',
      'filter',
      'page',
      'pageSize',
      'sort',
    ]);
    for (const key of Object.keys(query))
      if (!allowed.has(key)) throw validation(key, 'UNKNOWN_FIELD');
    const filters =
      query.filter === undefined
        ? []
        : Array.isArray(query.filter)
          ? query.filter
          : [query.filter];
    if (
      filters.length > 40 ||
      filters.some(
        (item) =>
          typeof item !== 'string' || item.length < 3 || item.length > 240,
      )
    )
      throw validation('filter', 'OUT_OF_RANGE');
    const parsedFilters = (filters as string[]).map((value) => {
      const first = value.indexOf(':');
      const second = value.indexOf(':', first + 1);
      if (first < 1 || second < first + 2 || second === value.length - 1)
        throw validation('filter', 'INVALID_FILTER');
      const code = value.slice(0, first);
      const operator = value.slice(first + 1, second);
      const filterValue = value.slice(second + 1);
      if (
        !ATTRIBUTE_CODE.test(code) ||
        !['eq', 'contains', 'gte', 'lte'].includes(operator)
      )
        throw validation('filter', 'INVALID_FILTER');
      return { code, operator, value: filterValue };
    });
    const filterKeys = parsedFilters.map(
      ({ code, operator }) => `${code}:${operator}`,
    );
    if (new Set(filterKeys).size !== filterKeys.length)
      throw validation('filter', 'DUPLICATE_FILTER');
    const categorySlug =
      query.categorySlug === undefined ? undefined : String(query.categorySlug);
    if (
      categorySlug !== undefined &&
      (!SLUG.test(categorySlug) || categorySlug.length > 120)
    )
      throw validation('categorySlug', 'INVALID_SLUG');
    let includeDescendants = true;
    if (query.includeDescendants !== undefined) {
      if (query.includeDescendants === 'true') includeDescendants = true;
      else if (query.includeDescendants === 'false') includeDescendants = false;
      else throw validation('includeDescendants', 'INVALID_BOOLEAN');
    }
    // OD-004A-06 requires this combination to fail before any category/attribute query.
    if (parsedFilters.length > 0 && (!categorySlug || includeDescendants))
      throw validation('filter', 'INCOMPATIBLE_CATEGORY_SCOPE');
    const page = pageNumber(query.page, 1, 10000, 'page');
    const pageSize = pageNumber(query.pageSize, 24, 100, 'pageSize');
    const sort = query.sort === undefined ? 'name_asc' : String(query.sort);
    if (
      !['name_asc', 'name_desc', 'brand_asc', 'part_number_asc'].includes(sort)
    )
      throw validation('sort', 'INVALID_ENUM');
    const q = query.q === undefined ? undefined : String(query.q);
    if (q !== undefined && Array.from(q).length > 128)
      throw validation('q', 'OUT_OF_RANGE');
    const searchText = q?.length ? q : undefined;
    const brandSlug =
      query.brandSlug === undefined ? undefined : String(query.brandSlug);
    if (
      brandSlug !== undefined &&
      (!SLUG.test(brandSlug) || brandSlug.length > 120)
    )
      throw validation('brandSlug', 'INVALID_SLUG');
    let category: { id: string } | null = null;
    if (categorySlug !== undefined) {
      category = await this.db.category.findFirst({
        where: { slug: categorySlug, state: 'ACTIVE' },
        select: { id: true },
      });
      if (!category) throw new StaffError('NOT_FOUND');
    }
    let brand: { id: string } | null = null;
    if (brandSlug !== undefined) {
      brand = await this.db.brand.findFirst({
        where: { slug: brandSlug, state: 'ACTIVE' },
        select: { id: true },
      });
      if (!brand) return this.emptyPublicPage(request, page, pageSize);
    }
    const definitions = parsedFilters.length
      ? await this.db.attributeDefinition.findMany({
          where: {
            categoryId: category!.id,
            state: 'ACTIVE',
            filterable: true,
            code: { in: [...new Set(parsedFilters.map(({ code }) => code))] },
          },
        })
      : [];
    const definitionByCode = new Map(
      definitions.map((definition) => [definition.code, definition]),
    );
    const filterConditions: Prisma.Sql[] = [];
    for (const filter of parsedFilters) {
      const definition = definitionByCode.get(filter.code);
      if (!definition) throw validation('filter', 'UNKNOWN_ATTRIBUTE');
      const type = definition.valueType;
      let predicate: Prisma.Sql;
      if (filter.operator === 'contains') {
        if (type !== 'TEXT') throw validation('filter', 'UNSUPPORTED_OPERATOR');
        predicate = Prisma.sql`strpos(lower(coalesce(v.text_value,'')),lower(${filter.value}))>0`;
      } else if (filter.operator === 'gte' || filter.operator === 'lte') {
        if (!['DECIMAL', 'INTEGER'].includes(type))
          throw validation('filter', 'UNSUPPORTED_OPERATOR');
        if (type === 'DECIMAL') {
          if (filter.value.length > 64 || !DECIMAL.test(filter.value))
            throw validation('filter', 'INVALID_DECIMAL');
        } else if (
          !/^(0|-?[1-9][0-9]*)$/.test(filter.value) ||
          !Number.isSafeInteger(Number(filter.value))
        ) {
          throw validation('filter', 'INVALID_INTEGER');
        }
        predicate =
          filter.operator === 'gte'
            ? Prisma.sql`v.numeric_value>=${filter.value}::numeric`
            : Prisma.sql`v.numeric_value<=${filter.value}::numeric`;
      } else {
        if (type === 'TEXT')
          predicate = Prisma.sql`v.text_value=${filter.value}`;
        else if (type === 'DECIMAL') {
          if (filter.value.length > 64 || !DECIMAL.test(filter.value))
            throw validation('filter', 'INVALID_DECIMAL');
          predicate = Prisma.sql`v.numeric_value=${filter.value}::numeric`;
        } else if (type === 'INTEGER') {
          if (
            !/^(0|-?[1-9][0-9]*)$/.test(filter.value) ||
            !Number.isSafeInteger(Number(filter.value))
          )
            throw validation('filter', 'INVALID_INTEGER');
          predicate = Prisma.sql`v.numeric_value=${filter.value}::numeric`;
        } else if (type === 'BOOLEAN') {
          if (filter.value !== 'true' && filter.value !== 'false')
            throw validation('filter', 'INVALID_BOOLEAN');
          predicate = Prisma.sql`v.boolean_value=${filter.value === 'true'}`;
        } else {
          if (
            !ENUM_CODE.test(filter.value) ||
            !Array.isArray(definition.enumOptions) ||
            !definition.enumOptions.some(
              (option) =>
                option !== null &&
                typeof option === 'object' &&
                'code' in option &&
                option.code === filter.value,
            )
          )
            throw validation('filter', 'INVALID_ENUM');
          predicate = Prisma.sql`v.enum_code_value=${filter.value}`;
        }
      }
      filterConditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM product_attribute_value v
        WHERE v.product_revision_id=r.id
          AND v.attribute_definition_id=${definition.id}::uuid
          AND v.category_id=${category!.id}::uuid AND ${predicate}
      )`);
    }
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p.publication_state<>'ARCHIVED' AND p.published_revision_id=r.id AND r.state='PUBLISHED'`,
      Prisma.sql`c.state='ACTIVE'`,
      Prisma.sql`(r.brand_id IS NULL OR b.state='ACTIVE')`,
    ];
    if (brand) conditions.push(Prisma.sql`r.brand_id=${brand.id}::uuid`);
    if (category) {
      conditions.push(
        includeDescendants
          ? Prisma.sql`r.category_id IN (
            WITH RECURSIVE descendants(id) AS (
              SELECT id FROM category WHERE id=${category.id}::uuid AND state='ACTIVE'
              UNION ALL
              SELECT child.id FROM category child JOIN descendants parent ON child.parent_id=parent.id
              WHERE child.state='ACTIVE'
            ) SELECT id FROM descendants
          )`
          : Prisma.sql`r.category_id=${category.id}::uuid`,
      );
    }
    if (searchText !== undefined)
      conditions.push(Prisma.sql`(
        strpos(lower(concat_ws(' ',r.display_name,b.name,r.manufacturer_name_snapshot,
          r.original_part_number_snapshot,r.modification_snapshot)),lower(${searchText}))>0
        OR EXISTS (SELECT 1 FROM product_attribute_value sv
          WHERE sv.product_revision_id=r.id AND sv.searchable_snapshot
            AND sv.value_type='TEXT' AND strpos(lower(coalesce(sv.text_value,'')),lower(${searchText}))>0)
        OR EXISTS (SELECT 1 FROM product_attribute_value sv
          WHERE sv.product_revision_id=r.id AND sv.searchable_snapshot
            AND sv.value_type='ENUM' AND strpos(lower(coalesce(sv.enum_label_snapshot,'')),lower(${searchText}))>0)
      )`);
    conditions.push(...filterConditions);
    const where = Prisma.join(conditions, ' AND ');
    const order =
      sort === 'name_desc'
        ? Prisma.sql`r.display_name DESC,p.slug ASC,p.id ASC`
        : sort === 'brand_asc'
          ? Prisma.sql`b.name ASC NULLS LAST,r.display_name ASC,p.slug ASC,p.id ASC`
          : sort === 'part_number_asc'
            ? Prisma.sql`r.original_part_number_snapshot ASC NULLS LAST,r.display_name ASC,p.slug ASC,p.id ASC`
            : Prisma.sql`r.display_name ASC,p.slug ASC,p.id ASC`;
    const from = Prisma.sql`
      FROM catalog_product p
      JOIN catalog_product_revision r ON r.id=p.published_revision_id AND r.product_id=p.id
      JOIN category c ON c.id=r.category_id
      LEFT JOIN brand b ON b.id=r.brand_id
      WHERE ${where}
    `;
    const countRows = await this.db.$queryRaw<
      { total: bigint }[]
    >`SELECT count(*)::bigint AS total ${from}`;
    const rows = await this.db.$queryRaw<PublicCardRow[]>`
      SELECT p.slug,r.display_name AS "displayName",r.manufacturer_name_snapshot AS "manufacturerName",
        r.original_part_number_snapshot AS "originalPartNumber",r.modification_snapshot AS modification,
        b.name AS "brandName",b.slug AS "brandSlug",c.name AS "categoryName",c.slug AS "categorySlug"
      ${from}
      ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;
    const total = Number(countRows[0]?.total ?? 0n);
    return {
      data: rows.map((row) => this.publicCard(row)),
      meta: {
        requestId: request.requestId,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getPublicProduct(request: StaffRequest, slugValue: string) {
    const slug = slugValue;
    if (!SLUG.test(slug) || slug.length > 160)
      throw validation('slug', 'INVALID_SLUG');
    return this.db.$transaction(
      async (tx) => {
        const row = await this.findPublicCard(tx, slug);
        if (!row) throw new StaffError('NOT_FOUND');
        const revisionRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT r.id::text AS id FROM catalog_product p
      JOIN catalog_product_revision r ON r.id=p.published_revision_id AND r.product_id=p.id
      WHERE p.slug=${slug} AND p.publication_state<>'ARCHIVED' AND r.state='PUBLISHED'
    `;
        const revisionId = revisionRows[0]?.id;
        if (!revisionId) throw new StaffError('NOT_FOUND');
        const values = await tx.$queryRaw<PublicAttributeRow[]>`
      SELECT code_snapshot AS "attributeCode",label_snapshot AS label,value_type AS "valueType",
        text_value AS "textValue",numeric_value::text AS "numericValue",
        boolean_value AS "booleanValue",enum_code_value AS "enumCodeValue",
        enum_label_snapshot AS "enumLabel",unit_code_snapshot AS "unitCode",
        unit_label_snapshot AS "unitLabel",comparable_snapshot AS comparable
      FROM product_attribute_value WHERE product_revision_id=${revisionId}::uuid
      ORDER BY code_snapshot,attribute_definition_id
    `;
        const relationRows = await tx.$queryRaw<PublicRelationRow[]>`
      SELECT rel.relation_type AS "relationType",target.slug,
        target_revision.display_name AS "displayName",
        target_revision.manufacturer_name_snapshot AS "manufacturerName",
        target_revision.original_part_number_snapshot AS "originalPartNumber",
        target_revision.modification_snapshot AS modification,
        target_brand.name AS "brandName",target_brand.slug AS "brandSlug",
        target_category.name AS "categoryName",target_category.slug AS "categorySlug"
      FROM product_relation rel
      JOIN catalog_product target ON target.id=rel.target_product_id
        AND target.publication_state<>'ARCHIVED' AND target.published_revision_id=rel.target_revision_id
      JOIN catalog_product_revision target_revision ON target_revision.id=rel.target_revision_id
        AND target_revision.product_id=target.id AND target_revision.state='PUBLISHED'
      JOIN category target_category ON target_category.id=target_revision.category_id
        AND target_category.state='ACTIVE'
      LEFT JOIN brand target_brand ON target_brand.id=target_revision.brand_id
        AND target_brand.state='ACTIVE'
      WHERE rel.source_revision_id=${revisionId}::uuid
      ORDER BY rel.sort_order,rel.relation_type,target.slug
      LIMIT 100
    `;
        return {
          data: {
            ...this.publicCard(row),
            summary: row.summary,
            description: row.description,
            attributes: values.map((value) => this.publicAttribute(value)),
            relations: relationRows.map((relation) => ({
              relationType: relation.relationType,
              target: this.publicCard(relation),
            })),
          },
          meta: { requestId: request.requestId },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async findPublicCard(tx: Prisma.TransactionClient, slug: string) {
    const rows = await tx.$queryRaw<PublicCardRow[]>`
      SELECT p.slug,r.display_name AS "displayName",r.summary,r.description,
        r.manufacturer_name_snapshot AS "manufacturerName",
        r.original_part_number_snapshot AS "originalPartNumber",
        r.modification_snapshot AS modification,
        b.name AS "brandName",b.slug AS "brandSlug",c.name AS "categoryName",c.slug AS "categorySlug"
      FROM catalog_product p
      JOIN catalog_product_revision r ON r.id=p.published_revision_id AND r.product_id=p.id
      JOIN category c ON c.id=r.category_id AND c.state='ACTIVE'
      LEFT JOIN brand b ON b.id=r.brand_id AND b.state='ACTIVE'
      WHERE p.slug=${slug} AND p.publication_state<>'ARCHIVED'
        AND p.published_revision_id IS NOT NULL AND r.state='PUBLISHED'
        AND (r.brand_id IS NULL OR b.id IS NOT NULL)
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private publicCard(row: PublicCardRow) {
    return {
      slug: row.slug,
      displayName: row.displayName,
      brand:
        row.brandName === null || row.brandSlug === null
          ? null
          : { name: row.brandName, slug: row.brandSlug },
      manufacturerName: row.manufacturerName,
      originalPartNumber: row.originalPartNumber,
      modification: row.modification,
      category: { name: row.categoryName, slug: row.categorySlug },
      priceDisplay: { kind: 'ON_REQUEST', label: 'Цена по запросу' },
    };
  }

  private publicAttribute(row: PublicAttributeRow) {
    const base = {
      attributeCode: row.attributeCode,
      label: row.label,
      valueType: row.valueType as AttrType,
      unitCode: row.unitCode,
      unitLabel: row.unitLabel,
      comparable: row.comparable,
    };
    const value =
      row.valueType === 'TEXT'
        ? row.textValue
        : row.valueType === 'DECIMAL'
          ? row.numericValue
          : row.valueType === 'INTEGER'
            ? Number(row.numericValue)
            : row.valueType === 'BOOLEAN'
              ? row.booleanValue
              : { code: row.enumCodeValue, label: row.enumLabel };
    return { ...base, value };
  }

  private emptyPublicPage(
    request: StaffRequest,
    page: number,
    pageSize: number,
  ) {
    return {
      data: [],
      meta: {
        requestId: request.requestId,
        page,
        pageSize,
        total: 0,
        totalPages: 0,
      },
    };
  }

  private async currentEditorRevisionId(
    productIdValue: string,
    client: Prisma.TransactionClient | PrismaDatabase = this.db,
  ) {
    const productId = uuid(productIdValue, 'productId');
    const root = await client.catalogProduct.findUnique({
      where: { id: productId },
      select: {
        currentDraftRevisionId: true,
        pendingRevisionId: true,
        publishedRevisionId: true,
      },
    });
    if (!root) throw new StaffError('NOT_FOUND');
    return (
      root.currentDraftRevisionId ??
      root.pendingRevisionId ??
      root.publishedRevisionId
    );
  }

  private serializeRevision(
    revision: Prisma.CatalogProductRevisionGetPayload<{
      include: { attributeValues: true };
    }>,
  ) {
    return {
      id: revision.id,
      revisionNo: revision.revisionNo,
      state: revision.state,
      sourceRevisionId: revision.sourceRevisionId,
      categoryId: revision.categoryId,
      displayName: revision.displayName,
      summary: revision.summary,
      description: revision.description,
      brandId: revision.brandId,
      brandNameSnapshot: revision.brandNameSnapshot,
      brandSlugSnapshot: revision.brandSlugSnapshot,
      categoryNameSnapshot: revision.categoryNameSnapshot,
      categorySlugSnapshot: revision.categorySlugSnapshot,
      manufacturerNameSnapshot: revision.manufacturerNameSnapshot,
      originalPartNumberSnapshot: revision.originalPartNumberSnapshot,
      modificationSnapshot: revision.modificationSnapshot,
      attributes: revision.attributeValues.map((value) =>
        this.publicAttribute({
          attributeCode: value.codeSnapshot,
          label: value.labelSnapshot,
          valueType: value.valueType as AttrType,
          textValue: value.textValue,
          numericValue: value.numericValue?.toString() ?? null,
          booleanValue: value.booleanValue,
          enumCodeValue: value.enumCodeValue,
          enumLabel: value.enumLabelSnapshot,
          unitCode: value.unitCodeSnapshot,
          unitLabel: value.unitLabelSnapshot,
          comparable: value.comparableSnapshot,
        }),
      ),
      createdByUserId: revision.createdByUserId,
      createdAt: revision.createdAt.toISOString(),
      submittedByUserId: revision.submittedByUserId,
      submittedAt: revision.submittedAt?.toISOString() ?? null,
      decidedByUserId: revision.decidedByUserId,
      decidedAt: revision.decidedAt?.toISOString() ?? null,
      decision: revision.decision,
      decisionReason: revision.decisionReason,
      publishedAt: revision.publishedAt?.toISOString() ?? null,
    };
  }
}

interface PublicCardRow {
  slug: string;
  displayName: string;
  summary?: string | null;
  description?: string | null;
  manufacturerName: string | null;
  originalPartNumber: string | null;
  modification: string | null;
  brandName: string | null;
  brandSlug: string | null;
  categoryName: string;
  categorySlug: string;
}

interface PublicAttributeRow {
  attributeCode: string;
  label: string;
  valueType: AttrType;
  textValue: string | null;
  numericValue: string | null;
  booleanValue: boolean | null;
  enumCodeValue: string | null;
  enumLabel: string | null;
  unitCode: string | null;
  unitLabel: string | null;
  comparable: boolean;
}

interface PublicRelationRow extends PublicCardRow {
  relationType: RelationType;
}
