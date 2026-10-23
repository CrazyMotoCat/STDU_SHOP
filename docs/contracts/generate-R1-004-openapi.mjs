import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import prettier from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'docs/contracts/R1-004-catalog.openapi.json');
const ref = (path) => ({ $ref: `#/components/${path}` });
const schema = (name) => ref(`schemas/${name}`);
const responseRef = (name) => ref(`responses/${name}`);
const parameterRef = (name) => ref(`parameters/${name}`);
const jsonBody = (name) => ({
  required: true,
  content: { 'application/json': { schema: schema(name) } },
});

const requestIdHeader = {
  description: 'Generated server request UUID; not caller identity.',
  schema: { type: 'string', format: 'uuid' },
};
const noStoreHeader = {
  description: 'Staff and error responses are never cached.',
  schema: { type: 'string', enum: ['no-store'] },
};
const commonStaffErrors = {
  400: responseRef('ValidationError'),
  401: responseRef('Unauthorized'),
  403: responseRef('Forbidden'),
  404: responseRef('NotFound'),
  409: responseRef('Conflict'),
  415: responseRef('UnsupportedMediaType'),
  500: responseRef('InternalError'),
  503: responseRef('Unavailable'),
};
const publicErrors = {
  400: responseRef('ValidationError'),
  404: responseRef('NotFound'),
  500: responseRef('InternalError'),
  503: responseRef('Unavailable'),
};

function staffOperation({
  method,
  operationId,
  summary,
  permission,
  extraPermissions = [],
  responseSchema,
  requestSchema,
  parameters = [],
  audit,
  invariants = [],
  success = method === 'post' && operationId.startsWith('create')
    ? '201'
    : '200',
}) {
  const unsafe = method !== 'get';
  const headers = unsafe
    ? [parameterRef('OriginHeader'), parameterRef('CsrfHeader')]
    : [];
  const response = {
    description:
      'Success; response follows R1-002 data/meta and X-Request-Id conventions. No credentials or storage paths.',
    headers: {
      'X-Request-Id': requestIdHeader,
      'Cache-Control': noStoreHeader,
    },
    content: { 'application/json': { schema: schema(responseSchema) } },
  };
  return {
    operationId,
    summary,
    tags: ['catalog-staff'],
    security: [{ staffCookie: [] }],
    parameters: [...headers, ...parameters],
    'x-permission': permission,
    ...(extraPermissions.length
      ? { 'x-required-permissions': [permission, ...extraPermissions] }
      : {}),
    'x-csrf': unsafe ? 'STAFF_BOUND' : 'NONE',
    'x-audit': unsafe ? audit : 'none',
    'x-errors-before-object-lookup': [
      'AUTH_REQUIRED',
      ...(unsafe ? ['ORIGIN_FORBIDDEN', 'CSRF_INVALID'] : []),
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
    'x-invariants': invariants,
    ...(requestSchema ? { requestBody: jsonBody(requestSchema) } : {}),
    responses: { [success]: response, ...commonStaffErrors },
  };
}

function publicOperation({
  operationId,
  summary,
  responseSchema,
  parameters = [],
  invariants = [],
}) {
  return {
    operationId,
    summary,
    tags: ['catalog-public'],
    security: [],
    parameters,
    'x-cache-policy':
      'Public data only; implementations must not serve draft or archived data.',
    'x-invariants': invariants,
    responses: {
      200: {
        description: 'Published catalog data only.',
        headers: { 'X-Request-Id': requestIdHeader },
        content: { 'application/json': { schema: schema(responseSchema) } },
      },
      ...publicErrors,
    },
  };
}

const queryParameters = [
  {
    name: 'categorySlug',
    in: 'query',
    schema: { type: 'string', minLength: 1, maxLength: 120 },
    description: 'Exact active public category slug.',
  },
  {
    name: 'includeDescendants',
    in: 'query',
    schema: { type: 'boolean', default: true },
    description: 'Include products assigned to active descendant categories.',
  },
  {
    name: 'brandSlug',
    in: 'query',
    schema: { type: 'string', minLength: 1, maxLength: 120 },
  },
  {
    name: 'q',
    in: 'query',
    schema: { type: 'string', maxLength: 128 },
    description:
      'Literal case-insensitive substring over published display name, brand, manufacturer, original part number, modification and searchable attribute snapshots. No regex or ranking. An empty string is treated as absent.',
  },
  {
    name: 'filter',
    in: 'query',
    style: 'form',
    explode: true,
    schema: {
      type: 'array',
      maxItems: 40,
      items: { type: 'string', minLength: 3, maxLength: 240 },
    },
    description:
      'Repeatable decoded grammar attributeCode:operator:value; categorySlug is required. Supported ops: eq all types, contains TEXT, gte/lte DECIMAL or INTEGER. Filters are ANDed; duplicate code/operator is invalid.',
  },
  {
    name: 'page',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
  },
  {
    name: 'pageSize',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 },
  },
  {
    name: 'sort',
    in: 'query',
    schema: {
      type: 'string',
      enum: ['name_asc', 'name_desc', 'brand_asc', 'part_number_asc'],
      default: 'name_asc',
    },
  },
];

