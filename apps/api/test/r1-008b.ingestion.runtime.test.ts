import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createApiApp } from '../src/app.factory.js';
import { IdentityCrypto } from '../src/identity/crypto.js';
import {
  DATABASE,
  REDIS,
  type PrismaDatabase,
} from '../src/database/database.module.js';
import { SupplierIngestionWorker } from '../src/supplier-ingestion/supplier-ingestion.worker.js';
import type { Redis } from 'ioredis';

type Json = Record<string, unknown>;
type Result = { status: number; body: Json };
const enabled = process.env.R1_008B_TEST_ENABLED === 'true';
const ORIGIN = 'http://127.0.0.1:3000';
const BASE = '/v1/staff/ingestion';
const QUEUE = 'stdu:ingestion:v1:ready';
const permissions = [
  'ingestion.read',
  'ingestion.sources.write',
  'ingestion.run',
  'ingestion.review',
];
let owner: PrismaClient;
let database: PrismaDatabase;
let app: Awaited<ReturnType<typeof createApiApp>>;
let worker: SupplierIngestionWorker;
let redis: Redis;
let api = '';
let full: Agent;
let supplierId = '';
let baseline: {
  offers: number;
  revisions: number;
  products: number;
  proposals: number;
};
const exec = promisify(execFile);

function data(result: Result): Json {
  expect(result.body.data).toBeTypeOf('object');
  return result.body.data as Json;
}

class Agent {
  cookies = new Map<string, string>();

  async request(
    method: string,
    path: string,
    body?: unknown,
    key?: string,
    csrf?: string,
  ): Promise<Result> {
    const headers = new Headers({ Origin: ORIGIN, Accept: 'application/json' });
    if (this.cookies.size)
      headers.set(
        'Cookie',
        [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      );
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (key) headers.set('Idempotency-Key', key);
    if (csrf) headers.set('X-CSRF-Token', csrf);
    const response = await fetch(new URL(path, api), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair!.indexOf('=');
      this.cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
    }
    return { status: response.status, body: (await response.json()) as Json };
  }

  async csrf() {
    const response = await this.request('GET', '/v1/staff/auth/csrf');
    expect(response.status).toBe(200);
    return String(data(response).token);
  }

  async write(
    method: string,
    path: string,
    body: unknown,
    key: string = randomUUID(),
  ) {
    return this.request(method, path, body, key, await this.csrf());
  }
}

async function actor(codes: string[], label: string): Promise<Agent> {
  const id = randomUUID();
  const email = `TEST-r1-008b-${label}-${id}@example.invalid`;
  const password = `TEST R1-008B ${randomBytes(24).toString('base64url')}!`;
  const passwordHash = await new IdentityCrypto().hashPassword(password, email);
  await owner.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        id: randomUUID(),
        code: `test-ingestion-${id}`,
        name: `TEST ${label}`,
        state: 'ACTIVE',
      },
    });
    const found = await tx.permission.findMany({
      where: { code: { in: codes } },
    });
    expect(found.map((x) => x.code).sort()).toEqual([...codes].sort());
    await tx.rolePermission.createMany({
      data: found.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    await tx.staffUser.create({
      data: {
        id,
        email,
        emailNormalized: email.toLowerCase(),
        displayName: `TEST ${label}`,
        passwordHash,
        state: 'ACTIVE',
        passwordChangeRequired: false,
      },
    });
    await tx.userRole.create({ data: { staffUserId: id, roleId: role.id } });
  });
  const agent = new Agent();
  const response = await agent.request(
    'POST',
    '/v1/staff/auth/login',
    { email, password },
    undefined,
    await agent.csrf(),
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return agent;
}

