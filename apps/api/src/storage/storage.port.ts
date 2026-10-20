import type { Readable } from 'node:stream';

/** Infrastructure interface only. No adapter, uploads or ACL bypass in R1-001. */
export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly sha256: string;
}

export interface StoragePort {
  /** Implementation generates a fresh opaque key; never overwrite an original. */
  write(source: Readable): Promise<StoredObject>;
  /** Caller must authorize the domain operation before opening an object. */
  open(key: string): Promise<Readable>;
}