const paths = {
  '/v1/staff/catalog/categories': {
    get: staffOperation({
      method: 'get',
      operationId: 'listCatalogCategories',
      summary: 'Read catalog categories and hierarchy',
      permission: 'catalog.references.read',
      responseSchema: 'CatalogCategoryListResponse',
      parameters: [parameterRef('StaffLimit'), parameterRef('StaffCursor')],
    }),
    post: staffOperation({
      method: 'post',
      operationId: 'createCatalogCategory',
      summary: 'Create category',
      permission: 'catalog.categories.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'CreateCatalogCategory',
      audit: 'catalog.reference.changed',
    }),
  },
  '/v1/staff/catalog/categories/{categoryId}': {
    parameters: [parameterRef('CategoryId')],
    get: staffOperation({
      method: 'get',
      operationId: 'getCatalogCategory',
      summary: 'Read one category',
      permission: 'catalog.references.read',
      responseSchema: 'CatalogCategoryResponse',
    }),
    patch: staffOperation({
      method: 'patch',
      operationId: 'patchCatalogCategory',
      summary: 'Change category metadata or parent',
      permission: 'catalog.categories.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'PatchCatalogCategory',
      audit: 'catalog.reference.changed',
      invariants: [
        'Reject a parent change that creates a cycle; tree check is serialized in PostgreSQL.',
      ],
    }),
  },
  '/v1/staff/catalog/categories/{categoryId}/archive': {
    parameters: [parameterRef('CategoryId')],
    post: staffOperation({
      method: 'post',
      operationId: 'archiveCatalogCategory',
      summary: 'Archive an unused category',
      permission: 'catalog.categories.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'VersionCommand',
      audit: 'catalog.reference.changed',
      invariants: [
        'Reject while active children or non-archived products current draft, pending or published revision pointers use this category. Returned, rejected, superseded and other non-current historical revisions do not block archive. Never hard-delete.',
      ],
      success: '200',
    }),
  },
  '/v1/staff/catalog/brands': {
    get: staffOperation({
      method: 'get',
      operationId: 'listCatalogBrands',
      summary: 'Read catalog brands',
      permission: 'catalog.references.read',
      responseSchema: 'CatalogBrandListResponse',
      parameters: [parameterRef('StaffLimit'), parameterRef('StaffCursor')],
    }),
    post: staffOperation({
      method: 'post',
      operationId: 'createCatalogBrand',
      summary: 'Create brand',
      permission: 'catalog.brands.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'CreateCatalogBrand',
      audit: 'catalog.reference.changed',
    }),
  },
  '/v1/staff/catalog/brands/{brandId}': {
    parameters: [parameterRef('BrandId')],
    get: staffOperation({
      method: 'get',
      operationId: 'getCatalogBrand',
      summary: 'Read one brand',
      permission: 'catalog.references.read',
      responseSchema: 'CatalogBrandResponse',
    }),
    patch: staffOperation({
      method: 'patch',
      operationId: 'patchCatalogBrand',
      summary: 'Change brand metadata',
      permission: 'catalog.brands.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'PatchCatalogBrand',
      audit: 'catalog.reference.changed',
    }),
  },
  '/v1/staff/catalog/brands/{brandId}/archive': {
    parameters: [parameterRef('BrandId')],
    post: staffOperation({
      method: 'post',
      operationId: 'archiveCatalogBrand',
      summary: 'Archive an unused brand',
      permission: 'catalog.brands.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'VersionCommand',
      audit: 'catalog.reference.changed',
      invariants: [
        'Reject while any non-archived product uses the brand; never hard-delete.',
      ],
      success: '200',
    }),
  },
  '/v1/staff/catalog/attributes': {
    get: staffOperation({
      method: 'get',
      operationId: 'listCatalogAttributes',
      summary: 'Read attribute definitions for one category',
      permission: 'catalog.references.read',
      responseSchema: 'CatalogAttributeListResponse',
      parameters: [
        parameterRef('StaffLimit'),
        parameterRef('StaffCursor'),
        parameterRef('CategoryIdQuery'),
      ],
    }),
    post: staffOperation({
      method: 'post',
      operationId: 'createCatalogAttribute',
      summary: 'Create a typed category attribute definition',
      permission: 'catalog.attributes.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'CreateCatalogAttribute',
      audit: 'catalog.reference.changed',
    }),
  },
  '/v1/staff/catalog/attributes/{attributeId}': {
    parameters: [parameterRef('AttributeId')],
    get: staffOperation({
      method: 'get',
      operationId: 'getCatalogAttribute',
      summary: 'Read one attribute definition',
      permission: 'catalog.references.read',
      responseSchema: 'CatalogAttributeResponse',
    }),
    patch: staffOperation({
      method: 'patch',
      operationId: 'patchCatalogAttribute',
      summary: 'Change an attribute definition',
      permission: 'catalog.attributes.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'PatchCatalogAttribute',
      audit: 'catalog.reference.changed',
      invariants: [
        'Semantic changes after use are refused; create a new definition code instead.',
      ],
    }),
  },
  '/v1/staff/catalog/attributes/{attributeId}/archive': {
    parameters: [parameterRef('AttributeId')],
    post: staffOperation({
      method: 'post',
      operationId: 'archiveCatalogAttribute',
      summary: 'Archive an attribute definition',
      permission: 'catalog.attributes.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'VersionCommand',
      audit: 'catalog.reference.changed',
      invariants: [
        'Historical revision snapshots remain readable; new drafts cannot use an archived definition.',
      ],
      success: '200',
    }),
  },
  '/v1/staff/catalog/products': {
    get: staffOperation({
      method: 'get',
      operationId: 'listStaffCatalogProducts',
      summary: 'Read internal products and workflow states',
      permission: 'catalog.products.read',
      responseSchema: 'StaffCatalogProductListResponse',
      parameters: [
        parameterRef('StaffLimit'),
        parameterRef('StaffCursor'),
        parameterRef('ProductState'),
        parameterRef('CategoryIdQuery'),
      ],
      invariants: [
        'publicationState DRAFT, PENDING_REVIEW or PUBLISHED selects products by the corresponding currentDraftRevisionId, pendingRevisionId or publishedRevisionId pointer. ARCHIVED matches the root CatalogProduct.publicationState. With DRAFT, PENDING_REVIEW or PUBLISHED, categoryId must match the category on that same pointer-selected revision. Without publicationState, categoryId matches any existing current draft, pending or published pointer. The ARCHIVED + categoryId combination is rejected with VALIDATION_ERROR because product archival clears all current pointers. Non-current historical revisions never satisfy this filter.',
      ],
    }),
    post: staffOperation({
      method: 'post',
      operationId: 'createCatalogProduct',
      summary: 'Create product identity and initial draft revision',
      permission: 'catalog.products.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'CreateCatalogProduct',
      audit: 'catalog.product.created',
      invariants: [
        'Creates root identity and initial DRAFT revision from the same request in one transaction. Creates DRAFT only; does not submit, publish, assign a price or create file bytes.',
      ],
    }),
  },
  '/v1/staff/catalog/products/{productId}': {
    parameters: [parameterRef('ProductId')],
    get: staffOperation({
      method: 'get',
      operationId: 'getStaffCatalogProduct',
      summary: 'Read product identity, revisions and current workflow state',
      permission: 'catalog.products.read',
      responseSchema: 'StaffCatalogProductResponse',
    }),
    patch: staffOperation({
      method: 'patch',
      operationId: 'patchCatalogProductDraft',
      summary: 'Append an updated draft revision',
      permission: 'catalog.products.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'PatchCatalogProductDraft',
      audit: 'catalog.product.revision.created',
      invariants: [
        'Requires expectedVersion and baseRevisionId. With a current DRAFT, baseRevisionId must equal currentDraftRevisionId and the prior DRAFT becomes SUPERSEDED. Without a draft or pending revision, baseRevisionId must equal the latest RETURNED/REJECTED revision created after the current published revision; if none exists it must equal the current published revision. An unpublished product may use its latest RETURNED/REJECTED revision. The command appends a new immutable DRAFT copied from that base. A pending review blocks draft creation. Published pointer is unchanged.',
        'Before first successful submit, the effective identity tuple (brandId, manufacturerName, originalPartNumber, modification) is written to the root and new DRAFT snapshot in the same transaction; omitted identity fields inherit from baseRevisionId. Existing SUPERSEDED snapshots remain unchanged. After first submit the root tuple is frozen and every subsequent revision copies it exactly; attempted changes fail with INVALID_STATE_TRANSITION. Root identity uniqueness conflict is IDENTITY_CONFLICT and rolls back revision and audit.',
      ],
    }),
  },
  '/v1/staff/catalog/products/{productId}/submit': {
    parameters: [parameterRef('ProductId')],
    post: staffOperation({
      method: 'post',
      operationId: 'submitCatalogProduct',
      summary: 'Submit one draft revision for publication review',
      permission: 'catalog.products.submit',
      responseSchema: 'MutationResponse',
      requestSchema: 'SubmitCatalogProduct',
      audit: 'catalog.product.submitted',
      invariants: [
        'Submission freezes content and checks category/brand/typed attribute/reference readiness. It never publishes.',
      ],
      success: '200',
    }),
  },
  '/v1/staff/catalog/products/{productId}/review': {
    parameters: [parameterRef('ProductId')],
    post: staffOperation({
      method: 'post',
      operationId: 'decideCatalogProductPublication',
      summary: 'Publish, return or reject one pending revision',
      permission: 'catalog.products.publish',
      responseSchema: 'MutationResponse',
      requestSchema: 'CatalogProductReviewDecision',
      audit: 'catalog.product.reviewed',
      invariants: [
        'PUBLISH atomically replaces the public pointer; RETURN_FOR_CHANGES and REJECT preserve the prior public revision.',
      ],
      success: '200',
    }),
  },
  '/v1/staff/catalog/products/{productId}/archive': {
    parameters: [parameterRef('ProductId')],
    post: staffOperation({
      method: 'post',
      operationId: 'archiveCatalogProduct',
      summary: 'Archive product and withdraw pending revision',
      permission: 'catalog.products.archive',
      responseSchema: 'MutationResponse',
      requestSchema: 'VersionCommand',
      audit: 'catalog.product.archived',
      invariants: [
        'ARCHIVE is terminal from any non-archived root state. In one transaction it withdraws a pending revision as WITHDRAWN, clears publishedRevisionId, pendingRevisionId and currentDraftRevisionId, sets publicationState=ARCHIVED, revokes public visibility and writes audit. It preserves all product revisions and FileVersion references; it deletes no data.',
      ],
      success: '200',
    }),
  },
  '/v1/staff/catalog/products/{productId}/relations': {
    parameters: [parameterRef('ProductId')],
    get: staffOperation({
      method: 'get',
      operationId: 'listCatalogProductRelations',
      summary: 'Read manually managed product relations',
      permission: 'catalog.products.read',
      responseSchema: 'CatalogProductRelationsResponse',
    }),
    put: staffOperation({
      method: 'put',
      operationId: 'replaceCatalogProductRelations',
      summary: 'Replace relations on a new product draft revision',
      permission: 'catalog.products.relations.write',
      responseSchema: 'MutationResponse',
      requestSchema: 'ReplaceCatalogProductRelations',
      audit: 'catalog.product.relations.changed',
      invariants: [
        'Types are ACCESSORY or COMPATIBLE_EQUIPMENT only; target must be an exact current published revision; no automatic analogue.',
      ],
    }),
  },
  '/v1/staff/catalog/products/{productId}/media': {
    parameters: [parameterRef('ProductId')],
    get: staffOperation({
      method: 'get',
      operationId: 'listCatalogProductMediaMetadata',
      summary: 'Read accessible media metadata; no file bytes or URL',
      permission: 'catalog.products.read',
      extraPermissions: ['files.metadata.read'],
      responseSchema: 'CatalogProductMediaResponse',
    }),
    put: staffOperation({
      method: 'put',
      operationId: 'replaceCatalogProductMediaMetadata',
      summary: 'Replace media metadata on a new draft revision',
      permission: 'catalog.products.media.write',
      extraPermissions: ['files.metadata.read'],
      responseSchema: 'MutationResponse',
      requestSchema: 'ReplaceCatalogProductMedia',
      audit: 'catalog.product.media.changed',
      invariants: [
        'FileVersion must already exist and be accessible to this employee. No upload/download or public exposure.',
      ],
    }),
  },
  '/v1/staff/catalog/products/{productId}/documents': {
    parameters: [parameterRef('ProductId')],
    get: staffOperation({
      method: 'get',
      operationId: 'listCatalogProductDocumentMetadata',
      summary: 'Read accessible document metadata; no file bytes or URL',
      permission: 'catalog.products.read',
      extraPermissions: ['files.metadata.read'],
      responseSchema: 'CatalogProductDocumentsResponse',
    }),
    put: staffOperation({
      method: 'put',
      operationId: 'replaceCatalogProductDocumentMetadata',
      summary: 'Replace document metadata on a new draft revision',
      permission: 'catalog.products.documents.write',
      extraPermissions: ['files.metadata.read'],
      responseSchema: 'MutationResponse',
      requestSchema: 'ReplaceCatalogProductDocuments',
      audit: 'catalog.product.documents.changed',
      invariants: [
        'FileVersion must already exist and be accessible to this employee. No upload/download or public exposure.',
      ],
    }),
  },
  '/v1/public/catalog/categories': {
    get: publicOperation({
      operationId: 'listPublicCatalogCategoryChildren',
      summary: 'List a bounded page of active direct child categories',
      responseSchema: 'PublicCatalogCategoryListResponse',
      parameters: [
        parameterRef('PublicCategoryParentSlug'),
        parameterRef('PublicCategoryCursor'),
        parameterRef('PublicCategoryPageSize'),
      ],
      invariants: [
        'Return only ACTIVE direct children of parentSlug; when parentSlug is absent, return ACTIVE root categories.',
        'An unknown or inactive parentSlug returns the same 404 response.',
        'Order each page by sortOrder ASC then slug ASC; use an optional keyset cursor and pageSize 1..100 (default 24), with no page-number ceiling.',
        'The opaque unpadded base64url cursor encodes the last returned nonnegative int32 sortOrder and canonical slug separated by a colon; reject malformed cursors.',
        'Each response contains one level only and at most pageSize categories; meta.nextCursor is null at the end. Clients assemble navigation trees with additional bounded requests.',
      ],
    }),
  },
  '/v1/public/catalog/products': {
    get: publicOperation({
      operationId: 'searchPublicCatalogProducts',
      summary: 'Search and filter published catalog products',
      responseSchema: 'PublicCatalogProductListResponse',
      parameters: queryParameters,
    }),
  },
  '/v1/public/catalog/products/{slug}': {
    get: publicOperation({
      operationId: 'getPublicCatalogProductBySlug',
      summary: 'Read one published product by stable slug',
      responseSchema: 'PublicCatalogProductResponse',
      parameters: [parameterRef('PublicSlug')],
    }),
  },
};

const mutationResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'version'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1, maximum: 2147483647 },
      },
    },
    meta: schema('Meta'),
  },
};

const errorCodes = [
  'VALIDATION_ERROR',
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'CSRF_INVALID',
  'ORIGIN_FORBIDDEN',
  'NOT_FOUND',
  'EMAIL_IN_USE',
  'LAST_ADMIN_REQUIRED',
  'SELF_PRIVILEGE_CHANGE_FORBIDDEN',
  'GRANT_CEILING_EXCEEDED',
  'ROLE_IN_USE',
  'VERSION_CONFLICT',
  'INVALID_STATE_TRANSITION',
  'ALREADY_AUTHENTICATED',
  'RATE_LIMITED',
  'UNSUPPORTED_MEDIA_TYPE',
  'AUDIT_UNAVAILABLE',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
  'CURRENT_PASSWORD_INVALID',
  'IDENTITY_CONFLICT',
  'SLUG_CONFLICT',
  'CATEGORY_CYCLE',
  'CATEGORY_INACTIVE_PARENT',
  'ATTRIBUTE_NOT_APPLICABLE',
  'PUBLICATION_NOT_READY',
  'REFERENCE_IN_USE',
  'FILE_NOT_ACCESSIBLE',
];

const attributeValueTypes = ['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'];
const attributeDefinitionConstraints = () => [
  {
    if: {
      properties: { valueType: { const: 'ENUM' } },
      required: ['valueType'],
    },
    then: {
      properties: {
        enumOptions: { type: 'array', minItems: 1, maxItems: 200 },
      },
      required: ['enumOptions'],
    },
    else: { properties: { enumOptions: { type: 'null' } } },
  },
  {
    if: {
      properties: { valueType: { enum: ['DECIMAL', 'INTEGER'] } },
      required: ['valueType'],
    },
    then: {
      oneOf: [
        {
          properties: {
            unitCode: { type: 'null' },
            unitLabel: { type: 'null' },
          },
          required: ['unitCode', 'unitLabel'],
        },
        {
          properties: {
            unitCode: { type: 'string', minLength: 1, maxLength: 32 },
            unitLabel: { type: 'string', minLength: 1, maxLength: 48 },
          },
          required: ['unitCode', 'unitLabel'],
        },
        {
          not: {
            anyOf: [{ required: ['unitCode'] }, { required: ['unitLabel'] }],
          },
        },
      ],
    },
    else: {
      properties: {
        unitCode: { type: 'null' },
        unitLabel: { type: 'null' },
      },
    },
  },
];
const decimalWireValue = {
  type: 'string',
  maxLength: 64,
  pattern: '^(?:0|-?[1-9][0-9]*)(?:\\.[0-9]*[1-9])?$|^-0\\.[0-9]*[1-9]$',
  description:
    'Canonical base-10 decimal string: no exponent, leading plus/zeroes, trailing fractional zeroes or negative zero.',
};
const integerWireValue = {
  type: 'integer',
  minimum: -9007199254740991,
  maximum: 9007199254740991,
};
const attributeInputValue = {
  TEXT: { type: 'string', maxLength: 240 },
  DECIMAL: decimalWireValue,
  INTEGER: integerWireValue,
  BOOLEAN: { type: 'boolean' },
  ENUM: {
    type: 'object',
    additionalProperties: false,
    required: ['code'],
    properties: {
      code: {
        type: 'string',
        pattern: '^[a-z][a-z0-9_-]{0,79}$',
        maxLength: 80,
      },
    },
  },
};
const attributeResponseValue = {
  ...attributeInputValue,
  ENUM: {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'label'],
    properties: {
      code: {
        type: 'string',
        pattern: '^[a-z][a-z0-9_-]{0,79}$',
        maxLength: 80,
      },
      label: { type: 'string', minLength: 1, maxLength: 160 },
    },
  },
};
const typedCatalogAttributeInput = (valueType) => ({
  type: 'object',
  additionalProperties: false,
  required: ['attributeDefinitionId', 'valueType', 'value'],
  properties: {
    attributeDefinitionId: { type: 'string', format: 'uuid' },
    valueType: { const: valueType },
    value: attributeInputValue[valueType],
  },
});
const typedCatalogAttributeValue = (valueType) => ({
  type: 'object',
  additionalProperties: false,
  required: [
    'attributeCode',
    'label',
    'valueType',
    'value',
    'unitCode',
    'unitLabel',
    'comparable',
  ],
  properties: {
    attributeCode: { type: 'string', maxLength: 80 },
    label: { type: 'string', maxLength: 160 },
    valueType: { const: valueType },
    value: attributeResponseValue[valueType],
    unitCode: { type: ['string', 'null'], maxLength: 32 },
    unitLabel: { type: ['string', 'null'], maxLength: 48 },
    comparable: { type: 'boolean' },
  },
});

