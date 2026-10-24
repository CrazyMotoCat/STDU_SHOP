import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { createCatalogRuntimeOpenApi } from '../src/openapi/export.js';
import {
  STAFF_POLICY,
  type StaffPolicy,
} from '../src/identity/authorization.js';
import {
  CsrfGuard,
  PermissionGuard,
  StaffSessionGuard,
} from '../src/identity/guards.js';
import {
  CatalogPublicController,
  CatalogStaffController,
} from '../src/catalog/catalog.controller.js';

type OpenApiParameter = {
  in: string;
  name: string;
  required?: boolean;
  $ref?: string;
};
type Operation = {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  'x-permission'?: unknown;
  'x-required-permissions'?: unknown;
  'x-csrf'?: unknown;
  'x-audit'?: unknown;
};
type PathItem = Record<string, Operation> & {
  parameters?: OpenApiParameter[];
};
type Document = {
  paths: Record<string, PathItem>;
  components?: {
    parameters?: Record<string, OpenApiParameter>;
    schemas?: Record<
      string,
      { properties?: Record<string, { enum?: unknown[] }> }
    >;
  };
};

const repositoryRoot = resolve(
  fileURLToPath(new URL('../../../', import.meta.url)),
);
const contract = JSON.parse(
  await readFile(
    resolve(repositoryRoot, 'docs/contracts/R1-004-catalog.openapi.json'),
    'utf8',
  ),
) as Document;
const actual = (await createCatalogRuntimeOpenApi()) as Document;
const methodNames = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
]);

function fail(message: string): never {
  throw new Error(message);
}

function routePath(controller: object, handler: object) {
  const prefix = Reflect.getMetadata('path', controller) as
    string | string[] | undefined;
  const path = Reflect.getMetadata('path', handler) as
    string | string[] | undefined;
  const prefixValue = Array.isArray(prefix) ? prefix[0] : prefix;
  const pathValue = Array.isArray(path) ? path[0] : path;
  return `/${[prefixValue, pathValue]
    .filter((part) => part !== undefined && part !== '')
    .join('/')}`
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\/+/g, '/');
}

function routeMethod(handler: object) {
  const method = Reflect.getMetadata('method', handler) as number | undefined;
  if (method === undefined) return fail('Catalog route has no HTTP method.');
  const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
  const result = methods[method];
  if (!result)
    return fail(`Catalog route has unsupported HTTP method ${method}.`);
  return result.toLowerCase();
}

function contractParameters(operation: Operation) {
  return (operation.parameters ?? []).map((parameter) => {
    if (!parameter.$ref) return parameter;
    const name = parameter.$ref.split('/').at(-1);
    const resolved = contract.components?.parameters?.[name ?? ''];
    if (!resolved)
      return fail(`Unresolved catalog parameter ${parameter.$ref}.`);
    return resolved;
  });
}

function successStatuses(operation: Operation) {
  return Object.keys(operation.responses ?? {})
    .filter((status) => status.startsWith('2'))
    .sort();
}

function responseStatuses(operation: Operation) {
  return Object.keys(operation.responses ?? {}).sort();
}

const expected = new Map<string, Operation>();
for (const [path, pathItem] of Object.entries(contract.paths))
  for (const [method, operation] of Object.entries(pathItem))
    if (methodNames.has(method) && operation.operationId)
      expected.set(`${method.toUpperCase()} ${path}`, operation);

