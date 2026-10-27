import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants.js';
import { NestFactory } from '@nestjs/core';
import {
  SwaggerModule,
  DocumentBuilder,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { AppModule } from '../app.module.js';
import {
  STAFF_POLICY,
  REQUIRED_PERMISSION,
  type StaffPolicy,
} from '../identity/authorization.js';
import { AuthController } from '../identity/auth.controller.js';
import {
  CsrfGuard,
  PermissionGuard,
  StaffSessionGuard,
} from '../identity/guards.js';
import { REGISTERED_PERMISSION_CODES } from '../permissions/policy.js';
import { StaffController } from '../staff/staff.controller.js';
import { SupplierStaffController } from '../suppliers/suppliers.controller.js';
import { StaffInquiriesController } from '../inquiries/inquiries.controller.js';
import { STAFF_OPERATION_CONTRACT_NOTES } from './operation-notes.js';
import { STAFF_OPENAPI_ROOT_EXTENSIONS } from './root-extensions.js';

const headers = {
  requestId: {
    description:
      'Generated server request UUID; never trusted caller identity.',
    schema: { type: 'string', format: 'uuid' },
  },
  cache: { schema: { type: 'string', enum: ['no-store'] } },
  cookie: {
    description:
      'Cookie(s) according to auth-security.md. Production __Host-stdu_staff/__Host-stdu_login; explicit loopback development names stdu_staff_dev/stdu_login_dev. No Domain; Path=/; HttpOnly; SameSite=Lax; Secure on HTTPS. Never exposed through CORS.',
    schema: { type: 'string' },
  },
  retry: { schema: { type: 'integer', minimum: 1 } },
};

const cookieErrorStatuses: Record<string, string[]> = {
  getCsrf: ['403'],
  login: ['401', '403'],
  logout: ['401'],
  changeMyPassword: ['401'],
};

function getStaffPolicy(handler: object): StaffPolicy | undefined {
  return Reflect.getMetadata(STAFF_POLICY, handler) as StaffPolicy | undefined;
}

function routePath(controller: object, handler: object) {
  const prefix = Reflect.getMetadata(PATH_METADATA, controller) as
    string | string[] | undefined;
  const path = Reflect.getMetadata(PATH_METADATA, handler) as
    string | string[] | undefined;
  const prefixValue = Array.isArray(prefix) ? prefix[0] : prefix;
  const pathValue = Array.isArray(path) ? path[0] : path;
  return `/${[prefixValue, pathValue].filter((part) => part !== undefined && part !== '').join('/')}`
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function routeMethod(handler: object) {
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as
    RequestMethod | undefined;
  if (method === undefined)
    throw new Error('Staff route has no Nest HTTP method metadata.');
  const name = RequestMethod[method]?.toLowerCase();
  if (!name || name === 'all')
    throw new Error('Staff route has an unsupported Nest HTTP method.');
  return name;
}

function inventoryRoutes(
  document: OpenAPIObject,
  controllers: Array<{ prototype: object; name: string }> = [
    AuthController,
    StaffController,
  ],
  expectedCount = 23,
) {
  const registered: {
    path: string;
    method: string;
    operationId: string;
    policy: StaffPolicy;
  }[] = [];
  for (const controller of controllers) {
    const classGuards =
      (Reflect.getMetadata(GUARDS_METADATA, controller) as
        unknown[] | undefined) ?? [];
    const prototype = controller.prototype as unknown as Record<
      string,
      unknown
    >;
    for (const propertyName of Object.getOwnPropertyNames(prototype)) {
      if (propertyName === 'constructor') continue;
      const handler = prototype[propertyName];
      if (
        typeof handler !== 'function' ||
        Reflect.getMetadata(PATH_METADATA, handler) === undefined
      )
        continue;
      const policy = getStaffPolicy(handler);
      if (!policy)
        throw new Error(
          `Unannotated Staff API route: ${controller.name}.${propertyName}`,
        );
      if (
        !classGuards.includes(StaffSessionGuard) ||
        !classGuards.includes(CsrfGuard)
      )
        throw new Error(
          `Staff route lacks authentication/CSRF guards: ${controller.name}.${propertyName}`,
        );
      if (policy.permission) {
        if (!classGuards.includes(PermissionGuard))
          throw new Error(
            `Permission route lacks PermissionGuard: ${controller.name}.${propertyName}`,
          );
        if (
          Reflect.getMetadata(REQUIRED_PERMISSION, handler) !==
          policy.permission
        )
          throw new Error(
            `Permission metadata diverges from policy: ${controller.name}.${propertyName}`,
          );
      }
      const path = routePath(controller, handler);
      const method = routeMethod(handler);
      const operation = document.paths[path]?.[
        method as keyof (typeof document.paths)[string]
      ] as Record<string, unknown> | undefined;
      if (!operation || typeof operation.operationId !== 'string')
        throw new Error(
          `Swagger did not export guarded Staff route ${method.toUpperCase()} ${path}; paths=${JSON.stringify(Object.keys(document.paths))}`,
        );
      operation.security =
        operation.operationId === 'getCsrf'
          ? []
          : policy.csrf === 'LOGIN_OR_STAFF_BOUND'
            ? [{ loginChallengeCookie: [] }, { staffCookie: [] }]
            : [{ staffCookie: [] }];
      operation['x-permission'] = policy.permission;
      operation['x-csrf'] = policy.csrf;
      operation['x-audit'] = policy.audit;
      const notes =
        STAFF_OPERATION_CONTRACT_NOTES[
          operation.operationId as keyof typeof STAFF_OPERATION_CONTRACT_NOTES
        ];
      if (!notes)
        throw new Error(
          `Missing route invariants for ${operation.operationId}.`,
        );
      operation['x-invariants'] = notes.invariants;
      operation['x-errors-before-object-lookup'] =
        notes.errorsBeforeObjectLookup;
      registered.push({
        path,
        method,
        operationId: operation.operationId,
        policy,
      });
    }
  }
  if (registered.length !== expectedCount)
    throw new Error(
      `Expected ${expectedCount} Staff API routes, found ${registered.length}.`,
    );
  const ids = new Set(registered.map(({ operationId }) => operationId));
  if (ids.size !== expectedCount)
    throw new Error('Duplicate Staff API operationId found.');
  return registered;
}

function normalizeSchema(schema: unknown): void {
  if (!schema || typeof schema !== 'object') return;
  const value = schema as Record<string, unknown>;
  if (
    (value.type === 'object' || value.properties) &&
    value.additionalProperties === undefined
  )
    value.additionalProperties = false;
  if (value.properties && typeof value.properties === 'object')
    Object.values(value.properties).forEach(normalizeSchema);
  if (value.items) normalizeSchema(value.items);
  for (const key of ['allOf', 'oneOf', 'anyOf'])
    if (Array.isArray(value[key]))
      (value[key] as unknown[]).forEach(normalizeSchema);
}

function retainReferencedSchemas(document: OpenAPIObject) {
  const schemas = document.components?.schemas;
  if (!schemas) return;
  const pending = new Set<string>(['PermissionCode']);
  const visited = new Set<string>();
  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === 'string') {
      const prefix = '#/components/schemas/';
      if (record.$ref.startsWith(prefix))
        pending.add(record.$ref.slice(prefix.length));
      return;
    }
    Object.values(record).forEach(collect);
  };
  collect(document.paths);
  while (pending.size > 0) {
    const name = pending.values().next().value as string | undefined;
    if (!name) break;
    pending.delete(name);
    if (visited.has(name)) continue;
    visited.add(name);
    collect(schemas[name]);
  }
  for (const name of Object.keys(schemas))
    if (!visited.has(name)) delete schemas[name];
}

