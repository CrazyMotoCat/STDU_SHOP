import { StringDecoder } from 'node:string_decoder';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { readConfig } from '../config.js';
import { createAuditEvent } from '../audit/audit.service.js';
import {
  IdentityCrypto,
  normalizeEmail,
  validEmail,
  validatePassword,
} from '../identity/crypto.js';
import { StaffError } from '../identity/errors.js';
import {
  acquireAdminInvariantLock,
  adminInvariantMembers,
  assertAdminInvariants,
  effectivePermissions,
  FULL_ADMIN_PERMISSIONS,
  CONTROL_ADMIN_PERMISSIONS,
  lockStaffSessionRows,
} from '../permissions/policy.js';

type PrismaStore = PrismaClient;

export class StaffAccessCliError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'StaffAccessCliError';
  }
}

function validateOperator(value: string) {
  const operatorLabel = value.trim();
  if (
    Array.from(operatorLabel).length < 1 ||
    Array.from(operatorLabel).length > 80
  )
    throw new StaffError('VALIDATION_ERROR', [
      { field: 'operator', code: 'OUT_OF_RANGE' },
    ]);
  return operatorLabel;
}

function validateDisplayName(value: string) {
  const displayName = value.trim();
  if (
    Array.from(displayName).length < 1 ||
    Array.from(displayName).length > 120
  )
    throw new StaffError('VALIDATION_ERROR', [
      { field: 'displayName', code: 'OUT_OF_RANGE' },
    ]);
  return displayName;
}

async function writeOperatorDenial(
  db: PrismaStore,
  input: {
    operatorLabel: string;
    action: 'staff.bootstrap' | 'staff.access.recovered';
    outcome: 'DENIED' | 'FAILURE';
    reasonCode: string;
    requestId: string;
  },
) {
  await db.$transaction((tx) =>
    createAuditEvent(tx, {
      actorKind: 'OPERATOR',
      operatorLabel: input.operatorLabel,
      action: input.action,
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      requestId: input.requestId,
    }),
  );
}

export async function bootstrapStaff(
  db: PrismaStore,
  input: {
    email: string;
    displayName: string;
    operatorLabel: string;
    password: string;
  },
  crypto = new IdentityCrypto(),
) {
  const requestId = randomUUID();
  let operatorLabel: string;
  let email: string;
  let displayName: string;
  let passwordHash: string;
  try {
    operatorLabel = validateOperator(input.operatorLabel);
    email = input.email.trim();
    const emailNormalized = normalizeEmail(email);
    if (!validEmail(emailNormalized))
      throw new StaffError('VALIDATION_ERROR', [
        { field: 'email', code: 'INVALID_EMAIL' },
      ]);
    displayName = validateDisplayName(input.displayName);
    validatePassword(input.password, emailNormalized);
    passwordHash = await crypto.hashPassword(input.password, emailNormalized);
  } catch (error) {
    if (error instanceof StaffError) throw error;
    throw new StaffError('DEPENDENCY_UNAVAILABLE');
  }
  const emailNormalized = normalizeEmail(email);

  try {
    const result = await db.$transaction(
      async (tx) => {
        await acquireAdminInvariantLock(tx);
        const users = await tx.staffUser.count();
        if (users !== 0)
          throw new StaffAccessCliError('BOOTSTRAP_ALREADY_COMPLETED');
        const role = await tx.role.findUnique({
          where: { code: 'bootstrap-admin' },
          include: { permissions: { include: { permission: true } } },
        });
        if (!role || role.state !== 'ACTIVE')
          throw new StaffError('DEPENDENCY_UNAVAILABLE');
        const rolePermissions = new Set(
          role.permissions.map(({ permission }) => permission.code),
        );
        if (
          FULL_ADMIN_PERMISSIONS.some(
            (permission) => !rolePermissions.has(permission),
          )
        )
          throw new StaffError('DEPENDENCY_UNAVAILABLE');

        const userId = randomUUID();
        await tx.staffUser.create({
          data: {
            id: userId,
            email,
            emailNormalized,
            displayName,
            passwordHash,
            passwordChangeRequired: false,
            state: 'ACTIVE',
          },
        });
        await tx.userRole.create({
          data: { staffUserId: userId, roleId: role.id },
        });
        await assertAdminInvariants(tx);
        await createAuditEvent(tx, {
          actorKind: 'OPERATOR',
          operatorLabel,
          action: 'staff.bootstrap',
          entityType: 'StaffUser',
          entityId: userId,
          outcome: 'SUCCESS',
          reasonCode: 'BOOTSTRAP',
          requestId,
          changes: { targetUserId: userId, passwordChangeRequired: false },
        });
        return { id: userId, email };
      },
      { isolationLevel: 'ReadCommitted' },
    );
    return { ...result, requestId };
  } catch (error) {
    const denied =
      error instanceof StaffAccessCliError ||
      (error instanceof StaffError && error.code === 'VALIDATION_ERROR');
    const reasonCode =
      error instanceof StaffAccessCliError
        ? error.code
        : error instanceof StaffError && error.code === 'VALIDATION_ERROR'
          ? error.code
          : error instanceof StaffError &&
              error.code === 'DEPENDENCY_UNAVAILABLE'
            ? error.code
            : 'INTERNAL_ERROR';
    try {
      await writeOperatorDenial(db, {
        operatorLabel: validateOperator(input.operatorLabel),
        action: 'staff.bootstrap',
        outcome: denied ? 'DENIED' : 'FAILURE',
        reasonCode,
        requestId,
      });
    } catch {
      throw new StaffError('AUDIT_UNAVAILABLE');
    }
    throw error;
  }
}