const actualRoutes = new Set<string>();
for (const controller of [CatalogStaffController, CatalogPublicController]) {
  const isStaff = controller === CatalogStaffController;
  const classGuards =
    (Reflect.getMetadata(GUARDS_METADATA, controller) as
      unknown[] | undefined) ?? [];
  if (
    isStaff &&
    (!classGuards.includes(StaffSessionGuard) ||
      !classGuards.includes(CsrfGuard) ||
      !classGuards.includes(PermissionGuard))
  )
    fail('Catalog staff controller lacks session, CSRF, or permission guards.');
  if (!isStaff && classGuards.length > 0)
    fail('Public catalog routes must not acquire staff-only guards.');

  const prototype = controller.prototype as unknown as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const handler = prototype[name];
    if (
      typeof handler !== 'function' ||
      Reflect.getMetadata('path', handler) === undefined
    )
      continue;
    const path = routePath(controller, handler);
    const method = routeMethod(handler);
    const routeKey = `${method.toUpperCase()} ${path}`;
    const expectedOperation = expected.get(routeKey);
    if (!expectedOperation) fail(`Uncontracted catalog route ${routeKey}.`);
    if (actualRoutes.has(routeKey))
      fail(`Duplicate catalog route ${routeKey}.`);
    actualRoutes.add(routeKey);

    const actualOperation = actual.paths[path]?.[method];
    if (!actualOperation)
      fail(`Swagger did not export catalog route ${routeKey}.`);
    if (actualOperation.operationId !== expectedOperation.operationId)
      fail(`${routeKey} operationId differs from frozen catalog OpenAPI.`);

    const policy = Reflect.getMetadata(STAFF_POLICY, handler) as
      StaffPolicy | undefined;
    if (isStaff) {
      if (!policy)
        fail(`Staff catalog route ${routeKey} has no StaffOperation.`);
      if (policy.permission !== expectedOperation['x-permission'])
        fail(`${routeKey} permission differs from frozen catalog RBAC.`);
      if (policy.csrf !== expectedOperation['x-csrf'])
        fail(`${routeKey} CSRF policy differs from frozen catalog OpenAPI.`);
      if (policy.audit !== expectedOperation['x-audit'])
        fail(`${routeKey} audit policy differs from frozen catalog registry.`);
      const actualRequired = actualOperation['x-required-permissions'];
      const expectedRequired = expectedOperation['x-required-permissions'];
      if (
        JSON.stringify(actualRequired ?? null) !==
        JSON.stringify(expectedRequired ?? null)
      )
        fail(
          `${routeKey} additional permission requirements differ from the frozen contract.`,
        );
    } else if (policy || expectedOperation['x-permission']) {
      fail(
        `${routeKey} public route unexpectedly has a staff permission policy.`,
      );
    }

    const expectedPathItem = contract.paths[path];
    const expectedParameters = contractParameters({
      parameters: [
        ...(expectedPathItem.parameters ?? []),
        ...(expectedOperation.parameters ?? []),
      ],
    })
      .map(
        (parameter) =>
          `${parameter.in}:${parameter.name}:${parameter.required === true}`,
      )
      .sort();
    const actualParameters = (actualOperation.parameters ?? [])
      .map(
        (parameter) =>
          `${parameter.in}:${parameter.name}:${parameter.required === true}`,
      )
      .sort();
    if (JSON.stringify(actualParameters) !== JSON.stringify(expectedParameters))
      fail(
        `${routeKey} parameter names or required flags differ from frozen OpenAPI: expected ${expectedParameters.join(', ')}; got ${actualParameters.join(', ')}.`,
      );

    if (
      Boolean(expectedOperation.requestBody) !==
      Boolean(actualOperation.requestBody)
    )
      fail(`${routeKey} request-body presence differs from frozen OpenAPI.`);
    if (
      JSON.stringify(successStatuses(actualOperation)) !==
      JSON.stringify(successStatuses(expectedOperation))
    )
      fail(`${routeKey} success status codes differ from frozen OpenAPI.`);
    if (
      JSON.stringify(responseStatuses(actualOperation)) !==
      JSON.stringify(responseStatuses(expectedOperation))
    )
      fail(
        `${routeKey} response status codes differ from frozen OpenAPI: expected ${responseStatuses(expectedOperation).join(', ')}; got ${responseStatuses(actualOperation).join(', ')}.`,
      );
  }
}

if (actualRoutes.size !== 31 || expected.size !== 31)
  fail(
    `Expected 31 catalog routes (28 staff, 3 public); found runtime ${actualRoutes.size}, contract ${expected.size}.`,
  );
if ([...expected.keys()].some((route) => !actualRoutes.has(route)))
  fail('A frozen catalog route is missing from the Nest controllers.');

const errorCodes =
  contract.components?.schemas?.CatalogError?.properties?.code?.enum;
if (!Array.isArray(errorCodes))
  fail('CatalogError has no frozen error code enum.');
console.log(
  'PASS live Nest catalog route inventory: 31 operations (28 staff, 3 public), guards, permissions, CSRF, audit, parameters, bodies, and response statuses match FROZEN OpenAPI.',
);
