import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const migrationRoot = resolve(apiRoot, 'prisma/migrations');
const baseMigration = resolve(
  migrationRoot,
  '20261022120000_staff_identity/migration.sql',
);
const catalogMigration = resolve(
  migrationRoot,
  '20261024120000_catalog_domain/migration.sql',
);
const catalogRbacContract = JSON.parse(
  await readFile(
    resolve(repoRoot, 'docs/contracts/R1-004-catalog-rbac-matrix.json'),
    'utf8',
  ),
);
const expectedCatalogPermissions = Object.keys(
  catalogRbacContract.permissions,
).sort();
const require = createRequire(resolve(apiRoot, 'package.json'));
const prismaCli = require.resolve('prisma/build/index.js');
const tsxCli = require.resolve('tsx/cli');
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const containerName = `stdu-r1-004b-migration-${process.pid}-${suffix}`;
const adminPassword = randomBytes(32).toString('base64url');
const runtimePassword = randomBytes(32).toString('base64url');
let containerCreated = false;
let containerCreationAttempted = false;

function createClient(options) {
  const client = new Client(options);
  client.on('error', (error) => {
    console.error(
      `PostgreSQL client emitted an asynchronous error: ${error.message}`,
    );
    process.exitCode = 1;
  });
  return client;
}

async function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) accept(stdout.trim());
      else {
        const error = new Error(
          `${command} failed (${code ?? signal}): ${stderr.trim().slice(0, 1200)}`,
        );
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

async function docker(args) {
  return run('docker', args, { capture: true });
}

async function waitForPostgres(url) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    const client = createClient({
      connectionString: url,
      connectionTimeoutMillis: 1_000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await delay(400);
    }
  }
  throw new Error(
    `Owned migration-check PostgreSQL did not become ready: ${lastError?.message ?? 'timeout'}`,
  );
}

async function waitForPublishedPort() {
  const deadline = Date.now() + 10_000;
  let observedPorts = 'not available';
  while (Date.now() < deadline) {
    observedPorts = await docker([
      'inspect',
      '--format',
      '{{json .NetworkSettings.Ports}}',
      containerName,
    ]);
    const bindings = JSON.parse(observedPorts);
    const published = bindings?.['5432/tcp']?.[0]?.HostPort;
    if (published && /^\d+$/.test(published)) return Number(published);
    await delay(200);
  }
  throw new Error(
    `Docker did not publish the owned PostgreSQL port after 10 seconds; observed bindings: ${observedPorts}`,
  );
}

function connectionString(port, database) {
  return `postgresql://postgres:${encodeURIComponent(adminPassword)}@127.0.0.1:${port}/${database}`;
}

async function applyMigrationState(port, database, baseSql, populated) {
  const url = connectionString(port, database);
  const client = createClient({ connectionString: url });
  await client.connect();
  await client.query(baseSql);

  let sentinel = null;
  if (populated) sentinel = await createSentinelFixtures(client);
  const baseline = await protectedSnapshot(client);
  await client.end();

  const env = { ...process.env, MIGRATION_DATABASE_URL: url };
  await run(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'resolve',
      '--applied',
      '20261022120000_staff_identity',
    ],
    { cwd: apiRoot, env },
  );
  await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env,
  });

  const verify = createClient({ connectionString: url });
  await verify.connect();
  const after = await protectedSnapshot(verify);
  const afterR1_002 = {
    ...after,
    permission: after.permission.filter(
      ({ code }) => !expectedCatalogPermissions.includes(code),
    ),
  };
  assert.deepEqual(
    afterR1_002,
    baseline,
    `${database}: R1-002 data changed during catalog migration.`,
  );
  assert.deepEqual(
    after.permission
      .filter(({ code }) => expectedCatalogPermissions.includes(code))
      .map(({ code }) => code)
      .sort(),
    expectedCatalogPermissions,
    `${database}: the migration did not register exactly the frozen catalog permissions.`,
  );
  const catalogGrants = await verify.query(
    `SELECT p.code FROM role_permission rp
     JOIN permission p ON p.id = rp.permission_id
     WHERE p.code = ANY($1::text[]) ORDER BY p.code`,
    [expectedCatalogPermissions],
  );
  assert.deepEqual(
    catalogGrants.rows,
    [],
    `${database}: catalog permissions were granted automatically.`,
  );
  await exerciseCatalogAuditRegistry(verify, sentinel?.userId ?? null);
  const tables = await verify.query(
    `
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    ORDER BY table_name
  `,
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
  assert.equal(
    tables.rowCount,
    9,
    `${database}: expected nine catalog tables.`,
  );
  const applied = await verify.query(
    `SELECT migration_name, finished_at IS NOT NULL AS applied
     FROM _prisma_migrations ORDER BY migration_name`,
  );
  assert.deepEqual(
    applied.rows.map(({ migration_name, applied: isApplied }) => [
      migration_name,
      isApplied,
    ]),
    [
      ['20261022120000_staff_identity', true],
      ['20261024120000_catalog_domain', true],
    ],
  );

  const integration = populated
    ? await exerciseCatalogConstraints(
        verify,
        sentinel.userId,
        sentinel.alternateUserId,
        url,
      )
    : null;
  await verify.end();
  console.log(
    `PASS ${database}: additive Prisma deploy; nine tables; R1-002 fixture snapshot preserved${integration ? '; workflow, identity, immutable history and archive guards passed' : ''}.`,
  );
}

