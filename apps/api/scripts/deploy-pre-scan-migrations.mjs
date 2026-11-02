// Compatibility entry point: default Prisma migrations now exclude scan jobs.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
execFileSync(
  process.execPath,
  [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
  {
    cwd: apiRoot,
    env: process.env,
    stdio: 'inherit',
    timeout: 170_000,
    windowsHide: true,
  },
);
