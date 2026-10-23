import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AuditService, createAuditEvent } from '../audit/audit.service.js';
import {
  DATABASE,
  PrismaDatabase,
  REDIS,
} from '../database/database.module.js';
import { readConfig } from '../config.js';
import {
  assertAdminInvariants,
  acquireAdminInvariantLock,
  assertCurrentActor,
  lockStaffSessionRows,
  lockStaffUserRows,
} from '../permissions/policy.js';
import { StaffError } from './errors.js';
import {
  IdentityCrypto,
  csrfToken,
  hmac,
  loginCsrfBinding,
  normalizeEmail,
  rawSessionToken,
  staffCsrfBinding,
  validEmail,
  validatePassword,
} from './crypto.js';
import {
  challengeCookieName,
  clearHttpOnlyCookie,
  cookieValue,
  sessionCookieName,
  setHttpOnlyCookie,
} from './cookies.js';
import {
  RateLimitService,
  resolveRateLimitSourceAddress,
} from './rate-limit.service.js';
import type { StaffPrincipal, StaffRequest } from './request.js';

const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const SESSION_IDLE_SECONDS = 30 * 60;
const SESSION_LIMIT = 5;

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: PrismaDatabase,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(IdentityCrypto) private readonly crypto: IdentityCrypto,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.crypto.initialize();
  }

  async getCsrf(request: StaffRequest, response: Response) {
    const config = readConfig(process.env);
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin))
      throw new StaffError('ORIGIN_FORBIDDEN');
    if (request.staff) {
      const raw = this.sessionRaw(request, config);
      if (!raw) throw new StaffError('AUTH_REQUIRED');
      clearHttpOnlyCookie(response, config, challengeCookieName(config));
      return {
        data: {
          token: csrfToken(
            config.sessionHmacKey,
            'staff-csrf-v1',
            staffCsrfBinding(request.staff.sessionId, raw),
          ),
          context: 'STAFF' as const,
        },
        meta: { requestId: request.requestId },
      };
    }

    await this.rateLimit.preauthChallenge(request);
    const challenge = rawSessionToken();
    try {
      const result = await this.redis.set(
        `stdu:csrf:challenge:${challenge.hash.toString('hex')}`,
        'active',
        'EX',
        600,
        'NX',
      );
      if (result !== 'OK') throw new StaffError('DEPENDENCY_UNAVAILABLE');
    } catch (error) {
      if (error instanceof StaffError) throw error;
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    }
    setHttpOnlyCookie(
      response,
      config,
      challengeCookieName(config),
      challenge.encoded,
      600,
    );
    return {
      data: {
        token: csrfToken(
          config.sessionHmacKey,
          'login-csrf-v1',
          loginCsrfBinding(challenge.raw),
        ),
        context: 'LOGIN' as const,
      },
      meta: { requestId: request.requestId },
    };
  }

  async login(
    request: StaffRequest,
    response: Response,
    input: { email: string; password: string },
  ) {
    const config = readConfig(process.env);
    const emailNormalized = normalizeEmail(input.email);
    const accountFingerprint = hmac(
      config.rateLimitKey,
      `account\0${emailNormalized}`,
    ).toString('hex');
    const sourceHash = hmac(
      config.rateLimitKey,
      `source\0${resolveRateLimitSourceAddress(request, config)}`,
    );
    if (request.staff) {
      await this.audit.writeDenied({
        actorKind: 'STAFF',
        actorUserId: request.staff.id,
        action: 'auth.login',
        outcome: 'DENIED',
        reasonCode: 'ALREADY_AUTHENTICATED',
        requestId: request.requestId,
        changes: { accountFingerprint },
      });
      throw new StaffError('ALREADY_AUTHENTICATED');
    }
    if (!validEmail(emailNormalized)) throw new StaffError('VALIDATION_ERROR');

    const reservation = await this.rateLimit.beginLogin(
      request,
      emailNormalized,
    );
    let reservationFinished = false;
    try {
      const user = await this.db.staffUser.findUnique({
        where: { emailNormalized },
        select: {
          id: true,
          email: true,
          emailNormalized: true,
          displayName: true,
          passwordHash: true,
          passwordChangeRequired: true,
          state: true,
          authVersion: true,
        },
      });
      const usable =
        !!user &&
        user.state === 'ACTIVE' &&
        this.crypto.isUsableHash(user.passwordHash);
      const verified = usable
        ? await this.crypto.verify(user!.passwordHash, input.password)
        : await this.crypto.verifyDummy(input.password);
      if (!user || user.state !== 'ACTIVE' || !verified) {
        await this.rateLimit.finishLogin(reservation, 'failure');
        reservationFinished = true;
        await this.audit.writeDenied({
          actorKind: 'ANONYMOUS',
          action: 'auth.login',
          outcome: 'DENIED',
          reasonCode: 'INVALID_CREDENTIALS',
          requestId: request.requestId,
          sourceHash,
          changes: { accountFingerprint },
        });
        await delay(Math.min(2000, 250 * Math.max(1, reservation.count)));
        throw new StaffError('INVALID_CREDENTIALS');
      }

      const token = rawSessionToken();
      const outcome = await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM staff_user WHERE id = ${user.id}::uuid FOR UPDATE`;
          const current = await tx.staffUser.findUnique({
            where: { id: user.id },
          });
          if (
            !current ||
            current.state !== 'ACTIVE' ||
            current.authVersion !== user.authVersion ||
            current.passwordHash !== user.passwordHash
          ) {
            await createAuditEvent(tx, {
              actorKind: 'ANONYMOUS',
              action: 'auth.login',
              outcome: 'DENIED',
              reasonCode: 'INVALID_CREDENTIALS',
              requestId: request.requestId,
              sourceHash,
              changes: { accountFingerprint },
            });
            await this.rateLimit.finishLogin(reservation, 'failure');
            return { accepted: false as const };
          }

          const clockRows = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT clock_timestamp() AS now`;
          const now = clockRows[0]?.now;
          if (!now) throw new StaffError('DEPENDENCY_UNAVAILABLE');
          const active = await tx.$queryRaw<{ id: string; createdAt: Date }[]>`
          SELECT id::text AS id, created_at AS "createdAt"
          FROM staff_session
          WHERE staff_user_id = ${user.id}::uuid AND revoked_at IS NULL
            AND absolute_expires_at > ${now}
            AND last_seen_at + make_interval(secs => idle_timeout_seconds) > ${now}
          ORDER BY created_at ASC, id ASC
          FOR UPDATE
        `;
          const revokeCount = Math.max(0, active.length - (SESSION_LIMIT - 1));
          const revoke = active.slice(0, revokeCount);
          if (revoke.length) {
            await tx.staffSession.updateMany({
              where: {
                id: { in: revoke.map(({ id }) => id) },
                revokedAt: null,
              },
              data: { revokedAt: now, revocationReason: 'SESSION_LIMIT' },
            });
            await createAuditEvent(tx, {
              actorKind: 'STAFF',
              actorUserId: user.id,
              action: 'staff.sessions.revoked',
              entityType: 'StaffSession',
              entityId: revoke[0]!.id,
              outcome: 'SUCCESS',
              reasonCode: 'SESSION_LIMIT',
              requestId: request.requestId,
              changes: { targetUserId: user.id, count: revoke.length },
            });
          }

          const sessionId = randomUUID();
          await tx.staffSession.create({
            data: {
              id: sessionId,
              staffUserId: user.id,
              tokenHash: new Uint8Array(token.hash),
              authVersion: current.authVersion,
              absoluteExpiresAt: new Date(
                now.getTime() + SESSION_MAX_AGE_SECONDS * 1000,
              ),
              idleTimeoutSeconds: SESSION_IDLE_SECONDS,
              lastSeenAt: now,
            },
          });
          await createAuditEvent(tx, {
            actorKind: 'STAFF',
            actorUserId: user.id,
            action: 'auth.login',
            entityType: 'StaffUser',
            entityId: user.id,
            outcome: 'SUCCESS',
            reasonCode: 'CREDENTIALS_VERIFIED',
            requestId: request.requestId,
            sourceHash,
            changes: { accountFingerprint },
          });
          await this.rateLimit.finishLogin(reservation, 'success');
          return {
            accepted: true as const,
            sessionId,
            current: {
              id: current.id,
              email: current.email,
              displayName: current.displayName,
              passwordChangeRequired: current.passwordChangeRequired,
            },
          };
        },
        { isolationLevel: 'ReadCommitted' },
      );
      reservationFinished = true;
      if (!outcome.accepted) throw new StaffError('INVALID_CREDENTIALS');
      setHttpOnlyCookie(
        response,
        config,
        sessionCookieName(config),
        token.encoded,
        SESSION_MAX_AGE_SECONDS,
      );
      clearHttpOnlyCookie(response, config, challengeCookieName(config));
      return {
        data: {
          id: outcome.current.id,
          email: outcome.current.email,
          displayName: outcome.current.displayName,
          state: 'ACTIVE',
          passwordChangeRequired: outcome.current.passwordChangeRequired,
        },
        meta: { requestId: request.requestId },
      };
    } catch (error) {
      if (!reservationFinished)
        await this.rateLimit
          .finishLogin(reservation, 'neutral')
          .catch(() => undefined);
      if (error instanceof StaffError) throw error;
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    } finally {
      clearHttpOnlyCookie(response, config, challengeCookieName(config));
    }
  }

  async logout(request: StaffRequest, response: Response) {
    const config = readConfig(process.env);
    const principal = this.requirePrincipal(request);
    try {
      await this.db.$transaction(
        async (tx) => {
          await lockStaffUserRows(tx, [principal.id]);
          await lockStaffSessionRows(tx, [], [principal.sessionId]);
          const rows = await tx.$queryRaw<LogoutSession[]>`
          SELECT s.id::text AS id, s.revoked_at AS "revokedAt", u.state,
                 s.auth_version AS "sessionAuthVersion", u.auth_version AS "userAuthVersion"
          FROM staff_session s JOIN staff_user u ON u.id = s.staff_user_id
          WHERE s.id = ${principal.sessionId}::uuid AND u.id = ${principal.id}::uuid
        `;
          const row = rows[0];
          if (
            !row ||
            row.revokedAt ||
            row.state !== 'ACTIVE' ||
            row.sessionAuthVersion !== row.userAuthVersion
          )
            throw new StaffError('AUTH_REQUIRED');
          const clockRows = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT clock_timestamp() AS now`;
          const now = clockRows[0]?.now;
          if (!now) throw new StaffError('DEPENDENCY_UNAVAILABLE');
          const valid = await tx.$queryRaw<{ live: boolean }[]>`
          SELECT absolute_expires_at > ${now} AND
                 last_seen_at + make_interval(secs => idle_timeout_seconds) > ${now} AS live
          FROM staff_session WHERE id = ${row.id}::uuid
        `;
          if (!valid[0]?.live) throw new StaffError('AUTH_REQUIRED');
          await tx.staffSession.update({
            where: { id: row.id },
            data: { revokedAt: now, revocationReason: 'LOGOUT' },
          });
          await createAuditEvent(tx, {
            actorKind: 'STAFF',
            actorUserId: principal.id,
            action: 'auth.logout',
            entityType: 'StaffSession',
            entityId: row.id,
            outcome: 'SUCCESS',
            reasonCode: 'LOGOUT',
            requestId: request.requestId,
          });
        },
        { isolationLevel: 'ReadCommitted' },
      );
    } catch (error) {
      if (error instanceof StaffError) {
        if (error.code === 'AUTH_REQUIRED')
          clearHttpOnlyCookie(response, config, sessionCookieName(config));
        throw error;
      }
      throw new StaffError('AUDIT_UNAVAILABLE');
    }
    clearHttpOnlyCookie(response, config, sessionCookieName(config));
    clearHttpOnlyCookie(response, config, challengeCookieName(config));
    return { data: { success: true }, meta: { requestId: request.requestId } };
  }

  async getMe(request: StaffRequest) {
    const principal = this.requirePrincipal(request);
    const user = await this.db.staffUser.findFirst({
      where: { id: principal.id, state: 'ACTIVE' },
      select: {
        id: true,
        email: true,
        displayName: true,
        passwordChangeRequired: true,
      },
    });
    if (!user) throw new StaffError('AUTH_REQUIRED');
    return {
      data: { ...user, state: 'ACTIVE' },
      meta: { requestId: request.requestId },
    };
  }

  async getMyPermissions(request: StaffRequest) {
    const principal = this.requirePrincipal(request);
    const permissions = principal.passwordChangeRequired
      ? []
      : await this.db.$queryRaw<{ code: string }[]>`
          SELECT DISTINCT p.code FROM user_role ur
          JOIN role r ON r.id = ur.role_id AND r.state = 'ACTIVE'
          JOIN role_permission rp ON rp.role_id = r.id
          JOIN permission p ON p.id = rp.permission_id
          JOIN staff_user u ON u.id = ur.staff_user_id AND u.state = 'ACTIVE'
          WHERE ur.staff_user_id = ${principal.id}::uuid ORDER BY p.code
        `;
    return {
      data: {
        permissions: Array.isArray(permissions)
          ? permissions.map(({ code }) => code)
          : [],
        passwordChangeRequired: principal.passwordChangeRequired,
      },
      meta: { requestId: request.requestId },
    };
  }

  async changePassword(
    request: StaffRequest,
    response: Response,
    input: { currentPassword: string; newPassword: string },
  ) {
    const config = readConfig(process.env);
    const principal = this.requirePrincipal(request);
    const attempt = await this.rateLimit.passwordChange(request, principal.id);
    let limiterFinished = false;
    try {
      const user = await this.db.staffUser.findUnique({
        where: { id: principal.id },
        select: { email: true, emailNormalized: true, passwordHash: true },
      });
      if (!user) throw new StaffError('AUTH_REQUIRED');
      const currentValid = await this.crypto.verify(
        user.passwordHash,
        input.currentPassword,
      );
      if (!currentValid) {
        const failures = await this.rateLimit.finishPasswordChange(
          attempt,
          'failure',
        );
        limiterFinished = true;
        await this.audit.writeDenied({
          actorKind: 'STAFF',
          actorUserId: principal.id,
          action: 'staff.password.changed',
          entityType: 'StaffUser',
          entityId: principal.id,
          outcome: 'DENIED',
          reasonCode: 'CURRENT_PASSWORD_INVALID',
          requestId: request.requestId,
          changes: { targetUserId: principal.id },
        });
        await delay(Math.min(2000, Math.max(1, failures) * 250));
        throw new StaffError('CURRENT_PASSWORD_INVALID');
      }
      await this.rateLimit.finishPasswordChange(attempt, 'success');
      limiterFinished = true;

      try {
        validatePassword(input.newPassword, user.emailNormalized);
        if (input.newPassword === input.currentPassword)
          throw new StaffError('VALIDATION_ERROR', [
            { field: 'newPassword', code: 'PASSWORD_REUSED' },
          ]);
      } catch (error) {
        if (!(error instanceof StaffError)) throw error;
        await this.audit.writeDenied({
          actorKind: 'STAFF',
          actorUserId: principal.id,
          action: 'staff.password.changed',
          entityType: 'StaffUser',
          entityId: principal.id,
          outcome: 'DENIED',
          reasonCode: 'VALIDATION_ERROR',
          requestId: request.requestId,
          changes: { targetUserId: principal.id },
        });
        throw error;
      }

      const passwordHash = await this.crypto.hashPassword(
        input.newPassword,
        user.emailNormalized,
      );
      const token = rawSessionToken();
      let newSessionId: string;
      let nextAuthVersion: number;
      let revokedCount: number;
      try {
        const outcome = await this.db.$transaction(
          async (tx) => {
            await acquireAdminInvariantLock(tx);
            await lockStaffUserRows(tx, [principal.id]);
            await lockStaffSessionRows(tx, [principal.id]);
            await assertCurrentActor(tx, principal, null, true, true);
            const current = await tx.staffUser.findUnique({
              where: { id: principal.id },
            });
            if (!current || current.passwordHash !== user.passwordHash)
              throw new StaffError('CURRENT_PASSWORD_INVALID');
            const clockRows = await tx.$queryRaw<
              { now: Date }[]
            >`SELECT clock_timestamp() AS now`;
            const now = clockRows[0]?.now;
            if (!now) throw new StaffError('DEPENDENCY_UNAVAILABLE');
            nextAuthVersion = current.authVersion + 1;
            const updated = await tx.staffUser.update({
              where: { id: principal.id },
              data: {
                passwordHash,
                passwordChangeRequired: false,
                authVersion: nextAuthVersion,
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            const revoked = await tx.staffSession.updateMany({
              where: { staffUserId: principal.id, revokedAt: null },
              data: { revokedAt: now, revocationReason: 'PASSWORD_CHANGED' },
            });
            revokedCount = revoked.count;
            newSessionId = randomUUID();
            await tx.staffSession.create({
              data: {
                id: newSessionId,
                staffUserId: principal.id,
                tokenHash: new Uint8Array(token.hash),
                authVersion: nextAuthVersion,
                absoluteExpiresAt: new Date(
                  now.getTime() + SESSION_MAX_AGE_SECONDS * 1000,
                ),
                idleTimeoutSeconds: SESSION_IDLE_SECONDS,
                lastSeenAt: now,
              },
            });
            await assertAdminInvariants(tx);
            await createAuditEvent(tx, {
              actorKind: 'STAFF',
              actorUserId: principal.id,
              action: 'staff.sessions.revoked',
              entityType: 'StaffUser',
              entityId: principal.id,
              outcome: 'SUCCESS',
              reasonCode: 'PASSWORD_CHANGED',
              requestId: request.requestId,
              changes: { targetUserId: principal.id, count: revokedCount },
            });
            await createAuditEvent(tx, {
              actorKind: 'STAFF',
              actorUserId: principal.id,
              action: 'auth.session.rotated',
              entityType: 'StaffUser',
              entityId: principal.id,
              outcome: 'SUCCESS',
              reasonCode: 'PASSWORD_CHANGED',
              requestId: request.requestId,
              changes: { targetUserId: principal.id },
            });
            await createAuditEvent(tx, {
              actorKind: 'STAFF',
              actorUserId: principal.id,
              action: 'staff.password.changed',
              entityType: 'StaffUser',
              entityId: principal.id,
              outcome: 'SUCCESS',
              reasonCode: 'PASSWORD_CHANGED',
              requestId: request.requestId,
              changes: {
                targetUserId: principal.id,
                passwordChangeRequired: false,
              },
            });
            return updated;
          },
          { isolationLevel: 'ReadCommitted' },
        );
        const createdSessionId = newSessionId!;
        nextAuthVersion = outcome.authVersion;
        void createdSessionId;
      } catch (error) {
        if (error instanceof StaffError) {
          if (
            error.code === 'LAST_ADMIN_REQUIRED' ||
            error.code === 'CURRENT_PASSWORD_INVALID'
          ) {
            await this.audit.writeDenied({
              actorKind: 'STAFF',
              actorUserId: principal.id,
              action: 'staff.password.changed',
              entityType: 'StaffUser',
              entityId: principal.id,
              outcome: 'DENIED',
              reasonCode: error.code,
              requestId: request.requestId,
              changes: { targetUserId: principal.id },
            });
          }
          throw error;
        }
        throw new StaffError('AUDIT_UNAVAILABLE');
      }

      setHttpOnlyCookie(
        response,
        config,
        sessionCookieName(config),
        token.encoded,
        SESSION_MAX_AGE_SECONDS,
      );
      clearHttpOnlyCookie(response, config, challengeCookieName(config));
      return {
        data: {
          id: principal.id,
          email: user.email,
          displayName: principal.displayName,
          state: 'ACTIVE',
          passwordChangeRequired: false,
        },
        meta: { requestId: request.requestId },
      };
    } finally {
      if (!limiterFinished)
        await this.rateLimit
          .finishPasswordChange(attempt, 'neutral')
          .catch(() => undefined);
    }
  }

  private requirePrincipal(request: StaffRequest): StaffPrincipal {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    return request.staff;
  }

  private sessionRaw(
    request: StaffRequest,
    config: ReturnType<typeof readConfig>,
  ) {
    return this.decodeCookie(cookieValue(request, sessionCookieName(config)));
  }

  private decodeCookie(value: string | undefined) {
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    const raw = Buffer.from(value, 'base64url');
    return raw.length === 32 && raw.toString('base64url') === value
      ? raw
      : null;
  }
}

interface LogoutSession {
  id: string;
  revokedAt: Date | null;
  state: string;
  sessionAuthVersion: number;
  userAuthVersion: number;
}
