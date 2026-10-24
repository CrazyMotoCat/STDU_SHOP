import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService, createAuditEvent } from '../audit/audit.service.js';
import { DATABASE, PrismaDatabase } from '../database/database.module.js';
import { Prisma } from '../generated/prisma/client.js';
import { assertCurrentActor } from '../permissions/policy.js';
import { StaffError } from '../identity/errors.js';
import type { StaffPrincipal, StaffRequest } from '../identity/request.js';
import {
  CreateCatalogAttributeDto,
  CreateCatalogBrandDto,
  CreateCatalogCategoryDto,
  PatchCatalogAttributeDto,
  PatchCatalogBrandDto,
  PatchCatalogCategoryDto,
  VersionCommandDto,
} from './catalog.dto.js';

const categoryTreeLock = { first: 1398031445, second: 3 } as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPTION_CODE_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/;

interface StaffCursor {
  createdAt: string;
  id: string;
}

interface ReferenceRow {
  id: string;
  createdAtCursor: string;
}

interface CategoryRow extends ReferenceRow {
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
  state: string;
  sortOrder: number;
  version: number;
}

interface BrandRow extends ReferenceRow {
  slug: string;
  name: string;
  state: string;
  version: number;
}

interface AttributeRow extends ReferenceRow {
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
  version: number;
}

interface CommandResult<T> {
  value: T;
  entityType?: string;
  entityId?: string;
  changes?: Record<string, unknown>;
  skipAudit?: boolean;
}

function normalizedName(value: string) {
  return value.normalize('NFC').trim();
}

function decodeCursor(value: unknown): StaffCursor | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw validation('cursor', 'INVALID_CURSOR');
  try {
    const decodedText = Buffer.from(value, 'base64url').toString('utf8');
    const decoded: unknown = JSON.parse(decodedText);
    if (
      Buffer.from(decodedText).toString('base64url') !== value ||
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
      !UUID_PATTERN.test(record.id)
    )
      throw new Error();
    return { createdAt: record.createdAt, id: record.id.toLowerCase() };
  } catch {
    throw validation('cursor', 'INVALID_CURSOR');
  }
}

function encodeCursor(row: ReferenceRow) {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAtCursor, id: row.id }),
    'utf8',
  ).toString('base64url');
}

