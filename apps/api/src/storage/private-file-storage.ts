import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open as openFile,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';
import type { StoragePort, StoredObject } from './storage.port.js';

export interface OwnedStorageWrite {
  readonly stored: StoredObject;
  readonly receipt: object;
}

export interface StorageByteRange {
  readonly offset: number;
  readonly length: number;
}

export class PrivateStorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Private file storage is unavailable.', { cause });
    this.name = 'PrivateStorageUnavailableError';
  }
}

export class PrivateStorageIntegrityError extends Error {
  constructor() {
    super(
      'Private inquiry quarantine object did not match its immutable descriptor.',
    );
    this.name = 'PrivateStorageIntegrityError';
  }
}

function isStorageFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return [
    'EACCES',
    'EDQUOT',
    'EIO',
    'EMFILE',
    'ENFILE',
    'ENOSPC',
    'EROFS',
  ].includes(code ?? '');
}

@Injectable()
export class PrivateFileStorage implements StoragePort {
  private readonly ownership = new WeakMap<object, string>();

  async write(source: Readable): Promise<StoredObject> {
    return (await this.store(source, false, null)).stored;
  }

  async writeOwned(source: Readable): Promise<OwnedStorageWrite> {
    return this.store(source, true, null);
  }

  /** Stores anonymous inquiry bytes below a dedicated private quarantine root. */
  async writeInquiryQuarantineOwned(
    source: Readable,
    onPipelineReady?: () => void,
  ): Promise<OwnedStorageWrite> {
    return this.store(source, true, 'inquiry-quarantine', onPipelineReady);
  }

  async removeOwned(write: OwnedStorageWrite): Promise<void> {
    const ownedPath = this.ownership.get(write.receipt);
    if (
      !ownedPath ||
      (!ownedPath.endsWith(`/${write.stored.key}`) &&
        !ownedPath.endsWith(`\\${write.stored.key}`))
    )
      throw new Error('PRIVATE_STORAGE_RECEIPT_INVALID');
    await unlink(ownedPath);
    this.ownership.delete(write.receipt);
  }

  async open(key: string): Promise<Readable> {
    return createReadStream(this.filePath(key, null));
  }

  async openInquiryQuarantine(key: string): Promise<Readable> {
    try {
      const handle = await openFile(
        this.filePath(key, 'inquiry-quarantine'),
        'r',
      );
      return handle.createReadStream();
    } catch (error) {
      throw new PrivateStorageUnavailableError(error);
    }
  }

