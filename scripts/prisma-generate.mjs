import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Prisma's generator only validates schema and writes source; it never connects.
// This local-only fallback keeps clean builds from needing real DB credentials.
const env = { ...process.env };
env.DATABASE_URL ??= 'postgresql://build:build@127.0.0.1:5432/build';
env.MIGRATION_DATABASE_URL ??= env.DATABASE_URL;
const prismaCli = resolve('node_modules/prisma/build/index.js');
if (!existsSync(prismaCli))
  throw new Error('Prisma CLI is not installed for @stdu/api');

const result = spawnSync(process.execPath, [prismaCli, 'generate'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
