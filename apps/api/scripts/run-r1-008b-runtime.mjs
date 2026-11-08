import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { withProcesses } from '../../../scripts/process-lifecycle.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const composeFile = resolve(
  repoRoot,
  'infra/compose/compose.r1-008b-test.yaml',
);
const require = createRequire(resolve(repoRoot, 'package.json'));
const prismaCli = require.resolve('prisma/build/index.js', {
  paths: [apiRoot],
});
const vitestCli = resolve(
  dirname(require.resolve('vitest/package.json', { paths: [repoRoot] })),
  'vitest.mjs',
);
const project = `stdu-r1-008b-test-${process.pid}-${randomUUID().slice(0, 8)}`;
const pgPassword = randomBytes(32).toString('base64url');
const runtimePassword = randomBytes(32).toString('base64url');
const redisPassword = randomBytes(32).toString('base64url');
const portEnv = {};
let composeAttempted = false;
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
    if (info.child.pid) {
      if (process.platform === 'win32') {
        await new Promise((resolveClose) => {
          const killer = spawn(
            'taskkill',
            ['/PID', String(info.child.pid), '/T', '/F'],
            {
              stdio: 'ignore',
              windowsHide: true,
            },
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
    }
    throw new Error(
      `${command} exceeded ${timeoutMs}ms and its owned process tree was terminated.`,
    );
  }
  if (outcome.result.code === 0)
    return options.includeStderr
      ? `${info.stdout}\n${info.stderr}`.trim()
      : info.stdout.trim();
  const output = `${info.stdout}\n${info.stderr}`;
  throw new Error(
    `${command} exited ${outcome.result.code ?? outcome.result.signal}:\n${output.slice(-5000)}`,
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
    throw new Error('Could not reserve an isolated loopback test port.');
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
    .then((output) => output.split(/\r?\n/).filter(Boolean))
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
        `Refusing cleanup: Compose project ${project} returned a container with a mismatched ownership label.`,
      );
  }
  // Only the generated Compose project owns the PostgreSQL test volume.
  await compose(
    ['down', '--volumes', '--remove-orphans', '--timeout', '15'],
    env,
  );
}

async function main() {
  const pgPort = await reservePort();
  const redisPort = await reservePort();
  const pythonPort = await reservePort();
  const ingestionToken = randomBytes(32).toString('hex');
  Object.assign(portEnv, {
    R1_008B_TEST_PG_PORT: String(pgPort),
    R1_008B_TEST_REDIS_PORT: String(redisPort),
    R1_008B_TEST_PG_PASSWORD: pgPassword,
    R1_008B_TEST_REDIS_PASSWORD: redisPassword,
  });
  const composeEnv = { ...process.env, ...portEnv };
  composeAttempted = true;
  console.log(
    `Starting owned disposable project ${project} on loopback ports ${pgPort}/${redisPort}; PostgreSQL uses a project-owned disposable volume.`,
  );
  await compose(['up', '-d', '--wait', '--wait-timeout', '120'], composeEnv);

  const ownerUrl = `postgresql://postgres:${encodeURIComponent(pgPassword)}@127.0.0.1:${pgPort}/stdu_r1_008b_test`;
  const runtimeUrl = `postgresql://stdu_runtime:${encodeURIComponent(runtimePassword)}@127.0.0.1:${pgPort}/stdu_r1_008b_test`;
  const redisUrl = `redis://default:${encodeURIComponent(redisPassword)}@127.0.0.1:${redisPort}/0`;
  await waitForPostgres(ownerUrl);

  const sentinel = new Client({ connectionString: ownerUrl });
  await sentinel.connect();
  await sentinel.query('CREATE SCHEMA r1_008b_runtime_sentinel');
  await sentinel.query(
    'CREATE TABLE r1_008b_runtime_sentinel.marker (key text PRIMARY KEY, value text NOT NULL)',
  );
  await sentinel.query(
    "INSERT INTO r1_008b_runtime_sentinel.marker VALUES ('preserved', 'disposable test database only')",
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
  await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: migrationEnv,
  });

  const python = resolve(
    repoRoot,
    'services/ingestion/.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const testEnv = {
    ...process.env,
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
    SUPPLIER_INGESTION_TOKEN: ingestionToken,
    SUPPLIER_INGESTION_URL: `http://127.0.0.1:${pythonPort}`,
    SUPPLIER_INGESTION_WORKER_ENABLED: 'false',
    R1_008B_TEST_ENABLED: 'true',
    R1_008B_TEST_COMPOSE_PROJECT: project,
    R1_008B_TEST_COMPOSE_FILE: composeFile,
    ...portEnv,
  };
  await withProcesses(
    [
      {
        name: 'r1-008b-python',
        command: python,
        args: [
          '-m',
          'uvicorn',
          'ingestion.main:app',
          '--host',
          '127.0.0.1',
          '--port',
          String(pythonPort),
          '--log-level',
          'warning',
        ],
        cwd: resolve(repoRoot, 'services/ingestion'),
        env: testEnv,
        capture: true,
      },
    ],
    async () => {
      const deadline = Date.now() + 30_000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          ready = (
            await fetch(`${testEnv.SUPPLIER_INGESTION_URL}/health/live`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok;
        } catch {
          /* Owned child is starting. */
        }
        if (ready) break;
        await delay(100);
      }
      if (!ready)
        throw new Error('Owned Python extraction service did not start.');
      console.log(
        await run(
          process.execPath,
          [
            vitestCli,
            'run',
            '--silent=false',
            'apps/api/test/r1-008b.ingestion.runtime.test.ts',
          ],
          {
            cwd: repoRoot,
            includeStderr: true,
            env: testEnv,
            timeoutMs: 300_000,
          },
        ),
      );
    },
  );

  const verify = new Client({ connectionString: ownerUrl });
  await verify.connect();
  const persisted = await verify.query(
    "SELECT value FROM r1_008b_runtime_sentinel.marker WHERE key='preserved'",
  );
  await verify.end();
  if (persisted.rows[0]?.value !== 'disposable test database only')
    throw new Error(
      'R1-008B migration or runtime changed its isolated sentinel.',
    );
  console.log('PASS R1-008B disposable PostgreSQL sentinel preserved.');
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.stack : 'R1-008B runtime failed.',
  );
  exitCode = 1;
} finally {
  try {
    await cleanupCompose({ ...process.env, ...portEnv });
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Owned Compose cleanup failed.',
    );
    exitCode = 1;
  }
  process.exitCode = exitCode;
}
