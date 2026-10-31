import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Readable } from 'node:stream';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import {
  attestationMatches,
  canonicalJson,
  ClamSession,
  classifyClamSessionCloseFailure,
  enforceScanCompleteness,
  MAX_SCAN_DEADLINE_MS,
  requestScanContent,
  ScanProtocolError,
  type ScanAttestation,
  type ScanFailureCode,
  type ScanJobClaim,
  type ScanResultCode,
} from '../inquiries/scan-protocol.js';
import {
  readResourceSnapshot,
  resourceSnapshotsMatch,
  type ResourceSnapshot,
} from './resource-readiness.js';

interface ClaimRow {
  readonly job_id: string;
  readonly source_document_id: string;
  readonly expected_sha256: Buffer;
  readonly expected_size_bytes: string;
  readonly profile_limit_bytes: string;
  readonly job_version: number;
  readonly lease_expires_at: Date;
}

interface AttemptResult {
  result: ScanResultCode;
  failureCode: ScanFailureCode | null;
  observedSha256: Buffer | null;
  observedSizeBytes: bigint | null;
  startAttestation: ScanAttestation | null;
  endAttestation: ScanAttestation | null;
  durationMs: number;
  startReady: boolean;
  endReady: boolean;
}

function scanDeadlineMs() {
  const configured = process.env.SCAN_TEST_DEADLINE_MS?.trim();
  if (process.env.APP_ENV !== 'test' || configured === undefined)
    return MAX_SCAN_DEADLINE_MS;
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 50 || value > MAX_SCAN_DEADLINE_MS)
    throw new Error('SCAN_TEST_DEADLINE_MS is invalid.');
  return value;
}

@Injectable()
export class ScanWorkerService implements OnApplicationShutdown {
  private readonly pool: Pool;
  private stopping = false;
  private abortActive: (() => void) | undefined;
  private activeTask: Promise<void> | undefined;
  private poolClosed = false;
  private readonly counters = {
    claims: 0,
    clean: 0,
    rejected: 0,
    errors: 0,
    emptyPolls: 0,
    activeScans: 0,
    lastDurationMs: 0,
    lastSignatureAgeSeconds: 0,
  };
  private lastMetricsAt = Date.now();