  /** Opens and verifies one quarantine object through a single file handle. */
  async openInquiryQuarantineForScan(
    key: string,
    expectedSha256: Uint8Array,
    expectedSizeBytes: bigint,
  ): Promise<Readable> {
    let handle;
    try {
      handle = await openFile(this.filePath(key, 'inquiry-quarantine'), 'r');
      const metadata = await handle.stat();
      if (!metadata.isFile() || BigInt(metadata.size) !== expectedSizeBytes) {
        await handle.close();
        throw new PrivateStorageIntegrityError();
      }
      const hash = createHash('sha256');
      let size = 0n;
      const verifier = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += BigInt(chunk.length);
          hash.update(chunk);
          callback(null, chunk);
        },
        flush(callback) {
          const actualHash = hash.digest();
          if (
            size !== expectedSizeBytes ||
            !actualHash.equals(Buffer.from(expectedSha256))
          ) {
            callback(new PrivateStorageIntegrityError());
            return;
          }
          callback();
        },
      });
      const output = new PassThrough({ highWaterMark: 64 * 1024 });
      const source = handle.createReadStream({ autoClose: true });
      void pipeline(source, verifier, output).catch((error: unknown) => {
        output.destroy(
          error instanceof PrivateStorageIntegrityError
            ? error
            : new PrivateStorageUnavailableError(error),
        );
      });
      return output;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
        throw new PrivateStorageIntegrityError();
      if (
        error instanceof PrivateStorageIntegrityError ||
        error instanceof PrivateStorageUnavailableError
      )
        throw error;
      throw new PrivateStorageUnavailableError(error);
    }
  }

  async readInquiryQuarantineRanges(
    key: string,
    ranges: readonly StorageByteRange[],
  ): Promise<Buffer[]> {
    const validated = ranges.map(({ offset, length }) => {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > 131_100
      )
        throw new Error('PRIVATE_STORAGE_RANGE_INVALID');
      return { offset, length };
    });
    let handle;
    try {
      handle = await openFile(this.filePath(key, 'inquiry-quarantine'), 'r');
      const results: Buffer[] = [];
      for (const { offset, length } of validated) {
        const buffer = Buffer.alloc(length);
        let read = 0;
        while (read < length) {
          const result = await handle.read(
            buffer,
            read,
            length - read,
            offset + read,
          );
          if (result.bytesRead === 0) break;
          read += result.bytesRead;
        }
        results.push(buffer.subarray(0, read));
      }
      return results;
    } catch (error) {
      if (error instanceof PrivateStorageUnavailableError) throw error;
      throw new PrivateStorageUnavailableError(error);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async cleanupStaleInquiryTemporaryFiles(now = Date.now()) {
    const directory = resolve(this.root(), 'inquiry-quarantine');
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
    let removed = 0;
    for (const name of names) {
      if (!/^\.tmp-[0-9a-f-]{36}$/i.test(name)) continue;
      const path = join(directory, name);
      const metadata = await lstat(path).catch(() => null);
      if (metadata?.isFile() && now - metadata.mtimeMs >= 24 * 60 * 60_000) {
        await unlink(path);
        removed++;
      }
    }
    return removed;
  }

  async listStaleInquiryObjects(now = Date.now()) {
    const directory = resolve(this.root(), 'inquiry-quarantine');
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const stale: string[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const metadata = await lstat(join(directory, name)).catch(() => null);
      if (metadata?.isFile() && now - metadata.mtimeMs >= 24 * 60 * 60_000)
        stale.push(name);
    }
    return stale;
  }

  async removeInquiryQuarantineObject(key: string) {
    await unlink(this.filePath(key, 'inquiry-quarantine'));
  }

  private async store(
    source: Readable,
    owned: boolean,
    namespace: string | null,
    onPipelineReady?: () => void,
  ): Promise<OwnedStorageWrite> {
    const key = randomBytes(32).toString('hex');
    let target: string;
    let directory: string;
    try {
      target = this.filePath(key, namespace);
      directory = resolve(this.root(), namespace ?? '');
      await mkdir(directory, { recursive: true, mode: 0o700 });
    } catch (error) {
      if (namespace === 'inquiry-quarantine')
        throw new PrivateStorageUnavailableError(error);
      throw error;
    }
    const temporary = join(directory, `.tmp-${randomUUID()}`);
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      const writing = pipeline(
        source,
        meter,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      onPipelineReady?.();
      await writing;
      try {
        await rename(temporary, target);
      } catch (error) {
        if (namespace === 'inquiry-quarantine')
          throw new PrivateStorageUnavailableError(error);
        throw error;
      }
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if (
        namespace === 'inquiry-quarantine' &&
        !(error instanceof PrivateStorageUnavailableError) &&
        isStorageFailure(error)
      )
        throw new PrivateStorageUnavailableError(error);
      throw error;
    }
    const stored = Object.freeze({ key, size, sha256: hash.digest('hex') });
    if (!owned) return { stored, receipt: Object.freeze({}) };
    const receipt = Object.freeze({ id: randomUUID() });
    this.ownership.set(receipt, target);
    return { stored, receipt };
  }

  private root() {
    const configured = process.env.FILE_STORAGE_ROOT?.trim();
    if (!configured) throw new Error('FILE_STORAGE_ROOT is required.');
    return resolve(configured);
  }

  private filePath(key: string, namespace: string | null) {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error('PRIVATE_STORAGE_KEY_INVALID');
    const root = this.root();
    const directory = namespace ? resolve(root, namespace) : root;
    if (
      !directory.startsWith(
        `${root}${process.platform === 'win32' ? '\\' : '/'}`,
      ) &&
      directory !== root
    )
      throw new Error('PRIVATE_STORAGE_NAMESPACE_INVALID');
    return join(directory, key);
  }
}