const schemas = {
  Meta: {
    type: 'object',
    additionalProperties: false,
    required: ['requestId'],
    properties: { requestId: { type: 'string', format: 'uuid' } },
  },
  PublicPageMeta: {
    type: 'object',
    additionalProperties: false,
    required: ['requestId', 'page', 'pageSize', 'total', 'totalPages'],
    properties: {
      requestId: { type: 'string', format: 'uuid' },
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      total: { type: 'integer', minimum: 0 },
      totalPages: { type: 'integer', minimum: 0 },
    },
  },
  PublicCategoryCursorPageMeta: {
    type: 'object',
    additionalProperties: false,
    required: ['requestId', 'pageSize', 'nextCursor'],
    properties: {
      requestId: { type: 'string', format: 'uuid' },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      nextCursor: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 256,
        pattern: '^[A-Za-z0-9_-]+$',
      },
    },
  },
  CatalogError: {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'message', 'requestId'],
    properties: {
      code: { type: 'string', enum: errorCodes },
      message: { type: 'string', minLength: 1, maxLength: 240 },
      requestId: { type: 'string', format: 'uuid' },
      fields: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'code'],
          properties: {
            field: { type: 'string', minLength: 1, maxLength: 100 },
            code: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
  },
  MutationResponse: mutationResponse,
  CatalogBrand: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'slug', 'name', 'state', 'version'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      slug: {
        type: 'string',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        maxLength: 120,
      },
      name: { type: 'string', minLength: 1, maxLength: 160 },
      state: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
      version: { type: 'integer', minimum: 1 },
    },
  },
  CatalogCategory: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'parentId',
      'slug',
      'name',
      'state',
      'sortOrder',
      'version',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      parentId: { type: ['string', 'null'], format: 'uuid' },
      slug: {
        type: 'string',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        maxLength: 120,
      },
      name: { type: 'string', minLength: 1, maxLength: 160 },
      description: { type: ['string', 'null'], maxLength: 2000 },
      state: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
      sortOrder: {
        type: 'integer',
        minimum: 0,
        maximum: 2147483647,
      },
      version: { type: 'integer', minimum: 1 },
    },
  },
  CatalogAttributeDefinition: {
    type: 'object',
    additionalProperties: false,
    allOf: attributeDefinitionConstraints(),
    required: [
      'id',
      'categoryId',
      'code',
      'label',
      'valueType',
      'unitCode',
      'unitLabel',
      'enumOptions',
      'filterable',
      'searchable',
      'comparable',
      'state',
      'version',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      categoryId: { type: 'string', format: 'uuid' },
      code: {
        type: 'string',
        pattern: '^[a-z][a-z0-9_]{1,79}$',
        maxLength: 80,
      },
      label: { type: 'string', minLength: 1, maxLength: 160 },
      valueType: {
        type: 'string',
        enum: ['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'],
      },
      unitCode: { type: ['string', 'null'], maxLength: 32 },
      unitLabel: { type: ['string', 'null'], maxLength: 48 },
      enumOptions: {
        type: ['array', 'null'],
        maxItems: 200,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'label'],
          properties: {
            code: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,79}$' },
            label: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
      },
      filterable: { type: 'boolean' },
      searchable: { type: 'boolean' },
      comparable: { type: 'boolean' },
      state: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
      version: { type: 'integer', minimum: 1 },
    },
  },
  CatalogAttributeValue: {
    oneOf: attributeValueTypes.map((valueType) =>
      schema(`CatalogAttributeValue${valueType}`),
    ),
    discriminator: { propertyName: 'valueType' },
  },
  CatalogProductRevision: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'revisionNo',
      'state',
      'categoryId',
      'displayName',
      'summary',
      'description',
      'brandId',
      'brandNameSnapshot',
      'brandSlugSnapshot',
      'categoryNameSnapshot',
      'categorySlugSnapshot',
      'attributes',
      'createdByUserId',
      'createdAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      revisionNo: { type: 'integer', minimum: 1 },
      state: {
        type: 'string',
        enum: [
          'DRAFT',
          'SUPERSEDED',
          'PENDING_REVIEW',
          'PUBLISHED',
          'RETURNED',
          'REJECTED',
          'WITHDRAWN',
        ],
      },
      sourceRevisionId: { type: ['string', 'null'], format: 'uuid' },
      categoryId: { type: 'string', format: 'uuid' },
      displayName: { type: 'string', minLength: 1, maxLength: 240 },
      summary: { type: ['string', 'null'], maxLength: 500 },
      description: { type: ['string', 'null'], maxLength: 20000 },
      brandId: { type: ['string', 'null'], format: 'uuid' },
      brandNameSnapshot: { type: ['string', 'null'], maxLength: 160 },
      brandSlugSnapshot: { type: ['string', 'null'], maxLength: 120 },
      categoryNameSnapshot: { type: 'string', maxLength: 160 },
      categorySlugSnapshot: { type: 'string', maxLength: 120 },
      manufacturerNameSnapshot: { type: ['string', 'null'], maxLength: 200 },
      originalPartNumberSnapshot: { type: ['string', 'null'], maxLength: 160 },
      modificationSnapshot: { type: ['string', 'null'], maxLength: 160 },
      attributes: {
        type: 'array',
        maxItems: 300,
        items: schema('CatalogAttributeValue'),
      },
      createdByUserId: { type: 'string', format: 'uuid' },
      createdAt: { type: 'string', format: 'date-time' },
      submittedByUserId: { type: ['string', 'null'], format: 'uuid' },
      submittedAt: { type: ['string', 'null'], format: 'date-time' },
      decidedByUserId: { type: ['string', 'null'], format: 'uuid' },
      decidedAt: { type: ['string', 'null'], format: 'date-time' },
      decision: {
        type: ['string', 'null'],
        enum: ['PUBLISH', 'RETURN_FOR_CHANGES', 'REJECT', null],
      },
      decisionReason: { type: ['string', 'null'], maxLength: 1000 },
      publishedAt: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  StaffCatalogProduct: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'slug',
      'publicationState',
      'brandId',
      'manufacturerName',
      'originalPartNumber',
      'modification',
      'publishedRevisionId',
      'pendingRevisionId',
      'currentDraftRevisionId',
      'version',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      slug: { type: 'string' },
      publicationState: {
        type: 'string',
        enum: ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED'],
      },
      brandId: { type: ['string', 'null'], format: 'uuid' },
      manufacturerName: { type: ['string', 'null'] },
      originalPartNumber: { type: ['string', 'null'] },
      modification: { type: ['string', 'null'] },
      publishedRevisionId: { type: ['string', 'null'], format: 'uuid' },
      pendingRevisionId: { type: ['string', 'null'], format: 'uuid' },
      currentDraftRevisionId: { type: ['string', 'null'], format: 'uuid' },
      version: { type: 'integer', minimum: 1 },
    },
  },
  StaffCatalogProductDetail: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'slug',
      'publicationState',
      'brandId',
      'manufacturerName',
      'originalPartNumber',
      'modification',
      'publishedRevisionId',
      'pendingRevisionId',
      'currentDraftRevisionId',
      'version',
      'publishedRevision',
      'pendingRevision',
      'editorRevision',
      'revisionHistory',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      slug: { type: 'string' },
      publicationState: {
        type: 'string',
        enum: ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED'],
      },
      brandId: { type: ['string', 'null'], format: 'uuid' },
      manufacturerName: { type: ['string', 'null'] },
      originalPartNumber: { type: ['string', 'null'] },
      modification: { type: ['string', 'null'] },
      publishedRevisionId: { type: ['string', 'null'], format: 'uuid' },
      pendingRevisionId: { type: ['string', 'null'], format: 'uuid' },
      currentDraftRevisionId: { type: ['string', 'null'], format: 'uuid' },
      version: { type: 'integer', minimum: 1 },
      publishedRevision: {
        oneOf: [schema('CatalogProductRevision'), { type: 'null' }],
      },
      pendingRevision: {
        oneOf: [schema('CatalogProductRevision'), { type: 'null' }],
      },
      editorRevision: {
        oneOf: [schema('CatalogProductRevision'), { type: 'null' }],
      },
      revisionHistory: {
        type: 'array',
        maxItems: 1000,
        items: schema('CatalogProductRevision'),
      },
    },
  },
  CatalogProductRelation: {
    type: 'object',
    additionalProperties: false,
    required: [
      'targetProductId',
      'targetRevisionId',
      'relationType',
      'sortOrder',
    ],
    properties: {
      targetProductId: { type: 'string', format: 'uuid' },
      targetRevisionId: { type: 'string', format: 'uuid' },
      relationType: {
        type: 'string',
        enum: ['ACCESSORY', 'COMPATIBLE_EQUIPMENT'],
      },
      sortOrder: { type: 'integer', minimum: 0 },
    },
  },
  CatalogProductMediaItem: {
    type: 'object',
    additionalProperties: false,
    required: ['fileVersionId', 'altText', 'caption', 'sortOrder', 'isPrimary'],
    properties: {
      fileVersionId: { type: 'string', format: 'uuid' },
      altText: { type: 'string', minLength: 1, maxLength: 240 },
      caption: { type: ['string', 'null'], maxLength: 500 },
      sortOrder: { type: 'integer', minimum: 0 },
      isPrimary: { type: 'boolean' },
    },
  },
  CatalogProductDocumentItem: {
    type: 'object',
    additionalProperties: false,
    required: [
      'fileVersionId',
      'documentKind',
      'displayName',
      'locale',
      'sortOrder',
    ],
    properties: {
      fileVersionId: { type: 'string', format: 'uuid' },
      documentKind: {
        type: 'string',
        enum: ['DATASHEET', 'MANUAL', 'CERTIFICATE', 'SCHEME', 'OTHER'],
      },
      displayName: { type: 'string', minLength: 1, maxLength: 240 },
      locale: { type: ['string', 'null'], maxLength: 35 },
      sortOrder: { type: 'integer', minimum: 0 },
    },
  },
  VersionCommand: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1, maximum: 2147483647 },
    },
  },
  CreateCatalogBrand: {
    type: 'object',
    additionalProperties: false,
    required: ['slug', 'name'],
    properties: {
      slug: {
        type: 'string',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        maxLength: 120,
      },
      name: { type: 'string', minLength: 1, maxLength: 160 },
    },
  },
  PatchCatalogBrand: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
      name: { type: 'string', minLength: 1, maxLength: 160 },
    },
  },
  CreateCatalogCategory: {
    type: 'object',
    additionalProperties: false,
    required: ['slug', 'name'],
    properties: {
      parentId: { type: ['string', 'null'], format: 'uuid' },
      slug: {
        type: 'string',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        maxLength: 120,
      },
      name: { type: 'string', minLength: 1, maxLength: 160 },
      description: { type: ['string', 'null'], maxLength: 2000 },
      sortOrder: {
        type: 'integer',
        minimum: 0,
        maximum: 2147483647,
        default: 0,
      },
    },
  },
  PatchCatalogCategory: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
      parentId: { type: ['string', 'null'], format: 'uuid' },
      name: { type: 'string', minLength: 1, maxLength: 160 },
      description: { type: ['string', 'null'], maxLength: 2000 },
      sortOrder: { type: 'integer', minimum: 0, maximum: 2147483647 },
    },
  },
  CreateCatalogAttribute: {
    type: 'object',
    additionalProperties: false,
    allOf: attributeDefinitionConstraints(),
    required: [
      'categoryId',
      'code',
      'label',
      'valueType',
      'filterable',
      'searchable',
      'comparable',
    ],
    properties: {
      categoryId: { type: 'string', format: 'uuid' },
      code: {
        type: 'string',
        pattern: '^[a-z][a-z0-9_]{1,79}$',
        maxLength: 80,
      },
      label: { type: 'string', minLength: 1, maxLength: 160 },
      valueType: {
        type: 'string',
        enum: ['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'],
      },
      unitCode: { type: ['string', 'null'], maxLength: 32 },
      unitLabel: { type: ['string', 'null'], maxLength: 48 },
      enumOptions: {
        type: ['array', 'null'],
        maxItems: 200,
        items: {
          type: 'object',
          required: ['code', 'label'],
          additionalProperties: false,
          properties: {
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_-]{0,79}$',
              maxLength: 80,
            },
            label: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
      },
      filterable: { type: 'boolean' },
      searchable: { type: 'boolean' },
      comparable: { type: 'boolean' },
    },
  },
  PatchCatalogAttribute: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
      label: { type: 'string', minLength: 1, maxLength: 160 },
      filterable: { type: 'boolean' },
      searchable: { type: 'boolean' },
      comparable: { type: 'boolean' },
    },
  },
  CatalogAttributeInput: {
    oneOf: attributeValueTypes.map((valueType) =>
      schema(`CatalogAttributeInput${valueType}`),
    ),
    discriminator: { propertyName: 'valueType' },
  },
  CreateCatalogProduct: {
    type: 'object',
    additionalProperties: false,
    required: ['slug', 'categoryId', 'displayName'],
    properties: {
      slug: {
        type: 'string',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        maxLength: 160,
      },
      brandId: { type: ['string', 'null'], format: 'uuid' },
      manufacturerName: { type: ['string', 'null'], maxLength: 200 },
      originalPartNumber: { type: ['string', 'null'], maxLength: 160 },
      modification: { type: ['string', 'null'], maxLength: 160 },
      categoryId: { type: 'string', format: 'uuid' },
      displayName: { type: 'string', minLength: 1, maxLength: 240 },
      summary: { type: ['string', 'null'], maxLength: 500 },
      description: { type: ['string', 'null'], maxLength: 20000 },
      attributes: {
        type: 'array',
        maxItems: 300,
        items: schema('CatalogAttributeInput'),
      },
    },
  },
  PatchCatalogProductDraft: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion', 'baseRevisionId'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
      baseRevisionId: { type: 'string', format: 'uuid' },
      brandId: { type: ['string', 'null'], format: 'uuid' },
      manufacturerName: { type: ['string', 'null'], maxLength: 200 },
      originalPartNumber: { type: ['string', 'null'], maxLength: 160 },
      modification: { type: ['string', 'null'], maxLength: 160 },
      categoryId: { type: 'string', format: 'uuid' },
      displayName: { type: 'string', minLength: 1, maxLength: 240 },
      summary: { type: ['string', 'null'], maxLength: 500 },
      description: { type: ['string', 'null'], maxLength: 20000 },
      attributes: {
        type: 'array',
        maxItems: 300,
        items: schema('CatalogAttributeInput'),
      },
    },
  },
  SubmitCatalogProduct: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion'],
    properties: { expectedVersion: { type: 'integer', minimum: 1 } },
  },
  CatalogProductReviewDecision: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['expectedVersion', 'revisionId', 'decision'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          revisionId: { type: 'string', format: 'uuid' },
          decision: { const: 'PUBLISH' },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['expectedVersion', 'revisionId', 'decision', 'reason'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          revisionId: { type: 'string', format: 'uuid' },
          decision: { const: 'RETURN_FOR_CHANGES' },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['expectedVersion', 'revisionId', 'decision', 'reason'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          revisionId: { type: 'string', format: 'uuid' },
          decision: { const: 'REJECT' },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    ],
  },
  ReplaceCatalogProductRelations: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion', 'relations'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
      relations: {
        type: 'array',
        maxItems: 100,
        items: schema('CatalogProductRelation'),
      },
    },
  },
  ReplaceCatalogProductMedia: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion', 'items'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
      items: {
        type: 'array',
        maxItems: 100,
        items: schema('CatalogProductMediaItem'),
      },
    },
  },
  ReplaceCatalogProductDocuments: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion', 'items'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
      items: {
        type: 'array',
        maxItems: 100,
        items: schema('CatalogProductDocumentItem'),
      },
    },
  },
  CatalogMediaMetadata: {
    type: 'object',
    additionalProperties: false,
    required: ['fileVersionId', 'altText', 'caption', 'sortOrder', 'isPrimary'],
    properties: {
      fileVersionId: { type: 'string', format: 'uuid' },
      altText: { type: 'string' },
      caption: { type: ['string', 'null'] },
      sortOrder: { type: 'integer', minimum: 0 },
      isPrimary: { type: 'boolean' },
    },
  },
  CatalogDocumentMetadata: {
    type: 'object',
    additionalProperties: false,
    required: [
      'fileVersionId',
      'documentKind',
      'displayName',
      'locale',
      'sortOrder',
    ],
    properties: {
      fileVersionId: { type: 'string', format: 'uuid' },
      documentKind: { type: 'string' },
      displayName: { type: 'string' },
      locale: { type: ['string', 'null'] },
      sortOrder: { type: 'integer', minimum: 0 },
    },
  },
  PublicCatalogCategory: {
    type: 'object',
    additionalProperties: false,
    required: ['slug', 'name', 'sortOrder'],
    properties: {
      slug: {
        type: 'string',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        maxLength: 120,
      },
      name: { type: 'string', minLength: 1, maxLength: 160 },
      sortOrder: { type: 'integer', minimum: 0, maximum: 2147483647 },
    },
  },
  PublicCatalogProductCard: {
    type: 'object',
    additionalProperties: false,
    required: [
      'slug',
      'displayName',
      'brand',
      'manufacturerName',
      'originalPartNumber',
      'modification',
      'category',
      'priceDisplay',
    ],
    properties: {
      slug: { type: 'string' },
      displayName: { type: 'string' },
      brand: { oneOf: [schema('PublicBrand'), { type: 'null' }] },
      manufacturerName: { type: ['string', 'null'] },
      originalPartNumber: { type: ['string', 'null'] },
      modification: { type: ['string', 'null'] },
      category: schema('PublicCategory'),
      priceDisplay: schema('PublicPriceDisplay'),
    },
  },
  PublicBrand: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'slug'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 160 },
      slug: {
        type: 'string',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        maxLength: 120,
      },
    },
    description:
      'Current active brand reference label; not a revision snapshot.',
  },
  PublicCategory: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'slug'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 160 },
      slug: {
        type: 'string',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        maxLength: 120,
      },
    },
    description:
      'Current active category reference label; not a revision snapshot.',
  },
  PublicPriceDisplay: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'label'],
    properties: {
      kind: { const: 'ON_REQUEST' },
      label: { const: 'Цена по запросу' },
    },
  },
  PublicCatalogProduct: {
    type: 'object',
    additionalProperties: false,
    required: [
      'slug',
      'displayName',
      'brand',
      'manufacturerName',
      'originalPartNumber',
      'modification',
      'category',
      'priceDisplay',
      'summary',
      'description',
      'attributes',
      'relations',
    ],
    properties: {
      slug: { type: 'string' },
      displayName: { type: 'string' },
      brand: { oneOf: [schema('PublicBrand'), { type: 'null' }] },
      manufacturerName: { type: ['string', 'null'] },
      originalPartNumber: { type: ['string', 'null'] },
      modification: { type: ['string', 'null'] },
      category: schema('PublicCategory'),
      priceDisplay: schema('PublicPriceDisplay'),
      summary: { type: ['string', 'null'] },
      description: { type: ['string', 'null'] },
      attributes: {
        type: 'array',
        maxItems: 300,
        items: schema('PublicAttributeValue'),
      },
      relations: {
        type: 'array',
        maxItems: 100,
        items: schema('PublicCatalogRelation'),
      },
    },
  },
  PublicCatalogRelation: {
    type: 'object',
    additionalProperties: false,
    required: ['relationType', 'target'],
    properties: {
      relationType: {
        type: 'string',
        enum: ['ACCESSORY', 'COMPATIBLE_EQUIPMENT'],
      },
      target: schema('PublicCatalogProductCard'),
    },
  },
  PublicAttributeValue: {
    oneOf: attributeValueTypes.map((valueType) =>
      schema(`CatalogAttributeValue${valueType}`),
    ),
    discriminator: { propertyName: 'valueType' },
  },
  ...Object.fromEntries(
    attributeValueTypes.map((valueType) => [
      `CatalogAttributeInput${valueType}`,
      typedCatalogAttributeInput(valueType),
    ]),
  ),
  ...Object.fromEntries(
    attributeValueTypes.map((valueType) => [
      `CatalogAttributeValue${valueType}`,
      typedCatalogAttributeValue(valueType),
    ]),
  ),
};

