import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PrivateFileStorage,
  PrivateStorageIntegrityError,
} from '../src/storage/private-file-storage.js';

async function collect(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const value of stream)
    chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  return Buffer.concat(chunks);
}

describe('R1-010D private quarantine scan storage', () => {
  const priorRoot = process.env.FILE_STORAGE_ROOT;
  let root: string;
  let storage: PrivateFileStorage;

  beforeAll(async () => {
    root = await mkdtemp(
      join(tmpdir(), `stdu-r1-010d-storage-${randomUUID()}-`),
    );
    process.env.FILE_STORAGE_ROOT = root;
    storage = new PrivateFileStorage();
  });

  afterAll(async () => {
    if (priorRoot === undefined) delete process.env.FILE_STORAGE_ROOT;
    else process.env.FILE_STORAGE_ROOT = priorRoot;
    await rm(root, { recursive: true, force: true });
  });

  it('streams the exact immutable object from one handle with backpressure', async () => {
    const original = Buffer.alloc(256 * 1024 + 37, 0x5a);
    const stored = await storage.writeInquiryQuarantineOwned(
      Readable.from([original.subarray(0, 73_000), original.subarray(73_000)]),
    );
    const stream = await storage.openInquiryQuarantineForScan(
      stored.stored.key,
      Buffer.from(stored.stored.sha256, 'hex'),
      BigInt(stored.stored.size),
    );
    expect(await collect(stream)).toEqual(original);
  });

  it('rejects a descriptor with a mismatched length before streaming bytes', async () => {
    const original = Buffer.from('immutable-quarantine-object');
    const stored = await storage.writeInquiryQuarantineOwned(
      Readable.from([original]),
    );
    await expect(
      storage.openInquiryQuarantineForScan(
        stored.stored.key,
        Buffer.from(stored.stored.sha256, 'hex'),
        BigInt(stored.stored.size + 1),
      ),
    ).rejects.toBeInstanceOf(PrivateStorageIntegrityError);
  });

  it('fails the stream closed when actual bytes do not match the expected SHA-256', async () => {
    const original = Buffer.from('source-bytes-that-must-not-be-cleared');
    const stored = await storage.writeInquiryQuarantineOwned(
      Readable.from([original]),
    );
    const stream = await storage.openInquiryQuarantineForScan(
      stored.stored.key,
      createHash('sha256').update('different-content').digest(),
      BigInt(stored.stored.size),
    );
    await expect(collect(stream)).rejects.toBeInstanceOf(
      PrivateStorageIntegrityError,
    );
  });

  it('classifies a missing quarantine object as an integrity failure', async () => {
    const stored = await storage.writeInquiryQuarantineOwned(
      Readable.from([Buffer.from('fixture that is removed before scan')]),
    );
    await storage.removeOwned(stored);
    await expect(
      storage.openInquiryQuarantineForScan(
        stored.stored.key,
        Buffer.from(stored.stored.sha256, 'hex'),
        BigInt(stored.stored.size),
      ),
    ).rejects.toBeInstanceOf(PrivateStorageIntegrityError);
  });
});
