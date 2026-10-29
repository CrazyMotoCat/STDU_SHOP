import { createHash } from 'node:crypto';
import { IncomingMessage, request as httpRequest } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Readable } from 'node:stream';
import { once } from 'node:events';

export const MAX_SCAN_DEADLINE_MS = 180_000;
export const MAX_STREAM_BYTES = 52_428_800;
const CHUNK_BYTES = 64 * 1024;
const MAX_CLAM_RESPONSE_BYTES = 4_096;

export type ScanFailureCode =
  | 'SCANNER_UNAVAILABLE'
  | 'SCAN_TIMEOUT'
  | 'STREAM_INTERRUPTED'
  | 'PROTOCOL_ERROR'
  | 'SIGNATURES_STALE'
  | 'SIGNATURES_CHANGED'
  | 'SOURCE_MISMATCH'
  | 'SCAN_LIMIT_EXCEEDED'
  | 'ENCRYPTED_OR_UNSCANNABLE'
  | 'INTERNAL_ERROR';

export type ScanResultCode = 'CLEAN' | 'REJECTED' | 'RETRY' | 'SCAN_ERROR';

export interface ScanAttestation {
  readonly ready: boolean;
  readonly engineVersion: string;
  readonly signatureDatabaseVersion: string;
  readonly signatureDatabaseDate: Date;
  readonly signatureSetFingerprint: Buffer;
  readonly signatureAgeSeconds: number;
}

export interface ScanJobClaim {
  readonly jobId: string;
  readonly sourceDocumentId: string;
  readonly expectedSha256: Buffer;
  readonly expectedSizeBytes: bigint;
  readonly profileLimitBytes: bigint;
  readonly jobVersion: number;
  readonly leaseExpiresAt: Date;
}

export class ScanProtocolError extends Error {
  constructor(
    readonly code: ScanFailureCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'ScanProtocolError';
  }
}

export function classifyClamSessionCloseFailure(error: unknown): {
  readonly result: ScanResultCode;
  readonly failureCode: ScanFailureCode;
} {
  if (error instanceof ScanProtocolError)
    return {
      result: error.retryable ? 'RETRY' : 'SCAN_ERROR',
      failureCode: error.code,
    };
  return { result: 'SCAN_ERROR', failureCode: 'PROTOCOL_ERROR' };
}

export function parseClamVersionReply(
  reply: string,
  now = Date.now(),
): ScanAttestation {
  const match = /^ClamAV\s+(\d+\.\d+\.\d+)\/(\d{1,10})\/(.+)$/.exec(
    reply.trim(),
  );
  if (!match) throw new ScanProtocolError('PROTOCOL_ERROR', false);
  const engineVersion = `ClamAV ${match[1]}`;
  const signatureDatabaseVersion = match[2]!;
  const signatureDateText = match[3]!.trim();
  const parsed = Date.parse(`${signatureDateText} UTC`);
  if (!Number.isFinite(parsed) || Number(signatureDatabaseVersion) <= 0)
    throw new ScanProtocolError('PROTOCOL_ERROR', false);
  const signatureDatabaseDate = new Date(parsed);
  const signatureAgeSeconds = Math.floor((now - parsed) / 1000);
  const signatureSetFingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        engineVersion,
        signatureDatabaseVersion,
        signatureDatabaseDate.toISOString(),
      ]),
    )
    .digest();
  const ready =
    engineVersion === 'ClamAV 1.4.6' &&
    signatureAgeSeconds >= 0 &&
    signatureAgeSeconds <= 86_400;
  return {
    ready,
    engineVersion,
    signatureDatabaseVersion,
    signatureDatabaseDate,
    signatureSetFingerprint,
    signatureAgeSeconds,
  };
}

export function classifyClamReply(reply: string): {
  readonly result: ScanResultCode;
  readonly failureCode: ScanFailureCode | null;
} {
  const normalized = reply.trim();
  if (normalized === 'stream: OK')
    return { result: 'CLEAN', failureCode: null };
  if (/^stream: .+ FOUND$/.test(normalized)) {
    if (/Heuristics\.Limits\.Exceeded/i.test(normalized))
      return { result: 'SCAN_ERROR', failureCode: 'SCAN_LIMIT_EXCEEDED' };
    if (/Heuristics\.(?:Encrypted|OLE2\.Encrypted)/i.test(normalized))
      return { result: 'SCAN_ERROR', failureCode: 'ENCRYPTED_OR_UNSCANNABLE' };
    return { result: 'REJECTED', failureCode: null };
  }
  if (/INSTREAM size limit exceeded|size limit exceeded/i.test(normalized))
    return { result: 'SCAN_ERROR', failureCode: 'SCAN_LIMIT_EXCEEDED' };
  return { result: 'SCAN_ERROR', failureCode: 'PROTOCOL_ERROR' };
}