async function createSentinelFixtures(client) {
  const userId = randomUUID();
  const alternateUserId = randomUUID();
  const fileObjectId = randomUUID();
  const fileVersionId = randomUUID();
  await client.query(
    `INSERT INTO staff_user
      (id,email,email_normalized,display_name,password_hash,state)
     VALUES ($1,$2,$2,$3,$4,'ACTIVE')`,
    [
      userId,
      `migration-sentinel-${suffix}@example.invalid`,
      'Migration sentinel',
      '$argon2id$test-only-placeholder',
    ],
  );
  await client.query(
    `INSERT INTO file_object(id,owner_staff_user_id,display_name,visibility,state)
     VALUES ($1,$2,'sentinel.pdf','INTERNAL','ACTIVE')`,
    [fileObjectId, userId],
  );
  await client.query(
    `INSERT INTO staff_user
      (id,email,email_normalized,display_name,password_hash,state)
     VALUES ($1,$2,$2,$3,$4,'ACTIVE')`,
    [
      alternateUserId,
      `migration-alternate-${suffix}@example.invalid`,
      'Migration alternate sentinel',
      '$argon2id$test-only-placeholder',
    ],
  );
  await client.query(
    `INSERT INTO file_version
      (id,file_object_id,number,storage_key,sha256,size_bytes,mime_type,
       original_filename,safety_state,created_by_user_id)
     VALUES ($1,$2,1,$3,$4,64,'application/pdf','sentinel.pdf','SAFE',$5)`,
    [
      fileVersionId,
      fileObjectId,
      'a'.repeat(64),
      Buffer.alloc(32, 0x5a),
      userId,
    ],
  );
  await client.query(
    `INSERT INTO audit_event
      (id,actor_kind,actor_user_id,action,entity_type,entity_id,outcome,
       reason_code,request_id,changes)
     VALUES ($1,'STAFF',$2,'staff.bootstrap','StaffUser',$2,'SUCCESS',
       'BOOTSTRAP',$3,$4::jsonb)`,
    [
      randomUUID(),
      userId,
      randomUUID(),
      JSON.stringify({ targetUserId: userId, passwordChangeRequired: false }),
    ],
  );
  return { userId, alternateUserId, fileObjectId, fileVersionId };
}

async function protectedSnapshot(client) {
  const queries = [
    [
      'staff_user',
      'SELECT id::text,email_normalized,display_name,state FROM staff_user ORDER BY id',
    ],
    [
      'permission',
      'SELECT id::text,code,description FROM permission ORDER BY code',
    ],
    [
      'role_permission',
      'SELECT role_id::text,permission_id::text FROM role_permission ORDER BY role_id,permission_id',
    ],
    [
      'audit_event',
      `SELECT id::text,actor_kind,actor_user_id::text,operator_label,action,
         entity_type,entity_id::text,outcome,reason_code,request_id::text,
         encode(source_hash,'hex') AS source_hash,changes
       FROM audit_event ORDER BY id`,
    ],
    [
      'file_object',
      'SELECT id::text,owner_staff_user_id::text,display_name,visibility,state FROM file_object ORDER BY id',
    ],
    [
      'file_version',
      "SELECT id::text,file_object_id::text,number,storage_key,encode(sha256,'hex') AS sha256,size_bytes::text,mime_type,original_filename,safety_state FROM file_version ORDER BY id",
    ],
  ];
  const result = {};
  for (const [key, sql] of queries)
    result[key] = (await client.query(sql)).rows;
  return result;
}

