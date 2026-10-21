import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { root } from './lib.mjs';

const windows = process.platform === 'win32';
// The helper uses stdlib only. Launch the venv's base interpreter directly:
// Windows venv python.exe is itself a redirector with another child process.
function boundaryPython() {
  const config = readFileSync(
    resolve(root, 'services/ingestion/.venv/pyvenv.cfg'),
    'utf8',
  );
  const home = /^home\s*=\s*(.+)$/m.exec(config)?.[1].trim();
  if (!home)
    throw new Error('Missing Windows venv base interpreter. Run uv sync.');
  return resolve(home, 'python.exe');
}

function groupAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

export function startProcesses(
  definitions,
  { graceMs = 5000, forceMs = 3000, signalTree } = {},
) {
  if (![graceMs, forceMs].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Shutdown deadlines must be positive finite milliseconds.');
  if (
    !Array.isArray(definitions) ||
    definitions.some(
      (entry) =>
        !entry ||
        typeof entry.name !== 'string' ||
        typeof entry.command !== 'string' ||
        !Array.isArray(entry.args) ||
        entry.args.some((arg) => typeof arg !== 'string'),
    )
  )
    throw new Error('Invalid host process definitions.');
  const entries = [];
  let stopping = false;
  let stopPromise;
  let fail;
  const failure = new Promise((_, reject) => {
    fail = reject;
  });
  failure.catch(() => undefined);
  const unexpected = (entry) => {
    if (!stopping)
      fail(new Error(`Host application ${entry.name} exited unexpectedly.`));
  };
  for (const definition of definitions) {
    const entry = {
      name: definition.name,
      closed: false,
      active: undefined,
      child: undefined,
    };
    entries.push(entry);
    try {
      entry.child = spawn(
        windows ? boundaryPython() : definition.command,
        windows ? [resolve(root, 'scripts/windows_job.py')] : definition.args,
        {
          cwd: definition.cwd ?? root,
          env: { ...process.env, ...definition.env },
          shell: false,
          windowsHide: true,
          detached: !windows,
          stdio: windows
            ? [
                'pipe',
                'pipe',
                definition.capture
                  ? 'pipe'
                  : definition.quiet
                    ? 'ignore'
                    : 'inherit',
              ]
            : definition.capture
              ? ['ignore', 'pipe', 'pipe']
              : definition.quiet
                ? 'ignore'
                : ['ignore', 'inherit', 'inherit'],
        },
      );
      entry.child.once('error', () => {
        entry.closed = true;
        entry.boundaryError = true;
        unexpected(entry);
      });
      entry.child.once('exit', (code) => {
        entry.exitCode = code;
        entry.closed = true;
        unexpected(entry);
      });
      if (definition.capture) {
        entry.child.stderr?.resume();
        if (!windows) entry.child.stdout?.resume();
      }
      if (windows) {
        let buffer = '';
        entry.child.stdout.setEncoding('utf8');
        entry.child.stdout.on('data', (chunk) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            try {
              const event = JSON.parse(line);
              if (event.event === 'started') entry.pid = event.pid;
              if (event.event === 'active') entry.active = event.count;
              if (event.event === 'exit') entry.appExitCode = event.code;
              if (event.event === 'error') entry.boundaryError = true;
              if (event.event === 'exit' || event.event === 'error')
                unexpected(entry);
            } catch {
              entry.boundaryError = true;
              fail(new Error(`Invalid lifecycle response from ${entry.name}.`));
            }
          }
        });
        // EPIPE is reported through boundary state/deadline, never unhandled.
        entry.child.stdin.on('error', () => undefined);
        entry.child.stdin.write(
          JSON.stringify({ ...definition, cwd: definition.cwd ?? root }) + '\n',
        );
      } else entry.pid = entry.child.pid;
    } catch {
      entry.closed = true;
      entry.boundaryError = true;
      unexpected(entry);
    }
  }
  const alive = (entry) =>
    windows ? !entry.closed && entry.active !== 0 : groupAlive(entry.pid);
  const send = (entry, signal) => {
    try {
      if (signalTree) return signalTree(entry, signal);
      if (windows) {
        if (!entry.closed && !entry.child.stdin.destroyed)
          entry.child.stdin.write(
            JSON.stringify({ action: signal === 'SIGTERM' ? 'stop' : 'kill' }) +
              '\n',
          );
      } else if (entry.pid) {
        process.kill(-entry.pid, signal);
      }
    } catch (error) {
      if (error.code !== 'ESRCH')
        entry.signalError = error.code ?? 'signal failed';
    }
  };
  const waitUntil = async (predicate, deadline) => {
    while (!predicate() && performance.now() < deadline)
      await delay(Math.min(25, Math.max(1, deadline - performance.now())));
    return predicate();
  };
  const stop = () =>
    (stopPromise ??= (async () => {
      stopping = true;
      const graceEnd = performance.now() + graceMs;
      for (const entry of entries) send(entry, 'SIGTERM');
      const graceful = await waitUntil(
        () => entries.every((entry) => !alive(entry)),
        graceEnd,
      );
      const forceEnd = performance.now() + forceMs;
      if (!graceful) {
        const names = entries
          .filter(alive)
          .map((entry) => `${entry.name}(${entry.pid ?? 'starting'})`)
          .join(', ');
        console.warn(
          `Host shutdown: grace expired; forcing owned boundaries: ${names}`,
        );
        for (const entry of entries.filter(alive)) send(entry, 'SIGKILL');
      }
      if (
        !(await waitUntil(
          () => entries.every((entry) => !alive(entry)),
          forceEnd,
        ))
      ) {
        // Killing our Windows helper closes its non-inherited job handle, which
        // kills its complete job. This is a failed shutdown, never a green test.
        for (const entry of entries) {
          if (windows && !entry.closed) entry.child?.kill('SIGKILL');
          entry.child?.unref();
          entry.child?.stdin?.destroy();
          entry.child?.stdout?.destroy();
          entry.child?.stderr?.destroy();
        }
        throw new Error(
          `Host shutdown deadline exceeded (${graceMs}+${forceMs}ms): ${entries
            .filter(alive)
            .map(
              (entry) =>
                `${entry.name}(pid=${entry.pid ?? 'starting'}, signal=${entry.signalError ?? 'sent'})`,
            )
            .join(', ')}.`,
        );
      }
      if (windows) {
        for (const entry of entries.filter((entry) => !entry.closed))
          if (!entry.child.stdin.destroyed)
            entry.child.stdin.end('{"action":"close"}\n');
        if (
          !(await waitUntil(
            () => entries.every((entry) => entry.closed),
            forceEnd,
          ))
        ) {
          for (const entry of entries) {
            if (!entry.closed) entry.child?.kill('SIGKILL');
            entry.child?.unref();
            entry.child?.stdin?.destroy();
            entry.child?.stdout?.destroy();
            entry.child?.stderr?.destroy();
          }
          throw new Error(
            'Host shutdown: empty jobs verified, but helper exit deadline exceeded.',
          );
        }
        if (
          entries.some(
            (entry) => entry.pid !== undefined && entry.exitCode !== 0,
          )
        )
          throw new Error(
            'Host shutdown: Windows boundary helper did not exit successfully.',
          );
      }
      if (entries.some((entry) => entry.boundaryError))
        throw new Error('Host process startup/control failed.');
      console.log(
        `Host shutdown verified: ${entries.map((entry) => entry.name).join(', ')}; forced=${!graceful}.`,
      );
      return { forced: !graceful };
    })());
  return { entries, failure, stop };
}

