import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const target = process.env.STDU_SCAN_MIGRATION_TARGET;
const url = process.env.MIGRATION_DATABASE_URL;
// Operator intent only: not authorization against a privileged migration admin.
// This entry point supports disposable databases, never production approval.
if (
  process.env.STDU_SCAN_MIGRATION_APPROVAL !== 'R1-010D-DISPOSABLE-ONLY' ||
  !target ||
  !/^stdu_(?:r1_010d_test|scan_gate_[a-z0-9_]+)$/.test(target) ||
  !url ||
  decodeURIComponent(new URL(url).pathname.slice(1)) !== target
)
  throw new Error(
    'Explicit scan migration approval and exact disposable target required.',
  );

const client = new Client({
  connectionString: url,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
});
try {
  await client.connect();
  // SQL target verification precedes Prisma: rejected intent cannot leave a
  // failed migration-history entry. The original migration bytes stay intact.
  const result = await client.query('SELECT current_database() AS target');
  if (result.rows[0]?.target !== target)
    throw new Error('Scan migration SQL target mismatch.');
} finally {
  await client.end();
}

const temp = await mkdtemp(resolve(apiRoot, '.r1-010d-approved-'));
try {
  const migrations = resolve(temp, 'migrations');
  await cp(resolve(apiRoot, 'prisma/migrations'), migrations, {
    recursive: true,
  });
  await cp(resolve(apiRoot, 'prisma/scan-migrations'), migrations, {
    recursive: true,
  });
  const config = resolve(temp, 'prisma.config.ts');
  await writeFile(
    config,
    `import {defineConfig, env} from 'prisma/config';
export default defineConfig({schema:${JSON.stringify(resolve(apiRoot, 'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:env('MIGRATION_DATABASE_URL')}});\n`,
  );
  execFileSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--config',
      config,
    ],
    {
      cwd: apiRoot,
      env: process.env,
      stdio: 'inherit',
      timeout: 170_000,
      windowsHide: true,
    },
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
