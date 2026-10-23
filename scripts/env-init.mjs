import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  appendFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { root } from './lib.mjs';

const file = resolve(root, '.env.local');
if (existsSync(file)) {
  const contents = readFileSync(file, 'utf8');
  const values = new Map(
    contents
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return separator < 0
          ? [line, '']
          : [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  const additions = [];
  const addMissing = (key, value) => {
    if (!values.has(key)) {
      additions.push(`${key}=${value}`);
      values.set(key, value);
    }
  };
  const databaseUrl = new URL(
    values.get('DATABASE_URL') ??
      'postgresql://stdu:local@127.0.0.1:15432/stdu',
  );
  const database = databaseUrl.pathname.slice(1) || 'stdu';
  const runtimePassword = randomBytes(32).toString('hex');
  addMissing('STDU_RUNTIME_PASSWORD', runtimePassword);
  addMissing('MIGRATION_DATABASE_URL', values.get('DATABASE_URL') ?? '');
  addMissing(
    'STAFF_DATABASE_URL',
    `postgresql://stdu_runtime:${values.get('STDU_RUNTIME_PASSWORD')}@127.0.0.1:${databaseUrl.port || '5432'}/${database}`,
  );
  addMissing(
    'STAFF_COMPOSE_DATABASE_URL',
    `postgresql://stdu_runtime:${values.get('STDU_RUNTIME_PASSWORD')}@postgres:5432/${database}`,
  );
  addMissing('SESSION_HMAC_KEY', randomBytes(32).toString('hex'));
  addMissing('RATE_LIMIT_KEY', randomBytes(32).toString('hex'));
  if (
    values.get('STAFF_ORIGINS') ===
    'http://localhost:3000,http://127.0.0.1:3000'
  ) {
    additions.push('STAFF_ORIGINS=http://127.0.0.1:3000');
    values.set('STAFF_ORIGINS', 'http://127.0.0.1:3000');
  } else addMissing('STAFF_ORIGINS', 'http://127.0.0.1:3000');
  addMissing('COOKIE_PROFILE', 'loopback');
  if (additions.length) {
    appendFileSync(
      file,
      `${contents.endsWith('\n') || !contents ? '' : '\n'}${additions.join('\n')}\n`,
    );
    console.log(
      'Added missing local Staff Identity settings to .env.local; existing values were preserved.',
    );
  } else {
    console.log(
      '.env.local already has the required settings; preserved without changes.',
    );
  }
} else {
  const pg = randomBytes(32).toString('hex');
  const redis = randomBytes(32).toString('hex');
  const runtime = randomBytes(32).toString('hex');
  const sessionHmac = randomBytes(32).toString('hex');
  const rateLimit = randomBytes(32).toString('hex');
  const env = [
    'APP_ENV=development',
    'POSTGRES_USER=stdu',
    'POSTGRES_DB=stdu',
    'POSTGRES_HOST_PORT=15432',
    'REDIS_HOST_PORT=16379',
    `POSTGRES_PASSWORD=${pg}`,
    `REDIS_PASSWORD=${redis}`,
    `DATABASE_URL=postgresql://stdu_runtime:${runtime}@127.0.0.1:15432/stdu`,
    `MIGRATION_DATABASE_URL=postgresql://stdu:${pg}@127.0.0.1:15432/stdu`,
    `STAFF_DATABASE_URL=postgresql://stdu_runtime:${runtime}@127.0.0.1:15432/stdu`,
    `STAFF_COMPOSE_DATABASE_URL=postgresql://stdu_runtime:${runtime}@postgres:5432/stdu`,
    `REDIS_URL=redis://:${redis}@127.0.0.1:16379/0`,
    `STDU_RUNTIME_PASSWORD=${runtime}`,
    `SESSION_HMAC_KEY=${sessionHmac}`,
    `RATE_LIMIT_KEY=${rateLimit}`,
    'STAFF_ORIGINS=http://127.0.0.1:3000',
    'COOKIE_PROFILE=loopback',
    'API_INTERNAL_URL=http://127.0.0.1:3001',
    'FILE_STORAGE_ROOT=.local/files',
    '',
  ].join('\n');
  writeFileSync(file, env, { flag: 'wx', mode: 0o600 });
  mkdirSync(resolve(root, '.local/files'), { recursive: true });
  console.log(
    'Created ignored .env.local with independent random local credentials. Values are not displayed.',
  );
}
