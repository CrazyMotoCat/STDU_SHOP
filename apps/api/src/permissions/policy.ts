import type { Prisma } from '../generated/prisma/client.js';
import { StaffError } from '../identity/errors.js';
import { usableCredential } from '../identity/crypto.js';

export const CONTROL_ADMIN_PERMISSIONS = [
  'staff.users.read',
  'staff.users.create',
  'staff.users.status.write',
  'staff.sessions.revoke',
  'staff.roles.read',
  'staff.roles.write',
  'staff.roles.permissions.write',
  'staff.roles.assign',
] as const;

export const PERMISSION_CODES = [
  'staff.users.read',
  'staff.users.create',
  'staff.users.status.write',
  'staff.sessions.revoke',
  'staff.roles.read',
  'staff.roles.write',
  'staff.roles.permissions.write',
  'staff.roles.assign',
  'sellers.read',
  'sellers.write',
  'audit.read',
  'files.metadata.read',
] as const;

export const FULL_ADMIN_PERMISSIONS = PERMISSION_CODES;

export async function acquireAdminInvariantLock(tx: Prisma.TransactionClient) {
  await tx.$queryRaw<{ lockAcquired: string }[]>`
    SELECT pg_advisory_xact_lock(1398031445,2)::text AS "lockAcquired"
  `;
}

export async function lockStaffUserRows(
  tx: Prisma.TransactionClient,
  userIds: string[],
) {
  for (const userId of [...new Set(userIds)].sort())
    await tx.$queryRaw`SELECT id FROM staff_user WHERE id = ${userId}::uuid FOR UPDATE`;
}

export async function lockRoleRows(
  tx: Prisma.TransactionClient,
  roleIds: string[],
) {
  for (const roleId of [...new Set(roleIds)].sort())
    await tx.$queryRaw`SELECT id FROM role WHERE id = ${roleId}::uuid FOR UPDATE`;
}

