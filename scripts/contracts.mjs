import { loadLocalEnv, run } from './lib.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2] ?? 'check';

async function main() {
  loadLocalEnv();
  await run('pnpm', ['--filter', '@stdu/api', 'db:generate']);
  await run('pnpm', [
    '--filter',
    '@stdu/api',
    'exec',
    'tsx',
    'scripts/export-openapi.ts',
  ]);
  const generated = resolve(
    root,
    '.local/contracts/generated-staff.openapi.json',
  );
  const frozen = resolve(root, 'docs/contracts/R1-002-staff.openapi.json');
  const additivePermissions = resolve(
    root,
    'docs/contracts/R1-007-supplier-rbac-matrix.json',
  );
  const client = resolve(root, 'packages/staff-client/src/schema.d.ts');
  await run('pnpm', [
    'exec',
    'node',
    'scripts/validate-openapi.mjs',
    frozen,
    generated,
  ]);
  await run('node', [
    'scripts/compare-openapi.mjs',
    frozen,
    generated,
    additivePermissions,
  ]);
  if (action === 'generate-client') {
    await run('pnpm', [
      'exec',
      'openapi-typescript',
      generated,
      '--output',
      client,
    ]);
    console.log(
      'Generated TypeScript schema from the contract-verified Nest OpenAPI.',
    );
  } else if (action !== 'check') {
    throw new Error(`Unknown contracts action: ${action}`);
  }
  await run('pnpm', [
    'exec',
    'openapi-typescript',
    generated,
    '--output',
    client,
    '--check',
  ]);
  console.log('PASS generated TypeScript client is reproducible from OpenAPI.');
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Contract verification failed.',
  );
  process.exitCode = 1;
});