async function exerciseCatalogAuditRegistry(client, actorUserId) {
  const acceptedLegacy = await client.query(
    `SELECT audit_event_valid('auth.login','SUCCESS','CREDENTIALS_VERIFIED',
       '{"accountFingerprint":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}'::jsonb) AS valid`,
  );
  assert.equal(
    acceptedLegacy.rows[0].valid,
    true,
    'Existing R1-002 audit actions remain valid.',
  );
  const acceptedCatalogPermissionGrant = await client.query(
    `SELECT audit_event_valid('staff.role.permissions.changed','SUCCESS',
       'ROLE_PERMISSIONS_CHANGED',$1::jsonb) AS valid`,
    [
      JSON.stringify({
        roleId: randomUUID(),
        addedPermissions: ['catalog.products.write'],
        removedPermissions: [],
        affectedUserCount: 0,
      }),
    ],
  );
  assert.equal(
    acceptedCatalogPermissionGrant.rows[0].valid,
    true,
    'Existing RBAC audit permits the owner-approved catalog permission extension.',
  );
  const rejectedUnknownPermissionGrant = await client.query(
    `SELECT audit_event_valid('staff.role.permissions.changed','SUCCESS',
       'ROLE_PERMISSIONS_CHANGED',$1::jsonb) AS valid`,
    [
      JSON.stringify({
        roleId: randomUUID(),
        addedPermissions: ['catalog.unapproved.write'],
        removedPermissions: [],
        affectedUserCount: 0,
      }),
    ],
  );
  assert.equal(
    rejectedUnknownPermissionGrant.rows[0].valid,
    false,
    'Existing RBAC audit still rejects codes outside the registered extension.',
  );
  const acceptedCatalog = await client.query(
    `SELECT audit_event_valid('catalog.reference.changed','SUCCESS',NULL,
       '{"changedFields":["name"],"version":2}'::jsonb) AS valid`,
  );
  assert.equal(
    acceptedCatalog.rows[0].valid,
    true,
    'Frozen catalog audit event is accepted.',
  );
  const rejectedCatalog = await client.query(
    `SELECT audit_event_valid('catalog.reference.changed','SUCCESS','UNKNOWN',
       '{"changedFields":["name"],"version":2,"extra":"no"}'::jsonb) AS valid`,
  );
  assert.equal(
    rejectedCatalog.rows[0].valid,
    false,
    'Unknown catalog audit values fail closed.',
  );

  const expectedPermissions =
    catalogRbacContract.initialGrant.catalogPermissionCodes;
  const validInitializer = await client.query(
    `SELECT audit_event_valid('catalog.permissions.initialized','SUCCESS','OWNER_APPROVED',$1::jsonb) AS valid`,
    [
      JSON.stringify({
        targetUserId: randomUUID(),
        roleId: randomUUID(),
        permissionCodes: expectedPermissions,
        approvalReference: 'TEST-OWNER-APPROVAL',
      }),
    ],
  );
  assert.equal(
    validInitializer.rows[0].valid,
    true,
    'Pinned catalog permission initializer audit event is accepted.',
  );
  const invalidInitializer = await client.query(
    `SELECT audit_event_valid('catalog.permissions.initialized','SUCCESS','OWNER_APPROVED',$1::jsonb) AS valid`,
    [
      JSON.stringify({
        targetUserId: randomUUID(),
        roleId: randomUUID(),
        permissionCodes: [...expectedPermissions, 'catalog.future.write'],
        approvalReference: 'TEST-OWNER-APPROVAL',
      }),
    ],
  );
  assert.equal(
    invalidInitializer.rows[0].valid,
    false,
    'The initializer audit event rejects permissions outside the frozen set.',
  );
  const deniedInitializer = await client.query(
    `SELECT audit_event_valid('catalog.permissions.initialized','DENIED',
       'OWNER_APPROVAL_REQUIRED','{}'::jsonb) AS valid`,
  );
  assert.equal(
    deniedInitializer.rows[0].valid,
    true,
    'A denied initialization can be audited without claiming a successful grant.',
  );

  await client.query('BEGIN');
  const roleId = randomUUID();
  const targetUserId = actorUserId ?? randomUUID();
  await client.query(
    `INSERT INTO audit_event
      (id,actor_kind,operator_label,action,entity_type,entity_id,outcome,
       reason_code,request_id,changes)
     VALUES ($1,'OPERATOR','migration-harness','catalog.permissions.initialized',
       'Role',$2,'SUCCESS','OWNER_APPROVED',$3,$4::jsonb)`,
    [
      randomUUID(),
      roleId,
      randomUUID(),
      JSON.stringify({
        targetUserId,
        roleId,
        permissionCodes: expectedPermissions,
        approvalReference: 'TEST-OWNER-APPROVAL',
      }),
    ],
  );
  await client.query(
    `INSERT INTO audit_event
      (id,actor_kind,operator_label,action,outcome,reason_code,request_id,changes)
     VALUES ($1,'OPERATOR','migration-harness','catalog.permissions.initialized',
       'DENIED','OWNER_APPROVAL_REQUIRED',$2,'{}'::jsonb)`,
    [randomUUID(), randomUUID()],
  );
  if (actorUserId) {
    await client.query(
      `INSERT INTO audit_event
        (id,actor_kind,actor_user_id,action,entity_type,entity_id,outcome,
         reason_code,request_id,changes)
       VALUES ($1,'STAFF',$2,'staff.role.permissions.changed','Role',$3,'SUCCESS',
         'ROLE_PERMISSIONS_CHANGED',$4,$5::jsonb)`,
      [
        randomUUID(),
        actorUserId,
        randomUUID(),
        randomUUID(),
        JSON.stringify({
          roleId: randomUUID(),
          addedPermissions: ['catalog.products.write'],
          removedPermissions: [],
          affectedUserCount: 0,
        }),
      ],
    );
    await client.query(
      `INSERT INTO audit_event
        (id,actor_kind,actor_user_id,action,entity_type,entity_id,outcome,
         reason_code,request_id,changes)
       VALUES ($1,'STAFF',$2,'catalog.reference.changed','Category',$3,'SUCCESS',
         NULL,$4,$5::jsonb)`,
      [
        randomUUID(),
        actorUserId,
        randomUUID(),
        randomUUID(),
        JSON.stringify({ changedFields: ['name'], version: 2 }),
      ],
    );
  }
  await client.query('ROLLBACK');
}