function finalizeDocument(document: OpenAPIObject) {
  Object.assign(document, STAFF_OPENAPI_ROOT_EXTENSIONS);
  document.openapi = '3.0.3';
  document.info = {
    title: 'STDU R1-002 Staff API',
    version: '1.0.0',
    description:
      'FROZEN 1.0.0; owner approved OD-002A-01..08 at 867184f60d5306b58dd66ac6607a6ec0487761d3. Baseline ec109be. No auth implementation/migration in R1-002A. x-permission/x-csrf/x-audit/x-invariants/x-error-codes are mandatory contract semantics, not Swagger-only decoration.',
  };
  document.servers = [
    {
      url: '/',
      description:
        'Production same-origin reverse proxy; relative server, no invented domain.',
    },
    {
      url: 'http://127.0.0.1:3001',
      description:
        'Explicit loopback development; use deployment cookie profile.',
    },
  ];
  document.security = [{ staffCookie: [] }];
  document.components ??= {};
  document.components.securitySchemes = {
    staffCookie: {
      type: 'apiKey',
      in: 'cookie',
      name: '__Host-stdu_staff',
      description:
        'Opaque HttpOnly token, SHA256 verification hash in PostgreSQL. Explicit dev profile name stdu_staff_dev; generated clients must use credentials:include, never construct auth cookie/token.',
    },
    loginChallengeCookie: {
      type: 'apiKey',
      in: 'cookie',
      name: '__Host-stdu_login',
      description:
        'Ephemeral pre-login HttpOnly random challenge cookie; SHA256-only Redis key with TTL, consumed once. Not employee authentication. Explicit dev profile name stdu_login_dev.',
    },
  };
  document.components.schemas ??= {};
  document.components.schemas.PermissionCode = {
    type: 'string',
    enum: [...REGISTERED_PERMISSION_CODES],
  };

  for (const path of Object.keys(document.paths))
    if (
      !path.startsWith('/v1/staff') ||
      path.startsWith('/v1/staff/catalog') ||
      path.startsWith('/v1/staff/supplier') ||
      path.startsWith('/v1/staff/inquiries')
    )
      delete document.paths[path];
  inventoryRoutes(document);
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!path.startsWith('/v1/staff')) continue;
    for (const operation of Object.values(pathItem)) {
      if (
        !operation ||
        typeof operation !== 'object' ||
        !('responses' in operation)
      )
        continue;
      const record = operation as {
        operationId?: string;
        responses: Record<
          string,
          {
            headers?: Record<string, unknown>;
            content?: Record<string, unknown>;
          }
        >;
      };
      const setCookieStatuses = new Set([
        ...(record.operationId
          ? (cookieErrorStatuses[record.operationId] ?? [])
          : []),
        ...Object.keys(record.responses).filter((status) =>
          status.startsWith('2'),
        ),
      ]);
      for (const [status, response] of Object.entries(record.responses)) {
        response.headers = {
          'X-Request-Id': headers.requestId,
          'Cache-Control': headers.cache,
          ...(setCookieStatuses.has(status)
            ? { 'Set-Cookie': headers.cookie }
            : {}),
          ...(status === '429' ? { 'Retry-After': headers.retry } : {}),
        };
        if (!status.startsWith('2'))
          response.content = {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          };
      }
    }
  }
  retainReferencedSchemas(document);
  for (const schema of Object.values(document.components.schemas))
    normalizeSchema(schema);
  return document;
}