function envelope(dataSchema) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'meta'],
    properties: { data: dataSchema, meta: schema('Meta') },
  };
}
function listSchema(itemSchema) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'meta'],
    properties: {
      data: { type: 'array', items: schema(itemSchema) },
      meta: {
        type: 'object',
        additionalProperties: false,
        required: ['requestId', 'limit', 'nextCursor'],
        properties: {
          requestId: { type: 'string', format: 'uuid' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          nextCursor: {
            type: ['string', 'null'],
            maxLength: 256,
            pattern: '^[A-Za-z0-9_-]+$',
          },
        },
      },
    },
  };
}

schemas.CatalogBrandListResponse = listSchema('CatalogBrand');
schemas.CatalogBrandResponse = envelope(schema('CatalogBrand'));
schemas.CatalogCategoryListResponse = listSchema('CatalogCategory');
schemas.CatalogCategoryResponse = envelope(schema('CatalogCategory'));
schemas.CatalogAttributeListResponse = listSchema('CatalogAttributeDefinition');
schemas.CatalogAttributeResponse = envelope(
  schema('CatalogAttributeDefinition'),
);
schemas.StaffCatalogProductListResponse = listSchema('StaffCatalogProduct');
schemas.StaffCatalogProductResponse = envelope(
  schema('StaffCatalogProductDetail'),
);
schemas.CatalogProductRelationsResponse = envelope({
  type: 'array',
  items: schema('CatalogProductRelation'),
});
schemas.CatalogProductMediaResponse = envelope({
  type: 'array',
  items: schema('CatalogMediaMetadata'),
});
schemas.CatalogProductDocumentsResponse = envelope({
  type: 'array',
  items: schema('CatalogDocumentMetadata'),
});
schemas.PublicCatalogCategoryListResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'array',
      maxItems: 100,
      items: schema('PublicCatalogCategory'),
    },
    meta: schema('PublicCategoryCursorPageMeta'),
  },
};
schemas.PublicCatalogProductListResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: { type: 'array', items: schema('PublicCatalogProductCard') },
    meta: schema('PublicPageMeta'),
  },
};
schemas.PublicCatalogProductResponse = envelope(schema('PublicCatalogProduct'));

