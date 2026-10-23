import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const frozenBaseline = '28d9a85aa82dc4bf3c116e16ca6a3973a9d7bc6e';
const approvedSourceSha = '8ae4dd8cfd15e3722d97259818b238924851c963';
const methods = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
]);
const forbiddenModels = new Set([
  'Supplier',
  'SupplierOffer',
  'IngestionRun',
  'ImportJob',
  'PricingRule',
]);
const forbiddenPublicProperties = new Set([
  'amount',
  'audit',
  'auditEvent',
  'cost',
  'createdByUserId',
  'currentDraftRevisionId',
  'decision',
  'documents',
  'draft',
  'downloadUrl',
  'fileId',
  'fileVersionId',
  'fileUrl',
  'internalComment',
  'margin',
  'media',
  'priceAmount',
  'provenance',
  'publishedRevisionId',
  'purchasePrice',
  'sourceUrl',
  'staffUserId',
  'storageKey',
  'supplier',
  'supplierId',
]);

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

export async function loadCatalogContract() {
  const [
    model,
    rbac,
    openapi,
    audit,
    frozenRbac,
    frozenAudit,
    decisions,
    matrix,
    modelMarkdown,
    rbacMarkdown,
    implementationPlan,
  ] = await Promise.all([
    json('docs/contracts/R1-004-catalog-data-model.json'),
    json('docs/contracts/R1-004-catalog-rbac-matrix.json'),
    json('docs/contracts/R1-004-catalog.openapi.json'),
    json('docs/contracts/R1-004-catalog-audit-registry.json'),
    json('docs/contracts/R1-002-rbac-matrix.json'),
    json('docs/contracts/R1-002-audit-registry.json'),
    readFile(resolve(root, 'docs/plans/R1-004A-contract-decisions.md'), 'utf8'),
    readFile(resolve(root, 'docs/contracts/R1-004B-test-matrix.md'), 'utf8'),
    readFile(
      resolve(root, 'docs/contracts/R1-004-catalog-data-model.md'),
      'utf8',
    ),
    readFile(
      resolve(root, 'docs/contracts/R1-004-catalog-rbac-matrix.md'),
      'utf8',
    ),
    readFile(
      resolve(root, 'docs/plans/R1-004B-implementation-plan.md'),
      'utf8',
    ),
  ]);
  return {
    model,
    rbac,
    openapi,
    audit,
    frozenRbac,
    frozenAudit,
    frozenRbacSnapshot: structuredClone(frozenRbac),
    frozenAuditSnapshot: structuredClone(frozenAudit),
    decisions,
    matrix,
    modelMarkdown,
    rbacMarkdown,
    implementationPlan,
  };
}

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function operationEntries(document) {
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(
        ([method, operation]) => methods.has(method) && operation?.operationId,
      )
      .map(([method, operation]) => ({
        path,
        method: method.toUpperCase(),
        operation,
      })),
  );
}

function referencedProperties(document, schema, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return [];
  if (schema.$ref?.startsWith('#/components/schemas/')) {
    const name = schema.$ref.slice('#/components/schemas/'.length);
    if (seen.has(name)) return [];
    seen.add(name);
    return referencedProperties(
      document,
      document.components.schemas[name],
      seen,
    );
  }
  const propertyEntries = Object.entries(schema.properties ?? {});
  const own = propertyEntries.map(([name]) => name);
  const nested = ['allOf', 'oneOf', 'anyOf'].flatMap((key) =>
    (schema[key] ?? []).flatMap((item) =>
      referencedProperties(document, item, seen),
    ),
  );
  nested.push(
    ...propertyEntries.flatMap(([, value]) =>
      referencedProperties(document, value, seen),
    ),
  );
  if (schema.items)
    nested.push(...referencedProperties(document, schema.items, seen));
  return [...own, ...nested];
}

