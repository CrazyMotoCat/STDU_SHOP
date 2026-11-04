import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { root, requireFreePort } from './lib.mjs';
import { withProcesses } from './process-lifecycle.mjs';

// A production Next build with explicit staging fixtures; no separate API server.
async function main() {
  const probe = createServer();
  await new Promise((accept, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', accept);
  });
  const port = probe.address().port;
  await new Promise((accept) => probe.close(accept));
  await requireFreePort(port);
  const web = resolve(root, 'apps/web');
  const nextCli = createRequire(resolve(web, 'package.json')).resolve(
    'next/dist/bin/next',
  );
  await withProcesses(
    [
      {
        name: 'vis-cat-01b-test-site-preview',
        command: process.execPath,
        args: [
          nextCli,
          'start',
          '--hostname',
          '127.0.0.1',
          '--port',
          String(port),
        ],
        cwd: web,
        env: {
          APP_ENV: 'test',
          CATALOG_TEST_SITE_ENABLED: 'true',
          NEXT_TELEMETRY_DISABLED: '1',
        },
        quiet: true,
      },
    ],
    async (signal) => {
      console.log(`TEST SITE PREVIEW: http://127.0.0.1:${port}/catalog`);
      console.log(
        'Server fixtures explicitly enabled; no DB publication. This is local validation, not internet deployment. Ctrl+C stops owned web.',
      );
      await new Promise((accept) =>
        signal.addEventListener('abort', accept, { once: true }),
      );
    },
  );
}
main().catch((error) => {
  if (![130, 143].includes(error.exitCode)) {
    console.error(error);
    process.exitCode = 1;
  }
});
