import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  request as httpsRequest,
  createServer as createHttpsServer,
} from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { chromium } from 'playwright';
import * as selfsigned from 'selfsigned';
import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../src/app.factory.js';
import {
  bootstrapStaff,
  StaffAccessCliError,
} from '../src/cli/staff-access.js';
import { IdentityCrypto } from '../src/identity/crypto.js';
import { DATABASE, REDIS } from '../src/database/database.module.js';
import {
  RateLimitService,
  type LoginReservation,
} from '../src/identity/rate-limit.service.js';
import { adminInvariantMembers } from '../src/permissions/policy.js';
import { resolveRateLimitSourceAddress } from '../src/identity/rate-limit.service.js';
import { readConfig } from '../src/config.js';
import type { StaffRequest } from '../src/identity/request.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const origin = 'http://127.0.0.1:3000';
let rootPassword = '';
let rootEmail = '';
const accessPassword = 'R1-002B access initial password long 01!';
const accessChangedPassword = 'R1-002B access changed password long 02!';
const allPermissions = [
  'staff.users.read',
  'staff.users.create',
  'staff.users.status.write',
  'staff.sessions.revoke',
  'staff.roles.read',
  'staff.roles.write',
  'staff.roles.permissions.write',
  'staff.roles.assign',
  'sellers.read',
  'sellers.write',
  'audit.read',
  'files.metadata.read',
];
const catalogPermissions = [
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
const supplierPermissions = [
  'suppliers.read',
  'suppliers.write',
  'suppliers.offers.read',
  'suppliers.offers.write',
  'suppliers.matches.decide',
];
const inquiryPermissions = [
  'inquiries.read_assigned',
  'inquiries.read_all',
  'inquiries.contacts.read',
  'inquiries.assign_manager',
  'inquiries.assign_engineer',
  'inquiries.transition',
  'inquiries.comment',
  'inquiries.documents.read',
  'inquiries.documents.download',
];
const controlPermissions = allPermissions.slice(0, 8);
const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const ttyShimUrl = pathToFileURL(
  fileURLToPath(new URL('./tty-shim.mjs', import.meta.url)),
).href;
type FrozenOperation = {
  operationId: string;
  'x-permission'?: string | null;
  security?: Record<string, unknown>[];
};
type ApiData = {
  [key: string]: unknown;
  id?: string;
  version?: number;
  token?: string;
  passwordChangeRequired?: boolean;
  permissions?: string[];
};
type ApiMeta = {
  [key: string]: unknown;
  requestId?: string;
  nextCursor?: string | null;
};
type ApiBody = {
  [key: string]: unknown;
  code?: string;
  message?: string;
  data: ApiData;
  meta: ApiMeta;
};
type ApiResult = { status: number; body: ApiBody; headers: Headers };

const frozenOpenApi = readFile(
  new URL('../../../docs/contracts/R1-002-staff.openapi.json', import.meta.url),
  'utf8',
).then(
  (value) =>
    JSON.parse(value) as {
      paths: Record<string, Record<string, FrozenOperation>>;
    },
);

class StaffAgent {
  readonly cookies = new Map<string, string>();
  baseUrl = '';

  remember(response: Response) {
    const cookies = response.headers.getSetCookie?.() ?? [];
    for (const item of cookies) {
      const pair = item.split(';', 1)[0] ?? '';
      const split = pair.indexOf('=');
      if (split < 1) continue;
      const name = pair.slice(0, split);
      const value = pair.slice(split + 1);
      if (!value || /max-age=0/i.test(item)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  cookieHeader() {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    options: {
      csrf?: string;
      origin?: string | null;
      contentType?: string;
      secFetchSite?: string;
    } = {},
  ): Promise<ApiResult> {
    const headers = new Headers();
    if (options.origin !== null)
      headers.set('Origin', options.origin ?? origin);
    if (this.cookies.size) headers.set('Cookie', this.cookieHeader());
    if (options.contentType !== undefined)
      headers.set('Content-Type', options.contentType);
    if (options.secFetchSite !== undefined)
      headers.set('Sec-Fetch-Site', options.secFetchSite);
    if (body !== undefined) {
      headers.set('Content-Type', options.contentType ?? 'application/json');
    }
    const writes = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
    if (writes && options.csrf) headers.set('X-CSRF-Token', options.csrf);
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    this.remember(response);
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      parsed = text;
    }
    const record =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const data =
      record.data &&
      typeof record.data === 'object' &&
      !Array.isArray(record.data)
        ? (record.data as ApiData)
        : {};
    const meta =
      record.meta &&
      typeof record.meta === 'object' &&
      !Array.isArray(record.meta)
        ? (record.meta as ApiMeta)
        : {};
    return {
      status: response.status,
      body: { ...record, data, meta } as ApiBody,
      headers: response.headers,
    };
  }

  async csrf() {
    const response = await this.request('GET', '/v1/staff/auth/csrf');
    expect(response.status).toBe(200);
    expect(response.body.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    return response.body.data.token as string;
  }

  async write(
    method: string,
    path: string,
    body?: unknown,
    options: { origin?: string | null; contentType?: string } = {},
  ) {
    const token = await this.csrf();
    return this.request(method, path, body, { ...options, csrf: token });
  }

  async login(email: string, password: string) {
    const token = await this.csrf();
    return this.request(
      'POST',
      '/v1/staff/auth/login',
      { email, password },
      { csrf: token },
    );
  }
}

function runBootstrapCli(input: {
  email: string;
  displayName: string;
  operatorLabel: string;
  password: string;
}) {
  const args = [
    '--import',
    'tsx',
    'scripts/staff-access.ts',
    'bootstrap',
    '--email',
    input.email,
    '--display-name',
    input.displayName,
    '--operator',
    input.operatorLabel,
  ];
  const child = spawn(process.execPath, args, {
    cwd: apiRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${ttyShimUrl}`]
        .filter(Boolean)
        .join(' '),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  let answerCount = 0;
  let promptCount = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    args: string[];
  }>((resolveResult, rejectResult) => {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      promptCount =
        stdout.match(/(?:Repeat )?password \(hidden\):/gi)?.length ?? 0;
      while (answerCount < Math.min(promptCount, 2)) {
        child.stdin.write(`${input.password}\n`);
        answerCount++;
      }
      if (answerCount === 2) child.stdin.end();
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectResult);
    child.once('close', (code, signal) => {
      closed = true;
      if (timer) clearTimeout(timer);
      resolveResult({ code, signal, stdout, stderr, args });
    });
    timer = setTimeout(() => {
      if (closed) return;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!closed) child.kill('SIGKILL');
      }, 1000);
      rejectResult(
        new Error(
          `Bootstrap CLI child timed out; prompts=${promptCount}, answersSent=${answerCount}, stdinWritable=${child.stdin.writable}, stdinDestroyed=${child.stdin.destroyed}; args contained no password. Output: ${(stdout + stderr).slice(-500)}`,
        ),
      );
    }, 20_000);
  });
  return result;
}

let app: Awaited<ReturnType<typeof createApiApp>>;
let apiUrl = '';
let ownerDb: PrismaClient;
let ownerPg: Client;
let rootUserId = '';
let rootRoleId = '';
let accessUserId = '';
let accessRoleId = '';
let secondFullUserId = '';
let secondFullEmail = '';
let secondFullPassword = '';
let secondBaseRoleId = '';
let secondCriticalRoleId = '';
let rootAgent: StaffAgent;
let accessAgent: StaffAgent;
let secondAgent: StaffAgent;
let sellerId = '';
let requestBarrier:
  | { userId: string; path: string; entered(): void; wait: Promise<void> }
  | undefined;

class RuntimeRequestGateInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const gate = requestBarrier;
    if (
      gate &&
      request.staff?.id === gate.userId &&
      request.path === gate.path &&
      request.method === 'POST'
    ) {
      requestBarrier = undefined;
      gate.entered();
      await gate.wait;
    }
    return next.handle();
  }
}

function requireUrl(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for R1-002B runtime tests.`);
  return value;
}

async function connectOwner() {
  const adapter = new PrismaPg({
    connectionString: requireUrl('MIGRATION_DATABASE_URL'),
  });
  ownerDb = new PrismaClient({ adapter });
  await ownerDb.$connect();
  ownerPg = new Client({
    connectionString: requireUrl('MIGRATION_DATABASE_URL'),
  });
  await ownerPg.connect();
}

async function flushRedis() {
  const redis = app.get(REDIS);
  await redis.flushdb();
}

async function ensureLoggedIn(
  agent: StaffAgent,
  email: string,
  password: string,
) {
  if (agent.cookies.has('stdu_staff_dev')) {
    const current = await agent.request('GET', '/v1/staff/auth/me');
    if (current.status === 200) return;
    agent.cookies.delete('stdu_staff_dev');
  }
  const result = await agent.login(email, password);
  expect(result.status).toBe(200);
}

async function createRole(
  agent: StaffAgent,
  code: string,
  permissions: string[],
) {
  const created = await agent.write('POST', '/v1/staff/roles', {
    code,
    name: code,
  });
  expect(created.status).toBe(201);
  const roleId = created.body.data.id as string;
  const updated = await agent.write(
    'PUT',
    `/v1/staff/roles/${roleId}/permissions`,
    { permissions, expectedVersion: 1 },
  );
  expect(updated.status).toBe(200);
  return roleId;
}

async function createStaffUser(
  agent: StaffAgent,
  email: string,
  password: string,
) {
  const created = await agent.write('POST', '/v1/staff/users', {
    email,
    displayName: 'Runtime Test User',
    initialPassword: password,
  });
  expect(created.status).toBe(201);
  return created.body.data as { id: string; version: number };
}

async function assignRole(
  agent: StaffAgent,
  userId: string,
  roleId: string,
  expectedVersion = 1,
) {
  return agent.write('PUT', `/v1/staff/users/${userId}/roles/${roleId}`, {
    expectedVersion,
  });
}

async function directFullAdmin(
  email: string,
  roleCodes: { code: string; permissions: string[] }[],
) {
  const crypto = new IdentityCrypto();
  const id = randomUUID();
  const password = `R1-002B fixture full admin ${randomBytes(5).toString('hex')}!`;
  const passwordHash = await crypto.hashPassword(password, email.toLowerCase());
  const roleIds: string[] = [];
  await ownerDb.$transaction(async (tx) => {
    await tx.staffUser.create({
      data: {
        id,
        email,
        emailNormalized: email.toLowerCase(),
        displayName: 'Fixture Full Admin',
        passwordHash,
        passwordChangeRequired: false,
        state: 'ACTIVE',
      },
    });
    for (const definition of roleCodes) {
      const roleId = randomUUID();
      roleIds.push(roleId);
      await tx.role.create({
        data: {
          id: roleId,
          code: definition.code,
          name: definition.code,
          state: 'ACTIVE',
        },
      });
      const permissions = await tx.permission.findMany({
        where: { code: { in: definition.permissions } },
        select: { id: true },
      });
      await tx.rolePermission.createMany({
        data: permissions.map(({ id: permissionId }) => ({
          roleId,
          permissionId,
        })),
      });
      await tx.userRole.create({ data: { staffUserId: id, roleId } });
    }
  });
  return { id, email, password, roleIds };
}

async function directEmployee(
  email: string,
  bundles: {
    code: string;
    permissions: string[];
    state?: 'ACTIVE' | 'ARCHIVED';
  }[] = [],
  options: {
    passwordChangeRequired?: boolean;
    state?: 'ACTIVE' | 'BLOCKED';
  } = {},
) {
  const password = `R1-002B fixture employee ${randomBytes(7).toString('hex')}!`;
  const passwordHash = await new IdentityCrypto().hashPassword(
    password,
    email.toLowerCase(),
  );
  const id = randomUUID();
  const roleIds: string[] = [];
  await ownerDb.$transaction(async (tx) => {
    await tx.staffUser.create({
      data: {
        id,
        email,
        emailNormalized: email.toLowerCase(),
        displayName: 'Fixture Employee',
        passwordHash,
        passwordChangeRequired: options.passwordChangeRequired ?? false,
        state: options.state ?? 'ACTIVE',
        blockedAt: options.state === 'BLOCKED' ? new Date() : null,
      },
    });
    for (const bundle of bundles) {
      const roleId = randomUUID();
      roleIds.push(roleId);
      await tx.role.create({
        data: {
          id: roleId,
          code: bundle.code,
          name: bundle.code,
          state: bundle.state ?? 'ACTIVE',
        },
      });
      const permissionRows = await tx.permission.findMany({
        where: { code: { in: bundle.permissions } },
        select: { id: true },
      });
      await tx.rolePermission.createMany({
        data: permissionRows.map(({ id: permissionId }) => ({
          roleId,
          permissionId,
        })),
      });
      await tx.userRole.create({ data: { staffUserId: id, roleId } });
    }
  });
  return { id, email, password, roleIds };
}

async function frozenOperations() {
  const spec = await frozenOpenApi;
  return Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      path,
      method: method.toUpperCase(),
      operationId: operation.operationId as string,
      permission: operation['x-permission'] as string | null,
      security: operation.security as Record<string, unknown>[] | undefined,
    })),
  );
}

function concretePath(path: string) {
  return path.replace(/\{[^}]+\}/g, () => randomUUID());
}

async function userVersion(userId: string) {
  const user = await ownerDb.staffUser.findUniqueOrThrow({
    where: { id: userId },
    select: { version: true },
  });
  return user.version;
}

async function expectFullAdminCount(expected: number) {
  const members = await ownerDb.$transaction((tx) => adminInvariantMembers(tx));
  expect(members.filter(({ fullAdmin }) => fullAdmin)).toHaveLength(expected);
}

