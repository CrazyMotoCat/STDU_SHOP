import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  endResponseBounded,
  waitForResponseDrain,
} from '../src/inquiries/response-lifecycle.js';
import {
  attestationMatches,
  classifyClamReply,
  classifyClamSessionCloseFailure,
  enforceScanCompleteness,
  ClamSession,
  parseClamVersionReply,
  requestScanContent,
  ScanProtocolError,
} from '../src/inquiries/scan-protocol.js';
import { InquiryScanStreamServer } from '../src/inquiries/scan-stream.server.js';

const now = Date.UTC(2026, 9, 28, 9, 0, 0);

describe('R1-010D completeness gate', () => {
  it('fails closed for every apparently clean scan, independent of filename and MIME', () => {
    expect(enforceScanCompleteness('CLEAN')).toEqual({
      result: 'SCAN_ERROR',
      failureCode: 'ENCRYPTED_OR_UNSCANNABLE',
    });
    expect(enforceScanCompleteness('REJECTED').result).toBe('REJECTED');
  });

  it('does not label unknown heuristic alerts as confirmed malware', () => {
    expect(classifyClamReply('stream: Heuristics.Unknown FOUND')).toEqual({
      result: 'SCAN_ERROR',
      failureCode: 'ENCRYPTED_OR_UNSCANNABLE',
    });
  });
});

