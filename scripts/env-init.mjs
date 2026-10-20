import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { root } from './lib.mjs';

const file = resolve(root, '.env.local');
if (existsSync(file)) {
  console.log('.env.local already exists; preserved without changes.');
} else {
  const pg = randomBytes(32).toString('hex');
  const redis = randomBytes(32).toString('hex');
  const env = [
    'APP_ENV=development',
    'POSTGRES_USER=stdu',
    'POSTGRES_DB=stdu',
    'POSTGRES_HOST_PORT=15432',
    'REDIS_HOST_PORT=16379',
    `POSTGRES_PASSWORD=${pg}`,
    `REDIS_PASSWORD=${redis}`,
    `DATABASE_URL=postgresql://stdu:${pg}@127.0.0.1:15432/stdu`,
    `REDIS_URL=redis://:${redis}@127.0.0.1:16379/0`,
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
