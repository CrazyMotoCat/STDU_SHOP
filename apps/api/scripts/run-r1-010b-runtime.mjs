import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const composeFile = resolve(
  repoRoot,
  'infra/compose/compose.r1-010b-test.yaml',
);
const require = createRequire(resolve(repoRoot, 'package.json'));
const prismaCli = require.resolve('prisma/build/index.js', {
  paths: [apiRoot],
});
const vitestCli = resolve(
  dirname(require.resolve('vitest/package.json', { paths: [repoRoot] })),
  'vitest.mjs',
);
const project = `stdu-r1-010b-test-${process.pid}-${randomUUID().slice(0, 8)}`;
const pgPassword = randomBytes(32).toString('base64url');
const runtimePassword = randomBytes(32).toString('base64url');
const redisPassword = randomBytes(32).toString('base64url');
const portEnv = {};
let composeAttempted = false;
let storageRoot;
let redisDataRoot;
let diagnosticDatabaseUrl;
let migrationAttempted = false;
let migrationSucceeded = false;
let exitCode = 0;

function spawnOwned(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
  const closed = new Promise((resolveClose, rejectClose) => {
    let settled = false;
    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        rejectClose(error);
      }
    });
    child.once('close', (code, signal) => {
      if (!settled) {
        settled = true;
        resolveClose({ code, signal });
      }
    });
  });
  return {
    child,
    closed,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function terminateOwned(info) {
  if (!info.child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolveClose) => {
      const killer = spawn(
        'taskkill',
        ['/PID', String(info.child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      );
      killer.once('close', resolveClose);
      killer.once('error', resolveClose);
    });
  } else {
    try {
      process.kill(-info.child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  await Promise.race([info.closed.catch(() => undefined), delay(5000)]);
}

async function run(command, args, options = {}) {
  const info = spawnOwned(command, args, options);
  const timeoutMs = options.timeoutMs ?? 180_000;
  let timer;
  const outcome = await Promise.race([
    info.closed.then((result) => ({ kind: 'closed', result })),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout({ kind: 'timeout' }), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
  if (outcome.kind === 'timeout') {
    await terminateOwned(info);
    throw new Error(
      `${command} exceeded ${timeoutMs}ms; only its owned process tree was terminated.`,
    );
  }
  if (outcome.result.code === 0)
    return options.includeStderr
      ? `${info.stdout}\n${info.stderr}`.trim()
      : info.stdout.trim();
  throw new Error(
    `${command} exited ${outcome.result.code ?? outcome.result.signal}:\n${`${info.stdout}\n${info.stderr}`.slice(-20000)}`,
  );
}

async function reservePort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not reserve isolated test port.');
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return address.port;
}

async function compose(args, env) {
  return run('docker', ['compose', '-p', project, '-f', composeFile, ...args], {
    env,
  });
}

async function waitForPostgres(url) {
  const deadline = Date.now() + 90_000;
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
      await delay(300);
    }
  }
  throw new Error(
    `Disposable PostgreSQL did not become ready: ${lastError?.message ?? 'timeout'}`,
  );
}

async function cleanupCompose(env) {
  if (!composeAttempted) return;
  const ids = await compose(['ps', '-aq'], env)
    .then((out) => out.split(/\r?\n/).filter(Boolean))
    .catch(() => []);
  if (ids.length) {
    const inspected = JSON.parse(await run('docker', ['inspect', ...ids]));
    if (
      inspected.some(
        (container) =>
          container.Config?.Labels?.['com.docker.compose.project'] !== project,
      )
    )
      throw new Error(
        `Refusing cleanup: project ${project} returned a container without its ownership label.`,
      );
  }
  await compose(['down', '--remove-orphans', '--timeout', '15'], env);
}

async function main() {
  const pgPort = await reservePort();
  const redisPort = await reservePort();
  redisDataRoot = await mkdtemp(resolve(tmpdir(), 'stdu-r1-010b-redis-'));
  Object.assign(portEnv, {
    R1_010B_TEST_PG_PORT: String(pgPort),
    R1_010B_TEST_REDIS_PORT: String(redisPort),
    R1_010B_TEST_PG_PASSWORD: pgPassword,
    R1_010B_TEST_REDIS_PASSWORD: redisPassword,
    R1_010B_TEST_REDIS_DATA_ROOT: redisDataRoot.replaceAll('\\', '/'),
  });
  const composeEnv = { ...process.env, ...portEnv };
  composeAttempted = true;
  console.log(
    `Starting disposable owned project ${project} on loopback ports ${pgPort}/${redisPort}; PostgreSQL uses tmpfs and Redis uses an owned temporary directory for restart-persistence checks.`,
  );
  await compose(['up', '-d', '--wait', '--wait-timeout', '120'], composeEnv);
  const ownerUrl = `postgresql://postgres:${encodeURIComponent(pgPassword)}@127.0.0.1:${pgPort}/stdu_r1_010b_test`;
  diagnosticDatabaseUrl = ownerUrl;
  const runtimeUrl = `postgresql://stdu_runtime:${encodeURIComponent(runtimePassword)}@127.0.0.1:${pgPort}/stdu_r1_010b_test`;
  const redisUrl = `redis://default:${encodeURIComponent(redisPassword)}@127.0.0.1:${redisPort}/0`;
  await waitForPostgres(ownerUrl);
  const sentinel = new Client({ connectionString: ownerUrl });
  await sentinel.connect();
  await sentinel.query('CREATE SCHEMA r1_010b_runtime_sentinel');
  await sentinel.query(
    'CREATE TABLE r1_010b_runtime_sentinel.marker (key text PRIMARY KEY, value text NOT NULL)',
  );
  await sentinel.query(
    "INSERT INTO r1_010b_runtime_sentinel.marker VALUES ('preserved','isolated test database only')",
  );
  await sentinel.end();
  const migrationEnv = {
    ...process.env,
    MIGRATION_DATABASE_URL: ownerUrl,
    STDU_RUNTIME_PASSWORD: runtimePassword,
  };
  await run(
    process.execPath,
    [resolve(apiRoot, 'scripts/prepare-runtime-role.mjs')],
    { env: migrationEnv },
  );
  migrationAttempted = true;
  await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: migrationEnv,
  });
  migrationSucceeded = true;
  storageRoot = await mkdtemp(resolve(tmpdir(), 'stdu-r1-010b-storage-'));
  const testEnv = {
    ...process.env,
    ...portEnv,
    MIGRATION_DATABASE_URL: ownerUrl,
    STAFF_DATABASE_URL: runtimeUrl,
    REDIS_URL: redisUrl,
    APP_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '3001',
    COOKIE_PROFILE: 'loopback',
    STAFF_ORIGINS: 'http://127.0.0.1:3000',
    SESSION_HMAC_KEY: randomBytes(32).toString('hex'),
    RATE_LIMIT_KEY: randomBytes(32).toString('hex'),
    INQUIRY_PUBLIC_ENABLED: 'true',
    INQUIRY_UPLOAD_PROFILE: 'MVP_SAFE',
    FILE_STORAGE_ROOT: storageRoot,
    R1_010B_TEST_COMPOSE_PROJECT: project,
    R1_010B_TEST_COMPOSE_FILE: composeFile,
  };
  const acceptanceOutput = await run(
    process.execPath,
    [
      vitestCli,
      'run',
      '--silent=false',
      'apps/api/test/r1-010b.inquiry.runtime.test.ts',
    ],
    {
      cwd: repoRoot,
      env: testEnv,
      includeStderr: true,
      timeoutMs: 600_000,
    },
  );
  console.log(acceptanceOutput);
  const verify = new Client({ connectionString: ownerUrl });
  await verify.connect();
  const persisted = await verify.query(
    "SELECT value FROM r1_010b_runtime_sentinel.marker WHERE key='preserved'",
  );
  await verify.end();
  if (persisted.rows[0]?.value !== 'isolated test database only')
    throw new Error('Runtime changed its disposable sentinel.');
  console.log('PASS isolated Inquiry runtime sentinel preserved.');
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.stack : 'R1-010B runtime failed.',
  );
  if (composeAttempted) {
    if (migrationAttempted && !migrationSucceeded && diagnosticDatabaseUrl) {
      const client = new Client({ connectionString: diagnosticDatabaseUrl });
      try {
        await client.connect();
        const migration = await readFile(
          resolve(
            apiRoot,
            'prisma/migrations/20261026140000_inquiry_domain/migration.sql',
          ),
          'utf8',
        );
        await client.query(migration);
      } catch (migrationError) {
        console.error(
          `First Inquiry migration SQL error: ${migrationError instanceof Error ? migrationError.message : 'unknown SQL error'}`,
        );
      } finally {
        await client.end().catch(() => undefined);
      }
    }
    const diagnostic = await compose(
      ['logs', '--no-color', '--tail', '80', 'postgres'],
      { ...process.env, ...portEnv },
    ).catch(() => '');
    const databaseErrors = diagnostic
      .split(/\r?\n/)
      .filter((line) => /\b(ERROR|DETAIL|CONTEXT):/.test(line));
    if (databaseErrors.length)
      console.error(
        `Disposable PostgreSQL error lines:\n${databaseErrors.slice(-20).join('\n').slice(-8000)}`,
      );
  }
  exitCode = 1;
} finally {
  let composeCleaned = !composeAttempted;
  try {
    await cleanupCompose({ ...process.env, ...portEnv });
    composeCleaned = true;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Owned Compose cleanup failed.',
    );
    exitCode = 1;
  }
  if (composeCleaned && storageRoot) {
    if (!storageRoot.startsWith(resolve(tmpdir(), 'stdu-r1-010b-storage-'))) {
      console.error(
        'Refusing to remove a storage path outside its generated test prefix.',
      );
      exitCode = 1;
    } else await rm(storageRoot, { recursive: true, force: true });
  }
  if (composeCleaned && redisDataRoot) {
    if (!redisDataRoot.startsWith(resolve(tmpdir(), 'stdu-r1-010b-redis-'))) {
      console.error(
        'Refusing to remove a Redis data path outside its generated test prefix.',
      );
      exitCode = 1;
    } else await rm(redisDataRoot, { recursive: true, force: true });
  }
  process.exitCode = exitCode;
}
