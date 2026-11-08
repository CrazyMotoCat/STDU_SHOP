import { loadLocalEnv, run } from './lib.mjs';

loadLocalEnv();
await run('pnpm', [
  '--filter',
  '@stdu/api',
  'exec',
  'tsx',
  'scripts/export-ingestion-openapi.ts',
  ...process.argv.slice(2),
]);
await run('node', [
  'scripts/validate-openapi.mjs',
  'docs/contracts/R1-008B-ingestion.openapi.json',
]);
