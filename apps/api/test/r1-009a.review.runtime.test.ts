import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createApiApp } from '../src/app.factory.js';
import { IdentityCrypto } from '../src/identity/crypto.js';
import {
  DATABASE,
  type PrismaDatabase,
} from '../src/database/database.module.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';
import { SupplierIngestionWorker } from '../src/supplier-ingestion/supplier-ingestion.worker.js';

type Json = Record<string, unknown>;
type Result = { status: number; body: Json };
const enabled =
  process.env.R1_008B_TEST_ENABLED === 'true' &&
  process.env.R1_009A_TEST_ENABLED === 'true';
const ORIGIN = process.env.R1_009A_WEB_ORIGIN ?? 'http://127.0.0.1:3000';
const BASE = '/v1/staff/ingestion';
const permissions = [
  'ingestion.read',
  'ingestion.sources.write',
  'ingestion.run',
  'ingestion.review',
  'suppliers.read',
  'suppliers.write',
  'suppliers.offers.read',
  'suppliers.offers.write',
];
let owner: PrismaClient;
let database: PrismaDatabase;
let app: Awaited<ReturnType<typeof createApiApp>>;
let worker: SupplierIngestionWorker;
let api = '';
let full: Agent;
let supplierId = '';
let products = 0;
let matches = 0;

function data(result: Result): Json {
  expect(result.body.data).toBeTypeOf('object');
  return result.body.data as Json;
}

class Agent {
  cookies = new Map<string, string>();
  userId = '';

  async request(
    method: string,
    path: string,
    body?: unknown,
    key?: string,
    csrf?: string,
  ): Promise<Result> {
    const headers = new Headers({
      Origin: ORIGIN,
      Accept: 'application/json',
      'X-Forwarded-Proto': 'https',
    });
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
    const result = await this.request('GET', '/v1/staff/auth/csrf');
    expect(result.status).toBe(200);
    return String(data(result).token);
  }

  async write(method: string, path: string, body: unknown, key = randomUUID()) {
    return this.request(method, path, body, key, await this.csrf());
  }
}

async function actor(codes: string[], label: string) {
  const id = randomUUID();
  const email = `TEST-r1-009a-${label}-${id}@example.invalid`;
  const password = `TEST R1-009A ${randomBytes(24).toString('base64url')}!`;
  const passwordHash = await new IdentityCrypto().hashPassword(password, email);
  await owner.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        id: randomUUID(),
        code: `test-review-${id}`,
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
  agent.userId = id;
  const result = await agent.request(
    'POST',
    '/v1/staff/auth/login',
    { email, password },
    undefined,
    await agent.csrf(),
  );
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return agent;
}

function offerFields(overrides: Json = {}) {
  return {
    brandId: null,
    manufacturerName: 'TEST Instruments',
    originalPartNumber: 'TEST-CTRL-001',
    modification: 'A',
    modificationEvidence: 'SPECIFIED',
    supplierPartNumber: 'TEST-0001',
    sourceBrandText: 'TEST Instruments',
    offerName: 'TEST manually verified offer name',
    purchaseCost: '1000',
    currency: 'RUB',
    sourceVatText: 'TEST previous tax text',
    availabilityText: 'TEST previous availability',
    leadTimeText: 'TEST preserve this delivery window',
    sourceObservedAt: '2025-11-07T00:00:00.000Z',
    expiresAt: '2026-01-01T00:00:00.000Z',
    sourceUrl: 'https://mock.invalid/offers/previous',
    ...overrides,
  };
}

