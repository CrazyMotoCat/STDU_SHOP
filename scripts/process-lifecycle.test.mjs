import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { startProcesses, withProcesses } from './process-lifecycle.mjs';
import { requireFreePort } from './lib.mjs';
import { hostDefinitions } from './host-apps.mjs';

const fixture = resolve('scripts/fixtures/lifecycle-child.mjs');
const timeouts = { graceMs: 600, forceMs: 2500 };

async function harness(action) {
  // Avoid the OS client-ephemeral range while other integration checks run.
  // This authorizes no termination; occupied candidates are simply skipped.
  let nextPort;
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = randomInt(20000, 35000);
    try {
      await Promise.all(
        [0, 1, 2, 3, 4, 5].map((offset) => requireFreePort(candidate + offset)),
      );
      nextPort = candidate;
      break;
    } catch {
      /* A different project owns a candidate. */
    }
  }
  if (!nextPort) throw new Error('No free fixture port range.');
  const directory = await mkdtemp(join(tmpdir(), 'stdu-lifecycle-'));
  const record = join(directory, 'owned.jsonl');
  const hosts = [];
  const definitions = (mode = 'normal', port) => {
    const assigned = port ?? nextPort;
    nextPort += 2;
    return [
      {
        name: 'fixture',
        command: process.execPath,
        args: [fixture, record, mode, String(assigned)],
        quiet: true,
      },
    ];
  };
  const start = (mode, port) => {
    const host = startProcesses(definitions(mode, port), timeouts);
    hosts.push(host);
    return host;
  };
  const records = async (minimum = 1) => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      try {
        const lines = (await readFile(record, 'utf8'))
          .trim()
          .split('\n')
          .map(JSON.parse);
        if (lines.length >= minimum) return lines;
      } catch {
        /* Child has not published its PID yet. */
      }
      await delay(25);
    }
    throw new Error('Fixture startup deadline exceeded.');
  };
  try {
    await action({ record, definitions, start, records, hosts });
  } finally {
    for (const host of hosts) await host.stop();
    await unlink(record).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rmdir(directory);
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function assertGone(records) {
  for (const record of records) {
    const end = Date.now() + 1500;
    while (alive(record.pid) && Date.now() < end) await delay(25);
    expect(alive(record.pid), `owned PID ${record.pid} survived`).toBe(false);
    const portEnd = Date.now() + 1000;
    while (true) {
      try {
        await requireFreePort(record.port);
        break;
      } catch (error) {
        if (Date.now() >= portEnd) throw error;
        await delay(25);
      }
    }
  }
}

describe('owned host lifecycle', () => {
  it('stops all children and grandchildren, is idempotent, and restarts on the same port', async () => {
    await harness(async ({ start, records }) => {
      const host = start('tree');
      const first = await records(2);
      expect(host.stop()).toBe(host.stop());
      await host.stop();
      await assertGone(first);
      const restarted = start('normal', first[0].port);
      const second = await records(3);
      await restarted.stop();
      await assertGone(second);
    });
  });

  it('cleans up after an operation exception', async () => {
    await harness(async ({ definitions, records }) => {
      await expect(
        withProcesses(
          definitions(),
          async () => {
            await records();
            throw new Error('simulated smoke assertion');
          },
          timeouts,
        ),
      ).rejects.toThrow('simulated smoke assertion');
      await assertGone(await records());
    });
  });

  it('can stop immediately before startup events are delivered', async () => {
    await harness(async ({ start }) => {
      const host = start('normal');
      await host.stop();
      for (const entry of host.entries) {
        expect(entry.closed).toBe(true);
        if (entry.pid) expect(alive(entry.pid)).toBe(false);
      }
    });
  });

  it('cleans partial startup and rejects a failed spawn immediately', async () => {
    await harness(async ({ definitions }) => {
      const apps = [
        ...definitions(),
        {
          name: 'missing',
          command: resolve('missing-stdu-executable'),
          args: [],
          quiet: true,
        },
      ];
      let host;
      await expect(
        withProcesses(
          apps,
          async (_, owned) => {
            host = owned;
            await new Promise(() => {});
          },
          timeouts,
        ),
      ).rejects.toThrow('exited unexpectedly');
      for (const entry of host.entries)
        if (entry.pid) expect(alive(entry.pid)).toBe(false);
    });
  });

  it.each(['SIGINT', 'SIGTERM'])(
    'cleans up on %s and removes its signal handlers',
    async (signalName) => {
      await harness(async ({ definitions, records }) => {
        const signals = new EventEmitter();
        await expect(
          withProcesses(
            definitions(),
            async () => {
              await records();
              signals.emit(signalName);
              await new Promise(() => {});
            },
            { ...timeouts, signals },
          ),
        ).rejects.toThrow(signalName);
        expect(signals.listenerCount('SIGINT')).toBe(0);
        expect(signals.listenerCount('SIGTERM')).toBe(0);
        await assertGone(await records());
      });
    },
  );

  it('preserves the operation exception together with a shutdown failure', async () => {
    await harness(async ({ definitions, records }) => {
      let owned;
      let caught;
      try {
        await withProcesses(
          definitions(),
          async (_, host) => {
            owned = host;
            await records();
            throw new Error('primary smoke failure');
          },
          { graceMs: 50, forceMs: 100, signalTree: () => {} },
        );
      } catch (error) {
        caught = error;
      } finally {
        if (process.platform !== 'win32')
          for (const entry of owned?.entries ?? [])
            process.kill(-entry.pid, 'SIGKILL');
      }
      expect(caught).toBeInstanceOf(AggregateError);
      expect(caught.errors[0].message).toBe('primary smoke failure');
      expect(caught.errors[1].message).toContain('shutdown deadline exceeded');
      await assertGone(await records());
    });
  });

  it('handles a signal during cleanup after a synchronous operation exception', async () => {
    await harness(async ({ definitions, records }) => {
      const signals = new EventEmitter();
      await expect(
        withProcesses(
          definitions('stubborn'),
          () => {
            throw new Error('synchronous smoke failure');
          },
          {
            ...timeouts,
            signals,
            signalTree: (entry, signal) => {
              if (signal === 'SIGTERM') {
                // Keep cleanup active long enough for a signal after the throw.
                setTimeout(() => signals.emit('SIGTERM'), 25);
              } else if (process.platform === 'win32') {
                entry.child.stdin.write('{"action":"kill"}\n');
              } else process.kill(-entry.pid, signal);
            },
          },
        ),
      ).rejects.toThrow('synchronous smoke failure');
      expect(signals.listenerCount('SIGTERM')).toBe(0);
      await assertGone(await records());
    });
  });

  it('contains descendants after an early parent exit, including inherited stdio', async () => {
    await harness(async ({ definitions, records }) => {
      let created;
      await expect(
        withProcesses(
          definitions('early-exit').map((entry) => ({
            ...entry,
            capture: true,
          })),
          async () => {
            created = await records(2);
            await new Promise(() => {});
          },
          timeouts,
        ),
      ).rejects.toThrow('exited unexpectedly');
      await assertGone(created);
    });
  });

  it('escalates a stubborn owned process within the deadline', async () => {
    await harness(async ({ start, records }) => {
      const host = start('stubborn');
      const created = await records();
      const begin = performance.now();
      expect(await host.stop()).toEqual({ forced: true });
      expect(performance.now() - begin).toBeLessThan(3500);
      await assertGone(created);
    });
  });

  it.skipIf(process.platform !== 'win32')(
    'kills Windows descendants if their actual boundary interpreter crashes',
    async () => {
      await harness(async ({ definitions, records }) => {
        const host = startProcesses(definitions('tree'), timeouts);
        const created = await records(2);
        const helper = host.entries[0].child;
        helper.kill('SIGKILL');
        await expect(host.failure).rejects.toThrow('exited unexpectedly');
        await expect(host.stop()).rejects.toThrow(
          'helper did not exit successfully',
        );
        expect(alive(helper.pid)).toBe(false);
        await assertGone(created);
      });
    },
  );

  it('does not target a foreign sentinel process', async () => {
    await harness(async ({ start, records }) => {
      const sentinel = start('normal');
      const [foreign] = await records();
      const target = start('normal');
      await records(2);
      await target.stop();
      expect(alive(foreign.pid)).toBe(true);
      await sentinel.stop();
    });
  });

  it('does not wait forever when cleanup cannot be confirmed, and reports failure', async () => {
    await harness(async ({ definitions, records, hosts }) => {
      const host = startProcesses(definitions(), {
        graceMs: 50,
        forceMs: 100,
        signalTree: () => {},
      });
      await records();
      const begin = performance.now();
      await expect(host.stop()).rejects.toThrow('deadline exceeded');
      expect(performance.now() - begin).toBeLessThan(1000);
      // Real helper owns the job on Windows; killing it closes the job handle.
      // On POSIX only our directly spawned fixture has to be reaped here.
      if (process.platform !== 'win32')
        for (const entry of host.entries) process.kill(-entry.pid, 'SIGKILL');
      for (const entry of host.entries) entry.child.unref();
      hosts.length = 0;
      await assertGone(await records());
    });
  });

  it('returns a nonzero CLI exit with no final PASS on cleanup failure', async () => {
    await harness(async ({ record, definitions, records }) => {
      const app = definitions()[0];
      const child = spawn(
        process.execPath,
        [
          resolve('scripts/fixtures/lifecycle-runner.mjs'),
          record,
          app.args.at(-1),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
      let output = '';
      let errors = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        errors += chunk;
      });
      const code = await new Promise((accept, reject) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Fixture runner deadline exceeded'));
        }, 5000);
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('close', (code) => {
          clearTimeout(timeout);
          accept(code);
        });
      });
      expect(code).toBe(1);
      expect(output).not.toContain('FINAL PASS');
      expect(errors).toContain('shutdown deadline exceeded');
      await assertGone(await records());
    });
  });
});

describe('host launch recipes', () => {
  it('uses direct built runtimes without shell, pnpm, uv or reload in smoke', () => {
    const apps = hostDefinitions({ smoke: true });
    expect(apps[0].args).toContain('start');
    expect(apps[1].args).toEqual(['dist/main.js']);
    expect(apps[2].args).not.toContain('--reload');
    expect(apps[2].args.slice(0, 2)).toEqual(['-m', 'uvicorn']);
  });
  it('retains Next, tsx and Uvicorn hot reload during normal development', () => {
    const apps = hostDefinitions();
    expect(apps[0].args).toContain('dev');
    expect(apps[1].args).toContain('watch');
    expect(apps[2].args).toContain('--reload');
  });
});
