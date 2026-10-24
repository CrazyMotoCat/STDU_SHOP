import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { Redis } from 'ioredis';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const serviceRoot = resolve(repoRoot, 'services/ingestion');
const python = resolve(
  serviceRoot,
  process.platform === 'win32'
    ? '.venv/Scripts/python.exe'
    : '.venv/bin/python',
);
const composeFile = resolve(
  repoRoot,
  'infra/compose/compose.r1-006b-test.yaml',
);
const require = createRequire(resolve(repoRoot, 'package.json'));
const prismaCli = require.resolve('prisma/build/index.js', {
  paths: [apiRoot],
});
const tsxCli = require.resolve('tsx/cli', { paths: [repoRoot] });
const vitestCli = resolve(
  dirname(require.resolve('vitest/package.json', { paths: [repoRoot] })),
  'vitest.mjs',
);
const project = `stdu-r1-006b-test-${process.pid}-${randomUUID().slice(0, 8)}`;
const pgPassword = randomBytes(32).toString('base64url');
const runtimePassword = randomBytes(32).toString('base64url');
const redisPassword = randomBytes(32).toString('base64url');
const adminEmail = `r1-006b-${randomUUID().slice(0, 8)}@example.invalid`;
const adminPassword = `R1-006B runtime ${randomBytes(24).toString('base64url')}!`;
const envPorts = {};
let composeAttempted = false;
let ingestionProcess;
let storageRoot;
let exitCode = 0;

function spawnOwned(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
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
  const processInfo = spawnOwned(command, args, { ...options, capture: true });
  const result = await processInfo.closed;
  if (result.code === 0) return processInfo.stdout.trim();
  const error = new Error(
    `${command} exited ${result.code ?? result.signal}: ${processInfo.stderr.trim().slice(-4000)}`,
  );
  error.stdout = processInfo.stdout;
  error.stderr = processInfo.stderr;
  throw error;
}

function waitForClose(info, timeoutMs) {
  return Promise.race([
    info.closed.then((result) => ({ closed: true, result })),
    delay(timeoutMs).then(() => ({ closed: false })),
  ]);
}

async function stopOwnedProcess(info, label) {
  if (!info) return;
  if (info.child.exitCode !== null || info.child.signalCode !== null) {
    await info.closed;
    return;
  }
  try {
    info.child.kill('SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const graceful = await waitForClose(info, 5_000);
  if (graceful.closed) return;
  if (!info.child.pid)
    throw new Error(
      `${label} did not close and has no owned PID for bounded termination.`,
    );
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(info.child.pid), '/T', '/F'], {
      capture: true,
    });
  } else {
    try {
      process.kill(-info.child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  const forced = await waitForClose(info, 5_000);
  if (!forced.closed)
    throw new Error(
      `${label} remained alive after owned-tree force termination. ${info.stderr.slice(-2000)}`,
    );
}

async function loopbackPort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not reserve a loopback test port.');
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return address.port;
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
      await delay(400);
    }
  }
  throw new Error(
    `Owned disposable PostgreSQL did not become ready: ${lastError?.message ?? 'timeout'}`,
  );
}

async function waitForRedis(url) {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 1_000,
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
      await delay(300);
    }
  }
  client.disconnect();
  throw new Error(
    `Owned disposable Redis did not become ready: ${lastError?.message ?? 'timeout'}`,
  );
}

