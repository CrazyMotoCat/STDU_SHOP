import { loadLocalEnv, run } from './lib.mjs';

loadLocalEnv();
const [mode, ...args] = process.argv.slice(2);
if (!mode) throw new Error('A command is required: bootstrap or recover.');
await run('pnpm', [
  '--filter',
  '@stdu/api',
  'exec',
  'tsx',
  'scripts/staff-access.ts',
  mode,
  ...args,
]);
