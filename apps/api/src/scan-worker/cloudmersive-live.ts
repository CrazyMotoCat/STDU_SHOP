import { Agent, request } from 'node:https';
import { mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { fileURLToPath } from 'node:url';
import {
  requestAdvanced,
  validateStructure,
  type Outcome,
} from './cloudmersive.js';

const fixtures = Object.freeze({
  'comma-csv': 'fixture,quantity\nsynthetic-relay,2\n',
  'semicolon-csv': 'fixture;quantity\nsynthetic-breaker;1\n',
});
const origin = 'api.cloudmersive.com';

export function createDirectTlsAgent(ca?: string): Agent {
  return new Agent({
    ca: ca ?? [...rootCertificates],
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
    keepAlive: false,
    proxyEnv: {},
  });
}

async function record(directory: string, name: string): Promise<void> {
  const file = await open(join(directory, name), 'wx', 0o600);
  try {
    await file.writeFile('SEC-API-03\n');
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Serializes one isolated campaign. A crash leaves the lock in place for review. */
export async function runSyntheticCampaign(
  directory: string,
  fixture: string,
  scan: (bytes: Buffer) => Promise<Outcome>,
): Promise<Outcome> {
  if (!Object.hasOwn(fixtures, fixture))
    throw new Error('SEC_API_03_UNKNOWN_FIXTURE');
  const bytes = Buffer.from(fixtures[fixture as keyof typeof fixtures], 'utf8');
  if (!(await validateStructure(bytes, 'csv')))
    throw new Error('SEC_API_03_INVALID_FIXTURE');

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, 'active');
  await mkdir(lock, { mode: 0o700 });
  try {
    const entries = await readdir(directory);
    const reservation = fixture + '.reserved';
    if (
      entries.includes('halted') ||
      entries.includes(reservation) ||
      entries.filter((entry) => entry.endsWith('.reserved')).length >=
        Object.keys(fixtures).length
    )
      throw new Error('SEC_API_03_BUDGET_CLOSED');
    // The pending marker survives any interruption after reservation.
    await record(directory, 'halted');
    await record(directory, reservation);
    const result = await scan(bytes);
    if (result === 'CLEAN_VERIFIED') {
      await unlink(join(directory, 'halted'));
    }
    return result;
  } finally {
    await rmdir(lock);
  }
}

export async function scanLiveSynthetic(fixture: string): Promise<Outcome> {
  const apiKey = process.env.CLOUDMERSIVE_TEST_API_KEY ?? '';
  if (
    process.env.APP_ENV !== 'development' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.SEC_API_03_LIVE_APPROVAL !== 'approved-synthetic-only' ||
    !/^[\x21-\x7e]{1,512}$/.test(apiKey)
  )
    throw new Error('SEC_API_03_DISABLED');

  const agent = createDirectTlsAgent();
  try {
    return await runSyntheticCampaign(
      fileURLToPath(
        new URL('../../../../.local/sec-api-03-ledger', import.meta.url),
      ),
      fixture,
      (bytes) =>
        requestAdvanced(
          (options, callback) =>
            request(
              {
                ...options,
                hostname: origin,
                servername: origin,
                port: 443,
                agent,
                rejectUnauthorized: true,
                minVersion: 'TLSv1.2',
              },
              callback,
            ),
          apiKey,
          bytes,
          'csv',
        ),
    );
  } finally {
    agent.destroy();
  }
}