describe('R1-010D bounded private response completion', () => {
  it('settles successfully after the response finishes', async () => {
    const response = new EventEmitterResponse();
    const completed = endResponseBounded(response as never, 100);
    queueMicrotask(() => {
      response.writableFinished = true;
      response.emit('finish');
    });

    await expect(completed).resolves.toBeUndefined();
    expect(response.endCalls).toBe(1);
    expect(response.listenerCount('finish')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
    expect(response.listenerCount('error')).toBe(0);
  });

  it('settles when the peer closes before finish and removes listeners', async () => {
    const response = new EventEmitterResponse();
    const startedAt = Date.now();
    const completion = endResponseBounded(response as never, 1000);
    queueMicrotask(() => response.emit('close'));

    await expect(completion).rejects.toThrow(
      'Private scan response closed before finish.',
    );
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(response.endCalls).toBe(1);
    expect(response.listenerCount('finish')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
    expect(response.listenerCount('error')).toBe(0);
  });

  it('cleans up drain, close and error listeners after repeated backpressure', async () => {
    const response = new EventEmitterResponse();
    for (let index = 0; index < 25; index++) {
      const drained = waitForResponseDrain(response as never);
      expect(response.listenerCount('drain')).toBe(1);
      expect(response.listenerCount('close')).toBe(1);
      expect(response.listenerCount('error')).toBe(1);
      response.emit('drain');
      await expect(drained).resolves.toBeUndefined();
      expect(response.listenerCount('drain')).toBe(0);
      expect(response.listenerCount('close')).toBe(0);
      expect(response.listenerCount('error')).toBe(0);
    }
  });

  it('rejects early close and removes every backpressure listener', async () => {
    const response = new EventEmitterResponse();
    const drained = waitForResponseDrain(response as never);
    queueMicrotask(() => response.emit('close'));

    await expect(drained).rejects.toThrow(
      'Private scan stream consumer closed early.',
    );
    expect(response.listenerCount('drain')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
    expect(response.listenerCount('error')).toBe(0);
  });
});

class EventEmitterResponse extends EventEmitter {
  writableFinished = false;
  writableEnded = false;
  headersSent = false;
  endCalls = 0;
  destroyed = false;
  statusCode: number | undefined;

  setHeader() {
    return this;
  }

  writeHead(statusCode: number) {
    this.headersSent = true;
    this.statusCode = statusCode;
    return this;
  }

  end() {
    this.endCalls++;
    this.writableEnded = true;
    return this;
  }

  destroy() {
    this.destroyed = true;
    this.emit('close');
    return this;
  }

  write() {
    return true;
  }

  addTrailers() {
    return this;
  }
}

describe('R1-010D private stream authorization lifecycle', () => {
  it('returns from a stalled authorization when the client disconnects', async () => {
    const request = new EventEmitter() as EventEmitter & {
      method: string;
      url: string;
      headers: Record<string, string>;
      aborted: boolean;
    };
    request.method = 'POST';
    request.url = `/internal/inquiry-scan/jobs/${randomUUID()}/content`;
    request.headers = {
      'x-scan-lease-token': 'A'.repeat(43),
      'x-scan-job-version': '1',
      'content-length': '0',
    };
    request.aborted = false;
    const response = new EventEmitterResponse();
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    let statement = '';
    let transactionOptions: { maxWait: number; timeout: number } | undefined;
    const transaction = {
      $executeRaw: async (parts: TemplateStringsArray) => {
        statement = parts.join('');
        return 0;
      },
      $queryRaw: () => {
        authorizationStarted();
        return new Promise<never>(() => {});
      },
    };
    const database = {
      $transaction: (
        operation: (tx: typeof transaction) => Promise<unknown>,
        options: { maxWait: number; timeout: number },
      ) => {
        transactionOptions = options;
        return operation(transaction);
      },
    };
    const storage = {
      openInquiryQuarantineForScan: () => {
        throw new Error('Storage must not be read before authorization.');
      },
    };
    const streamServer = new InquiryScanStreamServer(
      database as never,
      storage as never,
    );
    const handle = (
      streamServer as unknown as {
        handle(request: unknown, response: unknown): Promise<void>;
      }
    ).handle.bind(streamServer);
    const operation = handle(request, response);
    await started;
    request.aborted = true;
    request.emit('aborted');

    await expect(operation).resolves.toBeUndefined();
    expect(response.destroyed).toBe(true);
    expect(transactionOptions).toEqual({ maxWait: 5_000, timeout: 7_500 });
    expect(statement).toContain("SET LOCAL statement_timeout = '5000ms'");
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });
});

describe('R1-010D ClamAV protocol classification', () => {
  it('maps retryable close failures to retries and permanent failures to scan errors', () => {
    expect(
      classifyClamSessionCloseFailure(
        new ScanProtocolError('STREAM_INTERRUPTED', true),
      ),
    ).toEqual({ result: 'RETRY', failureCode: 'STREAM_INTERRUPTED' });
    expect(
      classifyClamSessionCloseFailure(
        new ScanProtocolError('PROTOCOL_ERROR', false),
      ),
    ).toEqual({ result: 'SCAN_ERROR', failureCode: 'PROTOCOL_ERROR' });
    expect(classifyClamSessionCloseFailure(new Error('unknown'))).toEqual({
      result: 'SCAN_ERROR',
      failureCode: 'PROTOCOL_ERROR',
    });
  });

  it('parses the loaded engine and signature metadata with a bounded age', () => {
    const result = parseClamVersionReply(
      'ClamAV 1.4.6/29900/Wed Oct 28 08:30:00 2026',
      now,
    );
    expect(result).toMatchObject({
      ready: true,
      engineVersion: 'ClamAV 1.4.6',
      signatureDatabaseVersion: '29900',
      signatureAgeSeconds: 1800,
    });
    expect(result.signatureSetFingerprint).toHaveLength(32);
  });

  it('fails readiness closed for stale, future, unsupported, and ambiguous metadata', () => {
    expect(
      parseClamVersionReply('ClamAV 1.4.6/29900/Tue Oct 27 08:00:00 2026', now)
        .ready,
    ).toBe(false);
    expect(
      parseClamVersionReply('ClamAV 1.4.6/29900/Thu Oct 29 08:00:00 2026', now)
        .ready,
    ).toBe(false);
    expect(
      parseClamVersionReply('ClamAV 1.5.4/29900/Wed Oct 28 08:30:00 2026', now)
        .ready,
    ).toBe(false);
    expect(() => parseClamVersionReply('ClamAV unknown', now)).toThrow(
      'PROTOCOL_ERROR',
    );
  });

  it('requires unchanged ready engine and database metadata across a scan', () => {
    const start = parseClamVersionReply(
      'ClamAV 1.4.6/29900/Wed Oct 28 08:30:00 2026',
      now,
    );
    const same = parseClamVersionReply(
      'ClamAV 1.4.6/29900/Wed Oct 28 08:30:00 2026',
      now + 10_000,
    );
    const changed = parseClamVersionReply(
      'ClamAV 1.4.6/29901/Wed Oct 28 08:45:00 2026',
      now + 10_000,
    );
    expect(attestationMatches(start, same)).toBe(true);
    expect(attestationMatches(start, changed)).toBe(false);
  });

  it('maps only a complete clean reply to CLEAN', () => {
    expect(classifyClamReply('stream: OK')).toEqual({
      result: 'CLEAN',
      failureCode: null,
    });
    expect(classifyClamReply('stream: Eicar-Signature FOUND')).toEqual({
      result: 'REJECTED',
      failureCode: null,
    });
    expect(
      classifyClamReply('stream: Heuristics.Limits.Exceeded.MaxScanSize FOUND'),
    ).toEqual({ result: 'SCAN_ERROR', failureCode: 'SCAN_LIMIT_EXCEEDED' });
    expect(
      classifyClamReply('stream: Heuristics.XZ.DicSizeLimit FOUND'),
    ).toEqual({ result: 'SCAN_ERROR', failureCode: 'SCAN_LIMIT_EXCEEDED' });
    expect(classifyClamReply('stream: Heuristics.Encrypted.PDF FOUND')).toEqual(
      {
        result: 'SCAN_ERROR',
        failureCode: 'ENCRYPTED_OR_UNSCANNABLE',
      },
    );
    expect(classifyClamReply('INSTREAM size limit exceeded')).toEqual({
      result: 'SCAN_ERROR',
      failureCode: 'SCAN_LIMIT_EXCEEDED',
    });
    expect(classifyClamReply('stream: unexpected result')).toEqual({
      result: 'SCAN_ERROR',
      failureCode: 'PROTOCOL_ERROR',
    });
  });
});

function clamVersionReply(now = Date.now()) {
  const value = new Date(now);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    value.getUTCDay()
  ];
  const month = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][value.getUTCMonth()];
  const pad = (part: number) => String(part).padStart(2, '0');
  return `ClamAV 1.4.6/29900/${weekday} ${month} ${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())} ${value.getUTCFullYear()}`;
}

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fake clamd did not bind a port.');
  return address.port;
}

