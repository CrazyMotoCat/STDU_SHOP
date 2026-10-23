import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { Redis } from 'ioredis';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const vitestPackage = require.resolve('vitest/package.json');
const vitestCli = resolve(dirname(vitestPackage), 'vitest.mjs');
const ownerLabel = 'stdu-r1-002b-runtime-tests';
const suffix = randomUUID().slice(0, 8);
const pgName = `${ownerLabel}-${suffix}-pg`;
const redisName = `${ownerLabel}-${suffix}-redis`;
const pgPassword = randomBytes(32).toString('base64url');
const runtimePassword = randomBytes(32).toString('base64url');
const migrationUrlBase = `postgresql://postgres:${encodeURIComponent(pgPassword)}@127.0.0.1:`;
const runtimeUrlBase = `postgresql://stdu_runtime:${encodeURIComponent(runtimePassword)}@127.0.0.1:`;
let pgStarted = false;
let redisStarted = false;
let exitCode = 0;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else {
        const error = new Error(`${command} failed (${code ?? signal}).`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

async function docker(args, capture = false) {
  return run('docker', args, { capture });
}

async function waitForPostgres(url) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    const client = new Client({
      connectionString: url,
      connectionTimeoutMillis: 1000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    `Owned PostgreSQL test service did not become ready: ${lastError?.message ?? 'timeout'}`,
  );
}

async function waitForRedis(url) {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 1000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (client.status === 'end') await client.connect();
      if ((await client.ping()) === 'PONG') {
        client.disconnect();
        return;
      }
    } catch (error) {
      lastError = error;
      client.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  client.disconnect();
  throw new Error(
    `Owned Redis test service did not become ready: ${lastError?.message ?? 'timeout'}`,
  );
}

async function portOf(name, containerPort) {
  const value = await docker(['port', name, containerPort], true);
  const match = /:(\d+)\s*$/.exec(value);
  if (!match)
    throw new Error(
      `Docker did not publish ${containerPort} for the owned test service.`,
    );
  return Number(match[1]);
}

async function provisionRuntimeRole(env) {
  await run(
    process.execPath,
    [resolve(scriptRoot, 'prepare-runtime-role.mjs')],
    { env, capture: true },
  );
}

async function expectRuntimeRoleProvisioningRefusal(env, scenario) {
  try {
    await provisionRuntimeRole(env);
  } catch (error) {
    if (
      error instanceof Error &&
      error.stderr?.includes(
        'Runtime role provisioning refused existing membership, ownership, or privileges.',
      )
    )
      return;
    throw error;
  }
  throw new Error(`Runtime-role provisioning accepted ${scenario}.`);
}

async function verifyRuntimeRoleProvisioning(ownerUrl, env) {
  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("SELECT set_config('stdu.test_role_password', $1, false)", [
    runtimePassword,
  ]);
  await owner.query(`
    DO $test$
    BEGIN
      EXECUTE format('CREATE ROLE stdu_runtime LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS PASSWORD %L', current_setting('stdu.test_role_password'));
      CREATE ROLE stdu_runtime_test_parent NOLOGIN;
      CREATE ROLE stdu_runtime_test_child NOLOGIN;
      GRANT stdu_runtime_test_parent TO stdu_runtime;
    END;
    $test$;
  `);
  await owner.end();

  await expectRuntimeRoleProvisioningRefusal(
    env,
    'an outbound membership in another role',
  );

  const check = new Client({ connectionString: ownerUrl });
  await check.connect();
  const untouched = await check.query(`
    SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
           EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS has_outbound_membership,
           EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = r.oid) AS has_inbound_membership
    FROM pg_roles r WHERE r.rolname='stdu_runtime'
  `);
  if (
    !untouched.rows[0]?.rolsuper ||
    !untouched.rows[0]?.rolcreatedb ||
    !untouched.rows[0]?.rolcreaterole ||
    !untouched.rows[0]?.rolreplication ||
    !untouched.rows[0]?.rolbypassrls ||
    !untouched.rows[0]?.has_outbound_membership ||
    untouched.rows[0]?.has_inbound_membership
  )
    throw new Error(
      'Rejected provisioning altered the existing runtime role or its membership.',
    );
  await check.query('REVOKE stdu_runtime_test_parent FROM stdu_runtime');
  await check.query('GRANT stdu_runtime TO stdu_runtime_test_child');
  await check.end();

  await expectRuntimeRoleProvisioningRefusal(
    env,
    'another role as a member of stdu_runtime',
  );

  const inboundCheck = new Client({ connectionString: ownerUrl });
  await inboundCheck.connect();
  const preservedInboundMembership = await inboundCheck.query(`
    SELECT r.rolsuper,
           EXISTS (
             SELECT 1 FROM pg_auth_members m
             WHERE m.roleid=r.oid AND m.member<>r.oid
           ) AS has_inbound_membership,
           EXISTS (
             SELECT 1 FROM pg_auth_members m
             WHERE m.member=r.oid
           ) AS has_outbound_membership
    FROM pg_roles r WHERE r.rolname='stdu_runtime'
  `);
  if (
    !preservedInboundMembership.rows[0]?.rolsuper ||
    !preservedInboundMembership.rows[0]?.has_inbound_membership ||
    preservedInboundMembership.rows[0]?.has_outbound_membership
  )
    throw new Error(
      'Rejected provisioning altered an inbound runtime-role membership or its role attributes.',
    );
  await inboundCheck.query('REVOKE stdu_runtime FROM stdu_runtime_test_child');
  await inboundCheck.query('DROP ROLE stdu_runtime_test_parent');
  await inboundCheck.query('DROP ROLE stdu_runtime_test_child');
  await inboundCheck.query('GRANT CREATE ON SCHEMA public TO stdu_runtime');
  await inboundCheck.query(
    'CREATE TABLE public.stdu_runtime_provisioning_probe (id integer)',
  );
  await inboundCheck.query(
    'ALTER TABLE public.stdu_runtime_provisioning_probe OWNER TO stdu_runtime',
  );
  await inboundCheck.end();

  await expectRuntimeRoleProvisioningRefusal(
    env,
    'pre-existing direct privileges and object ownership',
  );

  const ownershipCheck = new Client({ connectionString: ownerUrl });
  await ownershipCheck.connect();
  const preservedOwnership = await ownershipCheck.query(`
    SELECT r.rolsuper,
           EXISTS (
             SELECT 1 FROM pg_class c
             WHERE c.relname='stdu_runtime_provisioning_probe' AND c.relowner=r.oid
           ) AS owns_probe,
           EXISTS (
             SELECT 1
             FROM pg_namespace n
             CROSS JOIN LATERAL aclexplode(n.nspacl) acl
             WHERE n.nspname='public' AND acl.grantee=r.oid AND acl.privilege_type='CREATE'
           ) AS has_create
    FROM pg_roles r WHERE r.rolname='stdu_runtime'
  `);
  if (
    !preservedOwnership.rows[0]?.rolsuper ||
    !preservedOwnership.rows[0]?.owns_probe ||
    !preservedOwnership.rows[0]?.has_create
  )
    throw new Error(
      'Rejected provisioning changed existing runtime-role ownership or direct privileges.',
    );
  await ownershipCheck.query(
    'DROP TABLE public.stdu_runtime_provisioning_probe',
  );
  await ownershipCheck.query(
    'REVOKE CREATE ON SCHEMA public FROM stdu_runtime',
  );
  await ownershipCheck.end();

  await provisionRuntimeRole(env);
  const verify = new Client({ connectionString: ownerUrl });
  await verify.connect();
  const restricted = await verify.query(`
    SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls
    FROM pg_roles WHERE rolname='stdu_runtime'
  `);
  const memberships = await verify.query(
    `SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='stdu_runtime') OR roleid=(SELECT oid FROM pg_roles WHERE rolname='stdu_runtime')`,
  );
  if (
    !restricted.rows[0] ||
    Object.values(restricted.rows[0]).some(Boolean) ||
    memberships.rowCount !== 0
  )
    throw new Error(
      'Runtime-role provisioning did not remove the tested elevated attributes.',
    );
  await verify.query(
    "ALTER ROLE stdu_runtime SET default_transaction_isolation='repeatable read'",
  );
  await verify.end();
  console.log(
    'PASS runtime role rejects inbound/outbound memberships and existing ownership/privileges, constrains elevated attributes, and test DB defaults to REPEATABLE READ.',
  );
}

async function applyMigration(env) {
  await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env,
  });
}

