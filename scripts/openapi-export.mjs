import { loadLocalEnv, run } from './lib.mjs';

loadLocalEnv();
await run('pnpm', [
  '--filter',
  '@stdu/api',
  'exec',
  'tsx',
  'scripts/export-openapi.ts',
]);
await run('pnpm', [
  '--filter',
  '@stdu/api',
  'exec',
  'tsx',
  'scripts/export-inquiry-openapi.ts',
]);