async function expectPgFailure(client, sql, params, codes, label) {
  await client.query('SAVEPOINT expected_failure');
  let failure;
  try {
    await client.query(sql, params);
  } catch (error) {
    failure = error;
  }
  await client.query('ROLLBACK TO SAVEPOINT expected_failure');
  await client.query('RELEASE SAVEPOINT expected_failure');
  assert.ok(failure, `${label}: statement unexpectedly succeeded.`);
  assert.ok(
    codes.includes(failure.code),
    `${label}: unexpected PostgreSQL code ${failure.code}.`,
  );
  return failure;
}

async function exerciseCatalogConstraints(
  client,
  staffUserId,
  alternateUserId,
  connectionUrl,
) {
  await client.query('BEGIN');
  const categoryId = randomUUID();
  const brandId = randomUUID();
  const productId = randomUUID();
  const revisionId = randomUUID();
  const attributeId = randomUUID();
  await client.query(
    `INSERT INTO category(id,slug,name,state) VALUES ($1,'migration-category','Migration category','ACTIVE')`,
    [categoryId],
  );
  await client.query(
    `INSERT INTO brand(id,slug,name,state) VALUES ($1,'migration-brand','Migration brand','ACTIVE')`,
    [brandId],
  );
  await client.query(
    `INSERT INTO catalog_product
      (id,brand_id,manufacturer_name,original_part_number,slug,publication_state)
     VALUES ($1,$2,'Maker','Part-1','migration-product','DRAFT')`,
    [productId, brandId],
  );
  await client.query(
    `INSERT INTO catalog_product_revision
      (id,product_id,revision_no,brand_id,category_id,state,display_name,
       brand_name_snapshot,brand_slug_snapshot,category_name_snapshot,
       category_slug_snapshot,manufacturer_name_snapshot,
       original_part_number_snapshot,created_by_user_id)
     VALUES ($1,$2,1,$3,$4,'DRAFT','Fixture product','Migration brand',
       'migration-brand','Migration category','migration-category','Maker',
       'Part-1',$5)`,
    [revisionId, productId, brandId, categoryId, staffUserId],
  );
  await client.query(
    `UPDATE catalog_product SET current_draft_revision_id=$2,version=version+1 WHERE id=$1`,
    [productId, revisionId],
  );
  await expectPgFailure(
    client,
    `UPDATE catalog_product SET slug='renamed-product',version=version+1 WHERE id=$1`,
    [productId],
    ['23514'],
    'product slug is stable from creation',
  );
  await expectPgFailure(
    client,
    `UPDATE category SET slug='renamed-category',version=version+1 WHERE id=$1`,
    [categoryId],
    ['23514'],
    'category slug is stable from creation',
  );
  await expectPgFailure(
    client,
    `UPDATE brand SET slug='renamed-brand',version=version+1 WHERE id=$1`,
    [brandId],
    ['23514'],
    'brand slug is stable from creation',
  );
  await expectPgFailure(
    client,
    `INSERT INTO catalog_product_revision
      (id,product_id,revision_no,brand_id,category_id,state,display_name,
       brand_name_snapshot,brand_slug_snapshot,category_name_snapshot,
       category_slug_snapshot,manufacturer_name_snapshot,
       original_part_number_snapshot,created_by_user_id)
     VALUES ($1,$2,2,$3,$4,'DRAFT','Duplicate draft','Migration brand',
       'migration-brand','Migration category','migration-category','Maker',
       'Part-1',$5)`,
    [randomUUID(), productId, brandId, categoryId, staffUserId],
    ['23505'],
    'one DRAFT revision per product',
  );
  await expectPgFailure(
    client,
    `UPDATE catalog_product_revision SET display_name='changed' WHERE id=$1`,
    [revisionId],
    ['55000'],
    'immutable revision payload',
  );
  await expectPgFailure(
    client,
    `INSERT INTO catalog_product
      (id,brand_id,manufacturer_name,original_part_number,slug,publication_state)
     VALUES ($1,$2,'Maker','Part-1','migration-product-duplicate','DRAFT')`,
    [randomUUID(), brandId],
    ['23505'],
    'normalized SKU identity uniqueness',
  );
  await client.query(
    `INSERT INTO attribute_definition(id,category_id,code,label,value_type,state)
     VALUES ($1,$2,'voltage','Voltage','TEXT','ACTIVE')`,
    [attributeId, categoryId],
  );
  await client.query(
    `INSERT INTO product_attribute_value
      (product_revision_id,category_id,attribute_definition_id,value_type,
       code_snapshot,label_snapshot,filterable_snapshot,searchable_snapshot,
       comparable_snapshot,text_value)
     VALUES ($1,$2,$3,'TEXT','voltage','Voltage',false,false,true,'24 V')`,
    [revisionId, categoryId, attributeId],
  );
  await expectPgFailure(
    client,
    `UPDATE product_attribute_value SET text_value='48 V' WHERE product_revision_id=$1`,
    [revisionId],
    ['55000'],
    'immutable revision child value',
  );

  await client.query(
    `UPDATE catalog_product_revision
     SET state='PENDING_REVIEW',submitted_by_user_id=$2,submitted_at=transaction_timestamp()
     WHERE id=$1`,
    [revisionId, staffUserId],
  );
  await client.query(
    `UPDATE catalog_product SET current_draft_revision_id=NULL,pending_revision_id=$2,
       publication_state='PENDING_REVIEW',version=version+1 WHERE id=$1`,
    [productId, revisionId],
  );
  await assertPendingSubmitterImmutable(
    client,
    revisionId,
    staffUserId,
    alternateUserId,
  );
  await client.query(
    `UPDATE catalog_product_revision
     SET state='PUBLISHED',decided_by_user_id=$2,decided_at=transaction_timestamp(),
       decision='PUBLISH',published_at=transaction_timestamp()
     WHERE id=$1`,
    [revisionId, staffUserId],
  );
  await client.query(
    `UPDATE catalog_product SET pending_revision_id=NULL,published_revision_id=$2,
       publication_state='PUBLISHED',version=version+1 WHERE id=$1`,
    [productId, revisionId],
  );
  await client.query(
    `UPDATE catalog_product SET published_revision_id=NULL,publication_state='ARCHIVED',
       version=version+1 WHERE id=$1`,
    [productId],
  );
  const preserved = await client.query(
    `SELECT p.publication_state,p.published_revision_id,r.state AS revision_state,
       count(v.attribute_definition_id)::int AS value_count
     FROM catalog_product p
     JOIN catalog_product_revision r ON r.id=$2
     LEFT JOIN product_attribute_value v ON v.product_revision_id=r.id
     WHERE p.id=$1 GROUP BY p.publication_state,p.published_revision_id,r.state`,
    [productId, revisionId],
  );
  assert.deepEqual(preserved.rows[0], {
    publication_state: 'ARCHIVED',
    published_revision_id: null,
    revision_state: 'PUBLISHED',
    value_count: 1,
  });

  const pendingProductId = randomUUID();
  const pendingRevisionId = randomUUID();
  await client.query(
    `INSERT INTO catalog_product
      (id,brand_id,manufacturer_name,original_part_number,slug,publication_state)
     VALUES ($1,$2,'Maker','Part-pending','migration-pending-product','DRAFT')`,
    [pendingProductId, brandId],
  );
  await client.query(
    `INSERT INTO catalog_product_revision
      (id,product_id,revision_no,brand_id,category_id,state,display_name,
       brand_name_snapshot,brand_slug_snapshot,category_name_snapshot,
       category_slug_snapshot,manufacturer_name_snapshot,
       original_part_number_snapshot,created_by_user_id)
     VALUES ($1,$2,1,$3,$4,'DRAFT','Pending fixture','Migration brand',
       'migration-brand','Migration category','migration-category','Maker',
       'Part-pending',$5)`,
    [pendingRevisionId, pendingProductId, brandId, categoryId, staffUserId],
  );
  await client.query(
    `UPDATE catalog_product SET current_draft_revision_id=$2,version=version+1 WHERE id=$1`,
    [pendingProductId, pendingRevisionId],
  );
  await client.query(
    `UPDATE catalog_product_revision
     SET state='PENDING_REVIEW',submitted_by_user_id=$2,submitted_at=transaction_timestamp()
     WHERE id=$1`,
    [pendingRevisionId, staffUserId],
  );
  await client.query(
    `UPDATE catalog_product SET current_draft_revision_id=NULL,pending_revision_id=$2,
       publication_state='PENDING_REVIEW',version=version+1 WHERE id=$1`,
    [pendingProductId, pendingRevisionId],
  );
  await assertArchiveRequiresWithdrawnPending(
    client,
    pendingProductId,
    pendingRevisionId,
  );
  await client.query(
    `UPDATE catalog_product_revision SET state='WITHDRAWN' WHERE id=$1`,
    [pendingRevisionId],
  );
  await client.query(
    `UPDATE catalog_product SET pending_revision_id=NULL,publication_state='ARCHIVED',
       version=version+1 WHERE id=$1`,
    [pendingProductId],
  );
  const withdrawn = await client.query(
    `SELECT p.publication_state,r.state AS revision_state
     FROM catalog_product p JOIN catalog_product_revision r ON r.id=$2
     WHERE p.id=$1`,
    [pendingProductId, pendingRevisionId],
  );
  assert.deepEqual(withdrawn.rows[0], {
    publication_state: 'ARCHIVED',
    revision_state: 'WITHDRAWN',
  });

  await client.query(
    `UPDATE category SET state='ARCHIVED',version=version+1 WHERE id=$1`,
    [categoryId],
  );
  await client.query(
    `UPDATE brand SET state='ARCHIVED',version=version+1 WHERE id=$1`,
    [brandId],
  );

  const duplicateProductBrandId = randomUUID();
  await client.query(
    `INSERT INTO brand(id,slug,name,state)
     VALUES ($1,'migration-duplicate-brand','Duplicate test brand','ACTIVE')`,
    [duplicateProductBrandId],
  );

  await expectPgFailure(
    client,
    `INSERT INTO brand(id,slug,name,state) VALUES ($1,'migration-brand','Duplicate archived brand','ACTIVE')`,
    [randomUUID()],
    ['23505'],
    'archived brand slug cannot be reused',
  );
  await expectPgFailure(
    client,
    `INSERT INTO category(id,slug,name,state) VALUES ($1,'migration-category','Duplicate archived category','ACTIVE')`,
    [randomUUID()],
    ['23505'],
    'archived category slug cannot be reused',
  );
  await expectPgFailure(
    client,
    `INSERT INTO catalog_product
      (id,brand_id,manufacturer_name,original_part_number,slug,publication_state)
     VALUES ($1,$2,'Maker','Part-new','migration-product','DRAFT')`,
    [randomUUID(), duplicateProductBrandId],
    ['23505'],
    'archived product slug cannot be reused',
  );
  await client.query('COMMIT');
  await assertArchiveChildInsertSerialization(
    client,
    connectionUrl,
    staffUserId,
  );
  return true;
}

