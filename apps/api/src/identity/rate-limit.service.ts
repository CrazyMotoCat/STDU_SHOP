import { Inject, Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS } from '../database/database.module.js';
import { readConfig } from '../config.js';
import { StaffError } from './errors.js';
import { hmac } from './crypto.js';
import type { StaffRequest } from './request.js';

const consumeScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count > tonumber(ARGV[1]) and 1 or 0, ttl, count}
`;

const beginLoginScript = `
local sourceTotal = redis.call('INCR', KEYS[1])
if sourceTotal == 1 then redis.call('PEXPIRE', KEYS[1], 600000) end
local inflight = {}
for i=5,7 do
  local value = redis.call('INCR', KEYS[i])
  if value == 1 then redis.call('PEXPIRE', KEYS[i], 30000) end
  inflight[#inflight+1] = value
end
local failSource = tonumber(redis.call('GET', KEYS[2]) or '0')
local failAccount = tonumber(redis.call('GET', KEYS[3]) or '0')
local failPair = tonumber(redis.call('GET', KEYS[4]) or '0')
local limited = sourceTotal > 60 or failSource + inflight[1] > 30 or failAccount + inflight[2] > 10 or failPair + inflight[3] > 5
if limited then
  for i=5,7 do redis.call('DECR', KEYS[i]) end
  return {1, math.max(redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2]), redis.call('PTTL', KEYS[3]), redis.call('PTTL', KEYS[4])), sourceTotal}
end
return {0, 0, math.max(inflight[1], inflight[2], inflight[3])}
`;

const finishLoginScript = `
for i=1,3 do
  local value = tonumber(redis.call('GET', KEYS[i+3]) or '0')
  if value > 0 then redis.call('DECR', KEYS[i+3]) end
end
if ARGV[1] == 'success' then
  redis.call('DEL', KEYS[2], KEYS[3])
elseif ARGV[1] == 'failure' then
  local source = redis.call('INCR', KEYS[1])
  if source == 1 then redis.call('PEXPIRE', KEYS[1], 600000) end
  local account = redis.call('INCR', KEYS[2])
  if account == 1 then redis.call('PEXPIRE', KEYS[2], 600000) end
  local pair = redis.call('INCR', KEYS[3])
  if pair == 1 then redis.call('PEXPIRE', KEYS[3], 300000) end
end
return 1
`;

const passwordChangeScript = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now - 900000)
local byUser = redis.call('INCR', KEYS[1])
if byUser == 1 then redis.call('PEXPIRE', KEYS[1], 900000) end
local bySource = redis.call('INCR', KEYS[2])
if bySource == 1 then redis.call('PEXPIRE', KEYS[2], 900000) end
local failures = tonumber(redis.call('GET', KEYS[3]) or '0')
local inFlight = redis.call('ZCARD', KEYS[4])
if byUser > 10 or bySource > 20 or failures + inFlight >= 5 then
  redis.call('DECR', KEYS[1])
  redis.call('DECR', KEYS[2])
  return {1, math.max(redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2]), redis.call('PTTL', KEYS[3]), 900000)}
end
redis.call('ZADD', KEYS[4], now, ARGV[1])
redis.call('PEXPIRE', KEYS[4], 900000)
return {0, 0}
`;

const finishPasswordChangeScript = `
local removed = redis.call('ZREM', KEYS[1], ARGV[2])
if removed == 0 then return tonumber(redis.call('GET', KEYS[2]) or '0') end
if ARGV[1] == 'failure' then
  local failures = redis.call('INCR', KEYS[2])
  if failures == 1 then redis.call('PEXPIRE', KEYS[2], 900000) end
  return failures
elseif ARGV[1] == 'success' then
  redis.call('DEL', KEYS[2])
end
return tonumber(redis.call('GET', KEYS[2]) or '0')
`;

export interface LoginReservation {
  failedSource: string;
  failedAccount: string;
  failedPair: string;
  inflightSource: string;
  inflightAccount: string;
  inflightPair: string;
  count: number;
}