export function attestationMatches(
  start: ScanAttestation,
  end: ScanAttestation,
): boolean {
  return (
    start.ready &&
    end.ready &&
    start.engineVersion === end.engineVersion &&
    start.signatureDatabaseVersion === end.signatureDatabaseVersion &&
    start.signatureDatabaseDate.getTime() ===
      end.signatureDatabaseDate.getTime() &&
    start.signatureSetFingerprint.equals(end.signatureSetFingerprint)
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export class SessionMessageReader {
  private buffer = Buffer.alloc(0);
  private readonly pending: Array<{
    resolve: (message: string) => void;
    reject: (error: Error) => void;
  }> = [];
  private closedError: Error | undefined;

  constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const delimiter = this.buffer.indexOf(0);
      if (
        this.buffer.length > MAX_CLAM_RESPONSE_BYTES + 1 ||
        (delimiter < 0 && this.buffer.length > MAX_CLAM_RESPONSE_BYTES) ||
        delimiter > MAX_CLAM_RESPONSE_BYTES
      ) {
        this.fail(new ScanProtocolError('PROTOCOL_ERROR', false));
        socket.destroy();
        return;
      }
      this.flush();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () =>
      this.fail(new ScanProtocolError('STREAM_INTERRUPTED', true)),
    );
  }

  read(): Promise<string> {
    const delimiter = this.buffer.indexOf(0);
    if (delimiter >= 0) {
      if (delimiter > MAX_CLAM_RESPONSE_BYTES) {
        const error = new ScanProtocolError('PROTOCOL_ERROR', false);
        this.fail(error);
        this.socket.destroy(error);
        return Promise.reject(error);
      }
      const result = this.buffer.subarray(0, delimiter).toString('utf8');
      this.buffer = this.buffer.subarray(delimiter + 1);
      return Promise.resolve(result);
    }
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise((resolve, reject) =>
      this.pending.push({ resolve, reject }),
    );
  }

  hasBufferedData() {
    return this.buffer.length > 0;
  }

  hasClosed() {
    return this.closedError !== undefined;
  }

  private flush() {
    while (this.pending.length && this.buffer.includes(0)) {
      const waiter = this.pending.shift()!;
      const delimiter = this.buffer.indexOf(0);
      const result = this.buffer.subarray(0, delimiter).toString('utf8');
      this.buffer = this.buffer.subarray(delimiter + 1);
      waiter.resolve(result);
    }
  }

  private fail(error: Error) {
    if (this.closedError) return;
    this.closedError = error;
    for (const waiter of this.pending.splice(0)) waiter.reject(error);
  }
}

export class ClamSession {
  private readonly socket: Socket;
  private readonly reader: SessionMessageReader;
  private commandId = 0;
  private endCommandSent = false;

  private constructor(
    socket: Socket,
    private readonly operationTimeoutMs: number,
  ) {
    this.socket = socket;
    this.reader = new SessionMessageReader(socket);
  }

  static async connect(
    host: string,
    port: number,
    connectTimeoutMs: number,
    operationTimeoutMs = connectTimeoutMs,
  ) {
    const socket = connect({ host, port });
    socket.setNoDelay(true);
    const timeout = setTimeout(
      () => socket.destroy(new ScanProtocolError('SCAN_TIMEOUT', true)),
      connectTimeoutMs,
    );
    try {
      await once(socket, 'connect');
      const session = new ClamSession(socket, operationTimeoutMs);
      await session.write(
        Buffer.from('zIDSESSION\0'),
        Date.now() + operationTimeoutMs,
      );
      return session;
    } catch (error) {
      socket.destroy();
      if (error instanceof ScanProtocolError) throw error;
      throw new ScanProtocolError('SCANNER_UNAVAILABLE', true);
    } finally {
      clearTimeout(timeout);
    }
  }

  async attest(
    deadlineAt?: number,
    now = Date.now(),
  ): Promise<ScanAttestation> {
    const ping = await this.command('PING', deadlineAt);
    const version = await this.command('VERSION', deadlineAt);
    if (ping !== 'PONG') throw new ScanProtocolError('PROTOCOL_ERROR', false);
    return parseClamVersionReply(version, now);
  }

