import { Pool } from 'pg';
import { scanNext, type Format } from './cloudmersive.js';
import {
  syntheticDatabase,
  syntheticScanEnabled,
} from './synthetic-profile.js';

function localPort(name: string): number {
  const port = Number(process.env[name]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('SEC_API_02_INVALID_PORT');
  return port;
}

async function main() {
  if (!syntheticScanEnabled()) throw new Error('SEC_API_02_DISABLED');
  const database = new URL(process.env.SEC_API_02_WORKER_DATABASE_URL ?? '');
  if (
    database.protocol !== 'postgresql:' ||
    database.hostname !== '127.0.0.1' ||
    database.pathname !== '/' + syntheticDatabase ||
    database.username !== 'sec_api_02_test_worker' ||
    database.search ||
    database.hash
  )
    throw new Error('SEC_API_02_DISPOSABLE_DATABASE_REQUIRED');

  const fixtures = new Map<string, Format>();
  for (const entry of (process.env.SEC_API_02_FIXTURES ?? '').split(',')) {
    const match = /^([a-f0-9]{64}):(pdf|csv|xlsx)$/.exec(entry);
    if (!match || fixtures.has(match[1]!))
      throw new Error('SEC_API_02_INVALID_FIXTURES');
    fixtures.set(match[1]!, match[2]! as Format);
  }
  const streamPort = localPort('SEC_API_02_STREAM_PORT');
  const mockPort = localPort('SEC_API_02_MOCK_PORT');
  const pool = new Pool({
    connectionString: database.href,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    max: 1,
  });
  try {
    process.stdout.write(
      ((await scanNext(pool, streamPort, mockPort, fixtures)) ?? 'NO_JOB') +
        '\n',
    );
  } finally {
    await pool.end();
  }
}

void main().catch(() => {
  process.stderr.write(
    'SEC-API-02 mock worker failed. Verify disposable profile configuration.\n',
  );
  process.exitCode = 1;
});