describe.skipIf(
  !process.env.MIGRATION_DATABASE_URL ||
    !(process.env.STAFF_DATABASE_URL || process.env.DATABASE_URL) ||
    !process.env.REDIS_URL,
)('R1-002B real PostgreSQL + Redis runtime acceptance', () => {
  beforeAll(async () => {
    await connectOwner();
    app = await createApiApp();
    app.useGlobalInterceptors(new RuntimeRequestGateInterceptor());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string')
      throw new Error('API test listener did not bind a TCP port.');
    apiUrl = `http://127.0.0.1:${address.port}`;
    rootAgent = new StaffAgent();
    rootAgent.baseUrl = apiUrl;
  });

  afterAll(async () => {
    await app?.close();
    await ownerDb?.$disconnect();
    await ownerPg?.end();
  });

  it('T-15/T-16/T-17: R1-002 API remains compatible with additive catalog and supplier schemas and preserves migration fixtures', async () => {
    const models = await ownerPg.query(
      `SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])`,
      [
        [
          'staff_user',
          'role',
          'permission',
          'user_role',
          'role_permission',
          'staff_session',
          'audit_event',
          'seller_legal_entity',
          'file_object',
          'file_version',
          'file_link',
        ],
      ],
    );
    const counts = await ownerPg.query(
      `SELECT (SELECT count(*) FROM staff_user)::int AS users,
        (SELECT count(*) FROM staff_session)::int AS sessions,
        (SELECT count(*) FROM permission)::int AS permissions,
        (SELECT count(*) FROM permission WHERE code=ANY($1::text[]))::int AS r1_002_permissions,
        (SELECT count(*) FROM permission WHERE code=ANY($2::text[]))::int AS r1_004_permissions,
        (SELECT count(*) FROM permission WHERE code=ANY($3::text[]))::int AS r1_007_permissions,
        (SELECT count(*) FROM permission WHERE code=ANY($4::text[]))::int AS r1_010_permissions`,
      [
        allPermissions,
        catalogPermissions,
        supplierPermissions,
        inquiryPermissions,
      ],
    );
    const catalogModels = await ownerPg.query(
      `SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])`,
      [
        [
          'brand',
          'category',
          'attribute_definition',
          'catalog_product',
          'catalog_product_revision',
          'product_attribute_value',
          'product_media',
          'product_document_version',
          'product_relation',
        ],
      ],
    );
    const supplierModels = await ownerPg.query(
      `SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])`,
      [
        [
          'supplier',
          'supplier_revision',
          'supplier_offer',
          'supplier_offer_revision',
          'product_match_proposal',
          'supplier_command_idempotency',
        ],
      ],
    );
    const sentinel = await ownerPg.query(
      "SELECT payload FROM fixture_sentinel.sentinel WHERE key='r1-002b'",
    );
    expect(models.rows[0]?.count).toBe(11);
    expect(catalogModels.rows[0]?.count).toBe(9);
    expect(supplierModels.rows[0]?.count).toBe(6);
    expect(counts.rows[0]).toEqual({
      users: 0,
      sessions: 0,
      permissions: 38,
      r1_002_permissions: 12,
      r1_004_permissions: 12,
      r1_007_permissions: 5,
      r1_010_permissions: 9,
    });
    expect(sentinel.rows[0]?.payload).toBe('must-survive-migration');
  });

  it('T-16: runtime role defaults to REPEATABLE READ and can be explicitly constrained to READ COMMITTED', async () => {
    const runtimeDb = app.get(DATABASE) as PrismaClient;
    const defaults = await runtimeDb.$queryRaw<
      { transaction_isolation: string }[]
    >`SHOW transaction_isolation`;
    expect(defaults[0]?.transaction_isolation).toBe('repeatable read');
    const explicit = await runtimeDb.$transaction(
      (tx) =>
        tx.$queryRaw<
          { transaction_isolation: string }[]
        >`SHOW transaction_isolation`,
      { isolationLevel: 'ReadCommitted' },
    );
    expect(explicit[0]?.transaction_isolation).toBe('read committed');
  });

  it('T-01: every frozen staff-cookie operation rejects anonymous and invalid-cookie requests before side effects', async () => {
    const operations = await frozenOperations();
    const protectedOperations = operations.filter(
      ({ operationId, security }) =>
        operationId !== 'login' &&
        security?.some((requirement) =>
          Object.hasOwn(requirement, 'staffCookie'),
        ),
    );
    expect(operations).toHaveLength(23);
    expect(protectedOperations).toHaveLength(21);
    const before = await ownerPg.query(`
      SELECT (SELECT count(*)::int FROM staff_user) AS users,
             (SELECT count(*)::int FROM staff_session) AS sessions,
             (SELECT count(*)::int FROM audit_event) AS audit,
             (SELECT count(*)::int FROM seller_legal_entity) AS sellers,
             (SELECT count(*)::int FROM file_object) AS files
    `);
    const anonymous = new StaffAgent();
    anonymous.baseUrl = apiUrl;
    const invalid = new StaffAgent();
    invalid.baseUrl = apiUrl;
    for (const operation of protectedOperations) {
      const path = concretePath(operation.path);
      const noCookie = await anonymous.request(
        operation.method,
        path,
        undefined,
        { origin: 'https://outside.invalid' },
      );
      expect(
        noCookie.status,
        `${operation.method} ${operation.path} without cookie`,
      ).toBe(401);
      expect(noCookie.body.code).toBe('AUTH_REQUIRED');

      invalid.cookies.set(
        'stdu_staff_dev',
        randomBytes(32).toString('base64url'),
      );
      const badCookie = await invalid.request(
        operation.method,
        path,
        undefined,
        { origin: null },
      );
      expect(
        badCookie.status,
        `${operation.method} ${operation.path} with invalid cookie`,
      ).toBe(401);
      expect(badCookie.body.code).toBe('AUTH_REQUIRED');
    }
    const after = await ownerPg.query(`
      SELECT (SELECT count(*)::int FROM staff_user) AS users,
             (SELECT count(*)::int FROM staff_session) AS sessions,
             (SELECT count(*)::int FROM audit_event) AS audit,
             (SELECT count(*)::int FROM seller_legal_entity) AS sellers,
             (SELECT count(*)::int FROM file_object) AS files
    `);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('T-22: concurrent explicit bootstrap creates one usable full admin and records one conflict', async () => {
    const inputs = [
      {
        email: 'bootstrap-one@stdu.test',
        displayName: 'Bootstrap One',
        operatorLabel: 'R1 test operator',
        password: 'R1-002B bootstrap password with enough length 01!',
      },
      {
        email: 'bootstrap-two@stdu.test',
        displayName: 'Bootstrap Two',
        operatorLabel: 'R1 test operator',
        password: 'R1-002B second bootstrap password with length 02!',
      },
    ];
    const outcomes = await Promise.all(
      inputs.map((input) => runBootstrapCli(input)),
    );
    const succeeded = outcomes.filter(({ code }) => code === 0);
    const rejected = outcomes.filter(({ code }) => code !== 0);
    expect(
      succeeded,
      `Bootstrap child output: ${JSON.stringify(outcomes.map(({ code, stdout, stderr }) => ({ code, stdout, stderr })))}`,
    ).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.stderr).toContain('BOOTSTRAP_ALREADY_COMPLETED');
    for (let index = 0; index < outcomes.length; index++) {
      expect(outcomes[index]?.args.join(' ')).not.toContain(
        inputs[index]!.password,
      );
      expect(outcomes[index]?.stdout).not.toContain(inputs[index]!.password);
      expect(outcomes[index]?.stderr).not.toContain(inputs[index]!.password);
    }
    const createdEmail = inputs.find(({ email }) =>
      succeeded[0]!.stdout.includes(`email=${email}`),
    )!.email;
    rootUserId = (
      await ownerDb.staffUser.findUniqueOrThrow({
        where: { emailNormalized: createdEmail.toLowerCase() },
        select: { id: true },
      })
    ).id;
    rootEmail = createdEmail;
    rootPassword = inputs.find(({ email }) => email === rootEmail)!.password;
    const root = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: rootUserId },
      include: { roles: true },
    });
    expect(root.state).toBe('ACTIVE');
    expect(root.passwordChangeRequired).toBe(false);
    expect(root.roles).toHaveLength(1);
    rootRoleId = root.roles[0]!.roleId;
    expect(await ownerDb.staffSession.count()).toBe(0);
    expect(
      await ownerDb.auditEvent.count({
        where: { action: 'staff.bootstrap', outcome: 'SUCCESS' },
      }),
    ).toBe(1);
    expect(
      await ownerDb.auditEvent.count({
        where: { action: 'staff.bootstrap', outcome: 'DENIED' },
      }),
    ).toBe(1);
    await expect(
      bootstrapStaff(ownerDb, {
        email: 'bootstrap-existing@stdu.test',
        displayName: 'Existing Retry',
        operatorLabel: 'R1 test operator',
        password: 'R1-002B existing retry password 07!',
      }),
    ).rejects.toBeInstanceOf(StaffAccessCliError);
    await ownerPg.query(
      "UPDATE staff_user SET state='BLOCKED',blocked_at=clock_timestamp(),auth_version=auth_version+1,version=version+1 WHERE id=$1",
      [rootUserId],
    );
    try {
      await expect(
        bootstrapStaff(ownerDb, {
          email: 'bootstrap-blocked@stdu.test',
          displayName: 'Blocked Retry',
          operatorLabel: 'R1 test operator',
          password: 'R1-002B blocked retry password 08!',
        }),
      ).rejects.toMatchObject({ code: 'BOOTSTRAP_ALREADY_COMPLETED' });
    } finally {
      await ownerPg.query(
        "UPDATE staff_user SET state='ACTIVE',blocked_at=NULL,auth_version=auth_version+1,version=version+1 WHERE id=$1",
        [rootUserId],
      );
    }
    await expectFullAdminCount(1);
  });

  it('T-02: an active zero-permission employee is denied every permissioned operation but keeps credential self-service', async () => {
    await flushRedis();
    const fixture = await directEmployee(
      `zero-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const agent = new StaffAgent();
    agent.baseUrl = apiUrl;
    const login = await agent.login(fixture.email, fixture.password);
    expect(login.status).toBe(200);
    expect((await agent.request('GET', '/v1/staff/auth/me')).status).toBe(200);
    expect(
      (await agent.request('GET', '/v1/staff/auth/me/permissions')).body.data
        .permissions,
    ).toEqual([]);

    const permissioned = (await frozenOperations()).filter(
      ({ permission }) => permission !== null,
    );
    expect(permissioned).toHaveLength(17);
    const before = await ownerPg.query(`
      SELECT (SELECT count(*)::int FROM staff_user) AS users,
             (SELECT count(*)::int FROM role) AS roles,
             (SELECT count(*)::int FROM user_role) AS assignments,
             (SELECT count(*)::int FROM seller_legal_entity) AS sellers,
             (SELECT count(*)::int FROM audit_event WHERE outcome='SUCCESS') AS successes
    `);
    for (const operation of permissioned) {
      const method = operation.method;
      const path = concretePath(operation.path);
      const response = ['GET', 'HEAD'].includes(method)
        ? await agent.request(method, path)
        : await agent.write(method, path, undefined, {
            contentType: 'application/json',
          });
      expect(
        response.status,
        `${method} ${operation.path} without ${operation.permission}`,
      ).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    }
    const after = await ownerPg.query(`
      SELECT (SELECT count(*)::int FROM staff_user) AS users,
             (SELECT count(*)::int FROM role) AS roles,
             (SELECT count(*)::int FROM user_role) AS assignments,
             (SELECT count(*)::int FROM seller_legal_entity) AS sellers,
             (SELECT count(*)::int FROM audit_event WHERE outcome='SUCCESS') AS successes
    `);
    expect(after.rows[0]).toEqual(before.rows[0]);

    expect((await agent.request('GET', '/v1/staff/auth/csrf')).status).toBe(
      200,
    );
    const currentCookie = agent.cookies.get('stdu_staff_dev');
    const changedPassword = `R1-002B zero user replacement ${randomBytes(5).toString('hex')}!`;
    const change = await agent.write('PUT', '/v1/staff/auth/me/password', {
      currentPassword: fixture.password,
      newPassword: changedPassword,
    });
    expect(change.status).toBe(200);
    expect(
      change.headers
        .getSetCookie()
        .some(
          (value) => /HttpOnly/i.test(value) && /stdu_staff_dev=/i.test(value),
        ),
    ).toBe(true);
    const stale = new StaffAgent();
    stale.baseUrl = apiUrl;
    stale.cookies.set('stdu_staff_dev', currentCookie!);
    expect((await stale.request('GET', '/v1/staff/auth/me')).status).toBe(401);
    expect((await agent.write('POST', '/v1/staff/auth/logout')).status).toBe(
      200,
    );
    expect((await agent.request('GET', '/v1/staff/auth/me')).status).toBe(401);
  });

  it('T-03: each of the 12 permission codes enables only its declared operation and mutations return acknowledgements', async () => {
    await flushRedis();
    const statusTarget = await directEmployee(
      `t03-status-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const revokeTarget = await directEmployee(
      `t03-revoke-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const revokeTargetAgent = new StaffAgent();
    revokeTargetAgent.baseUrl = apiUrl;
    expect(
      (await revokeTargetAgent.login(revokeTarget.email, revokeTarget.password))
        .status,
    ).toBe(200);
    const assignmentTarget = await directEmployee(
      `t03-assign-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const roleEditTarget = await directEmployee(
      `t03-role-edit-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t03-edit-${randomUUID().slice(0, 8)}`,
          permissions: ['sellers.read'],
        },
      ],
    );
    const emptyRole = await ownerDb.role.create({
      data: {
        id: randomUUID(),
        code: `t03-empty-${randomUUID().slice(0, 8)}`,
        name: 'Empty assignment fixture',
        state: 'ACTIVE',
      },
    });
    const fileVersionId = randomUUID();
    const fileObjectId = randomUUID();
    const fileStorageKey = randomBytes(32).toString('hex');

    const actions: Record<
      string,
      (agent: StaffAgent, actorId: string) => Promise<ApiResult>
    > = {
      'staff.users.read': (agent) => agent.request('GET', '/v1/staff/users'),
      'staff.users.create': (agent) =>
        agent.write('POST', '/v1/staff/users', {
          email: `t03-created-${randomUUID().slice(0, 8)}@stdu.test`,
          displayName: 'Created by permission fixture',
          initialPassword: `R1-002B created user ${randomBytes(5).toString('hex')}!`,
        }),
      'staff.users.status.write': async (agent) =>
        agent.write('PATCH', `/v1/staff/users/${statusTarget.id}/status`, {
          state: 'BLOCKED',
          expectedVersion: await userVersion(statusTarget.id),
        }),
      'staff.sessions.revoke': async (agent) =>
        agent.write(
          'POST',
          `/v1/staff/users/${revokeTarget.id}/sessions/revoke`,
          {
            expectedVersion: await userVersion(revokeTarget.id),
          },
        ),
      'staff.roles.read': (agent) =>
        agent.request('GET', '/v1/staff/permissions'),
      'staff.roles.write': (agent) =>
        agent.write('POST', '/v1/staff/roles', {
          code: `t03-created-${randomUUID().slice(0, 8)}`,
          name: 'Created by permission fixture',
        }),
      'staff.roles.permissions.write': (agent) =>
        agent.write(
          'PUT',
          `/v1/staff/roles/${roleEditTarget.roleIds[0]}/permissions`,
          {
            permissions: [],
            expectedVersion: 1,
          },
        ),
      'staff.roles.assign': (agent) =>
        agent.write(
          'PUT',
          `/v1/staff/users/${assignmentTarget.id}/roles/${emptyRole.id}`,
          {
            expectedVersion: 1,
          },
        ),
      'sellers.read': (agent) => agent.request('GET', '/v1/staff/sellers'),
      'sellers.write': (agent) =>
        agent.write('POST', '/v1/staff/sellers', {
          displayName: `T03 draft ${randomUUID().slice(0, 8)}`,
          kind: 'OOO',
        }),
      'audit.read': (agent) => agent.request('GET', '/v1/staff/audit?limit=20'),
      'files.metadata.read': async (agent, actorId) => {
        await ownerDb.fileObject.create({
          data: {
            id: fileObjectId,
            ownerStaffUserId: actorId,
            displayName: 'owned.txt',
            visibility: 'PRIVATE',
            state: 'ACTIVE',
          },
        });
        await ownerDb.fileVersion.create({
          data: {
            id: fileVersionId,
            fileObjectId,
            number: 1,
            storageKey: fileStorageKey,
            sha256: new Uint8Array(32),
            sizeBytes: 1n,
            mimeType: 'text/plain',
            originalFilename: 'owned.txt',
            safetyState: 'UNCHECKED',
            createdByUserId: actorId,
          },
        });
        return agent.request('GET', `/v1/staff/files/${fileObjectId}/metadata`);
      },
    };
    expect(Object.keys(actions).sort()).toEqual([...allPermissions].sort());

    for (const permission of allPermissions) {
      const fixture = await directEmployee(
        `t03-${permission.replaceAll('.', '-')}-${randomUUID().slice(0, 6)}@stdu.test`,
        [
          {
            code: `t03-${permission.replaceAll('.', '-')}-${randomUUID().slice(0, 6)}`,
            permissions: [permission],
          },
        ],
      );
      const agent = new StaffAgent();
      agent.baseUrl = apiUrl;
      const login = await agent.login(fixture.email, fixture.password);
      expect(login.status, `${permission} login`).toBe(200);
      expect(
        (await agent.request('GET', '/v1/staff/auth/me/permissions')).body.data
          .permissions,
      ).toEqual([permission]);
      const operation = await actions[permission]!(agent, fixture.id);
      const expectedStatus = [
        'staff.users.create',
        'staff.roles.write',
        'sellers.write',
      ].includes(permission)
        ? 201
        : 200;
      expect(operation.status, `${permission} operation`).toBe(expectedStatus);
      if (
        expectedStatus !== 200 ||
        ![
          'staff.users.read',
          'staff.roles.read',
          'sellers.read',
          'audit.read',
          'files.metadata.read',
        ].includes(permission)
      ) {
        expect(Object.keys(operation.body.data).sort()).toEqual([
          'id',
          'version',
        ]);
      }
      expect(JSON.stringify(operation.body)).not.toMatch(
        /passwordHash|initialPassword|storageKey|tokenHash/,
      );

      const noReadPermission =
        permission === 'staff.users.read'
          ? await agent.request('GET', '/v1/staff/roles')
          : await agent.request('GET', '/v1/staff/users');
      expect(
        noReadPermission.status,
        `${permission} must not imply an unrelated read permission`,
      ).toBe(403);
      expect(noReadPermission.body.code).toBe('FORBIDDEN');
      if (permission === 'staff.sessions.revoke')
        expect(
          (await revokeTargetAgent.request('GET', '/v1/staff/auth/me')).status,
        ).toBe(401);
      if (permission === 'sellers.write')
        expect(
          (
            await agent.request(
              'GET',
              `/v1/staff/sellers/${operation.body.data.id}`,
            )
          ).status,
        ).toBe(403);
      if (permission === 'files.metadata.read')
        expect(JSON.stringify(operation.body)).not.toContain(fileStorageKey);
    }
  });

  it('T-04: ACTIVE role bundles form a sorted union and ARCHIVED roles grant no permission', async () => {
    const fixture = await directEmployee(
      `t04-union-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t04-base-${randomUUID().slice(0, 8)}`,
          permissions: ['sellers.read'],
        },
        {
          code: `t04-archive-${randomUUID().slice(0, 8)}`,
          permissions: ['sellers.read', 'audit.read'],
        },
      ],
    );
    const agent = new StaffAgent();
    agent.baseUrl = apiUrl;
    expect((await agent.login(fixture.email, fixture.password)).status).toBe(
      200,
    );
    expect(
      (await agent.request('GET', '/v1/staff/auth/me/permissions')).body.data
        .permissions,
    ).toEqual(['audit.read', 'sellers.read']);
    expect((await agent.request('GET', '/v1/staff/audit')).status).toBe(200);
    await ownerDb.role.update({
      where: { id: fixture.roleIds[1] },
      data: { state: 'ARCHIVED' },
    });
    expect(
      (await agent.request('GET', '/v1/staff/auth/me/permissions')).body.data
        .permissions,
    ).toEqual(['sellers.read']);
    expect((await agent.request('GET', '/v1/staff/sellers')).status).toBe(200);
    expect((await agent.request('GET', '/v1/staff/audit')).status).toBe(403);
  });

  it('T-11: self edits, grant ceiling, role permission editing, and role assignment remain separate permissions', async () => {
    const selfRole = await directEmployee(
      `t11-self-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t11-self-assign-${randomUUID().slice(0, 8)}`,
          permissions: ['staff.roles.assign'],
        },
        {
          code: `t11-self-seller-${randomUUID().slice(0, 8)}`,
          permissions: ['sellers.read'],
        },
      ],
    );
    const selfAgent = new StaffAgent();
    selfAgent.baseUrl = apiUrl;
    expect(
      (await selfAgent.login(selfRole.email, selfRole.password)).status,
    ).toBe(200);
    const ownRoleVersion = await userVersion(selfRole.id);
    const selfAssignment = await selfAgent.write(
      'PUT',
      `/v1/staff/users/${selfRole.id}/roles/${selfRole.roleIds[0]}`,
      { expectedVersion: ownRoleVersion },
    );
    expect(selfAssignment.body.code).toBe('SELF_PRIVILEGE_CHANGE_FORBIDDEN');
    const selfRemoval = await selfAgent.write(
      'DELETE',
      `/v1/staff/users/${selfRole.id}/roles/${selfRole.roleIds[1]}?expectedVersion=${ownRoleVersion}`,
    );
    expect(selfRemoval.body.code).toBe('SELF_PRIVILEGE_CHANGE_FORBIDDEN');

    const permissionEditor = await directEmployee(
      `t11-permission-editor-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t11-permission-editor-role-${randomUUID().slice(0, 8)}`,
          permissions: ['staff.roles.permissions.write'],
        },
        {
          code: `t11-assigned-to-editor-${randomUUID().slice(0, 8)}`,
          permissions: ['staff.roles.permissions.write'],
        },
      ],
    );
    const permissionEditorAgent = new StaffAgent();
    permissionEditorAgent.baseUrl = apiUrl;
    expect(
      (
        await permissionEditorAgent.login(
          permissionEditor.email,
          permissionEditor.password,
        )
      ).status,
    ).toBe(200);
    const selfBundleEdit = await permissionEditorAgent.write(
      'PUT',
      `/v1/staff/roles/${permissionEditor.roleIds[1]}/permissions`,
      {
        permissions: [],
        expectedVersion: 1,
      },
    );
    expect(selfBundleEdit.body.code).toBe('SELF_PRIVILEGE_CHANGE_FORBIDDEN');
    const overCeilingEditRole = await ownerDb.role.create({
      data: {
        id: randomUUID(),
        code: `t11-ceiling-edit-${randomUUID().slice(0, 8)}`,
        name: 'Ceiling target',
        state: 'ACTIVE',
      },
    });
    const overCeilingEdit = await permissionEditorAgent.write(
      'PUT',
      `/v1/staff/roles/${overCeilingEditRole.id}/permissions`,
      {
        permissions: ['sellers.read'],
        expectedVersion: 1,
      },
    );
    expect(overCeilingEdit.body.code).toBe('GRANT_CEILING_EXCEEDED');
    const permissionEditorRename = await permissionEditorAgent.write(
      'PATCH',
      `/v1/staff/roles/${overCeilingEditRole.id}`,
      { name: 'Renamed', expectedVersion: 1 },
    );
    expect(permissionEditorRename.status).toBe(403);

    const assignmentOnly = await directEmployee(
      `t11-assignment-only-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t11-assignment-only-role-${randomUUID().slice(0, 8)}`,
          permissions: ['staff.roles.assign'],
        },
      ],
    );
    const assignmentOnlyAgent = new StaffAgent();
    assignmentOnlyAgent.baseUrl = apiUrl;
    expect(
      (
        await assignmentOnlyAgent.login(
          assignmentOnly.email,
          assignmentOnly.password,
        )
      ).status,
    ).toBe(200);
    const assignmentTarget = await directEmployee(
      `t11-target-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const emptyRole = await ownerDb.role.create({
      data: {
        id: randomUUID(),
        code: `t11-empty-${randomUUID().slice(0, 8)}`,
        name: 'Assignable empty role',
        state: 'ACTIVE',
      },
    });
    const permittedAssignment = await assignmentOnlyAgent.write(
      'PUT',
      `/v1/staff/users/${assignmentTarget.id}/roles/${emptyRole.id}`,
      { expectedVersion: 1 },
    );
    expect(permittedAssignment.status).toBe(200);
    const assignmentOnlyRename = await assignmentOnlyAgent.write(
      'PATCH',
      `/v1/staff/roles/${emptyRole.id}`,
      { name: 'Forbidden rename', expectedVersion: 1 },
    );
    expect(assignmentOnlyRename.status).toBe(403);
    const assignmentOnlyPermissionEdit = await assignmentOnlyAgent.write(
      'PUT',
      `/v1/staff/roles/${emptyRole.id}/permissions`,
      { permissions: [], expectedVersion: 1 },
    );
    expect(assignmentOnlyPermissionEdit.status).toBe(403);
    const sellerRole = await ownerDb.role.create({
      data: {
        id: randomUUID(),
        code: `t11-over-ceiling-${randomUUID().slice(0, 8)}`,
        name: 'Over ceiling assignment',
        state: 'ACTIVE',
      },
    });
    await ownerDb.rolePermission.create({
      data: {
        roleId: sellerRole.id,
        permissionId: (
          await ownerDb.permission.findUniqueOrThrow({
            where: { code: 'sellers.read' },
          })
        ).id,
      },
    });
    const overCeilingAssignment = await assignmentOnlyAgent.write(
      'PUT',
      `/v1/staff/users/${assignmentTarget.id}/roles/${sellerRole.id}`,
      { expectedVersion: 2 },
    );
    expect(overCeilingAssignment.body.code).toBe('GRANT_CEILING_EXCEEDED');

    const roleWriter = await directEmployee(
      `t11-role-writer-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t11-role-writer-permission-${randomUUID().slice(0, 8)}`,
          permissions: ['staff.roles.write'],
        },
      ],
    );
    const roleWriterAgent = new StaffAgent();
    roleWriterAgent.baseUrl = apiUrl;
    expect(
      (await roleWriterAgent.login(roleWriter.email, roleWriter.password))
        .status,
    ).toBe(200);
    const createdRole = await roleWriterAgent.write('POST', '/v1/staff/roles', {
      code: `t11-created-${randomUUID().slice(0, 8)}`,
      name: 'Created without assignment right',
    });
    expect(createdRole.status).toBe(201);
    const roleWriterAssignment = await roleWriterAgent.write(
      'PUT',
      `/v1/staff/users/${assignmentTarget.id}/roles/${emptyRole.id}`,
      { expectedVersion: 2 },
    );
    expect(roleWriterAssignment.status).toBe(403);
  });

  it('T-28: stale versions fail before no-op handling, while true no-ops preserve audit and sessions', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const target = await directEmployee(
      `t28-target-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const assignedRoleId = await createRole(
      rootAgent,
      `t28-assigned-${randomUUID().slice(0, 8)}`,
      ['sellers.read'],
    );
    expect(
      (await assignRole(rootAgent, target.id, assignedRoleId, 1)).status,
    ).toBe(200);
    const targetAgent = new StaffAgent();
    targetAgent.baseUrl = apiUrl;
    expect(
      (await targetAgent.login(target.email, target.password)).status,
    ).toBe(200);
    const current = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: target.id },
    });
    const sessionCount = await ownerDb.staffSession.count({
      where: { staffUserId: target.id, revokedAt: null },
    });
    const assignmentSuccessAuditCount = await ownerDb.auditEvent.count({
      where: { action: 'staff.role.assigned', outcome: 'SUCCESS' },
    });
    const assignmentDenialAuditCount = await ownerDb.auditEvent.count({
      where: { action: 'staff.role.assigned', outcome: 'DENIED' },
    });

    const staleDuplicate = await rootAgent.write(
      'PUT',
      `/v1/staff/users/${target.id}/roles/${assignedRoleId}`,
      { expectedVersion: 1 },
    );
    expect(staleDuplicate.status).toBe(409);
    expect(staleDuplicate.body.code).toBe('VERSION_CONFLICT');
    expect(
      await ownerDb.auditEvent.count({
        where: { action: 'staff.role.assigned', outcome: 'DENIED' },
      }),
    ).toBe(assignmentDenialAuditCount + 1);
    const duplicate = await rootAgent.write(
      'PUT',
      `/v1/staff/users/${target.id}/roles/${assignedRoleId}`,
      { expectedVersion: current.version },
    );
    expect(duplicate).toMatchObject({
      status: 200,
      body: { data: { version: current.version } },
    });
    expect(
      await ownerDb.staffUser.findUniqueOrThrow({ where: { id: target.id } }),
    ).toMatchObject({
      version: current.version,
      authVersion: current.authVersion,
    });
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: target.id, revokedAt: null },
      }),
    ).toBe(sessionCount);
    expect(
      await ownerDb.auditEvent.count({
        where: { action: 'staff.role.assigned', outcome: 'SUCCESS' },
      }),
    ).toBe(assignmentSuccessAuditCount);

    const unusedRole = await ownerDb.role.create({
      data: {
        id: randomUUID(),
        code: `t28-unused-${randomUUID().slice(0, 8)}`,
        name: 'Unused role',
        state: 'ACTIVE',
      },
    });
    const missingRemoval = await rootAgent.write(
      'DELETE',
      `/v1/staff/users/${target.id}/roles/${unusedRole.id}?expectedVersion=${current.version}`,
    );
    expect(missingRemoval).toMatchObject({
      status: 200,
      body: { data: { version: current.version } },
    });
    const assignedDefinition = await ownerDb.role.findUniqueOrThrow({
      where: { id: assignedRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    const unchangedPermissions = await rootAgent.write(
      'PUT',
      `/v1/staff/roles/${assignedRoleId}/permissions`,
      {
        permissions: assignedDefinition.permissions.map(
          ({ permission }) => permission.code,
        ),
        expectedVersion: assignedDefinition.version,
      },
    );
    expect(unchangedPermissions).toMatchObject({
      status: 200,
      body: { data: { version: assignedDefinition.version } },
    });
    expect(
      (
        await rootAgent.write('PATCH', `/v1/staff/roles/${assignedRoleId}`, {
          state: 'ARCHIVED',
          expectedVersion: assignedDefinition.version,
        })
      ).body.code,
    ).toBe('ROLE_IN_USE');
    expect((await targetAgent.request('GET', '/v1/staff/auth/me')).status).toBe(
      200,
    );
  });

  it('T-31: unknown fields, malformed identifiers, cursors, bounds, and versions return stable validation errors without value echo', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const sentinel = `never-echo-${randomBytes(8).toString('hex')}`;
    const unknownProperty = await rootAgent.write('POST', '/v1/staff/roles', {
      code: `t31-${randomUUID().slice(0, 8)}`,
      name: 'Valid role',
      unexpectedField: sentinel,
    });
    expect(unknownProperty.status).toBe(400);
    expect(JSON.stringify(unknownProperty.body)).not.toContain(sentinel);
    const badUuid = await rootAgent.write(
      'PATCH',
      '/v1/staff/users/not-a-uuid/status',
      { state: 'BLOCKED', expectedVersion: 1 },
    );
    expect(badUuid.status).toBe(400);
    expect(badUuid.body.code).toBe('VALIDATION_ERROR');
    const badCursor = await rootAgent.request(
      'GET',
      '/v1/staff/users?cursor=%%%',
    );
    expect(badCursor.status).toBe(400);
    expect(badCursor.body.code).toBe('VALIDATION_ERROR');
    const encodeCursor = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const [path, cursor] of [
      ['/v1/staff/users', encodeCursor({})],
      ['/v1/staff/roles', encodeCursor({ id: 'not-a-uuid' })],
      [
        '/v1/staff/audit',
        encodeCursor({ occurredAt: 'not-a-date', id: randomUUID() }),
      ],
    ]) {
      const invalid = await rootAgent.request(
        'GET',
        `${path}?cursor=${cursor}`,
      );
      expect(invalid.status).toBe(400);
      expect(invalid.body.code).toBe('VALIDATION_ERROR');
    }
    const badLimit = await rootAgent.request('GET', '/v1/staff/roles?limit=0');
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.code).toBe('VALIDATION_ERROR');
    const target = await directEmployee(
      `t31-version-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const badVersion = await rootAgent.write(
      'POST',
      `/v1/staff/users/${target.id}/sessions/revoke`,
      { expectedVersion: 0 },
    );
    expect(badVersion.status).toBe(400);
    expect(badVersion.body.code).toBe('VALIDATION_ERROR');
    const badEmail = await rootAgent.write('POST', '/v1/staff/users', {
      email: `${sentinel}@invalid`,
      displayName: 'Invalid address',
      initialPassword: `R1-002B password ${randomBytes(5).toString('hex')}!`,
    });
    expect(badEmail.status).toBe(400);
    expect(JSON.stringify(badEmail.body)).not.toContain(sentinel);
  });

  it('T-02/T-03/T-04/T-13/T-14: real login is generic, cookies hold only raw token, DB stores SHA-256 and errors redact secrets', async () => {
    await flushRedis();
    const loginAgent = new StaffAgent();
    loginAgent.baseUrl = apiUrl;
    const unknown = await loginAgent.login(
      'nobody@stdu.test',
      'No such account password long enough 00!',
    );
    const knownBad = await loginAgent.login(
      rootEmail,
      'Wrong password with enough length 00!',
    );
    expect(knownBad.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.status).toBe(401);
    expect(knownBad.status).toBe(401);
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
    expect(knownBad.body.code).toBe('INVALID_CREDENTIALS');
    expect(JSON.stringify(unknown.body)).not.toContain('nobody@stdu.test');
    expect(JSON.stringify(knownBad.body)).not.toContain('Wrong password');

    rootAgent = new StaffAgent();
    rootAgent.baseUrl = apiUrl;
    const login = await rootAgent.login(rootEmail, rootPassword);
    expect(login.status).toBe(200);
    expect(login.body.data).not.toHaveProperty('passwordHash');
    expect(login.body.data).not.toHaveProperty('token');
    const cookie = rootAgent.cookies.get('stdu_staff_dev');
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      login.headers
        .getSetCookie()
        .some(
          (value) =>
            /HttpOnly/i.test(value) &&
            /SameSite=Lax/i.test(value) &&
            /Path=\//i.test(value),
        ),
    ).toBe(true);
    const tokenHash = createHash('sha256')
      .update(Buffer.from(cookie!, 'base64url'))
      .digest();
    const { decodeSessionToken } = await import('../src/identity/crypto.js');
    expect(Buffer.from(decodeSessionToken(cookie)!)).toEqual(
      Buffer.from(cookie!, 'base64url'),
    );
    expect(decodeSessionToken(`${cookie}=`)).toBeNull();
    expect(JSON.stringify(login.body)).not.toContain(cookie!);
    const session = await ownerDb.staffSession.findFirstOrThrow({
      where: { tokenHash: new Uint8Array(tokenHash) },
    });
    expect(Buffer.from(session.tokenHash)).toEqual(tokenHash);
    expect(session.tokenHash.byteLength).toBe(32);
    expect(JSON.stringify(session)).not.toContain(cookie!);
    for (const table of [
      'staff_user',
      'role',
      'permission',
      'user_role',
      'role_permission',
      'staff_session',
      'audit_event',
      'seller_legal_entity',
      'file_object',
      'file_version',
      'file_link',
    ]) {
      const rows = await ownerPg.query(
        `SELECT to_jsonb(row_value)::text AS row FROM ${table} AS row_value`,
      );
      expect(
        rows.rows.some(({ row }) => String(row).includes(cookie!)),
        `Raw token persisted in ${table}`,
      ).toBe(false);
    }

    const noOrigin = await rootAgent.request(
      'POST',
      '/v1/staff/auth/login',
      { email: rootEmail, password: rootPassword },
      { csrf: await rootAgent.csrf(), origin: null },
    );
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.code).toBe('ORIGIN_FORBIDDEN');
    const badOrigin = await rootAgent.write(
      'POST',
      '/v1/staff/auth/login',
      { email: rootEmail, password: rootPassword },
      { origin: 'https://outside.invalid' },
    );
    expect(badOrigin.status).toBe(403);
    expect(badOrigin.body.code).toBe('ORIGIN_FORBIDDEN');
    const current = await rootAgent.request('GET', '/v1/staff/auth/me');
    expect(current.status).toBe(200);
    expect(current.headers.get('cache-control')).toBe('no-store');
    expect(current.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('T-05/T-11/T-28/T-31/T-32: create, assign, force password change, rotate session, enforce permission and CAS rules', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const limitedRole = await createRole(
      rootAgent,
      `seller-read-${randomUUID().slice(0, 8)}`,
      ['sellers.read'],
    );
    const initialPassword = 'R1-002B first staff secret enough length 03!';
    const created = await createStaffUser(
      rootAgent,
      `staff-${randomUUID().slice(0, 8)}@stdu.test`,
      initialPassword,
    );
    expect(await assignRole(rootAgent, created.id, limitedRole)).toMatchObject({
      status: 200,
    });
    const email = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: created.id },
      select: { email: true },
    });
    const user = new StaffAgent();
    user.baseUrl = apiUrl;
    const login = await user.login(email.email, initialPassword);
    expect(login.status).toBe(200);
    expect(login.body.data.passwordChangeRequired).toBe(true);
    const restricted = await user.request('GET', '/v1/staff/sellers');
    expect(restricted.status).toBe(403);
    expect(restricted.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const priorCookie = user.cookieHeader();
    const changed = await user.write('PUT', '/v1/staff/auth/me/password', {
      currentPassword: initialPassword,
      newPassword: 'R1-002B permanent staff secret enough length 04!',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.data.passwordChangeRequired).toBe(false);
    const oldSession = new StaffAgent();
    oldSession.baseUrl = apiUrl;
    oldSession.cookies.set('stdu_staff_dev', priorCookie.split('=')[1]!);
    expect((await oldSession.request('GET', '/v1/staff/auth/me')).status).toBe(
      401,
    );
    expect((await user.request('GET', '/v1/staff/sellers')).status).toBe(200);
    expect((await user.request('GET', '/v1/staff/users')).status).toBe(403);
    const stale = await rootAgent.write(
      'POST',
      `/v1/staff/users/${created.id}/sessions/revoke`,
      { expectedVersion: 1 },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    const logout = await user.write('POST', '/v1/staff/auth/logout');
    expect(logout.status).toBe(200);
    expect((await user.request('GET', '/v1/staff/auth/me')).status).toBe(401);
  });

  it('T-09/T-10: CSRF binding/origin/media checks and real Redis rate limits fail closed', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const contentType = await rootAgent.write(
      'POST',
      '/v1/staff/roles',
      { code: 'wrong-media', name: 'Wrong Media' },
      { contentType: 'text/plain' },
    );
    expect(contentType.status).toBe(415);
    const sessionsBeforeWrongLoginMedia = await ownerDb.staffSession.count({
      where: { staffUserId: rootUserId },
    });
    const wrongLoginMedia = await rootAgent.write(
      'POST',
      '/v1/staff/auth/login',
      { email: rootEmail, password: rootPassword },
      { contentType: 'application/x-www-form-urlencoded' },
    );
    expect(wrongLoginMedia.status).toBe(415);
    expect(
      await ownerDb.staffSession.count({ where: { staffUserId: rootUserId } }),
    ).toBe(sessionsBeforeWrongLoginMedia);
    const csrf = await rootAgent.request('POST', '/v1/staff/roles', {
      code: 'no-csrf',
      name: 'No CSRF',
    });
    expect(csrf.status).toBe(403);
    expect(csrf.body.code).toBe('CSRF_INVALID');
    const validStaffCsrf = await rootAgent.csrf();
    const wrongStaffCsrf = await rootAgent.request(
      'POST',
      '/v1/staff/roles',
      {
        code: `wrong-binding-${randomUUID().slice(0, 8)}`,
        name: 'Wrong binding',
      },
      { csrf: 'A'.repeat(43) },
    );
    expect(wrongStaffCsrf.status).toBe(403);
    expect(wrongStaffCsrf.body.code).toBe('CSRF_INVALID');
    const crossSite = await rootAgent.request(
      'POST',
      '/v1/staff/roles',
      { code: `cross-site-${randomUUID().slice(0, 8)}`, name: 'Cross site' },
      {
        csrf: validStaffCsrf,
        origin,
        contentType: 'application/json',
        secFetchSite: 'cross-site',
      },
    );
    expect(crossSite.status).toBe(403);
    expect(crossSite.body.code).toBe('ORIGIN_FORBIDDEN');
    const missingOrigin = await rootAgent.request(
      'POST',
      '/v1/staff/roles',
      { code: `null-origin-${randomUUID().slice(0, 8)}`, name: 'No origin' },
      {
        csrf: validStaffCsrf,
        origin: null,
        contentType: 'application/json',
      },
    );
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.code).toBe('ORIGIN_FORBIDDEN');
    const foreignGet = await rootAgent.request(
      'GET',
      '/v1/staff/users',
      undefined,
      { origin: 'https://outside.invalid' },
    );
    expect(foreignGet.status).toBe(403);
    expect(foreignGet.body.code).toBe('ORIGIN_FORBIDDEN');

    const replayFixture = await directEmployee(
      `t09-replay-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const firstLoginAgent = new StaffAgent();
    firstLoginAgent.baseUrl = apiUrl;
    const loginToken = await firstLoginAgent.csrf();
    const oldChallenge = firstLoginAgent.cookies.get('stdu_login_dev')!;
    expect(
      (
        await firstLoginAgent.request(
          'POST',
          '/v1/staff/auth/login',
          { email: replayFixture.email, password: replayFixture.password },
          { csrf: loginToken },
        )
      ).status,
    ).toBe(200);
    const replayAgent = new StaffAgent();
    replayAgent.baseUrl = apiUrl;
    replayAgent.cookies.set('stdu_login_dev', oldChallenge);
    const replay = await replayAgent.request(
      'POST',
      '/v1/staff/auth/login',
      { email: replayFixture.email, password: replayFixture.password },
      { csrf: loginToken },
    );
    expect(replay.status).toBe(403);
    expect(replay.body.code).toBe('CSRF_INVALID');
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: replayFixture.id },
      }),
    ).toBe(1);

    const request = {
      requestId: randomUUID(),
      socket: { remoteAddress: `rate-test-${randomUUID()}` },
    } as unknown as StaffRequest;
    const limits = app.get(RateLimitService);
    for (let index = 0; index < 60; index++)
      await limits.preauthChallenge(request);
    await expect(limits.preauthChallenge(request)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfter: expect.any(Number),
    });
    const loginRequest = {
      requestId: randomUUID(),
      socket: { remoteAddress: `login-rate-${randomUUID()}` },
    } as unknown as StaffRequest;
    let reservation: LoginReservation;
    for (let index = 0; index < 5; index++) {
      reservation = await limits.beginLogin(
        loginRequest,
        'unknown-rate@stdu.test',
      );
      await limits.finishLogin(reservation, 'failure');
    }
    await expect(
      limits.beginLogin(loginRequest, 'unknown-rate@stdu.test'),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfter: expect.any(Number),
    });

    const accountEmail = `account-limit-${randomUUID().slice(0, 8)}@stdu.test`;
    for (let index = 0; index < 10; index++) {
      const accountRequest = {
        requestId: randomUUID(),
        socket: { remoteAddress: `account-source-${index}-${randomUUID()}` },
      } as unknown as StaffRequest;
      const attempt = await limits.beginLogin(accountRequest, accountEmail);
      await limits.finishLogin(attempt, 'failure');
    }
    await expect(
      limits.beginLogin(
        {
          requestId: randomUUID(),
          socket: { remoteAddress: `account-source-last-${randomUUID()}` },
        } as unknown as StaffRequest,
        accountEmail,
      ),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfter: expect.any(Number),
    });

    const sourceRequest = {
      requestId: randomUUID(),
      socket: { remoteAddress: `source-limit-${randomUUID()}` },
    } as unknown as StaffRequest;
    for (let index = 0; index < 60; index++) {
      const attempt = await limits.beginLogin(
        sourceRequest,
        `source-${index}-${randomUUID()}@stdu.test`,
      );
      await limits.finishLogin(attempt, 'neutral');
    }
    await expect(
      limits.beginLogin(sourceRequest, `source-last-${randomUUID()}@stdu.test`),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfter: expect.any(Number),
    });

    const rateConfig = {
      ...readConfig(process.env),
      trustedProxyAddress: '10.0.0.2',
    };
    expect(
      resolveRateLimitSourceAddress(
        {
          socket: { remoteAddress: '10.0.0.2' },
          headers: { 'x-forwarded-for': '198.51.100.40' },
        } as unknown as StaffRequest,
        rateConfig,
      ),
    ).toBe('198.51.100.40');
    expect(
      resolveRateLimitSourceAddress(
        {
          socket: { remoteAddress: '203.0.113.15' },
          headers: { 'x-forwarded-for': '198.51.100.40' },
        } as unknown as StaffRequest,
        rateConfig,
      ),
    ).toBe('203.0.113.15');
    expect(
      resolveRateLimitSourceAddress(
        {
          socket: { remoteAddress: '10.0.0.2' },
          headers: { 'x-forwarded-for': '198.51.100.40, 10.0.0.2' },
        } as unknown as StaffRequest,
        rateConfig,
      ),
    ).toBe('10.0.0.2');

    const passwordLimitRequest = {
      requestId: randomUUID(),
      socket: { remoteAddress: `password-limit-${randomUUID()}` },
    } as unknown as StaffRequest;
    const passwordLimitUser = randomUUID();
    for (let index = 0; index < 10; index++) {
      const reservation = await limits.passwordChange(
        passwordLimitRequest,
        passwordLimitUser,
      );
      await limits.finishPasswordChange(reservation, 'neutral');
    }
    await expect(
      limits.passwordChange(passwordLimitRequest, passwordLimitUser),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfter: expect.any(Number),
    });
    const failureLimitUser = randomUUID();
    for (let index = 0; index < 5; index++) {
      const failureReservation = await limits.passwordChange(
        passwordLimitRequest,
        failureLimitUser,
      );
      await limits.finishPasswordChange(failureReservation, 'failure');
    }
    await expect(
      limits.passwordChange(
        {
          requestId: randomUUID(),
          socket: { remoteAddress: `password-failure-${randomUUID()}` },
        } as unknown as StaffRequest,
        failureLimitUser,
      ),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfter: expect.any(Number),
    });

    const concurrentFailureUser = randomUUID();
    const concurrentFailureRequest = {
      requestId: randomUUID(),
      socket: { remoteAddress: `password-parallel-${randomUUID()}` },
    } as unknown as StaffRequest;
    const concurrentReservations = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        limits.passwordChange(concurrentFailureRequest, concurrentFailureUser),
      ),
    );
    const acceptedReservations = concurrentReservations.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    expect(acceptedReservations).toHaveLength(5);
    expect(
      concurrentReservations.filter((result) => result.status === 'rejected'),
    ).toHaveLength(3);
    const concurrentFailures = await Promise.all(
      acceptedReservations.map((reservation) =>
        limits.finishPasswordChange(reservation, 'failure'),
      ),
    );
    expect(concurrentFailures.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    await expect(
      limits.passwordChange(
        {
          requestId: randomUUID(),
          socket: { remoteAddress: `password-parallel-next-${randomUUID()}` },
        } as unknown as StaffRequest,
        concurrentFailureUser,
      ),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfter: expect.any(Number),
    });

    const failedLogin = new StaffAgent();
    failedLogin.baseUrl = apiUrl;
    let retry: ApiResult | undefined;
    const unknownEmail = `http-rate-${randomUUID().slice(0, 8)}@stdu.test`;
    for (let index = 0; index < 6; index++)
      retry = await failedLogin.login(
        unknownEmail,
        `R1-002B wrong secret ${randomBytes(5).toString('hex')}!`,
      );
    expect(retry?.status).toBe(429);
    expect(Number(retry?.headers.get('retry-after'))).toBeGreaterThan(0);

    const unavailableRedis = new Redis('redis://127.0.0.1:1', {
      connectTimeout: 100,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    unavailableRedis.on('error', () => undefined);
    const unavailable = new RateLimitService(unavailableRedis);
    try {
      await expect(
        unavailable.preauthChallenge({
          requestId: randomUUID(),
          socket: { remoteAddress: 'unavailable-test' },
        } as unknown as StaffRequest),
      ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    } finally {
      unavailableRedis.disconnect();
    }
    const safe = new StaffAgent();
    safe.baseUrl = apiUrl;
    expect((await safe.csrf()).length).toBe(43);
  });

  it('T-05/T-08: block revokes sessions, generic login errors match, and unblock never revives an old token', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const fixture = await directEmployee(
      `t05-block-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t05-seller-${randomUUID().slice(0, 8)}`,
          permissions: ['sellers.read'],
        },
      ],
    );
    const blockedAgent = new StaffAgent();
    blockedAgent.baseUrl = apiUrl;
    expect(
      (await blockedAgent.login(fixture.email, fixture.password)).status,
    ).toBe(200);
    const rawCookie = blockedAgent.cookies.get('stdu_staff_dev')!;
    const before = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: fixture.id },
    });
    const blocked = await rootAgent.write(
      'PATCH',
      `/v1/staff/users/${fixture.id}/status`,
      {
        state: 'BLOCKED',
        expectedVersion: before.version,
      },
    );
    expect(blocked.status).toBe(200);
    const afterBlock = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: fixture.id },
    });
    expect(afterBlock).toMatchObject({
      state: 'BLOCKED',
      authVersion: before.authVersion + 1,
      version: before.version + 1,
    });
    expect(afterBlock.blockedAt).toBeInstanceOf(Date);
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: fixture.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      (await blockedAgent.request('GET', '/v1/staff/auth/me')).status,
    ).toBe(401);

    const unknownAgent = new StaffAgent();
    unknownAgent.baseUrl = apiUrl;
    const unknown = await unknownAgent.login(
      `missing-${randomUUID().slice(0, 8)}@stdu.test`,
      `R1-002B unknown ${randomBytes(5).toString('hex')}!`,
    );
    const blockedLoginAgent = new StaffAgent();
    blockedLoginAgent.baseUrl = apiUrl;
    const blockedLogin = await blockedLoginAgent.login(
      fixture.email,
      fixture.password,
    );
    expect(blockedLogin.status).toBe(401);
    expect(blockedLogin.body).toMatchObject({
      code: unknown.body.code,
      message: unknown.body.message,
    });
    expect(unknown.status).toBe(401);
    expect(blockedLogin.body).not.toHaveProperty('fields');

    const currentVersion = await userVersion(fixture.id);
    expect(
      (
        await rootAgent.write('PATCH', `/v1/staff/users/${fixture.id}/status`, {
          state: 'ACTIVE',
          expectedVersion: currentVersion,
        })
      ).status,
    ).toBe(200);
    const staleAgent = new StaffAgent();
    staleAgent.baseUrl = apiUrl;
    staleAgent.cookies.set('stdu_staff_dev', rawCookie);
    expect((await staleAgent.request('GET', '/v1/staff/auth/me')).status).toBe(
      401,
    );
    const newAgent = new StaffAgent();
    newAgent.baseUrl = apiUrl;
    expect((await newAgent.login(fixture.email, fixture.password)).status).toBe(
      200,
    );
  });

  it('T-06: logout, admin session revocation, and role removal invalidate previously issued tokens', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const revokeFixture = await directEmployee(
      `t06-revoke-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t06-revoke-role-${randomUUID().slice(0, 8)}`,
          permissions: ['sellers.read'],
        },
      ],
    );
    const revokeAgent = new StaffAgent();
    revokeAgent.baseUrl = apiUrl;
    expect(
      (await revokeAgent.login(revokeFixture.email, revokeFixture.password))
        .status,
    ).toBe(200);
    const revoked = await rootAgent.write(
      'POST',
      `/v1/staff/users/${revokeFixture.id}/sessions/revoke`,
      {
        expectedVersion: await userVersion(revokeFixture.id),
      },
    );
    expect(revoked.status).toBe(200);
    expect((await revokeAgent.request('GET', '/v1/staff/auth/me')).status).toBe(
      401,
    );
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: revokeFixture.id, revokedAt: null },
      }),
    ).toBe(0);

    const roleFixture = await directEmployee(
      `t06-role-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t06-user-role-${randomUUID().slice(0, 8)}`,
          permissions: ['sellers.read'],
        },
      ],
    );
    const roleAgent = new StaffAgent();
    roleAgent.baseUrl = apiUrl;
    expect(
      (await roleAgent.login(roleFixture.email, roleFixture.password)).status,
    ).toBe(200);
    const roleRemoved = await rootAgent.write(
      'DELETE',
      `/v1/staff/users/${roleFixture.id}/roles/${roleFixture.roleIds[0]}?expectedVersion=1`,
    );
    expect(roleRemoved.status).toBe(200);
    expect((await roleAgent.request('GET', '/v1/staff/auth/me')).status).toBe(
      401,
    );
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: roleFixture.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('T-07: database session deadlines use strict boundaries, activity moves only idle time, and revoked rows stay revoked', async () => {
    const absoluteFixture = await directEmployee(
      `t07-absolute-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const absoluteAgent = new StaffAgent();
    absoluteAgent.baseUrl = apiUrl;
    expect(
      (
        await absoluteAgent.login(
          absoluteFixture.email,
          absoluteFixture.password,
        )
      ).status,
    ).toBe(200);
    const absoluteSession = await ownerDb.staffSession.findFirstOrThrow({
      where: { staffUserId: absoluteFixture.id, revokedAt: null },
    });
    const exactBoundary = new Date();
    await ownerDb.staffSession.update({
      where: { id: absoluteSession.id },
      data: {
        absoluteExpiresAt: exactBoundary,
        lastSeenAt: new Date(exactBoundary.getTime() - 1),
      },
    });
    const equality = await ownerPg.query(
      'SELECT ($1::timestamptz > $1::timestamptz) AS live',
      [exactBoundary],
    );
    expect(equality.rows[0]?.live).toBe(false);
    expect(
      (await absoluteAgent.request('GET', '/v1/staff/auth/me')).status,
    ).toBe(401);
    expect(
      (
        await ownerDb.staffSession.findUniqueOrThrow({
          where: { id: absoluteSession.id },
        })
      ).revocationReason,
    ).toBe('SESSION_ABSOLUTE_EXPIRED');

    const idleFixture = await directEmployee(
      `t07-idle-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const idleAgent = new StaffAgent();
    idleAgent.baseUrl = apiUrl;
    expect(
      (await idleAgent.login(idleFixture.email, idleFixture.password)).status,
    ).toBe(200);
    const idleSession = await ownerDb.staffSession.findFirstOrThrow({
      where: { staffUserId: idleFixture.id, revokedAt: null },
    });
    const idleCreated = new Date(Date.now() - 32 * 60_000);
    await ownerDb.staffSession.update({
      where: { id: idleSession.id },
      data: {
        createdAt: idleCreated,
        lastSeenAt: new Date(idleCreated.getTime() + 60_000),
      },
    });
    expect((await idleAgent.request('GET', '/v1/staff/auth/me')).status).toBe(
      401,
    );
    expect(
      (
        await ownerDb.staffSession.findUniqueOrThrow({
          where: { id: idleSession.id },
        })
      ).revocationReason,
    ).toBe('SESSION_IDLE_EXPIRED');

    const activeFixture = await directEmployee(
      `t07-active-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const activeAgent = new StaffAgent();
    activeAgent.baseUrl = apiUrl;
    expect(
      (await activeAgent.login(activeFixture.email, activeFixture.password))
        .status,
    ).toBe(200);
    const activeSession = await ownerDb.staffSession.findFirstOrThrow({
      where: { staffUserId: activeFixture.id, revokedAt: null },
    });
    const originalAbsolute = activeSession.absoluteExpiresAt;
    const activeCreated = new Date(Date.now() - 10 * 60_000);
    const oldActivity = new Date(Date.now() - 5 * 60_000);
    await ownerDb.staffSession.update({
      where: { id: activeSession.id },
      data: { createdAt: activeCreated, lastSeenAt: oldActivity },
    });
    expect((await activeAgent.request('GET', '/v1/staff/auth/me')).status).toBe(
      200,
    );
    const refreshed = await ownerDb.staffSession.findUniqueOrThrow({
      where: { id: activeSession.id },
    });
    expect(refreshed.absoluteExpiresAt).toEqual(originalAbsolute);
    expect(refreshed.lastSeenAt.getTime()).toBeGreaterThan(
      oldActivity.getTime(),
    );

    const revokedAt = new Date();
    await ownerDb.staffSession.update({
      where: { id: activeSession.id },
      data: {
        revokedAt,
        revocationReason: 'LOGOUT',
        absoluteExpiresAt: new Date(Date.now() + 60 * 60_000),
        lastSeenAt: new Date(),
      },
    });
    expect((await activeAgent.request('GET', '/v1/staff/auth/me')).status).toBe(
      401,
    );
    expect(
      (
        await ownerDb.staffSession.findUniqueOrThrow({
          where: { id: activeSession.id },
        })
      ).revokedAt,
    ).toEqual(revokedAt);
  });

  it('T-12/T-35/T-36: access-admin cannot remove the final full-admin permission or block the sole full-admin', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    accessRoleId = await createRole(
      rootAgent,
      `access-admin-${randomUUID().slice(0, 8)}`,
      controlPermissions,
    );
    const access = await createStaffUser(
      rootAgent,
      `access-${randomUUID().slice(0, 8)}@stdu.test`,
      accessPassword,
    );
    accessUserId = access.id;
    expect((await assignRole(rootAgent, access.id, accessRoleId)).status).toBe(
      200,
    );
    const accessRecord = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: access.id },
      select: { email: true },
    });
    accessAgent = new StaffAgent();
    accessAgent.baseUrl = apiUrl;
    expect(
      (await accessAgent.login(accessRecord.email, accessPassword)).status,
    ).toBe(200);
    expect(
      (
        await accessAgent.write('PUT', '/v1/staff/auth/me/password', {
          currentPassword: accessPassword,
          newPassword: accessChangedPassword,
        })
      ).status,
    ).toBe(200);
    const successfulRolePermissionChangesBefore =
      await ownerDb.auditEvent.count({
        where: { action: 'staff.role.permissions.changed', outcome: 'SUCCESS' },
      });
    const protectedRolePermissionsBefore = await ownerDb.rolePermission.count({
      where: { roleId: rootRoleId },
    });
    const rootSessionsBefore = await ownerDb.staffSession.count({
      where: { staffUserId: rootUserId, revokedAt: null },
    });
    for (const permission of allPermissions) {
      const removeCritical = await accessAgent.write(
        'PUT',
        `/v1/staff/roles/${rootRoleId}/permissions`,
        {
          permissions: allPermissions.filter(
            (candidate) => candidate !== permission,
          ),
          expectedVersion: 1,
        },
      );
      expect(
        removeCritical.status,
        `Removing sole ${permission} must preserve full-admin readiness`,
      ).toBe(409);
      expect(removeCritical.body.code).toBe('LAST_ADMIN_REQUIRED');
    }
    const before = await userVersion(rootUserId);
    const block = await accessAgent.write(
      'PATCH',
      `/v1/staff/users/${rootUserId}/status`,
      { state: 'BLOCKED', expectedVersion: before },
    );
    expect(block.status).toBe(409);
    expect(block.body.code).toBe('LAST_ADMIN_REQUIRED');
    const unassign = await accessAgent.write(
      'DELETE',
      `/v1/staff/users/${rootUserId}/roles/${rootRoleId}?expectedVersion=${before}`,
    );
    expect(unassign.status).toBe(409);
    expect(unassign.body.code).toBe('LAST_ADMIN_REQUIRED');
    const archive = await accessAgent.write(
      'PATCH',
      `/v1/staff/roles/${rootRoleId}`,
      { state: 'ARCHIVED', expectedVersion: 1 },
    );
    expect(archive.status).toBe(409);
    expect(archive.body.code).toBe('ROLE_IN_USE');
    expect(
      (await ownerDb.staffUser.findUniqueOrThrow({ where: { id: rootUserId } }))
        .state,
    ).toBe('ACTIVE');
    expect(
      await ownerDb.rolePermission.count({ where: { roleId: rootRoleId } }),
    ).toBe(protectedRolePermissionsBefore);
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: rootUserId, revokedAt: null },
      }),
    ).toBe(rootSessionsBefore);
    const successfulRolePermissionChanges = await ownerDb.auditEvent.count({
      where: { action: 'staff.role.permissions.changed', outcome: 'SUCCESS' },
    });
    expect(successfulRolePermissionChanges).toBe(
      successfulRolePermissionChangesBefore,
    );
    expect(
      await ownerDb.auditEvent.count({
        where: { reasonCode: 'LAST_ADMIN_REQUIRED', outcome: 'DENIED' },
      }),
    ).toBeGreaterThanOrEqual(2);
    expect(
      (
        await accessAgent.write(
          'PATCH',
          `/v1/staff/users/${accessUserId}/status`,
          {
            state: 'BLOCKED',
            expectedVersion: await userVersion(accessUserId),
          },
        )
      ).body.code,
    ).toBe('SELF_PRIVILEGE_CHANGE_FORBIDDEN');
  });

  it('T-18/T-21/T-29/T-30: seller state, audit privacy, file version/link integrity, SQL constraints and append-only history hold', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const created = await rootAgent.write('POST', '/v1/staff/sellers', {
      displayName: 'Runtime seller draft',
      kind: 'OOO',
    });
    expect(created.status).toBe(201);
    sellerId = created.body.data.id!;
    const seller = await ownerDb.sellerLegalEntity.findUniqueOrThrow({
      where: { id: sellerId },
    });
    const activeWithoutRequisites = await rootAgent.write(
      'PATCH',
      `/v1/staff/sellers/${sellerId}`,
      { state: 'ACTIVE', expectedVersion: seller.version },
    );
    expect(activeWithoutRequisites.status).toBe(400);
    expect(
      (
        await ownerDb.sellerLegalEntity.findUniqueOrThrow({
          where: { id: sellerId },
        })
      ).state,
    ).toBe('DRAFT');
    const activatedOoo = await rootAgent.write(
      'PATCH',
      `/v1/staff/sellers/${sellerId}`,
      {
        legalName: 'OOO Runtime Legal Name',
        inn: '1234567890',
        kpp: '123456789',
        ogrn: '1234567890123',
        state: 'ACTIVE',
        expectedVersion: seller.version,
      },
    );
    expect(activatedOoo.status).toBe(200);
    const ipDraft = await rootAgent.write('POST', '/v1/staff/sellers', {
      displayName: 'IP Runtime Draft',
      kind: 'IP',
    });
    expect(ipDraft.status).toBe(201);
    const activatedIp = await rootAgent.write(
      'PATCH',
      `/v1/staff/sellers/${ipDraft.body.data.id}`,
      {
        legalName: 'IP Runtime Legal Name',
        inn: '123456789012',
        ogrn: '123456789012345',
        state: 'ACTIVE',
        expectedVersion: 1,
      },
    );
    expect(activatedIp.status).toBe(200);
    const invalidIpKpp = await rootAgent.write('POST', '/v1/staff/sellers', {
      displayName: 'Invalid IP KPP',
      kind: 'IP',
      kpp: '123456789',
    });
    expect(invalidIpKpp.status).toBe(400);
    const invalidOooInn = await rootAgent.write('POST', '/v1/staff/sellers', {
      displayName: 'Invalid OOO INN',
      kind: 'OOO',
      inn: '123456789012',
    });
    expect(invalidOooInn.status).toBe(400);
    const audit = await rootAgent.request('GET', '/v1/staff/audit?limit=20');
    expect(audit.status).toBe(200);
    expect(JSON.stringify(audit.body)).not.toMatch(
      /passwordHash|initialPassword|sessionCookie|tokenHash|rateLimitKey/i,
    );
    expect(audit.body.meta.requestId).toBe(audit.headers.get('x-request-id'));

    const objectId = randomUUID();
    const versionId = randomUUID();
    await ownerDb.fileObject.create({
      data: {
        id: objectId,
        ownerStaffUserId: rootUserId,
        displayName: 'private.txt',
        visibility: 'PRIVATE',
        state: 'ACTIVE',
      },
    });
    await ownerDb.fileVersion.create({
      data: {
        id: versionId,
        fileObjectId: objectId,
        number: 1,
        storageKey: randomBytes(32).toString('hex'),
        sha256: new Uint8Array(32),
        sizeBytes: 0n,
        mimeType: 'text/plain',
        originalFilename: 'private.txt',
        safetyState: 'UNCHECKED',
        createdByUserId: rootUserId,
      },
    });
    const otherObjectId = randomUUID();
    const otherVersionId = randomUUID();
    await ownerDb.fileObject.create({
      data: {
        id: otherObjectId,
        ownerStaffUserId: rootUserId,
        displayName: 'other-file.txt',
        visibility: 'INTERNAL',
        state: 'ACTIVE',
      },
    });
    await ownerDb.fileVersion.create({
      data: {
        id: otherVersionId,
        fileObjectId: otherObjectId,
        number: 1,
        storageKey: randomBytes(32).toString('hex'),
        sha256: new Uint8Array(32),
        sizeBytes: 1n,
        mimeType: 'text/plain',
        originalFilename: 'other-file.txt',
        safetyState: 'UNCHECKED',
        createdByUserId: rootUserId,
      },
    });
    const metadata = await rootAgent.request(
      'GET',
      `/v1/staff/files/${objectId}/metadata`,
    );
    expect(metadata.status).toBe(200);
    expect(JSON.stringify(metadata.body)).not.toContain('storageKey');
    expect(JSON.stringify(metadata.body)).not.toContain(
      randomBytes(8).toString('hex'),
    );
    expect(
      (await accessAgent.request('GET', `/v1/staff/files/${objectId}/metadata`))
        .status,
    ).toBe(403);
    const hidden = await rootAgent.request(
      'GET',
      `/v1/staff/files/${randomUUID()}/metadata`,
    );
    expect(hidden.status).toBe(404);
    expect(await ownerDb.fileVersion.count({ where: { id: versionId } })).toBe(
      1,
    );

    await expect(
      ownerPg.query(
        'UPDATE audit_event SET action=action WHERE id=(SELECT id FROM audit_event LIMIT 1)',
      ),
    ).rejects.toBeTruthy();
    await expect(
      ownerPg.query('DELETE FROM file_version WHERE id=$1', [versionId]),
    ).rejects.toBeTruthy();
    const runtime = new Client({
      connectionString: requireUrl('STAFF_DATABASE_URL'),
    });
    await runtime.connect();
    await expect(
      runtime.query(
        'UPDATE audit_event SET action=action WHERE id=(SELECT id FROM audit_event LIMIT 1)',
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query('TRUNCATE file_version')).rejects.toMatchObject({
      code: '42501',
    });
    await runtime.end();

    await expect(
      ownerPg.query(
        "INSERT INTO seller_legal_entity(id,display_name,kind,inn,state) VALUES($1,'bad','OOO','123','DRAFT')",
        [randomUUID()],
      ),
    ).rejects.toBeTruthy();
    await expect(
      ownerPg.query(
        "INSERT INTO file_version(id,file_object_id,number,storage_key,sha256,size_bytes,mime_type,original_filename,safety_state,created_by_user_id) VALUES($1,$2,2,$3,$4,-1,'text/plain','bad.txt','UNCHECKED',$5)",
        [
          randomUUID(),
          objectId,
          randomBytes(32).toString('hex'),
          new Uint8Array(32),
          rootUserId,
        ],
      ),
    ).rejects.toBeTruthy();
    await expect(
      ownerPg.query(
        "INSERT INTO staff_user(id,email,email_normalized,display_name,password_hash,state) VALUES($1,'bad@stdu.test','different@stdu.test','Bad','$argon2id$bad','ACTIVE')",
        [randomUUID()],
      ),
    ).rejects.toBeTruthy();
    await expect(
      ownerPg.query("UPDATE file_object SET visibility='PUBLIC' WHERE id=$1", [
        otherObjectId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const rootCredential = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: rootUserId },
      select: { passwordHash: true },
    });
    await expect(
      ownerPg.query(
        "INSERT INTO staff_user(id,email,email_normalized,display_name,password_hash,state) VALUES($1,$2,$3,$4,$5,'ACTIVE')",
        [
          randomUUID(),
          rootEmail.toUpperCase(),
          rootEmail,
          'Duplicate normalized email',
          rootCredential.passwordHash,
        ],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      ownerPg.query(
        "INSERT INTO staff_session(id,staff_user_id,token_hash,auth_version,absolute_expires_at,last_seen_at) VALUES($1,$2,$3,1,clock_timestamp()+interval '1 hour',clock_timestamp())",
        [randomUUID(), rootUserId, randomBytes(31)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      ownerPg.query(
        "INSERT INTO staff_session(id,staff_user_id,token_hash,auth_version,absolute_expires_at,last_seen_at,created_at) VALUES($1,$2,$3,1,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 second',clock_timestamp())",
        [randomUUID(), rootUserId, randomBytes(32)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      ownerPg.query(
        `INSERT INTO file_link(id,file_object_id,file_version_id,seller_legal_entity_id,visibility,created_by_user_id)
      VALUES($1,$2,$3,$4,'INTERNAL',$5)`,
        [randomUUID(), objectId, otherVersionId, sellerId, rootUserId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    const tables = await ownerPg.query(
      "SELECT to_regclass('public.staff_user') AS user_table, to_regclass('public.file_link') AS link_table",
    );
    expect(tables.rows[0]).toEqual({
      user_table: 'staff_user',
      link_table: 'file_link',
    });
  });

  it('T-23: recovery rejects unsafe state and preserves both invariants in the explicit last-admin branch', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const recoveryPassword = 'R1-002B explicit owner recovery password 05!';
    const notFoundDenialsBefore = await ownerDb.auditEvent.count({
      where: {
        action: 'staff.access.recovered',
        outcome: 'DENIED',
        reasonCode: 'NOT_FOUND',
      },
    });
    await expect(
      import('../src/cli/staff-access.js').then(({ recoverStaffAccess }) =>
        recoverStaffAccess(ownerDb, {
          userId: randomUUID(),
          operatorLabel: 'R1 test operator',
          reason: 'OWNER_CONFIRMED',
          password: 'R1-002B valid nonexistent recovery password 05!',
          lastAdminOwner: false,
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await ownerDb.auditEvent.count({
        where: {
          action: 'staff.access.recovered',
          outcome: 'DENIED',
          reasonCode: 'NOT_FOUND',
        },
      }),
    ).toBe(notFoundDenialsBefore + 1);
    const beforeRejectedRecovery = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: rootUserId },
    });
    await expect(
      import('../src/cli/staff-access.js').then(({ recoverStaffAccess }) =>
        recoverStaffAccess(ownerDb, {
          userId: rootUserId,
          operatorLabel: 'R1 test operator',
          reason: 'OWNER_CONFIRMED',
          password: rootEmail,
          lastAdminOwner: true,
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      import('../src/cli/staff-access.js').then(({ recoverStaffAccess }) =>
        recoverStaffAccess(ownerDb, {
          userId: rootUserId,
          operatorLabel: 'R1 test operator',
          reason: 'OWNER_CONFIRMED',
          password: 'R1-002B normal recovery must be denied 05!',
          lastAdminOwner: false,
        }),
      ),
    ).rejects.toMatchObject({ code: 'LAST_ADMIN_REQUIRED' });
    expect(
      await ownerDb.staffUser.findUniqueOrThrow({ where: { id: rootUserId } }),
    ).toMatchObject({
      passwordHash: beforeRejectedRecovery.passwordHash,
      authVersion: beforeRejectedRecovery.authVersion,
      version: beforeRejectedRecovery.version,
    });
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: rootUserId, revokedAt: null },
      }),
    ).toBeGreaterThan(0);
    const recovered = await import('../src/cli/staff-access.js').then(
      ({ recoverStaffAccess }) =>
        recoverStaffAccess(ownerDb, {
          userId: rootUserId,
          operatorLabel: 'R1 test operator',
          reason: 'OWNER_CONFIRMED',
          password: recoveryPassword,
          lastAdminOwner: true,
        }),
    );
    expect(recovered.passwordChangeRequired).toBe(false);
    await expectFullAdminCount(1);
    const events = await ownerDb.auditEvent.findMany({
      where: { action: 'staff.access.recovered', outcome: 'SUCCESS' },
      orderBy: { occurredAt: 'desc' },
      take: 1,
    });
    expect(events[0]?.changes).toMatchObject({
      recoveryMode: 'LAST_ADMIN_OWNER',
      passwordChangeRequired: false,
    });
    expect((await rootAgent.request('GET', '/v1/staff/auth/me')).status).toBe(
      401,
    );
    const recoveredAgent = new StaffAgent();
    recoveredAgent.baseUrl = apiUrl;
    expect(
      (await recoveredAgent.login(rootEmail, recoveryPassword)).status,
    ).toBe(200);
    const repeatRecovery = await import('../src/cli/staff-access.js').then(
      ({ recoverStaffAccess }) =>
        recoverStaffAccess(ownerDb, {
          userId: rootUserId,
          operatorLabel: 'R1 test operator',
          reason: 'OWNER_CONFIRMED',
          password: 'R1-002B recovery second password 06!',
          lastAdminOwner: true,
        }),
    );
    expect(repeatRecovery).toBeTruthy();
    await expectFullAdminCount(1);
    rootPassword = 'R1-002B recovery second password 06!';
    rootAgent = recoveredAgent;
  });

  it('T-24/T-40: success or denial audit failure returns 503 and rolls back business/session state', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const before = await ownerDb.sellerLegalEntity.count();
    await ownerPg.query(
      `CREATE FUNCTION fail_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='seller.created' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await ownerPg.query(
      'CREATE TRIGGER fail_test_audit_before_insert BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION fail_test_audit()',
    );
    try {
      const response = await rootAgent.write('POST', '/v1/staff/sellers', {
        displayName: 'Must rollback seller',
        kind: 'OOO',
      });
      expect(response.status).toBe(503);
      expect(await ownerDb.sellerLegalEntity.count()).toBe(before);
    } finally {
      await ownerPg.query(
        'DROP TRIGGER fail_test_audit_before_insert ON audit_event',
      );
      await ownerPg.query('DROP FUNCTION fail_test_audit()');
    }

    await ownerPg.query(
      `CREATE FUNCTION fail_test_denial_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.outcome='DENIED' AND NEW.reason_code='SELF_PRIVILEGE_CHANGE_FORBIDDEN' THEN RAISE EXCEPTION 'test denial audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await ownerPg.query(
      'CREATE TRIGGER fail_test_denial_audit_before_insert BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION fail_test_denial_audit()',
    );
    try {
      const beforeVersion = await userVersion(accessUserId);
      const response = await accessAgent.write(
        'PATCH',
        `/v1/staff/users/${accessUserId}/status`,
        { state: 'BLOCKED', expectedVersion: beforeVersion },
      );
      expect(response.status).toBe(503);
      const after = await ownerDb.staffUser.findUniqueOrThrow({
        where: { id: accessUserId },
      });
      expect(after.state).toBe('ACTIVE');
      expect(after.version).toBe(beforeVersion);
    } finally {
      await ownerPg.query(
        'DROP TRIGGER fail_test_denial_audit_before_insert ON audit_event',
      );
      await ownerPg.query('DROP FUNCTION fail_test_denial_audit()');
    }
    expect((await accessAgent.request('GET', '/v1/staff/auth/me')).status).toBe(
      200,
    );

    const failedLoginEmail = `audit-fail-login-${randomUUID().slice(0, 8)}@stdu.test`;
    const deniedLoginAuditBefore = await ownerDb.auditEvent.count({
      where: { action: 'auth.login', outcome: 'DENIED' },
    });
    await ownerPg.query(
      `CREATE FUNCTION fail_test_login_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='auth.login' AND NEW.outcome='DENIED' THEN RAISE EXCEPTION 'test login audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await ownerPg.query(
      'CREATE TRIGGER fail_test_login_audit_before_insert BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION fail_test_login_audit()',
    );
    try {
      const unauthenticated = new StaffAgent();
      unauthenticated.baseUrl = apiUrl;
      const response = await unauthenticated.login(
        failedLoginEmail,
        `R1-002B failed audit password ${randomBytes(5).toString('hex')}!`,
      );
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('AUDIT_UNAVAILABLE');
      expect(
        await ownerDb.staffUser.count({
          where: { emailNormalized: failedLoginEmail },
        }),
      ).toBe(0);
      expect(
        await ownerDb.auditEvent.count({
          where: { action: 'auth.login', outcome: 'DENIED' },
        }),
      ).toBe(deniedLoginAuditBefore);
    } finally {
      await ownerPg.query(
        'DROP TRIGGER fail_test_login_audit_before_insert ON audit_event',
      );
      await ownerPg.query('DROP FUNCTION fail_test_login_audit()');
    }

    const roleBeforeDeniedAuditFailure = await ownerDb.role.findUniqueOrThrow({
      where: { id: rootRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    const deniedUserBefore = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: rootUserId },
    });
    const deniedSessionsBefore = await ownerDb.staffSession.findMany({
      where: { staffUserId: rootUserId },
      orderBy: { id: 'asc' },
    });
    const lastAdminDeniedBefore = await ownerDb.auditEvent.count({
      where: { reasonCode: 'LAST_ADMIN_REQUIRED', outcome: 'DENIED' },
    });
    const rolePermissionSuccessBefore = await ownerDb.auditEvent.count({
      where: { action: 'staff.role.permissions.changed', outcome: 'SUCCESS' },
    });
    await ownerPg.query(
      `CREATE FUNCTION fail_test_last_admin_denial() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.outcome='DENIED' AND NEW.reason_code='LAST_ADMIN_REQUIRED' THEN RAISE EXCEPTION 'test final-admin denial audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await ownerPg.query(
      'CREATE TRIGGER fail_test_last_admin_denial_before_insert BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION fail_test_last_admin_denial()',
    );
    try {
      const response = await accessAgent.write(
        'PUT',
        `/v1/staff/roles/${rootRoleId}/permissions`,
        {
          permissions: allPermissions.filter(
            (permission) => permission !== 'audit.read',
          ),
          expectedVersion: roleBeforeDeniedAuditFailure.version,
        },
      );
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('AUDIT_UNAVAILABLE');
    } finally {
      await ownerPg.query(
        'DROP TRIGGER fail_test_last_admin_denial_before_insert ON audit_event',
      );
      await ownerPg.query('DROP FUNCTION fail_test_last_admin_denial()');
    }
    const roleAfterDeniedAuditFailure = await ownerDb.role.findUniqueOrThrow({
      where: { id: rootRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    const deniedUserAfter = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: rootUserId },
    });
    const deniedSessionsAfter = await ownerDb.staffSession.findMany({
      where: { staffUserId: rootUserId },
      orderBy: { id: 'asc' },
    });
    expect(roleAfterDeniedAuditFailure.version).toBe(
      roleBeforeDeniedAuditFailure.version,
    );
    expect(
      roleAfterDeniedAuditFailure.permissions
        .map(({ permission }) => permission.code)
        .sort(),
    ).toEqual(
      roleBeforeDeniedAuditFailure.permissions
        .map(({ permission }) => permission.code)
        .sort(),
    );
    expect(deniedUserAfter).toMatchObject({
      version: deniedUserBefore.version,
      authVersion: deniedUserBefore.authVersion,
      passwordHash: deniedUserBefore.passwordHash,
    });
    expect(
      deniedSessionsAfter.map(({ id, revokedAt, revocationReason }) => ({
        id,
        revokedAt,
        revocationReason,
      })),
    ).toEqual(
      deniedSessionsBefore.map(({ id, revokedAt, revocationReason }) => ({
        id,
        revokedAt,
        revocationReason,
      })),
    );
    expect(
      await ownerDb.auditEvent.count({
        where: { reasonCode: 'LAST_ADMIN_REQUIRED', outcome: 'DENIED' },
      }),
    ).toBe(lastAdminDeniedBefore);
    expect(
      await ownerDb.auditEvent.count({
        where: { action: 'staff.role.permissions.changed', outcome: 'SUCCESS' },
      }),
    ).toBe(rolePermissionSuccessBefore);

    const safeTarget = await directEmployee(
      `t40-safe-target-${randomUUID().slice(0, 8)}@stdu.test`,
    );
    const safeRoleId = await createRole(
      rootAgent,
      `t40-safe-role-${randomUUID().slice(0, 8)}`,
      ['sellers.read'],
    );
    expect(
      (await assignRole(rootAgent, safeTarget.id, safeRoleId, 1)).status,
    ).toBe(200);
    const safeTargetAgent = new StaffAgent();
    safeTargetAgent.baseUrl = apiUrl;
    expect(
      (await safeTargetAgent.login(safeTarget.email, safeTarget.password))
        .status,
    ).toBe(200);
    const safeRoleBefore = await ownerDb.role.findUniqueOrThrow({
      where: { id: safeRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    const safeUserBefore = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: safeTarget.id },
    });
    const safeSessionBefore = await ownerDb.staffSession.findFirstOrThrow({
      where: { staffUserId: safeTarget.id, revokedAt: null },
    });
    const safeSuccessBefore = await ownerDb.auditEvent.count({
      where: { action: 'staff.role.permissions.changed', outcome: 'SUCCESS' },
    });
    await ownerPg.query(
      `CREATE FUNCTION fail_test_success_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='staff.role.permissions.changed' AND NEW.outcome='SUCCESS' THEN RAISE EXCEPTION 'test safe-mutation audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await ownerPg.query(
      'CREATE TRIGGER fail_test_success_audit_before_insert BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION fail_test_success_audit()',
    );
    try {
      const response = await rootAgent.write(
        'PUT',
        `/v1/staff/roles/${safeRoleId}/permissions`,
        {
          permissions: ['sellers.read', 'audit.read'],
          expectedVersion: safeRoleBefore.version,
        },
      );
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('AUDIT_UNAVAILABLE');
    } finally {
      await ownerPg.query(
        'DROP TRIGGER fail_test_success_audit_before_insert ON audit_event',
      );
      await ownerPg.query('DROP FUNCTION fail_test_success_audit()');
    }
    const safeRoleAfter = await ownerDb.role.findUniqueOrThrow({
      where: { id: safeRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    const safeUserAfter = await ownerDb.staffUser.findUniqueOrThrow({
      where: { id: safeTarget.id },
    });
    const safeSessionAfter = await ownerDb.staffSession.findUniqueOrThrow({
      where: { id: safeSessionBefore.id },
    });
    expect(safeRoleAfter.version).toBe(safeRoleBefore.version);
    expect(
      safeRoleAfter.permissions.map(({ permission }) => permission.code).sort(),
    ).toEqual(
      safeRoleBefore.permissions
        .map(({ permission }) => permission.code)
        .sort(),
    );
    expect(safeUserAfter).toMatchObject({
      version: safeUserBefore.version,
      authVersion: safeUserBefore.authVersion,
    });
    expect(safeSessionAfter).toMatchObject({
      revokedAt: null,
      revocationReason: null,
    });
    expect(
      await ownerDb.auditEvent.count({
        where: { action: 'staff.role.permissions.changed', outcome: 'SUCCESS' },
      }),
    ).toBe(safeSuccessBefore);
    expect(
      (await safeTargetAgent.request('GET', '/v1/staff/auth/me')).status,
    ).toBe(200);
  });

  it('T-19: file metadata default-deny applies permission before object lookup and hides foreign/private objects', async () => {
    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const foreignId = randomUUID();
    await ownerDb.fileObject.create({
      data: {
        id: foreignId,
        ownerStaffUserId: accessUserId,
        displayName: 'foreign-private.txt',
        visibility: 'PRIVATE',
        state: 'ACTIVE',
      },
    });
    expect(
      (await rootAgent.request('GET', `/v1/staff/files/${foreignId}/metadata`))
        .status,
    ).toBe(404);
    expect(
      (
        await rootAgent.request(
          'GET',
          `/v1/staff/files/${randomUUID()}/metadata`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await accessAgent.request(
          'GET',
          `/v1/staff/files/${foreignId}/metadata`,
        )
      ).status,
    ).toBe(403);

    const sellerReader = await directEmployee(
      `t19-seller-reader-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t19-file-seller-read-${randomUUID().slice(0, 8)}`,
          permissions: ['files.metadata.read', 'sellers.read'],
        },
      ],
    );
    const sellerReaderAgent = new StaffAgent();
    sellerReaderAgent.baseUrl = apiUrl;
    expect(
      (await sellerReaderAgent.login(sellerReader.email, sellerReader.password))
        .status,
    ).toBe(200);
    const linkedObjectId = randomUUID();
    const linkedVersionId = randomUUID();
    await ownerDb.fileObject.create({
      data: {
        id: linkedObjectId,
        ownerStaffUserId: rootUserId,
        displayName: 'linked-internal.txt',
        visibility: 'INTERNAL',
        state: 'ACTIVE',
      },
    });
    await ownerDb.fileVersion.create({
      data: {
        id: linkedVersionId,
        fileObjectId: linkedObjectId,
        number: 1,
        storageKey: randomBytes(32).toString('hex'),
        sha256: new Uint8Array(32),
        sizeBytes: 8n,
        mimeType: 'text/plain',
        originalFilename: 'linked-internal.txt',
        safetyState: 'UNCHECKED',
        createdByUserId: rootUserId,
      },
    });
    await ownerDb.fileLink.create({
      data: {
        id: randomUUID(),
        fileObjectId: linkedObjectId,
        fileVersionId: linkedVersionId,
        sellerLegalEntityId: sellerId,
        visibility: 'INTERNAL',
        createdByUserId: rootUserId,
      },
    });
    expect(
      (
        await sellerReaderAgent.request(
          'GET',
          `/v1/staff/files/${linkedObjectId}/metadata`,
        )
      ).status,
    ).toBe(200);

    const privateLinkObjectId = randomUUID();
    const privateLinkVersionId = randomUUID();
    await ownerDb.fileObject.create({
      data: {
        id: privateLinkObjectId,
        ownerStaffUserId: rootUserId,
        displayName: 'private-link.txt',
        visibility: 'INTERNAL',
        state: 'ACTIVE',
      },
    });
    await ownerDb.fileVersion.create({
      data: {
        id: privateLinkVersionId,
        fileObjectId: privateLinkObjectId,
        number: 1,
        storageKey: randomBytes(32).toString('hex'),
        sha256: new Uint8Array(32),
        sizeBytes: 8n,
        mimeType: 'text/plain',
        originalFilename: 'private-link.txt',
        safetyState: 'UNCHECKED',
        createdByUserId: rootUserId,
      },
    });
    await ownerDb.fileLink.create({
      data: {
        id: randomUUID(),
        fileObjectId: privateLinkObjectId,
        fileVersionId: privateLinkVersionId,
        sellerLegalEntityId: sellerId,
        visibility: 'PRIVATE',
        createdByUserId: rootUserId,
      },
    });
    expect(
      (
        await sellerReaderAgent.request(
          'GET',
          `/v1/staff/files/${privateLinkObjectId}/metadata`,
        )
      ).status,
    ).toBe(404);
    const fileOnly = await directEmployee(
      `t19-file-only-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t19-file-only-role-${randomUUID().slice(0, 8)}`,
          permissions: ['files.metadata.read'],
        },
      ],
    );
    const fileOnlyAgent = new StaffAgent();
    fileOnlyAgent.baseUrl = apiUrl;
    expect(
      (await fileOnlyAgent.login(fileOnly.email, fileOnly.password)).status,
    ).toBe(200);
    expect(
      (
        await fileOnlyAgent.request(
          'GET',
          `/v1/staff/files/${linkedObjectId}/metadata`,
        )
      ).status,
    ).toBe(404);
  });

  it.skipIf(process.env.R1_002B_SKIP_LOOPBACK_ORIGIN_TEST === '1')(
    'T-25: real browser uses the loopback credential cookie jar across web/API ports with exact-origin CORS',
    async () => {
      const pageServer = createHttpServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          '<!doctype html><html><body>R1-002B loopback browser test</body></html>',
        );
      });
      const previous = {
        APP_ENV: process.env.APP_ENV,
        HOST: process.env.HOST,
        PORT: process.env.PORT,
        STAFF_ORIGINS: process.env.STAFF_ORIGINS,
        COOKIE_PROFILE: process.env.COOKIE_PROFILE,
        STAFF_CONTAINER_BIND: process.env.STAFF_CONTAINER_BIND,
        PUBLIC_WEB_ORIGIN: process.env.PUBLIC_WEB_ORIGIN,
        TRUSTED_PROXY_ADDRESS: process.env.TRUSTED_PROXY_ADDRESS,
      };
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      let browserApp: Awaited<ReturnType<typeof createApiApp>> | undefined;
      let apiServer: ReturnType<typeof createHttpServer> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          pageServer.once('error', reject);
          pageServer.listen(3000, '127.0.0.1', resolve);
        });
        process.env.APP_ENV = 'development';
        process.env.HOST = '127.0.0.1';
        process.env.PORT = '3001';
        process.env.STAFF_ORIGINS = 'http://127.0.0.1:3000';
        process.env.COOKIE_PROFILE = 'loopback';
        delete process.env.STAFF_CONTAINER_BIND;
        delete process.env.PUBLIC_WEB_ORIGIN;
        delete process.env.TRUSTED_PROXY_ADDRESS;
        browserApp = await createApiApp();
        await browserApp.init();
        apiServer = createHttpServer(browserApp.getHttpAdapter().getInstance());
        await new Promise<void>((resolve, reject) => {
          apiServer!.once('error', reject);
          apiServer!.listen(3001, '127.0.0.1', resolve);
        });
        const pageOrigin = 'http://127.0.0.1:3000';
        const apiOrigin = 'http://127.0.0.1:3001';
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        const apiResponses: { headers: Record<string, string> }[] = [];
        const responseHeaderTasks: Promise<void>[] = [];
        page.on('response', async (response) => {
          if (response.url().startsWith(`${apiOrigin}/v1/staff/auth/`)) {
            responseHeaderTasks.push(
              response.allHeaders().then((headers) => {
                apiResponses.push({ headers });
              }),
            );
          }
        });
        await page.goto(pageOrigin);
        const credentialsForLogin = await directEmployee(
          `browser-loopback-${randomUUID().slice(0, 8)}@stdu.test`,
        );
        const browserResult = await page.evaluate(
          async ({ apiUrl: url, email, password }) => {
            const challenge = await fetch(`${url}/v1/staff/auth/csrf`, {
              credentials: 'include',
            });
            const challengeBody = (await challenge.json()) as {
              data: { token: string };
            };
            const login = await fetch(`${url}/v1/staff/auth/login`, {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': challengeBody.data.token,
              },
              body: JSON.stringify({ email, password }),
            });
            const loginBody = await login.json();
            const me = await fetch(`${url}/v1/staff/auth/me`, {
              credentials: 'include',
            });
            return {
              challengeStatus: challenge.status,
              loginStatus: login.status,
              loginBody,
              meStatus: me.status,
              documentCookie: document.cookie,
            };
          },
          {
            apiUrl: apiOrigin,
            email: credentialsForLogin.email,
            password: credentialsForLogin.password,
          },
        );
        await Promise.all(responseHeaderTasks);
        expect(browserResult).toMatchObject({
          challengeStatus: 200,
          loginStatus: 200,
          meStatus: 200,
        });
        const corsHeaders = apiResponses
          .map(({ headers }) => headers)
          .filter((headers) => headers['access-control-allow-origin']);
        expect(corsHeaders.length).toBeGreaterThanOrEqual(2);
        expect(
          corsHeaders.every(
            (headers) =>
              headers['access-control-allow-origin'] === pageOrigin &&
              headers['access-control-allow-credentials'] === 'true',
          ),
        ).toBe(true);
        expect(
          corsHeaders.some(
            (headers) => headers['access-control-allow-origin'] === '*',
          ),
        ).toBe(false);
        expect(browserResult.documentCookie).not.toContain('stdu_staff_dev=');
        const cookies = await context.cookies(apiOrigin);
        const sessionCookie = cookies.find(
          ({ name }) => name === 'stdu_staff_dev',
        );
        expect(sessionCookie).toMatchObject({
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
          path: '/',
        });
        expect(sessionCookie?.domain).toBe('127.0.0.1');
        expect(cookies.some(({ name }) => name === 'stdu_login_dev')).toBe(
          false,
        );
        await context.close();
      } finally {
        await browser?.close().catch(() => undefined);
        if (apiServer?.listening)
          await new Promise<void>((resolve) =>
            apiServer!.close(() => resolve()),
          );
        await browserApp?.close().catch(() => undefined);
        if (pageServer.listening)
          await new Promise<void>((resolve) =>
            pageServer.close(() => resolve()),
          );
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    },
  );

  it('T-25: real browser uses HTTPS host-only cookies through a same-origin proxy without CORS', async () => {
    const credentials = await selfsigned.generate(
      [{ name: 'commonName', value: '127.0.0.1' }],
      {
        algorithm: 'sha256',
        extensions: [
          { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
        ],
      },
    );
    let httpsApiUrl: string | undefined;
    const pageServer = createHttpsServer(
      { key: credentials.private, cert: credentials.cert },
      (request, response) => {
        if (request.url?.startsWith('/v1/staff/')) {
          if (!httpsApiUrl) {
            response.writeHead(503);
            response.end('The local API proxy is not ready.');
            return;
          }
          const upstreamUrl = new URL(request.url, httpsApiUrl);
          const upstream = httpsRequest(
            upstreamUrl,
            {
              method: request.method,
              headers: {
                ...request.headers,
                host: new URL(httpsApiUrl).host,
                'x-forwarded-for': '127.0.0.1',
                'x-forwarded-proto': 'https',
              },
              rejectUnauthorized: false,
            },
            (upstreamResponse) => {
              response.writeHead(
                upstreamResponse.statusCode ?? 502,
                upstreamResponse.headers,
              );
              upstreamResponse.pipe(response);
            },
          );
          upstream.once('error', () => {
            if (!response.headersSent) response.writeHead(502);
            response.end('The local API proxy request failed.');
          });
          request.pipe(upstream);
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          '<!doctype html><html><body>R1-002B browser test</body></html>',
        );
      },
    );
    const previous = {
      APP_ENV: process.env.APP_ENV,
      STAFF_ORIGINS: process.env.STAFF_ORIGINS,
      COOKIE_PROFILE: process.env.COOKIE_PROFILE,
      PUBLIC_WEB_ORIGIN: process.env.PUBLIC_WEB_ORIGIN,
      TRUSTED_PROXY_ADDRESS: process.env.TRUSTED_PROXY_ADDRESS,
    };
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let browserApp: Awaited<ReturnType<typeof createApiApp>> | undefined;
    let apiServer: ReturnType<typeof createHttpsServer> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        pageServer.once('error', reject);
        pageServer.listen(0, '127.0.0.1', resolve);
      });
      const pageAddress = pageServer.address();
      if (!pageAddress || typeof pageAddress === 'string')
        throw new Error('Browser page listener did not bind a TCP port.');
      const pageOrigin = `https://127.0.0.1:${pageAddress.port}`;
      process.env.APP_ENV = 'production';
      process.env.STAFF_ORIGINS = pageOrigin;
      process.env.COOKIE_PROFILE = 'https';
      process.env.PUBLIC_WEB_ORIGIN = pageOrigin;
      process.env.TRUSTED_PROXY_ADDRESS = '127.0.0.1';
      browserApp = await createApiApp();
      await browserApp.init();
      apiServer = createHttpsServer(
        { key: credentials.private, cert: credentials.cert },
        browserApp.getHttpAdapter().getInstance(),
      );
      await new Promise<void>((resolve, reject) => {
        apiServer!.once('error', reject);
        apiServer!.listen(0, '127.0.0.1', resolve);
      });
      const apiAddress = apiServer.address();
      if (!apiAddress || typeof apiAddress === 'string')
        throw new Error('HTTPS API listener did not bind a TCP port.');
      httpsApiUrl = `https://127.0.0.1:${apiAddress.port}`;
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const apiResponses: { url: string; headers: Record<string, string> }[] =
        [];
      const responseHeaderTasks: Promise<void>[] = [];
      page.on('response', async (response) => {
        if (response.url().startsWith(`${pageOrigin}/v1/staff/auth/`)) {
          responseHeaderTasks.push(
            response.allHeaders().then((headers) => {
              apiResponses.push({ url: response.url(), headers });
            }),
          );
        }
      });
      await page.goto(pageOrigin);
      const credentialsForLogin = await directEmployee(
        `browser-${randomUUID().slice(0, 8)}@stdu.test`,
      );
      const browserResult = await page.evaluate(
        async ({ apiUrl: url, email, password }) => {
          const challenge = await fetch(`${url}/v1/staff/auth/csrf`, {
            credentials: 'include',
          });
          const challengeText = await challenge.text();
          let challengeBody: { data: { token: string } };
          try {
            challengeBody = JSON.parse(challengeText) as {
              data: { token: string };
            };
          } catch {
            return {
              challengeStatus: challenge.status,
              challengeUrl: challenge.url,
              challengeText: challengeText.slice(0, 300),
              requestApiUrl: url,
            };
          }
          const login = await fetch(`${url}/v1/staff/auth/login`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': challengeBody.data.token,
            },
            body: JSON.stringify({ email, password }),
          });
          const loginBody = await login.json();
          const me = await fetch(`${url}/v1/staff/auth/me`, {
            credentials: 'include',
          });
          return {
            challengeStatus: challenge.status,
            loginStatus: login.status,
            loginBody,
            meStatus: me.status,
            documentCookie: document.cookie,
          };
        },
        {
          apiUrl: pageOrigin,
          email: credentialsForLogin.email,
          password: credentialsForLogin.password,
        },
      );
      await Promise.all(responseHeaderTasks);
      expect(browserResult).toMatchObject({
        challengeStatus: 200,
        loginStatus: 200,
        meStatus: 200,
      });
      const corsHeaders = apiResponses
        .map(({ headers }) => headers)
        .filter((headers) => headers['access-control-allow-origin']);
      expect(corsHeaders).toHaveLength(0);
      expect(browserResult.documentCookie).not.toContain('__Host-stdu_');
      const cookies = await context.cookies(pageOrigin);
      const sessionCookie = cookies.find(
        ({ name }) => name === '__Host-stdu_staff',
      );
      expect(sessionCookie).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
      });
      expect(sessionCookie?.domain).toBe('127.0.0.1');
      expect(cookies.some(({ name }) => name === '__Host-stdu_login')).toBe(
        false,
      );
      const setCookieHeaders = apiResponses.flatMap(({ headers }) =>
        headers['set-cookie'] ? [headers['set-cookie']] : [],
      );
      expect(setCookieHeaders.join('\n')).toMatch(
        /__Host-stdu_staff=.*Secure/i,
      );
      expect(setCookieHeaders.join('\n')).toMatch(
        /__Host-stdu_staff=.*HttpOnly/i,
      );
      expect(setCookieHeaders.join('\n')).not.toMatch(
        /__Host-stdu_staff=[^\n]*Domain=/i,
      );
      expect(setCookieHeaders.join('\n')).toMatch(
        /__Host-stdu_staff=[^\n]*Path=\//i,
      );

      await context.close();
    } finally {
      await browser?.close().catch(() => undefined);
      if (apiServer?.listening)
        await new Promise<void>((resolve) => apiServer!.close(() => resolve()));
      await browserApp?.close().catch(() => undefined);
      if (pageServer.listening)
        await new Promise<void>((resolve) => pageServer.close(() => resolve()));
      if (previous.STAFF_ORIGINS === undefined)
        delete process.env.STAFF_ORIGINS;
      else process.env.STAFF_ORIGINS = previous.STAFF_ORIGINS;
      if (previous.APP_ENV === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous.APP_ENV;
      if (previous.COOKIE_PROFILE === undefined)
        delete process.env.COOKIE_PROFILE;
      else process.env.COOKIE_PROFILE = previous.COOKIE_PROFILE;
      if (previous.PUBLIC_WEB_ORIGIN === undefined)
        delete process.env.PUBLIC_WEB_ORIGIN;
      else process.env.PUBLIC_WEB_ORIGIN = previous.PUBLIC_WEB_ORIGIN;
      if (previous.TRUSTED_PROXY_ADDRESS === undefined)
        delete process.env.TRUSTED_PROXY_ADDRESS;
      else process.env.TRUSTED_PROXY_ADDRESS = previous.TRUSTED_PROXY_ADDRESS;
    }
  });

  it('T-26/T-27: concurrent login respects the five-session cap and stale credential snapshots cannot create a session', async () => {
    const anotherEmail = `race-${randomUUID().slice(0, 8)}@stdu.test`;
    const password = `R1-002B race password ${randomBytes(6).toString('hex')}!`;
    const userId = randomUUID();
    const passwordHash = await new IdentityCrypto().hashPassword(
      password,
      anotherEmail,
    );
    await ownerDb.staffUser.create({
      data: {
        id: userId,
        email: anotherEmail,
        emailNormalized: anotherEmail,
        displayName: 'Race User',
        passwordHash,
        passwordChangeRequired: false,
        state: 'ACTIVE',
      },
    });
    const logins = [] as { result: ApiResult; agent: StaffAgent }[];
    for (let index = 0; index < 5; index++) {
      const agent = new StaffAgent();
      agent.baseUrl = apiUrl;
      const result = await agent.login(anotherEmail, password);
      logins.push({ result, agent });
    }
    const oldestBeforeSixth = await ownerDb.staffSession.findFirstOrThrow({
      where: { staffUserId: userId, revokedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const sixthAgent = new StaffAgent();
    sixthAgent.baseUrl = apiUrl;
    logins.push({
      result: await sixthAgent.login(anotherEmail, password),
      agent: sixthAgent,
    });
    expect(logins.every(({ result }) => result.status === 200)).toBe(true);
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: userId, revokedAt: null },
      }),
    ).toBeLessThanOrEqual(5);
    expect(
      await ownerDb.staffSession.findUniqueOrThrow({
        where: { id: oldestBeforeSixth.id },
      }),
    ).toMatchObject({
      revokedAt: expect.any(Date),
      revocationReason: 'SESSION_LIMIT',
    });
    expect(
      await ownerDb.auditEvent.count({
        where: {
          action: 'staff.sessions.revoked',
          reasonCode: 'SESSION_LIMIT',
        },
      }),
    ).toBeGreaterThan(0);

    const concurrentEmail = `concurrent-login-${randomUUID().slice(0, 8)}@stdu.test`;
    const concurrentPassword = `R1-002B concurrent password ${randomBytes(6).toString('hex')}!`;
    const concurrentId = randomUUID();
    const concurrentHash = await new IdentityCrypto().hashPassword(
      concurrentPassword,
      concurrentEmail,
    );
    await ownerDb.staffUser.create({
      data: {
        id: concurrentId,
        email: concurrentEmail,
        emailNormalized: concurrentEmail,
        displayName: 'Concurrent Login',
        passwordHash: concurrentHash,
        passwordChangeRequired: false,
        state: 'ACTIVE',
      },
    });
    for (let index = 0; index < 5; index++) {
      const agent = new StaffAgent();
      agent.baseUrl = apiUrl;
      expect(
        (await agent.login(concurrentEmail, concurrentPassword)).status,
      ).toBe(200);
    }
    const sessionLocker = new Client({
      connectionString: requireUrl('MIGRATION_DATABASE_URL'),
    });
    await sessionLocker.connect();
    let sessionLockOpen = false;
    let concurrentLogins: Promise<ApiResult>[] = [];
    try {
      await sessionLocker.query('BEGIN');
      sessionLockOpen = true;
      await sessionLocker.query(
        'SELECT id FROM staff_user WHERE id=$1 FOR UPDATE',
        [concurrentId],
      );
      const loginAgents = Array.from({ length: 2 }, () => {
        const agent = new StaffAgent();
        agent.baseUrl = apiUrl;
        return agent;
      });
      concurrentLogins = loginAgents.map((agent) =>
        agent.login(concurrentEmail, concurrentPassword),
      );
      const waitDeadline = Date.now() + 15_000;
      let loginWaits: {
        waitEventType: string | null;
        waitEvent: string | null;
      }[] = [];
      while (Date.now() < waitDeadline) {
        const waiting = await sessionLocker.query(`
          SELECT wait_event_type AS "waitEventType", wait_event AS "waitEvent"
          FROM pg_stat_activity WHERE datname=current_database() AND application_name='stdu-r1-002b-api'
            AND wait_event_type='Lock' AND wait_event='transactionid'
        `);
        loginWaits = waiting.rows;
        if (loginWaits.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(
        loginWaits.length,
        'Concurrent sessions must queue on the locked StaffUser row',
      ).toBeGreaterThan(0);
      await sessionLocker.query('COMMIT');
      sessionLockOpen = false;
      const results = await Promise.all(concurrentLogins);
      expect(results.every(({ status }) => status === 200)).toBe(true);
      expect(
        await ownerDb.staffSession.count({
          where: { staffUserId: concurrentId, revokedAt: null },
        }),
      ).toBeLessThanOrEqual(5);
    } finally {
      if (sessionLockOpen)
        await sessionLocker.query('ROLLBACK').catch(() => undefined);
      await sessionLocker.end().catch(() => undefined);
      await Promise.allSettled(concurrentLogins);
    }

    const staleEmail = `stale-${randomUUID().slice(0, 8)}@stdu.test`;
    const stalePassword = `R1-002B stale login password ${randomBytes(6).toString('hex')}!`;
    const staleId = randomUUID();
    const originalHash = await new IdentityCrypto().hashPassword(
      stalePassword,
      staleEmail,
    );
    await ownerDb.staffUser.create({
      data: {
        id: staleId,
        email: staleEmail,
        emailNormalized: staleEmail,
        displayName: 'Stale Snapshot',
        passwordHash: originalHash,
        passwordChangeRequired: false,
        state: 'ACTIVE',
      },
    });
    const locker = new Client({
      connectionString: requireUrl('MIGRATION_DATABASE_URL'),
    });
    await locker.connect();
    let transactionOpen = false;
    let pending: Promise<ApiResult> | undefined;
    try {
      await locker.query('BEGIN');
      transactionOpen = true;
      await locker.query('SELECT id FROM staff_user WHERE id=$1 FOR UPDATE', [
        staleId,
      ]);
      const staleAgent = new StaffAgent();
      staleAgent.baseUrl = apiUrl;
      pending = staleAgent.login(staleEmail, stalePassword);
      const deadline = Date.now() + 15_000;
      let observed: {
        waitEventType: string | null;
        waitEvent: string | null;
        query: string;
      }[] = [];
      while (Date.now() < deadline) {
        const activity = await locker.query(`
          SELECT application_name AS "applicationName", wait_event_type AS "waitEventType",
                 wait_event AS "waitEvent", left(query, 180) AS query
          FROM pg_stat_activity
          WHERE datname=current_database() AND application_name='stdu-r1-002b-api'
            AND wait_event_type='Lock' AND wait_event='transactionid'
        `);
        observed = activity.rows;
        if (observed.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const blocked = observed.length > 0;
      expect(
        blocked,
        `Expected a lock wait on staff_user; observed ${JSON.stringify(observed)}`,
      ).toBe(true);
      const replacementHash = await new IdentityCrypto().hashPassword(
        `R1-002B replacement password ${randomBytes(5).toString('hex')}!`,
        staleEmail,
      );
      await locker.query(
        'UPDATE staff_user SET password_hash=$2, auth_version=auth_version+1, version=version+1 WHERE id=$1',
        [staleId, replacementHash],
      );
      await locker.query('COMMIT');
      transactionOpen = false;
      const staleResult = await pending;
      expect(staleResult.status).toBe(401);
      expect(staleResult.body.code).toBe('INVALID_CREDENTIALS');
      expect(
        await ownerDb.staffSession.count({ where: { staffUserId: staleId } }),
      ).toBe(0);
    } finally {
      if (transactionOpen)
        await locker.query('ROLLBACK').catch(() => undefined);
      await locker.end().catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
    }

    await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
    const writeTarget = await directEmployee(
      `t27-revoke-write-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t27-seller-write-${randomUUID().slice(0, 8)}`,
          permissions: ['sellers.write'],
        },
      ],
    );
    const writeAgent = new StaffAgent();
    writeAgent.baseUrl = apiUrl;
    expect(
      (await writeAgent.login(writeTarget.email, writeTarget.password)).status,
    ).toBe(200);
    let signalEntered!: () => void;
    let releaseWrite!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let requestReachedGate = false;
    requestBarrier = {
      userId: writeTarget.id,
      path: '/v1/staff/sellers',
      entered: () => {
        requestReachedGate = true;
        signalEntered();
      },
      wait,
    };
    const sellersBefore = await ownerDb.sellerLegalEntity.count();
    const pausedWrite = writeAgent.write('POST', '/v1/staff/sellers', {
      displayName: 'Must not survive revocation',
      kind: 'OOO',
    });
    const gateTimeout = setTimeout(() => signalEntered(), 10_000);
    await entered;
    clearTimeout(gateTimeout);
    try {
      expect(requestReachedGate).toBe(true);
      const revokedDuringWrite = await rootAgent.write(
        'POST',
        `/v1/staff/users/${writeTarget.id}/sessions/revoke`,
        {
          expectedVersion: await userVersion(writeTarget.id),
        },
      );
      expect(revokedDuringWrite.status).toBe(200);
    } finally {
      releaseWrite();
      requestBarrier = undefined;
    }
    const staleWrite = await pausedWrite;
    expect(staleWrite.status).toBe(401);
    expect(staleWrite.body.code).toBe('AUTH_REQUIRED');
    expect(await ownerDb.sellerLegalEntity.count()).toBe(sellersBefore);
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: writeTarget.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('T-38: two full admins preserve redundancy while one may be blocked and later restored', async () => {
    const secondBase = allPermissions.filter(
      (permission) => permission !== 'sellers.write',
    );
    const member = await directFullAdmin(
      `second-full-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `second-full-base-${randomUUID().slice(0, 8)}`,
          permissions: secondBase,
        },
        {
          code: `second-full-critical-${randomUUID().slice(0, 8)}`,
          permissions: ['sellers.write', 'sellers.read'],
        },
      ],
    );
    secondFullUserId = member.id;
    secondFullEmail = member.email;
    secondBaseRoleId = member.roleIds[0]!;
    secondCriticalRoleId = member.roleIds[1]!;
    await expectFullAdminCount(2);
    secondFullPassword = member.password;
    secondAgent = new StaffAgent();
    secondAgent.baseUrl = apiUrl;
    expect(
      (await secondAgent.login(member.email, member.password)).status,
    ).toBe(200);
    await ensureLoggedIn(
      accessAgent,
      (
        await ownerDb.staffUser.findUniqueOrThrow({
          where: { id: accessUserId },
          select: { email: true },
        })
      ).email,
      accessChangedPassword,
    );
    const rootRoleBefore = await ownerDb.role.findUniqueOrThrow({
      where: { id: rootRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    const rootWithoutFileRead = rootRoleBefore.permissions
      .map(({ permission }) => permission.code)
      .filter((code) => code !== 'files.metadata.read');
    const safelyReduced = await accessAgent.write(
      'PUT',
      `/v1/staff/roles/${rootRoleId}/permissions`,
      {
        permissions: rootWithoutFileRead,
        expectedVersion: rootRoleBefore.version,
      },
    );
    expect(safelyReduced.status).toBe(200);
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: rootUserId, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await ownerDb.auditEvent.count({
        where: {
          action: 'staff.role.permissions.changed',
          outcome: 'SUCCESS',
          reasonCode: 'ROLE_PERMISSIONS_CHANGED',
        },
      }),
    ).toBeGreaterThan(0);
    await expectFullAdminCount(1);
    const reducedRole = await ownerDb.role.findUniqueOrThrow({
      where: { id: rootRoleId },
    });
    const restoredByRemainingAdmin = await secondAgent.write(
      'PUT',
      `/v1/staff/roles/${rootRoleId}/permissions`,
      {
        permissions: allPermissions,
        expectedVersion: reducedRole.version,
      },
    );
    expect(restoredByRemainingAdmin.status).toBe(200);
    await expectFullAdminCount(2);

    const unready = await directEmployee(
      `t38-unready-full-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t38-unready-role-${randomUUID().slice(0, 8)}`,
          permissions: allPermissions,
        },
      ],
      { passwordChangeRequired: true },
    );
    const unreadyMembers = await ownerDb.$transaction((tx) =>
      adminInvariantMembers(tx),
    );
    expect(unreadyMembers.some(({ userId }) => userId === unready.id)).toBe(
      false,
    );
    const currentRootVersion = await userVersion(rootUserId);
    const blocked = await accessAgent.write(
      'PATCH',
      `/v1/staff/users/${rootUserId}/status`,
      { state: 'BLOCKED', expectedVersion: currentRootVersion },
    );
    expect(blocked.status).toBe(200);
    expect(
      await ownerDb.staffSession.count({
        where: { staffUserId: rootUserId, revokedAt: null },
      }),
    ).toBe(0);
    await expectFullAdminCount(1);
    const rootAfterBlock = await userVersion(rootUserId);
    const restored = await accessAgent.write(
      'PATCH',
      `/v1/staff/users/${rootUserId}/status`,
      { state: 'ACTIVE', expectedVersion: rootAfterBlock },
    );
    expect(restored.status).toBe(200);
    await expectFullAdminCount(2);
    rootAgent = new StaffAgent();
    rootAgent.baseUrl = apiUrl;
    expect((await rootAgent.login(rootEmail, rootPassword)).status).toBe(200);
    expect(member.id).toBeTruthy();
  });

  it('T-37: successive role edits evaluate one employee union across multiple roles without mixing employees', async () => {
    const rootVersion = await userVersion(rootUserId);
    const blockedRoot = await accessAgent.write(
      'PATCH',
      `/v1/staff/users/${rootUserId}/status`,
      { state: 'BLOCKED', expectedVersion: rootVersion },
    );
    expect(blockedRoot.status).toBe(200);
    await expectFullAdminCount(1);
    const base = await ownerDb.role.findUniqueOrThrow({
      where: { id: secondBaseRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    const critical = await ownerDb.role.findUniqueOrThrow({
      where: { id: secondCriticalRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    const basePermissions = base.permissions
      .map(({ permission }) => permission.code)
      .filter((permission) => permission !== 'sellers.read');
    const firstUpdate = await accessAgent.write(
      'PUT',
      `/v1/staff/roles/${secondBaseRoleId}/permissions`,
      { permissions: basePermissions, expectedVersion: base.version },
    );
    expect(firstUpdate.status).toBe(200);
    await expectFullAdminCount(1);
    const safeRename = await accessAgent.write(
      'PATCH',
      `/v1/staff/roles/${secondCriticalRoleId}`,
      {
        name: 'Renamed critical split role',
        expectedVersion: critical.version,
      },
    );
    expect(safeRename.status).toBe(200);
    expect(
      (
        await ownerDb.role.findUniqueOrThrow({
          where: { id: secondCriticalRoleId },
        })
      ).name,
    ).toBe('Renamed critical split role');
    const splitOne = await directEmployee(
      `t37-split-one-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t37-split-one-role-${randomUUID().slice(0, 8)}`,
          permissions: allPermissions.slice(0, 6),
        },
      ],
    );
    const splitTwo = await directEmployee(
      `t37-split-two-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t37-split-two-role-${randomUUID().slice(0, 8)}`,
          permissions: allPermissions.slice(6),
        },
      ],
    );
    const separateMembers = await ownerDb.$transaction((tx) =>
      adminInvariantMembers(tx),
    );
    expect(
      separateMembers.find(({ userId }) => userId === splitOne.id)?.fullAdmin,
    ).toBe(false);
    expect(
      separateMembers.find(({ userId }) => userId === splitTwo.id)?.fullAdmin,
    ).toBe(false);
    const deniedUnionRemoval = await accessAgent.write(
      'PUT',
      `/v1/staff/roles/${secondCriticalRoleId}/permissions`,
      {
        permissions: ['sellers.write'],
        expectedVersion: safeRename.body.data.version,
      },
    );
    expect(deniedUnionRemoval.status).toBe(409);
    expect(deniedUnionRemoval.body.code).toBe('LAST_ADMIN_REQUIRED');
    const rootAfterBlock = await userVersion(rootUserId);
    const unblockedRoot = await accessAgent.write(
      'PATCH',
      `/v1/staff/users/${rootUserId}/status`,
      { state: 'ACTIVE', expectedVersion: rootAfterBlock },
    );
    expect(unblockedRoot.status).toBe(200);
    await expectFullAdminCount(2);
  });

  it('T-39: observed PostgreSQL advisory-lock wait serializes two concurrent attempts to remove both full admins', async () => {
    await ensureLoggedIn(
      accessAgent,
      (
        await ownerDb.staffUser.findUniqueOrThrow({
          where: { id: accessUserId },
          select: { email: true },
        })
      ).email,
      accessChangedPassword,
    );
    const secondControl = await directEmployee(
      `t39-control-${randomUUID().slice(0, 8)}@stdu.test`,
      [
        {
          code: `t39-control-role-${randomUUID().slice(0, 8)}`,
          permissions: controlPermissions,
        },
      ],
    );
    const secondControlAgent = new StaffAgent();
    secondControlAgent.baseUrl = apiUrl;
    expect(
      (
        await secondControlAgent.login(
          secondControl.email,
          secondControl.password,
        )
      ).status,
    ).toBe(200);

    async function runSerializedRace(
      label: string,
      first: () => Promise<ApiResult>,
      second: () => Promise<ApiResult>,
    ) {
      const barrier = new Client({
        connectionString: requireUrl('MIGRATION_DATABASE_URL'),
      });
      await barrier.connect();
      let transactionOpen = false;
      const pending: Promise<ApiResult>[] = [];
      try {
        await barrier.query('BEGIN');
        transactionOpen = true;
        await barrier.query('SELECT pg_advisory_xact_lock(1398031445,2)');
        pending.push(first(), second());
        const deadline = Date.now() + 15_000;
        let observed: {
          applicationName: string;
          waitEventType: string | null;
          waitEvent: string | null;
          query: string;
        }[] = [];
        while (Date.now() < deadline) {
          const activity = await barrier.query(`
            SELECT application_name AS "applicationName", wait_event_type AS "waitEventType",
                   wait_event AS "waitEvent", left(query, 220) AS query
            FROM pg_stat_activity
            WHERE datname=current_database() AND application_name='stdu-r1-002b-api'
              AND wait_event_type='Lock' AND wait_event='advisory'
          `);
          observed = activity.rows;
          if (observed.length > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(
          observed.length,
          `${label}: expected PostgreSQL advisory-lock wait; observed ${JSON.stringify(observed)}`,
        ).toBeGreaterThan(0);
        await barrier.query('COMMIT');
        transactionOpen = false;
        const results = await Promise.all(pending);
        expect(results.map(({ status }) => status).sort(), label).toEqual([
          200, 409,
        ]);
        expect(
          results.find(({ status }) => status === 409)?.body.code,
          label,
        ).toBe('LAST_ADMIN_REQUIRED');
        await expectFullAdminCount(1);
        const denial = await ownerDb.auditEvent.findFirstOrThrow({
          where: { reasonCode: 'LAST_ADMIN_REQUIRED', outcome: 'DENIED' },
          orderBy: { occurredAt: 'desc' },
        });
        expect(denial.requestId).toBeTruthy();
      } finally {
        if (transactionOpen)
          await barrier.query('ROLLBACK').catch(() => undefined);
        await barrier.end().catch(() => undefined);
        if (pending.length) await Promise.allSettled(pending);
      }
    }

    async function restoreTwoFullAdmins() {
      const root = await ownerDb.staffUser.findUniqueOrThrow({
        where: { id: rootUserId },
      });
      if (root.state === 'BLOCKED') {
        const unblocked = await accessAgent.write(
          'PATCH',
          `/v1/staff/users/${rootUserId}/status`,
          { state: 'ACTIVE', expectedVersion: root.version },
        );
        expect(unblocked.status).toBe(200);
      }
      const qualified = await ownerDb.$transaction((tx) =>
        adminInvariantMembers(tx),
      );
      const remaining = qualified.find(({ fullAdmin }) => fullAdmin);
      expect(remaining).toBeTruthy();
      const adminAgent =
        remaining!.userId === rootUserId ? rootAgent : secondAgent;
      const adminEmail =
        remaining!.userId === rootUserId ? rootEmail : secondFullEmail;
      const adminPassword =
        remaining!.userId === rootUserId ? rootPassword : secondFullPassword;
      await ensureLoggedIn(adminAgent, adminEmail, adminPassword);

      const rootRole = await ownerDb.role.findUniqueOrThrow({
        where: { id: rootRoleId },
        include: { permissions: { include: { permission: true } } },
      });
      if (
        rootRole.permissions
          .map(({ permission }) => permission.code)
          .sort()
          .join('|') !== [...allPermissions].sort().join('|')
      ) {
        expect(
          (
            await adminAgent.write(
              'PUT',
              `/v1/staff/roles/${rootRoleId}/permissions`,
              {
                permissions: allPermissions,
                expectedVersion: rootRole.version,
              },
            )
          ).status,
        ).toBe(200);
      }
      await ensureLoggedIn(rootAgent, rootEmail, rootPassword);
      const baseRole = await ownerDb.role.findUniqueOrThrow({
        where: { id: secondBaseRoleId },
        include: { permissions: { include: { permission: true } } },
      });
      const basePermissions = allPermissions.filter(
        (permission) => permission !== 'sellers.write',
      );
      if (
        baseRole.permissions
          .map(({ permission }) => permission.code)
          .sort()
          .join('|') !== [...basePermissions].sort().join('|')
      ) {
        const restoredBase = await rootAgent.write(
          'PUT',
          `/v1/staff/roles/${secondBaseRoleId}/permissions`,
          { permissions: basePermissions, expectedVersion: baseRole.version },
        );
        expect(
          restoredBase.status,
          `restore second admin role: ${JSON.stringify(restoredBase.body)}`,
        ).toBe(200);
      }
      const secondUser = await ownerDb.staffUser.findUniqueOrThrow({
        where: { id: secondFullUserId },
      });
      const assignment = await ownerDb.userRole.findUnique({
        where: {
          staffUserId_roleId: {
            staffUserId: secondFullUserId,
            roleId: secondBaseRoleId,
          },
        },
      });
      if (!assignment) {
        const restoredAssignment = await rootAgent.write(
          'PUT',
          `/v1/staff/users/${secondFullUserId}/roles/${secondBaseRoleId}`,
          { expectedVersion: secondUser.version },
        );
        expect(
          restoredAssignment.status,
          `restore second admin assignment: ${JSON.stringify(restoredAssignment.body)}`,
        ).toBe(200);
      }
      await expectFullAdminCount(2);
    }

    const rootRole = await ownerDb.role.findUniqueOrThrow({
      where: { id: rootRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    const rootDesired = rootRole.permissions
      .map(({ permission }) => permission.code)
      .filter((permission) => permission !== 'files.metadata.read');
    const ownerRole = await ownerDb.role.findUniqueOrThrow({
      where: { id: secondBaseRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    const ownerDesired = ownerRole.permissions
      .map(({ permission }) => permission.code)
      .filter((permission) => permission !== 'files.metadata.read');
    await runSerializedRace(
      'permission writer versus permission writer',
      () =>
        accessAgent.write('PUT', `/v1/staff/roles/${rootRoleId}/permissions`, {
          permissions: rootDesired,
          expectedVersion: rootRole.version,
        }),
      () =>
        secondControlAgent.write(
          'PUT',
          `/v1/staff/roles/${secondBaseRoleId}/permissions`,
          { permissions: ownerDesired, expectedVersion: ownerRole.version },
        ),
    );
    await restoreTwoFullAdmins();

    await runSerializedRace(
      'block versus permission reduction',
      async () =>
        accessAgent.write('PATCH', `/v1/staff/users/${rootUserId}/status`, {
          state: 'BLOCKED',
          expectedVersion: await userVersion(rootUserId),
        }),
      async () => {
        const role = await ownerDb.role.findUniqueOrThrow({
          where: { id: secondBaseRoleId },
          include: { permissions: { include: { permission: true } } },
        });
        return secondControlAgent.write(
          'PUT',
          `/v1/staff/roles/${secondBaseRoleId}/permissions`,
          {
            permissions: role.permissions
              .map(({ permission }) => permission.code)
              .filter((permission) => permission !== 'files.metadata.read'),
            expectedVersion: role.version,
          },
        );
      },
    );
    await restoreTwoFullAdmins();

    await runSerializedRace(
      'block versus role unassignment',
      async () =>
        accessAgent.write('PATCH', `/v1/staff/users/${rootUserId}/status`, {
          state: 'BLOCKED',
          expectedVersion: await userVersion(rootUserId),
        }),
      async () =>
        secondControlAgent.write(
          'DELETE',
          `/v1/staff/users/${secondFullUserId}/roles/${secondBaseRoleId}?expectedVersion=${await userVersion(secondFullUserId)}`,
        ),
    );
    await restoreTwoFullAdmins();
  });
});