async function assertPendingSubmitterImmutable(
  client,
  revisionId,
  staffUserId,
  alternateUserId,
) {
  const attempts = [
    {
      state: 'PUBLISHED',
      mutation: `submitted_by_user_id=$3,submitted_at=transaction_timestamp()+interval '1 second',
        decided_by_user_id=$2,decided_at=transaction_timestamp(),decision='PUBLISH',
        published_at=transaction_timestamp()`,
    },
    {
      state: 'RETURNED',
      mutation: `submitted_by_user_id=$3,submitted_at=transaction_timestamp()+interval '1 second',
        decided_by_user_id=$2,
        decided_at=transaction_timestamp(),decision='RETURN_FOR_CHANGES',published_at=NULL`,
    },
    {
      state: 'REJECTED',
      mutation: `submitted_by_user_id=$3,submitted_at=transaction_timestamp()+interval '1 second',
        decided_by_user_id=$2,
        decided_at=transaction_timestamp(),decision='REJECT',published_at=NULL`,
    },
    {
      state: 'WITHDRAWN',
      mutation: `submitted_by_user_id=$3,submitted_at=transaction_timestamp()+interval '1 second',
        decided_by_user_id=NULL,decided_at=NULL,
        decision=NULL,published_at=NULL`,
    },
  ];
  for (const attempt of attempts) {
    const failure = await expectPgFailure(
      client,
      `UPDATE catalog_product_revision SET state='${attempt.state}',${attempt.mutation}
       WHERE id=$1${attempt.state === 'WITHDRAWN' ? ' AND $2::uuid IS NOT NULL' : ''}`,
      [revisionId, staffUserId, alternateUserId],
      ['23514'],
      `pending submitter/time immutable on ${attempt.state}`,
    );
    assert.match(
      failure.message,
      /INVALID_STATE_TRANSITION/,
      `${attempt.state} rejected for a reason other than submitter/time immutability.`,
    );
  }
}