export async function withProcesses(
  definitions,
  operation,
  { signal, signals = process, ...options } = {},
) {
  const controller = new AbortController();
  let interrupt;
  const interrupted = new Promise((_, reject) => {
    interrupt = reject;
  });
  interrupted.catch(() => undefined);
  const cancel = (reason) => {
    const error =
      reason instanceof Error
        ? reason
        : new Error('Host operation interrupted.');
    controller.abort(error);
    interrupt(error);
  };
  const onInt = () =>
    cancel(
      Object.assign(new Error('Host operation interrupted (SIGINT).'), {
        exitCode: 130,
      }),
    );
  const onTerm = () =>
    cancel(
      Object.assign(new Error('Host operation interrupted (SIGTERM).'), {
        exitCode: 143,
      }),
    );
  const onAbort = () => cancel(signal.reason);
  signals.on('SIGINT', onInt);
  signals.on('SIGTERM', onTerm);
  signal?.addEventListener('abort', onAbort, { once: true });
  let host;
  let primary;
  let failed = false;
  let cleanupError;
  let result;
  try {
    if (signal?.aborted) throw signal.reason;
    host = startProcesses(definitions, options);
    result = await Promise.race([
      Promise.resolve().then(() => operation(controller.signal, host)),
      host.failure,
      interrupted,
    ]);
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    controller.abort();
    try {
      await host?.stop();
    } catch (error) {
      cleanupError = error;
    } finally {
      signals.off('SIGINT', onInt);
      signals.off('SIGTERM', onTerm);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  if (failed && cleanupError)
    throw new AggregateError(
      [primary, cleanupError],
      `Host operation and shutdown failed: ${primary?.message ?? 'operation error'}; ${cleanupError.message}`,
      { cause: cleanupError },
    );
  if (cleanupError) throw cleanupError;
  if (failed) throw primary;
  return result;
}