export async function lockStaffSessionRows(
  tx: Prisma.TransactionClient,
  userIds: string[],
  sessionIds: string[] = [],
) {
  const activeSessions = userIds.length
    ? await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM staff_session
        WHERE staff_user_id = ANY(${userIds}::uuid[]) AND revoked_at IS NULL
        ORDER BY id
      `
    : [];
  for (const sessionId of [
    ...new Set([...activeSessions.map(({ id }) => id), ...sessionIds]),
  ].sort())
    await tx.$queryRaw`SELECT id FROM staff_session WHERE id = ${sessionId}::uuid FOR UPDATE`;
}

export async function effectivePermissions(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const rows = await tx.$queryRaw<{ code: string }[]>`
    SELECT DISTINCT p.code
    FROM user_role ur
    JOIN role r ON r.id = ur.role_id AND r.state = 'ACTIVE'
    JOIN role_permission rp ON rp.role_id = r.id
    JOIN permission p ON p.id = rp.permission_id
    WHERE ur.staff_user_id = ${userId}::uuid
    ORDER BY p.code
  `;
  return rows.map(({ code }) => code);
}

export async function assertHasPermission(
  tx: Prisma.TransactionClient,
  userId: string,
  permission: string,
) {
  const codes = await effectivePermissions(tx, userId);
  if (!codes.includes(permission)) throw new StaffError('FORBIDDEN');
  return codes;
}

export async function adminInvariantMembers(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<(AdminMember & { passwordHash: string })[]>`
    WITH eligible AS (
      SELECT u.id, u.password_hash
      FROM staff_user u
      WHERE u.state = 'ACTIVE'
        AND u.password_change_required = false
    ), grants AS (
      SELECT eligible.id,
        eligible.password_hash,
        count(DISTINCT p.code) FILTER (WHERE p.code = ANY(${[...FULL_ADMIN_PERMISSIONS]}::text[])) AS full_count,
        count(DISTINCT p.code) FILTER (WHERE p.code = ANY(${[...CONTROL_ADMIN_PERMISSIONS]}::text[])) AS control_count
      FROM eligible
      LEFT JOIN user_role ur ON ur.staff_user_id = eligible.id
      LEFT JOIN role r ON r.id = ur.role_id AND r.state = 'ACTIVE'
      LEFT JOIN role_permission rp ON rp.role_id = r.id
      LEFT JOIN permission p ON p.id = rp.permission_id
      GROUP BY eligible.id, eligible.password_hash
    )
    SELECT id::text AS "userId", password_hash AS "passwordHash",
           full_count = ${FULL_ADMIN_PERMISSIONS.length} AS "fullAdmin",
           control_count = ${CONTROL_ADMIN_PERMISSIONS.length} AS "controlAdmin"
    FROM grants
  `;
  return rows
    .filter(({ passwordHash }) => usableCredential(passwordHash, false))
    .map(({ userId, fullAdmin, controlAdmin }) => ({
      userId,
      fullAdmin,
      controlAdmin,
    }));
}

export async function assertAdminInvariants(tx: Prisma.TransactionClient) {
  const members = await adminInvariantMembers(tx);
  if (
    !members.some(({ fullAdmin }) => fullAdmin) ||
    !members.some(({ controlAdmin }) => controlAdmin)
  )
    throw new StaffError('LAST_ADMIN_REQUIRED');
}

export async function assertCurrentActor(
  tx: Prisma.TransactionClient,
  actor: { id: string; sessionId: string; authVersion: number },
  requiredPermission: string | null,
  allowForcedPasswordChange = false,
  rowsAlreadyLocked = false,
) {
  if (!rowsAlreadyLocked) {
    await tx.$queryRaw`SELECT id FROM staff_user WHERE id = ${actor.id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM staff_session WHERE id = ${actor.sessionId}::uuid FOR UPDATE`;
  }
  const rows = await tx.$queryRaw<ActorSession[]>`
    SELECT s.id::text AS "sessionId", u.id::text AS "userId",
           u.state, u.auth_version AS "authVersion",
           u.password_change_required AS "passwordChangeRequired",
           s.revoked_at AS "revokedAt", s.absolute_expires_at AS "absoluteExpiresAt",
           s.last_seen_at AS "lastSeenAt", s.idle_timeout_seconds AS "idleTimeoutSeconds"
    FROM staff_session s JOIN staff_user u ON u.id = s.staff_user_id
    WHERE s.id = ${actor.sessionId}::uuid AND u.id = ${actor.id}::uuid
  `;
  const row = rows[0];
  if (
    !row ||
    row.revokedAt ||
    row.state !== 'ACTIVE' ||
    row.authVersion !== actor.authVersion
  )
    throw new StaffError('AUTH_REQUIRED');
  const decision = await tx.$queryRaw<{ now: Date; live: boolean }[]>`
    WITH decision AS (SELECT clock_timestamp() AS now)
    SELECT decision.now AS "now",
      (s.absolute_expires_at > decision.now AND
       s.last_seen_at + make_interval(secs => s.idle_timeout_seconds) > decision.now) AS live
    FROM staff_session s CROSS JOIN decision WHERE s.id = ${row.sessionId}::uuid
  `;
  if (!decision[0]?.live) throw new StaffError('AUTH_REQUIRED');
  if (!allowForcedPasswordChange && row.passwordChangeRequired)
    throw new StaffError('PASSWORD_CHANGE_REQUIRED');
  if (!requiredPermission) return effectivePermissions(tx, actor.id);
  return assertHasPermission(tx, actor.id, requiredPermission);
}

interface AdminMember {
  userId: string;
  fullAdmin: boolean;
  controlAdmin: boolean;
}

interface ActorSession {
  sessionId: string;
  userId: string;
  state: string;
  authVersion: number;
  passwordChangeRequired: boolean;
  revokedAt: Date | null;
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
  idleTimeoutSeconds: number;
}