async function createOffer(overrides: Json = {}) {
  const result = await full.write('POST', '/v1/staff/supplier-offers', {
    supplierId,
    ...offerFields(overrides),
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return data(result);
}

async function stage(fixtureKey = 'offers-v1', selectedSupplier = supplierId) {
  const created = await full.write('POST', `${BASE}/sources`, {
    supplierId: selectedSupplier,
    adapterVersion: 'fixture-json/1',
    fixtureKey,
    maxRows: 100,
    maxAttempts: 3,
    timeoutMs: 10000,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const sourceId = String(data(created).id);
  const requested = await full.write('POST', `${BASE}/runs`, {
    sourceId,
    expectedSourceVersion: 1,
  });
  expect(requested.status, JSON.stringify(requested.body)).toBe(201);
  const runId = String(data(requested).id);
  for (let index = 0; index < 40; index++) {
    await worker.tick();
    const current = await owner.ingestionRun.findUniqueOrThrow({
      where: { id: runId },
    });
    if (['COMPLETE', 'PARTIAL', 'FAILED'].includes(current.state)) {
      expect(['COMPLETE', 'PARTIAL']).toContain(current.state);
      const rows = await owner.ingestionRow.findMany({
        where: { runId },
        orderBy: { rowNumber: 'asc' },
      });
      return { sourceId, runId, rows };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('TEST ingestion did not finish within its bounded wait.');
}

async function decide(rowId: string, decision = 'ACCEPT') {
  const result = await full.write('POST', `${BASE}/rows/${rowId}/decision`, {
    expectedVersion: 1,
    decision,
    reason: `TEST individual ${decision} after source review`,
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return data(result);
}

async function preview(rowId: string, offerId: string, agent = full) {
  const result = await agent.request(
    'GET',
    `${BASE}/rows/${rowId}/preview?offerId=${offerId}`,
  );
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return data(result);
}

function applyInput(offer: Json, decision: Json, expectedRowVersion = 2) {
  return {
    offerId: offer.id,
    expectedRowVersion,
    expectedOfferVersion: offer.version,
    expectedOfferRevisionId: offer.revisionId,
    decisionId: decision.id,
  };
}

describe.skipIf(!enabled)(
  'R1-009A isolated supplier review and intentional manual application',
  () => {
    beforeAll(async () => {
      owner = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: process.env.MIGRATION_DATABASE_URL!,
        }),
      });
      await owner.$connect();
      const identity = await owner.$queryRaw<{ name: string }[]>`
        SELECT current_database() AS name
      `;
      expect(identity[0]?.name).toBe('stdu_r1_008b_test');
      app = await createApiApp();
      await app.listen(0, '127.0.0.1');
      api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
      database = app.get<PrismaDatabase>(DATABASE);
      worker = app.get(SupplierIngestionWorker);
      full = await actor(permissions, 'full');
      const supplier = await full.write('POST', '/v1/staff/suppliers', {
        legalName: 'TEST R1-009A synthetic supplier',
      });
      expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
      supplierId = String(data(supplier).id);
      products = await owner.catalogProduct.count();
      matches = await owner.productMatchProposal.count();
    }, 60000);

    afterAll(async () => {
      vi.restoreAllMocks();
      if (owner) {
        expect(await owner.catalogProduct.count()).toBe(products);
        expect(await owner.productMatchProposal.count()).toBe(matches);
      }
      await app?.close();
      await owner?.$disconnect();
    });

    it('REV-01: authentication, separate write permission and CSRF protect preview and APPLY', async () => {
      const { rows } = await stage();
      const row = rows[0]!;
      const offer = await createOffer();
      const decision = await decide(row.id);
      const input = applyInput(offer, decision);
      const anonymous = new Agent();
      expect(
        (
          await anonymous.request(
            'GET',
            `${BASE}/rows/${row.id}/preview?offerId=${offer.id}`,
          )
        ).status,
      ).toBe(401);
      expect(
        (await anonymous.write('POST', `${BASE}/rows/${row.id}/apply`, input))
          .status,
      ).toBe(401);
      const reviewer = await actor(
        permissions.filter((code) => code !== 'suppliers.offers.write'),
        'review-only',
      );
      expect(
        (await reviewer.write('POST', `${BASE}/rows/${row.id}/apply`, input))
          .status,
      ).toBe(403);
      expect(
        (
          await full.request(
            'POST',
            `${BASE}/rows/${row.id}/apply`,
            input,
            randomUUID(),
          )
        ).status,
      ).toBe(403);
      expect(
        await owner.supplierOfferRevision.count({
          where: { offerId: String(offer.id) },
        }),
      ).toBe(1);
    });

    it('REV-02: ACCEPT alone does not write; explicit APPLY appends one immutable revision and provenance', async () => {
      const { rows, runId, sourceId } = await stage();
      const row = rows[0]!;
      const offer = await createOffer();
      const before = await owner.supplierOfferRevision.findUniqueOrThrow({
        where: { id: String(offer.revisionId) },
      });
      const decision = await decide(row.id);
      expect(
        await owner.supplierOfferRevision.count({
          where: { offerId: String(offer.id) },
        }),
      ).toBe(1);
      const comparison = await preview(row.id, String(offer.id));
      expect(comparison.eligible).toBe(true);
      expect(comparison.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'purchaseCost', state: 'CHANGED' }),
          expect.objectContaining({ field: 'leadTimeText', state: 'MISSING' }),
        ]),
      );
      const applied = await full.write(
        'POST',
        `${BASE}/rows/${row.id}/apply`,
        applyInput(offer, decision),
      );
      expect(applied.status, JSON.stringify(applied.body)).toBe(200);
      const result = data(applied);
      const current = await owner.supplierOffer.findUniqueOrThrow({
        where: { id: String(offer.id) },
        include: { currentRevision: true },
      });
      expect(current.version).toBe(2);
      expect(current.currentRevisionId).toBe(result.revisionId);
      expect(current.currentRevision.purchaseCost?.toString()).toBe('1250');
      expect(current.currentRevision.currency).toBe('RUB');
      expect(current.currentRevision.leadTimeText).toBe(before.leadTimeText);
      expect(current.currentRevision.expiresAt).toEqual(before.expiresAt);
      expect(current.currentRevision.offerName).toBe(before.offerName);
      expect(current.currentRevision.brandId).toBe(before.brandId);
      expect(current.currentRevision.manufacturerName).toBe(
        before.manufacturerName,
      );
      expect(current.currentRevision.originalPartNumber).toBe(
        before.originalPartNumber,
      );
      expect(current.currentRevision.origin).toBe('MANUAL');
      expect(
        await owner.supplierOfferRevision.findUniqueOrThrow({
          where: { id: before.id },
        }),
      ).toEqual(before);
      const provenance = await owner.ingestionApplication.findUniqueOrThrow({
        where: { rowId: row.id },
      });
      expect(provenance).toMatchObject({
        sourceId,
        runId,
        rowId: row.id,
        decisionId: decision.id,
        actorId: full.userId,
        offerId: offer.id,
        revisionId: result.revisionId,
        baseRevisionId: before.id,
      });
      const history = await full.request(
        'GET',
        `${BASE}/rows/${row.id}/applications`,
      );
      expect(history.status).toBe(200);
      expect(history.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rowId: row.id,
            revisionId: result.revisionId,
          }),
        ]),
      );
      const detail = await full.request(
        'GET',
        `/v1/staff/supplier-offers/${offer.id}`,
      );
      expect(data(detail).freshness).toBe('STALE');
      await expect(
        owner.$executeRaw`UPDATE ingestion_application SET actor_id = ${full.userId}::uuid WHERE row_id = ${row.id}`,
      ).rejects.toThrow();
      await expect(
        owner.$executeRaw`DELETE FROM ingestion_application WHERE row_id = ${row.id}`,
      ).rejects.toThrow();
    });

    it('REV-03: rejected and error rows cannot APPLY or create revisions', async () => {
      const { rows } = await stage('mixed-v1');
      const offer = await createOffer();
      const rejected = await decide(rows[0]!.id, 'REJECT');
      const rejectResult = await full.write(
        'POST',
        `${BASE}/rows/${rows[0]!.id}/apply`,
        applyInput(offer, rejected),
      );
      expect(rejectResult.status).toBe(409);
      const invalidAccept = await full.write(
        'POST',
        `${BASE}/rows/${rows[1]!.id}/decision`,
        {
          expectedVersion: 1,
          decision: 'ACCEPT',
          reason: 'TEST error must not be accepted',
        },
      );
      expect(invalidAccept.status).toBe(409);
      const errorResult = await full.write(
        'POST',
        `${BASE}/rows/${rows[1]!.id}/apply`,
        applyInput(offer, { id: randomUUID() }, 1),
      );
      expect(errorResult.status).toBe(409);
      expect(
        await owner.supplierOfferRevision.count({
          where: { offerId: String(offer.id) },
        }),
      ).toBe(1);
    });

    it('REV-04: concurrent identical APPLY, retry and key misuse create exactly one application', async () => {
      const { rows } = await stage();
      const offer = await createOffer();
      const row = rows[0]!;
      const decision = await decide(row.id);
      const input = applyInput(offer, decision);
      const key = randomUUID();
      const csrf = await full.csrf();
      const responses = await Promise.all([
        full.request('POST', `${BASE}/rows/${row.id}/apply`, input, key, csrf),
        full.request('POST', `${BASE}/rows/${row.id}/apply`, input, key, csrf),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      expect(responses[0]!.body).toEqual(responses[1]!.body);
      const retry = await full.write(
        'POST',
        `${BASE}/rows/${row.id}/apply`,
        input,
        key,
      );
      expect(retry.body).toEqual(responses[0]!.body);
      const reused = await full.write(
        'POST',
        `${BASE}/rows/${row.id}/apply`,
        { ...input, expectedOfferVersion: 2 },
        key,
      );
      expect(reused.status).toBe(409);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(
        await owner.ingestionApplication.count({ where: { rowId: row.id } }),
      ).toBe(1);
      expect(
        await owner.supplierOfferRevision.count({
          where: { offerId: String(offer.id) },
        }),
      ).toBe(2);
    });

    it('REV-05: two independently accepted rows cannot race over one expected offer revision', async () => {
      const [first, second] = await Promise.all([stage(), stage()]);
      const offer = await createOffer();
      const rowA = first.rows[0]!;
      const rowB = second.rows[0]!;
      const decisionA = await decide(rowA.id);
      const decisionB = await decide(rowB.id);
      const csrf = await full.csrf();
      const responses = await Promise.all([
        full.request(
          'POST',
          `${BASE}/rows/${rowA.id}/apply`,
          applyInput(offer, decisionA),
          randomUUID(),
          csrf,
        ),
        full.request(
          'POST',
          `${BASE}/rows/${rowB.id}/apply`,
          applyInput(offer, decisionB),
          randomUUID(),
          csrf,
        ),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(responses.find((r) => r.status === 409)?.body.code).toBe(
        'VERSION_CONFLICT',
      );
      expect(
        await owner.ingestionApplication.count({
          where: { rowId: { in: [rowA.id, rowB.id] } },
        }),
      ).toBe(1);
      expect(
        await owner.supplierOfferRevision.count({
          where: { offerId: String(offer.id) },
        }),
      ).toBe(2);
    });

    it('REV-06: changing an offer after preview returns durable VERSION_CONFLICT until explicit refresh', async () => {
      const { rows } = await stage();
      const row = rows[0]!;
      const offer = await createOffer();
      const decision = await decide(row.id);
      expect((await preview(row.id, String(offer.id))).eligible).toBe(true);
      const changed = await full.write(
        'PATCH',
        `/v1/staff/supplier-offers/${offer.id}`,
        {
          ...offerFields({ purchaseCost: '1100' }),
          expectedVersion: 1,
        },
      );
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      const key = randomUUID();
      const conflict = await full.write(
        'POST',
        `${BASE}/rows/${row.id}/apply`,
        applyInput(offer, decision),
        key,
      );
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('VERSION_CONFLICT');
      const repeat = await full.write(
        'POST',
        `${BASE}/rows/${row.id}/apply`,
        applyInput(offer, decision),
        key,
      );
      expect(repeat.body).toEqual(conflict.body);
      expect(
        await owner.ingestionApplication.count({ where: { rowId: row.id } }),
      ).toBe(0);
      const refreshed = await preview(row.id, String(offer.id));
      expect((refreshed.offer as Json).version).toBe(2);
      const applied = await full.write(
        'POST',
        `${BASE}/rows/${row.id}/apply`,
        applyInput(data(changed), decision),
      );
      expect(applied.status, JSON.stringify(applied.body)).toBe(200);
      expect(
        await owner.supplierOfferRevision.count({
          where: { offerId: String(offer.id) },
        }),
      ).toBe(3);
    });

    it('REV-07: cross-supplier, incomplete identity and unrelated decision identifiers are rejected', async () => {
      const { rows } = await stage();
      const row = rows[0]!;
      const other = await full.write('POST', '/v1/staff/suppliers', {
        legalName: 'TEST other supplier',
      });
      expect(other.status).toBe(201);
      const offer = await createOffer({ supplierId: data(other).id });
      const decision = await decide(row.id);
      expect((await preview(row.id, String(offer.id))).eligible).toBe(false);
      expect(
        (
          await full.write(
            'POST',
            `${BASE}/rows/${row.id}/apply`,
            applyInput(offer, decision),
          )
        ).status,
      ).toBe(409);
      const ownOffer = await createOffer();
      expect(
        (
          await full.write(
            'POST',
            `${BASE}/rows/${row.id}/apply`,
            applyInput(ownOffer, { id: randomUUID() }),
          )
        ).status,
      ).toBe(409);
      const incompleteDecision = await decide(rows[1]!.id);
      expect((await preview(rows[1]!.id, String(ownOffer.id))).eligible).toBe(
        false,
      );
      expect(
        (
          await full.write(
            'POST',
            `${BASE}/rows/${rows[1]!.id}/apply`,
            applyInput(ownOffer, incompleteDecision),
          )
        ).status,
      ).toBe(409);
      expect(
        await owner.supplierOfferRevision.count({
          where: { offerId: String(ownOffer.id) },
        }),
      ).toBe(1);
    });

    it('REV-08: a lost acknowledgement after real COMMIT replays the original result without a second revision', async () => {
      const { rows } = await stage();
      const row = rows[0]!;
      const offer = await createOffer();
      const decision = await decide(row.id);
      const input = applyInput(offer, decision);
      const key = randomUUID();
      const original = database.$transaction.bind(database);
      let lost = false;
      const replacement = async (...args: unknown[]) => {
        const result: unknown = await Reflect.apply(original, database, args);
        if (
          !lost &&
          (await owner.ingestionApplication.findUnique({
            where: { rowId: row.id },
          }))
        ) {
          lost = true;
          throw new Error(
            'TEST lost successful application COMMIT acknowledgement',
          );
        }
        return result;
      };
      const spy = vi
        .spyOn(database, '$transaction')
        .mockImplementation(replacement as typeof database.$transaction);
      try {
        const first = await full.write(
          'POST',
          `${BASE}/rows/${row.id}/apply`,
          input,
          key,
        );
        expect(first.status).toBe(500);
        expect(JSON.stringify(first.body)).not.toContain(
          'COMMIT acknowledgement',
        );
      } finally {
        spy.mockRestore();
      }
      expect(lost).toBe(true);
      const replay = await full.write(
        'POST',
        `${BASE}/rows/${row.id}/apply`,
        input,
        key,
      );
      expect(replay.status, JSON.stringify(replay.body)).toBe(200);
      const application = await owner.ingestionApplication.findUniqueOrThrow({
        where: { rowId: row.id },
      });
      expect(data(replay).revisionId).toBe(application.revisionId);
      expect(
        await owner.supplierOfferRevision.count({
          where: { offerId: String(offer.id) },
        }),
      ).toBe(2);
    });

    it('REV-09: staff freshness uses explicit expiry and existing unknown policy without inventing facts', async () => {
      for (const [expiresAt, expected] of [
        ['2099-01-01T00:00:00.000Z', 'CURRENT'],
        ['2000-01-01T00:00:00.000Z', 'STALE'],
        [null, 'UNKNOWN'],
      ]) {
        const offer = await createOffer({ expiresAt });
        const detail = await full.request(
          'GET',
          `/v1/staff/supplier-offers/${offer.id}`,
        );
        expect(detail.status).toBe(200);
        expect(data(detail).freshness).toBe(expected);
      }
    });

    it('REV-10: revoking offer write permission denies replay of an already committed application', async () => {
      const { rows } = await stage();
      const row = rows[0]!;
      const offer = await createOffer();
      const decision = await decide(row.id);
      const operator = await actor(permissions, 'revoked');
      const input = applyInput(offer, decision);
      const key = randomUUID();
      const applied = await operator.write(
        'POST',
        `${BASE}/rows/${row.id}/apply`,
        input,
        key,
      );
      expect(applied.status, JSON.stringify(applied.body)).toBe(200);
      const role = await owner.userRole.findFirstOrThrow({
        where: { staffUserId: operator.userId },
      });
      const permission = await owner.permission.findUniqueOrThrow({
        where: { code: 'suppliers.offers.write' },
      });
      await owner.rolePermission.deleteMany({
        where: { roleId: role.roleId, permissionId: permission.id },
      });
      const replay = await operator.write(
        'POST',
        `${BASE}/rows/${row.id}/apply`,
        input,
        key,
      );
      expect(replay.status).toBe(403);
      expect(
        await owner.ingestionApplication.count({ where: { rowId: row.id } }),
      ).toBe(1);
      expect(
        await owner.supplierOfferRevision.count({
          where: { offerId: String(offer.id) },
        }),
      ).toBe(2);
    });

    it('REV-12: a concurrent update during preview cannot mix old values with new version tokens', async () => {
      const { rows } = await stage();
      const row = rows[0]!;
      const offer = await createOffer();
      const decision = await decide(row.id);
      const concurrent = await actor(permissions, 'preview-race');
      const suppliers = app.get(SuppliersService);
      const original = suppliers.getSupplierOfferInTransaction.bind(suppliers);
      const hook = vi
        .spyOn(suppliers, 'getSupplierOfferInTransaction')
        .mockImplementationOnce(async (...args) => {
          const changed = await concurrent.write(
            'PATCH',
            '/v1/staff/supplier-offers/' + offer.id,
            {
              ...offerFields({ purchaseCost: '1100' }),
              expectedVersion: 1,
            },
          );
          expect(changed.status, JSON.stringify(changed.body)).toBe(200);
          return original(...args);
        });
      let comparison: Json;
      try {
        comparison = await preview(row.id, String(offer.id));
      } finally {
        hook.mockRestore();
      }
      const savedOffer = comparison!.offer as Json;
      const revision = savedOffer.currentRevision as Json;
      expect(savedOffer.version).toBe(1);
      expect(revision.id).toBe(offer.revisionId);
      expect(revision.purchaseCost).toBe('1000');
      const fields = comparison!.fields as Json[];
      expect(
        fields.find((field) => field.field === 'purchaseCost')?.current,
      ).toBe('1000');
      const result = await full.write(
        'POST',
        BASE + '/rows/' + row.id + '/apply',
        applyInput(offer, decision),
      );
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('VERSION_CONFLICT');
      expect(
        await owner.ingestionApplication.count({ where: { rowId: row.id } }),
      ).toBe(0);
    });

    it('REV-11: real browser review reaches the same API and PostgreSQL staging on desktop and mobile', async () => {
      const { rows, runId } = await stage();
      const offer = await createOffer();
      const { reviewUiAcceptance } =
        await import('../../../scripts/r1-009a-ui-acceptance.mjs');
      await reviewUiAcceptance({
        api,
        cookies: [...full.cookies],
        runId,
        rowId: rows[0]!.id,
        offerId: String(offer.id),
      });
      const applied = await owner.ingestionApplication.findUniqueOrThrow({
        where: { rowId: rows[0]!.id },
      });
      expect(applied.offerId).toBe(offer.id);
      expect(
        await owner.supplierOfferRevision.count({
          where: { offerId: String(offer.id) },
        }),
      ).toBe(2);
    }, 120000);
  },
);
