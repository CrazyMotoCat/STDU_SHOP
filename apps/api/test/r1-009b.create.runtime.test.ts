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
import { SupplierIngestionWorker } from '../src/supplier-ingestion/supplier-ingestion.worker.js';

type Json = Record<string, unknown>;
type Result = { status: number; body: Json };
const enabled =
  process.env.R1_008B_TEST_ENABLED === 'true' &&
  process.env.R1_009B_CREATE_TEST_ENABLED === 'true';
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
  'ingestion.createOffer',
];
let owner: PrismaClient;
let database: PrismaDatabase;
let app: Awaited<ReturnType<typeof createApiApp>>;
let worker: SupplierIngestionWorker;
let api = '';
let full: Agent;
let brandId = '';

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
  const email = `TEST-r1-009b-${label}-${id}@example.invalid`;
  const password = `TEST R1-009B ${randomBytes(24).toString('base64url')}!`;
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

async function stage(fixtureKey: string, selectedSupplier: string) {
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

async function addSupplier() {
  const response = await full.write('POST', '/v1/staff/suppliers', {
    legalName: 'TEST R1-009B synthetic supplier ' + randomUUID(),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return String(data(response).id);
}

async function startApp() {
  app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  database = app.get<PrismaDatabase>(DATABASE);
  worker = app.get(SupplierIngestionWorker);
}

function path(rowId: string, operation = 'create') {
  return `${BASE}/rows/${rowId}/${operation}`;
}

async function staged(fixtureKey = 'offers-v1', rowIndex = 0) {
  const selectedSupplier = await addSupplier();
  const result = await stage(fixtureKey, selectedSupplier);
  return { ...result, row: result.rows[rowIndex]!, selectedSupplier };
}

async function accepted(fixtureKey?: string, rowIndex?: number) {
  const fixture = await staged(fixtureKey, rowIndex);
  const decision = await decide(fixture.row.id);
  const previewInput = {
    supplierId: fixture.selectedSupplier,
    brandId,
    decisionId: String(decision.id),
    expectedRowVersion: 2,
  };
  return { ...fixture, previewInput };
}

async function confirmed(
  fixture: Awaited<ReturnType<typeof accepted>>,
  employee = full,
) {
  const response = await employee.write(
    'POST',
    path(fixture.row.id, 'create-preview'),
    fixture.previewInput,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const preview = data(response);
  expect(preview.eligible, JSON.stringify(preview)).toBe(true);
  expect(preview.previewToken).toBeTypeOf('string');
  return {
    ...fixture.previewInput,
    previewToken: preview.previewToken,
    identityConfirmed: true,
    acknowledgedDuplicateIds: [] as string[],
  };
}

async function counts(selectedSupplier: string) {
  return {
    offers: await owner.supplierOffer.count({
      where: { supplierId: selectedSupplier },
    }),
    revisions: await owner.supplierOfferRevision.count({
      where: { offer: { supplierId: selectedSupplier } },
    }),
    applications: await owner.ingestionApplication.count({
      where: { offer: { supplierId: selectedSupplier } },
    }),
    audit: await owner.auditEvent.count({
      where: {
        action: 'supplier_offer.created',
        changes: { path: ['supplierId'], equals: selectedSupplier },
      },
    }),
  };
}

describe.skipIf(!enabled)('CREATE-01 PostgreSQL staff service', () => {
  let initialProducts: number;
  let initialMatches: number;

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
    const permission = await owner.permission.findUniqueOrThrow({
      where: { code: 'ingestion.createOffer' },
    });
    expect(
      await owner.rolePermission.count({
        where: { permissionId: permission.id },
      }),
    ).toBe(0);
    brandId = (
      await owner.brand.create({
        data: {
          id: randomUUID(),
          slug: 'test-instruments',
          name: 'TEST Instruments',
          state: 'ACTIVE',
        },
      })
    ).id;
    initialProducts = await owner.catalogProduct.count();
    initialMatches = await owner.productMatchProposal.count();
    await startApp();
    full = await actor(permissions, 'create');
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      if (initialProducts !== undefined) {
        expect(await owner.catalogProduct.count()).toBe(initialProducts);
        expect(await owner.productMatchProposal.count()).toBe(initialMatches);
      }
    } finally {
      await app?.close();
      await owner?.$disconnect();
    }
  });

  it('creates an offer after separate Staff ACCEPT and CREATE actions at desktop and mobile widths', async () => {
    const fixture = await staged();
    const identity = {
      supplierId: fixture.selectedSupplier,
      brandId,
      manufacturerName: 'TEST Instruments',
      originalPartNumber: 'TEST-CTRL-001',
      modificationEvidence: 'SPECIFIED',
    };
    const archived = await full.write('POST', '/v1/staff/supplier-offers', {
      ...identity,
      modification: 'A',
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(201);
    const archive = await full.write(
      'POST',
      `/v1/staff/supplier-offers/${data(archived).id}/archive`,
      { expectedVersion: 1, reasonCode: 'TEST_ARCHIVE' },
    );
    expect(archive.status, JSON.stringify(archive.body)).toBe(200);
    const alternative = await full.write('POST', '/v1/staff/supplier-offers', {
      ...identity,
      modification: 'B',
      supplierPartNumber: 'TEST-OTHER',
    });
    expect(alternative.status, JSON.stringify(alternative.body)).toBe(201);
    const { reviewUiAcceptance } =
      await import('../../../scripts/r1-009a-ui-acceptance.mjs');
    await reviewUiAcceptance({
      api,
      cookies: [...full.cookies],
      runId: fixture.runId,
      rowId: fixture.row.id,
      brandId,
    });
    const application = await owner.ingestionApplication.findUniqueOrThrow({
      where: { rowId: fixture.row.id },
    });
    expect(application.operation).toBe('CREATE');
    expect(application.baseRevisionId).toBeNull();
    const offer = await owner.supplierOffer.findUniqueOrThrow({
      where: { id: application.offerId },
      include: { currentRevision: true },
    });
    expect(offer.currentRevision.id).toBe(application.revisionId);
    expect(offer.currentRevision.revisionNo).toBe(1);
    expect(offer.supplierId).toBe(fixture.selectedSupplier);
  }, 120000);
  it('ACCEPT alone creates nothing; CREATE writes one revision, audit, immutable provenance and receipt', async () => {
    const fixture = await accepted();
    expect(await counts(fixture.selectedSupplier)).toEqual({
      offers: 0,
      revisions: 0,
      applications: 0,
      audit: 0,
    });
    const input = await confirmed(fixture);
    const key = randomUUID();
    const response = await full.write('POST', path(fixture.row.id), input, key);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const application = await owner.ingestionApplication.findUniqueOrThrow({
      where: { rowId: fixture.row.id },
    });
    expect(application).toMatchObject({
      operation: 'CREATE',
      baseRevisionId: null,
      version: 1,
      decisionId: fixture.previewInput.decisionId,
      actorId: full.userId,
      runId: fixture.runId,
      sourceId: fixture.sourceId,
      sourceHash: fixture.row.sourceHash,
      revisionId: data(response).revisionId,
    });
    const offer = await owner.supplierOffer.findUniqueOrThrow({
      where: { id: application.offerId },
      include: { currentRevision: true },
    });
    expect(offer).toMatchObject({
      version: 1,
      supplierId: fixture.selectedSupplier,
      currentMatchProposalId: null,
      currentRevision: {
        revisionNo: 1,
        brandId,
        originalPartNumber: 'TEST-CTRL-001',
        origin: 'MANUAL',
      },
    });
    expect(await full.write('POST', path(fixture.row.id), input, key)).toEqual(
      response,
    );
    expect((await full.write('POST', path(fixture.row.id), input)).status).toBe(
      409,
    );
    expect(
      (
        await full.write(
          'POST',
          path(fixture.row.id),
          {
            ...input,
            acknowledgedDuplicateIds: [randomUUID()],
          },
          key,
        )
      ).body.code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await counts(fixture.selectedSupplier)).toEqual({
      offers: 1,
      revisions: 1,
      applications: 1,
      audit: 1,
    });
    await expect(
      owner.$executeRaw`DELETE FROM ingestion_application WHERE row_id=${fixture.row.id}`,
    ).rejects.toThrow();
    await expect(
      owner.$executeRaw`UPDATE ingestion_application SET version=2 WHERE row_id=${fixture.row.id}`,
    ).rejects.toThrow();
  });

  it('CREATE-disabled compatibility build preserves history and consumes the row for legacy routes', async () => {
    const fixture = await accepted();
    const input = await confirmed(fixture);
    const created = await full.write('POST', path(fixture.row.id), input);
    expect(created.status).toBe(201);
    const offerId = String(data(created).offerId);
    const revisionId = String(data(created).revisionId);
    const previous = process.env.SUPPLIER_INGESTION_CREATE_ENABLED;
    process.env.SUPPLIER_INGESTION_CREATE_ENABLED = 'false';
    await app.close();
    await startApp();
    try {
      expect(
        (await full.write('POST', path(fixture.row.id), input)).status,
      ).toBe(403);
      const preview = await full.request(
        'GET',
        path(fixture.row.id, 'preview') + '?offerId=' + offerId,
      );
      expect(preview.status).toBe(200);
      expect(data(preview)).toMatchObject({
        eligible: false,
        blockedReason: 'ALREADY_APPLIED',
        application: null,
      });
      const history = await full.request(
        'GET',
        path(fixture.row.id, 'applications'),
      );
      expect(history.status).toBe(200);
      expect(history.body.data).toEqual([]);
      const apply = await full.write('POST', path(fixture.row.id, 'apply'), {
        offerId,
        expectedRowVersion: 2,
        expectedOfferVersion: 1,
        expectedOfferRevisionId: revisionId,
        decisionId: fixture.previewInput.decisionId,
      });
      expect(apply.status).toBe(409);
      const provenance = await full.request(
        'GET',
        path(fixture.row.id, 'application-provenance'),
      );
      expect(data(provenance)).toMatchObject({
        operation: 'CREATE',
        revisionId,
        baseRevisionId: null,
      });
      expect((await counts(fixture.selectedSupplier)).offers).toBe(1);
    } finally {
      process.env.SUPPLIER_INGESTION_CREATE_ENABLED = previous;
      await app.close();
      await startApp();
    }
  });

  it('requires current permission, Origin/CSRF context, and correct supplier and row version', async () => {
    const fixture = await accepted();
    const input = await confirmed(fixture);
    const reader = await actor(
      permissions.filter((p) => p !== 'ingestion.createOffer'),
      'no-create',
    );
    expect(
      (
        await new Agent().request(
          'POST',
          path(fixture.row.id),
          input,
          randomUUID(),
        )
      ).status,
    ).toBe(401);
    expect(
      (await reader.write('POST', path(fixture.row.id), input)).status,
    ).toBe(403);
    expect(
      (await full.request('POST', path(fixture.row.id), input, randomUUID()))
        .status,
    ).toBe(403);
    expect(
      (
        await full.write('POST', path(fixture.row.id), {
          ...input,
          expectedRowVersion: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await full.write('POST', path(fixture.row.id), {
          ...input,
          supplierId: await addSupplier(),
        })
      ).status,
    ).toBe(409);
    expect((await counts(fixture.selectedSupplier)).offers).toBe(0);
  });

  it('rejected and incomplete identity candidates are ineligible', async () => {
    const rejected = await staged();
    const rejection = await decide(rejected.row.id, 'REJECT');
    const incomplete = await accepted('offers-v1', 1);
    for (const [fixture, previewInput] of [
      [
        rejected,
        {
          supplierId: rejected.selectedSupplier,
          brandId,
          decisionId: rejection.id,
          expectedRowVersion: 2,
        },
      ],
      [incomplete, incomplete.previewInput],
    ] as const) {
      const response = await full.write(
        'POST',
        path(fixture.row.id, 'create-preview'),
        previewInput,
      );
      if (response.status === 200) expect(data(response).eligible).toBe(false);
      else expect(response.status).toBe(409);
      expect((await counts(fixture.selectedSupplier)).offers).toBe(0);
    }
  });

  it('source disable, version change, or supplier archive invalidates a previously issued plan', async () => {
    for (const mode of ['DISABLED', 'VERSION', 'ARCHIVED']) {
      const fixture = await accepted();
      const input = await confirmed(fixture);
      if (mode === 'ARCHIVED') {
        const result = await full.write(
          'POST',
          `/v1/staff/suppliers/${fixture.selectedSupplier}/archive`,
          { expectedVersion: 1, reasonCode: 'DUPLICATE_ENTRY' },
        );
        expect(result.status, JSON.stringify(result.body)).toBe(200);
      } else {
        const result = await full.write(
          'PATCH',
          `${BASE}/sources/${fixture.sourceId}`,
          {
            expectedVersion: 1,
            state: mode === 'DISABLED' ? 'DISABLED' : 'ENABLED',
            maxRows: 50,
          },
        );
        expect(result.status, JSON.stringify(result.body)).toBe(200);
      }
      expect(
        (await full.write('POST', path(fixture.row.id), input)).status,
      ).toBe(409);
      expect((await counts(fixture.selectedSupplier)).offers).toBe(0);
    }
  });

  it('competing CREATE commands on the same row create exactly one offer', async () => {
    const fixture = await accepted();
    const other = await actor(permissions, 'same-row-race');
    const [input, otherInput] = await Promise.all([
      confirmed(fixture),
      confirmed(fixture, other),
    ]);
    const [csrf, otherCsrf] = await Promise.all([full.csrf(), other.csrf()]);
    const results = await Promise.all([
      full.request('POST', path(fixture.row.id), input, randomUUID(), csrf),
      other.request(
        'POST',
        path(fixture.row.id),
        otherInput,
        randomUUID(),
        otherCsrf,
      ),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await counts(fixture.selectedSupplier)).toEqual({
      offers: 1,
      revisions: 1,
      applications: 1,
      audit: 1,
    });
  });

  it('supplier lock prevents concurrent exact duplicates across distinct staging rows', async () => {
    const first = await accepted();
    const secondRun = await stage('offers-v1', first.selectedSupplier);
    const secondRow = secondRun.rows[0]!;
    const secondDecision = await decide(secondRow.id);
    const second = {
      ...secondRun,
      row: secondRow,
      selectedSupplier: first.selectedSupplier,
      previewInput: {
        ...first.previewInput,
        decisionId: String(secondDecision.id),
      },
    };
    const other = await actor(permissions, 'supplier-race');
    const [bodyA, bodyB] = await Promise.all([
      confirmed(first),
      confirmed(second, other),
    ]);
    const [csrf, otherCsrf] = await Promise.all([full.csrf(), other.csrf()]);
    const results = await Promise.all([
      full.request('POST', path(first.row.id), bodyA, randomUUID(), csrf),
      other.request(
        'POST',
        path(second.row.id),
        bodyB,
        randomUUID(),
        otherCsrf,
      ),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const loser = results[0]!.status === 409 ? first : second;
    const preview = await full.write(
      'POST',
      path(loser.row.id, 'create-preview'),
      loser.previewInput,
    );
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(data(preview).eligible).toBe(false);
    expect(await counts(first.selectedSupplier)).toEqual({
      offers: 1,
      revisions: 1,
      applications: 1,
      audit: 1,
    });
  });

  it('legacy APPLY wins over CREATE when a legacy writer adds an exact active target after preview', async () => {
    const fixture = await accepted();
    const input = await confirmed(fixture);
    const existing = await full.write('POST', '/v1/staff/supplier-offers', {
      supplierId: fixture.selectedSupplier,
      brandId,
      sourceBrandText: 'TEST Instruments',
      manufacturerName: 'TEST Instruments',
      supplierPartNumber: 'TEST-0001',
      originalPartNumber: 'TEST-CTRL-001',
      modification: 'A',
      modificationEvidence: 'SPECIFIED',
      purchaseCost: '100',
      currency: 'RUB',
    });
    expect(existing.status, JSON.stringify(existing.body)).toBe(201);
    const offerId = String(data(existing).id);
    const blockedPreview = await full.write(
      'POST',
      path(fixture.row.id, 'create-preview'),
      fixture.previewInput,
    );
    expect(data(blockedPreview)).toMatchObject({
      eligible: false,
      blockedReason: 'ACTIVE_DUPLICATE',
      previewToken: null,
    });
    const other = await actor(permissions, 'legacy-apply-race');
    const [csrf, otherCsrf] = await Promise.all([full.csrf(), other.csrf()]);
    const results = await Promise.all([
      full.request('POST', path(fixture.row.id), input, randomUUID(), csrf),
      other.request(
        'POST',
        path(fixture.row.id, 'apply'),
        {
          offerId,
          expectedRowVersion: 2,
          expectedOfferVersion: 1,
          expectedOfferRevisionId: data(existing).revisionId,
          decisionId: fixture.previewInput.decisionId,
        },
        randomUUID(),
        otherCsrf,
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual([409, 200]);
    expect(
      await owner.ingestionApplication.count({
        where: { rowId: fixture.row.id },
      }),
    ).toBe(1);
    expect(
      await owner.ingestionApplication.findUnique({
        where: { rowId: fixture.row.id },
      }),
    ).toMatchObject({ operation: 'UPDATE', offerId });
  });

  it('mandatory PostgreSQL audit failure rolls back all CREATE writes', async () => {
    const fixture = await accepted();
    const body = await confirmed(fixture);
    const baseline = await counts(fixture.selectedSupplier);
    const key = randomUUID();
    await owner.$executeRawUnsafe(`CREATE FUNCTION public.create_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='supplier_offer.created' THEN RAISE EXCEPTION 'TEST CREATE audit unavailable'; END IF; RETURN NEW; END; $$`);
    await owner.$executeRawUnsafe(`CREATE TRIGGER create_test_fail_audit BEFORE INSERT ON public.audit_event
      FOR EACH ROW EXECUTE FUNCTION public.create_test_fail_audit()`);
    try {
      const response = await full.write(
        'POST',
        path(fixture.row.id),
        body,
        key,
      );
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(await counts(fixture.selectedSupplier)).toEqual(baseline);
      expect(
        await owner.ingestionCommand.count({
          where: { actorId: full.userId, key },
        }),
      ).toBe(0);
    } finally {
      await owner.$executeRawUnsafe(
        'DROP TRIGGER create_test_fail_audit ON public.audit_event',
      );
      await owner.$executeRawUnsafe(
        'DROP FUNCTION public.create_test_fail_audit()',
      );
    }
    expect(
      (await full.write('POST', path(fixture.row.id), body, key)).status,
    ).toBe(201);
  });

  it('lost reply after an actual COMMIT replays after restart, and revocation then denies replay', async () => {
    const fixture = await accepted();
    const input = await confirmed(fixture);
    const key = randomUUID();
    const transaction = database.$transaction.bind(database);
    let committed = false;
    const failAfterCommit = async (...args: unknown[]) => {
      const result: unknown = await Reflect.apply(transaction, database, args);
      if (
        !committed &&
        (await owner.ingestionApplication.findUnique({
          where: { rowId: fixture.row.id },
        }))
      ) {
        committed = true;
        throw new Error('TEST reply lost after committed CREATE');
      }
      return result;
    };
    const spy = vi
      .spyOn(database, '$transaction')
      .mockImplementation(failAfterCommit as typeof database.$transaction);
    try {
      expect(
        (await full.write('POST', path(fixture.row.id), input, key)).status,
      ).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(committed).toBe(true);
    const stored = await owner.ingestionApplication.findUniqueOrThrow({
      where: { rowId: fixture.row.id },
    });
    await app.close();
    await startApp();
    const replay = await full.write('POST', path(fixture.row.id), input, key);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(data(replay).revisionId).toBe(stored.revisionId);
    const userRole = await owner.userRole.findFirstOrThrow({
      where: { staffUserId: full.userId },
    });
    const permission = await owner.permission.findUniqueOrThrow({
      where: { code: 'ingestion.createOffer' },
    });
    await owner.rolePermission.deleteMany({
      where: { roleId: userRole.roleId, permissionId: permission.id },
    });
    expect(
      (await full.write('POST', path(fixture.row.id), input, key)).status,
    ).toBe(403);
    expect(await counts(fixture.selectedSupplier)).toEqual({
      offers: 1,
      revisions: 1,
      applications: 1,
      audit: 1,
    });
  });
});
