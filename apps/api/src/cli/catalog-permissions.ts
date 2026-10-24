import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { createAuditEvent } from '../audit/audit.service.js';
import {
  CATALOG_PERMISSION_CODES,
  acquireAdminInvariantLock,
  assertAdminInvariants,
  effectivePermissions,
} from '../permissions/policy.js';
import { usableCredential } from '../identity/crypto.js';
import { StaffError } from '../identity/errors.js';

type PrismaStore = PrismaClient;
type InitFailureCode =
  | 'OWNER_APPROVAL_REQUIRED'
  | 'INITIAL_GRANT_ALREADY_USED'
  | 'TARGET_NOT_ELIGIBLE'
  | 'LAST_ADMIN_REQUIRED'
  | 'VALIDATION_ERROR'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'AUDIT_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const requiredManagementPermissions = [
  'staff.roles.read',
  'staff.roles.write',
  'staff.roles.permissions.write',
  'staff.roles.assign',
] as const;

const deniedCodes = new Set<InitFailureCode>([
  'OWNER_APPROVAL_REQUIRED',
  'INITIAL_GRANT_ALREADY_USED',
  'TARGET_NOT_ELIGIBLE',
  'LAST_ADMIN_REQUIRED',
  'VALIDATION_ERROR',
]);

export class CatalogPermissionInitError extends Error {
  constructor(readonly code: InitFailureCode) {
    super(code);
    this.name = 'CatalogPermissionInitError';
  }
}

function validateOperatorLabel(value: string) {
  const label = value.trim();
  if (Array.from(label).length < 1 || Array.from(label).length > 80)
    throw new CatalogPermissionInitError('VALIDATION_ERROR');
  return label;
}

function validateTargetUserId(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new CatalogPermissionInitError('VALIDATION_ERROR');
  return value.toLowerCase();
}

function validateApprovalReference(value: string | undefined) {
  if (value === undefined || value.trim() === '')
    throw new CatalogPermissionInitError('OWNER_APPROVAL_REQUIRED');
  const reference = value.trim();
  if (
    Array.from(reference).length > 80 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/.test(reference)
  )
    throw new CatalogPermissionInitError('VALIDATION_ERROR');
  return reference;
}

function permissionCodesMatch(actual: string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    actual.every((code, index) => code === expected[index])
  );
}

async function writeOperatorEvent(
  db: PrismaStore,
  input: {
    operatorLabel: string;
    requestId: string;
    outcome: 'DENIED' | 'FAILURE';
    reasonCode: InitFailureCode;
  },
) {
  try {
    await db.$transaction((tx) =>
      createAuditEvent(tx, {
        actorKind: 'OPERATOR',
        operatorLabel: input.operatorLabel,
        action: 'catalog.permissions.initialized',
        outcome: input.outcome,
        reasonCode: input.reasonCode,
        requestId: input.requestId,
      }),
    );
  } catch {
    throw new CatalogPermissionInitError('AUDIT_UNAVAILABLE');
  }
}