  async instream(
    content: Readable,
    expectedSha256: Buffer,
    expectedSizeBytes: bigint,
    maxBytes: bigint,
    deadlineAt: number,
  ) {
    const id = ++this.commandId;
    await this.write(Buffer.from('zINSTREAM\0'));
    const hash = createHash('sha256');
    let size = 0n;
    for await (const chunkValue of content) {
      if (Date.now() >= deadlineAt)
        throw new ScanProtocolError('SCAN_TIMEOUT', true);
      const chunk = Buffer.isBuffer(chunkValue)
        ? chunkValue
        : Buffer.from(chunkValue as Uint8Array);
      if (!chunk.length) continue;
      size += BigInt(chunk.length);
      if (size > maxBytes || size > BigInt(MAX_STREAM_BYTES))
        throw new ScanProtocolError('SOURCE_MISMATCH', false);
      hash.update(chunk);
      for (let offset = 0; offset < chunk.length; offset += CHUNK_BYTES) {
        if (Date.now() >= deadlineAt)
          throw new ScanProtocolError('SCAN_TIMEOUT', true);
        const part = chunk.subarray(
          offset,
          Math.min(offset + CHUNK_BYTES, chunk.length),
        );
        const header = Buffer.allocUnsafe(4);
        header.writeUInt32BE(part.length);
        await this.write(header, deadlineAt);
        await this.write(part, deadlineAt);
      }
    }
    if (content instanceof IncomingMessage) {
      const terminal = content.trailers['x-scan-stream-status'];
      if (terminal === 'SOURCE_MISMATCH')
        throw new ScanProtocolError('SOURCE_MISMATCH', false);
      if (terminal === 'SCANNER_UNAVAILABLE')
        throw new ScanProtocolError('SCANNER_UNAVAILABLE', true);
      if (terminal !== 'COMPLETE')
        throw new ScanProtocolError('PROTOCOL_ERROR', false);
    }
    const observedSha256 = hash.digest();
    if (size !== expectedSizeBytes || !observedSha256.equals(expectedSha256))
      throw new ScanProtocolError('SOURCE_MISMATCH', false);
    await this.write(Buffer.alloc(4), deadlineAt);
    const record = await this.readResponse(id, deadlineAt);
    return {
      ...classifyClamReply(record),
      observedSha256,
      observedSizeBytes: size,
    };
  }