async function createNestOpenApiDocument() {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await app.init();
    const config = new DocumentBuilder()
      .setTitle('STDU R1-002 Staff API')
      .setVersion('1.0.0')
      .setDescription(
        'Generated from the implemented Staff controllers and guards.',
      )
      .setOpenAPIVersion('3.0.3')
      .addApiKey(
        { type: 'apiKey', in: 'cookie', name: '__Host-stdu_staff' },
        'staffCookie',
      )
      .addApiKey(
        { type: 'apiKey', in: 'cookie', name: '__Host-stdu_login' },
        'loginChallengeCookie',
      )
      .addSecurityRequirements('staffCookie')
      .addServer(
        '/',
        'Production same-origin reverse proxy; relative server, no invented domain.',
      )
      .addServer(
        'http://127.0.0.1:3001',
        'Explicit loopback development; use deployment cookie profile.',
      )
      .build();
    return SwaggerModule.createDocument(app, config);
  } finally {
    await app.close();
  }
}

export async function createStaffOpenApi() {
  return finalizeDocument(await createNestOpenApiDocument());
}

export async function createCatalogRuntimeOpenApi() {
  return createNestOpenApiDocument();
}

export async function createSupplierRuntimeOpenApi() {
  const document = await createNestOpenApiDocument();
  for (const path of Object.keys(document.paths))
    if (!path.startsWith('/v1/staff/supplier')) delete document.paths[path];
  inventoryRoutes(document, [SupplierStaffController], 20);
  for (const schema of Object.values(document.components?.schemas ?? {}))
    normalizeSchema(schema);
  return document;
}