export async function initializeCatalogPermissions(
  db: PrismaStore,
  input: {
    targetUserId: string;
    ownerApprovalReference: string | undefined;
    operatorLabel: string;
  },
) {
  const requestId = randomUUID();
  const operatorLabel = validateOperatorLabel(input.operatorLabel);

  try {
    const targetUserId = validateTargetUserId(input.targetUserId);
    const ownerApprovalReference = validateApprovalReference(
      input.ownerApprovalReference,
    );
    const contractCodes = [...CATALOG_PERMISSION_CODES];
    const expectedCodes = [...contractCodes].sort();
    const result = await db.$transaction(
      async (tx) => {
        await acquireAdminInvariantLock(tx);
        await assertAdminInvariants(tx);

        const successfulInitializations = await tx.auditEvent.count({
          where: {
            action: 'catalog.permissions.initialized',
            outcome: 'SUCCESS',
          },
        });
        if (successfulInitializations > 0)
          throw new CatalogPermissionInitError('INITIAL_GRANT_ALREADY_USED');

        const registry = await tx.permission.findMany({
          where: { code: { startsWith: 'catalog.' } },
          select: { id: true, code: true },
          orderBy: { code: 'asc' },
        });
        if (
          !permissionCodesMatch(
            registry.map(({ code }) => code),
            expectedCodes,
          )
        )
          throw new CatalogPermissionInitError('DEPENDENCY_UNAVAILABLE');

        const existingGrant = await tx.rolePermission.count({
          where: { permissionId: { in: registry.map(({ id }) => id) } },
        });
        if (existingGrant > 0)
          throw new CatalogPermissionInitError('INITIAL_GRANT_ALREADY_USED');

        await tx.$queryRaw`
          SELECT id FROM staff_user WHERE id = ${targetUserId}::uuid FOR UPDATE
        `;
        const target = await tx.staffUser.findUnique({
          where: { id: targetUserId },
          select: {
            id: true,
            state: true,
            passwordHash: true,
            passwordChangeRequired: true,
          },
        });
        if (
          !target ||
          target.state !== 'ACTIVE' ||
          target.passwordChangeRequired ||
          !usableCredential(target.passwordHash, target.passwordChangeRequired)
        )
          throw new CatalogPermissionInitError('TARGET_NOT_ELIGIBLE');

        const targetPermissions = await effectivePermissions(tx, target.id);
        if (
          requiredManagementPermissions.some(
            (permission) => !targetPermissions.includes(permission),
          )
        )
          throw new CatalogPermissionInitError('TARGET_NOT_ELIGIBLE');

        const roleId = randomUUID();
        const roleCode = `catalog-bootstrap-${requestId}`;
        await tx.role.create({
          data: {
            id: roleId,
            code: roleCode,
            name: `Catalog permissions ${requestId.slice(0, 8)}`,
            state: 'ACTIVE',
          },
        });
        await tx.rolePermission.createMany({
          data: registry.map(({ id }) => ({ roleId, permissionId: id })),
        });
        await tx.userRole.create({
          data: { staffUserId: target.id, roleId },
        });
        await assertAdminInvariants(tx);
        await createAuditEvent(tx, {
          actorKind: 'OPERATOR',
          operatorLabel,
          action: 'catalog.permissions.initialized',
          entityType: 'Role',
          entityId: roleId,
          outcome: 'SUCCESS',
          reasonCode: 'OWNER_APPROVED',
          requestId,
          changes: {
            targetUserId: target.id,
            roleId,
            permissionCodes: contractCodes,
            approvalReference: ownerApprovalReference,
          },
        });
        return { requestId, roleId, roleCode, targetUserId: target.id };
      },
      { isolationLevel: 'ReadCommitted' },
    );
    return result;
  } catch (error) {
    const code =
      error instanceof CatalogPermissionInitError
        ? error.code
        : error instanceof StaffError && error.code === 'LAST_ADMIN_REQUIRED'
          ? 'LAST_ADMIN_REQUIRED'
          : error instanceof StaffError && error.code === 'VALIDATION_ERROR'
            ? 'VALIDATION_ERROR'
            : 'INTERNAL_ERROR';
    await writeOperatorEvent(db, {
      operatorLabel,
      requestId,
      outcome: deniedCodes.has(code) ? 'DENIED' : 'FAILURE',
      reasonCode: code,
    });
    throw new CatalogPermissionInitError(code);
  }
}

function parseArguments(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (
      !['--target-user-id', '--owner-approval-ref', '--operator'].includes(
        key ?? '',
      ) ||
      values.has(key ?? '')
    )
      throw new CatalogPermissionInitError('VALIDATION_ERROR');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      if (key === '--owner-approval-ref') continue;
      throw new CatalogPermissionInitError(
        key === '--owner-approval-ref'
          ? 'OWNER_APPROVAL_REQUIRED'
          : 'VALIDATION_ERROR',
      );
    }
    index++;
    values.set(key!, value);
  }
  const targetUserId = values.get('--target-user-id');
  const operatorLabel = values.get('--operator');
  if (!targetUserId || !operatorLabel)
    throw new CatalogPermissionInitError('VALIDATION_ERROR');
  return {
    targetUserId,
    ownerApprovalReference: values.get('--owner-approval-ref'),
    operatorLabel,
  };
}

function databaseUrl() {
  const value = process.env.STAFF_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new CatalogPermissionInitError('DEPENDENCY_UNAVAILABLE');
  try {
    const parsed = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
      throw new Error();
  } catch {
    throw new CatalogPermissionInitError('DEPENDENCY_UNAVAILABLE');
  }
  return value;
}

export async function runCatalogPermissionCli(args: string[]) {
  const input = parseArguments(args);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl() }),
  });
  try {
    const result = await initializeCatalogPermissions(db, input);
    console.log(
      `Catalog permissions initialized. targetUserId=${result.targetUserId} roleId=${result.roleId} requestId=${result.requestId}`,
    );
  } finally {
    await db.$disconnect();
  }
}