  async close(timeoutMs = 1_000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
      throw new Error('ClamAV session close timeout is invalid.');
    if (
      this.socket.destroyed ||
      this.socket.readableEnded ||
      this.reader.hasClosed()
    ) {
      if (!this.endCommandSent)
        throw new ScanProtocolError('STREAM_INTERRUPTED', true);
      this.assertNoUnexpectedReplies();
      return;
    }
    const deadlineAt = Date.now() + timeoutMs;
    try {
      await this.write(Buffer.from('zEND\0'), deadlineAt);
    } catch (error) {
      this.socket.destroy();
      throw error;
    }
    this.endCommandSent = true;
    this.socket.end();
    let timer: NodeJS.Timeout | undefined;
    const closed = await Promise.race([
      once(this.socket, 'close').then(
        () => 'closed' as const,
        () => 'error' as const,
      ),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(
          () => resolve('timeout'),
          Math.max(0, deadlineAt - Date.now()),
        );
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (closed !== 'closed') {
      this.socket.destroy();
      throw new ScanProtocolError(
        closed === 'timeout' ? 'SCAN_TIMEOUT' : 'STREAM_INTERRUPTED',
        true,
      );
    }
    this.assertNoUnexpectedReplies();
  }

  private assertNoUnexpectedReplies() {
    if (this.reader.hasBufferedData())
      throw new ScanProtocolError('PROTOCOL_ERROR', false);
  }

  isDestroyed() {
    return this.socket.destroyed;
  }

  destroy(error?: Error) {
    this.socket.destroy(error);
  }

  private async command(command: string, deadlineAt?: number) {
    const id = ++this.commandId;
    await this.write(Buffer.from(`z${command}\0`), deadlineAt);
    return this.readResponse(id, deadlineAt);
  }

  private async readResponse(expectedId: number, deadlineAt?: number) {
    const leftMs =
      deadlineAt === undefined
        ? this.operationTimeoutMs
        : Math.min(this.operationTimeoutMs, deadlineAt - Date.now());
    if (leftMs <= 0) throw new ScanProtocolError('SCAN_TIMEOUT', true);
    let timer: NodeJS.Timeout | undefined;
    let record: string;
    try {
      record = await Promise.race([
        this.reader.read(),
        new Promise<string>((_resolve, reject) => {
          timer = setTimeout(() => {
            const error = new ScanProtocolError('SCAN_TIMEOUT', true);
            this.socket.destroy(error);
            reject(error);
          }, leftMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const match = /^(\d+): (.*)$/.exec(record);
    if (!match || Number(match[1]) !== expectedId) {
      const error = new ScanProtocolError('PROTOCOL_ERROR', false);
      this.socket.destroy(error);
      throw error;
    }
    return match[2]!;
  }

  private async write(chunk: Buffer, deadlineAt?: number) {
    if (this.socket.destroyed)
      throw new ScanProtocolError('STREAM_INTERRUPTED', true);
    if (!this.socket.write(chunk)) {
      const waitMs = deadlineAt === undefined ? 5_000 : deadlineAt - Date.now();
      if (waitMs <= 0) throw new ScanProtocolError('SCAN_TIMEOUT', true);
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          once(this.socket, 'drain'),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new ScanProtocolError(
                    deadlineAt === undefined
                      ? 'STREAM_INTERRUPTED'
                      : 'SCAN_TIMEOUT',
                    true,
                  ),
                ),
              waitMs,
            );
          }),
        ]);
      } catch (error) {
        if (error instanceof ScanProtocolError) throw error;
        throw new ScanProtocolError('STREAM_INTERRUPTED', true);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
}

export function requestScanContent(
  apiHost: string,
  apiPort: number,
  claim: ScanJobClaim,
  leaseToken: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStream: IncomingMessage | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: ScanProtocolError) => {
      if (responseStream && !responseStream.destroyed)
        responseStream.destroy(error);
      if (!request.destroyed) request.destroy(error);
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const onAbort = () => {
      const reason = signal?.reason;
      fail(
        reason instanceof ScanProtocolError
          ? reason
          : new ScanProtocolError('SCAN_TIMEOUT', true),
      );
    };
    const request = httpRequest(
      {
        host: apiHost,
        port: apiPort,
        method: 'POST',
        path: `/internal/inquiry-scan/jobs/${claim.jobId}/content`,
        headers: {
          'x-scan-lease-token': leaseToken,
          'x-scan-job-version': String(claim.jobVersion),
          connection: 'close',
        },
        agent: false,
      },
      (response) => {
        responseStream = response;
        response.once('end', cleanup);
        response.once('close', cleanup);
        if (response.statusCode !== 200) {
          const header = response.headers['x-scan-stream-failure'];
          response.resume();
          const error = new ScanProtocolError(
            header === 'SOURCE_MISMATCH'
              ? 'SOURCE_MISMATCH'
              : header === 'SCANNER_UNAVAILABLE'
                ? 'SCANNER_UNAVAILABLE'
                : 'STREAM_INTERRUPTED',
            header !== 'SOURCE_MISMATCH',
          );
          settled = true;
          reject(error);
          return;
        }
        if (
          response.headers['x-scan-content-length'] !==
          claim.expectedSizeBytes.toString()
        ) {
          response.resume();
          settled = true;
          reject(new ScanProtocolError('SOURCE_MISMATCH', false));
          return;
        }
        settled = true;
        resolve(response);
      },
    );
    request.once('error', (error) => {
      const normalized =
        error instanceof ScanProtocolError
          ? error
          : new ScanProtocolError('SCANNER_UNAVAILABLE', true);
      if (responseStream && !responseStream.destroyed)
        responseStream.destroy(normalized);
      if (!settled) {
        settled = true;
        cleanup();
        reject(normalized);
      }
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(
      () => fail(new ScanProtocolError('SCAN_TIMEOUT', true)),
      timeoutMs,
    );
    if (signal?.aborted) {
      onAbort();
      return;
    }
    request.end();
  });
}

export async function writeWithTimeout(
  socket: Socket,
  chunk: Buffer,
  deadlineAt: number,
) {
  if (Date.now() >= deadlineAt)
    throw new ScanProtocolError('SCAN_TIMEOUT', true);
  if (!socket.write(chunk)) {
    const left = deadlineAt - Date.now();
    if (left <= 0) throw new ScanProtocolError('SCAN_TIMEOUT', true);
    await Promise.race([
      once(socket, 'drain'),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new ScanProtocolError('SCAN_TIMEOUT', true)),
          left,
        ),
      ),
    ]);
  }
}
