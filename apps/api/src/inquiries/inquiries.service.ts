import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Transform } from 'node:stream';
import type { Redis } from 'ioredis';
import type { Readable } from 'node:stream';
import { Prisma } from '../generated/prisma/client.js';
import { createAuditEvent } from '../audit/audit.service.js';
import {
  DATABASE,
  PrismaDatabase,
  REDIS,
} from '../database/database.module.js';
import { StaffError } from '../identity/errors.js';
import { hmac, sha256 } from '../identity/crypto.js';
import { readConfig } from '../config.js';
import {
  PrivateFileStorage,
  PrivateStorageUnavailableError,
  type OwnedStorageWrite,
} from '../storage/private-file-storage.js';
import type { StaffRequest } from '../identity/request.js';
import {
  acquireAdminInvariantLock,
  assertCurrentActor,
  effectivePermissions,
  lockStaffUserRows,
} from '../permissions/policy.js';
import { resolveRateLimitSourceAddress } from '../identity/rate-limit.service.js';
import type { StorageByteRange } from '../storage/private-file-storage.js';
import type {
  AssignmentDto,
  CreateCommentDto,
  CreateInquiryDto,
  CreateUploadIntentDto,
  InquiryListQueryDto,
  PageQueryDto,
  StageDeadlineDto,
  TransitionDto,
} from './inquiries.dto.js';

type Tx = Prisma.TransactionClient;
type JsonObject = Prisma.InputJsonObject;
type SafeMutation = { status: number; body: Record<string, unknown> };
type SourceQuotaReservation = {
  ticketKey: string;
  scope: string;
  idempotencyKeyHash: Buffer;
  requestHash: Buffer;
  source: string;
  day: string;
};
type DurableSourceQuotaReservation = {
  ticketKey: string;
  scope: string;
  idempotencyKeyHash: string;
  requestHash: string;
  source: string;
  day: string;
};
type InquiryMutationSnapshot = {
  id: string;
  version: number;
  status: string;
  assignedManagerUserId: string | null;
  assignedEngineerUserId: string | null;
};

const PROFILE = {
  MVP_SAFE: {
    maxFile: 10 * 1024 * 1024,
    maxFiles: 5,
    maxInquiry: 25 * 1024 * 1024,
    sourceDay: 100 * 1024 * 1024,
    intentHour: 10,
    streamMinutes: 15,
  },
  ENGINEERING_DOCUMENTS: {
    maxFile: 50 * 1024 * 1024,
    maxFiles: 20,
    maxInquiry: 250 * 1024 * 1024,
    sourceDay: 1024 * 1024 * 1024,
    intentHour: 40,
    streamMinutes: 60,
  },
} as const;

const SOURCE_LIMIT_SCRIPT = `
local storedCap = redis.call('GET', KEYS[3])
local cap = tonumber(storedCap or ARGV[3])
if not storedCap then
  redis.call('SET', KEYS[3], cap, 'PX', ARGV[2], 'NX')
  cap = tonumber(redis.call('GET', KEYS[3]))
elseif tonumber(ARGV[3]) < cap then
  cap = tonumber(ARGV[3])
  redis.call('SET', KEYS[3], cap, 'PX', ARGV[2])
end
local existing = redis.call('GET', KEYS[5])
local bytes = tonumber(ARGV[4])
local used = tonumber(redis.call('GET', KEYS[2]) or '0')
if existing then
  local ok, record = pcall(cjson.decode, existing)
  if not ok or record.requestHash ~= ARGV[6] or record.source ~= ARGV[7]
    or record.day ~= ARGV[8] or record.scope ~= ARGV[9]
    or record.keyHash ~= ARGV[10] or tonumber(record.bytes) ~= bytes then
    return {-1, 0, 0}
  end
  return {0, 0, math.max(0, cap - used + bytes), 1}
end
local intents = redis.call('INCR', KEYS[1])
if intents == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if used + bytes > cap or intents > tonumber(ARGV[5]) then
  redis.call('DECR', KEYS[1])
  return {1, math.max(redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2])), 0}
end
redis.call('INCRBY', KEYS[2], bytes)
if used == 0 then redis.call('PEXPIRE', KEYS[2], ARGV[2]) end
redis.call('SET', KEYS[5], cjson.encode({
  state='PENDING',
  source=ARGV[7],
  day=ARGV[8],
  scope=ARGV[9],
  keyHash=ARGV[10],
  requestHash=ARGV[6],
  bytes=bytes,
  hourKey=KEYS[1],
  dayKey=KEYS[2],
  pendingSetKey=KEYS[4],
  createdAt=tonumber(ARGV[11])
}), 'PX', ARGV[2])
redis.call('SADD', KEYS[4], KEYS[5])
redis.call('PEXPIRE', KEYS[4], ARGV[2])
return {0, 0, math.max(0, cap - used)}
`;

const COMMIT_SOURCE_RESERVATION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, record = pcall(cjson.decode, raw)
if not ok then return -1 end
if record.state == 'PENDING' then
  record.state = 'COMMITTED'
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 1 then ttl = 1 end
  redis.call('SET', KEYS[1], cjson.encode(record), 'PX', ttl)
  redis.call('SREM', record.pendingSetKey, KEYS[1])
end
return 1
`;

const RELEASE_SOURCE_RESERVATION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, record = pcall(cjson.decode, raw)
if not ok then return -1 end
if record.state == 'PENDING' then
  if redis.call('EXISTS', record.hourKey) == 1 then
    local count = tonumber(redis.call('GET', record.hourKey) or '0')
    if count > 0 then redis.call('DECR', record.hourKey) end
  end
  if redis.call('EXISTS', record.dayKey) == 1 then
    local used = tonumber(redis.call('GET', record.dayKey) or '0')
    local bytes = tonumber(record.bytes)
    if used >= bytes then redis.call('DECRBY', record.dayKey, bytes)
    else redis.call('SET', record.dayKey, 0, 'KEEPTTL') end
  end
  redis.call('SREM', record.pendingSetKey, KEYS[1])
  redis.call('DEL', KEYS[1])
end
return 1
`;

const REMOVE_SOURCE_RESERVATION_FROM_SET_SCRIPT = `
return redis.call('SREM', KEYS[1], ARGV[1])
`;

const ACQUIRE_UPLOAD_KEY_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
local separator = string.find(current, ':', 1, true)
if separator and string.sub(current, 1, separator - 1) == ARGV[1] then
  return 2
end
return 0
`;

const MATCH_UPLOAD_KEY_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local separator = string.find(current, ':', 1, true)
if separator and string.sub(current, 1, separator - 1) == ARGV[1] then
  return 1
end
return 0
`;

const RELEASE_UPLOAD_KEY_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new StaffError('VALIDATION_ERROR');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  throw new StaffError('VALIDATION_ERROR');
}

function digest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}
function keyHash(value: string) {
  return sha256(value);
}
function lockId(scope: string, actor: string, key: string) {
  return createHash('sha256')
    .update(`${actor}\0R1-010\0${scope}\0${key}`, 'utf8')
    .digest()
    .readBigInt64BE(0);
}
function sourceQuotaLockId(source: string) {
  return lockId('public:upload-source-quota', source, 'source');
}
const INTERNAL_QUOTA_RECEIPT_KEY = '__stduInternal';
function publicCommandQuotaIdentity(
  reservation: SourceQuotaReservation | DurableSourceQuotaReservation,
) {
  return [
    reservation.ticketKey,
    reservation.scope,
    Buffer.isBuffer(reservation.idempotencyKeyHash)
      ? reservation.idempotencyKeyHash.toString('hex')
      : reservation.idempotencyKeyHash,
    Buffer.isBuffer(reservation.requestHash)
      ? reservation.requestHash.toString('hex')
      : reservation.requestHash,
    reservation.source,
    reservation.day,
  ].join('\0');
}
function persistPublicReceipt(
  body: Record<string, unknown>,
  reservation?: SourceQuotaReservation,
) {
  if (!reservation) return body;
  return {
    [INTERNAL_QUOTA_RECEIPT_KEY]: {
      kind: 'inquiry-source-quota-v1',
      reservation: {
        ticketKey: reservation.ticketKey,
        scope: reservation.scope,
        idempotencyKeyHash: reservation.idempotencyKeyHash.toString('hex'),
        requestHash: reservation.requestHash.toString('hex'),
        source: reservation.source,
        day: reservation.day,
      },
    },
    response: body,
  };
}
function readPersistedPublicReceipt(value: unknown): {
  body: Record<string, unknown>;
  quotaReservation?: DurableSourceQuotaReservation;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new StaffError('DEPENDENCY_UNAVAILABLE');
  const stored = value as Record<string, unknown>;
  const internal = stored[INTERNAL_QUOTA_RECEIPT_KEY];
  if (internal === undefined) return { body: stored };
  if (
    !internal ||
    typeof internal !== 'object' ||
    Array.isArray(internal) ||
    (internal as Record<string, unknown>).kind !== 'inquiry-source-quota-v1' ||
    !stored.response ||
    typeof stored.response !== 'object' ||
    Array.isArray(stored.response)
  )
    throw new StaffError('DEPENDENCY_UNAVAILABLE');
  const reservation = (internal as Record<string, unknown>).reservation as
    Record<string, unknown> | undefined;
  if (
    !reservation ||
    typeof reservation.ticketKey !== 'string' ||
    !/^stdu:inquiry:quota-reservation:[a-f0-9]{64}$/.test(
      reservation.ticketKey,
    ) ||
    typeof reservation.scope !== 'string' ||
    typeof reservation.idempotencyKeyHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(reservation.idempotencyKeyHash) ||
    typeof reservation.requestHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(reservation.requestHash) ||
    typeof reservation.source !== 'string' ||
    !/^[a-f0-9]{64}$/.test(reservation.source) ||
    typeof reservation.day !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(reservation.day)
  )
    throw new StaffError('DEPENDENCY_UNAVAILABLE');
  return {
    body: stored.response as Record<string, unknown>,
    quotaReservation: reservation as DurableSourceQuotaReservation,
  };
}
function asJson(value: unknown): JsonObject {
  return value as JsonObject;
}
function publicSource(request: StaffRequest) {
  const config = readConfig(process.env);
  const source = resolveRateLimitSourceAddress(request, config);
  return hmac(config.rateLimitKey, `inquiry-source:v1:\0${source}`).toString(
    'hex',
  );
}

function requireKey(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._~-]+$/.test(value)
  )
    throw new StaffError('VALIDATION_ERROR', [
      { field: 'Idempotency-Key', code: 'INVALID' },
    ]);
  return value;
}

function requireOrigin(request: StaffRequest) {
  const config = readConfig(process.env);
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !config.allowedOrigins.includes(origin))
    throw new StaffError('ORIGIN_FORBIDDEN');
}

function errorReceipt(error: StaffError, requestId: string) {
  return { code: error.code, message: error.message, requestId };
}

function publicReceipt(reference: string, createdAt: Date, requestId: string) {
  return {
    data: {
      publicReference: reference,
      createdAt: createdAt.toISOString(),
      message: 'Your inquiry has been received.',
    },
    meta: { requestId },
  };
}

function opaqueReference() {
  return `inq-${randomBytes(12).toString('hex')}`;
}

function profileFor(code: string) {
  const profile = PROFILE[code as keyof typeof PROFILE];
  if (!profile) throw new StaffError('DEPENDENCY_UNAVAILABLE');
  return profile;
}

function contactJson(contact: CreateInquiryDto['contact']): JsonObject {
  const result: Record<string, unknown> = {};
  for (const key of [
    'contactName',
    'email',
    'phone',
    'organization',
    'taxIdentifier',
    'preferredChannel',
    'region',
    'desiredDeadline',
    'customerComment',
  ] as const) {
    const value = contact[key];
    if (value !== undefined) result[key] = value;
  }
  if (result.preferredChannel === 'EMAIL' && !result.email)
    throw new StaffError('VALIDATION_ERROR');
  if (result.preferredChannel === 'PHONE' && !result.phone)
    throw new StaffError('VALIDATION_ERROR');
  return asJson(result);
}

function detailsJson(input: CreateInquiryDto): JsonObject {
  if (input.kind === 'EQUIPMENT') return asJson({ type: 'EQUIPMENT' });
  const details = input.kind === 'PANELS' ? input.panels : input.engineering;
  return asJson({
    ...(details as unknown as Record<string, unknown>),
    type: input.kind,
  });
}

function validCapability(value: string | undefined | null) {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const raw = Buffer.from(value, 'base64url');
  return raw.length === 32 && raw.toString('base64url') === value
    ? sha256(raw)
    : null;
}

function summary(row: {
  id: string;
  publicReference: string;
  channel: string;
  kind: string;
  status: string;
  stageDueAt: Date | null;
  version: number;
  createdAt: Date;
  assignedManagerUserId: string | null;
  assignedEngineerUserId: string | null;
}) {
  return {
    id: row.id,
    publicReference: row.publicReference,
    channel: row.channel,
    kind: row.kind,
    status: row.status,
    stageDueAt: row.stageDueAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    assignedManagerUserId: row.assignedManagerUserId,
    assignedEngineerUserId: row.assignedEngineerUserId,
  };
}