export function validateCatalogContract(bundle) {
  const {
    model,
    rbac,
    openapi,
    audit,
    frozenRbac,
    frozenAudit,
    frozenRbacSnapshot,
    frozenAuditSnapshot,
    decisions,
    matrix,
    modelMarkdown,
    rbacMarkdown,
    implementationPlan,
  } = bundle;
  const expectedPermissions = [
    'catalog.references.read',
    'catalog.products.read',
    'catalog.products.write',
    'catalog.products.submit',
    'catalog.products.publish',
    'catalog.products.archive',
    'catalog.categories.write',
    'catalog.brands.write',
    'catalog.attributes.write',
    'catalog.products.relations.write',
    'catalog.products.media.write',
    'catalog.products.documents.write',
  ];
  const modelEntities = [
    'Brand',
    'Category',
    'AttributeDefinition',
    'CatalogProduct',
    'CatalogProductRevision',
    'ProductAttributeValue',
    'ProductMedia',
    'ProductDocumentVersion',
    'ProductRelation',
  ];

  requireThat(
    model.status === 'FROZEN' && model.version === '1.0.0',
    'R1-004 data model must remain FROZEN 1.0.0.',
  );
  requireThat(
    rbac.status === 'FROZEN' && rbac.version === '1.0.0',
    'R1-004 RBAC must remain FROZEN 1.0.0.',
  );
  requireThat(
    audit.status === 'FROZEN' && audit.version === '1.0.0',
    'R1-004 audit registry must remain FROZEN 1.0.0.',
  );
  requireThat(
    [model, rbac, audit].every(
      (artifact) => artifact.approvedSourceSha === approvedSourceSha,
    ) &&
      [decisions, matrix, modelMarkdown, rbacMarkdown].every(
        (document) =>
          document.includes('Статус: FROZEN. Версия: 1.0.0.') &&
          document.includes(approvedSourceSha),
      ) &&
      implementationPlan.includes('FROZEN R1-004 1.0.0') &&
      implementationPlan.includes(approvedSourceSha),
    'FROZEN R1-004 artifacts and documentation must retain the exact owner-approved source SHA and version.',
  );
  requireThat(
    model.baseline === frozenBaseline && rbac.baseline === frozenBaseline,
    'Contract baseline differs from R1-004A source main SHA.',
  );
  requireThat(
    JSON.stringify(Object.keys(model.tables)) === JSON.stringify(modelEntities),
    'Catalog entity set differs from the proposed R1-004 model.',
  );
  requireThat(
    model.tables.Category.deletePolicy.includes(
      'current draft, pending or published revision',
    ) &&
      model.tables.Category.deletePolicy.includes('do not block archive') &&
      matrix.includes(
        'исторические non-current returned/rejected/superseded revisions не блокируют архив',
      ),
    'Category archive usage must be based on current pointers while preserving non-current history.',
  );
  requireThat(
    model.identity.revisionSynchronization?.includes('same transaction') &&
      model.identity.revisionSynchronization.includes(
        'first successful submit freezes',
      ) &&
      model.identity.revisionSynchronization.includes(
        'Root/revision identity mismatch aborts the transaction',
      ),
    'Root and revision identity must stay synchronized transactionally until the first submit and immutable afterwards.',
  );
  requireThat(
    !Object.keys(model.tables).some((name) => forbiddenModels.has(name)),
    'Out-of-scope supplier, ingestion or pricing table was added.',
  );
  requireThat(
    JSON.stringify(Object.keys(rbac.permissions).sort()) ===
      JSON.stringify([...expectedPermissions].sort()),
    'Catalog permission set must contain exactly the proposed 12 permissions.',
  );
  requireThat(
    JSON.stringify(Object.keys(rbac.actions).sort()) ===
      JSON.stringify([...expectedPermissions].sort()),
    'Every catalog permission must have exactly one action mapping.',
  );
  requireThat(
    rbac.deniedByDefault === true && rbac.changesProtectedR1_002Sets === false,
    'Catalog RBAC must remain default-deny and preserve frozen sets.',
  );
  requireThat(
    rbac.initialGrant?.oneTime?.includes(
      'At most one successful initialization',
    ) || rbac.initialGrant?.oneTime?.includes('one successful initialization'),
    'Initial catalog permission grant must remain explicitly one-time.',
  );
  requireThat(
    JSON.stringify(rbac.initialGrant?.catalogPermissionCodes) ===
      JSON.stringify(expectedPermissions) &&
      rbac.initialGrant.catalogPermissionCodesMustMatchRegistryExactly ===
        true &&
      !/every registered/i.test(rbac.initialGrant.role),
    'Initial grant must be pinned to this contract exact 12 codes and fail closed on registry drift.',
  );
  requireThat(
    rbac.initialGrant.ownerApprovalReference ===
      'Required external ticket/reference label, 1..80 characters matching ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$. Must not contain secrets or personal data. The CLI records the label only; it does not resolve or prove the approval.',
    'Initial grant approval reference must be a bounded non-secret external label, not proof.',
  );

  requireThat(
    JSON.stringify(frozenRbac) === JSON.stringify(frozenRbacSnapshot),
    'Frozen R1-002 RBAC contract was edited during this proposed extension.',
  );
  requireThat(
    JSON.stringify(frozenAudit) === JSON.stringify(frozenAuditSnapshot),
    'Frozen R1-002 audit contract was edited during this proposed extension.',
  );
  const frozenPermissionCodes = Object.keys(frozenRbac.permissions ?? {});
  requireThat(
    frozenPermissionCodes.length === 12,
    'Frozen R1-002 permission registry must retain its 12 permissions.',
  );
  requireThat(
    !frozenPermissionCodes.some((permission) =>
      expectedPermissions.includes(permission),
    ),
    'Catalog permission leaked into frozen R1-002 registry.',
  );
  const actions = new Map();
  for (const [permission, entries] of Object.entries(rbac.actions)) {
    for (const item of entries) {
      const key = `${item.method} ${item.path}`;
      requireThat(!actions.has(key), `Duplicate RBAC action mapping: ${key}.`);
      actions.set(key, permission);
    }
  }
  const operations = operationEntries(openapi);
  const staff = operations.filter(({ path }) =>
    path.startsWith('/v1/staff/catalog/'),
  );
  const publicOperations = operations.filter(({ path }) =>
    path.startsWith('/v1/public/catalog/'),
  );
  requireThat(
    staff.length === 28,
    `Expected 28 staff catalog operations, found ${staff.length}.`,
  );
  requireThat(
    publicOperations.length === 3,
    `Expected 3 public catalog operations, found ${publicOperations.length}.`,
  );
  requireThat(
    operations.length === staff.length + publicOperations.length,
    'Unexpected operation outside the catalog route groups.',
  );
  const publicCategories = openapi.paths['/v1/public/catalog/categories'].get;
  const categoryParameters = new Map(
    publicCategories.parameters.map((item) => [
      openapi.components.parameters[item.$ref.split('/').at(-1)].name,
      openapi.components.parameters[item.$ref.split('/').at(-1)],
    ]),
  );
  const categoryResponse =
    openapi.components.schemas.PublicCatalogCategoryListResponse;
  const categoryItemSchema = categoryResponse.properties.data.items;
  const cursorMeta = openapi.components.schemas.PublicCategoryCursorPageMeta;
  const cursorSchema = categoryParameters.get('cursor')?.schema;
  requireThat(
    publicCategories.operationId === 'listPublicCatalogCategoryChildren' &&
      categoryParameters.get('parentSlug')?.required === false &&
      !categoryParameters.has('page') &&
      cursorSchema?.maxLength === 256 &&
      cursorSchema.pattern === '^[A-Za-z0-9_-]+$' &&
      categoryParameters.get('pageSize')?.schema?.maximum === 100 &&
      categoryResponse.properties.data.maxItems === 100 &&
      categoryResponse.properties.meta.$ref ===
        '#/components/schemas/PublicCategoryCursorPageMeta' &&
      cursorMeta.required.includes('nextCursor') &&
      cursorMeta.properties.nextCursor.type.includes('null') &&
      cursorMeta.properties.nextCursor.maxLength === 256 &&
      openapi.components.schemas.CatalogCategory.properties.sortOrder
        .minimum === 0 &&
      openapi.components.schemas.CatalogCategory.properties.sortOrder
        .maximum === 2147483647 &&
      openapi.components.schemas.CreateCatalogCategory.properties.sortOrder
        .minimum === 0 &&
      openapi.components.schemas.CreateCatalogCategory.properties.sortOrder
        .maximum === 2147483647 &&
      openapi.components.schemas.PatchCatalogCategory.properties.sortOrder
        .minimum === 0 &&
      openapi.components.schemas.PatchCatalogCategory.properties.sortOrder
        .maximum === 2147483647 &&
      openapi.components.schemas.PublicCatalogCategory.properties.sortOrder
        .minimum === 0 &&
      openapi.components.schemas.PublicCatalogCategory.properties.sortOrder
        .maximum === 2147483647 &&
      categoryItemSchema.$ref ===
        '#/components/schemas/PublicCatalogCategory' &&
      model.tables.Category.indexes.some(
        (index) =>
          JSON.stringify(index) ===
          JSON.stringify(['parentId', 'state', 'sortOrder', 'slug']),
      ) &&
      model.tables.Category.checks.includes('sortOrder >= 0') &&
      !openapi.components.schemas.PublicCatalogCategory.properties.children &&
      publicCategories['x-invariants']?.some((text) =>
        /ACTIVE direct children/.test(text),
      ) &&
      publicCategories['x-invariants']?.some(
        (text) =>
          /keyset cursor/.test(text) &&
          /sortOrder ASC then slug ASC/.test(text),
      ) &&
      publicCategories['x-invariants']?.some((text) =>
        /no page-number ceiling/.test(text),
      ),
    'Public category navigation must return a bounded, non-recursive keyset page of active direct children with no page-number ceiling.',
  );

  const staffParameterNames = (operation) =>
    new Set(
      (operation.parameters ?? []).map((item) => item.$ref.split('/').at(-1)),
    );
  const expectedStaffListParameters = {
    '/v1/staff/catalog/categories': ['StaffLimit', 'StaffCursor'],
    '/v1/staff/catalog/brands': ['StaffLimit', 'StaffCursor'],
    '/v1/staff/catalog/attributes': [
      'StaffLimit',
      'StaffCursor',
      'CategoryIdQuery',
    ],
    '/v1/staff/catalog/products': [
      'StaffLimit',
      'StaffCursor',
      'ProductState',
      'CategoryIdQuery',
    ],
  };
  for (const [path, names] of Object.entries(expectedStaffListParameters)) {
    const actual = staffParameterNames(openapi.paths[path].get);
    requireThat(
      names.every((name) => actual.has(name)),
      `Staff collection ${path} is missing pagination or filter parameters.`,
    );
  }
  const staffProductList = openapi.paths['/v1/staff/catalog/products'].get;
  const staffProductListInvariant = (
    staffProductList['x-invariants'] ?? []
  ).join(' ');
  requireThat(
    staffProductListInvariant.includes('currentDraftRevisionId') &&
      staffProductListInvariant.includes('pendingRevisionId') &&
      staffProductListInvariant.includes('publishedRevisionId') &&
      staffProductListInvariant.includes('same pointer-selected revision') &&
      staffProductListInvariant.includes(
        'Non-current historical revisions never satisfy',
      ) &&
      staffProductListInvariant.includes(
        'The ARCHIVED + categoryId combination is rejected with VALIDATION_ERROR',
      ) &&
      openapi.components.parameters.ProductState.description.includes(
        'ARCHIVED matches root CatalogProduct.publicationState',
      ) &&
      openapi.components.parameters.CategoryIdQuery.description.includes(
        'Combining categoryId with ARCHIVED is rejected with VALIDATION_ERROR',
      ) &&
      staffProductList.responses['400']?.$ref ===
        '#/components/responses/ValidationError',
    'Staff product list state/category filters must use the owner-selected current pointer semantics.',
  );
  requireThat(
    openapi.components.parameters.StaffCursor.schema.maxLength === 256 &&
      openapi.components.parameters.StaffCursor.schema.pattern ===
        '^[A-Za-z0-9_-]+$' &&
      openapi.components.schemas.CatalogCategoryListResponse.properties.meta
        .properties.nextCursor.pattern === '^[A-Za-z0-9_-]+$' &&
      matrix.includes('CATB-37') &&
      matrix.includes('malformed or oversized'),
    'Pagination cursors must be size/alphabet constrained and their malformed-input runtime test retained.',
  );
  requireThat(
    openapi['x-pagination']?.public?.includes(
      'no total count or page-number ceiling',
    ),
    'OpenAPI pagination summary must distinguish unbounded category cursor continuation from public product offset pages.',
  );

  const operationIds = new Set();
  const auditActions = new Set(Object.keys(audit.actions));
  for (const { path, method, operation } of staff) {
    const key = `${method} ${path}`;
    requireThat(
      actions.get(key) === operation['x-permission'],
      `OpenAPI permission differs from RBAC for ${key}.`,
    );
    requireThat(
      operationIds.add(operation.operationId),
      `Duplicate operationId ${operation.operationId}.`,
    );
    requireThat(
      JSON.stringify(operation.security) ===
        JSON.stringify([{ staffCookie: [] }]),
      `Staff operation lacks frozen staff cookie auth: ${key}.`,
    );
    requireThat(
      operation.responses?.['401'] &&
        operation.responses?.['403'] &&
        operation.responses?.['500'],
      `Staff operation lacks standard security/error responses: ${key}.`,
    );
    if (method !== 'GET') {
      const names = (operation.parameters ?? []).map((item) => item.$ref);
      requireThat(
        names.includes('#/components/parameters/OriginHeader') &&
          names.includes('#/components/parameters/CsrfHeader'),
        `Unsafe staff operation lacks Origin/CSRF: ${key}.`,
      );
      requireThat(
        operation['x-csrf'] === 'STAFF_BOUND' &&
          operation['x-audit'] !== 'none',
        `Unsafe staff operation lacks CSRF/audit policy: ${key}.`,
      );
      requireThat(
        auditActions.has(operation['x-audit']),
        `Staff mutation references an undeclared catalog audit action: ${key}.`,
      );
    } else {
      requireThat(
        operation['x-csrf'] === 'NONE' && operation['x-audit'] === 'none',
        `Staff GET must be read-only: ${key}.`,
      );
    }
    if (path.endsWith('/media') || path.endsWith('/documents')) {
      const required = operation['x-required-permissions'] ?? [
        operation['x-permission'],
      ];
      requireThat(
        required.includes('files.metadata.read'),
        `File metadata operation lacks frozen files.metadata.read: ${key}.`,
      );
    }
  }
  requireThat(
    actions.size === staff.length,
    'RBAC action map contains missing or extra routes compared with OpenAPI.',
  );
  requireThat(
    [...actions.keys()].every((key) =>
      staff.some(({ path, method }) => key === `${method} ${path}`),
    ),
    'RBAC map contains a route absent from OpenAPI.',
  );
  requireThat(
    openapi['x-contract-status'] === 'FROZEN' &&
      openapi.info.version === '1.0.0' &&
      openapi['x-approved-source-sha'] === approvedSourceSha &&
      openapi.info.description.includes(approvedSourceSha),
    'OpenAPI contract must remain FROZEN 1.0.0 with exact owner-approved provenance.',
  );
  requireThat(
    openapi['x-frozen-contracts']?.includes('R1-002 1.0.0'),
    'OpenAPI must identify FROZEN R1-002 1.0.0.',
  );
  const patchProduct =
    openapi.paths['/v1/staff/catalog/products/{productId}']?.patch;
  const patchProductSchema =
    openapi.components.schemas.PatchCatalogProductDraft;
  requireThat(
    patchProductSchema?.required?.includes('baseRevisionId') &&
      patchProductSchema.properties?.baseRevisionId?.format === 'uuid' &&
      patchProduct['x-invariants']?.some((text) =>
        /latest RETURNED\/REJECTED revision/.test(text),
      ) &&
      patchProduct['x-invariants']?.some((text) =>
        /current published revision/.test(text),
      ) &&
      patchProduct['x-invariants']?.some((text) => /SUPERSEDED/.test(text)),
    'Product PATCH must define explicit revision bases for draft replacement, post-publish edits and retry after review.',
  );
  requireThat(
    model.tables.CatalogProductRevision.fields.state.includes('SUPERSEDED') &&
      model.tables.CatalogProductRevision.uniqueIndexes?.some((text) =>
        text.includes("WHERE state='DRAFT'"),
      ) &&
      model.tables.CatalogProductRevision.uniqueIndexes?.some((text) =>
        text.includes("WHERE state='PENDING_REVIEW'"),
      ),
    'Revision state/index contract must support one active draft and pending revision with superseded history.',
  );
  const archiveProduct =
    openapi.paths['/v1/staff/catalog/products/{productId}/archive'].post;
  requireThat(
    model.tables.CatalogProduct.archiveMutation.includes(
      'clear publishedRevisionId, pendingRevisionId and currentDraftRevisionId',
    ) &&
      model.tables.CatalogProduct.checks.includes(
        'publicationState=ARCHIVED requires publishedRevisionId, pendingRevisionId and currentDraftRevisionId all NULL',
      ) &&
      model.tables.CatalogProduct.deletePolicy.includes(
        'archive clears root current pointers but preserves immutable revisions',
      ) &&
      model.tables.CatalogProduct.archiveMutation.includes(
        'withdraw a pending revision as WITHDRAWN',
      ) &&
      archiveProduct['x-invariants']?.some(
        (text) =>
          text.includes(
            'clears publishedRevisionId, pendingRevisionId and currentDraftRevisionId',
          ) && text.includes('withdraws a pending revision as WITHDRAWN'),
      ) &&
      archiveProduct.responses['400']?.$ref ===
        '#/components/responses/ValidationError',
    'Product archive must withdraw pending work, clear every current pointer, and preserve history in both model and API contract.',
  );
  requireThat(
    model.rules.workflowMutation?.includes('deferred transaction guards') &&
      model.rules.workflowMutation.includes(
        'temporarily nulls currentDraftRevisionId',
      ) &&
      model.rules.draftBaseSelection?.includes(
        'highest revisionNo RETURNED/REJECTED',
      ) &&
      model.rules.draftBaseSelection.includes(
        'after the current published revision',
      ),
    'Draft transition ordering and allowed base revision selection must be transactionally explicit.',
  );
  requireThat(
    model.tables.ProductAttributeValue.fields.textValue.includes(
      'varchar(240)',
    ) &&
      model.rules.textAttributes.includes('240 Unicode characters') &&
      model.rules.referenceLocks.includes('FOR SHARE') &&
      model.rules.referenceLocks.includes('FOR UPDATE') &&
      model.rules.relationLocks.includes('sorted UUID order'),
    'Bounded attributes and transaction-safe reference/relation locks must be explicit.',
  );
  const categoryMutation = model.tables.Category.treeMutation;
  requireThat(
    categoryMutation.includes('ACTIVE parent') &&
      categoryMutation.includes('CATEGORY_INACTIVE_PARENT') &&
      categoryMutation.includes('FOR UPDATE'),
    'Category create/reparent must check active parent state under row lock.',
  );
  const catalogErrorCodes =
    openapi.components.schemas.CatalogError.properties.code.enum;
  const categoryValidationCodes =
    openapi.components.responses.ValidationError['x-error-codes'];
  requireThat(
    catalogErrorCodes.includes('CATEGORY_INACTIVE_PARENT') &&
      categoryValidationCodes.includes('CATEGORY_INACTIVE_PARENT') &&
      audit.commonOutcomes.DENIED.includes('CATEGORY_INACTIVE_PARENT') &&
      audit.actions['catalog.reference.changed'].outcomes.DENIED.includes(
        'CATEGORY_INACTIVE_PARENT',
      ),
    'Inactive category parent rejection must be representable in OpenAPI and the audit outcomes.',
  );
  requireThat(
    matrix.includes('CATEGORY_INACTIVE_PARENT') &&
      matrix.includes('pg_blocking_pids') &&
      matrix.includes('CATB-35') &&
      matrix.includes('CATB-36') &&
      matrix.includes('CATB-37') &&
      matrix.includes('CATB-38') &&
      matrix.includes('CATB-38') &&
      matrix.includes('no recursive `children` payload'),
    'Category parent and database race tests must cover archived parents and observe actual blocking.',
  );
  const categoryArchiveInvariant =
    openapi.paths['/v1/staff/catalog/categories/{categoryId}/archive'].post[
      'x-invariants'
    ]?.join(' ') ?? '';
  requireThat(
    categoryArchiveInvariant.includes(
      'current draft, pending or published revision pointers',
    ) &&
      categoryArchiveInvariant.includes(
        'non-current historical revisions do not block archive',
      ),
    'Category archive API must use current product pointers and preserve historical revisions.',
  );
  requireThat(
    model.tables.ProductRelation.foreignKeys?.some((text) =>
      text.includes('(targetRevisionId, targetProductId) REFERENCES'),
    ) &&
      model.tables.ProductRelation.guards?.some((text) =>
        text.includes('transaction guard, not CHECK'),
      ),
    'ProductRelation must use one pair composite FK and transaction guards for cross-table invariants.',
  );

  const expectedPublicPaths = [
    '/v1/public/catalog/categories',
    '/v1/public/catalog/products',
    '/v1/public/catalog/products/{slug}',
  ];
  requireThat(
    JSON.stringify(
      Object.keys(openapi.paths)
        .filter((path) => path.startsWith('/v1/public/'))
        .sort(),
    ) === JSON.stringify(expectedPublicPaths.sort()),
    'Public catalog route set differs from the proposed three read-only routes.',
  );
  for (const { path, method, operation } of publicOperations) {
    requireThat(
      method === 'GET' &&
        JSON.stringify(operation.security) === JSON.stringify([]),
      `Public operation must be unauthenticated GET: ${method} ${path}.`,
    );
    requireThat(
      operation.responses?.['200'] && operation.responses?.['404'],
      `Public operation lacks standard success/404 responses: ${path}.`,
    );
    const publicSchemas = Object.values(
      operation.responses['200'].content ?? {},
    ).flatMap((content) => referencedProperties(openapi, content.schema));
    const leaks = publicSchemas.filter((property) =>
      forbiddenPublicProperties.has(property),
    );
    requireThat(
      leaks.length === 0,
      `Public DTO references forbidden fields: ${[...new Set(leaks)].join(', ')}.`,
    );
  }
  requireThat(
    openapi.components.schemas.PublicCatalogProduct.properties.description,
    'Public detail DTO must include CAT-03 product description.',
  );
  requireThat(
    openapi.components.schemas.PublicCatalogProduct.properties.relations,
    'Public detail DTO must include manual CAT-03 relations.',
  );
  requireThat(
    openapi.components.schemas.PublicCatalogRelation.properties.target.$ref ===
      '#/components/schemas/PublicCatalogProductCard',
    'Public relation target must use a safe public card DTO.',
  );
  requireThat(
    openapi.components.schemas.PublicPriceDisplay.properties.kind.const ===
      'ON_REQUEST',
    'Public R1-004 price must be ON_REQUEST.',
  );
  requireThat(
    openapi.components.schemas.PublicPriceDisplay.properties.label.const ===
      'Цена по запросу',
    'Public R1-004 price label differs from approved wording.',
  );
  const publicProductSearch = openapi.paths['/v1/public/catalog/products'].get;
  const searchParameters = new Map(
    publicProductSearch.parameters.map((parameter) => [
      parameter.name,
      parameter,
    ]),
  );
  const searchValidationResponse =
    openapi.components.responses[
      publicProductSearch.responses['400']?.$ref?.split('/').at(-1)
    ];
  requireThat(
    JSON.stringify(publicProductSearch['x-technical-filter-policy']) ===
      JSON.stringify({
        appliesWhen: 'filter.length >= 1',
        categorySlugRequired: true,
        includeDescendantsMustBeExplicit: true,
        includeDescendantsRequiredValue: false,
        descendantsAllowedWithoutFilter: true,
        attributeDefinitionScope: 'EXACT_SELECTED_CATEGORY',
        matchDefinitionsAcrossCategoriesByCode: false,
        invalidCombination: { status: 400, code: 'VALIDATION_ERROR' },
      }) &&
      searchParameters.get('includeDescendants')?.schema.default === true &&
      searchParameters.get('includeDescendants')?.schema.type === 'boolean' &&
      searchParameters
        .get('filter')
        ?.description.includes('explicitly includeDescendants=false') &&
      searchParameters
        .get('categorySlug')
        ?.description.includes(
          'without inheritance or automatic matching by code across categories',
        ) &&
      publicProductSearch['x-invariants']?.some(
        (text) =>
          text.includes('explicitly includeDescendants=false') &&
          text.includes('omitted includeDescendants (default true)') &&
          text.includes('400 VALIDATION_ERROR before a database query'),
      ) &&
      searchValidationResponse?.['x-error-codes']?.includes('VALIDATION_ERROR'),
    'OD-004A-06 requires exact-category technical filters with categorySlug and explicitly includeDescendants=false; true or omission must return 400 VALIDATION_ERROR, while unfiltered descendant search remains allowed.',
  );
  const filterDecision =
    decisions.split('## OD-004A-06')[1]?.split('\n## ')[0] ?? '';
  const filterScenario =
    matrix.split('## CATB-25 — technical filters')[1]?.split('\n## ')[0] ?? '';
  requireThat(
    filterDecision.includes('явно переданный `includeDescendants=false`') &&
      filterDecision.includes(
        'отсутствующим `includeDescendants` (default `true`)',
      ) &&
      filterDecision.includes('400 VALIDATION_ERROR') &&
      filterDecision.includes('без наследования') &&
      filterDecision.includes(
        'не сопоставляются автоматически по одинаковому `code`',
      ) &&
      filterScenario.includes('явно переданного `includeDescendants=false`') &&
      filterScenario.includes(
        'отсутствующим includeDescendants (default true)',
      ) &&
      filterScenario.includes('400 VALIDATION_ERROR') &&
      filterScenario.includes('без наследования') &&
      filterScenario.includes('parent/child/sibling'),
    'OD-004A-06 and CATB-25 must retain explicit false/default-true rejection and category-local AttributeDefinition coverage.',
  );
  const queryText = searchParameters.get('q');
  requireThat(
    queryText &&
      queryText.schema.minLength === undefined &&
      queryText.description?.includes('empty string is treated as absent'),
    'Empty q must be accepted and normalized to no text filter.',
  );
  requireThat(
    decisions.toLowerCase().includes('пустая строка `q` принимается') &&
      model.publicInvariants.some((text) =>
        text.includes('current ACTIVE references'),
      ) &&
      openapi.components.schemas.PublicCatalogProduct.properties.brand.oneOf.some(
        (item) => item.$ref === '#/components/schemas/PublicBrand',
      ) &&
      openapi.components.schemas.PublicCatalogProduct.properties.category
        .$ref === '#/components/schemas/PublicCategory',
    'Public search and current reference-label semantics must match OD-004A.',
  );
  for (const name of [
    'CatalogAttributeInput',
    'CatalogAttributeValue',
    'PublicAttributeValue',
  ]) {
    const variants = openapi.components.schemas[name]?.oneOf ?? [];
    requireThat(
      variants.length === 5 &&
        variants.every((variant) => variant.$ref) &&
        openapi.components.schemas[name].discriminator?.propertyName ===
          'valueType',
      `${name} must use a discriminated five-type union.`,
    );
  }
  const inputTypes = ['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'];
  for (const valueType of inputTypes) {
    const input =
      openapi.components.schemas[`CatalogAttributeInput${valueType}`];
    const output =
      openapi.components.schemas[`CatalogAttributeValue${valueType}`];
    requireThat(
      input?.properties?.valueType?.const === valueType &&
        input?.properties?.value &&
        output?.properties?.valueType?.const === valueType &&
        output?.properties?.value,
      `Attribute request/response valueType ${valueType} is not constrained.`,
    );
  }
  for (const name of ['CatalogAttributeDefinition', 'CreateCatalogAttribute']) {
    const schema = openapi.components.schemas[name];
    const enumConstraint = schema.allOf?.some(
      (rule) =>
        rule.if?.properties?.valueType?.const === 'ENUM' &&
        rule.then?.required?.includes('enumOptions') &&
        rule.then?.properties?.enumOptions?.minItems === 1 &&
        rule.else?.properties?.enumOptions?.type === 'null',
    );
    const unitConstraint = schema.allOf?.some(
      (rule) =>
        JSON.stringify(rule.if?.properties?.valueType?.enum) ===
          JSON.stringify(['DECIMAL', 'INTEGER']) &&
        rule.then?.oneOf?.some(
          (variant) =>
            variant.properties?.unitCode?.type === 'string' &&
            variant.properties?.unitLabel?.type === 'string' &&
            variant.required?.includes('unitCode') &&
            variant.required?.includes('unitLabel'),
        ) &&
        rule.then.oneOf.some(
          (variant) =>
            variant.properties?.unitCode?.type === 'null' &&
            variant.properties?.unitLabel?.type === 'null',
        ) &&
        rule.else?.properties?.unitCode?.type === 'null' &&
        rule.else?.properties?.unitLabel?.type === 'null',
    );
    requireThat(
      enumConstraint && unitConstraint,
      `${name} must enforce the model's ENUM options and numeric-only unit invariants.`,
    );
  }
  requireThat(
    openapi.components.schemas.CatalogAttributeInputTEXT.properties.value
      .maxLength === 240 &&
      openapi.components.schemas.CatalogAttributeInputDECIMAL.properties.value
        .type === 'string' &&
      openapi.components.schemas.CatalogAttributeInputDECIMAL.properties.value
        .maxLength === 64 &&
      openapi.components.schemas.CatalogAttributeInputINTEGER.properties.value
        .maximum === 9007199254740991 &&
      openapi.components.schemas.CatalogAttributeInputENUM.properties.value
        .properties.code.maxLength === 80,
    'Attribute wire values exceed or diverge from the bounded model.',
  );
  for (const valueType of inputTypes) {
    const inputValue =
      openapi.components.schemas[`CatalogAttributeInput${valueType}`].properties
        .value;
    const responseValue =
      openapi.components.schemas[`CatalogAttributeValue${valueType}`].properties
        .value;
    requireThat(
      JSON.stringify(responseValue) === JSON.stringify(inputValue) ||
        (valueType === 'ENUM' &&
          responseValue.required?.includes('label') &&
          responseValue.properties?.label?.maxLength === 160 &&
          responseValue.properties?.code?.maxLength === 80),
      `Attribute request and response wire form differ for ${valueType}.`,
    );
  }
  requireThat(
    JSON.stringify(openapi.components.schemas.PublicAttributeValue.oneOf) ===
      JSON.stringify(openapi.components.schemas.CatalogAttributeValue.oneOf),
    'Public attribute value must share the constrained typed response union.',
  );
  requireThat(
    !Object.keys(openapi.paths).some((path) =>
      /(?:download|upload|files?)/i.test(path),
    ),
    'Catalog OpenAPI must not add upload/download/file routes.',
  );

  const oldActions = new Set(Object.keys(frozenAudit.actions));
  requireThat(
    Object.keys(audit.actions).every((action) => !oldActions.has(action)),
    'R1-004 audit extension must not redefine a frozen action.',
  );
  requireThat(
    audit.entityTypes.every((entity) => modelEntities.includes(entity)),
    'Catalog audit registry refers to an entity outside the catalog model.',
  );
  requireThat(
    Object.keys(audit.actions).includes('catalog.permissions.initialized'),
    'Catalog audit registry must cover one-time permission initialization.',
  );
  requireThat(
    audit.actions['catalog.permissions.initialized'].changesValueConstraints
      ?.approvalReference ===
      'Required non-secret external ticket/reference label, 1..80 characters matching ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$; recorded as supplied and is not proof of owner approval.',
    'Audit approvalReference must have explicit bounds and semantics.',
  );
  for (const id of [
    'OD-004A-01',
    'OD-004A-02',
    'OD-004A-03',
    'OD-004A-04',
    'OD-004A-05',
    'OD-004A-06',
    'OD-004A-07',
    'OD-004A-08',
    'OD-004A-09',
    'OD-004A-10',
    'OD-004A-11',
  ]) {
    requireThat(
      decisions.includes(`## ${id}`),
      `Owner decision packet missing ${id}.`,
    );
  }
  for (let id = 1; id <= 35; id += 1) {
    requireThat(
      matrix.includes(`CATB-${String(id).padStart(2, '0')}`),
      `R1-004B test matrix missing CATB-${String(id).padStart(2, '0')}.`,
    );
  }
}

async function main() {
  const bundle = await loadCatalogContract();
  validateCatalogContract(bundle);
  await SwaggerParser.validate(
    resolve(root, 'docs/contracts/R1-004-catalog.openapi.json'),
  );
  console.log(
    'PASS FROZEN R1-004 1.0.0 catalog model, RBAC, OpenAPI (31 operations: 28 staff, 3 public), audit, owner approval and R1-004B test matrix are consistent.',
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'R1-004 contract check failed.',
    );
    process.exitCode = 1;
  });
}