export interface PasswordChangeReservation {
  userFingerprint: string;
  reservationId: string;
  inflightKey: string;
  failedKey: string;
}

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async preauthChallenge(request: StaffRequest) {
    const key = this.key(
      'preauth',
      this.fingerprint(
        'source',
        resolveRateLimitSourceAddress(request, readConfig(process.env)),
      ),
    );
    const result = await this.consume(key, 60, 600_000);
    if (result.limited) throw this.limited(result.retryAfter);
  }

  async beginLogin(request: StaffRequest, emailNormalized: string) {
    const source = this.fingerprint(
      'source',
      resolveRateLimitSourceAddress(request, readConfig(process.env)),
    );
    const account = this.fingerprint('account', emailNormalized);
    const pair = this.fingerprint('pair', `${source}:${account}`);
    const reservation: LoginReservation = {
      failedSource: this.key('login-failed-source', source),
      failedAccount: this.key('login-failed-account', account),
      failedPair: this.key('login-failed-pair', pair),
      inflightSource: this.key('login-inflight-source', source),
      inflightAccount: this.key('login-inflight-account', account),
      inflightPair: this.key('login-inflight-pair', pair),
      count: 0,
    };
    const result = await this.redisResult(() =>
      this.redis.eval(
        beginLoginScript,
        7,
        this.key('login-total-source', source),
        reservation.failedSource,
        reservation.failedAccount,
        reservation.failedPair,
        reservation.inflightSource,
        reservation.inflightAccount,
        reservation.inflightPair,
      ),
    );
    const [limited, retryMs, count] = result as [number, number, number];
    reservation.count = count;
    if (limited) throw this.limited(Math.max(1, Math.ceil(retryMs / 1000)));
    return reservation;
  }

  async finishLogin(
    reservation: LoginReservation,
    outcome: 'success' | 'failure' | 'neutral',
  ) {
    await this.redisResult(() =>
      this.redis.eval(
        finishLoginScript,
        6,
        reservation.failedSource,
        reservation.failedAccount,
        reservation.failedPair,
        reservation.inflightSource,
        reservation.inflightAccount,
        reservation.inflightPair,
        outcome,
      ),
    );
  }

  async passwordChange(request: StaffRequest, userId: string) {
    const source = this.fingerprint(
      'source',
      resolveRateLimitSourceAddress(request, readConfig(process.env)),
    );
    const user = this.fingerprint('password-user', userId);
    const attemptKey = this.key('password-attempt-user', user);
    const sourceKey = this.key('password-attempt-source', source);
    const failedKey = this.key('password-failures', user);
    const inflightKey = this.key('password-inflight', user);
    const reservationId = randomUUID();
    const result = (await this.redisResult(() =>
      this.redis.eval(
        passwordChangeScript,
        4,
        attemptKey,
        sourceKey,
        failedKey,
        inflightKey,
        reservationId,
      ),
    )) as [number, number];
    if (result[0]) throw this.limited(Math.max(1, Math.ceil(result[1] / 1000)));
    return { userFingerprint: user, reservationId, inflightKey, failedKey };
  }

  async finishPasswordChange(
    reservation: PasswordChangeReservation,
    outcome: 'success' | 'failure' | 'neutral',
  ) {
    return (await this.redisResult(() =>
      this.redis.eval(
        finishPasswordChangeScript,
        2,
        reservation.inflightKey,
        reservation.failedKey,
        outcome,
        reservation.reservationId,
      ),
    )) as number;
  }

  private async consume(key: string, limit: number, windowMs: number) {
    const result = (await this.redisResult(() =>
      this.redis.eval(consumeScript, 1, key, limit, windowMs),
    )) as [number, number, number];
    return {
      limited: result[0] === 1,
      retryAfter: Math.max(1, Math.ceil(result[1] / 1000)),
      count: result[2],
    };
  }

  private async redisResult<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    }
  }

  private limited(retryAfter: number) {
    return new StaffError('RATE_LIMITED', undefined, retryAfter);
  }

  private fingerprint(label: string, value: string) {
    return hmac(
      readConfig(process.env).rateLimitKey,
      `${label}\0${value}`,
    ).toString('hex');
  }

  private key(kind: string, fingerprint: string) {
    return `stdu:rate:${kind}:${fingerprint}`;
  }
}

export function resolveRateLimitSourceAddress(
  request: Pick<StaffRequest, 'socket' | 'headers'>,
  config: ReturnType<typeof readConfig>,
) {
  const remoteAddress = request.socket.remoteAddress ?? 'unknown';
  if (
    !config.trustedProxyAddress ||
    remoteAddress !== config.trustedProxyAddress
  )
    return remoteAddress;
  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded !== 'string') return remoteAddress;
  const address = forwarded.trim();
  return !address.includes(',') && isIP(address) !== 0
    ? address
    : remoteAddress;
}
