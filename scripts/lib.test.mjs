import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './lib.mjs';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: vi.fn(),
}));

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  vi.mocked(spawn).mockReturnValueOnce(child);
  return child;
}

beforeEach(() => vi.resetAllMocks());

describe('child process completion', () => {
  it('waits for close and captures stdout arriving after exit', async () => {
    const child = fakeChild();
    const completed = vi.fn();
    const result = run('tool', [], { capture: true }).then(completed);
    child.stdout.write('first\n');
    child.emit('exit', 0);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    const utf8 = Buffer.from('хвост');
    child.stdout.write(utf8.subarray(0, 1));
    child.stdout.end(utf8.subarray(1));
    child.stderr.end();
    child.emit('close', 0);
    await result;
    expect(completed).toHaveBeenCalledExactlyOnceWith('first\nхвост');
  });

  it('rejects a spawn error once even when close follows', async () => {
    const child = fakeChild();
    const failed = vi.fn();
    const error = new Error('spawn failed');
    const result = run('tool', [], { capture: true }).catch(failed);
    child.emit('error', error);
    child.emit('close', -2);
    await result;
    expect(failed).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('rejects nonzero completion without exposing captured stderr', async () => {
    const child = fakeChild();
    const result = run('tool', [], { capture: true });
    child.stderr.write('private connection string');
    child.emit('close', 7);
    await expect(result).rejects.toThrow(
      'tool failed (exit 7). Check the service or tool logs.',
    );
  });

  it('captures all output from a real child process', async () => {
    const actual = await vi.importActual('node:child_process');
    vi.mocked(spawn).mockImplementationOnce(actual.spawn);
    const payload = 'x'.repeat(256 * 1024) + '\nконец';
    const output = await run(
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(256 * 1024) + '\\nконец')"],
      { capture: true },
    );
    expect(output).toBe(payload);
  });
});
