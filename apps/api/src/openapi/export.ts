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
    .replace(/\/+/g, '/');
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

function inventoryRoutes(document: OpenAPIObject) {
  const registered: {
    path: string;
    method: string;
    operationId: string;
    policy: StaffPolicy;
  }[] = [];
  for (const controller of [AuthController, StaffController]) {
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
  if (registered.length !== 23)
    throw new Error(
      `Expected 23 Staff API routes, found ${registered.length}.`,
    );
  const ids = new Set(registered.map(({ operationId }) => operationId));
  if (ids.size !== 23)
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
    if (!path.startsWith('/v1/staff')) delete document.paths[path];
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
  for (const schema of Object.values(document.components.schemas))
    normalizeSchema(schema);
  return document;
}

export async function createStaffOpenApi() {
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
    const document = SwaggerModule.createDocument(app, config);
    return finalizeDocument(document);
  } finally {
    await app.close();
  }
}
