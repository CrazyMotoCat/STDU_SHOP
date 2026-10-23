import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { Client } from 'pg';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../src/app.factory.js';
import { IdentityCrypto } from '../src/identity/crypto.js';

type JsonRecord = Record<string, unknown>;
type ApiResult = {
  status: number;
  body: JsonRecord;
  headers: Headers;
};
type Product = {
  id: string;
  version: number;
  publicationState?: string;
  currentDraftRevisionId?: string | null;
  pendingRevisionId?: string | null;
  publishedRevisionId?: string | null;
  editorRevision?: JsonRecord | null;
  revisionHistory?: JsonRecord[];
};
type Category = { id: string; version: number; slug?: string };
type Brand = { id: string; version: number; slug?: string };
type Attribute = { id: string; version: number; code?: string };
type Actor = { id: string; email: string; password: string; agent: StaffAgent };

const origin = 'http://127.0.0.1:3000';
const runtimeEnabled = Boolean(
  process.env.MIGRATION_DATABASE_URL &&
  process.env.STAFF_DATABASE_URL &&
  process.env.REDIS_URL,
);
const testPermissions = [
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
  'files.metadata.read',
];
type RequestBarrier = {
  path: string;
  arrivals: number;
  wait: Promise<void>;
  resolveWait: () => void;
  resolveArrived: () => void;
  rejectArrived: (error: Error) => void;
  arrived: Promise<void>;
  timer: ReturnType<typeof setTimeout>;
};
let requestBarrier: RequestBarrier | undefined;

class RuntimeRequestGateInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context
      .switchToHttp()
      .getRequest<{ method: string; path: string }>();
    const gate = requestBarrier;
    if (gate && request.method === 'PATCH' && request.path === gate.path) {
      gate.arrivals += 1;
      if (gate.arrivals === 2) {
        clearTimeout(gate.timer);
        requestBarrier = undefined;
        gate.resolveArrived();
        gate.resolveWait();
      }
      await gate.wait;
    }
    return next.handle();
  }
}

class StaffAgent {
  readonly cookies = new Map<string, string>();
  baseUrl = '';

  remember(response: Response) {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const pair = cookie.split(';', 1)[0] ?? '';
      const split = pair.indexOf('=');
      if (split < 1) continue;
      const name = pair.slice(0, split);
      const value = pair.slice(split + 1);
      if (!value || /max-age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    options: { csrf?: string; origin?: string | null } = {},
  ): Promise<ApiResult> {
    const headers = new Headers();
    if (options.origin !== null)
      headers.set('Origin', options.origin ?? origin);
    if (this.cookies.size)
      headers.set(
        'Cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.csrf) headers.set('X-CSRF-Token', options.csrf);
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    this.remember(response);
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? (JSON.parse(text) as unknown) : {};
    } catch {
      parsed = {};
    }
    return {
      status: response.status,
      body:
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as JsonRecord)
          : {},
      headers: response.headers,
    };
  }

  async csrf() {
    const result = await this.request('GET', '/v1/staff/auth/csrf');
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const data = result.body.data as JsonRecord | undefined;
    expect(data?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    return data?.token as string;
  }

  async write(method: string, path: string, body?: unknown) {
    return this.request(method, path, body, { csrf: await this.csrf() });
  }

  async login(email: string, password: string) {
    return this.request(
      'POST',
      '/v1/staff/auth/login',
      { email, password },
      { csrf: await this.csrf() },
    );
  }
}

let app: Awaited<ReturnType<typeof createApiApp>> | undefined;
let db: PrismaClient | undefined;
let ownerPg: Client | undefined;
let apiUrl = '';
let fullActor: Actor;
let noCatalogActor: Actor;
let readOnlyActor: Actor;

function requiredUrl(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for catalog runtime tests.`);
  return value;
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a JSON object.');
  return value as JsonRecord;
}

function data(result: ApiResult) {
  return record(result.body.data);
}

function randomSlug(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`.toLowerCase();
}

async function makeActor(permissions: string[], label: string): Promise<Actor> {
  const actorId = randomUUID();
  const roleId = randomUUID();
  const email = `${label}-${randomUUID().slice(0, 8)}@example.invalid`;
  const password = `Catalog runtime ${randomBytes(6).toString('hex')} long!`;
  const passwordHash = await new IdentityCrypto().hashPassword(password, email);
  await db!.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        id: roleId,
        code: `catalog-${label}-${randomUUID().slice(0, 8)}`,
        name: `Catalog runtime ${label}`,
        state: 'ACTIVE',
      },
    });
    const registered = await tx.permission.findMany({
      where: { code: { in: permissions } },
      select: { id: true, code: true },
    });
    if (registered.length !== new Set(permissions).size)
      throw new Error(
        'A runtime fixture permission is missing from the registry.',
      );
    await tx.rolePermission.createMany({
      data: registered.map(({ id }) => ({ roleId: role.id, permissionId: id })),
    });
    await tx.staffUser.create({
      data: {
        id: actorId,
        email,
        emailNormalized: email.toLowerCase(),
        displayName: `Catalog runtime ${label}`,
        passwordHash,
        passwordChangeRequired: false,
        state: 'ACTIVE',
      },
    });
    await tx.userRole.create({
      data: { staffUserId: actorId, roleId: role.id },
    });
  });
  const agent = new StaffAgent();
  agent.baseUrl = apiUrl;
  const login = await agent.login(email, password);
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return { id: actorId, email, password, agent };
}

