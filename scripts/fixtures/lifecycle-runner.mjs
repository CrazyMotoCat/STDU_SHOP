import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { withProcesses } from '../process-lifecycle.mjs';
import { reportFailure } from '../lib.mjs';

const [record, port] = process.argv.slice(2);
let owned;
try {
  await withProcesses(
    [
      {
        name: 'fixture',
        command: process.execPath,
        args: [
          fileURLToPath(new URL('./lifecycle-child.mjs', import.meta.url)),
          record,
          'stubborn',
          port,
        ],
        quiet: true,
        capture: true,
      },
    ],
    async (_, host) => {
      owned = host;
      const end = Date.now() + 2000;
      while (Date.now() < end) {
        try {
          await readFile(record, 'utf8');
          return;
        } catch {
          await delay(20);
        }
      }
      throw new Error('Fixture startup failed.');
    },
    { graceMs: 50, forceMs: 100, signalTree: () => {} },
  );
  console.log('FINAL PASS');
} catch (error) {
  reportFailure(error);
} finally {
  // Only fixture-owned groups; Windows KILL_ON_JOB_CLOSE handled its cleanup.
  if (process.platform !== 'win32')
    for (const entry of owned?.entries ?? []) {
      try {
        process.kill(-entry.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') reportFailure(error);
      }
    }
}