const NEXT: Record<string, Record<string, string>> = {
  NEW: { TRIAGE: 'TRIAGE_STARTED' },
  TRIAGE: {
    NEEDS_CLARIFICATION: 'MORE_INFORMATION_REQUIRED',
    ENGINEERING_REVIEW: 'ENGINEERING_STARTED',
  },
  NEEDS_CLARIFICATION: {
    TRIAGE: 'INFORMATION_RECEIVED',
    ENGINEERING_REVIEW: 'ENGINEERING_STARTED',
  },
  ENGINEERING_REVIEW: {
    NEEDS_CLARIFICATION: 'RETURN_TO_CLARIFICATION',
    READY_FOR_QUOTE: 'ENGINEERING_COMPLETE',
  },
  READY_FOR_QUOTE: { NEEDS_CLARIFICATION: 'RETURN_TO_CLARIFICATION' },
};
const CLOSURE_REASONS = new Set([
  'DUPLICATE',
  'CUSTOMER_WITHDRAWN',
  'OUT_OF_SCOPE',
  'SPAM',
  'NOT_FEASIBLE',
]);

@Injectable()
export class InquiriesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InquiriesService.name);
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: PrismaDatabase,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PrivateFileStorage) private readonly storage: PrivateFileStorage,
  ) {}

  private activeStreamCount = 0;
  private readonly activeBySource = new Map<string, number>();

  onModuleInit() {
    this.cleanupTimer = setInterval(
      () => {
        void this.runBoundedCleanup().catch(() => {
          this.logger.warn('Inquiry bounded cleanup failed.');
        });
      },
      6 * 60 * 60_000,
    );
    this.cleanupTimer.unref();
    void this.runBoundedCleanup().catch(() => {
      this.logger.warn('Inquiry bounded cleanup failed.');
    });
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  private async cleanupStaleQuarantineObjects() {
    await this.storage.cleanupStaleInquiryTemporaryFiles();
    const candidates = await this.storage.listStaleInquiryObjects();
    if (candidates.length === 0) return;
    const referenced = new Set(
      (
        await this.db.inquirySourceDocument.findMany({
          where: { storageKey: { in: candidates } },
          select: { storageKey: true },
        })
      ).map(({ storageKey }) => storageKey),
    );
    for (const key of candidates)
      if (!referenced.has(key))
        await this.storage.removeInquiryQuarantineObject(key);
  }

  private async cleanupExpiredCommandRecords() {
    await this.db.$executeRaw`
      DELETE FROM inquiry_command_idempotency
      WHERE id IN (
        SELECT id
        FROM inquiry_command_idempotency
        WHERE expires_at <= clock_timestamp()
        ORDER BY expires_at, id
        LIMIT 500
      )`;
  }

  private async runBoundedCleanup() {
    await this.cleanupExpiredCommandRecords();
    await this.cleanupInquiryIntents();
    await this.cleanupStaleQuarantineObjects();
  }

  private async acquireUploadIdempotencyLock(
    intentId: string,
    hashedKey: Buffer,
  ) {
    const redisKey = `stdu:inquiry:upload-command:${intentId}`;
    const keyHashHex = hashedKey.toString('hex');
    const ownerValue = `${keyHashHex}:${randomUUID()}`;
    let result: number;
    try {
      result = Number(
        await this.redis.eval(
          ACQUIRE_UPLOAD_KEY_SCRIPT,
          1,
          redisKey,
          keyHashHex,
          ownerValue,
          61 * 60_000,
        ),
      );
    } catch {
      this.logger.error('Redis upload idempotency lock failed.');
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    }
    if (result === 0) throw new StaffError('INVALID_STATE_TRANSITION');
    return { redisKey, ownerValue: result === 1 ? ownerValue : null };
  }

  private async hasUploadIdempotencyLock(intentId: string, hashedKey: Buffer) {
    try {
      return (
        Number(
          await this.redis.eval(
            MATCH_UPLOAD_KEY_SCRIPT,
            1,
            `stdu:inquiry:upload-command:${intentId}`,
            hashedKey.toString('hex'),
          ),
        ) === 1
      );
    } catch {
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    }
  }

  private async releaseUploadIdempotencyLock(
    lock: { redisKey: string; ownerValue: string } | null,
    requestId: string,
  ) {
    if (!lock) return;
    try {
      await this.redis.eval(
        RELEASE_UPLOAD_KEY_SCRIPT,
        1,
        lock.redisKey,
        lock.ownerValue,
      );
    } catch {
      this.logger.warn(
        `Inquiry upload idempotency lock release failed requestId=${requestId}.`,
      );
    }
  }

  private async cleanupInquiryIntents() {
    for (let batch = 0; batch < 10; batch++) {
      const changed = await this.db.$transaction(
        async (tx) => {
          const candidates = await tx.$queryRaw<
            { id: string; previousState: string; version: number }[]
          >`
          SELECT id::text, state AS "previousState", version
          FROM inquiry_upload_intent
          WHERE (state='ISSUED' AND expires_at <= clock_timestamp())
             OR (state='RECEIVING' AND receiving_deadline_at <= clock_timestamp())
          ORDER BY COALESCE(receiving_deadline_at, expires_at), id
          LIMIT 100
          FOR UPDATE SKIP LOCKED`;
          for (const candidate of candidates) {
            const state =
              candidate.previousState === 'ISSUED' ? 'EXPIRED' : 'FAILED';
            const updated = await tx.inquiryUploadIntent.update({
              where: { id: candidate.id },
              data: { state, version: { increment: 1 } },
            });
            await createAuditEvent(tx, {
              actorKind: 'ANONYMOUS',
              action: 'inquiry.upload.rejected',
              entityType: 'InquiryUploadIntent',
              entityId: candidate.id,
              outcome: 'DENIED',
              reasonCode: 'VALIDATION_ERROR',
              requestId: randomUUID(),
              changes: {
                previousState: candidate.previousState,
                state,
                version: updated.version,
              },
            });
          }
          return candidates.length;
        },
        { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 },
      );
      if (changed < 100) break;
    }
    for (let batch = 0; batch < 10; batch++) {
      const deleted = await this.db.$executeRaw`
        DELETE FROM inquiry_upload_intent
        WHERE id IN (
          SELECT intent.id
          FROM inquiry_upload_intent intent
          WHERE intent.state IN ('EXPIRED','CANCELLED','REJECTED','FAILED')
            AND intent.expires_at <= clock_timestamp() - interval '30 days'
            AND NOT EXISTS (
              SELECT 1 FROM inquiry_source_document document
              WHERE document.upload_intent_id = intent.id
            )
          ORDER BY intent.expires_at, intent.id
          LIMIT 100
        )`;
      if (deleted < 100) break;
    }
  }

  private async resolveInquiryIdByUploadCapability(
    tx: Tx,
    capabilityHash: Buffer,
  ) {
    const matches = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text
      FROM inquiry
      WHERE upload_capability_hash=${new Uint8Array(capabilityHash)}
        AND upload_capability_expires_at > clock_timestamp()
      LIMIT 1
    `;
    if (matches.length !== 1) throw new StaffError('FILE_NOT_ACCESSIBLE');
    return matches[0]!.id;
  }

  private async lockInquiryByUploadCapability(
    tx: Tx,
    inquiryId: string,
    capabilityHash: Buffer,
  ) {
    const matches = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text
      FROM inquiry
      WHERE id=${inquiryId}::uuid
        AND upload_capability_hash=${new Uint8Array(capabilityHash)}
        AND upload_capability_expires_at > clock_timestamp()
      FOR UPDATE
    `;
    if (matches.length !== 1) throw new StaffError('FILE_NOT_ACCESSIBLE');
    const inquiry = await tx.inquiry.findUniqueOrThrow({
      where: { id: inquiryId },
    });
    this.assertCapability(
      inquiry.uploadCapabilityHash,
      inquiry.uploadCapabilityExpiresAt,
      capabilityHash,
    );
    return inquiry;
  }

  private async checkSourceBudget(
    source: string,
    profileCode: string,
    bytes: number,
    scope: string,
    idempotencyKeyHash: Buffer,
    requestHash: Buffer,
    day: string,
  ): Promise<{ remaining: number; reservation: SourceQuotaReservation }> {
    const profile = profileFor(profileCode);
    await this.reconcileSourceQuotaReservations(source, day);
    const hour = Math.floor(Date.now() / 3_600_000);
    const keyHashHex = idempotencyKeyHash.toString('hex');
    const requestHashHex = requestHash.toString('hex');
    const ticketId = createHash('sha256')
      .update(`${source}\n${day}\n${scope}\n${keyHashHex}`)
      .digest('hex');
    const reservation: SourceQuotaReservation = {
      ticketKey: `stdu:inquiry:quota-reservation:${ticketId}`,
      scope,
      idempotencyKeyHash,
      requestHash,
      source,
      day,
    };
    let result: [number, number, number, number?];
    try {
      result = (await this.redis.eval(
        SOURCE_LIMIT_SCRIPT,
        5,
        `stdu:inquiry:intent-hour:${source}:${hour}`,
        `stdu:inquiry:bytes-day:${source}:${day}`,
        `stdu:inquiry:cap-day:${source}:${day}`,
        `stdu:inquiry:quota-pending:${source}:${day}`,
        reservation.ticketKey,
        3_600_000,
        86_400_000,
        profile.sourceDay,
        bytes,
        profile.intentHour,
        requestHashHex,
        source,
        day,
        scope,
        keyHashHex,
        Date.now(),
      )) as [number, number, number, number?];
    } catch {
      this.logger.error('Redis source quota reservation failed.');
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    }
    if (result[0] === -1) throw new StaffError('IDEMPOTENCY_KEY_REUSED');
    if (result[0] === 1)
      throw new StaffError(
        'RATE_LIMITED',
        undefined,
        Math.max(1, Math.ceil(result[1] / 1000)),
      );
    return { remaining: Math.max(0, result[2] ?? 0), reservation };
  }

  private async sourceQuotaUtcDay(tx: Tx) {
    const rows = await tx.$queryRaw<{ day: string }[]>`
      SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
    `;
    const day = rows[0]?.day;
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day))
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    return day;
  }

  private async reconcileSourceQuotaReservations(source: string, day: string) {
    const pendingSetKey = `stdu:inquiry:quota-pending:${source}:${day}`;
    let tickets: string[];
    let records: (string | null)[];
    try {
      tickets = await this.redis.smembers(pendingSetKey);
      if (!tickets.length) return;
      records = await this.redis.mget(...tickets);
    } catch {
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    }

    const stale: {
      ticketKey: string;
      scope: string;
      keyHash: string;
      requestHash: string;
      source: string;
      day: string;
    }[] = [];
    const now = Date.now();
    for (let index = 0; index < tickets.length; index++) {
      const ticketKey = tickets[index];
      const raw = records[index];
      if (typeof ticketKey !== 'string')
        throw new StaffError('DEPENDENCY_UNAVAILABLE');
      if (raw == null) {
        try {
          await this.redis.eval(
            REMOVE_SOURCE_RESERVATION_FROM_SET_SCRIPT,
            1,
            pendingSetKey,
            ticketKey,
          );
        } catch {
          throw new StaffError('DEPENDENCY_UNAVAILABLE');
        }
        continue;
      }
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new StaffError('DEPENDENCY_UNAVAILABLE');
      }
      if (record.state !== 'PENDING') {
        try {
          await this.redis.eval(
            REMOVE_SOURCE_RESERVATION_FROM_SET_SCRIPT,
            1,
            pendingSetKey,
            ticketKey,
          );
        } catch {
          throw new StaffError('DEPENDENCY_UNAVAILABLE');
        }
        continue;
      }
      if (
        record.source !== source ||
        record.day !== day ||
        typeof record.createdAt !== 'number' ||
        typeof record.scope !== 'string' ||
        typeof record.keyHash !== 'string' ||
        typeof record.requestHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(record.keyHash) ||
        !/^[a-f0-9]{64}$/.test(record.requestHash)
      )
        throw new StaffError('DEPENDENCY_UNAVAILABLE');
      if (now - record.createdAt >= 30_000)
        stale.push({
          ticketKey,
          scope: record.scope,
          keyHash: record.keyHash,
          requestHash: record.requestHash,
          source,
          day,
        });
    }
    if (!stale.length) return;

    let durable: {
      operationScope: string;
      idempotencyKeyHash: Uint8Array;
      requestHash: Uint8Array;
      responseReceipt: unknown;
    }[];
    try {
      durable = await this.db.inquiryCommandIdempotency.findMany({
        where: {
          actorKind: 'PUBLIC',
          expiresAt: { gt: new Date() },
          OR: stale.map((record) => ({
            operationScope: record.scope,
            idempotencyKeyHash: new Uint8Array(
              Buffer.from(record.keyHash, 'hex'),
            ),
            requestHash: new Uint8Array(Buffer.from(record.requestHash, 'hex')),
          })),
        },
        select: {
          operationScope: true,
          idempotencyKeyHash: true,
          requestHash: true,
          responseReceipt: true,
        },
      });
    } catch {
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    }
    const durableReservations = new Set<string>();
    for (const record of durable) {
      const reservation = readPersistedPublicReceipt(
        record.responseReceipt,
      ).quotaReservation;
      if (!reservation) continue;
      durableReservations.add(publicCommandQuotaIdentity(reservation));
    }
    for (const record of stale) {
      const reservation: SourceQuotaReservation = {
        ticketKey: record.ticketKey,
        scope: record.scope,
        idempotencyKeyHash: Buffer.from(record.keyHash, 'hex'),
        requestHash: Buffer.from(record.requestHash, 'hex'),
        source: record.source,
        day: record.day,
      };
      try {
        await this.finishSourceQuotaReservation(
          reservation,
          durableReservations.has(publicCommandQuotaIdentity(reservation)),
        );
      } catch {
        throw new StaffError('DEPENDENCY_UNAVAILABLE');
      }
    }
  }

  private async finishSourceQuotaReservation(
    reservation: SourceQuotaReservation,
    committed: boolean,
  ) {
    const script = committed
      ? COMMIT_SOURCE_RESERVATION_SCRIPT
      : RELEASE_SOURCE_RESERVATION_SCRIPT;
    try {
      const result = await this.redis.eval(script, 1, reservation.ticketKey);
      if (Number(result) < 0)
        throw new Error('Redis quota reservation record is malformed.');
      if (committed && Number(result) === 0)
        throw new Error('Committed inquiry quota ticket is missing.');
    } catch (error) {
      this.logger.error(
        committed
          ? 'Inquiry source quota commit requires reconciliation.'
          : 'Inquiry source quota release requires reconciliation.',
      );
      throw error;
    }
  }

  private async settleSourceQuotaAfterTransactionFailure(
    reservation: SourceQuotaReservation,
  ) {
    try {
      await this.db.$transaction(
        async (tx) => {
          const quotaLock = sourceQuotaLockId(reservation.source);
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(${quotaLock})::text AS "lockAcquired"`;
          const durable = await tx.inquiryCommandIdempotency.findFirst({
            where: {
              actorKind: 'PUBLIC',
              operationScope: reservation.scope,
              idempotencyKeyHash: new Uint8Array(
                reservation.idempotencyKeyHash,
              ),
            },
            select: { requestHash: true, responseReceipt: true },
          });
          const durableQuotaReservation = durable
            ? readPersistedPublicReceipt(durable.responseReceipt)
                .quotaReservation
            : undefined;
          const committed =
            durable &&
            Buffer.from(durable.requestHash).equals(reservation.requestHash) &&
            durableQuotaReservation &&
            publicCommandQuotaIdentity(durableQuotaReservation) ===
              publicCommandQuotaIdentity(reservation);
          await this.finishSourceQuotaReservation(
            reservation,
            Boolean(committed),
          );
        },
        { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 },
      );
    } catch {
      this.logger.error(
        'Could not reconcile an inquiry quota reservation after transaction failure; it remains pending for the next request.',
      );
    }
  }

  async createPublic(
    request: StaffRequest,
    keyValue: unknown,
    input: CreateInquiryDto,
  ) {
    const config = readConfig(process.env);
    if (!config.inquiryPublicEnabled)
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    requireOrigin(request);
    const key = requireKey(keyValue);
    if (input.privacyNotice != null)
      throw new StaffError('VALIDATION_ERROR', [
        { field: 'privacyNotice', code: 'LEGAL_REVIEW_REQUIRED' },
      ]);
    this.assertKindShape(input);
    const source = publicSource(request);
    const capHash = input.uploadCapability
      ? validCapability(input.uploadCapability)
      : null;
    if (input.uploadCapability && !capHash)
      throw new StaffError('VALIDATION_ERROR');
    const canonicalPayload = {
      kind: input.kind,
      contact: input.contact,
      catalogProductContext: input.catalogProductContext ?? null,
      uploadCapabilityHash: capHash?.toString('hex') ?? null,
      equipmentLines: input.equipmentLines ?? null,
      panels: input.panels ?? null,
      engineering: input.engineering ?? null,
    };
    const requestHash = digest(
      canonical({
        operationId: 'createPublicInquiry',
        method: 'POST',
        path: '/v1/public/inquiries',
        payload: canonicalPayload,
      }),
    );
    const hashedKey = keyHash(key);
    const advisory = lockId('public:create', 'anonymous', key);
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${advisory})::text AS "lockAcquired"`;
        const existing = await tx.$queryRaw<
          {
            id: string;
            requestHash: Uint8Array;
            httpStatus: number;
            responseReceipt: unknown;
            expiresAt: Date;
          }[]
        >`
        SELECT id::text, request_hash AS "requestHash", http_status AS "httpStatus", response_receipt AS "responseReceipt", expires_at AS "expiresAt"
        FROM inquiry_command_idempotency
        WHERE actor_kind='PUBLIC' AND actor_staff_user_id IS NULL AND operation_scope='public:create'
          AND idempotency_key_hash=${hashedKey} AND expires_at > clock_timestamp()
        LIMIT 1
      `;
        const prior = existing[0];
        if (prior) {
          if (!Buffer.from(prior.requestHash).equals(requestHash))
            throw new StaffError('IDEMPOTENCY_KEY_REUSED');
          return {
            status: prior.httpStatus,
            body: prior.responseReceipt as Record<string, unknown>,
          };
        }
        await this.consumePublicCreateLimit(source);
        await tx.$executeRaw`DELETE FROM inquiry_command_idempotency WHERE actor_kind='PUBLIC' AND operation_scope='public:create' AND idempotency_key_hash=${hashedKey} AND expires_at <= clock_timestamp()`;
        const id = randomUUID();
        const createdAt =
          (
            await tx.$queryRaw<
              { now: Date }[]
            >`SELECT transaction_timestamp() AS now`
          )[0]?.now ?? new Date();
        const reference = opaqueReference();
        const profileCode = config.inquiryUploadProfile;
        const capabilityExpiresAt = capHash
          ? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)
          : null;
        await tx.inquiry.create({
          data: {
            id,
            publicReference: reference,
            channel: 'PUBLIC_WEB',
            kind: input.kind,
            status: 'NEW',
            contactSnapshot: contactJson(input.contact),
            catalogProductContext: input.catalogProductContext ?? null,
            kindDetails: detailsJson(input),
            uploadProfileCode: profileCode,
            uploadCapabilityHash: capHash ? new Uint8Array(capHash) : null,
            uploadCapabilityExpiresAt: capabilityExpiresAt,
          },
        });
        if (input.kind === 'EQUIPMENT') {
          await tx.inquiryLine.createMany({
            data: (input.equipmentLines ?? []).map((line, index) => ({
              id: randomUUID(),
              inquiryId: id,
              sequence: index + 1,
              rawTitle: line.rawTitle,
              originalSku: line.originalSku ?? null,
              manufacturerName: line.manufacturerName ?? null,
              modification: line.modification ?? null,
              quantityText: line.quantity,
              unitText: line.unit,
              notes: line.notes ?? null,
              catalogProductSlugContext: line.catalogProductSlugContext ?? null,
            })),
          });
        }
        await createAuditEvent(tx, {
          actorKind: 'ANONYMOUS',
          action: 'inquiry.created',
          entityType: 'Inquiry',
          entityId: id,
          outcome: 'SUCCESS',
          reasonCode: 'PUBLIC_SUBMISSION_ACCEPTED',
          requestId: request.requestId,
          sourceHash: Buffer.from(source, 'hex'),
        });
        const body = publicReceipt(reference, createdAt, request.requestId);
        await tx.inquiryCommandIdempotency.create({
          data: {
            id: randomUUID(),
            actorKind: 'PUBLIC',
            actorStaffUserId: null,
            operationScope: 'public:create',
            idempotencyKeyHash: new Uint8Array(hashedKey),
            requestHash: new Uint8Array(requestHash),
            httpStatus: 201,
            responseReceipt: asJson(body),
            expiresAt: new Date(createdAt.getTime() + 30 * 86400_000),
          },
        });
        return { status: 201, body };
      },
      { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 },
    );
  }

  private async consumePublicCreateLimit(source: string) {
    let result: [number, number];
    try {
      result = (await this.redis.eval(
        `
      local a=redis.call('INCR',KEYS[1]); if a==1 then redis.call('PEXPIRE',KEYS[1],900000) end
      local b=redis.call('INCR',KEYS[2]); if b==1 then redis.call('PEXPIRE',KEYS[2],86400000) end
      if a>5 or b>20 then redis.call('DECR',KEYS[1]); redis.call('DECR',KEYS[2]); return {1,math.max(redis.call('PTTL',KEYS[1]),redis.call('PTTL',KEYS[2]))} end
      return {0,0}`,
        2,
        `stdu:inquiry:create-15m:${source}:${Math.floor(Date.now() / 900000)}`,
        `stdu:inquiry:create-day:${source}:${new Date().toISOString().slice(0, 10)}`,
      )) as [number, number];
    } catch {
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    }
    if (result[0] === 1)
      throw new StaffError(
        'RATE_LIMITED',
        undefined,
        Math.max(1, Math.ceil(result[1] / 1000)),
      );
  }

  async list(request: StaffRequest, query: InquiryListQueryDto) {
    const actor = this.actor(request);
    return this.db.$transaction(async (tx) => {
      const permissions = await assertCurrentActor(
        tx,
        {
          id: actor.id,
          sessionId: actor.sessionId,
          authVersion: actor.authVersion,
        },
        null,
      );
      const canReadAll = permissions.includes('inquiries.read_all');
      if (!canReadAll && !permissions.includes('inquiries.read_assigned'))
        throw new StaffError('FORBIDDEN');
      const assigned = query.assignee ?? (canReadAll ? 'ALL' : 'ME');
      if (assigned !== 'ME' && !canReadAll) throw new StaffError('FORBIDDEN');
      const take = query.limit ?? 50;
      const fingerprint = digest(
        canonical({
          status: query.status ?? null,
          kind: query.kind ?? null,
          assigned,
          actor: canReadAll ? null : actor.id,
        }),
      ).toString('base64url');
      const cursor = this.decodeCursor(query.cursor, fingerprint);
      const conditions: Prisma.InquiryWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(assigned === 'ME'
          ? {
              OR: [
                { assignedManagerUserId: actor.id },
                { assignedEngineerUserId: actor.id },
              ],
            }
          : {}),
        ...(assigned === 'UNASSIGNED'
          ? { assignedManagerUserId: null, assignedEngineerUserId: null }
          : {}),
        ...(cursor ? { id: { gt: cursor.id } } : {}),
      };
      const rows = await tx.inquiry.findMany({
        where: conditions,
        orderBy: { id: 'asc' },
        take: take + 1,
      });
      const hasMore = rows.length > take;
      const page = rows.slice(0, take);
      return {
        data: page.map(summary),
        meta: {
          nextCursor: hasMore
            ? this.encodeCursor({ v: 1, fingerprint, id: page.at(-1)!.id })
            : null,
          requestId: request.requestId,
        },
      };
    });
  }

  async createUploadIntent(
    request: StaffRequest,
    keyValue: unknown,
    capability: unknown,
    input: CreateUploadIntentDto,
  ) {
    const config = readConfig(process.env);
    if (!config.inquiryPublicEnabled)
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    requireOrigin(request);
    const key = requireKey(keyValue);
    const capabilityHash = this.requireCapability(capability);
    const source = publicSource(request);
    const filename = this.safeFilename(input.filename);
    const extensionMime = this.mimeForExtension(filename);
    if (
      !extensionMime ||
      !this.allowedDeclaredMime(extensionMime, input.declaredMimeType)
    )
      throw new StaffError('FILE_REJECTED');
    const kh = keyHash(key);
    const payload = {
      filename,
      declaredMimeType: input.declaredMimeType.toLowerCase(),
      sizeBytes: input.sizeBytes,
      expectedSha256: input.expectedSha256?.toLowerCase() ?? null,
    };
    const requestHash = digest(
      canonical({
        operationId: 'createInquiryUploadIntent',
        method: 'POST',
        path: request.path,
        payload,
      }),
    );
    let quotaReservation: SourceQuotaReservation | undefined;
    let result: { status: number; body: Record<string, unknown> };
    try {
      result = await this.db.$transaction(
        async (tx) => {
          const inquiryId = await this.resolveInquiryIdByUploadCapability(
            tx,
            capabilityHash,
          );
          const scope = `public:upload-intent:${inquiryId}`;
          const advisory = lockId(scope, 'anonymous', key);
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(${advisory})::text AS "lockAcquired"`;
          const inquiry = await this.lockInquiryByUploadCapability(
            tx,
            inquiryId,
            capabilityHash,
          );
          const found = await this.findPublicCommand(tx, scope, kh);
          if (found) {
            if (!Buffer.from(found.requestHash).equals(requestHash))
              throw new StaffError('IDEMPOTENCY_KEY_REUSED');
            return {
              status: found.httpStatus,
              body: found.responseReceipt as Record<string, unknown>,
            };
          }
          const quotaLock = sourceQuotaLockId(source);
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(${quotaLock})::text AS "lockAcquired"`;
          const quotaDay = await this.sourceQuotaUtcDay(tx);
          const profile = profileFor(inquiry.uploadProfileCode);
          if (input.sizeBytes > profile.maxFile)
            throw new StaffError('FILE_TOO_LARGE');
          const [docs, intents] = await Promise.all([
            tx.inquirySourceDocument.aggregate({
              where: { inquiryId },
              _count: { _all: true },
              _sum: { sizeBytes: true },
            }),
            tx.inquiryUploadIntent.aggregate({
              where: {
                inquiryId,
                OR: [
                  { state: 'ISSUED', expiresAt: { gt: new Date() } },
                  {
                    state: 'RECEIVING',
                    receivingDeadlineAt: { gt: new Date() },
                  },
                ],
              },
              _count: { _all: true },
              _sum: { declaredSizeBytes: true },
            }),
          ]);
          if (
            docs._count._all + intents._count._all >= profile.maxFiles ||
            Number(docs._sum.sizeBytes ?? 0n) +
              Number(intents._sum.declaredSizeBytes ?? 0n) +
              input.sizeBytes >
              profile.maxInquiry
          )
            throw new StaffError('IMPORT_LIMIT_EXCEEDED');
          const sourceBudget = await this.checkSourceBudget(
            source,
            inquiry.uploadProfileCode,
            input.sizeBytes,
            scope,
            kh,
            requestHash,
            quotaDay,
          );
          quotaReservation = sourceBudget.reservation;
          const remainingInquiryBytes = Math.max(
            0,
            profile.maxInquiry -
              Number(docs._sum.sizeBytes ?? 0n) -
              Number(intents._sum.declaredSizeBytes ?? 0n),
          );
          const maxBytes = Math.min(
            input.sizeBytes,
            profile.maxFile,
            remainingInquiryBytes,
            sourceBudget.remaining,
          );
          if (input.sizeBytes > maxBytes)
            throw new StaffError('IMPORT_LIMIT_EXCEEDED');
          const expiresAt = new Date(Date.now() + 30 * 60_000);
          const intentId = randomUUID();
          await tx.inquiryUploadIntent.create({
            data: {
              id: intentId,
              inquiryId,
              state: 'ISSUED',
              safeFilename: filename,
              declaredMimeType: input.declaredMimeType.toLowerCase(),
              declaredSizeBytes: BigInt(input.sizeBytes),
              expectedSha256: input.expectedSha256
                ? new Uint8Array(Buffer.from(input.expectedSha256, 'hex'))
                : null,
              expiresAt,
            },
          });
          await createAuditEvent(tx, {
            actorKind: 'ANONYMOUS',
            action: 'inquiry.upload_intent.created',
            entityType: 'InquiryUploadIntent',
            entityId: intentId,
            outcome: 'SUCCESS',
            reasonCode: 'UPLOAD_INTENT_CREATED',
            requestId: request.requestId,
            sourceHash: Buffer.from(source, 'hex'),
            changes: { changedFields: ['state'], version: 1 },
          });
          const body = {
            data: {
              intentId,
              expiresAt: expiresAt.toISOString(),
              maxBytes,
            },
            meta: { requestId: request.requestId },
          };
          await this.persistPublicCommand(
            tx,
            scope,
            kh,
            requestHash,
            201,
            body,
            quotaReservation,
          );
          return { status: 201, body };
        },
        { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 },
      );
    } catch (error) {
      if (quotaReservation)
        await this.settleSourceQuotaAfterTransactionFailure(quotaReservation);
      throw error;
    }
    if (quotaReservation) {
      try {
        await this.finishSourceQuotaReservation(quotaReservation, true);
      } catch {
        this.logger.error(
          'The upload intent committed, but its Redis quota ticket remains pending for reconciliation.',
        );
      }
    }
    return result;
  }

  async cancelUploadIntent(
    request: StaffRequest,
    intentId: string,
    keyValue: unknown,
    capability: unknown,
  ) {
    const config = readConfig(process.env);
    if (!config.inquiryPublicEnabled)
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    requireOrigin(request);
    const key = requireKey(keyValue);
    const capabilityHash = this.requireCapability(capability);
    const kh = keyHash(key);
    const requestHash = digest(
      canonical({
        operationId: 'cancelInquiryUploadIntent',
        method: 'DELETE',
        path: request.path,
        payload: { intentId },
      }),
    );
    return this.db.$transaction(
      async (tx) => {
        const inquiryId = await this.resolveInquiryIdByUploadCapability(
          tx,
          capabilityHash,
        );
        const scope = `cancel:${inquiryId}:${intentId}`;
        const advisory = lockId(scope, 'anonymous', key);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${advisory})::text AS "lockAcquired"`;
        await this.lockInquiryByUploadCapability(tx, inquiryId, capabilityHash);
        const found = await this.findPublicCommand(tx, scope, kh);
        if (found) {
          if (!Buffer.from(found.requestHash).equals(requestHash))
            throw new StaffError('IDEMPOTENCY_KEY_REUSED');
          return {
            status: found.httpStatus,
            body: found.responseReceipt as Record<string, unknown>,
          };
        }
        const intent = await tx.inquiryUploadIntent.findFirst({
          where: { id: intentId, inquiryId },
        });
        if (!intent || intent.state !== 'ISSUED')
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (intent.expiresAt <= new Date())
          throw new StaffError('INVALID_STATE_TRANSITION');
        await tx.inquiryUploadIntent.update({
          where: { id: intentId },
          data: { state: 'CANCELLED', version: { increment: 1 } },
        });
        await createAuditEvent(tx, {
          actorKind: 'ANONYMOUS',
          action: 'inquiry.upload.cancelled',
          entityType: 'InquiryUploadIntent',
          entityId: intentId,
          outcome: 'SUCCESS',
          reasonCode: 'UPLOAD_INTENT_CANCELLED',
          requestId: request.requestId,
          sourceHash: Buffer.from(publicSource(request), 'hex'),
          changes: {
            previousState: intent.state,
            state: 'CANCELLED',
            version: intent.version + 1,
          },
        });
        const receipt = {
          data: { accepted: true },
          meta: { requestId: request.requestId },
        };
        await this.persistPublicCommand(
          tx,
          scope,
          kh,
          requestHash,
          204,
          receipt,
        );
        return { status: 204, body: receipt };
      },
      { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 },
    );
  }

  async uploadContent(
    request: StaffRequest,
    intentId: string,
    keyValue: unknown,
    capability: unknown,
  ) {
    const config = readConfig(process.env);
    if (!config.inquiryPublicEnabled)
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    requireOrigin(request);
    if (
      request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !==
      'application/octet-stream'
    )
      throw new StaffError('UNSUPPORTED_MEDIA_TYPE');
    const key = requireKey(keyValue);
    const capabilityHash = this.requireCapability(capability);
    const source = publicSource(request);
    if (
      this.activeStreamCount >= 4 ||
      (this.activeBySource.get(source) ?? 0) >= 2
    )
      throw new StaffError('RATE_LIMITED', undefined, 2);
    this.activeStreamCount++;
    this.activeBySource.set(source, (this.activeBySource.get(source) ?? 0) + 1);
    let owned: OwnedStorageWrite | null = null;
    let uploadLockToRelease: { redisKey: string; ownerValue: string } | null =
      null;
    let resolvedInquiryId: string | null = null;
    let claimedForThisStream = false;
    let failureStage = 'intent-state';
    let meter: UploadMeter | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
    let hardTimer: NodeJS.Timeout | undefined;
    const touchIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => meter?.destroy(new Error('UPLOAD_IDLE_TIMEOUT')),
        60_000,
      );
    };
    const onData = () => touchIdle();
    request.on('error', (error) => meter?.destroy(error));
    try {
      const hashedKey = keyHash(key);
      const claim = await this.db.$transaction(
        async (tx) => {
          const inquiryId = await this.resolveInquiryIdByUploadCapability(
            tx,
            capabilityHash,
          );
          resolvedInquiryId = inquiryId;
          const scope = `upload:${inquiryId}:${intentId}`;
          const advisory = lockId(scope, 'anonymous', key);
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(${advisory})::text AS "lockAcquired"`;
          const inquiry = await this.lockInquiryByUploadCapability(
            tx,
            inquiryId,
            capabilityHash,
          );
          await tx.$queryRaw`SELECT id FROM inquiry_upload_intent WHERE id=${intentId}::uuid AND inquiry_id=${inquiryId}::uuid FOR UPDATE`;
          const locked = await tx.inquiryUploadIntent.findUnique({
            where: { id: intentId },
          });
          if (!locked || locked.inquiryId !== inquiryId)
            throw new StaffError('FILE_NOT_ACCESSIBLE');
          const profile = profileFor(inquiry.uploadProfileCode);
          const prior = await this.findPublicCommand(tx, scope, hashedKey);
          if (locked.state === 'CONSUMED' && prior)
            return { intent: locked, profile, inquiryId };
          if (locked.state !== 'ISSUED' && locked.state !== 'RECEIVING')
            throw new StaffError('INVALID_STATE_TRANSITION');
          if (locked.state === 'RECEIVING') {
            const databaseNow =
              (
                await tx.$queryRaw<{ now: Date }[]>`
                SELECT clock_timestamp() AS now
              `
              )[0]?.now ?? new Date();
            if (
              !locked.receivingDeadlineAt ||
              locked.receivingDeadlineAt <= databaseNow
            )
              throw new StaffError('INVALID_STATE_TRANSITION');
            if (!(await this.hasUploadIdempotencyLock(intentId, hashedKey)))
              throw new StaffError('INVALID_STATE_TRANSITION');
            return { intent: locked, profile, inquiryId };
          }
          const uploadLock = await this.acquireUploadIdempotencyLock(
            intentId,
            hashedKey,
          );
          if (uploadLock.ownerValue)
            uploadLockToRelease = uploadLock as {
              redisKey: string;
              ownerValue: string;
            };
          const started = await tx.$queryRaw<{ id: string }[]>`
          WITH instant AS (SELECT clock_timestamp() AS started_at)
          UPDATE inquiry_upload_intent AS intent
          SET state='RECEIVING',
              receiving_started_at=instant.started_at,
              receiving_deadline_at=instant.started_at + ${profile.streamMinutes} * interval '1 minute',
              version=version+1,
              updated_at=instant.started_at
          FROM instant
          WHERE intent.id=${intentId}::uuid
            AND intent.inquiry_id=${inquiryId}::uuid
            AND intent.state='ISSUED'
            AND intent.expires_at > instant.started_at
          RETURNING intent.id::text`;
          if (started.length !== 1)
            throw new StaffError('INVALID_STATE_TRANSITION');
          claimedForThisStream = true;
          const intent = await tx.inquiryUploadIntent.findUniqueOrThrow({
            where: { id: intentId },
          });
          return { intent, profile, inquiryId };
        },
        { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 },
      );
      const { intent, profile, inquiryId } = claim;
      meter = new UploadMeter(
        Number(intent.declaredSizeBytes),
        profile.maxFile,
        intent.safeFilename.toLowerCase().endsWith('.csv'),
        intent.safeFilename.toLowerCase().endsWith('.xlsx'),
        intent.safeFilename.toLowerCase().endsWith('.pdf'),
      );
      failureStage = 'storage-write';
      owned = await this.storage.writeInquiryQuarantineOwned(meter, () => {
        request.pipe(meter!);
        request.on('data', onData);
        touchIdle();
        hardTimer = setTimeout(
          () => meter!.destroy(new Error('UPLOAD_DEADLINE')),
          intent.receivingDeadlineAt!
            ? Math.max(1, intent.receivingDeadlineAt.getTime() - Date.now())
            : 1,
        );
      });
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      const detected = meter.detectedMime();
      if (owned.stored.size !== Number(intent.declaredSizeBytes)) {
        failureStage = 'validate-size';
        this.logger.warn(
          `Inquiry upload size mismatch requestId=${request.requestId} declared=${intent.declaredSizeBytes} received=${owned.stored.size}.`,
        );
        throw new StaffError('FILE_REJECTED');
      }
      if (
        intent.expectedSha256 &&
        !Buffer.from(intent.expectedSha256).equals(
          Buffer.from(owned.stored.sha256, 'hex'),
        )
      ) {
        failureStage = 'validate-sha256';
        throw new StaffError('FILE_REJECTED');
      }
      if (!detected) {
        failureStage = 'validate-signature';
        throw new StaffError('FILE_REJECTED');
      }
      if (
        !(await meter.validateStoredStructure(owned.stored.key, this.storage))
      ) {
        failureStage = 'validate-structure';
        throw new StaffError('FILE_REJECTED');
      }
      if (!this.allowedDeclaredMime(detected, intent.declaredMimeType)) {
        failureStage = 'validate-declared-mime';
        throw new StaffError('FILE_REJECTED');
      }
      if (detected !== this.mimeForExtension(intent.safeFilename)) {
        failureStage = 'validate-extension';
        throw new StaffError('FILE_REJECTED');
      }
      failureStage = 'persist-document';
      const result = await this.finishUpload(
        request,
        inquiryId,
        intentId,
        key,
        capabilityHash,
        intent,
        owned,
        detected,
        source,
      );
      owned = null;
      return result;
    } catch (error) {
      if (meter) {
        request.unpipe(meter);
        if (!request.complete) request.destroy();
      }
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      if (owned)
        await this.removeOwnedUpload(request.requestId, failureStage, owned);
      const failure =
        error instanceof StaffError
          ? error
          : error instanceof PrivateStorageUnavailableError
            ? new StaffError('DEPENDENCY_UNAVAILABLE')
            : new StaffError('FILE_REJECTED');
      this.logger.warn(
        `Inquiry upload failed requestId=${request.requestId} stage=${failureStage} code=${failure.code}.`,
      );
      if (claimedForThisStream && resolvedInquiryId)
        await this.rejectIntent(
          request,
          resolvedInquiryId,
          intentId,
          source,
          failure,
        ).catch(() => undefined);
      throw failure;
    } finally {
      request.off('data', onData);
      await this.releaseUploadIdempotencyLock(
        uploadLockToRelease,
        request.requestId,
      );
      this.activeStreamCount--;
      const active = (this.activeBySource.get(source) ?? 1) - 1;
      if (active <= 0) this.activeBySource.delete(source);
      else this.activeBySource.set(source, active);
    }
  }

  async detail(request: StaffRequest, inquiryId: string) {
    const actor = this.actor(request);
    return this.withAuthorizedRead(
      actor,
      inquiryId,
      async (tx, permissions) => {
        const row = await tx.inquiry.findUnique({
          where: { id: inquiryId },
          include: { lines: { orderBy: { sequence: 'asc' } } },
        });
        if (!row) throw new StaffError('NOT_FOUND');
        const detail: Record<string, unknown> = {
          ...summary(row),
          catalogProductContext: row.catalogProductContext,
          kindDetails: row.kindDetails,
          equipmentLines: row.lines.map((line) => ({
            rawTitle: line.rawTitle,
            originalSku: line.originalSku,
            manufacturerName: line.manufacturerName,
            modification: line.modification,
            quantity: line.quantityText,
            unit: line.unitText,
            notes: line.notes,
            catalogProductSlugContext: line.catalogProductSlugContext,
          })),
        };
        if (permissions.includes('inquiries.contacts.read'))
          detail.contact = row.contactSnapshot;
        return { data: detail, meta: { requestId: request.requestId } };
      },
    );
  }

  async events(request: StaffRequest, inquiryId: string, query: PageQueryDto) {
    const actor = this.actor(request);
    return this.withAuthorizedRead(actor, inquiryId, async (tx) => {
      const take = query.limit ?? 50;
      const fingerprint = digest(canonical({ inquiryId })).toString(
        'base64url',
      );
      const cursor = this.decodeCursor(query.cursor, fingerprint);
      const rows = await tx.$queryRaw<
        {
          id: string;
          action: string;
          outcome: string;
          occurredAt: Date;
          cursorTimestamp: string;
          actorUserId: string | null;
          changes: Prisma.JsonValue;
        }[]
      >`
        SELECT id::text AS id, action, outcome, occurred_at AS "occurredAt",
          to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTimestamp",
          actor_user_id::text AS "actorUserId", changes
        FROM audit_event
        WHERE entity_type = 'Inquiry' AND entity_id = ${inquiryId}::uuid
          AND action LIKE 'inquiry.%'
          AND (NOT ${Boolean(cursor?.timestamp)} OR
            (occurred_at, id) > (
              ${cursor?.timestamp ?? '1970-01-01T00:00:00.000000Z'}::timestamptz,
              ${cursor?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid
            ))
        ORDER BY occurred_at ASC, id ASC
        LIMIT ${take + 1}`;
      const hasMore = rows.length > take;
      const page = rows.slice(0, take);
      return {
        data: page.map((row) => ({
          action: row.action,
          outcome: row.outcome,
          occurredAt: row.occurredAt.toISOString(),
          actorStaffUserId: row.actorUserId,
          fromStatus:
            typeof row.changes === 'object' &&
            row.changes &&
            'previousState' in row.changes
              ? String((row.changes as Record<string, unknown>).previousState)
              : null,
          toStatus:
            typeof row.changes === 'object' &&
            row.changes &&
            'state' in row.changes
              ? String((row.changes as Record<string, unknown>).state)
              : null,
        })),
        meta: {
          nextCursor: hasMore
            ? this.encodeCursor({
                v: 1,
                fingerprint,
                id: page.at(-1)!.id,
                timestamp: page.at(-1)!.cursorTimestamp,
              })
            : null,
          requestId: request.requestId,
        },
      };
    });
  }

  async listComments(
    request: StaffRequest,
    inquiryId: string,
    query: PageQueryDto,
  ) {
    const actor = this.actor(request);
    return this.withAuthorizedRead(
      actor,
      inquiryId,
      async (tx, permissions) => {
        if (!permissions.includes('inquiries.comment'))
          throw new StaffError('FORBIDDEN');
        const take = query.limit ?? 50;
        const fingerprint = digest(canonical({ inquiryId })).toString(
          'base64url',
        );
        const cursor = this.decodeCursor(query.cursor, fingerprint);
        const rows = await tx.$queryRaw<
          {
            id: string;
            body: string;
            authorStaffUserId: string;
            createdAt: Date;
            cursorTimestamp: string;
          }[]
        >`
          SELECT id::text AS id, body, author_staff_user_id::text AS "authorStaffUserId",
            created_at AS "createdAt",
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTimestamp"
          FROM inquiry_comment
          WHERE inquiry_id = ${inquiryId}::uuid
            AND (NOT ${Boolean(cursor?.timestamp)} OR
              (created_at, id) > (
                ${cursor?.timestamp ?? '1970-01-01T00:00:00.000000Z'}::timestamptz,
                ${cursor?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid
              ))
          ORDER BY created_at ASC, id ASC
          LIMIT ${take + 1}`;
        const hasMore = rows.length > take;
        const page = rows.slice(0, take);
        return {
          data: page.map(({ id, body, authorStaffUserId, createdAt }) => ({
            id,
            body,
            authorStaffUserId,
            createdAt: createdAt.toISOString(),
          })),
          meta: {
            nextCursor: hasMore
              ? this.encodeCursor({
                  v: 1,
                  fingerprint,
                  id: page.at(-1)!.id,
                  timestamp: page.at(-1)!.cursorTimestamp,
                })
              : null,
            requestId: request.requestId,
          },
        };
      },
    );
  }

  async listDocuments(request: StaffRequest, inquiryId: string) {
    const actor = this.actor(request);
    return this.withAuthorizedRead(
      actor,
      inquiryId,
      async (tx, permissions) => {
        if (!permissions.includes('inquiries.documents.read'))
          throw new StaffError('FORBIDDEN');
        const rows = await tx.inquirySourceDocument.findMany({
          where: { inquiryId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        return {
          data: rows.map((row) => ({
            id: row.id,
            sizeBytes: Number(row.sizeBytes),
            sha256: Buffer.from(row.sha256).toString('hex'),
            detectedMimeType: row.detectedMimeType,
            securityState: row.safetyState,
            uploadedAt: row.uploadedAt.toISOString(),
            originalFilename: row.originalFilename,
          })),
          meta: { nextCursor: null, requestId: request.requestId },
        };
      },
    );
  }

  async downloadDocument(
    request: StaffRequest,
    inquiryId: string,
    documentId: string,
  ): Promise<{ stream: Readable; mimeType: string; filename: string }> {
    const actor = this.actor(request);
    const opened = { stream: null as Readable | null };
    try {
      return await this.db.$transaction(async (tx) => {
        const permissions = await assertCurrentActor(
          tx,
          {
            id: actor.id,
            sessionId: actor.sessionId,
            authVersion: actor.authVersion,
          },
          'inquiries.documents.download',
        );
        if (!permissions.includes('inquiries.documents.read'))
          throw new StaffError('FORBIDDEN');
        if (
          !permissions.includes('inquiries.read_all') &&
          !permissions.includes('inquiries.read_assigned')
        )
          throw new StaffError('FORBIDDEN');
        await tx.$queryRaw`SELECT id FROM inquiry WHERE id=${inquiryId}::uuid FOR UPDATE`;
        await this.assertScope(tx, inquiryId, actor.id);
        const document = await tx.inquirySourceDocument.findFirst({
          where: { id: documentId, inquiryId },
        });
        if (!document || document.safetyState !== 'CLEAN')
          throw new StaffError('FILE_NOT_ACCESSIBLE');
        opened.stream = await this.storage.openInquiryQuarantine(
          document.storageKey,
        );
        await createAuditEvent(tx, {
          actorKind: 'STAFF',
          actorUserId: actor.id,
          action: 'inquiry.document.downloaded',
          entityType: 'InquirySourceDocument',
          entityId: documentId,
          outcome: 'SUCCESS',
          reasonCode: 'DOWNLOAD_ALLOWED',
          requestId: request.requestId,
        });
        return {
          stream: opened.stream,
          mimeType: document.detectedMimeType,
          filename: document.originalFilename,
        };
      });
    } catch (error) {
      opened.stream?.destroy();
      if (error instanceof PrivateStorageUnavailableError)
        throw new StaffError('DEPENDENCY_UNAVAILABLE');
      throw error;
    }
  }

  async assignManager(
    request: StaffRequest,
    id: string,
    ifMatch: unknown,
    key: unknown,
    dto: AssignmentDto,
  ) {
    return this.staffMutation(
      request,
      id,
      'assignInquiryManager',
      'inquiries.assign_manager',
      ifMatch,
      key,
      dto,
      async (tx, current, actor) => {
        await this.ensureAssignableStaff(tx, dto.staffUserId);
        const version = current.version + 1;
        await tx.inquiry.update({
          where: { id },
          data: { assignedManagerUserId: dto.staffUserId, version },
        });
        await this.audit(
          tx,
          request,
          actor,
          'inquiry.manager.assigned',
          'Inquiry',
          id,
          'MANAGER_ASSIGNED',
          {
            targetUserId: dto.staffUserId,
            changedFields: ['assignedManagerUserId'],
            version,
          },
        );
        return {
          status: 200,
          data: {
            data: { inquiryId: id, version },
            meta: { requestId: request.requestId },
          },
        };
      },
      [dto.staffUserId],
    );
  }

  async assignEngineer(
    request: StaffRequest,
    id: string,
    ifMatch: unknown,
    key: unknown,
    dto: AssignmentDto,
  ) {
    return this.staffMutation(
      request,
      id,
      'assignInquiryEngineer',
      'inquiries.assign_engineer',
      ifMatch,
      key,
      dto,
      async (tx, current, actor) => {
        await this.ensureAssignableStaff(tx, dto.staffUserId);
        const version = current.version + 1;
        await tx.inquiry.update({
          where: { id },
          data: { assignedEngineerUserId: dto.staffUserId, version },
        });
        await this.audit(
          tx,
          request,
          actor,
          'inquiry.engineer.assigned',
          'Inquiry',
          id,
          'ENGINEER_ASSIGNED',
          {
            targetUserId: dto.staffUserId,
            changedFields: ['assignedEngineerUserId'],
            version,
          },
        );
        return {
          status: 200,
          data: {
            data: { inquiryId: id, version },
            meta: { requestId: request.requestId },
          },
        };
      },
      [dto.staffUserId],
    );
  }

  async setStageDeadline(
    request: StaffRequest,
    id: string,
    ifMatch: unknown,
    key: unknown,
    dto: StageDeadlineDto,
  ) {
    return this.staffMutation(
      request,
      id,
      'setInquiryStageDeadline',
      'inquiries.transition',
      ifMatch,
      key,
      dto,
      async (tx, current, actor) => {
        if (current.status === 'CLOSED' || current.status === 'QUOTE_SENT')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const due = dto.stageDueAt == null ? null : new Date(dto.stageDueAt);
        if (due && !Number.isFinite(due.getTime()))
          throw new StaffError('VALIDATION_ERROR');
        const version = current.version + 1;
        await tx.inquiry.update({
          where: { id },
          data: { stageDueAt: due, version },
        });
        await this.audit(
          tx,
          request,
          actor,
          'inquiry.stage_deadline.changed',
          'Inquiry',
          id,
          due ? 'STAGE_DUE_AT_SET' : 'STAGE_DUE_AT_CLEARED',
          { changedFields: ['stageDueAt'], version },
        );
        return {
          status: 200,
          data: {
            data: { inquiryId: id, version },
            meta: { requestId: request.requestId },
          },
        };
      },
    );
  }

  async transition(
    request: StaffRequest,
    id: string,
    ifMatch: unknown,
    key: unknown,
    dto: TransitionDto,
  ) {
    return this.staffMutation(
      request,
      id,
      'transitionStaffInquiry',
      'inquiries.transition',
      ifMatch,
      key,
      dto,
      async (tx, current, actor) => {
        if (dto.toStatus === 'CLOSED') {
          if (
            !CLOSURE_REASONS.has(dto.reasonCode) ||
            ![
              'NEW',
              'TRIAGE',
              'NEEDS_CLARIFICATION',
              'ENGINEERING_REVIEW',
              'READY_FOR_QUOTE',
            ].includes(current.status)
          )
            throw new StaffError('INVALID_STATE_TRANSITION');
          const capability = await tx.inquiry.findUniqueOrThrow({
            where: { id },
            select: { uploadCapabilityHash: true },
          });
          const revokeCapability = capability.uploadCapabilityHash !== null;
          const version = current.version + 1;
          await tx.inquiry.update({
            where: { id },
            data: {
              status: 'CLOSED',
              stageDueAt: null,
              version,
              ...(revokeCapability
                ? {
                    uploadCapabilityHash: null,
                    uploadCapabilityExpiresAt: null,
                  }
                : {}),
            },
          });
          await this.audit(
            tx,
            request,
            actor,
            'inquiry.closed_without_quote',
            'Inquiry',
            id,
            dto.reasonCode,
            {
              previousState: current.status,
              state: 'CLOSED',
              version,
              changedFields: revokeCapability
                ? [
                    'stageDueAt',
                    'status',
                    'uploadCapabilityExpiresAt',
                    'uploadCapabilityHash',
                  ]
                : ['stageDueAt', 'status'],
            },
          );
          return {
            status: 200,
            data: {
              data: { inquiryId: id, version },
              meta: { requestId: request.requestId },
            },
          };
        }
        const allowedReason = NEXT[current.status]?.[dto.toStatus];
        if (!allowedReason || allowedReason !== dto.reasonCode)
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (current.status === 'NEW' && dto.toStatus === 'TRIAGE')
          await this.ensureAssignedStaffActive(
            tx,
            current.assignedManagerUserId,
          );
        if (
          (['TRIAGE', 'NEEDS_CLARIFICATION'].includes(current.status) &&
            dto.toStatus === 'ENGINEERING_REVIEW') ||
          (current.status === 'ENGINEERING_REVIEW' &&
            dto.toStatus === 'READY_FOR_QUOTE')
        )
          await this.ensureAssignedStaffActive(
            tx,
            current.assignedEngineerUserId,
          );
        const version = current.version + 1;
        await tx.inquiry.update({
          where: { id },
          data: { status: dto.toStatus, stageDueAt: null, version },
        });
        await this.audit(
          tx,
          request,
          actor,
          'inquiry.transitioned',
          'Inquiry',
          id,
          dto.reasonCode,
          {
            previousState: current.status,
            state: dto.toStatus,
            version,
            changedFields: ['stageDueAt', 'status'],
          },
        );
        return {
          status: 200,
          data: {
            data: { inquiryId: id, version },
            meta: { requestId: request.requestId },
          },
        };
      },
    );
  }

  async createComment(
    request: StaffRequest,
    id: string,
    key: unknown,
    dto: CreateCommentDto,
  ) {
    const actor = this.actor(request);
    const result = await this.command(
      request,
      actor,
      id,
      'createStaffInquiryComment',
      'inquiries.comment',
      key,
      dto,
      async (tx, row) => {
        const commentId = randomUUID();
        const auditId = randomUUID();
        await tx.auditEvent.create({
          data: {
            id: auditId,
            actorKind: 'STAFF',
            actorUserId: actor.id,
            action: 'inquiry.comment.created',
            entityType: 'InquiryComment',
            entityId: commentId,
            outcome: 'SUCCESS',
            reasonCode: 'COMMENT_CREATED',
            requestId: request.requestId,
            changes: { changedFields: ['body'] },
          },
        });
        await tx.inquiryComment.create({
          data: {
            id: commentId,
            inquiryId: id,
            authorStaffUserId: actor.id,
            visibility: 'INTERNAL',
            body: dto.body,
            auditEventId: auditId,
          },
        });
        return {
          status: 201,
          body: {
            data: { inquiryId: id, version: row.version, commentId },
            meta: { requestId: request.requestId },
          },
        };
      },
    );
    return result;
  }

  private async staffMutation(
    request: StaffRequest,
    id: string,
    operationId: string,
    permission: string,
    ifMatchValue: unknown,
    keyValue: unknown,
    dto: unknown,
    work: (
      tx: Tx,
      row: InquiryMutationSnapshot,
      actor: string,
    ) => Promise<{ status: number; data: unknown }>,
    additionalStaffUserIds: string[] = [],
  ): Promise<SafeMutation> {
    const actor = this.actor(request);
    const key = requireKey(keyValue);
    if (
      typeof ifMatchValue !== 'string' ||
      !/^"[1-9][0-9]*"$/.test(ifMatchValue)
    )
      throw new StaffError('VALIDATION_ERROR');
    const expectedVersion = Number(ifMatchValue.slice(1, -1));
    return this.command(
      request,
      actor,
      id,
      operationId,
      permission,
      key,
      { ifMatch: expectedVersion, dto },
      async (tx, row) => {
        if (row.version !== expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        const result = await work(tx, row, actor.id);
        return {
          status: result.status,
          body: result.data as Record<string, unknown>,
        };
      },
      additionalStaffUserIds,
    );
  }

  private async command(
    request: StaffRequest,
    actor: NonNullable<StaffRequest['staff']>,
    id: string,
    operationId: string,
    permission: string,
    keyValue: unknown,
    payload: unknown,
    work: (
      tx: Tx,
      row: InquiryMutationSnapshot,
    ) => Promise<{ status: number; body: Record<string, unknown> }>,
    additionalStaffUserIds: string[] = [],
  ): Promise<SafeMutation> {
    const key = requireKey(keyValue);
    const scope = `staff:${operationId}`;
    const kh = keyHash(key);
    const requestHash = digest(
      canonical({
        apiVersion: '1.0.0',
        operationId,
        method: request.method,
        path: request.path,
        actorId: actor.id,
        payload,
      }),
    );
    const advisory = lockId(scope, actor.id, key);
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${advisory})::text AS "lockAcquired"`;
        const lockTargetUsers = additionalStaffUserIds.length > 0;
        if (lockTargetUsers) {
          // Share the R1-002 account/role writer lock so target eligibility stays current through commit.
          await acquireAdminInvariantLock(tx);
          await lockStaffUserRows(tx, [actor.id, ...additionalStaffUserIds]);
          await tx.$queryRaw`SELECT id FROM staff_session WHERE id = ${actor.sessionId}::uuid FOR UPDATE`;
        }
        const actorPermissions = await assertCurrentActor(
          tx,
          {
            id: actor.id,
            sessionId: actor.sessionId,
            authVersion: actor.authVersion,
          },
          permission,
          false,
          lockTargetUsers,
        );
        if (
          !actorPermissions.includes('inquiries.read_all') &&
          !actorPermissions.includes('inquiries.read_assigned')
        )
          throw new StaffError('FORBIDDEN');
        await tx.$queryRaw`SELECT id FROM inquiry WHERE id=${id}::uuid FOR UPDATE`;
        await this.assertScope(tx, id, actor.id);
        const existing = await tx.$queryRaw<
          {
            requestHash: Uint8Array;
            httpStatus: number;
            responseReceipt: unknown;
          }[]
        >`
        SELECT request_hash AS "requestHash", http_status AS "httpStatus", response_receipt AS "responseReceipt"
        FROM inquiry_command_idempotency WHERE actor_kind='STAFF' AND actor_staff_user_id=${actor.id}::uuid
          AND operation_scope=${scope} AND idempotency_key_hash=${kh} AND expires_at > clock_timestamp() LIMIT 1`;
        if (existing[0]) {
          if (!Buffer.from(existing[0].requestHash).equals(requestHash))
            throw new StaffError('IDEMPOTENCY_KEY_REUSED');
          return {
            status: existing[0].httpStatus,
            body: existing[0].responseReceipt as Record<string, unknown>,
          };
        }
        await tx.$executeRaw`DELETE FROM inquiry_command_idempotency WHERE actor_kind='STAFF' AND actor_staff_user_id=${actor.id}::uuid AND operation_scope=${scope} AND idempotency_key_hash=${kh} AND expires_at <= clock_timestamp()`;
        const row = await tx.inquiry.findUnique({
          where: { id },
          select: {
            id: true,
            version: true,
            status: true,
            assignedManagerUserId: true,
            assignedEngineerUserId: true,
          },
        });
        if (!row) throw new StaffError('NOT_FOUND');
        let result: { status: number; body: Record<string, unknown> };
        try {
          result = await work(tx, row);
        } catch (error) {
          if (!(error instanceof StaffError) || error.getStatus() !== 409)
            throw error;
          result = {
            status: error.getStatus(),
            body: errorReceipt(error, request.requestId),
          };
          const transition = (payload as { dto?: TransitionDto }).dto;
          const action =
            operationId === 'transitionStaffInquiry'
              ? transition?.toStatus === 'CLOSED'
                ? 'inquiry.closed_without_quote'
                : 'inquiry.transitioned'
              : operationId === 'assignInquiryManager'
                ? 'inquiry.manager.assigned'
                : operationId === 'assignInquiryEngineer'
                  ? 'inquiry.engineer.assigned'
                  : operationId === 'createStaffInquiryComment'
                    ? 'inquiry.comment.created'
                    : 'inquiry.stage_deadline.changed';
          const reason =
            error.code === 'VERSION_CONFLICT'
              ? 'VERSION_CONFLICT'
              : error.code === 'INVALID_STATE_TRANSITION'
                ? 'INVALID_STATE_TRANSITION'
                : 'VALIDATION_ERROR';
          const auditChanges =
            operationId === 'assignInquiryManager' ||
            operationId === 'assignInquiryEngineer'
              ? {
                  targetUserId:
                    (payload as { dto?: AssignmentDto }).dto?.staffUserId ??
                    actor.id,
                  changedFields: [
                    operationId === 'assignInquiryManager'
                      ? 'assignedManagerUserId'
                      : 'assignedEngineerUserId',
                  ],
                  version: row.version,
                }
              : operationId === 'setInquiryStageDeadline'
                ? { changedFields: ['stageDueAt'], version: row.version }
                : operationId === 'createStaffInquiryComment'
                  ? { changedFields: ['body'] }
                  : {
                      previousState: row.status,
                      state: row.status,
                      version: row.version,
                      changedFields: ['status'],
                    };
          await createAuditEvent(tx, {
            actorKind: 'STAFF',
            actorUserId: actor.id,
            action,
            entityType:
              operationId === 'createStaffInquiryComment'
                ? 'InquiryComment'
                : 'Inquiry',
            entityId:
              operationId === 'createStaffInquiryComment' ? randomUUID() : id,
            outcome: 'DENIED',
            reasonCode: reason,
            requestId: request.requestId,
            changes: auditChanges,
          });
        }
        const transactionTime =
          (
            await tx.$queryRaw<
              { now: Date }[]
            >`SELECT transaction_timestamp() AS now`
          )[0]?.now ?? new Date();
        await tx.inquiryCommandIdempotency.create({
          data: {
            id: randomUUID(),
            actorKind: 'STAFF',
            actorStaffUserId: actor.id,
            operationScope: scope,
            idempotencyKeyHash: new Uint8Array(kh),
            requestHash: new Uint8Array(requestHash),
            httpStatus: result.status,
            responseReceipt: asJson(result.body),
            expiresAt: new Date(transactionTime.getTime() + 30 * 86400_000),
          },
        });
        return result;
      },
      { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 },
    );
  }

  private actor(request: StaffRequest) {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    if (request.staff.passwordChangeRequired)
      throw new StaffError('PASSWORD_CHANGE_REQUIRED');
    return request.staff;
  }
  private async withAuthorizedRead<T>(
    actor: NonNullable<StaffRequest['staff']>,
    id: string,
    work: (tx: Tx, permissions: string[]) => Promise<T>,
  ) {
    return this.db.$transaction(async (tx) => {
      const current = await assertCurrentActor(
        tx,
        {
          id: actor.id,
          sessionId: actor.sessionId,
          authVersion: actor.authVersion,
        },
        null,
      );
      if (
        !current.includes('inquiries.read_all') &&
        !current.includes('inquiries.read_assigned')
      )
        throw new StaffError('FORBIDDEN');
      await tx.$queryRaw`SELECT id FROM inquiry WHERE id=${id}::uuid FOR UPDATE`;
      await this.assertScope(tx, id, actor.id);
      return work(tx, current);
    });
  }
  private async assertScope(tx: Tx, id: string, actorId: string) {
    const found = await tx.inquiry.findUnique({
      where: { id },
      select: {
        id: true,
        assignedManagerUserId: true,
        assignedEngineerUserId: true,
      },
    });
    if (!found) throw new StaffError('NOT_FOUND');
    const permissions = await effectivePermissions(tx, actorId);
    if (permissions.includes('inquiries.read_all')) return;
    if (!permissions.includes('inquiries.read_assigned'))
      throw new StaffError('FORBIDDEN');
    if (
      found.assignedManagerUserId !== actorId &&
      found.assignedEngineerUserId !== actorId
    )
      throw new StaffError('NOT_FOUND');
  }
  private async ensureAssignableStaff(tx: Tx, userId: string) {
    const user = await tx.staffUser.findUnique({
      where: { id: userId },
      select: { id: true, state: true },
    });
    if (!user || user.state !== 'ACTIVE')
      throw new StaffError('VALIDATION_ERROR', undefined, undefined, 422);
    const permissions = await effectivePermissions(tx, userId);
    if (
      !permissions.includes('inquiries.read_assigned') &&
      !permissions.includes('inquiries.read_all')
    )
      throw new StaffError('VALIDATION_ERROR', undefined, undefined, 422);
  }
  private async ensureAssignedStaffActive(tx: Tx, userId: string | null) {
    if (!userId) throw new StaffError('INVALID_STATE_TRANSITION');
    const user = await tx.staffUser.findUnique({
      where: { id: userId },
      select: { state: true },
    });
    if (!user || user.state !== 'ACTIVE')
      throw new StaffError('INVALID_STATE_TRANSITION');
  }
  private async audit(
    tx: Tx,
    request: StaffRequest,
    actor: string,
    action: string,
    entityType: string,
    entityId: string,
    reason: string,
    changes: Record<string, unknown>,
  ) {
    await createAuditEvent(tx, {
      actorKind: 'STAFF',
      actorUserId: actor,
      action,
      entityType,
      entityId,
      outcome: 'SUCCESS',
      reasonCode: reason,
      requestId: request.requestId,
      changes,
    });
  }
  private decodeCursor(
    cursor: string | undefined,
    fingerprint: string,
  ): { id: string; timestamp?: string } | null {
    if (!cursor) return null;
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as {
        v?: number;
        fingerprint?: string;
        id?: string;
        timestamp?: string;
      };
      if (
        decoded.v !== 1 ||
        decoded.fingerprint !== fingerprint ||
        !decoded.id ||
        !/^[0-9a-f-]{36}$/i.test(decoded.id)
      )
        throw new Error();
      if (
        decoded.timestamp !== undefined &&
        (typeof decoded.timestamp !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(
            decoded.timestamp,
          ) ||
          !Number.isFinite(Date.parse(decoded.timestamp)))
      )
        throw new Error();
      return {
        id: decoded.id,
        ...(decoded.timestamp ? { timestamp: decoded.timestamp } : {}),
      };
    } catch {
      throw new StaffError('VALIDATION_ERROR');
    }
  }
  private encodeCursor(value: {
    v: 1;
    fingerprint: string;
    id: string;
    timestamp?: string;
  }) {
    return Buffer.from(canonical(value)).toString('base64url');
  }

  private assertKindShape(input: CreateInquiryDto) {
    const valid =
      input.kind === 'EQUIPMENT'
        ? !!input.equipmentLines?.length && !input.panels && !input.engineering
        : input.kind === 'PANELS'
          ? !!input.panels && !input.equipmentLines && !input.engineering
          : input.kind === 'ENGINEERING'
            ? !!input.engineering && !input.equipmentLines && !input.panels
            : false;
    if (!valid) throw new StaffError('VALIDATION_ERROR');
    if (
      !input.contact?.contactName.trim() ||
      (!input.contact.email?.trim() && !input.contact.phone?.trim())
    )
      throw new StaffError('VALIDATION_ERROR');
  }

  private requireCapability(value: unknown) {
    if (typeof value !== 'string') throw new StaffError('FILE_NOT_ACCESSIBLE');
    const hash = validCapability(value);
    if (!hash) throw new StaffError('FILE_NOT_ACCESSIBLE');
    return hash;
  }

  private assertCapability(
    stored: Uint8Array | null | undefined,
    expires: Date | null | undefined,
    supplied: Buffer,
  ) {
    if (!stored || !expires || expires <= new Date())
      throw new StaffError('FILE_NOT_ACCESSIBLE');
    const current = Buffer.from(stored);
    if (
      current.length !== supplied.length ||
      !timingSafeEqual(current, supplied)
    )
      throw new StaffError('FILE_NOT_ACCESSIBLE');
  }

  private assertCapabilityNotRevoked(
    stored: Uint8Array | null | undefined,
    supplied: Buffer,
  ) {
    if (!stored) throw new StaffError('FILE_NOT_ACCESSIBLE');
    const current = Buffer.from(stored);
    if (
      current.length !== supplied.length ||
      !timingSafeEqual(current, supplied)
    )
      throw new StaffError('FILE_NOT_ACCESSIBLE');
  }

  private safeFilename(value: string) {
    const filename = value.normalize('NFC');
    const hasControlCharacter = Array.from(filename).some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
      );
    });
    if (
      !filename.trim() ||
      filename.length > 255 ||
      hasControlCharacter ||
      filename.includes('/') ||
      filename.includes('\\') ||
      filename === '.' ||
      filename === '..'
    )
      throw new StaffError('VALIDATION_ERROR');
    return filename;
  }

  private mimeForExtension(filename: string) {
    const extension = filename.toLowerCase().slice(filename.lastIndexOf('.'));
    return extension === '.pdf'
      ? 'application/pdf'
      : extension === '.csv'
        ? 'text/csv'
        : extension === '.xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : null;
  }

  private allowedDeclaredMime(detected: string, declared: string) {
    const normalized = declared.toLowerCase().trim();
    if (detected === 'text/csv')
      return ['text/csv', 'application/csv', 'text/plain'].includes(normalized);
    return detected === normalized;
  }

  private async findPublicCommand(tx: Tx, scope: string, kh: Buffer) {
    const rows = await tx.$queryRaw<
      {
        requestHash: Uint8Array;
        httpStatus: number;
        responseReceipt: unknown;
      }[]
    >`
      SELECT request_hash AS "requestHash", http_status AS "httpStatus", response_receipt AS "responseReceipt"
      FROM inquiry_command_idempotency WHERE actor_kind='PUBLIC' AND operation_scope=${scope}
        AND idempotency_key_hash=${kh} AND expires_at > clock_timestamp() LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      responseReceipt: readPersistedPublicReceipt(row.responseReceipt).body,
    };
  }

  private async persistPublicCommand(
    tx: Tx,
    scope: string,
    kh: Buffer,
    requestHash: Buffer,
    status: number,
    body: Record<string, unknown>,
    quotaReservation?: SourceQuotaReservation,
  ) {
    await tx.$executeRaw`DELETE FROM inquiry_command_idempotency WHERE actor_kind='PUBLIC' AND operation_scope=${scope} AND idempotency_key_hash=${kh} AND expires_at <= clock_timestamp()`;
    const transactionTime =
      (
        await tx.$queryRaw<
          { now: Date }[]
        >`SELECT transaction_timestamp() AS now`
      )[0]?.now ?? new Date();
    await tx.inquiryCommandIdempotency.create({
      data: {
        id: randomUUID(),
        actorKind: 'PUBLIC',
        actorStaffUserId: null,
        operationScope: scope,
        idempotencyKeyHash: new Uint8Array(kh),
        requestHash: new Uint8Array(requestHash),
        httpStatus: status,
        responseReceipt: asJson(persistPublicReceipt(body, quotaReservation)),
        expiresAt: new Date(transactionTime.getTime() + 30 * 86400_000),
      },
    });
  }

  private async finishUpload(
    request: StaffRequest,
    inquiryId: string,
    intentId: string,
    key: string,
    capabilityHash: Buffer,
    intent: {
      id: string;
      state: string;
      expectedSha256: Uint8Array | null;
      declaredSizeBytes: bigint;
      safeFilename: string;
    },
    owned: OwnedStorageWrite,
    detectedMime: string,
    source: string,
  ) {
    const scope = `upload:${inquiryId}:${intentId}`;
    const kh = keyHash(key);
    const requestHash = digest(
      canonical({
        operationId: 'uploadInquirySourceDocument',
        method: 'PUT',
        path: request.path,
        payload: {
          inquiryId,
          intentId,
          sizeBytes: owned.stored.size,
          sha256: owned.stored.sha256,
          detectedMime,
        },
      }),
    );
    const advisory = lockId(scope, 'anonymous', key);
    const result = await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${advisory})::text AS "lockAcquired"`;
        await tx.$queryRaw`SELECT id FROM inquiry WHERE id=${inquiryId}::uuid FOR UPDATE`;
        const inquiry = await tx.inquiry.findUnique({
          where: { id: inquiryId },
        });
        this.assertCapabilityNotRevoked(
          inquiry?.uploadCapabilityHash,
          capabilityHash,
        );
        const prior = await this.findPublicCommand(tx, scope, kh);
        if (prior) {
          if (!Buffer.from(prior.requestHash).equals(requestHash))
            throw new StaffError('IDEMPOTENCY_KEY_REUSED');
          return {
            replay: true,
            result: {
              status: prior.httpStatus,
              body: prior.responseReceipt as Record<string, unknown>,
            },
          };
        }
        const current = await tx.inquiryUploadIntent.findFirst({
          where: { id: intentId, inquiryId },
        });
        const now =
          (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
          )[0]?.now ?? new Date();
        if (
          !current ||
          current.state !== 'RECEIVING' ||
          !current.receivingDeadlineAt ||
          current.receivingDeadlineAt <= now
        )
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (
          Number(current.declaredSizeBytes) !== owned.stored.size ||
          (current.expectedSha256 &&
            !Buffer.from(current.expectedSha256).equals(
              Buffer.from(owned.stored.sha256, 'hex'),
            ))
        )
          throw new StaffError('FILE_REJECTED');
        const documentId = randomUUID();
        await tx.inquirySourceDocument.create({
          data: {
            id: documentId,
            inquiryId,
            uploadIntentId: intentId,
            uploaderKind: 'ANONYMOUS',
            uploadChannel: 'PUBLIC_WEB',
            storageKey: owned.stored.key,
            sha256: new Uint8Array(Buffer.from(owned.stored.sha256, 'hex')),
            sizeBytes: BigInt(owned.stored.size),
            detectedMimeType: detectedMime,
            originalFilename: current.safeFilename,
            safetyState: 'QUARANTINED',
            uploadedAt: new Date(),
          },
        });
        await tx.inquiryUploadIntent.update({
          where: { id: intentId },
          data: {
            state: 'CONSUMED',
            version: { increment: 1 },
          },
        });
        await createAuditEvent(tx, {
          actorKind: 'ANONYMOUS',
          action: 'inquiry.upload.completed',
          entityType: 'InquirySourceDocument',
          entityId: documentId,
          outcome: 'SUCCESS',
          reasonCode: 'UPLOAD_ACCEPTED',
          requestId: request.requestId,
          sourceHash: Buffer.from(source, 'hex'),
          changes: { changedFields: ['safetyState'], state: 'QUARANTINED' },
        });
        const body = {
          data: {
            accepted: true,
            sizeBytes: owned.stored.size,
            securityState: 'QUARANTINED',
          },
          meta: { requestId: request.requestId },
        };
        await this.persistPublicCommand(tx, scope, kh, requestHash, 201, body);
        return { replay: false, result: { status: 201, body } };
      },
      { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 },
    );
    if (result.replay)
      await this.removeOwnedUpload(
        request.requestId,
        'idempotent-replay',
        owned,
      );
    return result.result;
  }

  private async rejectIntent(
    request: StaffRequest,
    inquiryId: string,
    intentId: string,
    source: string,
    failure: StaffError,
  ) {
    const deniedReason =
      failure.code === 'FILE_TOO_LARGE'
        ? 'REQUEST_TOO_LARGE'
        : failure.code === 'IMPORT_LIMIT_EXCEEDED' ||
            failure.code === 'RATE_LIMITED'
          ? 'UPLOAD_QUOTA_EXCEEDED'
          : failure.code === 'DEPENDENCY_UNAVAILABLE'
            ? 'DEPENDENCY_UNAVAILABLE'
            : 'FILE_TYPE_NOT_ALLOWED';
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM inquiry WHERE id=${inquiryId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM inquiry_upload_intent WHERE id=${intentId}::uuid AND inquiry_id=${inquiryId}::uuid FOR UPDATE`;
      const row = await tx.inquiryUploadIntent.findUnique({
        where: { id: intentId },
      });
      if (!row || row.state !== 'RECEIVING') return;
      await tx.inquiryUploadIntent.update({
        where: { id: intentId },
        data: {
          state: 'FAILED',
          version: { increment: 1 },
        },
      });
      await createAuditEvent(tx, {
        actorKind: 'ANONYMOUS',
        action: 'inquiry.upload.rejected',
        entityType: 'InquiryUploadIntent',
        entityId: intentId,
        outcome:
          failure.code === 'DEPENDENCY_UNAVAILABLE' ? 'FAILURE' : 'DENIED',
        reasonCode: deniedReason,
        requestId: request.requestId,
        sourceHash: Buffer.from(source, 'hex'),
        changes: {
          previousState: row.state,
          state: 'FAILED',
          version: row.version + 1,
        },
      });
    });
  }

  private async removeOwnedUpload(
    requestId: string,
    stage: string,
    owned: OwnedStorageWrite,
  ) {
    try {
      await this.storage.removeOwned(owned);
    } catch {
      this.logger.warn(
        `Inquiry upload cleanup failed requestId=${requestId} stage=${stage} result=ORPHAN_RETAINED_PRIVATE; owned sweeper required.`,
      );
    }
  }
}

