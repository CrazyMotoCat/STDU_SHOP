import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';
import type { StoragePort, StoredObject } from './storage.port.js';

export interface OwnedStorageWrite {
  readonly stored: StoredObject;
  readonly receipt: object;
}

@Injectable()
export class PrivateFileStorage implements StoragePort {
  private readonly ownership = new WeakMap<object, string>();

  async write(source: Readable): Promise<StoredObject> {
    return (await this.store(source, false)).stored;
  }

  async writeOwned(source: Readable): Promise<OwnedStorageWrite> {
    return this.store(source, true);
  }

  async removeOwned(write: OwnedStorageWrite): Promise<void> {
    const key = write.stored.key;
    if (this.ownership.get(write.receipt) !== key)
      throw new Error('PRIVATE_STORAGE_RECEIPT_INVALID');
    await unlink(this.filePath(key));
    this.ownership.delete(write.receipt);
  }

  async open(key: string): Promise<Readable> {
    return createReadStream(this.filePath(key));
  }

  private async store(
    source: Readable,
    owned: boolean,
  ): Promise<OwnedStorageWrite> {
    const key = randomBytes(32).toString('hex');
    const target = this.filePath(key);
    await mkdir(this.root(), { recursive: true, mode: 0o700 });
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
      await pipeline(
        source,
        meter,
        createWriteStream(target, { flags: 'wx', mode: 0o600 }),
      );
    } catch (error) {
      await unlink(target).catch(() => undefined);
      throw error;
    }
    const stored = Object.freeze({ key, size, sha256: hash.digest('hex') });
    if (!owned) return { stored, receipt: Object.freeze({}) };
    const receipt = Object.freeze({ id: randomUUID() });
    this.ownership.set(receipt, key);
    return { stored, receipt };
  }

  private root() {
    const configured = process.env.FILE_STORAGE_ROOT?.trim();
    if (!configured) throw new Error('FILE_STORAGE_ROOT is required.');
    return resolve(configured);
  }

  private filePath(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error('PRIVATE_STORAGE_KEY_INVALID');
    return join(this.root(), key);
  }
}