async function makeCategory(
  agent: StaffAgent,
  options: { parentId?: string | null; sortOrder?: number; slug?: string } = {},
): Promise<Category> {
  const slug = options.slug ?? randomSlug('cat');
  const response = await agent.write('POST', '/v1/staff/catalog/categories', {
    slug,
    name: `Category ${slug}`,
    ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
    ...(options.sortOrder === undefined
      ? {}
      : { sortOrder: options.sortOrder }),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { ...(data(response) as unknown as Category), slug };
}

async function makeBrand(agent: StaffAgent): Promise<Brand> {
  const slug = randomSlug('brand');
  const response = await agent.write('POST', '/v1/staff/catalog/brands', {
    slug,
    name: `Brand ${slug}`,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { ...(data(response) as unknown as Brand), slug };
}

async function makeAttribute(
  agent: StaffAgent,
  categoryId: string,
  code: string,
  valueType: 'TEXT' | 'DECIMAL' | 'INTEGER' | 'BOOLEAN' | 'ENUM',
): Promise<Attribute> {
  const unit = valueType === 'DECIMAL' || valueType === 'INTEGER';
  const response = await agent.write('POST', '/v1/staff/catalog/attributes', {
    categoryId,
    code,
    label: `Attribute ${code}`,
    valueType,
    unitCode: unit ? 'unit' : null,
    unitLabel: unit ? 'unit' : null,
    enumOptions:
      valueType === 'ENUM'
        ? [
            { code: 'known', label: 'Known' },
            { code: 'other', label: 'Other' },
          ]
        : null,
    filterable: true,
    searchable: valueType === 'TEXT' || valueType === 'ENUM',
    comparable: true,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { ...(data(response) as unknown as Attribute), code };
}

async function makeProduct(
  agent: StaffAgent,
  categoryId: string,
  options: {
    slug?: string;
    brandId?: string | null;
    manufacturerName?: string | null;
    originalPartNumber?: string | null;
    modification?: string | null;
    attributes?: JsonRecord[];
    displayName?: string;
  } = {},
): Promise<Product> {
  const slug = options.slug ?? randomSlug('product');
  const response = await agent.write('POST', '/v1/staff/catalog/products', {
    slug,
    categoryId,
    displayName: options.displayName ?? `Product ${slug}`,
    ...(options.brandId === undefined ? {} : { brandId: options.brandId }),
    ...(options.manufacturerName === undefined
      ? {}
      : { manufacturerName: options.manufacturerName }),
    ...(options.originalPartNumber === undefined
      ? {}
      : { originalPartNumber: options.originalPartNumber }),
    ...(options.modification === undefined
      ? {}
      : { modification: options.modification }),
    ...(options.attributes === undefined
      ? {}
      : { attributes: options.attributes }),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return data(response) as unknown as Product;
}

async function getProduct(
  agent: StaffAgent,
  productId: string,
): Promise<Product> {
  const response = await agent.request(
    'GET',
    `/v1/staff/catalog/products/${productId}`,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return data(response) as unknown as Product;
}

async function submitProduct(agent: StaffAgent, product: Product) {
  return agent.write(
    'POST',
    `/v1/staff/catalog/products/${product.id}/submit`,
    { expectedVersion: product.version },
  );
}

async function reviewPendingProduct(
  agent: StaffAgent,
  product: Product,
  decision: 'PUBLISH' | 'RETURN_FOR_CHANGES' | 'REJECT',
  reason?: string,
) {
  const current = await getProduct(agent, product.id);
  const revisionId = current.pendingRevisionId;
  if (typeof revisionId !== 'string')
    throw new Error('The product has no pending revision to review.');
  return agent.write(
    'POST',
    `/v1/staff/catalog/products/${product.id}/review`,
    {
      expectedVersion: current.version,
      revisionId,
      decision,
      ...(reason === undefined ? {} : { reason }),
    },
  );
}

async function publishProduct(agent: StaffAgent, product: Product) {
  const current = await getProduct(agent, product.id);
  const submitted = await submitProduct(agent, current);
  if (submitted.status !== 200) {
    const persisted = await db!.catalogProduct.findUnique({
      where: { id: product.id },
      select: {
        version: true,
        publicationState: true,
        currentDraftRevisionId: true,
        pendingRevisionId: true,
      },
    });
    throw new Error(
      `Submit failed for ${product.id}: apiVersion=${current.version}, persisted=${JSON.stringify(persisted)}, response=${JSON.stringify(submitted.body)}`,
    );
  }
  const review = await reviewPendingProduct(agent, product, 'PUBLISH');
  expect(review.status, JSON.stringify(review.body)).toBe(200);
  return getProduct(agent, product.id);
}

async function createFileVersion(
  ownerId: string,
  visibility: 'PRIVATE' | 'INTERNAL' = 'PRIVATE',
) {
  const fileObjectId = randomUUID();
  const fileVersionId = randomUUID();
  await db!.fileObject.create({
    data: {
      id: fileObjectId,
      ownerStaffUserId: ownerId,
      displayName: `runtime-file-${fileObjectId.slice(0, 8)}`,
      visibility,
      state: 'ACTIVE',
    },
  });
  await db!.fileVersion.create({
    data: {
      id: fileVersionId,
      fileObjectId,
      number: 1,
      storageKey: randomBytes(32).toString('hex'),
      sha256: randomBytes(32),
      sizeBytes: 12n,
      mimeType: 'application/pdf',
      originalFilename: 'test.pdf',
      safetyState: 'SAFE',
      createdByUserId: ownerId,
    },
  });
  return { fileObjectId, fileVersionId };
}

async function listenPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Unable to allocate an API test port.');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitUntilBlocked(
  observer: Client,
  blockerPid: number,
  queryPart: string,
) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      `SELECT pid FROM pg_stat_activity
       WHERE wait_event_type='Lock' AND pg_blocking_pids(pid) @> ARRAY[$1::int]
         AND query ILIKE $2 LIMIT 1`,
      [blockerPid, `%${queryPart}%`],
    );
    if (result.rowCount) return Number(result.rows[0].pid);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const activity = await observer.query(
    `SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,
       left(query,240) AS query
     FROM pg_stat_activity
     WHERE datname=current_database() AND pid<>pg_backend_pid()
       AND state='active'
     ORDER BY pid`,
  );
  throw new Error(
    `Did not observe a PostgreSQL lock wait for ${queryPart}; active statements: ${JSON.stringify(activity.rows)}`,
  );
}

function installRequestBarrier(path: string) {
  let resolveWait!: () => void;
  let resolveArrived!: () => void;
  let rejectArrived!: (error: Error) => void;
  const wait = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  const arrived = new Promise<void>((resolve, reject) => {
    resolveArrived = resolve;
    rejectArrived = reject;
  });
  const timer = setTimeout(() => {
    if (requestBarrier?.path !== path) return;
    requestBarrier = undefined;
    resolveWait();
    rejectArrived(new Error(`Two HTTP writers did not reach ${path}.`));
  }, 8_000);
  requestBarrier = {
    path,
    arrivals: 0,
    wait,
    resolveWait,
    resolveArrived,
    rejectArrived,
    arrived,
    timer,
  };
  return { arrived };
}

async function assertReferenceUsageRace(input: {
  table: 'category' | 'brand' | 'attribute_definition';
  referenceId: string;
  create: () => Promise<ApiResult>;
  archive: () => Promise<ApiResult>;
}) {
  const blocker = new Client({
    connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
    application_name: `r1-004b-${input.table}-race-blocker`,
  });
  const observer = new Client({
    connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
    application_name: `r1-004b-${input.table}-race-observer`,
  });
  await Promise.all([blocker.connect(), observer.connect()]);
  let transactionOpen = false;
  try {
    await blocker.query('BEGIN');
    transactionOpen = true;
    await blocker.query(
      `SELECT id FROM ${input.table} WHERE id=$1::uuid FOR UPDATE`,
      [input.referenceId],
    );
    const blockerPid = Number(
      (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
    );
    const create = input.create();
    const createPid = await waitUntilBlocked(observer, blockerPid, 'FOR SHARE');
    const archive = input.archive();
    await waitUntilBlocked(observer, createPid, 'FOR UPDATE');
    await blocker.query('COMMIT');
    transactionOpen = false;
    const [created, archived] = await Promise.all([create, archive]);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    if (input.table === 'attribute_definition') {
      expect(archived.status, JSON.stringify(archived.body)).toBe(200);
      const productId = String(record(created.body.data).id);
      const root = await db!.catalogProduct.findUniqueOrThrow({
        where: { id: productId },
        select: { currentDraftRevisionId: true },
      });
      expect(root.currentDraftRevisionId).toBeTruthy();
      const snapshot = await db!.productAttributeValue.findFirstOrThrow({
        where: {
          productRevisionId: root.currentDraftRevisionId!,
          attributeDefinitionId: input.referenceId,
        },
      });
      expect(snapshot.labelSnapshot).toBe('Attribute race_attribute');
      expect(
        (
          await db!.attributeDefinition.findUniqueOrThrow({
            where: { id: input.referenceId },
          })
        ).state,
      ).toBe('ARCHIVED');
      return;
    }
    let diagnostic = '';
    if (archived.status !== 409 && input.table === 'category') {
      const productId = String(record(created.body.data).id);
      const database = await ownerPg!.query(
        'SELECT current_database() AS name',
      );
      const root = await ownerPg!.query(
        `SELECT id::text,slug,publication_state,current_draft_revision_id::text,
           pending_revision_id::text,published_revision_id::text
         FROM catalog_product WHERE id=$1::uuid`,
        [productId],
      );
      const revisions = await ownerPg!.query(
        `SELECT id::text,state,category_id::text FROM catalog_product_revision
         WHERE product_id=$1::uuid ORDER BY revision_no`,
        [productId],
      );
      diagnostic = JSON.stringify({
        database: database.rows,
        root: root.rows,
        revisions: revisions.rows,
      });
    }
    expect(
      archived.status,
      JSON.stringify({
        created: created.body,
        archived: archived.body,
        products: diagnostic,
      }),
    ).toBe(409);
    expect(archived.body.code).toBe('REFERENCE_IN_USE');
  } finally {
    if (transactionOpen) await blocker.query('ROLLBACK').catch(() => undefined);
    await Promise.allSettled([blocker.end(), observer.end()]);
  }
}

async function raceProductOperationsAgainstTargetLock(
  targetProductId: string,
  first: () => Promise<ApiResult>,
  second: () => Promise<ApiResult>,
) {
  const blocker = new Client({
    connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
    application_name: 'r1-004b-product-root-race-blocker',
  });
  const observer = new Client({
    connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
    application_name: 'r1-004b-product-root-race-observer',
  });
  await Promise.all([blocker.connect(), observer.connect()]);
  let transactionOpen = false;
  let firstRequest: Promise<ApiResult> | undefined;
  let secondRequest: Promise<ApiResult> | undefined;
  try {
    await blocker.query('BEGIN');
    transactionOpen = true;
    await blocker.query(
      'SELECT id FROM catalog_product WHERE id=$1::uuid FOR UPDATE',
      [targetProductId],
    );
    const blockerPid = Number(
      (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
    );
    firstRequest = first();
    const firstPid = await waitUntilBlocked(observer, blockerPid, 'FOR UPDATE');
    secondRequest = second();
    await waitUntilBlocked(observer, firstPid, 'FOR UPDATE');
    await blocker.query('COMMIT');
    transactionOpen = false;
    return await Promise.all([firstRequest, secondRequest]);
  } finally {
    if (transactionOpen) await blocker.query('ROLLBACK').catch(() => undefined);
    await Promise.allSettled(
      [firstRequest, secondRequest].filter(
        (request): request is Promise<ApiResult> => request !== undefined,
      ),
    );
    await Promise.allSettled([blocker.end(), observer.end()]);
  }
}

describe.skipIf(!runtimeEnabled)(
  'R1-004B real PostgreSQL + HTTP catalog acceptance',
  () => {
    beforeAll(async () => {
      db = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
        }),
      });
      await db.$connect();
      ownerPg = new Client({
        connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
        application_name: 'r1-004b-catalog-runtime-owner',
      });
      await ownerPg.connect();
      app = await createApiApp();
      app.useGlobalInterceptors(new RuntimeRequestGateInterceptor());
      app.useLogger(false);
      await app.listen(await listenPort(), '127.0.0.1');
      const address = app.getHttpServer().address();
      if (!address || typeof address === 'string')
        throw new Error('Catalog API test listener did not bind a TCP port.');
      apiUrl = `http://127.0.0.1:${address.port}`;
      fullActor = await makeActor(testPermissions, 'full');
      noCatalogActor = await makeActor(['staff.users.read'], 'denied');
      readOnlyActor = await makeActor(
        ['catalog.products.read', 'catalog.references.read'],
        'reader',
      );
    }, 60_000);

    afterAll(async () => {
      await app?.close();
      await db?.$disconnect();
      await ownerPg?.end();
    });

    it('CATB-02/03/05/07/09: reference CRUD, current-pointer archive checks, typed definitions and immutable attribute semantics', async () => {
      const brand = await makeBrand(fullActor.agent);
      const root = await makeCategory(fullActor.agent);
      const child = await makeCategory(fullActor.agent, { parentId: root.id });
      const rootBeforeBlockedArchive = await db!.category.findUniqueOrThrow({
        where: { id: root.id },
        select: { state: true, version: true },
      });
      const rootArchiveSuccessAudits = await db!.auditEvent.count({
        where: {
          action: 'catalog.reference.changed',
          outcome: 'SUCCESS',
          entityType: 'Category',
          entityId: root.id,
        },
      });
      const blockChild = await fullActor.agent.write(
        'POST',
        `/v1/staff/catalog/categories/${root.id}/archive`,
        { expectedVersion: root.version },
      );
      expect(blockChild.status).toBe(409);
      expect(blockChild.body.code).toBe('REFERENCE_IN_USE');
      expect(
        await db!.category.findUniqueOrThrow({
          where: { id: root.id },
          select: { state: true, version: true },
        }),
      ).toEqual(rootBeforeBlockedArchive);
      expect(
        await db!.auditEvent.count({
          where: {
            action: 'catalog.reference.changed',
            outcome: 'SUCCESS',
            entityType: 'Category',
            entityId: root.id,
          },
        }),
      ).toBe(rootArchiveSuccessAudits);

      const patchCategory = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/categories/${child.id}`,
        {
          expectedVersion: child.version,
          name: 'Renamed category',
          sortOrder: 8,
        },
      );
      expect(patchCategory.status).toBe(200);
      const childRead = await fullActor.agent.request(
        'GET',
        `/v1/staff/catalog/categories/${child.id}`,
      );
      expect(data(childRead).name).toBe('Renamed category');
      const childArchive = await fullActor.agent.write(
        'POST',
        `/v1/staff/catalog/categories/${child.id}/archive`,
        { expectedVersion: 2 },
      );
      expect(childArchive.status).toBe(200);
      const rootArchive = await fullActor.agent.write(
        'POST',
        `/v1/staff/catalog/categories/${root.id}/archive`,
        { expectedVersion: root.version },
      );
      expect(rootArchive.status).toBe(200);

      const brandPatch = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/brands/${brand.id}`,
        { expectedVersion: brand.version, name: 'Updated brand name' },
      );
      expect(brandPatch.status).toBe(200);
      const brandArchive = await fullActor.agent.write(
        'POST',
        `/v1/staff/catalog/brands/${brand.id}/archive`,
        { expectedVersion: 2 },
      );
      expect(brandArchive.status).toBe(200);

      const category = await makeCategory(fullActor.agent);
      const definitions: Attribute[] = [];
      for (const [index, type] of (
        ['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'] as const
      ).entries())
        definitions.push(
          await makeAttribute(
            fullActor.agent,
            category.id,
            `type_${type.toLowerCase()}_${index}`,
            type,
          ),
        );
      expect(definitions).toHaveLength(5);

      const textDefinition = definitions[0]!;
      const product = await makeProduct(fullActor.agent, category.id, {
        attributes: [
          {
            attributeDefinitionId: textDefinition.id,
            valueType: 'TEXT',
            value: 'snapshot value',
          },
        ],
      });
      const labelChange = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/attributes/${textDefinition.id}`,
        { expectedVersion: textDefinition.version, label: 'New label' },
      );
      expect(labelChange.status).toBe(200);
      const detail = await getProduct(fullActor.agent, product.id);
      const editor = record(detail.editorRevision);
      const values = editor.attributes as JsonRecord[];
      expect(values[0]?.label).toBe(`Attribute ${textDefinition.code}`);
      const renamedLabelPublished = await publishProduct(
        fullActor.agent,
        product,
      );
      expect(renamedLabelPublished.publishedRevisionId).toBeTruthy();
      const publishedValue = await db!.productAttributeValue.findFirstOrThrow({
        where: {
          productRevisionId: renamedLabelPublished.publishedRevisionId!,
        },
      });
      expect(publishedValue.labelSnapshot).toBe(
        `Attribute ${textDefinition.code}`,
      );
      const afterRenameDraft = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${product.id}`,
        {
          expectedVersion: renamedLabelPublished.version,
          baseRevisionId: renamedLabelPublished.publishedRevisionId!,
          summary: 'New draft after attribute label rename',
        },
      );
      expect(
        afterRenameDraft.status,
        JSON.stringify(afterRenameDraft.body),
      ).toBe(200);
      const renamedDraft = await getProduct(fullActor.agent, product.id);
      expect(renamedDraft.currentDraftRevisionId).toBeTruthy();
      const nextSnapshot = await db!.productAttributeValue.findFirstOrThrow({
        where: {
          productRevisionId: renamedDraft.currentDraftRevisionId!,
        },
      });
      expect(nextSnapshot.labelSnapshot).toBe('New label');
      const archivedAttribute = await fullActor.agent.write(
        'POST',
        `/v1/staff/catalog/attributes/${textDefinition.id}/archive`,
        { expectedVersion: data(labelChange).version },
      );
      expect(archivedAttribute.status).toBe(200);
      const rejectedArchivedAttribute = await fullActor.agent.write(
        'POST',
        '/v1/staff/catalog/products',
        {
          slug: randomSlug('archived-attribute'),
          categoryId: category.id,
          displayName: 'Archived attribute must not be selectable',
          attributes: [
            {
              attributeDefinitionId: textDefinition.id,
              valueType: 'TEXT',
              value: 'not allowed',
            },
          ],
        },
      );
      expect(rejectedArchivedAttribute.status).toBe(400);
    });

    it('CATB-03: category archive checks current draft, pending and published pointers, then preserves history-only use', async () => {
      const assertArchiveBlockedWithoutMutation = async (
        category: Category,
      ) => {
        const before = await db!.category.findUniqueOrThrow({
          where: { id: category.id },
          select: { state: true, version: true },
        });
        const successAuditsBefore = await db!.auditEvent.count({
          where: {
            action: 'catalog.reference.changed',
            outcome: 'SUCCESS',
            entityType: 'Category',
            entityId: category.id,
          },
        });
        const response = await fullActor.agent.write(
          'POST',
          `/v1/staff/catalog/categories/${category.id}/archive`,
          { expectedVersion: category.version },
        );
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('REFERENCE_IN_USE');
        expect(
          await db!.category.findUniqueOrThrow({
            where: { id: category.id },
            select: { state: true, version: true },
          }),
        ).toEqual(before);
        expect(
          await db!.auditEvent.count({
            where: {
              action: 'catalog.reference.changed',
              outcome: 'SUCCESS',
              entityType: 'Category',
              entityId: category.id,
            },
          }),
        ).toBe(successAuditsBefore);
      };
      const draftCategory = await makeCategory(fullActor.agent);
      await makeProduct(fullActor.agent, draftCategory.id);
      await assertArchiveBlockedWithoutMutation(draftCategory);

      const pendingCategory = await makeCategory(fullActor.agent);
      const pendingProduct = await makeProduct(
        fullActor.agent,
        pendingCategory.id,
      );
      const pendingSubmit = await submitProduct(
        fullActor.agent,
        pendingProduct,
      );
      expect(pendingSubmit.status).toBe(200);
      const pendingState = await getProduct(fullActor.agent, pendingProduct.id);
      expect(pendingState.pendingRevisionId).toBeTruthy();
      await assertArchiveBlockedWithoutMutation(pendingCategory);

      const publishedCategory = await makeCategory(fullActor.agent);
      const publishedProduct = await makeProduct(
        fullActor.agent,
        publishedCategory.id,
      );
      const publishedState = await publishProduct(
        fullActor.agent,
        publishedProduct,
      );
      expect(publishedState.publishedRevisionId).toBeTruthy();
      await assertArchiveBlockedWithoutMutation(publishedCategory);

      const historicalCategory = await makeCategory(fullActor.agent);
      const currentCategory = await makeCategory(fullActor.agent);
      const supersededProduct = await makeProduct(
        fullActor.agent,
        historicalCategory.id,
      );
      const supersededBase = await getProduct(
        fullActor.agent,
        supersededProduct.id,
      );
      const moveSuperseded = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${supersededProduct.id}`,
        {
          expectedVersion: supersededBase.version,
          baseRevisionId: supersededBase.currentDraftRevisionId,
          categoryId: currentCategory.id,
        },
      );
      expect(moveSuperseded.status).toBe(200);
      await publishProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, supersededProduct.id),
      );

      const returnedProduct = await makeProduct(
        fullActor.agent,
        historicalCategory.id,
      );
      expect(
        (await submitProduct(fullActor.agent, returnedProduct)).status,
      ).toBe(200);
      const returnedPending = await getProduct(
        fullActor.agent,
        returnedProduct.id,
      );
      expect(
        (
          await reviewPendingProduct(
            fullActor.agent,
            returnedPending,
            'RETURN_FOR_CHANGES',
            'Historical category reference test',
          )
        ).status,
      ).toBe(200);
      const afterReturn = await getProduct(fullActor.agent, returnedProduct.id);
      const returnedRevision = afterReturn.revisionHistory!.find(
        (revision) => revision.state === 'RETURNED',
      );
      expect(returnedRevision).toBeTruthy();
      const moveReturned = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${returnedProduct.id}`,
        {
          expectedVersion: afterReturn.version,
          baseRevisionId: returnedRevision!.id,
          categoryId: currentCategory.id,
        },
      );
      expect(moveReturned.status).toBe(200);
      await publishProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, returnedProduct.id),
      );

      const rejectedProduct = await makeProduct(
        fullActor.agent,
        historicalCategory.id,
      );
      expect(
        (await submitProduct(fullActor.agent, rejectedProduct)).status,
      ).toBe(200);
      const rejectedPending = await getProduct(
        fullActor.agent,
        rejectedProduct.id,
      );
      expect(
        (
          await reviewPendingProduct(
            fullActor.agent,
            rejectedPending,
            'REJECT',
            'Historical category reference test',
          )
        ).status,
      ).toBe(200);
      const afterReject = await getProduct(fullActor.agent, rejectedProduct.id);
      const rejectedRevision = afterReject.revisionHistory!.find(
        (revision) => revision.state === 'REJECTED',
      );
      expect(rejectedRevision).toBeTruthy();
      expect(
        (
          await fullActor.agent.write(
            'PATCH',
            `/v1/staff/catalog/products/${rejectedProduct.id}`,
            {
              expectedVersion: afterReject.version,
              baseRevisionId: rejectedRevision!.id,
              categoryId: currentCategory.id,
            },
          )
        ).status,
      ).toBe(200);
      await publishProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, rejectedProduct.id),
      );

      const archivedHistoricalCategory = await fullActor.agent.write(
        'POST',
        `/v1/staff/catalog/categories/${historicalCategory.id}/archive`,
        { expectedVersion: historicalCategory.version },
      );
      expect(
        archivedHistoricalCategory.status,
        JSON.stringify(archivedHistoricalCategory.body),
      ).toBe(200);
      const historicalRevisions = await db!.catalogProductRevision.findMany({
        where: {
          productId: {
            in: [supersededProduct.id, returnedProduct.id, rejectedProduct.id],
          },
          categoryId: historicalCategory.id,
        },
        select: { state: true },
      });
      expect(historicalRevisions.map(({ state }) => state).sort()).toEqual([
        'REJECTED',
        'RETURNED',
        'SUPERSEDED',
      ]);
    });

    it('CATB-04: concurrent category reparenting serializes and prevents a committed cycle', async () => {
      const left = await makeCategory(fullActor.agent);
      const right = await makeCategory(fullActor.agent);
      const secondWriter = await makeActor(testPermissions, 'tree-race');
      const blocker = new Client({
        connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
        application_name: 'r1-004b-category-tree-lock-blocker',
      });
      const observer = new Client({
        connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
        application_name: 'r1-004b-category-tree-lock-observer',
      });
      await Promise.all([blocker.connect(), observer.connect()]);
      let open = false;
      try {
        await blocker.query('BEGIN');
        open = true;
        await blocker.query('SELECT pg_advisory_xact_lock(1398031445,3)');
        const blockerPid = Number(
          (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );
        const first = fullActor.agent.write(
          'PATCH',
          `/v1/staff/catalog/categories/${left.id}`,
          { expectedVersion: left.version, parentId: right.id },
        );
        const second = secondWriter.agent.write(
          'PATCH',
          `/v1/staff/catalog/categories/${right.id}`,
          { expectedVersion: right.version, parentId: left.id },
        );
        await waitUntilBlocked(observer, blockerPid, 'pg_advisory_xact_lock');
        await blocker.query('COMMIT');
        open = false;
        const results = await Promise.all([first, second]);
        expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
        expect(results.find(({ status }) => status === 409)?.body.code).toBe(
          'CATEGORY_CYCLE',
        );
        const cycles = await ownerPg!.query(
          `WITH RECURSIVE walk(origin,id,path,cycle) AS (
           SELECT id,id,ARRAY[id],false FROM category WHERE id=ANY($1::uuid[])
           UNION ALL
           SELECT w.origin,c.parent_id,w.path||c.parent_id,c.parent_id=ANY(w.path)
           FROM walk w JOIN category c ON c.id=w.id
           WHERE c.parent_id IS NOT NULL AND NOT w.cycle
         ) SELECT bool_or(cycle) AS cycle FROM walk`,
          [[left.id, right.id]],
        );
        expect(cycles.rows[0]?.cycle).not.toBe(true);
      } finally {
        if (open) await blocker.query('ROLLBACK').catch(() => undefined);
        await Promise.allSettled([blocker.end(), observer.end()]);
      }
    });

    it('CATB-06/08/10/15/19/30/31/36/38: typed validation, identity lifecycle, pointer filters and concurrent OCC', async () => {
      const category = await makeCategory(fullActor.agent);
      const text = await makeAttribute(
        fullActor.agent,
        category.id,
        'material',
        'TEXT',
      );
      const numeric = await makeAttribute(
        fullActor.agent,
        category.id,
        'voltage',
        'DECIMAL',
      );
      const integer = await makeAttribute(
        fullActor.agent,
        category.id,
        'count_value',
        'INTEGER',
      );
      const boolean = await makeAttribute(
        fullActor.agent,
        category.id,
        'enabled_value',
        'BOOLEAN',
      );
      const enumeration = await makeAttribute(
        fullActor.agent,
        category.id,
        'mode_value',
        'ENUM',
      );
      const foreignCategory = await makeCategory(fullActor.agent);
      const foreignText = await makeAttribute(
        fullActor.agent,
        foreignCategory.id,
        'foreign_text',
        'TEXT',
      );
      const inactiveText = await makeAttribute(
        fullActor.agent,
        category.id,
        'inactive_text',
        'TEXT',
      );
      const archivedText = await fullActor.agent.write(
        'POST',
        `/v1/staff/catalog/attributes/${inactiveText.id}/archive`,
        { expectedVersion: inactiveText.version },
      );
      expect(archivedText.status).toBe(200);
      const typedProduct = await makeProduct(fullActor.agent, category.id, {
        attributes: [
          {
            attributeDefinitionId: text.id,
            valueType: 'TEXT',
            value: 'steel',
          },
          {
            attributeDefinitionId: numeric.id,
            valueType: 'DECIMAL',
            value: '12.5',
          },
          {
            attributeDefinitionId: integer.id,
            valueType: 'INTEGER',
            value: 12,
          },
          {
            attributeDefinitionId: boolean.id,
            valueType: 'BOOLEAN',
            value: true,
          },
          {
            attributeDefinitionId: enumeration.id,
            valueType: 'ENUM',
            value: { code: 'known' },
          },
        ],
      });
      const typedProductState = await getProduct(
        fullActor.agent,
        typedProduct.id,
      );
      expect(typedProductState.currentDraftRevisionId).toBeTruthy();
      expect(
        await db!.productAttributeValue.count({
          where: {
            productRevisionId: typedProductState.currentDraftRevisionId!,
          },
        }),
      ).toBe(5);
      const textBoundary = await makeProduct(fullActor.agent, category.id, {
        attributes: [
          {
            attributeDefinitionId: text.id,
            valueType: 'TEXT',
            value: 'x'.repeat(240),
          },
        ],
      });
      const textBoundaryState = await getProduct(
        fullActor.agent,
        textBoundary.id,
      );
      const textBoundaryRevision =
        await db!.productAttributeValue.findFirstOrThrow({
          where: {
            productRevisionId: textBoundaryState.currentDraftRevisionId!,
            attributeDefinitionId: text.id,
          },
        });
      expect(textBoundaryRevision.textValue).toBe('x'.repeat(240));
      const minimumSafeInteger = await makeProduct(
        fullActor.agent,
        category.id,
        {
          attributes: [
            {
              attributeDefinitionId: integer.id,
              valueType: 'INTEGER',
              value: Number.MIN_SAFE_INTEGER,
            },
          ],
        },
      );
      const maximumSafeInteger = await makeProduct(
        fullActor.agent,
        category.id,
        {
          attributes: [
            {
              attributeDefinitionId: integer.id,
              valueType: 'INTEGER',
              value: Number.MAX_SAFE_INTEGER,
            },
          ],
        },
      );
      for (const safeIntegerProduct of [minimumSafeInteger, maximumSafeInteger])
        expect(
          (await getProduct(fullActor.agent, safeIntegerProduct.id))
            .currentDraftRevisionId,
        ).toBeTruthy();
      for (const canonicalDecimal of [
        '0',
        '-1',
        '123.001',
        `0.${'1'.repeat(62)}`,
      ]) {
        const decimalProduct = await makeProduct(fullActor.agent, category.id, {
          attributes: [
            {
              attributeDefinitionId: numeric.id,
              valueType: 'DECIMAL',
              value: canonicalDecimal,
            },
          ],
        });
        expect(
          (await getProduct(fullActor.agent, decimalProduct.id))
            .currentDraftRevisionId,
        ).toBeTruthy();
      }
      const invalidDecimal = await makeProduct(fullActor.agent, category.id);
      const beforeInvalid = await db!.catalogProduct.count({
        where: { id: invalidDecimal.id },
      });
      const badType = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${invalidDecimal.id}`,
        {
          expectedVersion: invalidDecimal.version,
          baseRevisionId: (await getProduct(fullActor.agent, invalidDecimal.id))
            .currentDraftRevisionId,
          attributes: [
            {
              attributeDefinitionId: numeric.id,
              valueType: 'DECIMAL',
              value: '1e2',
            },
          ],
        },
      );
      expect(badType.status).toBe(400);
      expect(beforeInvalid).toBe(1);

      const invalidTypedValues: {
        definition: Attribute;
        valueType: string;
        value: unknown;
        label: string;
      }[] = [
        {
          definition: text,
          valueType: 'TEXT',
          value: 'x'.repeat(241),
          label: 'oversized text',
        },
        ...['01', '+1', '1.0', '-0', '-0.0', '1e2', '1'.repeat(65)].map(
          (value) => ({
            definition: numeric,
            valueType: 'DECIMAL',
            value,
            label: `noncanonical decimal ${value.slice(0, 12)}`,
          }),
        ),
        {
          definition: integer,
          valueType: 'INTEGER',
          value: 1.5,
          label: 'fractional integer',
        },
        {
          definition: integer,
          valueType: 'INTEGER',
          value: Number.MAX_SAFE_INTEGER + 1,
          label: 'integer above safe range',
        },
        {
          definition: integer,
          valueType: 'INTEGER',
          value: Number.MIN_SAFE_INTEGER - 1,
          label: 'integer below safe range',
        },
        {
          definition: boolean,
          valueType: 'BOOLEAN',
          value: 'true',
          label: 'string boolean',
        },
        {
          definition: enumeration,
          valueType: 'ENUM',
          value: { code: 'unknown' },
          label: 'unknown enum',
        },
        {
          definition: enumeration,
          valueType: 'ENUM',
          value: { code: 'known', label: 'unexpected extra typed value' },
          label: 'enum with an extra typed value',
        },
        {
          definition: text,
          valueType: 'INTEGER',
          value: 12,
          label: 'mismatched valueType',
        },
        {
          definition: foreignText,
          valueType: 'TEXT',
          value: 'foreign category definition',
          label: 'definition from another category',
        },
        {
          definition: inactiveText,
          valueType: 'TEXT',
          value: 'inactive definition',
          label: 'inactive definition',
        },
      ];
      for (const invalid of invalidTypedValues) {
        const slug = randomSlug('invalid-typed-value');
        const response = await fullActor.agent.write(
          'POST',
          '/v1/staff/catalog/products',
          {
            slug,
            categoryId: category.id,
            displayName: `Invalid ${invalid.label}`,
            attributes: [
              {
                attributeDefinitionId: invalid.definition.id,
                valueType: invalid.valueType,
                value: invalid.value,
              },
            ],
          },
        );
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        expect(await db!.catalogProduct.count({ where: { slug } })).toBe(0);
      }

      const identityBrand = await makeBrand(fullActor.agent);
      const identityProduct = await makeProduct(fullActor.agent, category.id, {
        brandId: identityBrand.id,
        slug: randomSlug('sku'),
        manufacturerName: '  Maker  ',
        originalPartNumber: ' Part-A ',
        modification: '  Rev-1  ',
        attributes: [
          {
            attributeDefinitionId: text.id,
            valueType: 'TEXT',
            value: 'steel',
          },
        ],
      });
      const duplicateIdentity = await fullActor.agent.write(
        'POST',
        '/v1/staff/catalog/products',
        {
          slug: randomSlug('sku'),
          categoryId: category.id,
          brandId: identityBrand.id,
          displayName: 'Normalized duplicate',
          manufacturerName: 'Maker',
          originalPartNumber: 'Part-A',
          modification: 'Rev-1',
        },
      );
      expect(duplicateIdentity.status).toBe(409);
      expect(duplicateIdentity.body.code).toBe('IDENTITY_CONFLICT');
      const caseDistinct = await makeProduct(fullActor.agent, category.id, {
        brandId: identityBrand.id,
        manufacturerName: 'maker',
        originalPartNumber: 'Part-A',
        modification: 'Rev-1',
      });
      expect(caseDistinct.id).not.toBe(identityProduct.id);

      const initial = await getProduct(fullActor.agent, identityProduct.id);
      const initialDraft = record(initial.editorRevision);
      const noPendingPatch = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${initial.id}`,
        {
          expectedVersion: initial.version,
          baseRevisionId: initialDraft.id,
          summary: 'Identity remains editable before first submit',
        },
      );
      expect(noPendingPatch.status).toBe(200);
      const changed = await getProduct(fullActor.agent, initial.id);
      const publishedBefore = changed.publishedRevisionId;
      const submit = await submitProduct(fullActor.agent, changed);
      expect(submit.status).toBe(200);
      const pending = await getProduct(fullActor.agent, changed.id);
      expect(pending.pendingRevisionId).toBeTruthy();
      expect(pending.publishedRevisionId).toBe(publishedBefore);
      const blockedPatch = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${changed.id}`,
        {
          expectedVersion: pending.version,
          baseRevisionId: pending.pendingRevisionId,
          displayName: 'Cannot edit while pending',
        },
      );
      expect(blockedPatch.status).toBe(409);

      const staleWrite = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${changed.id}`,
        {
          expectedVersion: changed.version,
          baseRevisionId: initialDraft.id,
          summary: 'stale writer',
        },
      );
      expect(staleWrite.status).toBe(409);
      expect(staleWrite.body.code).toBe('VERSION_CONFLICT');

      const returned = await reviewPendingProduct(
        fullActor.agent,
        pending,
        'RETURN_FOR_CHANGES',
        'Please update the description.',
      );
      expect(returned.status).toBe(200);
      const afterReturn = await getProduct(fullActor.agent, changed.id);
      const returnedRevision = (
        afterReturn.revisionHistory as JsonRecord[]
      ).find((revision) => revision.state === 'RETURNED');
      expect(returnedRevision?.decisionReason).toBe(
        'Please update the description.',
      );
      const retry = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${changed.id}`,
        {
          expectedVersion: afterReturn.version,
          baseRevisionId: returnedRevision?.id,
          summary: 'corrected summary',
        },
      );
      expect(retry.status).toBe(200);
      const retryState = await getProduct(fullActor.agent, changed.id);
      expect(retryState.editorRevision).toBeTruthy();

      const archivedFilter = await fullActor.agent.request(
        'GET',
        `/v1/staff/catalog/products?publicationState=ARCHIVED&categoryId=${category.id}`,
      );
      expect(archivedFilter.status).toBe(400);
      const draftFilter = await fullActor.agent.request(
        'GET',
        `/v1/staff/catalog/products?publicationState=DRAFT&categoryId=${category.id}`,
      );
      expect(draftFilter.status).toBe(200);
      expect(Array.isArray(draftFilter.body.data)).toBe(true);

      const snapshotBeforeSubmit = await getProduct(
        fullActor.agent,
        identityProduct.id,
      );
      const currentIdentityRevision = record(
        snapshotBeforeSubmit.editorRevision,
      );
      const synchronized = await db!.catalogProduct.findUniqueOrThrow({
        where: { id: identityProduct.id },
      });
      expect(synchronized.manufacturerName).toBe('Maker');
      expect(currentIdentityRevision.manufacturerNameSnapshot).toBe('Maker');
      const submitIdentity = await submitProduct(
        fullActor.agent,
        snapshotBeforeSubmit,
      );
      expect(submitIdentity.status).toBe(200);
      const pendingIdentity = await getProduct(
        fullActor.agent,
        identityProduct.id,
      );
      const frozenIdentity = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${identityProduct.id}`,
        {
          expectedVersion: pendingIdentity.version,
          baseRevisionId: pendingIdentity.pendingRevisionId,
          originalPartNumber: 'Part-B',
        },
      );
      expect(frozenIdentity.status).toBe(409);
      expect(frozenIdentity.body.code).toBe('VERSION_CONFLICT');
    });

    it('CATB-30: unchanged product and collection replacements are audited read-like no-ops', async () => {
      const category = await makeCategory(fullActor.agent);
      const product = await makeProduct(fullActor.agent, category.id);
      const before = await db!.catalogProduct.findUniqueOrThrow({
        where: { id: product.id },
      });
      const revisionCount = await db!.catalogProductRevision.count({
        where: { productId: product.id },
      });
      const actions = [
        'catalog.product.revision.created',
        'catalog.product.relations.changed',
        'catalog.product.media.changed',
        'catalog.product.documents.changed',
      ];
      const auditCount = await db!.auditEvent.count({
        where: {
          actorUserId: fullActor.id,
          outcome: 'SUCCESS',
          action: { in: actions },
        },
      });
      const baseRevisionId = before.currentDraftRevisionId!;
      const patch = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${product.id}`,
        { expectedVersion: before.version, baseRevisionId },
      );
      const relations = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${product.id}/relations`,
        { expectedVersion: before.version, relations: [] },
      );
      const media = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${product.id}/media`,
        { expectedVersion: before.version, items: [] },
      );
      const documents = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${product.id}/documents`,
        { expectedVersion: before.version, items: [] },
      );
      for (const response of [patch, relations, media, documents]) {
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(data(response).version).toBe(before.version);
      }
      const after = await db!.catalogProduct.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(after.currentDraftRevisionId).toBe(before.currentDraftRevisionId);
      expect(after.version).toBe(before.version);
      expect(
        await db!.catalogProductRevision.count({
          where: { productId: product.id },
        }),
      ).toBe(revisionCount);
      expect(
        await db!.auditEvent.count({
          where: {
            actorUserId: fullActor.id,
            outcome: 'SUCCESS',
            action: { in: actions },
          },
        }),
      ).toBe(auditCount);
      const staleNoop = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${product.id}`,
        { expectedVersion: before.version + 1, baseRevisionId },
      );
      expect(staleNoop.status).toBe(409);
      expect(staleNoop.body.code).toBe('VERSION_CONFLICT');
    });

    it('CATB-38: staff product filters match current pointers and exclude non-current history', async () => {
      const category = await makeCategory(fullActor.agent);
      const otherCategory = await makeCategory(fullActor.agent);
      const draft = await makeProduct(fullActor.agent, category.id);
      const pending = await makeProduct(fullActor.agent, category.id);
      expect((await submitProduct(fullActor.agent, pending)).status).toBe(200);
      const published = await publishProduct(
        fullActor.agent,
        await makeProduct(fullActor.agent, category.id),
      );
      const archived = await makeProduct(fullActor.agent, category.id);
      const archiveResult = await fullActor.agent.write(
        'POST',
        `/v1/staff/catalog/products/${archived.id}/archive`,
        { expectedVersion: archived.version },
      );
      expect(archiveResult.status).toBe(200);

      const historical = await makeProduct(fullActor.agent, category.id);
      const historicalBefore = await getProduct(fullActor.agent, historical.id);
      const moved = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${historical.id}`,
        {
          expectedVersion: historicalBefore.version,
          baseRevisionId: historicalBefore.currentDraftRevisionId,
          categoryId: otherCategory.id,
        },
      );
      expect(moved.status).toBe(200);
      const historicalCurrent = await getProduct(
        fullActor.agent,
        historical.id,
      );
      expect(historicalCurrent.currentDraftRevisionId).toBeTruthy();

      const list = async (query: string) => {
        const response = await fullActor.agent.request(
          'GET',
          `/v1/staff/catalog/products?${query}`,
        );
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return response.body.data as JsonRecord[];
      };
      const drafts = await list(
        `publicationState=DRAFT&categoryId=${category.id}`,
      );
      const pendings = await list(
        `publicationState=PENDING_REVIEW&categoryId=${category.id}`,
      );
      const publishedRows = await list(
        `publicationState=PUBLISHED&categoryId=${category.id}`,
      );
      const archivedRows = await list('publicationState=ARCHIVED');
      expect(drafts.some(({ id }) => id === draft.id)).toBe(true);
      expect(pendings.some(({ id }) => id === pending.id)).toBe(true);
      expect(publishedRows.some(({ id }) => id === published.id)).toBe(true);
      expect(archivedRows.some(({ id }) => id === archived.id)).toBe(true);
      expect(drafts.some(({ id }) => id === historical.id)).toBe(false);
      const oldCategoryRows = await list(`categoryId=${category.id}`);
      expect(oldCategoryRows.some(({ id }) => id === historical.id)).toBe(
        false,
      );
      const newCategoryRows = await list(
        `publicationState=DRAFT&categoryId=${otherCategory.id}`,
      );
      expect(newCategoryRows.some(({ id }) => id === historical.id)).toBe(true);
      const archivedWithCategory = await fullActor.agent.request(
        'GET',
        `/v1/staff/catalog/products?publicationState=ARCHIVED&categoryId=${category.id}`,
      );
      expect(archivedWithCategory.status).toBe(400);
      expect(archivedWithCategory.body.code).toBe('VALIDATION_ERROR');
    });

    it('CATB-13/14: permission groups and file metadata enforce both RBAC and object ownership', async () => {
      const denied = await noCatalogActor.agent.request(
        'GET',
        '/v1/staff/catalog/categories',
      );
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('FORBIDDEN');
      const category = await makeCategory(fullActor.agent);
      const product = await makeProduct(fullActor.agent, category.id);
      const deniedCases: {
        permission: string;
        method: string;
        path: string;
        body?: unknown;
      }[] = [
        {
          permission: 'catalog.references.read',
          method: 'GET',
          path: '/v1/staff/catalog/categories',
        },
        {
          permission: 'catalog.products.read',
          method: 'GET',
          path: `/v1/staff/catalog/products/${product.id}`,
        },
        {
          permission: 'catalog.products.write',
          method: 'POST',
          path: '/v1/staff/catalog/products',
          body: {
            slug: randomSlug('denied-product'),
            categoryId: category.id,
            displayName: 'Denied product create',
          },
        },
        {
          permission: 'catalog.products.submit',
          method: 'POST',
          path: `/v1/staff/catalog/products/${product.id}/submit`,
          body: { expectedVersion: product.version },
        },
        {
          permission: 'catalog.products.publish',
          method: 'POST',
          path: `/v1/staff/catalog/products/${product.id}/review`,
          body: {
            expectedVersion: product.version,
            revisionId: product.currentDraftRevisionId,
            decision: 'PUBLISH',
          },
        },
        {
          permission: 'catalog.products.archive',
          method: 'POST',
          path: `/v1/staff/catalog/products/${product.id}/archive`,
          body: { expectedVersion: product.version },
        },
        {
          permission: 'catalog.categories.write',
          method: 'POST',
          path: '/v1/staff/catalog/categories',
          body: {
            slug: randomSlug('denied-category'),
            name: 'Denied category',
          },
        },
        {
          permission: 'catalog.brands.write',
          method: 'POST',
          path: '/v1/staff/catalog/brands',
          body: { slug: randomSlug('denied-brand'), name: 'Denied brand' },
        },
        {
          permission: 'catalog.attributes.write',
          method: 'POST',
          path: '/v1/staff/catalog/attributes',
          body: {
            categoryId: category.id,
            code: `denied_${randomUUID().slice(0, 8)}`,
            label: 'Denied attribute',
            valueType: 'TEXT',
            filterable: true,
            searchable: true,
            comparable: true,
          },
        },
        {
          permission: 'catalog.products.relations.write',
          method: 'PUT',
          path: `/v1/staff/catalog/products/${product.id}/relations`,
          body: { expectedVersion: product.version, relations: [] },
        },
        {
          permission: 'catalog.products.media.write',
          method: 'PUT',
          path: `/v1/staff/catalog/products/${product.id}/media`,
          body: { expectedVersion: product.version, items: [] },
        },
        {
          permission: 'catalog.products.documents.write',
          method: 'PUT',
          path: `/v1/staff/catalog/products/${product.id}/documents`,
          body: { expectedVersion: product.version, items: [] },
        },
      ];
      for (const deniedCase of deniedCases) {
        const actor = await makeActor(
          testPermissions.filter(
            (permission) => permission !== deniedCase.permission,
          ),
          `deny-${deniedCase.permission.split('.').at(-1)}`,
        );
        const response =
          deniedCase.method === 'GET'
            ? await actor.agent.request(deniedCase.method, deniedCase.path)
            : await actor.agent.write(
                deniedCase.method,
                deniedCase.path,
                deniedCase.body,
              );
        expect(
          response.status,
          `${deniedCase.permission}: ${JSON.stringify(response.body)}`,
        ).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN');
      }
      const missingFilePermission = await makeActor(
        testPermissions.filter(
          (permission) => permission !== 'files.metadata.read',
        ),
        'deny-file-metadata',
      );
      const deniedMediaMetadata = await missingFilePermission.agent.request(
        'GET',
        `/v1/staff/catalog/products/${product.id}/media`,
      );
      expect(deniedMediaMetadata.status).toBe(403);
      expect(deniedMediaMetadata.body.code).toBe('FORBIDDEN');
      const ownFile = await createFileVersion(fullActor.id);
      const otherFile = await createFileVersion(readOnlyActor.id);
      const unknownFileVersion = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${product.id}/media`,
        {
          expectedVersion: product.version,
          items: [
            {
              fileVersionId: randomUUID(),
              altText: 'Unknown file version',
              caption: null,
              sortOrder: 0,
              isPrimary: false,
            },
          ],
        },
      );
      expect(unknownFileVersion.status).toBe(404);
      expect(unknownFileVersion.body.code).toBe('FILE_NOT_ACCESSIBLE');
      const privateForeignFileVersion = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${product.id}/media`,
        {
          expectedVersion: product.version,
          items: [
            {
              fileVersionId: otherFile.fileVersionId,
              altText: 'Private file owned by another staff member',
              caption: null,
              sortOrder: 0,
              isPrimary: false,
            },
          ],
        },
      );
      expect(privateForeignFileVersion.status).toBe(404);
      expect(privateForeignFileVersion.body.code).toBe('FILE_NOT_ACCESSIBLE');
      const metadata = {
        expectedVersion: product.version,
        items: [
          {
            fileVersionId: ownFile.fileVersionId,
            altText: 'Front view',
            caption: null,
            sortOrder: 0,
            isPrimary: true,
          },
        ],
      };
      const attached = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${product.id}/media`,
        metadata,
      );
      expect(attached.status).toBe(200);
      const current = await getProduct(fullActor.agent, product.id);
      const visible = await fullActor.agent.request(
        'GET',
        `/v1/staff/catalog/products/${product.id}/media`,
      );
      expect(visible.status).toBe(200);
      expect(JSON.stringify(visible.body)).not.toMatch(
        /storageKey|downloadUrl|fileUrl|storage\/|\/files\//i,
      );
      expect((visible.body.data as JsonRecord[])[0]?.fileVersionId).toBe(
        ownFile.fileVersionId,
      );

      const unauthorizedMetadataActor = await makeActor(
        ['catalog.products.read', 'catalog.products.media.write'],
        'no-file-permission',
      );
      const noFileRead = await unauthorizedMetadataActor.agent.request(
        'GET',
        `/v1/staff/catalog/products/${product.id}/media`,
      );
      expect(noFileRead.status).toBe(403);
      const foreign = await unauthorizedMetadataActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${product.id}/media`,
        {
          expectedVersion: current.version,
          items: [
            {
              fileVersionId: otherFile.fileVersionId,
              altText: 'Foreign file',
              caption: null,
              sortOrder: 0,
              isPrimary: false,
            },
          ],
        },
      );
      expect(foreign.status).toBe(403);
      const readOnlyForeign = await readOnlyActor.agent.request(
        'GET',
        `/v1/staff/catalog/products/${product.id}/media`,
      );
      const foreignMetadataActor = await makeActor(
        ['catalog.products.read', 'files.metadata.read'],
        'foreign-file-reader',
      );
      const unreadableForeign = await foreignMetadataActor.agent.request(
        'GET',
        `/v1/staff/catalog/products/${product.id}/media`,
      );
      expect(readOnlyForeign.status).toBe(403);
      expect(unreadableForeign.status).toBe(404);
      expect(unreadableForeign.body.code).toBe('FILE_NOT_ACCESSIBLE');

      const internalFile = await createFileVersion(fullActor.id, 'INTERNAL');
      const sellerId = randomUUID();
      await db!.sellerLegalEntity.create({
        data: {
          id: sellerId,
          displayName: `Runtime seller ${sellerId.slice(0, 8)}`,
          kind: 'OOO',
          state: 'DRAFT',
        },
      });
      await db!.fileLink.create({
        data: {
          id: randomUUID(),
          fileObjectId: internalFile.fileObjectId,
          fileVersionId: internalFile.fileVersionId,
          sellerLegalEntityId: sellerId,
          visibility: 'INTERNAL',
          createdByUserId: fullActor.id,
        },
      });
      const internalAttached = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${product.id}/media`,
        {
          expectedVersion: current.version,
          items: [
            {
              fileVersionId: internalFile.fileVersionId,
              altText: 'Linked internal image',
              caption: null,
              sortOrder: 0,
              isPrimary: true,
            },
          ],
        },
      );
      expect(internalAttached.status).toBe(200);
      const withoutSellerRead = await foreignMetadataActor.agent.request(
        'GET',
        `/v1/staff/catalog/products/${product.id}/media`,
      );
      expect(withoutSellerRead.status).toBe(404);
      expect(withoutSellerRead.body.code).toBe('FILE_NOT_ACCESSIBLE');
      const linkedReader = await makeActor(
        ['catalog.products.read', 'files.metadata.read', 'sellers.read'],
        'internal-linked-reader',
      );
      const withSellerRead = await linkedReader.agent.request(
        'GET',
        `/v1/staff/catalog/products/${product.id}/media`,
      );
      expect(withSellerRead.status).toBe(200);
      expect((withSellerRead.body.data as JsonRecord[])[0]?.fileVersionId).toBe(
        internalFile.fileVersionId,
      );
    });

    it('CATB-19: simultaneous draft writers serialize through the product root and leave one complete revision', async () => {
      const category = await makeCategory(fullActor.agent);
      const product = await makeProduct(fullActor.agent, category.id);
      const secondWriter = await makeActor(testPermissions, 'product-race');
      const current = await getProduct(fullActor.agent, product.id);
      const baseRevisionId = record(current.editorRevision).id as string;
      const path = `/v1/staff/catalog/products/${product.id}`;
      const barrier = installRequestBarrier(path);
      const csrf = await fullActor.agent.csrf();
      const secondCsrf = await secondWriter.agent.csrf();
      const writes = Promise.all([
        secondWriter.agent.request(
          'PATCH',
          path,
          {
            expectedVersion: current.version,
            baseRevisionId,
            summary: 'writer one',
          },
          { csrf: secondCsrf },
        ),
        fullActor.agent.request(
          'PATCH',
          path,
          {
            expectedVersion: current.version,
            baseRevisionId,
            description: 'writer two',
          },
          { csrf },
        ),
      ]);
      await barrier.arrived;
      const results = await writes;
      expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(results.find(({ status }) => status === 409)?.body.code).toBe(
        'VERSION_CONFLICT',
      );
      const after = await getProduct(fullActor.agent, product.id);
      expect(after.version).toBe(current.version + 1);
      expect(after.revisionHistory).toHaveLength(2);
    });

    it('CATB-34: relation and publication operations serialize with target archive and republish', async () => {
      const category = await makeCategory(fullActor.agent);

      const archivedTarget = await makeProduct(fullActor.agent, category.id);
      const publishedTarget = await publishProduct(
        fullActor.agent,
        archivedTarget,
      );
      const targetRevisionId = publishedTarget.publishedRevisionId!;
      const relationSource = await makeProduct(fullActor.agent, category.id);
      const relationWriter = await makeActor(
        testPermissions,
        'relation-target-race-writer',
      );
      const targetArchiver = await makeActor(
        testPermissions,
        'relation-target-race-archiver',
      );
      const relationSourceBefore = await getProduct(
        fullActor.agent,
        relationSource.id,
      );
      const [relationResult, archiveResult] =
        await raceProductOperationsAgainstTargetLock(
          archivedTarget.id,
          () =>
            relationWriter.agent.write(
              'PUT',
              `/v1/staff/catalog/products/${relationSource.id}/relations`,
              {
                expectedVersion: relationSourceBefore.version,
                relations: [
                  {
                    targetProductId: archivedTarget.id,
                    targetRevisionId,
                    relationType: 'ACCESSORY',
                    sortOrder: 0,
                  },
                ],
              },
            ),
          () =>
            targetArchiver.agent.write(
              'POST',
              `/v1/staff/catalog/products/${archivedTarget.id}/archive`,
              { expectedVersion: publishedTarget.version },
            ),
        );
      expect(relationResult.status, JSON.stringify(relationResult.body)).toBe(
        200,
      );
      expect(archiveResult.status, JSON.stringify(archiveResult.body)).toBe(
        200,
      );
      const persistedRelation = await db!.productRelation.findFirstOrThrow({
        where: {
          sourceRevision: { productId: relationSource.id },
          targetProductId: archivedTarget.id,
        },
      });
      expect(persistedRelation.targetRevisionId).toBe(targetRevisionId);
      expect(
        (
          await db!.catalogProduct.findUniqueOrThrow({
            where: { id: archivedTarget.id },
          })
        ).publicationState,
      ).toBe('ARCHIVED');
      const staleSubmit = await submitProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, relationSource.id),
      );
      expect(staleSubmit.status).toBe(409);
      expect(staleSubmit.body.code).toBe('REFERENCE_IN_USE');

      const republishedTarget = await makeProduct(fullActor.agent, category.id);
      const targetV1 = await publishProduct(fullActor.agent, republishedTarget);
      const sourceForRepublishRace = await makeProduct(
        fullActor.agent,
        category.id,
      );
      const relationSetup = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${sourceForRepublishRace.id}/relations`,
        {
          expectedVersion: sourceForRepublishRace.version,
          relations: [
            {
              targetProductId: republishedTarget.id,
              targetRevisionId: targetV1.publishedRevisionId,
              relationType: 'ACCESSORY',
              sortOrder: 0,
            },
          ],
        },
      );
      expect(relationSetup.status, JSON.stringify(relationSetup.body)).toBe(
        200,
      );
      const sourceBeforeSubmit = await getProduct(
        fullActor.agent,
        sourceForRepublishRace.id,
      );
      const targetEditor = await makeActor(
        testPermissions,
        'target-republish-race-editor',
      );
      const sourceSubmitter = await makeActor(
        testPermissions,
        'source-republish-race-submitter',
      );
      const [sourceSubmit, targetDraft] =
        await raceProductOperationsAgainstTargetLock(
          republishedTarget.id,
          () => submitProduct(sourceSubmitter.agent, sourceBeforeSubmit),
          () =>
            targetEditor.agent.write(
              'PATCH',
              `/v1/staff/catalog/products/${republishedTarget.id}`,
              {
                expectedVersion: targetV1.version,
                baseRevisionId: targetV1.publishedRevisionId,
                summary:
                  'Concurrent target republish invalidates exact relation.',
              },
            ),
        );
      expect(sourceSubmit.status, JSON.stringify(sourceSubmit.body)).toBe(200);
      expect(targetDraft.status, JSON.stringify(targetDraft.body)).toBe(200);
      const targetV2 = await publishProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, republishedTarget.id),
      );
      expect(targetV2.publishedRevisionId).not.toBe(
        targetV1.publishedRevisionId,
      );
      const rejectedStalePublish = await reviewPendingProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, sourceForRepublishRace.id),
        'PUBLISH',
      );
      expect(rejectedStalePublish.status).toBe(409);
      expect(rejectedStalePublish.body.code).toBe('REFERENCE_IN_USE');
      const sourceAfterRejection = await getProduct(
        fullActor.agent,
        sourceForRepublishRace.id,
      );
      expect(sourceAfterRejection.publishedRevisionId).toBeNull();
      const notPublic = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/products/${(await db!.catalogProduct.findUniqueOrThrow({ where: { id: sourceForRepublishRace.id } })).slug}`,
      );
      expect(notPublic.status).toBe(404);

      const archiveReviewTarget = await makeProduct(
        fullActor.agent,
        category.id,
      );
      const archiveReviewTargetPublished = await publishProduct(
        fullActor.agent,
        archiveReviewTarget,
      );
      const archiveReviewSource = await makeProduct(
        fullActor.agent,
        category.id,
      );
      const archiveReviewRelation = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${archiveReviewSource.id}/relations`,
        {
          expectedVersion: archiveReviewSource.version,
          relations: [
            {
              targetProductId: archiveReviewTarget.id,
              targetRevisionId:
                archiveReviewTargetPublished.publishedRevisionId,
              relationType: 'ACCESSORY',
              sortOrder: 0,
            },
          ],
        },
      );
      expect(
        archiveReviewRelation.status,
        JSON.stringify(archiveReviewRelation.body),
      ).toBe(200);
      const archiveReviewPending = await submitProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, archiveReviewSource.id),
      );
      expect(archiveReviewPending.status).toBe(200);
      const archiveReviewActor = await makeActor(
        testPermissions,
        'source-publish-target-archive-reviewer',
      );
      const archiveTargetActor = await makeActor(
        testPermissions,
        'target-archive-during-review',
      );
      const [sourcePublishedBeforeArchive, targetArchived] =
        await raceProductOperationsAgainstTargetLock(
          archiveReviewTarget.id,
          async () =>
            reviewPendingProduct(
              archiveReviewActor.agent,
              await getProduct(
                archiveReviewActor.agent,
                archiveReviewSource.id,
              ),
              'PUBLISH',
            ),
          () =>
            archiveTargetActor.agent.write(
              'POST',
              `/v1/staff/catalog/products/${archiveReviewTarget.id}/archive`,
              { expectedVersion: archiveReviewTargetPublished.version },
            ),
        );
      expect(
        sourcePublishedBeforeArchive.status,
        JSON.stringify(sourcePublishedBeforeArchive.body),
      ).toBe(200);
      expect(targetArchived.status, JSON.stringify(targetArchived.body)).toBe(
        200,
      );
      const archiveReviewPublic = await archiveReviewActor.agent.request(
        'GET',
        `/v1/public/catalog/products/${(await db!.catalogProduct.findUniqueOrThrow({ where: { id: archiveReviewSource.id } })).slug}`,
      );
      expect(archiveReviewPublic.status).toBe(200);
      expect(data(archiveReviewPublic).relations).toEqual([]);

      const raceRepublishTarget = await makeProduct(
        fullActor.agent,
        category.id,
      );
      const raceRepublishTargetV1 = await publishProduct(
        fullActor.agent,
        raceRepublishTarget,
      );
      const targetSecondDraft = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${raceRepublishTarget.id}`,
        {
          expectedVersion: raceRepublishTargetV1.version,
          baseRevisionId: raceRepublishTargetV1.publishedRevisionId,
          summary: 'Target republish race draft.',
        },
      );
      expect(targetSecondDraft.status).toBe(200);
      const targetPendingReview = await submitProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, raceRepublishTarget.id),
      );
      expect(targetPendingReview.status).toBe(200);
      const republishReviewSource = await makeProduct(
        fullActor.agent,
        category.id,
      );
      const republishReviewRelation = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${republishReviewSource.id}/relations`,
        {
          expectedVersion: republishReviewSource.version,
          relations: [
            {
              targetProductId: raceRepublishTarget.id,
              targetRevisionId: raceRepublishTargetV1.publishedRevisionId,
              relationType: 'ACCESSORY',
              sortOrder: 0,
            },
          ],
        },
      );
      expect(
        republishReviewRelation.status,
        JSON.stringify(republishReviewRelation.body),
      ).toBe(200);
      const sourcePendingReview = await submitProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, republishReviewSource.id),
      );
      expect(sourcePendingReview.status).toBe(200);
      const sourceReviewActor = await makeActor(
        testPermissions,
        'source-publish-target-republish-reviewer',
      );
      const targetReviewActor = await makeActor(
        testPermissions,
        'target-republish-during-review',
      );
      const [sourcePublishedBeforeRepublish, targetRepublished] =
        await raceProductOperationsAgainstTargetLock(
          raceRepublishTarget.id,
          async () =>
            reviewPendingProduct(
              sourceReviewActor.agent,
              await getProduct(
                sourceReviewActor.agent,
                republishReviewSource.id,
              ),
              'PUBLISH',
            ),
          async () =>
            reviewPendingProduct(
              targetReviewActor.agent,
              await getProduct(targetReviewActor.agent, raceRepublishTarget.id),
              'PUBLISH',
            ),
        );
      expect(
        sourcePublishedBeforeRepublish.status,
        JSON.stringify(sourcePublishedBeforeRepublish.body),
      ).toBe(200);
      expect(
        targetRepublished.status,
        JSON.stringify(targetRepublished.body),
      ).toBe(200);
      expect(targetRepublished.body.data).toBeTruthy();
      const finalTarget = await getProduct(
        fullActor.agent,
        raceRepublishTarget.id,
      );
      expect(finalTarget.publishedRevisionId).not.toBe(
        raceRepublishTargetV1.publishedRevisionId,
      );
      const republishReviewPublic = await sourceReviewActor.agent.request(
        'GET',
        `/v1/public/catalog/products/${(await db!.catalogProduct.findUniqueOrThrow({ where: { id: republishReviewSource.id } })).slug}`,
      );
      expect(republishReviewPublic.status).toBe(200);
      expect(data(republishReviewPublic).relations).toEqual([]);
    });

    it('CATB-32/33: reference creation wins its observed row lock before archive and the archive rechecks usage', async () => {
      const parent = await makeCategory(fullActor.agent);
      const archiveActor = await makeActor(testPermissions, 'parent-archive');
      const blocker = new Client({
        connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
        application_name: 'r1-004b-category-parent-race-blocker',
      });
      const observer = new Client({
        connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
        application_name: 'r1-004b-category-parent-race-observer',
      });
      await Promise.all([blocker.connect(), observer.connect()]);
      let transactionOpen = false;
      let childCreate: Promise<ApiResult> | undefined;
      let archive: Promise<ApiResult> | undefined;
      try {
        await blocker.query('BEGIN');
        transactionOpen = true;
        await blocker.query(
          'SELECT id FROM category WHERE id=$1::uuid FOR UPDATE',
          [parent.id],
        );
        const blockerPid = Number(
          (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );
        childCreate = fullActor.agent.write(
          'POST',
          '/v1/staff/catalog/categories',
          {
            slug: randomSlug('child'),
            name: 'Concurrent child',
            parentId: parent.id,
          },
        );
        const childPid = await waitUntilBlocked(
          observer,
          blockerPid,
          'FOR UPDATE',
        );
        archive = archiveActor.agent.write(
          'POST',
          `/v1/staff/catalog/categories/${parent.id}/archive`,
          { expectedVersion: parent.version },
        );
        await waitUntilBlocked(observer, childPid, 'pg_advisory_xact_lock');
        await blocker.query('COMMIT');
        transactionOpen = false;
        const [created, archived] = await Promise.all([childCreate, archive]);
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        expect(archived.status).toBe(409);
        expect(archived.body.code).toBe('REFERENCE_IN_USE');
        const activeChildren = await db!.category.count({
          where: { parentId: parent.id, state: 'ACTIVE' },
        });
        expect(activeChildren).toBe(1);
      } finally {
        if (transactionOpen)
          await blocker.query('ROLLBACK').catch(() => undefined);
        await Promise.allSettled(
          [childCreate, archive].filter(
            (request): request is Promise<ApiResult> => request !== undefined,
          ),
        );
        await Promise.allSettled([blocker.end(), observer.end()]);
      }

      const reparentTarget = await makeCategory(fullActor.agent);
      const formerParent = await makeCategory(fullActor.agent);
      const childToReparent = await makeCategory(fullActor.agent, {
        parentId: formerParent.id,
      });
      const reparentActor = await makeActor(
        testPermissions,
        'reparent-archive-race-writer',
      );
      const reparentArchiveActor = await makeActor(
        testPermissions,
        'reparent-archive-race-archiver',
      );
      const reparentBlocker = new Client({
        connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
        application_name: 'r1-004b-category-reparent-archive-blocker',
      });
      const reparentObserver = new Client({
        connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
        application_name: 'r1-004b-category-reparent-archive-observer',
      });
      await Promise.all([
        reparentBlocker.connect(),
        reparentObserver.connect(),
      ]);
      let reparentTransactionOpen = false;
      let reparentRequest: Promise<ApiResult> | undefined;
      let reparentArchive: Promise<ApiResult> | undefined;
      try {
        await reparentBlocker.query('BEGIN');
        reparentTransactionOpen = true;
        await reparentBlocker.query(
          'SELECT pg_advisory_xact_lock(1398031445,3)',
        );
        const treeLockBlockerPid = Number(
          (await reparentBlocker.query('SELECT pg_backend_pid() AS pid'))
            .rows[0].pid,
        );
        reparentRequest = reparentActor.agent.write(
          'PATCH',
          `/v1/staff/catalog/categories/${childToReparent.id}`,
          {
            expectedVersion: childToReparent.version,
            parentId: reparentTarget.id,
          },
        );
        const reparentPid = await waitUntilBlocked(
          reparentObserver,
          treeLockBlockerPid,
          'pg_advisory_xact_lock',
        );
        reparentArchive = reparentArchiveActor.agent.write(
          'POST',
          `/v1/staff/catalog/categories/${reparentTarget.id}/archive`,
          { expectedVersion: reparentTarget.version },
        );
        await waitUntilBlocked(
          reparentObserver,
          reparentPid,
          'pg_advisory_xact_lock',
        );
        await reparentBlocker.query('COMMIT');
        reparentTransactionOpen = false;
        const [reparented, archived] = await Promise.all([
          reparentRequest,
          reparentArchive,
        ]);
        expect(reparented.status, JSON.stringify(reparented.body)).toBe(200);
        expect(archived.status).toBe(409);
        expect(archived.body.code).toBe('REFERENCE_IN_USE');
        expect(
          (
            await db!.category.findUniqueOrThrow({
              where: { id: reparentTarget.id },
            })
          ).state,
        ).toBe('ACTIVE');
        expect(
          (
            await db!.category.findUniqueOrThrow({
              where: { id: childToReparent.id },
            })
          ).parentId,
        ).toBe(reparentTarget.id);
      } finally {
        if (reparentTransactionOpen)
          await reparentBlocker.query('ROLLBACK').catch(() => undefined);
        await Promise.allSettled(
          [reparentRequest, reparentArchive].filter(
            (request): request is Promise<ApiResult> => request !== undefined,
          ),
        );
        await Promise.allSettled([
          reparentBlocker.end(),
          reparentObserver.end(),
        ]);
      }

      const category = await makeCategory(fullActor.agent);
      const brand = await makeBrand(fullActor.agent);
      const referenceArchiveActor = await makeActor(
        testPermissions,
        'reference-archive',
      );
      const attribute = await makeAttribute(
        fullActor.agent,
        category.id,
        'race_attribute',
        'TEXT',
      );
      await assertReferenceUsageRace({
        table: 'category',
        referenceId: category.id,
        create: () =>
          fullActor.agent.write('POST', '/v1/staff/catalog/products', {
            slug: randomSlug('race-category-product'),
            categoryId: category.id,
            displayName: 'Category usage race',
          }),
        archive: () =>
          referenceArchiveActor.agent.write(
            'POST',
            `/v1/staff/catalog/categories/${category.id}/archive`,
            { expectedVersion: category.version },
          ),
      });
      await assertReferenceUsageRace({
        table: 'brand',
        referenceId: brand.id,
        create: () =>
          fullActor.agent.write('POST', '/v1/staff/catalog/products', {
            slug: randomSlug('race-brand-product'),
            categoryId: category.id,
            brandId: brand.id,
            displayName: 'Brand usage race',
          }),
        archive: () =>
          referenceArchiveActor.agent.write(
            'POST',
            `/v1/staff/catalog/brands/${brand.id}/archive`,
            { expectedVersion: brand.version },
          ),
      });
      await assertReferenceUsageRace({
        table: 'attribute_definition',
        referenceId: attribute.id,
        create: () =>
          fullActor.agent.write('POST', '/v1/staff/catalog/products', {
            slug: randomSlug('race-attribute-product'),
            categoryId: category.id,
            displayName: 'Attribute usage race',
            attributes: [
              {
                attributeDefinitionId: attribute.id,
                valueType: 'TEXT',
                value: 'concurrent',
              },
            ],
          }),
        archive: () =>
          referenceArchiveActor.agent.write(
            'POST',
            `/v1/staff/catalog/attributes/${attribute.id}/archive`,
            { expectedVersion: attribute.version },
          ),
      });
    });

    it('CATB-16/17/18/20/21/30/31/36: publication gates, self-review, audit rollback, immutable history, and terminal archive', async () => {
      const category = await makeCategory(fullActor.agent);
      const product = await makeProduct(fullActor.agent, category.id, {
        manufacturerName: 'Original maker',
        originalPartNumber: 'PART-001',
        modification: 'A',
      });
      const pendingOnly = await makeActor(
        ['catalog.products.submit', 'catalog.products.read'],
        'submit-only',
      );
      const submit = await submitProduct(pendingOnly.agent, product);
      expect(submit.status).toBe(200);
      const pending = await getProduct(fullActor.agent, product.id);
      expect(pending.publishedRevisionId).toBeNull();
      const unpublished = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/products/${(await db!.catalogProduct.findUniqueOrThrow({ where: { id: product.id } })).slug}`,
      );
      expect(unpublished.status).toBe(404);
      const deniedReview = await pendingOnly.agent.write(
        'POST',
        `/v1/staff/catalog/products/${product.id}/review`,
        {
          expectedVersion: pending.version,
          revisionId: pending.pendingRevisionId,
          decision: 'PUBLISH',
        },
      );
      expect(deniedReview.status).toBe(403);

      const firstPublish = await reviewPendingProduct(
        fullActor.agent,
        pending,
        'PUBLISH',
      );
      expect(firstPublish.status).toBe(200);
      const published = await getProduct(fullActor.agent, product.id);
      expect(published.currentDraftRevisionId).toBeNull();
      expect(published.publishedRevisionId).toBe(pending.pendingRevisionId);
      const publicBefore = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/products/${(await db!.catalogProduct.findUniqueOrThrow({ where: { id: product.id } })).slug}`,
      );
      expect(publicBefore.status).toBe(200);

      const baseRevisionId = published.publishedRevisionId!;
      const secondDraft = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${product.id}`,
        {
          expectedVersion: published.version,
          baseRevisionId,
          summary: 'A new immutable revision',
        },
      );
      expect(secondDraft.status).toBe(200);
      const afterDraft = await getProduct(fullActor.agent, product.id);
      expect(afterDraft.publishedRevisionId).toBe(baseRevisionId);
      const publicStillFirst = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/products/${(await db!.catalogProduct.findUniqueOrThrow({ where: { id: product.id } })).slug}`,
      );
      expect(data(publicStillFirst).summary).toBe(data(publicBefore).summary);
      const secondPublished = await publishProduct(fullActor.agent, afterDraft);
      expect(secondPublished.publishedRevisionId).not.toBe(baseRevisionId);

      const rejectedDraft = await makeProduct(fullActor.agent, category.id);
      const submitted = await submitProduct(fullActor.agent, rejectedDraft);
      expect(submitted.status).toBe(200);
      const pendingReject = await getProduct(fullActor.agent, rejectedDraft.id);
      const rejected = await reviewPendingProduct(
        fullActor.agent,
        pendingReject,
        'REJECT',
        'Rejected in the isolated runtime test.',
      );
      expect(rejected.status).toBe(200);
      const rejectHistory = await getProduct(fullActor.agent, rejectedDraft.id);
      const rejectedRevision = rejectHistory.revisionHistory!.find(
        (revision) => revision.state === 'REJECTED',
      );
      expect(rejectedRevision?.decisionReason).toBe(
        'Rejected in the isolated runtime test.',
      );
      const corrected = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${rejectedDraft.id}`,
        {
          expectedVersion: rejectHistory.version,
          baseRevisionId: rejectedRevision!.id,
          displayName: 'Corrected after rejection',
        },
      );
      expect(corrected.status).toBe(200);
      const correctedProduct = await getProduct(
        fullActor.agent,
        rejectedDraft.id,
      );
      expect(correctedProduct.revisionHistory).toHaveLength(2);

      const auditFailureProduct = await makeProduct(
        fullActor.agent,
        category.id,
      );
      expect(
        (await submitProduct(fullActor.agent, auditFailureProduct)).status,
      ).toBe(200);
      const auditFailureBefore = await db!.catalogProduct.findUniqueOrThrow({
        where: { id: auditFailureProduct.id },
      });
      const auditFailureRevisionBefore =
        await db!.catalogProductRevision.findUniqueOrThrow({
          where: { id: auditFailureBefore.pendingRevisionId! },
        });
      const auditSuccessBefore = await db!.auditEvent.count({
        where: {
          action: 'catalog.product.reviewed',
          outcome: 'SUCCESS',
          entityId: auditFailureBefore.pendingRevisionId!,
        },
      });

      const triggerToken = randomUUID().replaceAll('-', '');
      const functionName = `r1_004b_reject_${triggerToken}`;
      const triggerName = `r1_004b_audit_${triggerToken}`;
      await ownerPg!.query(`
      CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action='catalog.product.reviewed' AND NEW.outcome='SUCCESS' THEN
          RAISE EXCEPTION 'test-only catalog audit rejection';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
      await ownerPg!.query(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`,
      );
      try {
        const failedMutation = await reviewPendingProduct(
          fullActor.agent,
          auditFailureProduct,
          'PUBLISH',
        );
        expect(failedMutation.status).toBe(503);
        expect(failedMutation.body.code).toBe('AUDIT_UNAVAILABLE');
        expect(
          await db!.catalogProduct.findUniqueOrThrow({
            where: { id: auditFailureProduct.id },
          }),
        ).toEqual(auditFailureBefore);
        expect(
          await db!.catalogProductRevision.findUniqueOrThrow({
            where: { id: auditFailureBefore.pendingRevisionId! },
          }),
        ).toEqual(auditFailureRevisionBefore);
        expect(
          await db!.auditEvent.count({
            where: {
              action: 'catalog.product.reviewed',
              outcome: 'SUCCESS',
              entityId: auditFailureBefore.pendingRevisionId!,
            },
          }),
        ).toBe(auditSuccessBefore);
        const notPublished = await fullActor.agent.request(
          'GET',
          `/v1/public/catalog/products/${(await db!.catalogProduct.findUniqueOrThrow({ where: { id: auditFailureProduct.id } })).slug}`,
        );
        expect(notPublished.status).toBe(404);
      } finally {
        await ownerPg!.query(
          `DROP TRIGGER IF EXISTS ${triggerName} ON audit_event`,
        );
        await ownerPg!.query(
          `DROP FUNCTION IF EXISTS public.${functionName}()`,
        );
      }
      const successfulRetry = await reviewPendingProduct(
        fullActor.agent,
        auditFailureProduct,
        'PUBLISH',
      );
      expect(successfulRetry.status).toBe(200);

      const pendingArchive = await makeProduct(fullActor.agent, category.id);
      const pendingSubmit = await submitProduct(
        fullActor.agent,
        pendingArchive,
      );
      expect(pendingSubmit.status).toBe(200);
      const pendingState = await getProduct(fullActor.agent, pendingArchive.id);
      const archivedPending = await fullActor.agent.write(
        'POST',
        `/v1/staff/catalog/products/${pendingArchive.id}/archive`,
        { expectedVersion: pendingState.version },
      );
      expect(archivedPending.status).toBe(200);
      const archivedState = await getProduct(
        fullActor.agent,
        pendingArchive.id,
      );
      expect(archivedState.publicationState).toBe('ARCHIVED');
      expect(archivedState.currentDraftRevisionId).toBeNull();
      expect(archivedState.pendingRevisionId).toBeNull();
      expect(archivedState.publishedRevisionId).toBeNull();
      const withdrawn = archivedState.revisionHistory!.find(
        (revision) => revision.state === 'WITHDRAWN',
      );
      expect(withdrawn).toBeTruthy();
      const publicArchived = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/products/${(await db!.catalogProduct.findUniqueOrThrow({ where: { id: pendingArchive.id } })).slug}`,
      );
      expect(publicArchived.status).toBe(404);
    });

    it('CATB-22/23/24/25/35/37: public projection, manual relations, typed filters and bounded direct-child pagination', async () => {
      const parent = await makeCategory(fullActor.agent, { sortOrder: 10 });
      const firstChild = await makeCategory(fullActor.agent, {
        parentId: parent.id,
        sortOrder: 1,
      });
      await makeCategory(fullActor.agent, {
        parentId: parent.id,
        sortOrder: 2,
      });
      await makeCategory(fullActor.agent, {
        parentId: parent.id,
        sortOrder: 3,
      });
      const invalidOrder = await fullActor.agent.write(
        'POST',
        '/v1/staff/catalog/categories',
        { slug: randomSlug('negative-sort'), name: 'Negative', sortOrder: -1 },
      );
      expect(invalidOrder.status).toBe(400);
      const categoryPage = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/categories?parentSlug=${parent.slug}&pageSize=2`,
      );
      expect(categoryPage.status).toBe(200);
      expect(
        (categoryPage.body.data as JsonRecord[]).map(
          ({ sortOrder }) => sortOrder,
        ),
      ).toEqual([1, 2]);
      expect((categoryPage.body.data as JsonRecord[])[0]).not.toHaveProperty(
        'children',
      );
      const firstMeta = record(categoryPage.body.meta);
      expect(firstMeta.nextCursor).toEqual(expect.any(String));
      const nextPage = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/categories?parentSlug=${parent.slug}&pageSize=2&cursor=${firstMeta.nextCursor}`,
      );
      expect(
        (nextPage.body.data as JsonRecord[]).map(({ sortOrder }) => sortOrder),
      ).toEqual([3]);
      expect(record(nextPage.body.meta).nextCursor).toBeNull();
      const unknownParent = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/categories?parentSlug=${randomSlug('missing')}`,
      );
      expect(unknownParent.status).toBe(404);
      const archivedParent = await makeCategory(fullActor.agent);
      const archivedSlug = archivedParent.slug!;
      const archiveParent = await fullActor.agent.write(
        'POST',
        `/v1/staff/catalog/categories/${archivedParent.id}/archive`,
        { expectedVersion: archivedParent.version },
      );
      expect(archiveParent.status).toBe(200);
      const archivedParentPage = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/categories?parentSlug=${archivedSlug}`,
      );
      expect(archivedParentPage.status).toBe(404);

      const brand = await makeBrand(fullActor.agent);
      const material = await makeAttribute(
        fullActor.agent,
        firstChild.id,
        'material',
        'TEXT',
      );
      const targetDraft = await makeProduct(fullActor.agent, firstChild.id, {
        brandId: brand.id,
        attributes: [
          {
            attributeDefinitionId: material.id,
            valueType: 'TEXT',
            value: 'carbon steel',
          },
        ],
      });
      const targetPublished = await publishProduct(
        fullActor.agent,
        targetDraft,
      );
      const targetRevisionId = targetPublished.publishedRevisionId!;
      const targetRoot = await db!.catalogProduct.findUniqueOrThrow({
        where: { id: targetDraft.id },
      });
      const sourceDraft = await makeProduct(fullActor.agent, firstChild.id);
      const relationChange = await fullActor.agent.write(
        'PUT',
        `/v1/staff/catalog/products/${sourceDraft.id}/relations`,
        {
          expectedVersion: sourceDraft.version,
          relations: [
            {
              targetProductId: targetDraft.id,
              targetRevisionId,
              relationType: 'ACCESSORY',
              sortOrder: 0,
            },
          ],
        },
      );
      expect(relationChange.status).toBe(200);
      const source = await publishProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, sourceDraft.id),
      );
      const publicSource = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/products/${(await db!.catalogProduct.findUniqueOrThrow({ where: { id: source.id } })).slug}`,
      );
      const publicData = data(publicSource);
      expect(publicData.priceDisplay).toEqual({
        kind: 'ON_REQUEST',
        label: 'Цена по запросу',
      });
      expect((publicData.relations as JsonRecord[])[0]?.target).toMatchObject({
        slug: targetRoot.slug,
        displayName: `Product ${targetRoot.slug}`,
      });
      expect(JSON.stringify(publicData)).not.toMatch(
        /fileVersionId|storageKey|downloadUrl|audit|staffUserId|cost|margin|supplier/i,
      );

      const incompatibleQueries = [
        `filter=material%3Aeq%3Asteel`,
        `categorySlug=${firstChild.slug}&filter=material%3Aeq%3Asteel`,
        `categorySlug=${firstChild.slug}&includeDescendants=true&filter=material%3Aeq%3Asteel`,
      ];
      for (const query of incompatibleQueries) {
        const rejected = await fullActor.agent.request(
          'GET',
          `/v1/public/catalog/products?${query}`,
        );
        expect(rejected.status).toBe(400);
        expect(rejected.body.code).toBe('VALIDATION_ERROR');
      }
      const filtered = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/products?categorySlug=${firstChild.slug}&includeDescendants=false&filter=material%3Acontains%3Asteel`,
      );
      expect(filtered.status).toBe(200);
      expect(
        (filtered.body.data as JsonRecord[]).some(
          ({ slug }) => slug === targetRoot.slug,
        ),
      ).toBe(true);
      const emptyQuery = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/products?categorySlug=${parent.slug}&q=`,
      );
      const noTextQuery = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/products?categorySlug=${parent.slug}`,
      );
      expect(record(emptyQuery.body.meta).total).toBe(
        record(noTextQuery.body.meta).total,
      );
      const malformedCursor = await fullActor.agent.request(
        'GET',
        '/v1/public/catalog/categories?cursor=not%25base64',
      );
      expect(malformedCursor.status).toBe(400);
      const malformedStaffCursor = await fullActor.agent.request(
        'GET',
        '/v1/staff/catalog/products?cursor=not%25base64',
      );
      expect(malformedStaffCursor.status).toBe(400);

      const republish = await fullActor.agent.write(
        'PATCH',
        `/v1/staff/catalog/products/${targetDraft.id}`,
        {
          expectedVersion: targetPublished.version,
          baseRevisionId: targetRevisionId,
          summary: 'Target revised; the old relation is now stale.',
        },
      );
      expect(republish.status).toBe(200);
      const rePublishedTarget = await publishProduct(
        fullActor.agent,
        await getProduct(fullActor.agent, targetDraft.id),
      );
      expect(rePublishedTarget.publishedRevisionId).not.toBe(targetRevisionId);
      const afterTargetRepublish = await fullActor.agent.request(
        'GET',
        `/v1/public/catalog/products/${(await db!.catalogProduct.findUniqueOrThrow({ where: { id: source.id } })).slug}`,
      );
      expect(data(afterTargetRepublish).relations).toEqual([]);
    });
  },
);
