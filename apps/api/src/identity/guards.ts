import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Redis } from 'ioredis';
import {
  DATABASE,
  PrismaDatabase,
  REDIS,
} from '../database/database.module.js';
import { AuditInput, createAuditEvent } from '../audit/audit.service.js';
import { readConfig } from '../config.js';
import { StaffError } from './errors.js';
import { OPTIONAL_SESSION, REQUIRED_PERMISSION } from './authorization.js';
import {
  cookieValue,
  clearHttpOnlyCookie,
  challengeCookieName,
  sessionCookieName,
} from './cookies.js';
import {
  csrfToken,
  decodeSessionToken,
  loginCsrfBinding,
  matchesToken,
  sha256,
  staffCsrfBinding,
} from './crypto.js';
import type { StaffPrincipal, StaffRequest } from './request.js';

@Injectable()
export class StaffSessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: PrismaDatabase,
  ) {}

  async canActivate(context: ExecutionContext) {
    const optional = this.reflector.getAllAndOverride<boolean>(
      OPTIONAL_SESSION,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const response = context.switchToHttp().getResponse();
    const config = readConfig(process.env);
    const cookieName = sessionCookieName(config);
    const encoded = cookieValue(request, cookieName);
    const raw = decodeSessionToken(encoded);
    if (!raw) {
      if (encoded) clearHttpOnlyCookie(response, config, cookieName);
      if (optional) return true;
      throw new StaffError('AUTH_REQUIRED');
    }

    try {
      const result = await this.db.$transaction(
        async (tx) => {
          const candidate = await tx.$queryRaw<
            { sessionId: string; staffUserId: string }[]
          >`
          SELECT id::text AS "sessionId", staff_user_id::text AS "staffUserId"
          FROM staff_session WHERE token_hash = ${sha256(raw)}
        `;
          const initial = candidate[0];
          if (!initial) return null;
          await tx.$queryRaw`SELECT id FROM staff_user WHERE id = ${initial.staffUserId}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM staff_session WHERE id = ${initial.sessionId}::uuid FOR UPDATE`;
          const locked = await tx.$queryRaw<LockedSession[]>`
          SELECT s.id::text AS "sessionId", s.staff_user_id::text AS "staffUserId",
                 s.auth_version AS "sessionAuthVersion", s.absolute_expires_at AS "absoluteExpiresAt",
                 s.last_seen_at AS "lastSeenAt", s.idle_timeout_seconds AS "idleTimeoutSeconds",
                 s.revoked_at AS "revokedAt", u.email, u.display_name AS "displayName",
                 u.state AS "userState", u.auth_version AS "userAuthVersion",
                 u.password_change_required AS "passwordChangeRequired", u.password_hash AS "passwordHash"
          FROM staff_session s
          JOIN staff_user u ON u.id = s.staff_user_id
          WHERE s.id = ${initial.sessionId}::uuid AND u.id = ${initial.staffUserId}::uuid
        `;
          const row = locked[0];
          if (
            !row ||
            row.revokedAt ||
            row.userState !== 'ACTIVE' ||
            row.sessionAuthVersion !== row.userAuthVersion
          )
            return null;

          const decision = await tx.$queryRaw<SessionDecision[]>`
          WITH decision AS (SELECT clock_timestamp() AS now)
          SELECT decision.now AS "now",
                 (s.absolute_expires_at > decision.now) AS "absoluteLive",
                 (s.last_seen_at + make_interval(secs => s.idle_timeout_seconds) > decision.now) AS "idleLive"
          FROM staff_session s CROSS JOIN decision WHERE s.id = ${row.sessionId}::uuid
        `;
          const instant = decision[0];
          if (!instant) return null;
          if (!instant.absoluteLive || !instant.idleLive) {
            const reason = instant.absoluteLive
              ? 'SESSION_IDLE_EXPIRED'
              : 'SESSION_ABSOLUTE_EXPIRED';
            await tx.staffSession.update({
              where: { id: row.sessionId },
              data: { revokedAt: instant.now, revocationReason: reason },
            });
            const expiredAudit: AuditInput = {
              actorKind: 'ANONYMOUS',
              action: 'auth.session.expired',
              entityType: 'StaffSession',
              entityId: row.sessionId,
              outcome: 'DENIED',
              reasonCode: reason,
              requestId: request.requestId,
            };
            await createAuditEvent(tx, expiredAudit);
            return null;
          }

          const refreshed = await tx.$executeRaw`
          UPDATE staff_session s SET last_seen_at = ${instant.now}
          WHERE s.id = ${row.sessionId}::uuid AND s.revoked_at IS NULL
            AND s.auth_version = ${row.userAuthVersion}
            AND s.absolute_expires_at > ${instant.now}
            AND s.last_seen_at + make_interval(secs => s.idle_timeout_seconds) > ${instant.now}
            AND EXISTS (
              SELECT 1 FROM staff_user u WHERE u.id = s.staff_user_id
                AND u.state = 'ACTIVE' AND u.auth_version = s.auth_version
            )
        `;
          if (refreshed !== 1) return null;
          const permissions = await tx.$queryRaw<{ code: string }[]>`
          SELECT DISTINCT p.code
          FROM user_role ur
          JOIN role r ON r.id = ur.role_id AND r.state = 'ACTIVE'
          JOIN role_permission rp ON rp.role_id = r.id
          JOIN permission p ON p.id = rp.permission_id
          WHERE ur.staff_user_id = ${row.staffUserId}::uuid
          ORDER BY p.code
        `;
          const principal: StaffPrincipal = {
            id: row.staffUserId,
            email: row.email,
            displayName: row.displayName,
            passwordChangeRequired: row.passwordChangeRequired,
            authVersion: row.userAuthVersion,
            sessionId: row.sessionId,
            permissionCodes: permissions.map(({ code }) => code),
          };
          return principal;
        },
        { isolationLevel: 'ReadCommitted' },
      );
      if (!result) {
        clearHttpOnlyCookie(response, config, cookieName);
        if (optional) return true;
        throw new StaffError('AUTH_REQUIRED');
      }
      request.staff = result;
      return true;
    } catch (error) {
      if (error instanceof StaffError) throw error;
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    }
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const method = request.method.toUpperCase();
    const config = readConfig(process.env);
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin))
      throw new StaffError('ORIGIN_FORBIDDEN');

    const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (safeMethod) return true;
    const fetchSite = request.headers['sec-fetch-site'];
    if (
      typeof fetchSite === 'string' &&
      fetchSite.toLowerCase() === 'cross-site'
    )
      throw new StaffError('ORIGIN_FORBIDDEN');
    if (!origin || !config.allowedOrigins.includes(origin))
      throw new StaffError('ORIGIN_FORBIDDEN');

    const isLogin = request.path === '/v1/staff/auth/login';
    const rawContentType = request.headers['content-type'];
    const contentType = rawContentType?.split(';')[0]?.trim().toLowerCase();
    const permitsEmptyContentType =
      method === 'DELETE' || request.path === '/v1/staff/auth/logout';
    if (
      (!permitsEmptyContentType || rawContentType !== undefined) &&
      contentType !== 'application/json'
    )
      throw new StaffError('UNSUPPORTED_MEDIA_TYPE');
    if (isLogin) {
      if (request.staff) {
        const raw = decodeSessionToken(
          cookieValue(request, sessionCookieName(config)),
        );
        const supplied = request.headers['x-csrf-token'];
        if (
          !raw ||
          typeof supplied !== 'string' ||
          !matchesToken(
            csrfToken(
              config.sessionHmacKey,
              'staff-csrf-v1',
              staffCsrfBinding(request.staff.sessionId, raw),
            ),
            supplied,
          )
        )
          throw new StaffError('CSRF_INVALID');
        return true;
      }
      const challenge = decodeSessionToken(
        cookieValue(request, challengeCookieName(config)),
      );
      const supplied = request.headers['x-csrf-token'];
      if (
        !challenge ||
        typeof supplied !== 'string' ||
        !matchesToken(
          csrfToken(
            config.sessionHmacKey,
            'login-csrf-v1',
            loginCsrfBinding(challenge),
          ),
          supplied,
        )
      )
        throw new StaffError('CSRF_INVALID');
      let consumed: string | null;
      try {
        consumed = (await this.redis.eval(
          "local value=redis.call('GET',KEYS[1]); if value then redis.call('DEL',KEYS[1]); end; return value",
          1,
          `stdu:csrf:challenge:${sha256(challenge).toString('hex')}`,
        )) as string | null;
      } catch {
        throw new StaffError('DEPENDENCY_UNAVAILABLE');
      }
      if (consumed !== 'active') throw new StaffError('CSRF_INVALID');
      return true;
    }

    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    const raw = decodeSessionToken(
      cookieValue(request, sessionCookieName(config)),
    );
    const supplied = request.headers['x-csrf-token'];
    if (
      !raw ||
      typeof supplied !== 'string' ||
      !matchesToken(
        csrfToken(
          config.sessionHmacKey,
          'staff-csrf-v1',
          staffCsrfBinding(request.staff.sessionId, raw),
        ),
        supplied,
      )
    )
      throw new StaffError('CSRF_INVALID');
    return true;
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const permission = this.reflector.getAllAndOverride<string>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const principal = request.staff;
    if (!principal) throw new StaffError('AUTH_REQUIRED');
    if (principal.passwordChangeRequired)
      throw new StaffError('PASSWORD_CHANGE_REQUIRED');
    if (!principal.permissionCodes.includes(permission))
      throw new StaffError('FORBIDDEN');
    return true;
  }
}

interface LockedSession {
  sessionId: string;
  staffUserId: string;
  sessionAuthVersion: number;
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
  idleTimeoutSeconds: number;
  revokedAt: Date | null;
  email: string;
  displayName: string;
  userState: string;
  userAuthVersion: number;
  passwordChangeRequired: boolean;
  passwordHash: string;
}

interface SessionDecision {
  now: Date;
  absoluteLive: boolean;
  idleLive: boolean;
}