function pageWhere(cursor: StaffCursor | undefined, categoryId?: string) {
  const conditions: Prisma.Sql[] = [];
  if (categoryId)
    conditions.push(Prisma.sql`category_id = ${categoryId}::uuid`);
  if (cursor)
    conditions.push(
      Prisma.sql`(created_at, id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  return conditions.length
    ? Prisma.join(conditions, ' AND ')
    : Prisma.sql`TRUE`;
}

function pageSize(value: unknown) {
  const parsed =
    value === undefined
      ? 50
      : typeof value === 'string' && /^[0-9]{1,3}$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100)
    throw validation('limit', 'OUT_OF_RANGE');
  return parsed;
}

function validation(field: string, code: string) {
  return new StaffError('VALIDATION_ERROR', [{ field, code }]);
}

function id(value: string) {
  if (!UUID_PATTERN.test(value)) throw validation('id', 'INVALID_UUID');
  return value.toLowerCase();
}

function sortedFields(fields: string[]) {
  return [...new Set(fields)].sort();
}

function validNullableText(value: string | null | undefined, max: number) {
  return (
    value == null ||
    (typeof value === 'string' && Array.from(value).length <= max)
  );
}

function catalogAttributeOptions(
  input: CreateCatalogAttributeDto,
): { code: string; label: string }[] | null {
  const options = input.enumOptions ?? null;
  const numeric =
    input.valueType === 'DECIMAL' || input.valueType === 'INTEGER';
  if (input.valueType === 'ENUM') {
    if (!Array.isArray(options) || options.length < 1 || options.length > 200)
      throw validation('enumOptions', 'REQUIRED_FOR_ENUM');
    const seen = new Set<string>();
    for (const option of options) {
      const code = option?.code;
      const label = option?.label;
      if (
        typeof code !== 'string' ||
        !OPTION_CODE_PATTERN.test(code) ||
        typeof label !== 'string' ||
        Array.from(label.trim()).length < 1 ||
        Array.from(label).length > 160 ||
        seen.has(code)
      )
        throw validation('enumOptions', 'INVALID_ENUM_OPTIONS');
      seen.add(code);
    }
  } else if (options !== null) {
    throw validation('enumOptions', 'ONLY_ENUM_SUPPORTED');
  }
  if (
    numeric
      ? !(
          (input.unitCode == null && input.unitLabel == null) ||
          (typeof input.unitCode === 'string' &&
            input.unitCode.trim().length > 0 &&
            Array.from(input.unitCode).length <= 32 &&
            typeof input.unitLabel === 'string' &&
            input.unitLabel.trim().length > 0 &&
            Array.from(input.unitLabel).length <= 48)
        )
      : input.unitCode != null || input.unitLabel != null
  )
    throw validation('unitCode', 'INVALID_UNIT_FOR_TYPE');
  return (
    options?.map(({ code, label }) => ({
      code,
      label: normalizedName(label),
    })) ?? null
  );
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DATABASE) private readonly db: PrismaDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listCategories(
    request: StaffRequest,
    limitValue: unknown,
    cursorValue: unknown,
  ) {
    const limit = pageSize(limitValue);
    const cursor = decodeCursor(cursorValue);
    const after = cursor
      ? Prisma.sql`(created_at, id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      : Prisma.sql`TRUE`;
    const rows = await this.db.$queryRaw<CategoryRow[]>`
      SELECT id::text AS id, parent_id::text AS "parentId", slug, name,
        description, state, sort_order AS "sortOrder", version,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtCursor"
      FROM category WHERE ${after}
      ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}
    `;
    const hasMore = rows.length > limit;
    const dataRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: dataRows.map((row) => {
        const { createdAtCursor, ...output } = row;
        void createdAtCursor;
        return output;
      }),
      meta: {
        requestId: request.requestId,
        limit,
        nextCursor: hasMore ? encodeCursor(dataRows.at(-1)!) : null,
      },
    };
  }

  async getCategory(request: StaffRequest, categoryId: string) {
    const row = await this.db.category.findUnique({
      where: { id: id(categoryId) },
    });
    if (!row) throw new StaffError('NOT_FOUND');
    return { data: row, meta: { requestId: request.requestId } };
  }

  async createCategory(request: StaffRequest, input: CreateCatalogCategoryDto) {
    const categoryId = randomUUID();
    const parentId = input.parentId == null ? null : id(input.parentId);
    const name = normalizedName(input.name);
    const description =
      input.description == null ? null : input.description.trim();
    if (
      name.length < 1 ||
      Array.from(name).length > 160 ||
      !validNullableText(description, 2000) ||
      !SLUG_PATTERN.test(input.slug) ||
      !Number.isInteger(input.sortOrder ?? 0) ||
      (input.sortOrder ?? 0) < 0 ||
      (input.sortOrder ?? 0) > 2147483647
    )
      throw validation('category', 'INVALID_VALUE');
    const row = await this.command(
      request,
      'catalog.categories.write',
      'catalog.reference.changed',
      'Category',
      async (tx) => {
        await lockCategoryTree(tx);
        if (parentId) {
          await lockCategoryRows(tx, [parentId]);
          const parent = await tx.category.findUnique({
            where: { id: parentId },
          });
          if (!parent || parent.state !== 'ACTIVE')
            throw new StaffError('CATEGORY_INACTIVE_PARENT');
        }
        const created = await tx.category.create({
          data: {
            id: categoryId,
            parentId,
            slug: input.slug,
            name,
            description,
            sortOrder: input.sortOrder ?? 0,
            state: 'ACTIVE',
          },
        });
        return {
          value: { id: created.id, version: created.version },
          entityId: created.id,
          changes: {
            changedFields: sortedFields([
              'description',
              'name',
              'parentId',
              'slug',
              'sortOrder',
            ]),
            version: created.version,
            previousParentId: null,
            parentId: created.parentId,
            state: created.state,
          },
        };
      },
    );
    return this.mutation(request, row);
  }

  async patchCategory(
    request: StaffRequest,
    categoryIdValue: string,
    input: PatchCatalogCategoryDto,
  ) {
    const categoryId = id(categoryIdValue);
    const name =
      input.name === undefined ? undefined : normalizedName(input.name);
    const description =
      input.description === undefined
        ? undefined
        : input.description === null
          ? null
          : input.description.trim();
    if (
      (name !== undefined &&
        (name.length < 1 || Array.from(name).length > 160)) ||
      (description !== undefined && !validNullableText(description, 2000)) ||
      (input.sortOrder !== undefined &&
        (!Number.isInteger(input.sortOrder) ||
          input.sortOrder < 0 ||
          input.sortOrder > 2147483647))
    )
      throw validation('category', 'INVALID_VALUE');
    const result = await this.command(
      request,
      'catalog.categories.write',
      'catalog.reference.changed',
      'Category',
      async (tx) => {
        await lockCategoryTree(tx);
        const initial = await tx.category.findUnique({
          where: { id: categoryId },
          select: { parentId: true },
        });
        if (!initial) throw new StaffError('NOT_FOUND');
        const newParentId =
          input.parentId === undefined
            ? initial.parentId
            : input.parentId === null
              ? null
              : id(input.parentId);
        await lockCategoryRows(
          tx,
          [categoryId, initial.parentId, newParentId].filter(
            (value): value is string => value !== null,
          ),
        );
        const current = await tx.category.findUnique({
          where: { id: categoryId },
        });
        if (!current) throw new StaffError('NOT_FOUND');
        if (current.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (current.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const changedFields: string[] = [];
        if (input.parentId !== undefined && newParentId !== current.parentId)
          changedFields.push('parentId');
        if (name !== undefined && name !== current.name)
          changedFields.push('name');
        if (description !== undefined && description !== current.description)
          changedFields.push('description');
        if (
          input.sortOrder !== undefined &&
          input.sortOrder !== current.sortOrder
        )
          changedFields.push('sortOrder');
        if (!changedFields.length)
          return {
            value: { id: current.id, version: current.version },
            skipAudit: true,
          };
        if (newParentId) {
          const parent = await tx.category.findUnique({
            where: { id: newParentId },
          });
          if (!parent || parent.state !== 'ACTIVE')
            throw new StaffError('CATEGORY_INACTIVE_PARENT');
          if (newParentId === current.id)
            throw new StaffError('CATEGORY_CYCLE');
          const cycle = await tx.$queryRaw<{ cycle: boolean }[]>`
            WITH RECURSIVE descendants(id) AS (
              SELECT id FROM category WHERE parent_id=${current.id}::uuid
              UNION ALL
              SELECT c.id FROM category c JOIN descendants d ON c.parent_id=d.id
            )
            SELECT EXISTS(SELECT 1 FROM descendants WHERE id=${newParentId}::uuid) AS cycle
          `;
          if (cycle[0]?.cycle) throw new StaffError('CATEGORY_CYCLE');
        }
        const updated = await tx.category.update({
          where: { id: current.id },
          data: {
            ...(input.parentId !== undefined ? { parentId: newParentId } : {}),
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(input.sortOrder !== undefined
              ? { sortOrder: input.sortOrder }
              : {}),
            version: { increment: 1 },
            updatedAt: await this.now(tx),
          },
        });
        return {
          value: { id: updated.id, version: updated.version },
          entityId: updated.id,
          changes: {
            changedFields: sortedFields(changedFields),
            version: updated.version,
            ...(input.parentId !== undefined
              ? {
                  previousParentId: current.parentId,
                  parentId: updated.parentId,
                }
              : {}),
            previousState: current.state,
            state: updated.state,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async archiveCategory(
    request: StaffRequest,
    categoryIdValue: string,
    input: VersionCommandDto,
  ) {
    const categoryId = id(categoryIdValue);
    const result = await this.command(
      request,
      'catalog.categories.write',
      'catalog.reference.changed',
      'Category',
      async (tx) => {
        await lockCategoryTree(tx);
        const children = await tx.category.findMany({
          where: { parentId: categoryId, state: 'ACTIVE' },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        await lockCategoryRows(tx, [
          categoryId,
          ...children.map(({ id: childId }) => childId),
        ]);
        const current = await tx.category.findUnique({
          where: { id: categoryId },
        });
        if (!current) throw new StaffError('NOT_FOUND');
        if (current.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (current.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const activeChildren = await tx.category.count({
          where: { parentId: categoryId, state: 'ACTIVE' },
        });
        const currentProductUse = await tx.$queryRaw<{ used: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM catalog_product p
            JOIN catalog_product_revision r ON r.id=p.current_draft_revision_id AND r.product_id=p.id
            WHERE p.publication_state <> 'ARCHIVED' AND r.category_id=${categoryId}::uuid
            UNION ALL
            SELECT 1 FROM catalog_product p
            JOIN catalog_product_revision r ON r.id=p.pending_revision_id AND r.product_id=p.id
            WHERE p.publication_state <> 'ARCHIVED' AND r.category_id=${categoryId}::uuid
            UNION ALL
            SELECT 1 FROM catalog_product p
            JOIN catalog_product_revision r ON r.id=p.published_revision_id AND r.product_id=p.id
            WHERE p.publication_state <> 'ARCHIVED' AND r.category_id=${categoryId}::uuid
          ) AS used
        `;
        if (activeChildren > 0 || currentProductUse[0]?.used)
          throw new StaffError('REFERENCE_IN_USE');
        const updated = await tx.category.update({
          where: { id: categoryId },
          data: {
            state: 'ARCHIVED',
            version: { increment: 1 },
            updatedAt: await this.now(tx),
          },
        });
        return {
          value: { id: updated.id, version: updated.version },
          entityId: updated.id,
          changes: {
            changedFields: ['state'],
            previousState: current.state,
            state: updated.state,
            version: updated.version,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async listBrands(
    request: StaffRequest,
    limitValue: unknown,
    cursorValue: unknown,
  ) {
    const limit = pageSize(limitValue);
    const cursor = decodeCursor(cursorValue);
    const after = cursor
      ? Prisma.sql`(created_at, id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      : Prisma.sql`TRUE`;
    const rows = await this.db.$queryRaw<BrandRow[]>`
      SELECT id::text AS id, slug, name, state, version,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtCursor"
      FROM brand WHERE ${after || Prisma.sql`TRUE`}
      ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}
    `;
    const hasMore = rows.length > limit;
    const dataRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: dataRows.map((row) => {
        const { createdAtCursor, ...output } = row;
        void createdAtCursor;
        return output;
      }),
      meta: {
        requestId: request.requestId,
        limit,
        nextCursor: hasMore ? encodeCursor(dataRows.at(-1)!) : null,
      },
    };
  }

  async getBrand(request: StaffRequest, brandId: string) {
    const row = await this.db.brand.findUnique({ where: { id: id(brandId) } });
    if (!row) throw new StaffError('NOT_FOUND');
    return { data: row, meta: { requestId: request.requestId } };
  }

  async createBrand(request: StaffRequest, input: CreateCatalogBrandDto) {
    const name = normalizedName(input.name);
    if (
      name.length < 1 ||
      Array.from(name).length > 160 ||
      !SLUG_PATTERN.test(input.slug)
    )
      throw validation('brand', 'INVALID_VALUE');
    const result = await this.command(
      request,
      'catalog.brands.write',
      'catalog.reference.changed',
      'Brand',
      async (tx) => {
        const created = await tx.brand.create({
          data: {
            id: randomUUID(),
            slug: input.slug,
            name,
            state: 'ACTIVE',
          },
        });
        return {
          value: { id: created.id, version: created.version },
          entityId: created.id,
          changes: {
            changedFields: ['name', 'slug'],
            state: created.state,
            version: created.version,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async patchBrand(
    request: StaffRequest,
    brandIdValue: string,
    input: PatchCatalogBrandDto,
  ) {
    const brandId = id(brandIdValue);
    const name =
      input.name === undefined ? undefined : normalizedName(input.name);
    if (
      name !== undefined &&
      (name.length < 1 || Array.from(name).length > 160)
    )
      throw validation('name', 'OUT_OF_RANGE');
    const result = await this.command(
      request,
      'catalog.brands.write',
      'catalog.reference.changed',
      'Brand',
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM brand WHERE id=${brandId}::uuid FOR UPDATE`;
        const current = await tx.brand.findUnique({ where: { id: brandId } });
        if (!current) throw new StaffError('NOT_FOUND');
        if (current.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (current.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (name === undefined || name === current.name)
          return {
            value: { id: current.id, version: current.version },
            skipAudit: true,
          };
        const updated = await tx.brand.update({
          where: { id: current.id },
          data: {
            name,
            version: { increment: 1 },
            updatedAt: await this.now(tx),
          },
        });
        return {
          value: { id: updated.id, version: updated.version },
          entityId: updated.id,
          changes: {
            changedFields: ['name'],
            previousState: current.state,
            state: updated.state,
            version: updated.version,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async archiveBrand(
    request: StaffRequest,
    brandIdValue: string,
    input: VersionCommandDto,
  ) {
    const brandId = id(brandIdValue);
    const result = await this.command(
      request,
      'catalog.brands.write',
      'catalog.reference.changed',
      'Brand',
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM brand WHERE id=${brandId}::uuid FOR UPDATE`;
        const current = await tx.brand.findUnique({ where: { id: brandId } });
        if (!current) throw new StaffError('NOT_FOUND');
        if (current.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (current.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const inUse = await tx.catalogProduct.count({
          where: { brandId, publicationState: { not: 'ARCHIVED' } },
        });
        if (inUse > 0) throw new StaffError('REFERENCE_IN_USE');
        const updated = await tx.brand.update({
          where: { id: brandId },
          data: {
            state: 'ARCHIVED',
            version: { increment: 1 },
            updatedAt: await this.now(tx),
          },
        });
        return {
          value: { id: updated.id, version: updated.version },
          entityId: updated.id,
          changes: {
            changedFields: ['state'],
            previousState: current.state,
            state: updated.state,
            version: updated.version,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async listAttributes(
    request: StaffRequest,
    limitValue: unknown,
    cursorValue: unknown,
    categoryIdValue: unknown,
  ) {
    const limit = pageSize(limitValue);
    const cursor = decodeCursor(cursorValue);
    const categoryId =
      categoryIdValue === undefined ? undefined : id(String(categoryIdValue));
    const filter = pageWhere(cursor, categoryId);
    const rows = await this.db.$queryRaw<AttributeRow[]>`
      SELECT id::text AS id, category_id::text AS "categoryId", code, label,
        value_type AS "valueType", unit_code AS "unitCode", unit_label AS "unitLabel",
        enum_options AS "enumOptions", filterable, searchable, comparable, state, version,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtCursor"
      FROM attribute_definition
      WHERE ${filter}
      ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}
    `;
    const hasMore = rows.length > limit;
    const dataRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: dataRows.map((row) => {
        const { createdAtCursor, ...output } = row;
        void createdAtCursor;
        return output;
      }),
      meta: {
        requestId: request.requestId,
        limit,
        nextCursor: hasMore ? encodeCursor(dataRows.at(-1)!) : null,
      },
    };
  }

  async getAttribute(request: StaffRequest, attributeId: string) {
    const row = await this.db.attributeDefinition.findUnique({
      where: { id: id(attributeId) },
    });
    if (!row) throw new StaffError('NOT_FOUND');
    return { data: row, meta: { requestId: request.requestId } };
  }

  async createAttribute(
    request: StaffRequest,
    input: CreateCatalogAttributeDto,
  ) {
    const categoryId = id(input.categoryId);
    const label = normalizedName(input.label);
    const options = catalogAttributeOptions(input);
    if (label.length < 1 || Array.from(label).length > 160)
      throw validation('label', 'OUT_OF_RANGE');
    const result = await this.command(
      request,
      'catalog.attributes.write',
      'catalog.reference.changed',
      'AttributeDefinition',
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM category WHERE id=${categoryId}::uuid FOR SHARE`;
        const category = await tx.category.findUnique({
          where: { id: categoryId },
        });
        if (!category || category.state !== 'ACTIVE')
          throw new StaffError('CATEGORY_INACTIVE_PARENT');
        const created = await tx.attributeDefinition.create({
          data: {
            id: randomUUID(),
            categoryId,
            code: input.code,
            label,
            valueType: input.valueType,
            unitCode: input.unitCode?.trim() || null,
            unitLabel: input.unitLabel?.trim() || null,
            enumOptions:
              options === null
                ? Prisma.DbNull
                : (options as Prisma.InputJsonValue),
            filterable: input.filterable,
            searchable: input.searchable,
            comparable: input.comparable,
            state: 'ACTIVE',
          },
        });
        return {
          value: { id: created.id, version: created.version },
          entityId: created.id,
          changes: {
            changedFields: sortedFields([
              'categoryId',
              'code',
              'comparable',
              'enumOptions',
              'filterable',
              'label',
              'searchable',
              'unitCode',
              'unitLabel',
              'valueType',
            ]),
            state: created.state,
            version: created.version,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async patchAttribute(
    request: StaffRequest,
    attributeIdValue: string,
    input: PatchCatalogAttributeDto,
  ) {
    const attributeId = id(attributeIdValue);
    const label =
      input.label === undefined ? undefined : normalizedName(input.label);
    if (
      label !== undefined &&
      (label.length < 1 || Array.from(label).length > 160)
    )
      throw validation('label', 'OUT_OF_RANGE');
    const result = await this.command(
      request,
      'catalog.attributes.write',
      'catalog.reference.changed',
      'AttributeDefinition',
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM attribute_definition WHERE id=${attributeId}::uuid FOR UPDATE`;
        const current = await tx.attributeDefinition.findUnique({
          where: { id: attributeId },
        });
        if (!current) throw new StaffError('NOT_FOUND');
        if (current.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (current.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const changedFields: string[] = [];
        if (label !== undefined && label !== current.label)
          changedFields.push('label');
        for (const field of ['filterable', 'searchable', 'comparable'] as const)
          if (input[field] !== undefined && input[field] !== current[field])
            changedFields.push(field);
        if (!changedFields.length)
          return {
            value: { id: current.id, version: current.version },
            skipAudit: true,
          };
        const updated = await tx.attributeDefinition.update({
          where: { id: current.id },
          data: {
            ...(label !== undefined ? { label } : {}),
            ...(input.filterable !== undefined
              ? { filterable: input.filterable }
              : {}),
            ...(input.searchable !== undefined
              ? { searchable: input.searchable }
              : {}),
            ...(input.comparable !== undefined
              ? { comparable: input.comparable }
              : {}),
            version: { increment: 1 },
            updatedAt: await this.now(tx),
          },
        });
        return {
          value: { id: updated.id, version: updated.version },
          entityId: updated.id,
          changes: {
            changedFields: sortedFields(changedFields),
            previousState: current.state,
            state: updated.state,
            version: updated.version,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  async archiveAttribute(
    request: StaffRequest,
    attributeIdValue: string,
    input: VersionCommandDto,
  ) {
    const attributeId = id(attributeIdValue);
    const result = await this.command(
      request,
      'catalog.attributes.write',
      'catalog.reference.changed',
      'AttributeDefinition',
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM attribute_definition WHERE id=${attributeId}::uuid FOR UPDATE`;
        const current = await tx.attributeDefinition.findUnique({
          where: { id: attributeId },
        });
        if (!current) throw new StaffError('NOT_FOUND');
        if (current.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (current.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const updated = await tx.attributeDefinition.update({
          where: { id: current.id },
          data: {
            state: 'ARCHIVED',
            version: { increment: 1 },
            updatedAt: await this.now(tx),
          },
        });
        return {
          value: { id: updated.id, version: updated.version },
          entityId: updated.id,
          changes: {
            changedFields: ['state'],
            previousState: current.state,
            state: updated.state,
            version: updated.version,
          },
        };
      },
    );
    return this.mutation(request, result);
  }

  private mutation(
    request: StaffRequest,
    value: { id: string; version: number },
  ) {
    return { data: value, meta: { requestId: request.requestId } };
  }

  private async command<T>(
    request: StaffRequest,
    permission: string,
    auditAction: string,
    entityType: string,
    work: (tx: Prisma.TransactionClient) => Promise<CommandResult<T>>,
  ) {
    const actor = this.principal(request);
    try {
      return await this.db.$transaction(
        async (tx) => {
          const actorPermissions = await assertCurrentActor(
            tx,
            actor,
            permission,
          );
          void actorPermissions;
          const result = await work(tx);
          if (!result.skipAudit)
            try {
              await createAuditEvent(tx, {
                actorKind: 'STAFF',
                actorUserId: actor.id,
                action: auditAction,
                entityType: result.entityType ?? entityType,
                entityId: result.entityId ?? null,
                outcome: 'SUCCESS',
                reasonCode: null,
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
      const mapped = this.mapCommandError(error, auditAction);
      if (
        !(mapped instanceof StaffError) ||
        mapped.code !== 'AUDIT_UNAVAILABLE'
      )
        await this.deny(request, auditAction, mapped);
      throw mapped;
    }
  }

  private async deny(request: StaffRequest, action: string, error: unknown) {
    const actor = this.principal(request);
    const code = error instanceof StaffError ? error.code : 'INTERNAL_ERROR';
    const allowed = new Set([
      'AUTH_REQUIRED',
      'FORBIDDEN',
      'PASSWORD_CHANGE_REQUIRED',
      'ORIGIN_FORBIDDEN',
      'CSRF_INVALID',
      'UNSUPPORTED_MEDIA_TYPE',
      'VALIDATION_ERROR',
      'NOT_FOUND',
      'VERSION_CONFLICT',
      'CATEGORY_CYCLE',
      'CATEGORY_INACTIVE_PARENT',
      'REFERENCE_IN_USE',
    ]);
    const auditCode = allowed.has(code)
      ? code
      : code === 'INTERNAL_ERROR' || code === 'DEPENDENCY_UNAVAILABLE'
        ? code
        : 'VALIDATION_ERROR';
    await this.audit.writeDenied({
      actorKind: 'STAFF',
      actorUserId: actor.id,
      action,
      outcome:
        auditCode === 'INTERNAL_ERROR' || auditCode === 'DEPENDENCY_UNAVAILABLE'
          ? 'FAILURE'
          : 'DENIED',
      reasonCode: auditCode,
      requestId: request.requestId,
    });
  }

  private mapCommandError(error: unknown, action: string) {
    if (error instanceof StaffError) return error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = JSON.stringify(error.meta?.target ?? '');
        if (target.includes('slug')) return new StaffError('SLUG_CONFLICT');
        if (target.includes('category_id') && target.includes('code'))
          return new StaffError('REFERENCE_IN_USE');
        if (action.startsWith('catalog.product'))
          return new StaffError('IDENTITY_CONFLICT');
        return new StaffError('VERSION_CONFLICT');
      }
      if (error.code === 'P2025') return new StaffError('NOT_FOUND');
      if (error.code === 'P2003') return new StaffError('REFERENCE_IN_USE');
      if (error.code === 'P2034') return new StaffError('VERSION_CONFLICT');
    }
    const diagnostic =
      error instanceof Error ? error.message : String(error ?? 'unknown');
    for (const code of [
      'CATEGORY_CYCLE',
      'CATEGORY_INACTIVE_PARENT',
      'ATTRIBUTE_NOT_APPLICABLE',
      'REFERENCE_IN_USE',
      'INVALID_STATE_TRANSITION',
      'VERSION_CONFLICT',
    ] as const)
      if (diagnostic.includes(code)) return new StaffError(code);
    return new StaffError('DEPENDENCY_UNAVAILABLE');
  }

  private principal(request: StaffRequest): StaffPrincipal {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    return request.staff;
  }

  private async now(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ now: Date }[]>`
      SELECT clock_timestamp() AS now
    `;
    if (!rows[0]) throw new StaffError('DEPENDENCY_UNAVAILABLE');
    return rows[0].now;
  }
}

async function lockCategoryTree(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(${categoryTreeLock.first}, ${categoryTreeLock.second})::text
  `;
}

async function lockCategoryRows(tx: Prisma.TransactionClient, ids: string[]) {
  for (const categoryId of [...new Set(ids)].sort())
    await tx.$queryRaw`
      SELECT id FROM category WHERE id=${categoryId}::uuid FOR UPDATE
    `;
}
