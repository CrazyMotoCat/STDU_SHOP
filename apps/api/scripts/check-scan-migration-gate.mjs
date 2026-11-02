import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const api = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const { Client } = require('pg');
const prisma = require.resolve('prisma/build/index.js');
const container = `stdu-scan-gate-${process.pid}-${randomBytes(4).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const database = 'stdu_scan_gate_history';
const scanName = '20261028120000_inquiry_scan_jobs';
const scratch = await mkdtemp(resolve(api, '.scan-gate-'));
let client;
let created = false;
let volumeCreated = false;
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
  });
const run = (args, env, success = true) => {
  let result;
  try {
    result = {
      status: 0,
      output: execFileSync(process.execPath, args, {
        cwd: api,
        env,
        encoding: 'utf8',
        timeout: 180000,
        windowsHide: true,
        stdio: 'pipe',
      }),
    };
  } catch (error) {
    result = {
      status: error.status,
      output: `${error.stdout}\n${error.stderr}`,
    };
  }
  assert.equal(result.status === 0, success, result.output);
  if (!success)
    assert.match(
      result.output,
      /Explicit scan migration approval and exact disposable target required|Default migrate dev is blocked/,
    );
  return result.output;
};
try {
  assert.equal(require('prisma/package.json').version, '7.10.1');
  docker([
    'volume',
    'create',
    '--label',
    `stdu.scan-gate=${container}`,
    container,
  ]);
  volumeCreated = true;
  docker([
    'run',
    '-d',
    '--name',
    container,
    '--label',
    `stdu.scan-gate=${container}`,
    '--mount',
    `type=volume,source=${container},target=/var/lib/postgresql`,
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    `POSTGRES_DB=${database}`,
    '-p',
    '127.0.0.1::5432',
    'postgres:18.6-bookworm',
  ]);
  created = true;
  let port = docker(['port', container, '5432/tcp']).trim().split(':').pop();
  let url = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
  const env = { ...process.env, MIGRATION_DATABASE_URL: url };
  delete env.STDU_SCAN_MIGRATION_APPROVAL;
  delete env.STDU_SCAN_MIGRATION_TARGET;
  const connect = async () => {
    for (let i = 0; i < 80; i++) {
      const next = new Client({
        connectionString: url,
        connectionTimeoutMillis: 1000,
      });
      try {
        await next.connect();
        return next;
      } catch {
        await next.end().catch(() => {});
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    throw new Error('Owned PostgreSQL did not become ready');
  };
  client = await connect();
  await client.query('CREATE ROLE stdu_runtime NOLOGIN');
  // Direct default-config Prisma and the exact package-script command are the
  // same argv. Check the package chain so changes cannot silently evade this test.
  assert.equal(
    require('./package.json').scripts['db:migrate:deploy'],
    'prisma migrate deploy',
  );
  assert.equal(
    JSON.parse(await readFile(resolve(api, '../../package.json'), 'utf8'))
      .scripts['db:migrate:deploy'],
    'pnpm --filter @stdu/api db:migrate:deploy',
  );
  execFileSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['db:migrate:deploy'],
    {
      cwd: resolve(api, '../..'),
      env,
      encoding: 'utf8',
      timeout: 180000,
      windowsHide: true,
      shell: process.platform === 'win32',
      stdio: 'pipe',
    },
  );
  run([prisma, 'migrate', 'dev'], env, false);
  run([prisma, 'migrate', 'deploy', '--config', 'prisma.config.ts'], env);
  const noScan = async () => {
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('inquiry_scan_claim','inquiry_scan_finalize','inquiry_scan_retry','inquiry_scan_read_authorized','inquiry_scan_job_insert_after_source')",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='inquiry_scan_job_after_source_insert'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await client.query(
          "SELECT to_regclass('inquiry_source_document_scan_job') AS object",
        )
      ).rows[0].object,
      null,
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_roles WHERE rolname LIKE 'stdu_scan_%'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL',
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name=$1',
          [scanName],
        )
      ).rows[0].n,
      0,
    );
  };
  await noScan();
  const approved = {
    ...env,
    STDU_SCAN_MIGRATION_APPROVAL: 'R1-010D-DISPOSABLE-ONLY',
    STDU_SCAN_MIGRATION_TARGET: database,
  };
  run(['scripts/deploy-scan-migration.mjs'], env, false);
  run(
    ['scripts/deploy-scan-migration.mjs'],
    { ...approved, STDU_SCAN_MIGRATION_TARGET: 'stdu_scan_gate_wrong' },
    false,
  );
  run(
    ['scripts/deploy-scan-migration.mjs'],
    { ...env, NODE_ENV: 'production', CI: 'true', APP_ENV: 'test' },
    false,
  );
  await noScan();
  run(['scripts/deploy-scan-migration.mjs'], approved);
  const history = async () =>
    (
      await client.query(
        'SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
      )
    ).rows;
  const before = await history();
  const scan = before.find((row) => row.migration_name === scanName);
  assert.ok(scan?.finished_at);
  const original = await readFile(
    resolve(api, `prisma/scan-migrations/${scanName}/migration.sql`),
  );
  assert.equal(
    scan.checksum,
    createHash('sha256').update(original).digest('hex'),
  );
  assert.equal(
    scan.checksum,
    '05d42564dd8389c0b4422cdf57a3e2ceb3abba45d9892c4a89fdddc338ce1e0c',
  );
  run(['scripts/deploy-scan-migration.mjs'], approved);
  run([prisma, 'migrate', 'deploy'], env);
  assert.deepEqual(await history(), before);
  await client.end();
  client = undefined;
  docker(['restart', container]);
  port = docker(['port', container, '5432/tcp']).trim().split(':').pop();
  url = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
  env.MIGRATION_DATABASE_URL = url;
  approved.MIGRATION_DATABASE_URL = url;
  client = await connect();
  run([prisma, 'migrate', 'deploy'], env);
  run(['scripts/deploy-scan-migration.mjs'], approved);
  assert.deepEqual(await history(), before);
  // A future ordinary migration still applies with the scan migration absent
  // from the default path and present in DB history.
  await cp(resolve(api, 'prisma/migrations'), resolve(scratch, 'migrations'), {
    recursive: true,
  });
  await mkdir(
    resolve(scratch, 'migrations/20990101000000_future_gate_fixture'),
  );
  await writeFile(
    resolve(
      scratch,
      'migrations/20990101000000_future_gate_fixture/migration.sql',
    ),
    'CREATE TABLE future_gate_fixture(id integer);',
  );
  const config = resolve(scratch, 'prisma.config.ts');
  await writeFile(
    config,
    `import {defineConfig,env} from 'prisma/config';export default defineConfig({schema:${JSON.stringify(resolve(api, 'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(resolve(scratch, 'migrations'))}},datasource:{url:env('MIGRATION_DATABASE_URL')}});`,
  );
  run([prisma, 'migrate', 'deploy', '--config', config], env);
  assert.ok(
    (await client.query("SELECT to_regclass('future_gate_fixture') AS object"))
      .rows[0].object,
  );
  assert.deepEqual(
    (await history()).filter(
      (row) => row.migration_name !== '20990101000000_future_gate_fixture',
    ),
    before,
  );
  console.log(
    'PASS Prisma7.10.1: default/direct deploy isolated; missing/wrong approval leaves no failed migration; original checksum; approved/repeated/restarted deploy; future ordinary migration and history preserved.',
  );
  console.log(
    'Backfill fixtures are independently covered by the full R1-010D runtime. No production connection used.',
  );
} finally {
  await client?.end();
  if (created) {
    const info = JSON.parse(docker(['inspect', container]))[0];
    assert.equal(info.Config.Labels['stdu.scan-gate'], container);
    docker(['rm', '-f', container]);
  }
  if (volumeCreated) {
    const volume = JSON.parse(docker(['volume', 'inspect', container]))[0];
    assert.equal(volume.Labels['stdu.scan-gate'], container);
    docker(['volume', 'rm', container]);
  }
  await rm(scratch, { recursive: true, force: true });
}