const parameter = (name, location, schemaValue, extra = {}) => ({
  name,
  in: location,
  required: true,
  schema: schemaValue,
  ...extra,
});
const parameters = {
  OriginHeader: parameter(
    'Origin',
    'header',
    { type: 'string', format: 'uri' },
    {
      description: 'Exact configured trusted origin; missing/null is rejected.',
    },
  ),
  CsrfHeader: parameter(
    'X-CSRF-Token',
    'header',
    {
      type: 'string',
      minLength: 43,
      maxLength: 43,
      pattern: '^[A-Za-z0-9_-]{43}$',
    },
    {
      description:
        'STAFF-bound HMAC token; never a credential or logged value.',
    },
  ),
  CategoryId: parameter('categoryId', 'path', {
    type: 'string',
    format: 'uuid',
  }),
  BrandId: parameter('brandId', 'path', { type: 'string', format: 'uuid' }),
  AttributeId: parameter('attributeId', 'path', {
    type: 'string',
    format: 'uuid',
  }),
  ProductId: parameter('productId', 'path', { type: 'string', format: 'uuid' }),
  PublicSlug: parameter('slug', 'path', {
    type: 'string',
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    maxLength: 160,
  }),
  PublicCategoryParentSlug: parameter(
    'parentSlug',
    'query',
    {
      type: 'string',
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      maxLength: 120,
    },
    {
      required: false,
      description:
        'Optional exact ACTIVE parent slug. Omission selects root categories.',
    },
  ),
  PublicCategoryCursor: parameter(
    'cursor',
    'query',
    {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      pattern: '^[A-Za-z0-9_-]+$',
    },
    {
      required: false,
      description:
        'Opaque unpadded base64url cursor for the last returned sortOrder and slug tuple.',
    },
  ),
  PublicCategoryPageSize: parameter(
    'pageSize',
    'query',
    { type: 'integer', minimum: 1, maximum: 100, default: 24 },
    { required: false },
  ),
  StaffLimit: {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  },
  StaffCursor: {
    name: 'cursor',
    in: 'query',
    schema: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      pattern: '^[A-Za-z0-9_-]+$',
    },
    description:
      'Opaque base64url cursor over stable createdAt/id ordering; not an authorization token.',
  },
  CategoryIdQuery: {
    name: 'categoryId',
    in: 'query',
    schema: { type: 'string', format: 'uuid' },
    description:
      'Staff product list filter. With DRAFT, PENDING_REVIEW or PUBLISHED, this category must belong to that same pointer-selected revision. Without publicationState, it matches any current draft, pending or published revision pointer. Combining categoryId with ARCHIVED is rejected with VALIDATION_ERROR because product archival clears all current pointers; historical non-current revisions are ignored.',
  },
  ProductState: {
    name: 'publicationState',
    in: 'query',
    schema: {
      type: 'string',
      enum: ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED'],
    },
    description:
      'Staff product list filter. DRAFT, PENDING_REVIEW and PUBLISHED select the corresponding current revision pointer; ARCHIVED matches root CatalogProduct.publicationState.',
  },
};