async function assertArchiveRequiresWithdrawnPending(
  client,
  productId,
  pendingRevisionId,
) {
  await client.query('SAVEPOINT archive_pending_check');
  await client.query(
    `UPDATE catalog_product SET pending_revision_id=NULL,current_draft_revision_id=NULL,
       published_revision_id=NULL,publication_state='ARCHIVED',version=version+1 WHERE id=$1`,
    [productId],
  );
  let failure;
  try {
    await client.query(
      'SET CONSTRAINTS catalog_product_workflow_consistency IMMEDIATE',
    );
  } catch (error) {
    failure = error;
  }
  await client.query('ROLLBACK TO SAVEPOINT archive_pending_check');
  await client.query('RELEASE SAVEPOINT archive_pending_check');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  assert.ok(
    failure,
    'Archiving with an unwithdrawn pending revision unexpectedly succeeded.',
  );
  assert.equal(failure.code, '23514');
  assert.match(failure.message, /CATALOG_WORKFLOW_INCONSISTENT/);
  const state = await client.query(
    `SELECT state FROM catalog_product_revision WHERE id=$1`,
    [pendingRevisionId],
  );
  assert.equal(state.rows[0].state, 'PENDING_REVIEW');

  await client.query('SAVEPOINT archive_pending_two_step_check');
  await client.query(
    `UPDATE catalog_product SET pending_revision_id=NULL,publication_state='DRAFT',
       version=version+1 WHERE id=$1`,
    [productId],
  );
  await client.query(
    `UPDATE catalog_product SET publication_state='ARCHIVED',version=version+1 WHERE id=$1`,
    [productId],
  );
  let twoStepFailure;
  try {
    await client.query(
      'SET CONSTRAINTS catalog_product_workflow_consistency IMMEDIATE',
    );
  } catch (error) {
    twoStepFailure = error;
  }
  await client.query('ROLLBACK TO SAVEPOINT archive_pending_two_step_check');
  await client.query('RELEASE SAVEPOINT archive_pending_two_step_check');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  assert.ok(
    twoStepFailure,
    'Two-step archive left a pending revision without a pointer.',
  );
  assert.equal(twoStepFailure.code, '23514');
  assert.match(twoStepFailure.message, /CATALOG_WORKFLOW_INCONSISTENT/);
}

