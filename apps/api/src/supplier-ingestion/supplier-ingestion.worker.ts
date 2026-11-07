import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { DATABASE, PrismaDatabase } from '../database/database.module.js';
import { Prisma, type IngestionRun } from '../generated/prisma/client.js';
import {
  policy,
  SupplierExtractionClient,
} from './supplier-extraction.client.js';
import {
  ingestionAudit,
  terminalStates,
  type IngestionTx,
} from './supplier-ingestion.service.js';

const queue = 'stdu:ingestion:v1:ready';
const leaseMs = 30_000;

@Injectable()
export class SupplierIngestionWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private redis?: Redis;
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private readonly stop = new AbortController();

  constructor(
    @Inject(DATABASE) private readonly db: PrismaDatabase,
    @Inject(SupplierExtractionClient)
    private readonly client: SupplierExtractionClient,
  ) {}

  onApplicationBootstrap() {
    if (process.env.SUPPLIER_INGESTION_WORKER_ENABLED !== 'true') return;
    this.timer = setInterval(() => {
      if (this.active) return;
      this.active = this.tick()
        .catch(() => {
          if (!this.stop.signal.aborted)
            console.error('INGESTION_CYCLE_FAILED');
        })
        .finally(() => {
          this.active = undefined;
        });
    }, 1000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    this.stop.abort();
    this.redis?.disconnect();
    await this.active;
  }

  private connection() {
    if (!this.redis) {
      const url = process.env.REDIS_URL;
      if (!url) throw new Error('INGESTION_REDIS_REQUIRED');
      this.redis = new Redis(url, {
        connectTimeout: 1000,
        commandTimeout: 1500,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        retryStrategy: () => 500,
      });
      this.redis.on('error', () => {});
    }
    return this.redis;
  }

  async tick() {
    const redis = this.connection();
    if (redis.status !== 'ready') return;
    const due = await this.db.$queryRaw<{ id: string; runId: string }[]>`
      SELECT o.id,o.run_id AS "runId" FROM ingestion_outbox o
      JOIN ingestion_run r ON r.id=o.run_id
      WHERE o.next_dispatch_at<=clock_timestamp() AND
      ((r.state IN ('QUEUED','RETRY_WAIT') AND r.next_attempt_at<=clock_timestamp())
       OR (r.state='RUNNING' AND r.lease_until<=clock_timestamp()))
      ORDER BY o.next_dispatch_at,o.id LIMIT 16
    `;
    for (const item of due) {
      // A crash between publish and recording it can duplicate a wake-up.
      await redis
        .eval(
          "if redis.call('LLEN',KEYS[1])>=256 then return 0 end return redis.call('RPUSH',KEYS[1],ARGV[1])",
          1,
          queue,
          item.runId,
        )
        .then(async (count) => {
          if (!count) return;
          await this.db
            .$executeRaw`UPDATE ingestion_outbox SET dispatches=dispatches+1,
          next_dispatch_at=clock_timestamp()+interval '2 seconds' WHERE id=${item.id}::uuid`;
        });
    }
    for (let i = 0; i < 16 && !this.stop.signal.aborted; i++) {
      const id = await redis.lpop(queue);
      if (!id) break;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          id,
        )
      )
        continue;
      const run = await this.claim(id);
      if (run) await this.process(run);
    }
  }

  private async lockRun(tx: IngestionTx, id: string) {
    await tx.$queryRaw`SELECT id FROM ingestion_run WHERE id=${id}::uuid FOR UPDATE`;
    return tx.ingestionRun.findUnique({ where: { id } });
  }

  private async clock(tx: IngestionTx) {
    const [row] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    return row!.now;
  }

  private async sourceFailure(tx: IngestionTx, run: IngestionRun) {
    await tx.$queryRaw`SELECT id FROM ingestion_source WHERE id=${run.sourceId}::uuid FOR SHARE`;
    const source = await tx.ingestionSource.findUniqueOrThrow({
      where: { id: run.sourceId },
    });
    if (source.state !== 'ENABLED') return 'SOURCE_DISABLED';
    if (source.version !== run.sourceVersion) return 'SOURCE_CHANGED';
    await tx.$queryRaw`SELECT id FROM supplier WHERE id=${source.supplierId}::uuid FOR SHARE`;
    const supplier = await tx.supplier.findUniqueOrThrow({
      where: { id: source.supplierId },
      select: { state: true },
    });
    return supplier.state === 'ACTIVE' ? null : 'SUPPLIER_INACTIVE';
  }

  private async fail(tx: IngestionTx, run: IngestionRun, reason: string) {
    await tx.ingestionRun.update({
      where: { id: run.id },
      data: {
        state: 'FAILED',
        finishedAt: await this.clock(tx),
        leaseToken: null,
        leaseUntil: null,
        diagnosticCode: reason,
        version: { increment: 1 },
      },
    });
    await ingestionAudit(
      tx,
      'ingestion.run.failed',
      run.id,
      reason,
      { runId: run.id, attempts: run.attempts },
      undefined,
      'FAILURE',
    );
  }

  async claim(id: string): Promise<IngestionRun | null> {
    return this.db.$transaction(async (tx) => {
      const run = await this.lockRun(tx, id);
      if (!run || terminalStates.includes(run.state)) return null;
      const now = await this.clock(tx);
      if (
        run.state === 'RUNNING'
          ? run.leaseUntil! > now
          : run.nextAttemptAt > now
      )
        return null;
      const reason =
        (await this.sourceFailure(tx, run)) ??
        (run.attempts >= policy(run).maxAttempts ? 'ATTEMPTS_EXHAUSTED' : null);
      if (reason) {
        await this.fail(tx, run, reason);
        return null;
      }
      const started = await this.clock(tx);
      const claimed = await tx.ingestionRun.update({
        where: { id },
        data: {
          state: 'RUNNING',
          startedAt: run.startedAt ?? started,
          leaseToken: randomUUID(),
          leaseUntil: new Date(started.getTime() + leaseMs),
          attempts: { increment: 1 },
          diagnosticCode: null,
          version: { increment: 1 },
        },
      });
      await ingestionAudit(tx, 'ingestion.run.started', id, 'STARTED', {
        runId: id,
        attempts: claimed.attempts,
      });
      return claimed;
    });
  }

  async heartbeat(id: string, token: string) {
    return (
      (await this.db
        .$executeRaw`UPDATE ingestion_run SET lease_until=clock_timestamp()+interval '30 seconds'
      WHERE id=${id}::uuid AND state='RUNNING' AND lease_token=${token}::uuid AND lease_until>clock_timestamp()`) ===
      1
    );
  }

  private async live(tx: IngestionTx, claim: IngestionRun) {
    const run = await this.lockRun(tx, claim.id);
    return run?.state === 'RUNNING' &&
      claim.leaseToken &&
      run.leaseToken === claim.leaseToken &&
      run.leaseUntil! > (await this.clock(tx))
      ? run
      : null;
  }

  async process(claim: IngestionRun) {
    if (
      !claim.leaseToken ||
      !(await this.heartbeat(claim.id, claim.leaseToken))
    )
      return;
    const lost = new AbortController();
    let pending = false;
    const heartbeat = setInterval(() => {
      if (pending) return;
      pending = true;
      void this.heartbeat(claim.id, claim.leaseToken!)
        .then((ok) => {
          if (!ok) lost.abort();
        })
        .catch(() => lost.abort())
        .finally(() => {
          pending = false;
        });
    }, 5000);
    try {
      const extraction = await this.client.extract(
        claim,
        AbortSignal.any([this.stop.signal, lost.signal]),
      );
      const captured = await this.db.$transaction(async (tx) => {
        const run = await this.live(tx, claim);
        if (!run) return false;
        const reason = await this.sourceFailure(tx, run);
        if (reason) {
          await this.fail(tx, run, reason);
          return false;
        }
        if (run.leaseUntil! <= (await this.clock(tx))) return false;
        if (run.rawSnapshot === null) {
          await tx.ingestionRun.update({
            where: { id: run.id },
            data: {
              rawSnapshot: new Uint8Array(extraction.raw),
              sourceHash: extraction.hash,
            },
          });
          await ingestionAudit(
            tx,
            'ingestion.run.snapshot',
            run.id,
            'SNAPSHOT_CAPTURED',
            { runId: run.id },
          );
        } else if (run.sourceHash !== extraction.hash)
          throw new Error('INGESTION_PROVENANCE_INVALID');
        return true;
      });
      if (!captured) return;
      await this.db.$transaction(async (tx) => {
        const run = await this.live(tx, claim);
        if (!run) return;
        const reason = await this.sourceFailure(tx, run);
        if (reason) {
          await this.fail(tx, run, reason);
          return;
        }
        if (run.leaseUntil! <= (await this.clock(tx))) return;
        const errorCount = extraction.rows.filter(
          (row) => row.errorCode !== null,
        ).length;
        const processed = extraction.rows.length,
          candidateCount = processed - errorCount;
        const state = errorCount ? 'PARTIAL' : 'COMPLETE';
        if (processed)
          await tx.ingestionRow.createMany({
            data: extraction.rows.map((row) => ({
              ...row,
              normalized: row.normalized ?? Prisma.DbNull,
              runId: run.id,
              sourceHash: extraction.hash,
              reviewState: row.errorCode ? 'NOT_APPLICABLE' : 'PENDING',
            })),
          });
        await tx.ingestionRun.update({
          where: { id: run.id },
          data: {
            state,
            processed,
            candidateCount,
            errorCount,
            finishedAt: await this.clock(tx),
            leaseToken: null,
            leaseUntil: null,
            version: { increment: 1 },
          },
        });
        await ingestionAudit(tx, 'ingestion.run.completed', run.id, state, {
          runId: run.id,
          processed,
          candidateCount,
          errorCount,
        });
      });
    } catch {
      // Re-read durable state after any ambiguous write result, including COMMIT.
      // A committed terminal run or a superseding lease must never be modified.
      await this.db.$transaction(async (tx) => {
        const run = await this.live(tx, claim);
        if (!run) return;
        if (run.attempts >= policy(run).maxAttempts) {
          await this.fail(tx, run, 'EXTRACTION_FAILED');
          return;
        }
        const nextAttemptAt = new Date(
          (await this.clock(tx)).getTime() + 1000 * 2 ** (run.attempts - 1),
        );
        await tx.ingestionRun.update({
          where: { id: run.id },
          data: {
            state: 'RETRY_WAIT',
            nextAttemptAt,
            leaseToken: null,
            leaseUntil: null,
            diagnosticCode: 'EXTRACTION_FAILED',
            version: { increment: 1 },
          },
        });
        await tx.ingestionOutbox.update({
          where: { runId: run.id },
          data: { nextDispatchAt: nextAttemptAt },
        });
        await ingestionAudit(
          tx,
          'ingestion.run.retry',
          run.id,
          'EXTRACTION_FAILED',
          { runId: run.id, attempts: run.attempts },
          undefined,
          'FAILURE',
        );
      });
    } finally {
      clearInterval(heartbeat);
    }
  }
}