const errorResponse = (description, codes) => ({
  description,
  headers: { 'X-Request-Id': requestIdHeader, 'Cache-Control': noStoreHeader },
  'x-error-codes': codes,
  content: { 'application/json': { schema: schema('CatalogError') } },
});
const responses = {
  ValidationError: errorResponse(
    'VALIDATION_ERROR or catalog query/type validation.',
    [
      'VALIDATION_ERROR',
      'CATEGORY_CYCLE',
      'CATEGORY_INACTIVE_PARENT',
      'ATTRIBUTE_NOT_APPLICABLE',
    ],
  ),
  Unauthorized: errorResponse('AUTH_REQUIRED.', ['AUTH_REQUIRED']),
  Forbidden: errorResponse(
    'FORBIDDEN, password policy, Origin or CSRF rejection.',
    [
      'FORBIDDEN',
      'PASSWORD_CHANGE_REQUIRED',
      'ORIGIN_FORBIDDEN',
      'CSRF_INVALID',
    ],
  ),
  NotFound: errorResponse(
    'NOT_FOUND; public draft/archived/unknown slug are indistinguishable.',
    ['NOT_FOUND'],
  ),
  Conflict: errorResponse(
    'OCC, identity, slug, reference or publication conflict.',
    [
      'VERSION_CONFLICT',
      'INVALID_STATE_TRANSITION',
      'IDENTITY_CONFLICT',
      'SLUG_CONFLICT',
      'PUBLICATION_NOT_READY',
      'REFERENCE_IN_USE',
    ],
  ),
  UnsupportedMediaType: errorResponse('UNSUPPORTED_MEDIA_TYPE.', [
    'UNSUPPORTED_MEDIA_TYPE',
  ]),
  InternalError: errorResponse('INTERNAL_ERROR.', ['INTERNAL_ERROR']),
  Unavailable: errorResponse('DEPENDENCY_UNAVAILABLE or AUDIT_UNAVAILABLE.', [
    'DEPENDENCY_UNAVAILABLE',
    'AUDIT_UNAVAILABLE',
  ]),
  PublicValidationError: {
    description:
      'VALIDATION_ERROR for malformed pagination or unsupported filter.',
    headers: { 'X-Request-Id': requestIdHeader },
    'x-error-codes': ['VALIDATION_ERROR', 'ATTRIBUTE_NOT_APPLICABLE'],
    content: { 'application/json': { schema: schema('CatalogError') } },
  },
  PublicNotFound: {
    description: 'NOT_FOUND, including unpublished or archived slug.',
    headers: { 'X-Request-Id': requestIdHeader },
    'x-error-codes': ['NOT_FOUND'],
    content: { 'application/json': { schema: schema('CatalogError') } },
  },
  PublicInternalError: {
    description: 'INTERNAL_ERROR.',
    headers: { 'X-Request-Id': requestIdHeader },
    'x-error-codes': ['INTERNAL_ERROR'],
    content: { 'application/json': { schema: schema('CatalogError') } },
  },
  PublicUnavailable: {
    description: 'DEPENDENCY_UNAVAILABLE.',
    headers: { 'X-Request-Id': requestIdHeader },
    'x-error-codes': ['DEPENDENCY_UNAVAILABLE'],
    content: { 'application/json': { schema: schema('CatalogError') } },
  },
};