async function assertArchiveChildInsertSerialization(
  existingClient,
  connectionUrl,
  staffUserId,
) {
  const productId = randomUUID();
  const revisionId = randomUUID();
  const attributeId = randomUUID();
  const categoryId = randomUUID();
  const setup = createClient({ connectionString: connectionUrl });
  await setup.connect();
  await setup.query('BEGIN');
  await setup.query(
    `INSERT INTO category(id,slug,name,state)
     VALUES ($1,'migration-race-category','Race category','ACTIVE')`,
    [categoryId],
  );
  await setup.query(
    `INSERT INTO catalog_product
      (id,brand_id,manufacturer_name,original_part_number,slug,publication_state)
     VALUES ($1,NULL,'Maker','Part-race','migration-race-product','DRAFT')`,
    [productId],
  );
  await setup.query(
    `INSERT INTO catalog_product_revision
      (id,product_id,revision_no,brand_id,category_id,state,display_name,
       brand_name_snapshot,brand_slug_snapshot,category_name_snapshot,
       category_slug_snapshot,manufacturer_name_snapshot,
       original_part_number_snapshot,created_by_user_id)
     VALUES ($1,$2,1,NULL,$3,'DRAFT','Race fixture',NULL,
       NULL,'Race category','migration-race-category','Maker',
       'Part-race',$4)`,
    [revisionId, productId, categoryId, staffUserId],
  );
  await setup.query(
    `UPDATE catalog_product SET current_draft_revision_id=$2,version=version+1 WHERE id=$1`,
    [productId, revisionId],
  );
  await setup.query(
    `INSERT INTO attribute_definition(id,category_id,code,label,value_type,state)
     VALUES ($1,$2,'race_value','Race value','TEXT','ACTIVE')`,
    [attributeId, categoryId],
  );
  await setup.query('COMMIT');
  await setup.end();

  const archive = createClient({
    connectionString: connectionUrl,
    application_name: 'r1-004b-archive-race',
  });
  const inserter = createClient({
    connectionString: connectionUrl,
    application_name: 'r1-004b-child-race',
  });
  const observer = createClient({ connectionString: connectionUrl });
  let archiveTransactionOpen = false;
  let insertTransactionOpen = false;
  try {
    await Promise.all([
      archive.connect(),
      inserter.connect(),
      observer.connect(),
    ]);
    await archive.query('BEGIN');
    archiveTransactionOpen = true;
    await archive.query(
      `UPDATE catalog_product SET current_draft_revision_id=NULL,
         publication_state='ARCHIVED',version=version+1 WHERE id=$1`,
      [productId],
    );
    const archivePid = Number(
      (await archive.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
    );
    await inserter.query('BEGIN');
    insertTransactionOpen = true;
    const childPid = Number(
      (await inserter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
    );
    const insertResult = inserter
      .query(
        `INSERT INTO product_attribute_value
          (product_revision_id,category_id,attribute_definition_id,value_type,
           code_snapshot,label_snapshot,filterable_snapshot,searchable_snapshot,
           comparable_snapshot,text_value)
         VALUES ($1,$2,$3,'TEXT','race_value','Race value',false,false,true,'24 V')`,
        [revisionId, categoryId, attributeId],
      )
      .then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
    await waitUntilBlocked(observer, childPid, archivePid);
    await archive.query('COMMIT');
    archiveTransactionOpen = false;
    const result = await insertResult;
    assert.equal(
      result.ok,
      false,
      'Child insert succeeded after product archive.',
    );
    assert.equal(result.error.code, '23514');
    assert.match(result.error.message, /REVISION_NOT_EDITABLE/);
    await inserter.query('ROLLBACK');
    insertTransactionOpen = false;
    const children = await existingClient.query(
      `SELECT count(*)::int AS count FROM product_attribute_value WHERE product_revision_id=$1`,
      [revisionId],
    );
    assert.equal(children.rows[0].count, 0);
  } finally {
    if (archiveTransactionOpen)
      await archive.query('ROLLBACK').catch(() => undefined);
    if (insertTransactionOpen)
      await inserter.query('ROLLBACK').catch(() => undefined);
    await Promise.allSettled([archive.end(), inserter.end(), observer.end()]);
  }
}

async function waitUntilBlocked(observer, blockedPid, expectedBlockerPid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      `SELECT wait_event_type='Lock' AND pg_blocking_pids(pid) @> ARRAY[$2::int] AS blocked
       FROM pg_stat_activity WHERE pid=$1::int`,
      [blockedPid, expectedBlockerPid],
    );
    if (result.rows[0]?.blocked) return;
    await delay(50);
  }
  throw new Error(
    'Archive-vs-child regression did not observe the expected row-lock wait.',
  );
}