  constructor() {
    const connectionString = process.env.SCAN_DATABASE_URL?.trim();
    if (!connectionString) throw new Error('SCAN_DATABASE_URL is required.');
    const parsed = new URL(connectionString);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:')
      throw new Error('SCAN_DATABASE_URL must use PostgreSQL.');
    this.pool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      query_timeout: 12_000,
    });
    this.pool.on('error', () => this.log('scan.database.connection_error'));
  }

  async run() {
    while (!this.stopping) {
      try {
        if (!(await this.scannerReady())) {
          this.counters.emptyPolls++;
          await this.emitMetricsIfDue();
          await delay(2_000);
          continue;
        }
        const claim = await this.claim();
        if (!claim) {
          this.counters.emptyPolls++;
          await this.emitMetricsIfDue();
          await delay(1_000);
          continue;
        }
        this.counters.claims++;
        this.counters.activeScans = 1;
        const activeTask = this.processClaim(claim);
        this.activeTask = activeTask;
        try {
          await activeTask;
        } finally {
          if (this.activeTask === activeTask) this.activeTask = undefined;
          this.counters.activeScans = 0;
        }
        await this.emitMetricsIfDue();
      } catch {
        this.counters.activeScans = 0;
        this.counters.errors++;
        this.log('scan.worker.iteration_failed');
        await delay(1_000);
      }
    }
  }

  async stop() {
    this.stopping = true;
    this.abortActive?.();
    const activeTask = this.activeTask;
    if (activeTask) {
      const settled = await Promise.race([
        activeTask.then(
          () => true,
          () => true,
        ),
        delay(15_000).then(() => false),
      ]);
      if (!settled) this.log('scan.worker.shutdown_timeout');
    }
    if (!this.poolClosed) {
      this.poolClosed = true;
      await this.pool.end().catch(() => undefined);
    }
  }

  async onApplicationShutdown() {
    await this.stop();
  }

  private async claim(): Promise<{
    claim: ScanJobClaim;
    token: string;
    tokenHash: Buffer;
  } | null> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token, 'base64url').digest();
    const { rows } = await this.pool.query<ClaimRow>(
      'SELECT * FROM inquiry_scan_claim($1::bytea,$2::uuid)',
      [tokenHash, randomUUID()],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      token,
      tokenHash,
      claim: {
        jobId: row.job_id,
        sourceDocumentId: row.source_document_id,
        expectedSha256: row.expected_sha256,
        expectedSizeBytes: BigInt(row.expected_size_bytes),
        profileLimitBytes: BigInt(row.profile_limit_bytes),
        jobVersion: row.job_version,
        leaseExpiresAt: new Date(row.lease_expires_at),
      },
    };
  }

  private async scannerReady() {
    const host = process.env.CLAMD_HOST?.trim();
    const port = Number(process.env.CLAMD_PORT ?? '3310');
    if (!host || !Number.isInteger(port)) return false;
    let session: ClamSession | undefined;
    try {
      const deadlineAt = Date.now() + 5_000;
      session = await ClamSession.connect(host, port, 2_000, 4_000);
      return (
        (await session.attest(deadlineAt)).ready &&
        !!(await readResourceSnapshot(deadlineAt))
      );
    } catch {
      return false;
    } finally {
      await session?.close();
    }
  }

  private async processClaim({
    claim,
    token,
    tokenHash,
  }: {
    claim: ScanJobClaim;
    token: string;
    tokenHash: Buffer;
  }) {
    this.log('scan.started');
    const attempt = await this.scan(claim, token);
    this.counters.lastDurationMs = attempt.durationMs;
    this.counters.lastSignatureAgeSeconds =
      attempt.endAttestation?.signatureAgeSeconds ??
      attempt.startAttestation?.signatureAgeSeconds ??
      0;
    try {
      const p = attempt.endAttestation ?? attempt.startAttestation;
      const canonicalResult = {
        jobId: claim.jobId,
        sourceDocumentId: claim.sourceDocumentId,
        completedJobVersion: claim.jobVersion,
        leaseTokenHash: tokenHash.toString('hex'),
        sourceSha256: claim.expectedSha256.toString('hex'),
        sourceSizeBytes: claim.expectedSizeBytes.toString(),
        result: attempt.result,
        failureCode: attempt.failureCode,
        engineVersion: p?.engineVersion ?? null,
        signatureDatabaseVersion: p?.signatureDatabaseVersion ?? null,
        signatureDatabaseDate: p?.signatureDatabaseDate.toISOString() ?? null,
        signatureSetFingerprint:
          p?.signatureSetFingerprint.toString('hex') ?? null,
        signatureAgeSeconds: p?.signatureAgeSeconds ?? null,
        startReady: attempt.startReady,
        endReady: attempt.endReady,
        scanDurationMs: attempt.durationMs,
      };
      const fingerprint = createHash('sha256')
        .update(canonicalJson(canonicalResult))
        .digest();
      await this.pool.query(
        `SELECT * FROM inquiry_scan_finalize(
          $1::uuid,$2::integer,$3::bytea,$4::text,$5::text,$6::bytea,$7::bigint,
          $8::text,$9::text,$10::timestamptz,$11::bytea,$12::integer,$13::boolean,
          $14::text,$15::text,$16::timestamptz,$17::bytea,$18::integer,$19::boolean,
          $20::integer,$21::bytea,$22::uuid
        )`,
        [
          claim.jobId,
          claim.jobVersion,
          tokenHash,
          attempt.result,
          attempt.failureCode,
          attempt.observedSha256,
          attempt.observedSizeBytes?.toString() ?? null,
          attempt.startAttestation?.engineVersion ?? null,
          attempt.startAttestation?.signatureDatabaseVersion ?? null,
          attempt.startAttestation?.signatureDatabaseDate ?? null,
          attempt.startAttestation?.signatureSetFingerprint ?? null,
          attempt.startAttestation?.signatureAgeSeconds ?? null,
          attempt.startReady,
          attempt.endAttestation?.engineVersion ?? null,
          attempt.endAttestation?.signatureDatabaseVersion ?? null,
          attempt.endAttestation?.signatureDatabaseDate ?? null,
          attempt.endAttestation?.signatureSetFingerprint ?? null,
          attempt.endAttestation?.signatureAgeSeconds ?? null,
          attempt.endReady,
          attempt.durationMs,
          fingerprint,
          randomUUID(),
        ],
      );
      if (attempt.result === 'CLEAN') this.counters.clean++;
      else if (attempt.result === 'REJECTED') this.counters.rejected++;
      else this.counters.errors++;
      this.log(
        attempt.result === 'CLEAN'
          ? 'scan.clean'
          : attempt.result === 'REJECTED'
            ? 'scan.rejected'
            : 'scan.failed',
        {
          outcome: attempt.result,
          failureCode: attempt.failureCode,
          durationMs: attempt.durationMs,
          signatureAgeSeconds: p?.signatureAgeSeconds ?? null,
        },
      );
    } catch {
      this.counters.errors++;
      this.log('scan.finalize_failed');
    }
  }

  private async scan(
    claim: ScanJobClaim,
    token: string,
  ): Promise<AttemptResult> {
    const startedAt = performance.now();
    const deadlineMs = scanDeadlineMs();
    const deadlineAt = Date.now() + deadlineMs;
    let session: ClamSession | undefined;
    let content: Readable | undefined;
    let result: ScanResultCode = 'RETRY';
    let failureCode: ScanFailureCode | null;
    let observedSha256: Buffer | null = null;
    let observedSizeBytes: bigint | null = null;
    let startAttestation: ScanAttestation | null = null;
    let endAttestation: ScanAttestation | null = null;
    let startResource: ResourceSnapshot | null = null;
    let startReady = false;
    let endReady = false;
    let instreamStarted = false;
    let instreamCompleted = false;
    const requestAbort = new AbortController();
    const abort = (error: ScanProtocolError) => {
      if (!requestAbort.signal.aborted) requestAbort.abort(error);
      content?.destroy(error);
      session?.destroy(error);
    };
    this.abortActive = () =>
      abort(new ScanProtocolError('STREAM_INTERRUPTED', true));
    const timeout = setTimeout(
      () => abort(new ScanProtocolError('SCAN_TIMEOUT', true)),
      deadlineMs,
    );
    try {
      const host = process.env.CLAMD_HOST?.trim();
      const port = Number(process.env.CLAMD_PORT ?? '3310');
      const apiHost = process.env.SCAN_API_HOST?.trim();
      const apiPort = Number(process.env.SCAN_API_PORT ?? '9011');
      if (
        !host ||
        !apiHost ||
        !Number.isInteger(port) ||
        !Number.isInteger(apiPort)
      )
        throw new ScanProtocolError('SCANNER_UNAVAILABLE', true);
      session = await ClamSession.connect(
        host,
        port,
        Math.min(5_000, deadlineMs),
        deadlineMs,
      );
      startAttestation = await session.attest();
      startResource = await readResourceSnapshot(deadlineAt);
      startReady = startAttestation.ready && !!startResource;
      if (!startReady) {
        failureCode =
          startAttestation.engineVersion === 'ClamAV 1.4.6'
            ? 'SIGNATURES_STALE'
            : 'SIGNATURES_CHANGED';
        result = failureCode === 'SIGNATURES_STALE' ? 'RETRY' : 'SCAN_ERROR';
      } else {
        content = await requestScanContent(
          apiHost,
          apiPort,
          claim,
          token,
          deadlineMs,
          requestAbort.signal,
        );
        instreamStarted = true;
        const scanResult = await session.instream(
          content,
          claim.expectedSha256,
          claim.expectedSizeBytes,
          claim.profileLimitBytes,
          deadlineAt,
        );
        observedSha256 = scanResult.observedSha256;
        observedSizeBytes = scanResult.observedSizeBytes;
        result = scanResult.result;
        failureCode = scanResult.failureCode;
        instreamCompleted = true;
      }
    } catch (error) {
      if (instreamStarted && !instreamCompleted) session?.destroy();
      const abortReason = requestAbort.signal.reason;
      const effectiveError =
        requestAbort.signal.aborted && abortReason instanceof ScanProtocolError
          ? abortReason
          : error;
      if (effectiveError instanceof ScanProtocolError) {
        failureCode = effectiveError.code;
        result = effectiveError.retryable ? 'RETRY' : 'SCAN_ERROR';
      } else {
        failureCode = 'SCANNER_UNAVAILABLE';
        result = 'RETRY';
      }
    } finally {
      if (session && !session.isDestroyed() && instreamCompleted) {
        try {
          endAttestation = await session.attest(deadlineAt);
          const endResource = await readResourceSnapshot(deadlineAt);
          endReady =
            endAttestation.ready &&
            !!endResource &&
            !!startResource &&
            resourceSnapshotsMatch(startResource, endResource);
        } catch {
          endAttestation = null;
          endReady = false;
        }
      }
      if (session) {
        const scanResultNeedsOrderlyClose =
          result === 'CLEAN' || result === 'REJECTED';
        try {
          await session.close();
        } catch (error) {
          if (scanResultNeedsOrderlyClose) {
            const closeFailure = classifyClamSessionCloseFailure(error);
            result = closeFailure.result;
            failureCode = closeFailure.failureCode;
          }
        }
      }
      content?.destroy();
      if (timeout) clearTimeout(timeout);
      this.abortActive = undefined;
    }
    if (
      (result === 'CLEAN' || result === 'REJECTED') &&
      (!startAttestation ||
        !endAttestation ||
        !startReady ||
        !endReady ||
        !attestationMatches(startAttestation, endAttestation))
    ) {
      result = 'SCAN_ERROR';
      failureCode = 'SIGNATURES_CHANGED';
    }
    // A clean clamd reply does not attest complete analysis of nested content.
    // Until completeness is demonstrated for each accepted content class, no
    // filename, client MIME or source hash can safely authorize CLEAN.
    if (result === 'CLEAN') {
      this.log('scan.completeness_policy_denied');
      const gated = enforceScanCompleteness(result);
      result = gated.result;
      failureCode = gated.failureCode;
    }
    if (result === 'SCAN_ERROR' && !failureCode) failureCode = 'INTERNAL_ERROR';
    const durationMs = Math.max(
      0,
      Math.min(180_000, Math.floor(performance.now() - startedAt)),
    );
    return {
      result,
      failureCode,
      observedSha256,
      observedSizeBytes,
      startAttestation,
      endAttestation,
      durationMs,
      startReady,
      endReady,
    };
  }

  private async emitMetricsIfDue() {
    if (Date.now() - this.lastMetricsAt < 60_000) return;
    this.lastMetricsAt = Date.now();
    this.log('scan.metrics', { ...this.counters });
  }

  private log(event: string, fields: Record<string, unknown> = {}) {
    process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
  }
}