async function waitForParser(port) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (
      ingestionProcess?.child.exitCode !== null &&
      ingestionProcess?.child.exitCode !== undefined
    )
      throw new Error(
        `Owned ingestion parser exited early: ${ingestionProcess.stderr.slice(-3000)}`,
      );
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Owned ingestion parser did not become ready: ${lastError?.message ?? 'timeout'}\n${ingestionProcess?.stderr.slice(-3000) ?? ''}`,
  );
}

async function compose(args, env) {
  return run('docker', ['compose', '-p', project, '-f', composeFile, ...args], {
    env,
    capture: true,
  });
}

async function cleanupCompose(env) {
  if (!composeAttempted) return;
  const ids = await compose(['ps', '-q'], env)
    .then((output) => output.split(/\r?\n/).filter(Boolean))
    .catch(() => []);
  if (ids.length) {
    const inspected = JSON.parse(
      await run('docker', ['inspect', ...ids], { capture: true }),
    );
    if (
      inspected.some(
        (container) =>
          container.Config?.Labels?.['com.docker.compose.project'] !== project,
      )
    )
      throw new Error(
        `Refusing cleanup: project ${project} returned a container with mismatched ownership label.`,
      );
  }
  await compose(['down', '--remove-orphans', '--timeout', '15'], env);
}

async function main() {
  if (
    !(await import('node:fs/promises').then(({ access }) =>
      access(python).then(
        () => true,
        () => false,
      ),
    ))
  )
    throw new Error(
      'Ingestion .venv is missing. Run uv sync --project services/ingestion --locked first.',
    );
  const pgPort = await loopbackPort();
  const redisPort = await loopbackPort();
  const parserPort = await loopbackPort();
  storageRoot = await mkdtemp(resolve(tmpdir(), 'stdu-r1-006b-private-files-'));
  Object.assign(envPorts, {
    R1_006B_TEST_PG_PORT: String(pgPort),
    R1_006B_TEST_REDIS_PORT: String(redisPort),
    R1_006B_TEST_PG_PASSWORD: pgPassword,
    R1_006B_TEST_REDIS_PASSWORD: redisPassword,
  });
  const composeEnv = { ...process.env, ...envPorts };
  composeAttempted = true;
  console.log(
    `Starting isolated disposable Compose project ${project} on loopback ports ${pgPort}/${redisPort}. No named volumes are configured.`,
  );
  await compose(['up', '-d', '--wait', '--wait-timeout', '120'], composeEnv);

  const ownerUrl = `postgresql://postgres:${encodeURIComponent(pgPassword)}@127.0.0.1:${pgPort}/stdu_r1_006b_test`;
  const runtimeUrl = `postgresql://stdu_runtime:${encodeURIComponent(runtimePassword)}@127.0.0.1:${pgPort}/stdu_r1_006b_test`;
  const redisUrl = `redis://default:${encodeURIComponent(redisPassword)}@127.0.0.1:${redisPort}/0`;
  await waitForPostgres(ownerUrl);
  await waitForRedis(redisUrl);

  const sentinel = new Client({ connectionString: ownerUrl });
  await sentinel.connect();
  await sentinel.query('CREATE SCHEMA r1_006b_runtime_sentinel');
  await sentinel.query(
    'CREATE TABLE r1_006b_runtime_sentinel.marker (key text PRIMARY KEY, value text NOT NULL)',
  );
  await sentinel.query(
    "INSERT INTO r1_006b_runtime_sentinel.marker VALUES ('preserved', 'no volume or migration cleanup')",
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
  const fixtureEnv = {
    ...migrationEnv,
    R1_006B_TEST_ADMIN_EMAIL: adminEmail,
    R1_006B_TEST_ADMIN_PASSWORD: adminPassword,
  };
  const adminId = await run(
    process.execPath,
    [tsxCli, resolve(apiRoot, 'scripts/seed-r1-006b-runtime-admin.ts')],
    { cwd: apiRoot, env: fixtureEnv },
  );
  await run(
    process.execPath,
    [
      tsxCli,
      resolve(apiRoot, 'scripts/catalog-permissions.ts'),
      '--target-user-id',
      adminId,
      '--owner-approval-ref',
      'R1-006B-DISPOSABLE-TEST-ONLY',
      '--operator',
      'R1-006B disposable runtime harness',
    ],
    {
      cwd: apiRoot,
      env: {
        ...fixtureEnv,
        STAFF_DATABASE_URL: runtimeUrl,
        APP_ENV: 'development',
      },
    },
  );

  const ingestionEnv = {
    ...process.env,
    API_INTERNAL_URL: 'http://127.0.0.1:1',
  };
  ingestionProcess = spawnOwned(
    python,
    [
      '-m',
      'uvicorn',
      'ingestion.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      String(parserPort),
    ],
    { cwd: serviceRoot, env: ingestionEnv, capture: true },
  );
  await waitForParser(parserPort);

  const testEnv = {
    ...process.env,
    MIGRATION_DATABASE_URL: ownerUrl,
    STAFF_DATABASE_URL: runtimeUrl,
    REDIS_URL: redisUrl,
    INGESTION_INTERNAL_URL: `http://127.0.0.1:${parserPort}`,
    FILE_STORAGE_ROOT: storageRoot,
    APP_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '3001',
    COOKIE_PROFILE: 'loopback',
    STAFF_ORIGINS: 'http://127.0.0.1:3000',
    SESSION_HMAC_KEY: randomBytes(32).toString('hex'),
    RATE_LIMIT_KEY: randomBytes(32).toString('hex'),
    R1_006B_TEST_ADMIN_EMAIL: adminEmail,
    R1_006B_TEST_ADMIN_PASSWORD: adminPassword,
  };
  await run(
    process.execPath,
    [vitestCli, 'run', 'apps/api/test/r1-006b.import.runtime.test.ts'],
    { cwd: repoRoot, env: testEnv },
  );

  const verify = new Client({ connectionString: ownerUrl });
  await verify.connect();
  const persisted = await verify.query(
    "SELECT value FROM r1_006b_runtime_sentinel.marker WHERE key='preserved'",
  );
  await verify.end();
  if (persisted.rows[0]?.value !== 'no volume or migration cleanup')
    throw new Error(
      'Disposable runtime migration altered its sentinel fixture.',
    );
  console.log('PASS R1-006B disposable database sentinel preserved.');
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.stack : 'R1-006B runtime failed.',
  );
  exitCode = 1;
} finally {
  try {
    await stopOwnedProcess(ingestionProcess, 'Ingestion parser');
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Ingestion shutdown failed.',
    );
    exitCode = 1;
  }
  try {
    await cleanupCompose({ ...process.env, ...envPorts });
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Disposable Compose cleanup failed.',
    );
    exitCode = 1;
  }
  if (storageRoot) {
    const target = resolve(storageRoot);
    if (target.startsWith(resolve(tmpdir()))) {
      try {
        await rm(target, { recursive: true, force: true });
      } catch (error) {
        console.error(
          error instanceof Error
            ? `Owned private test files cleanup failed: ${error.message}`
            : 'Owned private test files cleanup failed.',
        );
        exitCode = 1;
      }
    } else {
      console.error(
        'Refusing to remove private test files outside the temporary directory.',
      );
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
}
