import { loadLocalEnv, run } from './lib.mjs';

loadLocalEnv();
await run('pnpm', [
  '--filter',
  '@stdu/api',
  'exec',
  'tsx',
  'scripts/catalog-route-contract.ts',
]);