export async function recoverStaffAccess(
  db: PrismaStore,
  input: {
    userId: string;
    operatorLabel: string;
    reason: 'OWNER_CONFIRMED';
    password: string;
    lastAdminOwner: boolean;
  },
  crypto = new IdentityCrypto(),
) {
  const requestId = randomUUID();
  let operatorLabel: string;
  let passwordHash: string;
  let targetEmailNormalized: string;
  try {
    operatorLabel = validateOperator(input.operatorLabel);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.userId,
      )
    )
      throw new StaffError('VALIDATION_ERROR', [
        { field: 'userId', code: 'INVALID_UUID' },
      ]);
    const existing = await db.staffUser.findUnique({
      where: { id: input.userId },
      select: { emailNormalized: true },
    });
    if (!existing) {
      try {
        await writeOperatorDenial(db, {
          operatorLabel,
          action: 'staff.access.recovered',
          outcome: 'DENIED',
          reasonCode: 'NOT_FOUND',
          requestId,
        });
      } catch {
        throw new StaffError('AUDIT_UNAVAILABLE');
      }
      throw new StaffError('NOT_FOUND');
    }
    targetEmailNormalized = existing.emailNormalized;
    validatePassword(input.password, targetEmailNormalized);
    passwordHash = await crypto.hashPassword(
      input.password,
      targetEmailNormalized,
    );
  } catch (error) {
    if (error instanceof StaffError) throw error;
    throw new StaffError('DEPENDENCY_UNAVAILABLE');
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        await acquireAdminInvariantLock(tx);
        await assertAdminInvariants(tx);
        const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM staff_user WHERE id = ${input.userId}::uuid FOR UPDATE
      `;
        if (!locked[0]) throw new StaffError('NOT_FOUND');
        await lockStaffSessionRows(tx, [input.userId]);
        const target = await tx.staffUser.findUnique({
          where: { id: input.userId },
        });
        if (!target) throw new StaffError('NOT_FOUND');
        if (target.state !== 'ACTIVE' || target.passwordChangeRequired)
          throw new StaffError('INVALID_STATE_TRANSITION');

        const adminUsers = await adminInvariantMembers(tx);
        const fullAdminElsewhere = adminUsers.some(
          ({ userId, fullAdmin }) => userId !== target.id && fullAdmin,
        );
        const controlAdminElsewhere = adminUsers.some(
          ({ userId, controlAdmin }) => userId !== target.id && controlAdmin,
        );
        const requiresLastAdminOwner =
          !fullAdminElsewhere || !controlAdminElsewhere;
        if (requiresLastAdminOwner && !input.lastAdminOwner)
          throw new StaffError('LAST_ADMIN_REQUIRED');
        if (!requiresLastAdminOwner && input.lastAdminOwner)
          throw new StaffError('INVALID_STATE_TRANSITION');

        if (requiresLastAdminOwner) {
          const targetPermissions = new Set(
            await effectivePermissions(tx, target.id),
          );
          if (
            FULL_ADMIN_PERMISSIONS.some(
              (permission) => !targetPermissions.has(permission),
            ) ||
            CONTROL_ADMIN_PERMISSIONS.some(
              (permission) => !targetPermissions.has(permission),
            )
          )
            throw new StaffError('LAST_ADMIN_REQUIRED');
        }

        const nowRows = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT clock_timestamp() AS now`;
        const now = nowRows[0]?.now;
        if (!now) throw new StaffError('DEPENDENCY_UNAVAILABLE');
        const passwordChangeRequired = !requiresLastAdminOwner;
        const updated = await tx.staffUser.update({
          where: { id: target.id },
          data: {
            passwordHash,
            passwordChangeRequired,
            authVersion: { increment: 1 },
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        const revoked = await tx.staffSession.updateMany({
          where: { staffUserId: target.id, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'ACCESS_RECOVERED' },
        });
        await createAuditEvent(tx, {
          actorKind: 'OPERATOR',
          operatorLabel,
          action: 'staff.sessions.revoked',
          entityType: 'StaffUser',
          entityId: target.id,
          outcome: 'SUCCESS',
          reasonCode: 'ACCESS_RECOVERED',
          requestId,
          changes: { targetUserId: target.id, count: revoked.count },
        });
        await assertAdminInvariants(tx);
        await createAuditEvent(tx, {
          actorKind: 'OPERATOR',
          operatorLabel,
          action: 'staff.access.recovered',
          entityType: 'StaffUser',
          entityId: target.id,
          outcome: 'SUCCESS',
          reasonCode: 'OWNER_CONFIRMED',
          requestId,
          changes: {
            targetUserId: target.id,
            passwordChangeRequired,
            recoveryMode: requiresLastAdminOwner
              ? 'LAST_ADMIN_OWNER'
              : 'NORMAL',
          },
        });
        return {
          id: updated.id,
          version: updated.version,
          passwordChangeRequired,
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
    return { ...result, requestId };
  } catch (error) {
    const denied =
      error instanceof StaffError &&
      [
        'LAST_ADMIN_REQUIRED',
        'INVALID_STATE_TRANSITION',
        'NOT_FOUND',
        'VALIDATION_ERROR',
      ].includes(error.code);
    const reasonCode =
      error instanceof StaffError && error.code === 'DEPENDENCY_UNAVAILABLE'
        ? error.code
        : denied && error instanceof StaffError
          ? error.code
          : 'INTERNAL_ERROR';
    try {
      await writeOperatorDenial(db, {
        operatorLabel: validateOperator(input.operatorLabel),
        action: 'staff.access.recovered',
        outcome: denied ? 'DENIED' : 'FAILURE',
        reasonCode,
        requestId,
      });
    } catch {
      throw new StaffError('AUDIT_UNAVAILABLE');
    }
    throw error;
  }
}

function parseArguments(args: string[]) {
  const values = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!key?.startsWith('--')) throw new StaffError('VALIDATION_ERROR');
    if (key === '--last-admin-owner') {
      values.set(key, true);
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith('--') || values.has(key))
      throw new StaffError('VALIDATION_ERROR');
    values.set(key, value);
  }
  return values;
}

function requiredArgument(values: Map<string, string | boolean>, key: string) {
  const value = values.get(key);
  if (typeof value !== 'string' || !value.trim())
    throw new StaffError('VALIDATION_ERROR', [
      { field: key.slice(2), code: 'REQUIRED' },
    ]);
  return value;
}

async function readHidden(label: string) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function')
    throw new Error(
      'Password input requires an interactive TTY; use a protected one-time terminal session.',
    );
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  const decoder = new StringDecoder('utf8');
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      const decoded = decoder.write(chunk);
      for (const character of decoded) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Password entry cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
        } else if (character >= ' ' && character !== '\u007f') {
          value += character;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function confirmLastAdminOwner() {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(
      'Confirm trusted owner identity verification by typing OWNER_CONFIRMED: ',
    );
    if (answer.trim() !== 'OWNER_CONFIRMED')
      throw new StaffError('LAST_ADMIN_REQUIRED');
  } finally {
    readline.close();
  }
}

