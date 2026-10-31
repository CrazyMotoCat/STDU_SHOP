import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Inject,
} from '@nestjs/common';
import { DATABASE, PrismaDatabase } from '../database/database.module.js';
import {
  endResponseBounded,
  waitForResponseDrain,
  waitWithAbort,
} from './response-lifecycle.js';
import {
  PrivateFileStorage,
  PrivateStorageIntegrityError,
} from '../storage/private-file-storage.js';

interface AuthorizedScanSource {
  readonly sourceDocumentId: string;
  readonly sourceStorageKey: string;
  readonly sourceSha256: Uint8Array;
  readonly sourceSizeBytes: bigint;
}

const JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class InquiryScanStreamServer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private server: Server | undefined;
  private readonly streams = new Set<Readable>();

  constructor(
    @Inject(DATABASE) private readonly database: PrismaDatabase,
    private readonly storage: PrivateFileStorage,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.SCAN_STREAM_ENABLED !== 'true') return;
    const host = process.env.SCAN_STREAM_HOST?.trim();
    const port = Number(process.env.SCAN_STREAM_PORT ?? '9011');
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Private scan stream listener configuration is invalid.');

    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.headersTimeout = 5_000;
    this.server.requestTimeout = 180_000;
    this.server.keepAliveTimeout = 1_000;
    this.server.maxHeadersCount = 16;
    const server = this.server;
    const listening = new Promise<void>((resolve, reject) => {
      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        server.removeListener('listening', onListening);
        reject(error);
      };
      server.once('error', onError);
      server.once('listening', onListening);
    });
    server.listen(port, host);
    await listening;
  }

  async onApplicationShutdown() {
    for (const stream of this.streams) stream.destroy();
    this.streams.clear();
    const server = this.server;
    this.server = undefined;
    if (!server?.listening) return;
    const closed = once(server, 'close').then(() => undefined);
    server.close();
    server.closeAllConnections();
    await Promise.race([
      closed,
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const match = /^\/internal\/inquiry-scan\/jobs\/([^/]+)\/content$/.exec(
      request.url ?? '',
    );
    const token = request.headers['x-scan-lease-token'];
    const version = request.headers['x-scan-job-version'];
    if (
      request.method !== 'POST' ||
      !match ||
      !JOB_ID_PATTERN.test(match[1] ?? '') ||
      typeof token !== 'string' ||
      !TOKEN_PATTERN.test(token) ||
      typeof version !== 'string' ||
      !/^[1-9][0-9]{0,9}$/.test(version) ||
      Number(version) > 2_147_483_647 ||
      (request.headers['content-length'] !== undefined &&
        request.headers['content-length'] !== '0') ||
      request.headers['transfer-encoding'] !== undefined
    ) {
      response.writeHead(404).end();
      return;
    }

    const jobId = match[1]!;
    const tokenHash = createHash('sha256').update(token, 'base64url').digest();
    let stream: Readable | undefined;
    let finished = false;
    const abortController = new AbortController();
    const abort = () => {
      if (finished || abortController.signal.aborted) return;
      abortController.abort(new Error('Private scan stream was aborted.'));
      stream?.destroy();
      if (request.aborted || response.destroyed) response.destroy();
      else if (!response.headersSent) response.writeHead(503).end();
      else response.destroy();
    };
    const timer = setTimeout(abort, 180_000);
    const onResponseClose = () => {
      if (!finished && !response.writableFinished) abort();
    };
    request.once('aborted', abort);
    response.once('close', onResponseClose);
    try {
      let source: AuthorizedScanSource | undefined;
      try {
        const authorization = this.database.$transaction(
          async (transaction) => {
            await transaction.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
            return transaction.$queryRaw<AuthorizedScanSource[]>`
              SELECT source_document_id AS "sourceDocumentId",
                     source_storage_key AS "sourceStorageKey",
                     source_sha256 AS "sourceSha256",
                     source_size_bytes AS "sourceSizeBytes"
              FROM inquiry_scan_read_authorized(
                ${jobId}::uuid, ${Number(version)}::integer, ${tokenHash}::bytea
              )`;
          },
          { maxWait: 5_000, timeout: 7_500 },
        );
        const rows = await waitWithAbort(authorization, abortController.signal);
        source = rows[0];
      } catch {
        if (abortController.signal.aborted) return;
        response.writeHead(404).end();
        return;
      }
      if (!source) {
        response.writeHead(404).end();
        return;
      }

      stream = await this.storage.openInquiryQuarantineForScan(
        source.sourceStorageKey,
        source.sourceSha256,
        source.sourceSizeBytes,
      );
      this.streams.add(stream);
      stream.once('close', () => this.streams.delete(stream!));
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'X-Scan-Content-Length': source.sourceSizeBytes.toString(),
        Trailer: 'X-Scan-Stream-Status',
        Connection: 'close',
      });
      try {
        for await (const chunk of stream) {
          if (!response.write(chunk)) await waitForResponseDrain(response);
        }
      } catch (error) {
        stream.destroy();
        if (!response.destroyed && !response.writableEnded) {
          response.addTrailers({
            'X-Scan-Stream-Status':
              error instanceof PrivateStorageIntegrityError
                ? 'SOURCE_MISMATCH'
                : 'SCANNER_UNAVAILABLE',
          });
          await endResponseBounded(response);
        }
        return;
      }
      response.addTrailers({ 'X-Scan-Stream-Status': 'COMPLETE' });
      await endResponseBounded(response);
      finished = true;
    } catch (error) {
      stream?.destroy();
      if (!response.destroyed && !response.headersSent) {
        response.setHeader(
          'X-Scan-Stream-Failure',
          error instanceof PrivateStorageIntegrityError
            ? 'SOURCE_MISMATCH'
            : 'SCANNER_UNAVAILABLE',
        );
        response.writeHead(503).end();
      } else if (!response.destroyed) response.destroy();
      if (error instanceof PrivateStorageIntegrityError) {
        // Integrity failures are intentionally not logged with job, key, or source details.
      }
    } finally {
      clearTimeout(timer);
      request.removeListener('aborted', abort);
      response.removeListener('close', onResponseClose);
      if (stream) this.streams.delete(stream);
    }
  }
}