async function main() {
  const baseSql = await readFile(baseMigration, 'utf8');
  await readFile(catalogMigration, 'utf8');
  containerCreationAttempted = true;
  await docker([
    'run',
    '--detach',
    '--name',
    containerName,
    '--label',
    'io.stdu.task=r1-004b-migration-check',
    '--tmpfs',
    '/var/lib/postgresql:rw,size=512m',
    '--publish',
    '127.0.0.1::5432/tcp',
    '--env',
    `POSTGRES_PASSWORD=${adminPassword}`,
    'postgres:18.6-bookworm',
  ]);
  containerCreated = true;
  const port = await waitForPublishedPort();
  const adminUrl = connectionString(port, 'postgres');
  await waitForPostgres(adminUrl);
  const admin = createClient({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(
    `CREATE ROLE stdu_runtime LOGIN PASSWORD '${runtimePassword}'`,
  );
  const databases = [`catalog_fresh_${suffix}`, `catalog_populated_${suffix}`];
  for (const database of databases)
    await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();

  await applyMigrationState(port, databases[0], baseSql, false);
  await applyMigrationState(port, databases[1], baseSql, true);
  const disposableInitializerUrl = connectionString(port, databases[0]);
  await run(
    process.execPath,
    [tsxCli, resolve(apiRoot, 'scripts/catalog-initializer-check.ts')],
    {
      cwd: apiRoot,
      env: {
        ...process.env,
        DATABASE_URL: disposableInitializerUrl,
        STAFF_DATABASE_URL: disposableInitializerUrl,
      },
    },
  );
  console.log(
    'PASS catalog additive migration and permission-initializer checks on isolated PostgreSQL 18.6; no persistent Docker volume or external database used.',
  );
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.stack : 'Catalog migration check failed.',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!containerCreationAttempted) return;
    try {
      const label = await docker([
        'inspect',
        '--format',
        '{{index .Config.Labels "io.stdu.task"}}',
        containerName,
      ]);
      if (label === 'r1-004b-migration-check') {
        await docker(['rm', '--force', containerName]);
      } else {
        console.error(
          'Owned migration-check cleanup refused: container ownership label changed.',
        );
        process.exitCode = 1;
      }
    } catch (error) {
      if (containerCreated) {
        console.error(
          `Owned migration-check container could not be stopped: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        process.exitCode = 1;
      }
    }
  });
