import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(apiRoot, '../..');
const require = createRequire(resolve(repoRoot, 'package.json'));
const prismaCli = require.resolve('prisma/build/index.js', {
  paths: [apiRoot],
});
const scanMigration = '20261028120000_inquiry_scan_jobs';
const tempRoot = await mkdtemp(resolve(apiRoot, '.r1-010d-pre-scan-'));
const tempMigrations = resolve(tempRoot, 'migrations');

try {
  await mkdir(tempMigrations);
  const sourceMigrations = resolve(apiRoot, 'prisma/migrations');
  const entries = await readdir(sourceMigrations, { withFileTypes: true });
  if (
    !entries.some(
      (entry) => entry.isDirectory() && entry.name === scanMigration,
    )
  )
    throw new Error('The frozen R1-010D migration directory is missing.');

  for (const entry of entries) {
    const source = resolve(sourceMigrations, entry.name);
    const destination = resolve(tempMigrations, entry.name);
    if (entry.isDirectory() && entry.name !== scanMigration)
      await cp(source, destination, { recursive: true });
    else if (entry.isFile() && entry.name === 'migration_lock.toml')
      await cp(source, destination);
  }

  const configPath = resolve(tempRoot, 'prisma.config.ts');
  const config = [
    "import { defineConfig, env } from 'prisma/config';",
    'export default defineConfig({',
    `  schema: ${JSON.stringify(resolve(apiRoot, 'prisma/schema.prisma'))},`,
    `  migrations: { path: ${JSON.stringify(tempMigrations)} },`,
    "  datasource: { url: env('MIGRATION_DATABASE_URL') },",
    '});',
    '',
  ].join('\n');
  await writeFile(configPath, config, { encoding: 'utf8', flag: 'wx' });
  execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--config', configPath],
    {
      cwd: apiRoot,
      env: process.env,
      stdio: 'inherit',
      timeout: 170_000,
      windowsHide: true,
    },
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