async function source(fixtureKey = 'offers-v1', overrides: Json = {}) {
  const response = await full.write('POST', `${BASE}/sources`, {
    supplierId,
    adapterVersion: 'fixture-json/1',
    fixtureKey,
    maxRows: 100,
    maxAttempts: 3,
    timeoutMs: 10000,
    ...overrides,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return data(response);
}

async function run(sourceId: string, expectedSourceVersion = 1, key?: string) {
  const response = await full.write(
    'POST',
    `${BASE}/runs`,
    { sourceId, expectedSourceVersion },
    key,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return data(response);
}

async function due(id: string) {
  await owner.ingestionOutbox.update({
    where: { runId: id },
    data: { nextDispatchAt: new Date(0) },
  });
  await owner.ingestionRun.updateMany({
    where: { id, state: { in: ['QUEUED', 'RETRY_WAIT'] } },
    data: { nextAttemptAt: new Date(0) },
  });
}

async function finish(id: string) {
  await due(id);
  for (let index = 0; index < 30; index++) {
    const current = await owner.ingestionRun.findUniqueOrThrow({
      where: { id },
    });
    if (['COMPLETE', 'PARTIAL', 'FAILED'].includes(current.state))
      return current;
    await worker.tick();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Owned ingestion run did not reach a terminal state.');
}

async function unchangedBusiness() {
  return {
    offers: await owner.supplierOffer.count(),
    revisions: await owner.supplierOfferRevision.count(),
    products: await owner.catalogProduct.count(),
    proposals: await owner.productMatchProposal.count(),
  };
}

async function ownedCompose(args: string[]) {
  const project = process.env.R1_008B_TEST_COMPOSE_PROJECT ?? '';
  const file = process.env.R1_008B_TEST_COMPOSE_FILE ?? '';
  if (
    !/^stdu-r1-008b-test-\d+-[a-f0-9]{8}$/.test(project) ||
    !file.endsWith('compose.r1-008b-test.yaml')
  ) {
    throw new Error(
      'Refusing fault injection outside the owned R1-008B project.',
    );
  }
  const { stdout } = await exec(
    'docker',
    ['compose', '-p', project, '-f', file, 'ps', '-q'],
    { windowsHide: true, timeout: 10000 },
  );
  const ids = stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length !== 2)
    throw new Error('Owned project must have exactly two service containers.');
  const inspected = await exec('docker', ['inspect', ...ids], {
    windowsHide: true,
    timeout: 10000,
  });
  const containers = JSON.parse(inspected.stdout) as Array<{
    Config: { Labels: Record<string, string> };
  }>;
  if (
    containers.some(
      (c) => c.Config.Labels['com.docker.compose.project'] !== project,
    )
  )
    throw new Error('Container ownership mismatch.');
  return exec('docker', ['compose', '-p', project, '-f', file, ...args], {
    windowsHide: true,
    timeout: 60000,
  });
}

describe.skipIf(!enabled)(
  'R1-008B real isolated PostgreSQL, Redis, Python and staff HTTP',
  () => {
    beforeAll(async () => {
      owner = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: process.env.MIGRATION_DATABASE_URL!,
        }),
      });
      await owner.$connect();
      const identity = await owner.$queryRaw<
        { name: string }[]
      >`SELECT current_database() AS name`;
      expect(identity[0]?.name).toBe('stdu_r1_008b_test');
      expect(
        await owner.rolePermission.count({
          where: { permission: { code: { in: permissions } } },
        }),
      ).toBe(0);
      app = await createApiApp();
      await app.listen(0, '127.0.0.1');
      api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
      database = app.get<PrismaDatabase>(DATABASE);
      worker = app.get(SupplierIngestionWorker);
      redis = app.get<Redis>(REDIS);
      full = await actor([...permissions, 'suppliers.write'], 'full');
      const created = await full.write('POST', '/v1/staff/suppliers', {
        legalName: 'TEST R1-008B synthetic supplier',
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      supplierId = String(data(created).id);
      baseline = await unchangedBusiness();
    }, 60000);

    afterAll(async () => {
      vi.restoreAllMocks();
      await app?.close();
      await owner?.$disconnect();
    });

    it('ING-01: manual staff request reaches Redis, Python and durable staging with immutable provenance', async () => {
      const src = await source();
      const created = await run(String(src.id));
      const completed = await finish(String(created.id));
      expect(completed.state).toBe('COMPLETE');
      expect(completed.processed).toBe(2);
      expect(completed.candidateCount).toBe(2);
      expect(completed.errorCount).toBe(0);
      expect(completed.rawSnapshot?.length).toBeGreaterThan(0);
      expect(completed.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(
        (
          await owner.ingestionOutbox.findUniqueOrThrow({
            where: { runId: completed.id },
          })
        ).dispatches,
      ).toBeGreaterThan(0);
      const rows = await full.request(
        'GET',
        `${BASE}/runs/${completed.id}/rows?limit=1`,
      );
      expect(rows.status).toBe(200);
      expect(rows.body.data).toBeInstanceOf(Array);
      const stored = await owner.ingestionRow.findMany({
        where: { runId: completed.id },
        orderBy: { rowNumber: 'asc' },
      });
      expect(stored).toHaveLength(2);
      expect(stored[0]?.sourceHash).toBe(completed.sourceHash);
      expect(stored.every((r) => r.reviewState === 'PENDING')).toBe(true);
      const detail = await full.request('GET', `${BASE}/runs/${completed.id}`);
      expect(detail.status).toBe(200);
      expect(data(detail)).not.toHaveProperty('rawSnapshot');
      expect(data(detail)).not.toHaveProperty('leaseToken');
      expect(await unchangedBusiness()).toEqual(baseline);
    });

    it('ING-02: repeated and concurrent requests create one run/outbox and changed payload conflicts', async () => {
      const src = await source();
      const key = randomUUID();
      const body = { sourceId: src.id, expectedSourceVersion: 1 };
      const results = await Promise.all([
        full.write('POST', `${BASE}/runs`, body, key),
        full.write('POST', `${BASE}/runs`, body, key),
      ]);
      expect(results.map((x) => x.status)).toEqual([201, 201]);
      expect(results[0]?.body).toEqual(results[1]?.body);
      const id = String(data(results[0]!).id);
      expect(await owner.ingestionRun.count({ where: { id } })).toBe(1);
      expect(await owner.ingestionOutbox.count({ where: { runId: id } })).toBe(
        1,
      );
      const changed = await full.write(
        'POST',
        `${BASE}/runs`,
        { ...body, expectedSourceVersion: 2 },
        key,
      );
      expect(changed.status).toBe(409);
      expect(changed.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      await finish(id);
      expect(
        (await full.write('POST', `${BASE}/runs`, body, key)).body,
      ).toEqual(results[0]?.body);
    });

    it('ING-03: current RBAC, CSRF and strict source schema fail closed', async () => {
      const src = await source();
      const invalidPatch = await full.write(
        'PATCH',
        `${BASE}/sources/${src.id}`,
        {
          expectedVersion: 1,
          state: 'ENABLED',
          maxRows: null,
        },
      );
      expect(invalidPatch.status).toBe(400);
      expect(
        (
          await owner.ingestionSource.findUniqueOrThrow({
            where: { id: String(src.id) },
          })
        ).version,
      ).toBe(1);
      const noPermission = await actor([], 'denied');
      expect(
        (
          await noPermission.write('POST', `${BASE}/runs`, {
            sourceId: src.id,
            expectedSourceVersion: 1,
          })
        ).status,
      ).toBe(403);
      const readOnly = await actor(['ingestion.read'], 'reader');
      expect((await readOnly.request('GET', `${BASE}/sources`)).status).toBe(
        200,
      );
      expect(
        (
          await readOnly.write('POST', `${BASE}/runs`, {
            sourceId: src.id,
            expectedSourceVersion: 1,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await full.request(
            'POST',
            `${BASE}/runs`,
            { sourceId: src.id, expectedSourceVersion: 1 },
            randomUUID(),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await full.write('POST', `${BASE}/runs`, {
            sourceId: src.id,
            expectedSourceVersion: 1,
            actorId: randomUUID(),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await full.write('POST', `${BASE}/sources`, {
            supplierId,
            adapterVersion: 'http-fetch/1',
            fixtureKey: '../../etc/passwd',
            maxRows: 100,
            maxAttempts: 3,
            timeoutMs: 10000,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await full.write('POST', `${BASE}/runs`, {
            sourceId: randomUUID(),
            expectedSourceVersion: 1,
          })
        ).status,
      ).toBe(404);
    });

    it('ING-12: PostgreSQL rejects missing provenance and malformed candidate evidence', async () => {
      const created = await run(String((await source('mixed-v1')).id));
      const id = String(created.id);
      await expect(
        owner.ingestionRun.update({
          where: { id },
          data: { rawSnapshot: new Uint8Array([1]), sourceHash: null },
        }),
      ).rejects.toThrow();
      const completed = await finish(id);
      const rows = await owner.ingestionRow.findMany({ where: { runId: id } });
      const failed = rows.find((row) => row.errorCode)!;
      await expect(
        owner.ingestionDecision.create({
          data: {
            id: randomUUID(),
            rowId: failed.id,
            actorId: completed.actorId,
            decision: 'ACCEPT',
            reason: 'TEST',
          },
        }),
      ).rejects.toThrow();
      await expect(
        owner.ingestionRow.create({
          data: {
            id: 'a'.repeat(64),
            runId: id,
            rowNumber: 99,
            sourceHash: completed.sourceHash!,
            normalized: { offer_name: 'TEST' },
            warnings: [],
            reviewState: 'PENDING',
          },
        }),
      ).rejects.toThrow();
      expect(await owner.ingestionRow.count({ where: { runId: id } })).toBe(3);
    });

    it('ING-04: partial row errors remain explicit and single review is OCC/idempotent with immutable history', async () => {
      const src = await source('mixed-v1');
      const created = await run(String(src.id));
      const completed = await finish(String(created.id));
      expect(completed.state).toBe('PARTIAL');
      expect(completed.processed).toBe(3);
      expect(completed.candidateCount).toBe(2);
      expect(completed.errorCount).toBe(1);
      const rows = await owner.ingestionRow.findMany({
        where: { runId: completed.id },
        orderBy: { rowNumber: 'asc' },
      });
      const valid = rows.find((r) => r.errorCode === null)!;
      const invalid = rows.find((r) => r.errorCode !== null)!;
      const key = randomUUID();
      const decision = {
        expectedVersion: valid.version,
        decision: 'ACCEPT',
        reason: 'TEST human verification only',
      };
      const first = await full.write(
        'POST',
        `${BASE}/rows/${valid.id}/decision`,
        decision,
        key,
      );
      expect([200, 201]).toContain(first.status);
      expect(
        (
          await full.write(
            'POST',
            `${BASE}/rows/${valid.id}/decision`,
            decision,
            key,
          )
        ).body,
      ).toEqual(first.body);
      expect(
        await owner.ingestionDecision.count({ where: { rowId: valid.id } }),
      ).toBe(1);
      expect(
        (
          await full.write(
            'POST',
            `${BASE}/rows/${valid.id}/decision`,
            decision,
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await full.write('POST', `${BASE}/rows/${invalid.id}/decision`, {
            ...decision,
            expectedVersion: invalid.version,
          })
        ).status,
      ).toBe(409);
      const history = await full.request(
        'GET',
        `${BASE}/rows/${valid.id}/decisions`,
      );
      expect(history.status).toBe(200);
      expect(history.body.data).toBeInstanceOf(Array);
      const runOnly = await actor(['ingestion.run'], 'run-only');
      expect(
        (
          await runOnly.write(
            'POST',
            `${BASE}/rows/${valid.id}/decision`,
            decision,
          )
        ).status,
      ).toBe(403);
      expect(await unchangedBusiness()).toEqual(baseline);
      expect(
        await owner.auditEvent.count({
          where: {
            action: 'ingestion.row.decided',
            changes: { path: ['rowId'], equals: valid.id },
          },
        }),
      ).toBeGreaterThan(0);
    });

    it('ING-05: disabling an already queued source and unknown source versions block processing', async () => {
      const src = await source();
      const created = await run(String(src.id));
      const disabled = await full.write('PATCH', `${BASE}/sources/${src.id}`, {
        expectedVersion: 1,
        state: 'DISABLED',
      });
      expect(disabled.status).toBe(200);
      expect(
        (
          await full.write('POST', `${BASE}/runs`, {
            sourceId: src.id,
            expectedSourceVersion: 2,
          })
        ).status,
      ).toBe(409);
      expect((await finish(String(created.id))).state).toBe('FAILED');
      expect(
        await owner.ingestionRow.count({
          where: { runId: String(created.id) },
        }),
      ).toBe(0);
      expect(
        await owner.ingestionSourceRevision.count({
          where: { sourceId: String(src.id) },
        }),
      ).toBe(2);
    });

    it('ING-06: competing workers have one lease; stale lease cannot renew or commit after takeover', async () => {
      const created = await run(String((await source()).id));
      const id = String(created.id);
      const claims = await Promise.all([worker.claim(id), worker.claim(id)]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const stale = claims.find(Boolean)!;
      expect(stale.leaseToken).toBeTruthy();
      expect(await worker.heartbeat(id, stale.leaseToken!)).toBe(true);
      await owner.ingestionRun.update({
        where: { id },
        data: { leaseUntil: new Date(0) },
      });
      const current = await worker.claim(id);
      expect(current?.leaseToken).not.toBe(stale.leaseToken);
      expect(await worker.heartbeat(id, stale.leaseToken!)).toBe(false);
      await worker.process(stale).catch(() => undefined);
      expect(await owner.ingestionRow.count({ where: { runId: id } })).toBe(0);
      await worker.process(current!);
      expect(
        (await owner.ingestionRun.findUniqueOrThrow({ where: { id } })).state,
      ).toBe('COMPLETE');
      expect(await owner.ingestionRow.count({ where: { runId: id } })).toBe(2);
    });

    it('ING-07: real worker process exits after durable claim; later delivery resumes without duplicate rows', async () => {
      const created = await run(String((await source()).id));
      const id = String(created.id);
      const file = resolve('apps/api/test/fixtures/ingestion-claim-crash.ts');
      const child = spawn(process.execPath, ['--import', 'tsx', file, id], {
        cwd: resolve('apps/api'),
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (c) => {
        output += String(c);
      });
      child.stderr.on('data', (c) => {
        output += String(c);
      });
      const code = await new Promise<number | null>((accept, reject) => {
        child.once('error', reject);
        child.once('close', accept);
      });
      expect(code, output).toBe(91);
      const claimed = await owner.ingestionRun.findUniqueOrThrow({
        where: { id },
      });
      expect(claimed.state).toBe('RUNNING');
      expect(claimed.attempts).toBe(1);
      await owner.ingestionRun.update({
        where: { id },
        data: { leaseUntil: new Date(0) },
      });
      const completed = await finish(id);
      expect(completed.state).toBe('COMPLETE');
      expect(completed.attempts).toBe(2);
      expect(await owner.ingestionRow.count({ where: { runId: id } })).toBe(2);
    }, 30000);

    it('ING-08: Redis restart and lost wake-ups are repaired from PostgreSQL outbox', async () => {
      const created = await run(String((await source()).id));
      const id = String(created.id);
      await redis.lpush(QUEUE, id);
      await ownedCompose(['restart', 'redis']);
      await redis.connect().catch(() => undefined);
      for (let i = 0; i < 30; i++) {
        try {
          if ((await redis.ping()) === 'PONG') break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      await redis.flushdb();
      expect(await redis.llen(QUEUE)).toBe(0);
      const completed = await finish(id);
      expect(completed.state).toBe('COMPLETE');
      await redis.lpush(QUEUE, id, id);
      await worker.tick();
      await worker.tick();
      expect(await owner.ingestionRow.count({ where: { runId: id } })).toBe(2);
    }, 60000);

    it('ING-09: PostgreSQL postmaster restart preserves queued jobs, snapshots and staging', async () => {
      const created = await run(String((await source()).id));
      const id = String(created.id);
      await ownedCompose(['restart', 'postgres']);
      await ownedCompose(['up', '-d', '--wait', '--no-recreate', 'postgres']);
      await owner.$disconnect();
      await database.$disconnect();
      await owner.$connect();
      await database.$connect();
      expect(
        (await owner.ingestionRun.findUniqueOrThrow({ where: { id } })).state,
      ).toBe('QUEUED');
      expect((await finish(id)).state).toBe('COMPLETE');
      expect(await unchangedBusiness()).toEqual(baseline);
    }, 60000);

    it('ING-10: lost reply after a real successful completion COMMIT resolves to one terminal result', async () => {
      const created = await run(String((await source()).id));
      const id = String(created.id);
      const claimed = await worker.claim(id);
      expect(claimed).toBeTruthy();
      const original = database.$transaction.bind(database);
      let lost = false;
      const replacement = async (...args: unknown[]) => {
        const result: unknown = await Reflect.apply(original, database, args);
        const current = await owner.ingestionRun.findUniqueOrThrow({
          where: { id },
        });
        if (!lost && current.state === 'COMPLETE') {
          lost = true;
          throw new Error('TEST dropped successful COMMIT acknowledgement');
        }
        return result;
      };
      const spy = vi
        .spyOn(database, '$transaction')
        .mockImplementation(replacement as typeof database.$transaction);
      try {
        await worker.process(claimed!).catch(() => undefined);
      } finally {
        spy.mockRestore();
      }
      expect(lost).toBe(true);
      expect(
        (await owner.ingestionRun.findUniqueOrThrow({ where: { id } })).state,
      ).toBe('COMPLETE');
      await redis.lpush(QUEUE, id);
      await worker.tick();
      expect(await owner.ingestionRow.count({ where: { runId: id } })).toBe(2);
      expect(
        await owner.auditEvent.count({
          where: { action: 'ingestion.run.completed', entityId: id },
        }),
      ).toBe(1);
    });

    it('ING-11: bounded attempts stop expired jobs and audit/log data excludes raw offer and secret contents', async () => {
      const created = await run(
        String((await source('offers-v1', { maxAttempts: 1 })).id),
      );
      const id = String(created.id);
      expect(await worker.claim(id)).toBeTruthy();
      await owner.ingestionRun.update({
        where: { id },
        data: { leaseUntil: new Date(0) },
      });
      expect((await finish(id)).state).toBe('FAILED');
      const audit = await owner.auditEvent.findMany({
        where: { action: { startsWith: 'ingestion.' } },
      });
      expect(audit.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(audit);
      expect(serialized).not.toContain(process.env.SUPPLIER_INGESTION_TOKEN!);
      expect(serialized).not.toContain('TEST-CTRL-001');
      expect(serialized).not.toContain('rawSnapshot');
      expect(await unchangedBusiness()).toEqual(baseline);
    });
  },
);