const INQUIRY_OPENAPI_SCHEMAS = {
  ContactSnapshotDto: {
    type: 'object',
    additionalProperties: false,
    required: ['contactName'],
    properties: {
      contactName: { type: 'string', minLength: 1, maxLength: 180 },
      email: {
        type: 'string',
        nullable: true,
        format: 'email',
        maxLength: 254,
      },
      phone: { type: 'string', nullable: true, maxLength: 40 },
      organization: { type: 'string', nullable: true, maxLength: 200 },
      taxIdentifier: { type: 'string', nullable: true, maxLength: 24 },
      preferredChannel: {
        type: 'string',
        nullable: true,
        enum: ['EMAIL', 'PHONE'],
      },
      region: { type: 'string', nullable: true, maxLength: 120 },
      desiredDeadline: { type: 'string', nullable: true, maxLength: 120 },
      customerComment: { type: 'string', nullable: true, maxLength: 3000 },
    },
    anyOf: [
      {
        required: ['email'],
        properties: { email: { type: 'string' } },
        additionalProperties: true,
      },
      {
        required: ['phone'],
        properties: { phone: { type: 'string' } },
        additionalProperties: true,
      },
    ],
  },
  EquipmentLineDto: {
    type: 'object',
    additionalProperties: false,
    required: ['rawTitle', 'quantity', 'unit'],
    properties: {
      rawTitle: { type: 'string', minLength: 1, maxLength: 500 },
      originalSku: { type: 'string', nullable: true, maxLength: 160 },
      manufacturerName: { type: 'string', nullable: true, maxLength: 200 },
      modification: { type: 'string', nullable: true, maxLength: 200 },
      quantity: {
        type: 'string',
        maxLength: 19,
        pattern: '^(?=.*[1-9])(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?$',
      },
      unit: { type: 'string', minLength: 1, maxLength: 40 },
      notes: { type: 'string', nullable: true, maxLength: 4000 },
      catalogProductSlugContext: {
        type: 'string',
        nullable: true,
        maxLength: 160,
      },
    },
  },
  PanelsDetailsDto: {
    type: 'object',
    additionalProperties: false,
    required: ['requestType', 'description'],
    properties: {
      requestType: {
        type: 'string',
        enum: ['PROJECT_READY', 'MODIFY_TYPICAL', 'DEVELOP_FROM_BRIEF'],
      },
      cabinetPurpose: { type: 'string', nullable: true, maxLength: 2000 },
      quantity: {
        type: 'string',
        nullable: true,
        maxLength: 19,
        pattern: '^(?=.*[1-9])(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?$',
      },
      requirements: { type: 'string', nullable: true, maxLength: 8000 },
      requestedWork: {
        type: 'array',
        maxItems: 50,
        items: { type: 'string', maxLength: 500 },
      },
      description: { type: 'string', minLength: 1, maxLength: 8000 },
      documentationAvailability: {
        type: 'string',
        nullable: true,
        enum: ['UNKNOWN', 'AVAILABLE', 'PARTIAL', 'NONE'],
      },
      notes: { type: 'string', nullable: true, maxLength: 3000 },
    },
  },
  EngineeringDetailsDto: {
    type: 'object',
    additionalProperties: false,
    required: ['technicalTask'],
    properties: {
      engineeringDirection: { type: 'string', nullable: true, maxLength: 200 },
      systemType: { type: 'string', nullable: true, maxLength: 200 },
      technicalTask: { type: 'string', minLength: 1, maxLength: 8000 },
      expectedDeliverables: {
        type: 'string',
        nullable: true,
        maxLength: 1800,
      },
      sourceDocumentDescription: {
        type: 'string',
        nullable: true,
        maxLength: 1500,
      },
      scope: { type: 'string', nullable: true, maxLength: 2500 },
      notes: { type: 'string', nullable: true, maxLength: 2500 },
    },
  },
};