describe('R1-010D bounded clamd IDSESSION/INSTREAM transport', () => {
  it('bounds a private HTTP stream request that stalls before response headers', async () => {
    const server = createServer((socket) => {
      socket.on('data', () => {});
    });
    const port = await listen(server);
    const startedAt = Date.now();
    try {
      await expect(
        requestScanContent(
          '127.0.0.1',
          port,
          {
            jobId: randomUUID(),
            sourceDocumentId: randomUUID(),
            expectedSha256: Buffer.alloc(32),
            expectedSizeBytes: 1n,
            profileLimitBytes: 1024n,
            jobVersion: 1,
            leaseExpiresAt: new Date(Date.now() + 240_000),
          },
          'A'.repeat(43),
          75,
        ),
      ).rejects.toMatchObject({ code: 'SCAN_TIMEOUT' });
      expect(Date.now() - startedAt).toBeLessThan(1000);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not send the final INSTREAM terminator after an API integrity trailer', async () => {
    const bytes = Buffer.from('verified bytes from a private fixture');
    const digest = createHash('sha256').update(bytes).digest();
    let buffer = Buffer.alloc(0);
    let nextId = 0;
    let streaming = false;
    let sawFinalTerminator = false;
    const clamServer = createServer((socket) => {
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          if (streaming) {
            if (buffer.length < 4) return;
            const length = buffer.readUInt32BE(0);
            if (buffer.length < 4 + length) return;
            buffer = buffer.subarray(4 + length);
            if (length === 0) {
              sawFinalTerminator = true;
              streaming = false;
              nextId++;
              socket.write(`${nextId}: stream: OK\0`);
            }
            continue;
          }
          const end = buffer.indexOf(0);
          if (end < 0) return;
          const command = buffer.subarray(0, end).toString('utf8');
          buffer = buffer.subarray(end + 1);
          if (command === 'zIDSESSION') continue;
          if (command === 'zPING') {
            nextId++;
            socket.write(`${nextId}: PONG\0`);
          } else if (command === 'zVERSION') {
            nextId++;
            socket.write(`${nextId}: ${clamVersionReply()}\0`);
          } else if (command === 'zINSTREAM') {
            nextId++;
            streaming = true;
          } else if (command === 'zEND') {
            socket.end();
          }
        }
      });
    });
    const httpServer = createHttpServer((_request, response) => {
      response.writeHead(200, {
        'X-Scan-Content-Length': String(bytes.length),
        Trailer: 'X-Scan-Stream-Status',
        Connection: 'close',
      });
      response.write(bytes);
      response.addTrailers({ 'X-Scan-Stream-Status': 'SOURCE_MISMATCH' });
      response.end();
    });
    const clamPort = await listen(clamServer);
    const httpPort = await listen(httpServer);
    const claim = {
      jobId: randomUUID(),
      sourceDocumentId: randomUUID(),
      expectedSha256: digest,
      expectedSizeBytes: BigInt(bytes.length),
      profileLimitBytes: 1024n,
      jobVersion: 1,
      leaseExpiresAt: new Date(Date.now() + 240_000),
    };
    const session = await ClamSession.connect('127.0.0.1', clamPort, 500);
    try {
      expect((await session.attest()).ready).toBe(true);
      const response = await requestScanContent(
        '127.0.0.1',
        httpPort,
        claim,
        'A'.repeat(43),
        1000,
      );
      await expect(
        session.instream(
          response,
          digest,
          claim.expectedSizeBytes,
          claim.profileLimitBytes,
          Date.now() + 1000,
        ),
      ).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' });
      expect(sawFinalTerminator).toBe(false);
    } finally {
      session.destroy();
      await Promise.all([
        new Promise<void>((resolve) => clamServer.close(() => resolve())),
        new Promise<void>((resolve) => httpServer.close(() => resolve())),
      ]);
    }
  });

  it('frames content in bounded chunks, honors backpressure and validates the byte identity', async () => {
    let observedBytes = 0;
    let maxFrame = 0;
    let buffer = Buffer.alloc(0);
    let nextId = 0;
    let streamId = 0;
    let streaming = false;
    const server = createServer((socket) => {
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          if (streaming) {
            if (buffer.length < 4) return;
            const length = buffer.readUInt32BE(0);
            buffer = buffer.subarray(4);
            if (length === 0) {
              streaming = false;
              socket.write(`${streamId}: stream: OK\0`);
              continue;
            }
            if (buffer.length < length) {
              buffer = Buffer.concat([Buffer.alloc(4).fill(0), buffer]);
              buffer.writeUInt32BE(length, 0);
              return;
            }
            maxFrame = Math.max(maxFrame, length);
            observedBytes += length;
            buffer = buffer.subarray(length);
            continue;
          }
          const end = buffer.indexOf(0);
          if (end < 0) return;
          const command = buffer.subarray(0, end).toString('utf8');
          buffer = buffer.subarray(end + 1);
          if (command === 'zIDSESSION') continue;
          if (command === 'zPING') {
            nextId++;
            socket.write(`${nextId}: PONG\0`);
          } else if (command === 'zVERSION') {
            nextId++;
            socket.write(`${nextId}: ${clamVersionReply()}\0`);
          } else if (command === 'zINSTREAM') {
            nextId++;
            streamId = nextId;
            streaming = true;
          } else if (command === 'zEND') {
            socket.end();
          }
        }
      });
    });
    const port = await listen(server);
    const bytes = Buffer.alloc(200_123, 0x6b);
    const session = await ClamSession.connect('127.0.0.1', port, 500);
    try {
      expect((await session.attest()).ready).toBe(true);
      const result = await session.instream(
        Readable.from([bytes]),
        createHash('sha256').update(bytes).digest(),
        BigInt(bytes.length),
        10n * 1024n * 1024n,
        Date.now() + 2000,
      );
      expect(result.result).toBe('CLEAN');
      expect(observedBytes).toBe(bytes.length);
      expect(maxFrame).toBeLessThanOrEqual(64 * 1024);
    } finally {
      await session.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('bounds an unresponsive clamd reply and destroys the socket', async () => {
    const server = createServer((socket) => {
      socket.on('data', () => {});
    });
    const port = await listen(server);
    const session = await ClamSession.connect('127.0.0.1', port, 100);
    await expect(session.attest()).rejects.toMatchObject({
      code: 'SCAN_TIMEOUT',
    });
    expect(session.isDestroyed()).toBe(true);
    await expect(session.close()).rejects.toMatchObject({
      code: 'STREAM_INTERRUPTED',
      retryable: true,
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('treats truncated and wrong command replies as non-clean protocol failures', async () => {
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.includes(0)) {
          const command = buffer
            .subarray(0, buffer.indexOf(0))
            .toString('utf8');
          buffer = buffer.subarray(buffer.indexOf(0) + 1);
          if (command === 'zIDSESSION') {
            continue;
          }
          if (command === 'zPING') socket.write('99: PONG\0');
        }
      });
    });
    const port = await listen(server);
    const session = await ClamSession.connect('127.0.0.1', port, 500);
    await expect(session.attest()).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
    });
    expect(session.isDestroyed()).toBe(true);
    await expect(session.close()).rejects.toMatchObject({
      code: 'STREAM_INTERRUPTED',
      retryable: true,
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects unexpected records buffered after final VERSION attestation', async () => {
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      let id = 0;
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          const end = buffer.indexOf(0);
          if (end < 0) return;
          const command = buffer.subarray(0, end).toString('utf8');
          buffer = buffer.subarray(end + 1);
          if (command === 'zIDSESSION') continue;
          if (command === 'zPING') {
            id++;
            socket.write(`${id}: PONG\0`);
          } else if (command === 'zVERSION') {
            id++;
            socket.write(
              `${id}: ${clamVersionReply()}\0${id + 1}: stream: OK\0`,
            );
          } else if (command === 'zEND') {
            socket.end();
          }
        }
      });
    });
    const port = await listen(server);
    const session = await ClamSession.connect('127.0.0.1', port, 500);
    try {
      expect((await session.attest()).ready).toBe(true);
      await expect(session.close()).rejects.toMatchObject({
        code: 'PROTOCOL_ERROR',
        retryable: false,
      });
    } finally {
      session.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects a peer that closes after VERSION before the client sends END', async () => {
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      let id = 0;
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          const end = buffer.indexOf(0);
          if (end < 0) return;
          const command = buffer.subarray(0, end).toString('utf8');
          buffer = buffer.subarray(end + 1);
          if (command === 'zIDSESSION') continue;
          if (command === 'zPING') {
            id++;
            socket.write(`${id}: PONG\0`);
          } else if (command === 'zVERSION') {
            id++;
            socket.end(`${id}: ${clamVersionReply()}\0`);
          }
        }
      });
    });
    const port = await listen(server);
    const session = await ClamSession.connect('127.0.0.1', port, 500);
    try {
      expect((await session.attest()).ready).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(session.isDestroyed()).toBe(true);
      await expect(session.close()).rejects.toMatchObject({
        code: 'STREAM_INTERRUPTED',
        retryable: true,
      });
    } finally {
      session.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('bounds all buffered bytes including data after an early NUL', async () => {
    const server = createServer((socket) => {
      socket.on('data', (chunk) => {
        if (chunk.includes(Buffer.from('zPING\0')))
          socket.write(
            Buffer.concat([Buffer.from('1: PONG\0'), Buffer.alloc(5000)]),
          );
      });
    });
    const port = await listen(server);
    const session = await ClamSession.connect('127.0.0.1', port, 500);
    try {
      await expect(session.attest()).rejects.toMatchObject({
        code: 'PROTOCOL_ERROR',
        retryable: false,
      });
    } finally {
      session.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
