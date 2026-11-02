import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

const localEnv = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (existsSync(localEnv)) loadEnvFile(localEnv);

// The runtime schema contains separately gated scan models. Do not let shadow
// diffing silently recreate them in the ordinary migration directory.
if (process.argv.includes('migrate') && process.argv.includes('dev'))
  throw new Error(
    'Default migrate dev is blocked while scan history is isolated; use a reviewed migration-authoring plan.',
  );

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Separately approved scan migrations are intentionally outside this path.
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('MIGRATION_DATABASE_URL') },
});