export async function createInquiryRuntimeOpenApi() {
  const document = await createNestOpenApiDocument();
  for (const path of Object.keys(document.paths))
    if (
      !path.startsWith('/v1/public/inquiries') &&
      !path.startsWith('/v1/public/inquiry-attachments') &&
      !path.startsWith('/v1/staff/inquiries')
    )
      delete document.paths[path];
  inventoryRoutes(document, [StaffInquiriesController], 11);
  document.components ??= {};
  document.components.schemas ??= {};
  Object.assign(document.components.schemas, INQUIRY_OPENAPI_SCHEMAS);
  const contactSchema = document.components?.schemas?.ContactSnapshotDto as
    Record<string, unknown> | undefined;
  if (!contactSchema)
    throw new Error('Inquiry OpenAPI ContactSnapshotDto schema is missing.');
  const expectedPublic: [string, string, string][] = [
    ['createPublicInquiry', 'post', '/v1/public/inquiries'],
    [
      'createInquiryUploadIntent',
      'post',
      '/v1/public/inquiry-attachments/upload-intents',
    ],
    [
      'uploadInquirySourceDocument',
      'put',
      '/v1/public/inquiry-attachments/upload-intents/{intentId}/content',
    ],
    [
      'cancelInquiryUploadIntent',
      'delete',
      '/v1/public/inquiry-attachments/upload-intents/{intentId}',
    ],
  ];
  for (const [operationId, method, path] of expectedPublic) {
    const operation = document.paths[path]?.[
      method as keyof (typeof document.paths)[string]
    ] as Record<string, unknown> | undefined;
    if (operation?.operationId !== operationId)
      throw new Error(
        `Missing public Inquiry operation ${method.toUpperCase()} ${path}.`,
      );
    operation.security =
      operationId === 'createPublicInquiry'
        ? []
        : [{ InquiryUploadCapability: [] }];
  }
  document.components ??= {};
  document.components.securitySchemes ??= {};
  document.components.securitySchemes.InquiryUploadCapability = {
    type: 'apiKey',
    in: 'header',
    name: 'X-Inquiry-Upload-Capability',
    description:
      '256-bit capability sent only in this header; the server hashes it to resolve one Inquiry and verify the bound intent.',
  };
  document.openapi = '3.0.3';
  document.info = {
    title: 'STDU R1-010 Inquiry API',
    version: '1.0.2',
    description:
      'Generated from the implemented R1-010 public and staff controllers. FROZEN R1-010 Contract Amendment 01 is the normative DTO and response definition.',
  };
  document.servers = [{ url: '/' }, { url: 'http://127.0.0.1:3001' }];
  retainReferencedSchemas(document);
  for (const schema of Object.values(document.components?.schemas ?? []))
    normalizeSchema(schema);
  return document;
}
