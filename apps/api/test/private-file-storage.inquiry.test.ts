import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { PrivateFileStorage } from '../src/storage/private-file-storage.js';

describe('PrivateFileStorage inquiry quarantine', () => {
  let root: string | undefined;
  let previousRoot: string | undefined;

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.FILE_STORAGE_ROOT;
    else process.env.FILE_STORAGE_ROOT = previousRoot;
    previousRoot = undefined;
    if (root) {
      if (!root.startsWith(resolve(tmpdir(), 'stdu-inquiry-storage-test-')))
        throw new Error(
          'Refusing to remove storage test directory outside its generated prefix.',
        );
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it('cleans only quarantine temporaries and unreferenced keys older than 24 hours', async () => {
    previousRoot = process.env.FILE_STORAGE_ROOT;
    root = await mkdtemp(resolve(tmpdir(), 'stdu-inquiry-storage-test-'));
    process.env.FILE_STORAGE_ROOT = root;
    const directory = join(root, 'inquiry-quarantine');
    await mkdir(directory);
    const old = new Date(Date.now() - 25 * 60 * 60_000);
    const temporary = join(directory, `.tmp-${randomUUID()}`);
    const objectKey = 'a'.repeat(64);
    const objectFile = join(directory, objectKey);
    const unrelated = join(directory, 'keep-this-file');
    await Promise.all([
      writeFile(temporary, 'temporary'),
      writeFile(objectFile, 'orphan'),
      writeFile(unrelated, 'unrelated'),
    ]);
    await Promise.all([
      utimes(temporary, old, old),
      utimes(objectFile, old, old),
    ]);

    const storage = new PrivateFileStorage();
    expect(await storage.cleanupStaleInquiryTemporaryFiles()).toBe(1);
    expect(await storage.listStaleInquiryObjects()).toEqual([objectKey]);
    await storage.removeInquiryQuarantineObject(objectKey);

    await expect(readFile(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(objectFile)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(unrelated, 'utf8')).toBe('unrelated');
  });

  it('keeps newly written private objects in the inquiry-only namespace and removes by ownership receipt', async () => {
    previousRoot = process.env.FILE_STORAGE_ROOT;
    root = await mkdtemp(resolve(tmpdir(), 'stdu-inquiry-storage-test-'));
    process.env.FILE_STORAGE_ROOT = root;
    const storage = new PrivateFileStorage();
    const owned = await storage.writeInquiryQuarantineOwned(
      Readable.from([Buffer.from('private source')]),
    );
    expect(owned.stored.key).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await readFile(
        join(root, 'inquiry-quarantine', owned.stored.key),
        'utf8',
      ),
    ).toBe('private source');
    await storage.removeOwned(owned);
    await expect(
      readFile(join(root, 'inquiry-quarantine', owned.stored.key)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes only its partial quarantine temporary when the input stream fails', async () => {
    previousRoot = process.env.FILE_STORAGE_ROOT;
    root = await mkdtemp(resolve(tmpdir(), 'stdu-inquiry-storage-test-'));
    process.env.FILE_STORAGE_ROOT = root;
    const directory = join(root, 'inquiry-quarantine');
    const storage = new PrivateFileStorage();
    async function* brokenUpload() {
      yield Buffer.from('private partial bytes');
      throw new Error('controlled stream interruption');
    }

    await expect(
      storage.writeInquiryQuarantineOwned(Readable.from(brokenUpload())),
    ).rejects.toThrow('controlled stream interruption');
    expect(await readdir(directory)).toEqual([]);
  });
});