export async function runStaffAccessCli(mode: string, args: string[]) {
  if (!['bootstrap', 'recover'].includes(mode))
    throw new StaffError('VALIDATION_ERROR');
  const values = parseArguments(args);
  const operatorLabel = requiredArgument(values, '--operator');
  const password = await readHidden('Password (hidden): ');
  const repeated = await readHidden('Repeat password (hidden): ');
  if (password !== repeated)
    throw new StaffError('VALIDATION_ERROR', [
      { field: 'password', code: 'MISMATCH' },
    ]);

  const config = readConfig(process.env);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  try {
    if (mode === 'bootstrap') {
      const result = await bootstrapStaff(db, {
        email: requiredArgument(values, '--email'),
        displayName: requiredArgument(values, '--display-name'),
        operatorLabel,
        password,
      });
      stdout.write(
        `Bootstrap completed. userId=${result.id} email=${result.email}\n`,
      );
    } else {
      if (requiredArgument(values, '--reason') !== 'OWNER_CONFIRMED')
        throw new StaffError('VALIDATION_ERROR', [
          { field: 'reason', code: 'OWNER_CONFIRMED_REQUIRED' },
        ]);
      const lastAdminOwner = values.get('--last-admin-owner') === true;
      if (lastAdminOwner) await confirmLastAdminOwner();
      const result = await recoverStaffAccess(db, {
        userId: requiredArgument(values, '--user-id'),
        operatorLabel,
        reason: 'OWNER_CONFIRMED',
        password,
        lastAdminOwner,
      });
      stdout.write(
        `Access recovery completed. userId=${result.id} passwordChangeRequired=${result.passwordChangeRequired}\n`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}