type XlsxEntry = {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  nameLength: number;
  localDataEnd: number;
};

export const INQUIRY_UPLOAD_BUFFER_LIMITS = Object.freeze({
  maxApplicationBytesPerStream: 1024 * 1024,
  maxInputChunkBytes: 128 * 1024,
  readableQueueBytes: 128 * 1024,
  writableQueueBytes: 128 * 1024,
  retainedTailBytes: 128 * 1024,
  retainedPrefixBytes: 8 * 1024,
  pdfScanCarryBytes: 16 * 1024,
  pdfScanScratchBytes: 2 * (128 * 1024 + 16 * 1024),
});

export class UploadMeter extends Transform {
  private size = 0;
  private readonly prefix: Buffer[] = [];
  private prefixLength = 0;
  private readonly tail = Buffer.alloc(
    INQUIRY_UPLOAD_BUFFER_LIMITS.retainedTailBytes,
  );
  private tailOffset = 0;
  private tailLength = 0;
  private pdfScanTail = Buffer.alloc(0);
  private pdfHasObject = false;
  private pdfHasCatalog = false;
  private pdfHasPageTree = false;
  private pdfHasTrailerRoot = false;
  private xlsxEntries: XlsxEntry[] | null = null;
  private xlsxDirectoryOffset: number | null = null;
  private readonly csvDecoder: TextDecoder | null;
  constructor(
    private readonly expectedSize: number,
    private readonly maxBytes: number,
    validateCsv: boolean,
    private readonly validateXlsx: boolean,
    private readonly validatePdf: boolean,
  ) {
    super({
      readableHighWaterMark: INQUIRY_UPLOAD_BUFFER_LIMITS.readableQueueBytes,
      writableHighWaterMark: INQUIRY_UPLOAD_BUFFER_LIMITS.writableQueueBytes,
    });
    this.csvDecoder = validateCsv
      ? new TextDecoder('utf-8', { fatal: true })
      : null;
  }
  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ) {
    this.size += chunk.length;
    if (chunk.length > INQUIRY_UPLOAD_BUFFER_LIMITS.maxInputChunkBytes) {
      callback(new Error('UPLOAD_CHUNK_LIMIT'));
      return;
    }
    if (this.size > this.maxBytes || this.size > this.expectedSize) {
      callback(new Error('UPLOAD_SIZE_LIMIT'));
      return;
    }
    if (this.csvDecoder) {
      try {
        if (chunk.includes(0)) throw new Error('CSV_NUL_BYTE');
        this.csvDecoder.decode(chunk, { stream: true });
      } catch {
        callback(new Error('CSV_INVALID_UTF8'));
        return;
      }
    }
    if (this.validatePdf) this.scanPdfStructures(chunk);
    if (this.prefixLength < 8192) {
      const slice = chunk.subarray(
        0,
        Math.min(
          chunk.length,
          INQUIRY_UPLOAD_BUFFER_LIMITS.retainedPrefixBytes - this.prefixLength,
        ),
      );
      this.prefix.push(Buffer.from(slice));
      this.prefixLength += slice.length;
    }
    this.retainTail(chunk);
    callback(null, chunk);
  }
  _flush(callback: (error?: Error | null) => void) {
    try {
      this.csvDecoder?.decode();
      callback();
    } catch {
      callback(new Error('CSV_INVALID_UTF8'));
    }
  }
  detectedMime() {
    const bytes = Buffer.concat(this.prefix, this.prefixLength);
    if (
      /^%PDF-(?:1\.[0-7]|2\.0)\r?\n/.test(bytes.toString('ascii')) &&
      this.pdfHasValidStructure()
    )
      return 'application/pdf';
    if (this.validateXlsx && this.hasXlsxCentralDirectory())
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (bytes.length > 0 && !bytes.includes(0)) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return 'text/csv';
      } catch {
        return null;
      }
    }
    return null;
  }

  async validateStoredStructure(
    storageKey: string,
    storage: PrivateFileStorage,
  ) {
    const detected = this.detectedMime();
    if (detected === 'text/csv') return true;
    if (detected === 'application/pdf') {
      const target = this.pdfStartXrefTarget();
      if (target === null) return false;
      const [bytes] = await storage.readInquiryQuarantineRanges(storageKey, [
        { offset: target, length: 16 * 1024 },
      ]);
      if (!bytes) return false;
      const text = bytes.toString('latin1');
      return (
        /^xref\s+\d+\s+\d+\s/.test(text) ||
        (/^\d+\s+\d+\s+obj\b/.test(text) && /\/Type\s*\/XRef\b/.test(text))
      );
    }
    if (
      detected !==
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      !this.xlsxEntries ||
      this.xlsxDirectoryOffset === null
    )
      return false;

    const headerRanges: StorageByteRange[] = this.xlsxEntries.map((entry) => ({
      offset: entry.localHeaderOffset,
      length: 30,
    }));
    const localHeaders = await storage.readInquiryQuarantineRanges(
      storageKey,
      headerRanges,
    );
    const variableRanges: StorageByteRange[] = [];
    let metadataBytes = 0;
    for (let index = 0; index < this.xlsxEntries.length; index++) {
      const entry = this.xlsxEntries[index]!;
      const header = localHeaders[index]!;
      if (
        header.length !== 30 ||
        header.readUInt32LE(0) !== 0x04034b50 ||
        header.readUInt16LE(6) !== entry.flags ||
        header.readUInt16LE(8) !== entry.method ||
        header.readUInt16LE(26) !== entry.nameLength
      )
        return false;
      const localCrc = header.readUInt32LE(14);
      const localCompressed = header.readUInt32LE(18);
      const localUncompressed = header.readUInt32LE(22);
      const hasDataDescriptor = (entry.flags & 0x0008) !== 0;
      if (
        (hasDataDescriptor
          ? localCrc !== 0 && localCrc !== entry.crc32
          : localCrc !== entry.crc32) ||
        (hasDataDescriptor
          ? localCompressed !== 0 && localCompressed !== entry.compressedSize
          : localCompressed !== entry.compressedSize) ||
        (hasDataDescriptor
          ? localUncompressed !== 0 &&
            localUncompressed !== entry.uncompressedSize
          : localUncompressed !== entry.uncompressedSize)
      )
        return false;
      const localExtraLength = header.readUInt16LE(28);
      const rangeLength = entry.nameLength + localExtraLength;
      metadataBytes += rangeLength;
      if (metadataBytes > 512 * 1024) return false;
      variableRanges.push({
        offset: entry.localHeaderOffset + 30,
        length: rangeLength,
      });
      const dataEnd =
        entry.localHeaderOffset + 30 + rangeLength + entry.compressedSize;
      if (dataEnd > this.xlsxDirectoryOffset) return false;
      entry.localDataEnd = dataEnd;
    }
    const localVariableData = await storage.readInquiryQuarantineRanges(
      storageKey,
      variableRanges,
    );
    for (let index = 0; index < this.xlsxEntries.length; index++) {
      const entry = this.xlsxEntries[index]!;
      const variable = localVariableData[index]!;
      const name = variable.subarray(0, entry.nameLength);
      if (
        variable.length !==
          entry.nameLength + localHeaders[index]!.readUInt16LE(28) ||
        name.toString('utf8') !== entry.name
      )
        return false;
    }
    const sorted = [...this.xlsxEntries].sort(
      (left, right) => left.localHeaderOffset - right.localHeaderOffset,
    );
    for (let index = 1; index < sorted.length; index++)
      if (sorted[index - 1]!.localDataEnd! > sorted[index]!.localHeaderOffset)
        return false;
    return true;
  }

  private scanPdfStructures(chunk: Buffer) {
    const carry = this.pdfScanTail;
    const bytes = Buffer.concat([carry, chunk]);
    const text = bytes.toString('latin1');
    this.pdfHasObject ||= /\b\d+\s+\d+\s+obj\b/.test(text);
    this.pdfHasCatalog ||= /\/Type\s*\/Catalog\b/.test(text);
    this.pdfHasPageTree ||=
      /\/Type\s*\/Pages\b/.test(text) &&
      /\/Kids\s*\[/.test(text) &&
      /\/Count\s+\d+/.test(text);
    this.pdfHasTrailerRoot ||= /\/Root\s+\d+\s+\d+\s+R\b/.test(text);
    const carryLength = Math.min(
      bytes.length,
      INQUIRY_UPLOAD_BUFFER_LIMITS.pdfScanCarryBytes,
    );
    this.pdfScanTail = Buffer.from(bytes.subarray(bytes.length - carryLength));
  }

  private retainTail(chunk: Buffer) {
    const capacity = this.tail.length;
    if (chunk.length >= capacity) {
      chunk.copy(this.tail, 0, chunk.length - capacity);
      this.tailOffset = 0;
      this.tailLength = capacity;
      return;
    }
    const overflow = Math.max(0, this.tailLength + chunk.length - capacity);
    this.tailOffset = (this.tailOffset + overflow) % capacity;
    this.tailLength -= overflow;
    const end = (this.tailOffset + this.tailLength) % capacity;
    const firstLength = Math.min(chunk.length, capacity - end);
    chunk.copy(this.tail, end, 0, firstLength);
    if (firstLength < chunk.length)
      chunk.copy(this.tail, 0, firstLength, chunk.length);
    this.tailLength += chunk.length;
  }

  private tailBytes() {
    const firstLength = Math.min(
      this.tailLength,
      this.tail.length - this.tailOffset,
    );
    return Buffer.concat(
      [
        this.tail.subarray(this.tailOffset, this.tailOffset + firstLength),
        this.tail.subarray(0, this.tailLength - firstLength),
      ],
      this.tailLength,
    );
  }

  private pdfStartXrefTarget() {
    if (this.size < 32) return null;
    const match = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(
      this.tailBytes().toString('latin1'),
    );
    if (!match) return null;
    const target = Number(match[1]);
    return Number.isSafeInteger(target) && target >= 0 && target < this.size
      ? target
      : null;
  }

  private pdfHasValidStructure() {
    const target = this.pdfStartXrefTarget();
    return (
      target !== null &&
      this.pdfHasObject &&
      this.pdfHasCatalog &&
      this.pdfHasPageTree &&
      this.pdfHasTrailerRoot
    );
  }

  private hasXlsxCentralDirectory() {
    const tail = this.tailBytes();
    const tailStart = this.size - tail.length;
    const minOffset = Math.max(0, tail.length - 65_557);
    let endRecord = -1;
    for (let offset = tail.length - 22; offset >= minOffset; offset--) {
      if (tail.readUInt32LE(offset) !== 0x06054b50) continue;
      const commentLength = tail.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === tail.length) {
        endRecord = offset;
        break;
      }
    }
    if (endRecord < 0) return false;
    const diskNumber = tail.readUInt16LE(endRecord + 4);
    const directoryDisk = tail.readUInt16LE(endRecord + 6);
    const entriesOnDisk = tail.readUInt16LE(endRecord + 8);
    const entryCount = tail.readUInt16LE(endRecord + 10);
    const directorySize = tail.readUInt32LE(endRecord + 12);
    const directoryOffset = tail.readUInt32LE(endRecord + 16);
    const endRecordOffset = tailStart + endRecord;
    if (
      diskNumber !== 0 ||
      directoryDisk !== 0 ||
      entriesOnDisk !== entryCount ||
      entryCount === 0 ||
      entryCount === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff ||
      directoryOffset + directorySize !== endRecordOffset ||
      directoryOffset < tailStart
    )
      return false;
    let offset = directoryOffset - tailStart;
    const directoryEnd = offset + directorySize;
    const names = new Set<string>();
    const entries: XlsxEntry[] = [];
    for (let index = 0; index < entryCount; index++) {
      if (
        offset + 46 > directoryEnd ||
        tail.readUInt32LE(offset) !== 0x02014b50
      )
        return false;
      const flags = tail.readUInt16LE(offset + 8);
      const method = tail.readUInt16LE(offset + 10);
      const crc32 = tail.readUInt32LE(offset + 16);
      const compressedSize = tail.readUInt32LE(offset + 20);
      const uncompressedSize = tail.readUInt32LE(offset + 24);
      const nameLength = tail.readUInt16LE(offset + 28);
      const extraLength = tail.readUInt16LE(offset + 30);
      const commentLength = tail.readUInt16LE(offset + 32);
      const diskStart = tail.readUInt16LE(offset + 34);
      const localHeaderOffset = tail.readUInt32LE(offset + 42);
      const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
      if (
        recordEnd > directoryEnd ||
        nameLength === 0 ||
        diskStart !== 0 ||
        localHeaderOffset >= directoryOffset ||
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        (flags & ~0x0808) !== 0 ||
        ![0, 8].includes(method)
      )
        return false;
      const filename = tail.subarray(offset + 46, offset + 46 + nameLength);
      if (filename.includes(0) || filename.includes(0x5c)) return false;
      let name: string;
      try {
        name = new TextDecoder('utf-8', { fatal: true }).decode(filename);
      } catch {
        return false;
      }
      if (
        name.startsWith('/') ||
        name.split('/').some((part) => part === '..') ||
        names.has(name)
      )
        return false;
      names.add(name);
      entries.push({
        name,
        flags,
        method,
        crc32,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        nameLength,
        localDataEnd: 0,
      });
      offset = recordEnd;
    }
    const valid =
      offset === directoryEnd &&
      names.has('[Content_Types].xml') &&
      names.has('xl/workbook.xml');
    if (valid) {
      this.xlsxEntries = entries;
      this.xlsxDirectoryOffset = directoryOffset;
    }
    return valid;
  }
}