async function verifyMigrationRollback(ownerUrl, migrationSql) {
  const databaseName = `r1_002b_fault_${suffix.replaceAll('-', '_')}`;
  const admin = new Client({ connectionString: ownerUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await admin.end();

  const faultUrl = ownerUrl.replace(/\/[^/]+$/, `/${databaseName}`);
  const fault = new Client({ connectionString: faultUrl });
  try {
    await fault.connect();
    const brokenSql = migrationSql.replace(
      'CREATE TABLE staff_user (',
      'CREATE TABLE rollback_marker(id integer);\nSELECT 1 / 0;\nCREATE TABLE staff_user (',
    );
    try {
      await fault.query(brokenSql);
      throw new Error('Injected migration failure unexpectedly succeeded.');
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Injected migration failure unexpectedly succeeded.'
      )
        throw error;
      await fault.query('ROLLBACK').catch(() => undefined);
    }
    const residue = await fault.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname='public' AND tablename NOT LIKE 'pg_%' AND tablename <> 'spatial_ref_sys'
    `);
    if (residue.rowCount !== 0)
      throw new Error(
        'Transactional migration failure left public tables behind.',
      );
    console.log('PASS migration failure rolls back previously executed DDL.');
  } finally {
    await fault.end().catch(() => undefined);
    const dropper = new Client({ connectionString: ownerUrl });
    await dropper.connect();
    await dropper.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await dropper.end();
  }
}

async function verifyFreshAndRepeatedMigration(ownerUrl) {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  await client.query(
    'CREATE SCHEMA fixture_sentinel; CREATE TABLE fixture_sentinel.sentinel (key text PRIMARY KEY, payload text NOT NULL)',
  );
  await client.query(
    "INSERT INTO fixture_sentinel.sentinel VALUES ('r1-002b', 'must-survive-migration')",
  );
  await client.end();

  const env = {
    ...process.env,
    MIGRATION_DATABASE_URL: ownerUrl,
    STDU_RUNTIME_PASSWORD: runtimePassword,
  };
  await verifyRuntimeRoleProvisioning(ownerUrl, env);
  const migrationSql = await readFile(
    new URL(
      '../prisma/migrations/20261022120000_staff_identity/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await verifyMigrationRollback(ownerUrl, migrationSql);
  await applyMigration(env);

  const afterFirst = new Client({ connectionString: ownerUrl });
  await afterFirst.connect();
  const before = await afterFirst.query(
    'SELECT migration_name, checksum, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY started_at',
  );
  const sentinel = await afterFirst.query(
    "SELECT payload FROM fixture_sentinel.sentinel WHERE key='r1-002b'",
  );
  const models = await afterFirst.query(
    `
    SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname='public'
      AND tablename = ANY($1::text[])
  `,
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
  const initial = await afterFirst.query(
    'SELECT (SELECT count(*) FROM staff_user)::int AS users, (SELECT count(*) FROM staff_session)::int AS sessions, (SELECT count(*) FROM permission)::int AS permissions',
  );
  await afterFirst.end();
  if (
    before.rowCount !== 1 ||
    sentinel.rows[0]?.payload !== 'must-survive-migration' ||
    models.rows[0]?.count !== 11
  )
    throw new Error(
      'Fresh migration did not preserve sentinel or create exactly the 11 frozen entities.',
    );
  if (
    initial.rows[0]?.users !== 0 ||
    initial.rows[0]?.sessions !== 0 ||
    initial.rows[0]?.permissions !== 12
  )
    throw new Error(
      'Fresh migration did not leave account/session data empty and seed exactly 12 permissions.',
    );
  console.log(
    'PASS fresh migration: 11 entities, 12 permissions, no accounts/sessions, sentinel preserved.',
  );

  await verifyPopulatedRepeatMigration(ownerUrl, env);
}

async function snapshotBusinessTables(client) {
  const names = [
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
  ];
  const rows = [];
  for (const table of names) {
    const result = await client.query(`
      SELECT count(*)::int AS count,
             md5(COALESCE(string_agg(to_jsonb(row_value)::text, E'\\n' ORDER BY to_jsonb(row_value)::text), '')) AS digest
      FROM ${table} AS row_value
    `);
    rows.push([table, result.rows[0].count, result.rows[0].digest]);
  }
  return rows;
}

async function seedAllTableFixtures(client) {
  const userId = randomUUID();
  const roleId = randomUUID();
  const sessionId = randomUUID();
  const sellerId = randomUUID();
  const fileId = randomUUID();
  const fileVersionId = randomUUID();
  const email = `repeat-${suffix}@stdu.test`;
  await client.query(
    `
    INSERT INTO staff_user(id,email,email_normalized,display_name,password_hash,state)
    VALUES($1,$2,$2,'Repeat migration fixture','$argon2id$fixture','ACTIVE')
  `,
    [userId, email],
  );
  await client.query(
    "INSERT INTO role(id,code,name,state) VALUES($1,$2,'Repeat migration fixture','ACTIVE')",
    [roleId, `repeat-${suffix.replaceAll('-', '')}`],
  );
  const permission = await client.query(
    "SELECT id FROM permission WHERE code='staff.users.read'",
  );
  await client.query(
    'INSERT INTO user_role(staff_user_id,role_id,assigned_by_user_id) VALUES($1,$2,$1)',
    [userId, roleId],
  );
  await client.query(
    'INSERT INTO role_permission(role_id,permission_id) VALUES($1,$2)',
    [roleId, permission.rows[0].id],
  );
  await client.query(
    `
    INSERT INTO staff_session(id,staff_user_id,token_hash,auth_version,absolute_expires_at,last_seen_at)
    VALUES($1,$2,$3,1,clock_timestamp()+interval '1 hour',clock_timestamp())
  `,
    [sessionId, userId, randomBytes(32)],
  );
  await client.query(
    "INSERT INTO seller_legal_entity(id,display_name,kind,state) VALUES($1,'Repeat seller fixture','OOO','DRAFT')",
    [sellerId],
  );
  await client.query(
    `
    INSERT INTO audit_event(id,actor_kind,actor_user_id,action,entity_type,entity_id,outcome,reason_code,request_id,changes)
    VALUES($1,'STAFF',$2,'auth.login','StaffUser',$2,'SUCCESS','CREDENTIALS_VERIFIED',$3,$4::jsonb)
  `,
    [
      randomUUID(),
      userId,
      randomUUID(),
      JSON.stringify({ accountFingerprint: 'a'.repeat(64) }),
    ],
  );
  await client.query(
    "INSERT INTO file_object(id,owner_staff_user_id,display_name,visibility,state) VALUES($1,$2,'repeat-file.txt','INTERNAL','ACTIVE')",
    [fileId, userId],
  );
  await client.query(
    `
    INSERT INTO file_version(id,file_object_id,number,storage_key,sha256,size_bytes,mime_type,original_filename,safety_state,created_by_user_id)
    VALUES($1,$2,1,$3,$4,7,'text/plain','repeat-file.txt','UNCHECKED',$5)
  `,
    [
      fileVersionId,
      fileId,
      randomBytes(32).toString('hex'),
      randomBytes(32),
      userId,
    ],
  );
  await client.query(
    `
    INSERT INTO file_link(id,file_object_id,file_version_id,seller_legal_entity_id,visibility,created_by_user_id)
    VALUES($1,$2,$3,$4,'INTERNAL',$5)
  `,
    [randomUUID(), fileId, fileVersionId, sellerId, userId],
  );
}

async function verifyPopulatedRepeatMigration(ownerUrl, baseEnv) {
  const databaseName = `r1_002b_fixture_${suffix.replaceAll('-', '_')}`;
  const admin = new Client({ connectionString: ownerUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await admin.end();
  const fixtureUrl = ownerUrl.replace(/\/[^/]+$/, `/${databaseName}`);
  const fixtureEnv = { ...baseEnv, MIGRATION_DATABASE_URL: fixtureUrl };
  let fixture = new Client({ connectionString: fixtureUrl });
  try {
    await fixture.connect();
    await fixture.query(
      'CREATE SCHEMA fixture_sentinel; CREATE TABLE fixture_sentinel.sentinel (key text PRIMARY KEY, payload text NOT NULL)',
    );
    await fixture.query(
      "INSERT INTO fixture_sentinel.sentinel VALUES ('r1-002b', 'must-survive-populated-repeat')",
    );
    await fixture.end();
    await applyMigration(fixtureEnv);
    fixture = new Client({ connectionString: fixtureUrl });
    await fixture.connect();
    await seedAllTableFixtures(fixture);
    const beforeTables = await snapshotBusinessTables(fixture);
    const beforeHistory = await fixture.query(
      'SELECT migration_name, checksum, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY started_at',
    );
    const beforeSentinel = await fixture.query(
      "SELECT payload FROM fixture_sentinel.sentinel WHERE key='r1-002b'",
    );
    await fixture.end();
    await applyMigration(fixtureEnv);
    const afterRepeat = new Client({ connectionString: fixtureUrl });
    await afterRepeat.connect();
    const afterTables = await snapshotBusinessTables(afterRepeat);
    const afterHistory = await afterRepeat.query(
      'SELECT migration_name, checksum, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY started_at',
    );
    const afterSentinel = await afterRepeat.query(
      "SELECT payload FROM fixture_sentinel.sentinel WHERE key='r1-002b'",
    );
    await afterRepeat.end();
    if (
      JSON.stringify(afterTables) !== JSON.stringify(beforeTables) ||
      JSON.stringify(afterHistory.rows) !==
        JSON.stringify(beforeHistory.rows) ||
      afterSentinel.rows[0]?.payload !== beforeSentinel.rows[0]?.payload
    )
      throw new Error(
        'Repeat migration changed one or more populated-table fixtures or migration history.',
      );
    if (beforeTables.some(([, count]) => count < 1))
      throw new Error(
        'Populated migration repeat did not include at least one fixture row in every frozen entity.',
      );
    console.log(
      'PASS populated repeat deploy: all 11 entity snapshots, migration history, and sentinel unchanged.',
    );
  } finally {
    await fixture.end().catch(() => undefined);
    const dropper = new Client({ connectionString: ownerUrl });
    await dropper.connect();
    await dropper.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await dropper.end();
  }
}

async function assertOwnedAndStop(name) {
  try {
    const label = await docker(
      [
        'inspect',
        '--format',
        `{{ index .Config.Labels "com.stdu.owner" }}`,
        name,
      ],
      true,
    );
    if (label !== ownerLabel) return;
    await docker(['stop', '--timeout', '10', name]);
  } catch {
    // The container may already have been removed by --rm after an earlier stop.
  }
}

try {
  await docker([
    'run',
    '--rm',
    '-d',
    '--name',
    pgName,
    '--label',
    `com.stdu.owner=${ownerLabel}`,
    '--tmpfs',
    '/var/lib/postgresql:rw,noexec,nosuid,size=512m',
    '-p',
    '127.0.0.1::5432',
    '-e',
    `POSTGRES_PASSWORD=${pgPassword}`,
    'postgres:18.6-bookworm',
  ]);
  pgStarted = true;
  await docker([
    'run',
    '--rm',
    '-d',
    '--name',
    redisName,
    '--label',
    `com.stdu.owner=${ownerLabel}`,
    '--tmpfs',
    '/data:rw,noexec,nosuid,size=128m',
    '-p',
    '127.0.0.1::6379',
    'redis:8.10.1-alpine3.23',
    'redis-server',
    '--save',
    '',
    '--appendonly',
    'no',
  ]);
  redisStarted = true;

  const pgPort = await portOf(pgName, '5432/tcp');
  const redisPort = await portOf(redisName, '6379/tcp');
  const migrationUrl = `${migrationUrlBase}${pgPort}/postgres`;
  const runtimeUrl = `${runtimeUrlBase}${pgPort}/postgres?application_name=stdu-r1-002b-api`;
  await waitForPostgres(migrationUrl);
  await verifyFreshAndRepeatedMigration(migrationUrl);
  const redisUrl = `redis://127.0.0.1:${redisPort}/0`;
  await waitForRedis(redisUrl);

  const testEnv = {
    ...process.env,
    MIGRATION_DATABASE_URL: migrationUrl,
    STAFF_DATABASE_URL: runtimeUrl,
    STDU_RUNTIME_PASSWORD: runtimePassword,
    REDIS_URL: redisUrl,
    SESSION_HMAC_KEY: randomBytes(32).toString('hex'),
    RATE_LIMIT_KEY: randomBytes(32).toString('hex'),
    APP_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '3001',
    STAFF_ORIGINS: 'http://127.0.0.1:3000',
    COOKIE_PROFILE: 'loopback',
  };
  await run(
    process.execPath,
    [
      vitestCli,
      'run',
      'apps/api/test/r1-002b.runtime.test.ts',
      ...(process.env.R1_TEST_NAME ? ['-t', process.env.R1_TEST_NAME] : []),
    ],
    { env: testEnv },
  );
  const afterTests = new Client({ connectionString: migrationUrl });
  await afterTests.connect();
  const sentinel = await afterTests.query(
    "SELECT payload FROM fixture_sentinel.sentinel WHERE key='r1-002b'",
  );
  await afterTests.end();
  if (sentinel.rows[0]?.payload !== 'must-survive-migration')
    throw new Error('Runtime tests changed the pre-existing sentinel fixture.');
  console.log('PASS post-runtime sentinel snapshot unchanged.');
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : 'R1-002B runtime test orchestration failed.',
  );
  exitCode = 1;
} finally {
  if (redisStarted) await assertOwnedAndStop(redisName);
  if (pgStarted) await assertOwnedAndStop(pgName);
  process.exitCode = exitCode;
}
