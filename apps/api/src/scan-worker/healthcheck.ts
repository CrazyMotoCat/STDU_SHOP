import { Client } from 'pg';
import { ClamSession, ScanProtocolError } from '../inquiries/scan-protocol.js';
import { readResourceSnapshot } from './resource-readiness.js';

const HEALTHCHECK_DEADLINE_MS = 15_000;

async function verifyWorkerDependencies() {
  const deadlineAt = Date.now() + HEALTHCHECK_DEADLINE_MS;
  const connectionString = process.env.SCAN_DATABASE_URL?.trim();
  const host = process.env.CLAMD_HOST?.trim();
  const port = Number(process.env.CLAMD_PORT ?? '3310');
  if (!connectionString || !host || !Number.isInteger(port))
    throw new Error('Scanner worker health configuration is invalid.');

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 2000,
    query_timeout: 3000,
    statement_timeout: 2500,
  });
  let scanner: ClamSession | undefined;
  try {
    await client.connect();
    await client.query('SELECT 1');
    const remainingMs = Math.max(1, deadlineAt - Date.now());
    scanner = await ClamSession.connect(
      host,
      port,
      Math.min(2_000, remainingMs),
      remainingMs,
    );
    if (!(await scanner.attest(deadlineAt)).ready)
      throw new Error('Scanner worker dependencies are not ready.');
    await readResourceSnapshot(deadlineAt);
  } finally {
    await Promise.all([
      client.end().catch(() => undefined),
      scanner?.close().catch(() => undefined),
    ]);
  }
}

function safeFailureCode(error: unknown) {
  if (error instanceof ScanProtocolError) return error.code;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,40}$/.test(error.code)
  )
    return error.code;
  return error instanceof Error ? error.name : 'UNKNOWN';
}

void verifyWorkerDependencies().catch((error: unknown) => {
  process.stderr.write(
    JSON.stringify({
      event: 'scan.worker.healthcheck_failed',
      failureCode: safeFailureCode(error),
    }) + '\n',
  );
  process.exitCode = 1;
});