const document = {
  openapi: '3.1.0',
  info: {
    title: 'STDU R1-004 Catalog API',
    version: '0.1.0-proposed',
    description:
      'PROPOSED contract only. R1-004B may implement after owner approval. This document does not modify FROZEN R1-002 1.0.0.',
  },
  servers: [
    {
      url: '/',
      description:
        'Production same-origin reverse proxy; relative server, no invented domain.',
    },
    {
      url: 'http://127.0.0.1:3001',
      description: 'Explicit loopback development only.',
    },
  ],
  tags: [
    {
      name: 'catalog-staff',
      description: 'Session-authenticated staff catalog API.',
    },
    {
      name: 'catalog-public',
      description: 'Published catalog only; no file delivery.',
    },
  ],
  paths,
  components: {
    securitySchemes: {
      staffCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Host-stdu_staff',
        description:
          'Exact frozen R1-002 opaque HttpOnly staff cookie. Explicit loopback uses stdu_staff_dev. Generated clients use credentials:include and never construct auth tokens.',
      },
    },
    parameters,
    responses,
    schemas,
  },
  'x-contract-status': 'PROPOSED / REVIEW_REQUIRED',
  'x-frozen-contracts': ['R1-002 1.0.0'],
  'x-pagination': {
    staff: 'limit 1..100 default 50; opaque createdAt/id cursor',
    public:
      'Catalog products: page 1..10000 default 1; pageSize 1..100 default 24. Categories: keyset cursor over sortOrder/slug; pageSize 1..100 default 24; no total count or page-number ceiling.',
  },
  'x-public-file-policy':
    'No media/document URL or public FileVersion DTO in R1-004B; add only after separate approved safe file delivery contract.',
  'x-catalog-permissions': Object.keys(
    JSON.parse(
      await readFile(
        resolve(root, 'docs/contracts/R1-004-catalog-rbac-matrix.json'),
        'utf8',
      ),
    ).permissions,
  ),
};

const content = await prettier.format(
  `${JSON.stringify(document, null, 2)}\n`,
  {
    filepath: output,
  },
);
const check = process.argv.includes('--check');
if (check) {
  const current = await readFile(output, 'utf8').catch(() => '');
  if (current !== content) {
    console.error(
      'R1-004 OpenAPI is missing or differs from its checked-in contract generator output.',
    );
    process.exitCode = 1;
  } else {
    console.log('PASS R1-004 OpenAPI output is reproducible.');
  }
} else {
  await writeFile(output, content, 'utf8');
  console.log(`Generated ${output}`);
}
