import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AuditService,
  createAuditEvent,
  type AuditInput,
} from '../audit/audit.service.js';
import { DATABASE, PrismaDatabase } from '../database/database.module.js';
import { Prisma } from '../generated/prisma/client.js';
import { StaffError } from '../identity/errors.js';
import {
  IdentityCrypto,
  normalizeEmail,
  validatePassword,
} from '../identity/crypto.js';
import type { StaffPrincipal, StaffRequest } from '../identity/request.js';
import {
  assertAdminInvariants,
  assertCurrentActor,
  acquireAdminInvariantLock,
  lockRoleRows,
  lockStaffSessionRows,
  lockStaffUserRows,
} from '../permissions/policy.js';
import {
  CreateRoleDto,
  CreateSellerDto,
  CreateStaffUserDto,
  PatchRoleDto,
  PatchSellerDto,
  ReplaceRolePermissionsDto,
  UserStateDto,
  VersionedDto,
} from './staff.dto.js';

const EMAIL =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

@Injectable()
export class StaffService {
  constructor(
    @Inject(DATABASE) private readonly db: PrismaDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdentityCrypto) private readonly crypto: IdentityCrypto,
  ) {}

  async listUsers(request: StaffRequest, limit: number, cursor?: string) {
    const after = cursor ? decodeIdCursor(cursor) : undefined;
    const rows = await this.db.staffUser.findMany({
      where: after ? { id: { gt: after.id } } : undefined,
      orderBy: { id: 'asc' },
      take: limit + 1,
      include: { roles: { select: { roleId: true } } },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        state: user.state,
        passwordChangeRequired: user.passwordChangeRequired,
        roleIds: user.roles.map(({ roleId }) => roleId).sort(),
        version: user.version,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      })),
      meta: {
        requestId: request.requestId,
        nextCursor: hasMore ? encodeCursor({ id: page.at(-1)!.id }) : null,
      },
    };
  }

  async createUser(request: StaffRequest, input: CreateStaffUserDto) {
    const email = input.email.trim();
    const emailNormalized = normalizeEmail(email);
    let passwordHash: string;
    try {
      if (
        !EMAIL.test(email) ||
        Buffer.byteLength(input.initialPassword, 'utf8') > 512
      )
        throw new StaffError('VALIDATION_ERROR');
      validatePassword(input.initialPassword, emailNormalized);
      passwordHash = await this.crypto.hashPassword(
        input.initialPassword,
        emailNormalized,
      );
    } catch (error) {
      await this.deny(request, 'staff.user.created', error);
      throw error;
    }
    const userId = randomUUID();
    const user = await this.command(
      request,
      'staff.users.create',
      'staff.user.created',
      true,
      async (tx) => {
        const created = await tx.staffUser.create({
          data: {
            id: userId,
            email,
            emailNormalized,
            displayName: input.displayName.trim(),
            passwordHash,
            passwordChangeRequired: true,
            state: 'ACTIVE',
          },
        });
        await this.success(tx, {
          actorKind: 'STAFF',
          actorUserId: request.staff!.id,
          action: 'staff.user.created',
          entityType: 'StaffUser',
          entityId: userId,
          outcome: 'SUCCESS',
          reasonCode: null,
          requestId: request.requestId,
          changes: { targetUserId: userId, changedFields: ['displayName'] },
        });
        return { id: created.id, version: created.version };
      },
    );
    return mutation(request, user);
  }

  async setUserState(
    request: StaffRequest,
    userId: string,
    input: UserStateDto,
  ) {
    const actor = this.principal(request);
    const output = await this.command(
      request,
      'staff.users.status.write',
      'staff.user.state.changed',
      true,
      async (tx) => {
        if (actor.id === userId)
          throw new StaffError('SELF_PRIVILEGE_CHANGE_FORBIDDEN');
        const target = await tx.staffUser.findUnique({ where: { id: userId } });
        if (!target) throw new StaffError('NOT_FOUND');
        if (target.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (target.state === input.state)
          return { id: target.id, version: target.version };
        const allowed =
          (target.state === 'ACTIVE' && input.state === 'BLOCKED') ||
          (target.state === 'BLOCKED' && input.state === 'ACTIVE');
        if (!allowed) throw new StaffError('INVALID_STATE_TRANSITION');
        const { now } = await this.clock(tx);
        const updated = await tx.staffUser.update({
          where: { id: userId },
          data: {
            state: input.state,
            blockedAt: input.state === 'BLOCKED' ? now : null,
            authVersion: { increment: 1 },
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        const revoked = await tx.staffSession.updateMany({
          where: { staffUserId: userId, revokedAt: null },
          data: {
            revokedAt: now,
            revocationReason:
              input.state === 'BLOCKED' ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
          },
        });
        const reason =
          input.state === 'BLOCKED' ? 'USER_BLOCKED' : 'USER_UNBLOCKED';
        await this.success(tx, {
          actorKind: 'STAFF',
          actorUserId: actor.id,
          action: 'staff.user.state.changed',
          entityType: 'StaffUser',
          entityId: userId,
          outcome: 'SUCCESS',
          reasonCode: reason,
          requestId: request.requestId,
          changes: {
            targetUserId: userId,
            previousState: target.state,
            state: updated.state,
            changedFields: ['state'],
          },
        });
        if (revoked.count > 0)
          await this.success(tx, {
            actorKind: 'STAFF',
            actorUserId: actor.id,
            action: 'staff.sessions.revoked',
            entityType: 'StaffUser',
            entityId: userId,
            outcome: 'SUCCESS',
            reasonCode: reason,
            requestId: request.requestId,
            changes: { targetUserId: userId, count: revoked.count },
          });
        return { id: updated.id, version: updated.version };
      },
      async () => ({ userIds: [userId], sessionUserIds: [userId] }),
    );
    return mutation(request, output);
  }

  async revokeUserSessions(
    request: StaffRequest,
    userId: string,
    input: VersionedDto,
  ) {
    const actor = this.principal(request);
    const output = await this.command(
      request,
      'staff.sessions.revoke',
      'staff.sessions.revoked',
      false,
      async (tx) => {
        if (actor.id === userId)
          throw new StaffError('SELF_PRIVILEGE_CHANGE_FORBIDDEN');
        const target = await tx.staffUser.findUnique({ where: { id: userId } });
        if (!target) throw new StaffError('NOT_FOUND');
        if (target.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        const { now } = await this.clock(tx);
        const updated = await tx.staffUser.update({
          where: { id: userId },
          data: {
            authVersion: { increment: 1 },
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        const revoked = await tx.staffSession.updateMany({
          where: { staffUserId: userId, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'ADMIN_REVOKE' },
        });
        await this.success(tx, {
          actorKind: 'STAFF',
          actorUserId: actor.id,
          action: 'staff.sessions.revoked',
          entityType: 'StaffUser',
          entityId: userId,
          outcome: 'SUCCESS',
          reasonCode: 'ADMIN_REVOKE',
          requestId: request.requestId,
          changes: { targetUserId: userId, count: revoked.count },
        });
        return { id: updated.id, version: updated.version };
      },
      async () => ({ userIds: [userId], sessionUserIds: [userId] }),
    );
    return mutation(request, output);
  }

  async assignRole(
    request: StaffRequest,
    userId: string,
    roleId: string,
    input: VersionedDto,
  ) {
    return this.changeAssignment(request, userId, roleId, input, true);
  }

  async removeRole(
    request: StaffRequest,
    userId: string,
    roleId: string,
    expectedVersion: number,
  ) {
    return this.changeAssignment(
      request,
      userId,
      roleId,
      { expectedVersion },
      false,
    );
  }

  private async changeAssignment(
    request: StaffRequest,
    userId: string,
    roleId: string,
    input: VersionedDto,
    assign: boolean,
  ) {
    const actor = this.principal(request);
    const action = assign ? 'staff.role.assigned' : 'staff.role.removed';
    const reason = assign ? 'ROLE_ASSIGNED' : 'ROLE_REMOVED';
    const output = await this.command(
      request,
      'staff.roles.assign',
      action,
      true,
      async (tx, actorPermissions) => {
        if (actor.id === userId)
          throw new StaffError('SELF_PRIVILEGE_CHANGE_FORBIDDEN');
        const target = await tx.staffUser.findUnique({ where: { id: userId } });
        if (!target) throw new StaffError('NOT_FOUND');
        if (target.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        const role = await tx.role.findUnique({
          where: { id: roleId },
          include: { permissions: { include: { permission: true } } },
        });
        if (!role) throw new StaffError('NOT_FOUND');
        if (assign) {
          if (target.state !== 'ACTIVE' || role.state !== 'ACTIVE')
            throw new StaffError('INVALID_STATE_TRANSITION');
          const grants = role.permissions.map(
            ({ permission }) => permission.code,
          );
          if (
            grants.some((permission) => !actorPermissions.includes(permission))
          )
            throw new StaffError('GRANT_CEILING_EXCEEDED');
        }
        const exists = await tx.userRole.findUnique({
          where: { staffUserId_roleId: { staffUserId: userId, roleId } },
        });
        if (assign && exists) return { id: target.id, version: target.version };
        if (!assign && !exists)
          return { id: target.id, version: target.version };
        const { now } = await this.clock(tx);
        if (assign) {
          await tx.userRole.create({
            data: { staffUserId: userId, roleId, assignedByUserId: actor.id },
          });
        } else {
          await tx.userRole.delete({
            where: { staffUserId_roleId: { staffUserId: userId, roleId } },
          });
        }
        const updated = await tx.staffUser.update({
          where: { id: userId },
          data: {
            authVersion: { increment: 1 },
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        const revoked = await tx.staffSession.updateMany({
          where: { staffUserId: userId, revokedAt: null },
          data: { revokedAt: now, revocationReason: reason },
        });
        await this.success(tx, {
          actorKind: 'STAFF',
          actorUserId: actor.id,
          action,
          entityType: 'Role',
          entityId: roleId,
          outcome: 'SUCCESS',
          reasonCode: reason,
          requestId: request.requestId,
          changes: { targetUserId: userId, roleId },
        });
        if (revoked.count > 0)
          await this.success(tx, {
            actorKind: 'STAFF',
            actorUserId: actor.id,
            action: 'staff.sessions.revoked',
            entityType: 'StaffUser',
            entityId: userId,
            outcome: 'SUCCESS',
            reasonCode: reason,
            requestId: request.requestId,
            changes: { targetUserId: userId, count: revoked.count },
          });
        return { id: updated.id, version: updated.version };
      },
      async () => ({
        userIds: [userId],
        roleIds: [roleId],
        sessionUserIds: [userId],
      }),
    );
    return mutation(request, output);
  }

  async listRoles(request: StaffRequest, limit: number, cursor?: string) {
    const after = cursor ? decodeIdCursor(cursor) : undefined;
    const rows = await this.db.role.findMany({
      where: after ? { id: { gt: after.id } } : undefined,
      orderBy: { id: 'asc' },
      take: limit + 1,
      include: { permissions: { include: { permission: true } } },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        state: role.state,
        permissions: role.permissions
          .map(({ permission }) => permission.code)
          .sort(),
        version: role.version,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      })),
      meta: {
        requestId: request.requestId,
        nextCursor: hasMore ? encodeCursor({ id: page.at(-1)!.id }) : null,
      },
    };
  }

  async createRole(request: StaffRequest, input: CreateRoleDto) {
    const actor = this.principal(request);
    const output = await this.command(
      request,
      'staff.roles.write',
      'staff.role.created',
      true,
      async (tx) => {
        const id = randomUUID();
        const role = await tx.role.create({
          data: {
            id,
            code: input.code,
            name: input.name.trim(),
            state: 'ACTIVE',
          },
        });
        await this.success(tx, {
          actorKind: 'STAFF',
          actorUserId: actor.id,
          action: 'staff.role.created',
          entityType: 'Role',
          entityId: id,
          outcome: 'SUCCESS',
          reasonCode: null,
          requestId: request.requestId,
          changes: { roleId: id, changedFields: ['code', 'name'] },
        });
        return { id: role.id, version: role.version };
      },
    );
    return mutation(request, output);
  }

  async changeRole(request: StaffRequest, roleId: string, input: PatchRoleDto) {
    const actor = this.principal(request);
    const output = await this.command(
      request,
      'staff.roles.write',
      'staff.role.changed',
      true,
      async (tx) => {
        if (input.name === undefined && input.state === undefined)
          throw new StaffError('VALIDATION_ERROR');
        const role = await tx.role.findUnique({ where: { id: roleId } });
        if (!role) throw new StaffError('NOT_FOUND');
        if (role.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (role.state === 'ARCHIVED')
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (input.state === 'ARCHIVED') {
          const uses = await tx.userRole.count({ where: { roleId } });
          if (uses > 0) throw new StaffError('ROLE_IN_USE');
        }
        const changedFields: string[] = [];
        if (input.name !== undefined && input.name.trim() !== role.name)
          changedFields.push('name');
        if (input.state === 'ARCHIVED') changedFields.push('state');
        if (changedFields.length === 0)
          return { id: role.id, version: role.version };
        const { now } = await this.clock(tx);
        const updated = await tx.role.update({
          where: { id: roleId },
          data: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.state === 'ARCHIVED' ? { state: 'ARCHIVED' } : {}),
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        await this.success(tx, {
          actorKind: 'STAFF',
          actorUserId: actor.id,
          action: 'staff.role.changed',
          entityType: 'Role',
          entityId: roleId,
          outcome: 'SUCCESS',
          reasonCode: null,
          requestId: request.requestId,
          changes: {
            roleId,
            ...(input.state
              ? { previousState: role.state, state: updated.state }
              : {}),
            changedFields,
          },
        });
        return { id: updated.id, version: updated.version };
      },
      async () => ({ roleIds: [roleId] }),
    );
    return mutation(request, output);
  }

  async replaceRolePermissions(
    request: StaffRequest,
    roleId: string,
    input: ReplaceRolePermissionsDto,
  ) {
    const actor = this.principal(request);
    const output = await this.command(
      request,
      'staff.roles.permissions.write',
      'staff.role.permissions.changed',
      true,
      async (tx, actorPermissions) => {
        const role = await tx.role.findUnique({
          where: { id: roleId },
          include: { permissions: { include: { permission: true } } },
        });
        if (!role) throw new StaffError('NOT_FOUND');
        if (role.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (role.state !== 'ACTIVE')
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (
          await tx.userRole.findUnique({
            where: { staffUserId_roleId: { staffUserId: actor.id, roleId } },
          })
        )
          throw new StaffError('SELF_PRIVILEGE_CHANGE_FORBIDDEN');
        const current = role.permissions
          .map(({ permission }) => permission.code)
          .sort();
        const desired = [...input.permissions].sort();
        const added = desired.filter((code) => !current.includes(code));
        const removed = current.filter((code) => !desired.includes(code));
        if (added.some((code) => !actorPermissions.includes(code)))
          throw new StaffError('GRANT_CEILING_EXCEEDED');
        if (added.length === 0 && removed.length === 0)
          return { id: role.id, version: role.version };
        const permissionRows = await tx.permission.findMany({
          where: { code: { in: desired } },
          select: { id: true, code: true },
        });
        if (permissionRows.length !== desired.length)
          throw new StaffError('VALIDATION_ERROR');
        const assigned = await tx.userRole.findMany({
          where: { roleId },
          select: { staffUserId: true },
        });
        const affectedUserIds = [
          ...new Set(assigned.map(({ staffUserId }) => staffUserId)),
        ].sort();
        const { now } = await this.clock(tx);
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (permissionRows.length)
          await tx.rolePermission.createMany({
            data: permissionRows.map(({ id }) => ({
              roleId,
              permissionId: id,
            })),
          });
        const updated = await tx.role.update({
          where: { id: roleId },
          data: { version: { increment: 1 }, updatedAt: now },
        });
        if (affectedUserIds.length) {
          await tx.staffUser.updateMany({
            where: { id: { in: affectedUserIds } },
            data: { authVersion: { increment: 1 }, updatedAt: now },
          });
          const revoked = await tx.staffSession.updateMany({
            where: { staffUserId: { in: affectedUserIds }, revokedAt: null },
            data: {
              revokedAt: now,
              revocationReason: 'ROLE_PERMISSIONS_CHANGED',
            },
          });
          const counts = await tx.staffSession.groupBy({
            by: ['staffUserId'],
            where: { staffUserId: { in: affectedUserIds }, revokedAt: now },
            _count: { _all: true },
          });
          const countByUser = new Map(
            counts.map(({ staffUserId, _count }) => [staffUserId, _count._all]),
          );
          for (const staffUserId of affectedUserIds) {
            const count = countByUser.get(staffUserId) ?? 0;
            if (count > 0)
              await this.success(tx, {
                actorKind: 'STAFF',
                actorUserId: actor.id,
                action: 'staff.sessions.revoked',
                entityType: 'StaffUser',
                entityId: staffUserId,
                outcome: 'SUCCESS',
                reasonCode: 'ROLE_PERMISSIONS_CHANGED',
                requestId: request.requestId,
                changes: { targetUserId: staffUserId, count },
              });
          }
          void revoked;
        }
        await this.success(tx, {
          actorKind: 'STAFF',
          actorUserId: actor.id,
          action: 'staff.role.permissions.changed',
          entityType: 'Role',
          entityId: roleId,
          outcome: 'SUCCESS',
          reasonCode: 'ROLE_PERMISSIONS_CHANGED',
          requestId: request.requestId,
          changes: {
            roleId,
            addedPermissions: added,
            removedPermissions: removed,
            affectedUserCount: affectedUserIds.length,
          },
        });
        return { id: updated.id, version: updated.version };
      },
      async (tx) => {
        const assigned = await tx.userRole.findMany({
          where: { roleId },
          select: { staffUserId: true },
        });
        const userIds = [
          ...new Set(assigned.map(({ staffUserId }) => staffUserId)),
        ];
        return { roleIds: [roleId], userIds, sessionUserIds: userIds };
      },
    );
    return mutation(request, output);
  }

  async listPermissions(request: StaffRequest, limit = 50, cursor?: string) {
    const after = cursor ? decodePermissionCursor(cursor) : undefined;
    const rows = await this.db.permission.findMany({
      where: after ? { code: { gt: after.code } } : undefined,
      orderBy: { code: 'asc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map(({ code, description }) => ({ code, description })),
      meta: {
        requestId: request.requestId,
        nextCursor: hasMore ? encodeCursor({ code: page.at(-1)!.code }) : null,
      },
    };
  }

  async listSellers(request: StaffRequest, limit: number, cursor?: string) {
    const after = cursor ? decodeIdCursor(cursor) : undefined;
    const rows = await this.db.sellerLegalEntity.findMany({
      where: after ? { id: { gt: after.id } } : undefined,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map(sellerDto),
      meta: {
        requestId: request.requestId,
        nextCursor: hasMore ? encodeCursor({ id: page.at(-1)!.id }) : null,
      },
    };
  }

  async createSeller(request: StaffRequest, input: CreateSellerDto) {
    const actor = this.principal(request);
    const values = sellerInput(input);
    validateSeller(values, 'DRAFT');
    const output = await this.command(
      request,
      'sellers.write',
      'seller.created',
      false,
      async (tx) => {
        const id = randomUUID();
        const seller = await tx.sellerLegalEntity.create({
          data: { id, ...values, state: 'DRAFT' },
        });
        await this.success(tx, {
          actorKind: 'STAFF',
          actorUserId: actor.id,
          action: 'seller.created',
          entityType: 'SellerLegalEntity',
          entityId: id,
          outcome: 'SUCCESS',
          reasonCode: null,
          requestId: request.requestId,
          changes: {
            sellerId: id,
            changedFields: Object.keys(values).filter(
              (key) => values[key as keyof typeof values] !== null,
            ),
          },
        });
        return { id: seller.id, version: seller.version };
      },
    );
    return mutation(request, output);
  }

  async getSeller(request: StaffRequest, sellerId: string) {
    const seller = await this.db.sellerLegalEntity.findUnique({
      where: { id: sellerId },
    });
    if (!seller) throw new StaffError('NOT_FOUND');
    return { data: sellerDto(seller), meta: { requestId: request.requestId } };
  }

  async changeSeller(
    request: StaffRequest,
    sellerId: string,
    input: PatchSellerDto,
  ) {
    const actor = this.principal(request);
    const output = await this.command(
      request,
      'sellers.write',
      'seller.changed',
      false,
      async (tx) => {
        const patch = sellerPatch(input);
        if (Object.keys(patch).length === 0)
          throw new StaffError('VALIDATION_ERROR');
        await tx.$queryRaw`SELECT id FROM seller_legal_entity WHERE id = ${sellerId}::uuid FOR UPDATE`;
        const seller = await tx.sellerLegalEntity.findUnique({
          where: { id: sellerId },
        });
        if (!seller) throw new StaffError('NOT_FOUND');
        if (seller.version !== input.expectedVersion)
          throw new StaffError('VERSION_CONFLICT');
        if (seller.state === 'ARCHIVED')
          throw new StaffError('INVALID_STATE_TRANSITION');
        const next = { ...sellerInput(seller), ...patch };
        const nextState = input.state ?? seller.state;
        validateSeller(next, nextState);
        if (seller.state === 'DRAFT' && nextState === 'ARCHIVED')
          throw new StaffError('INVALID_STATE_TRANSITION');
        if (seller.state === 'ACTIVE' && nextState === 'DRAFT') {
          // R1-002B has no future-domain references, so the frozen contract permits this transition.
        } else if (seller.state === 'DRAFT' && nextState === 'ACTIVE') {
          // The database CHECK enforces required legal identity fields after the complete patch.
        } else if (
          seller.state === 'ACTIVE' &&
          nextState !== 'ACTIVE' &&
          nextState !== 'ARCHIVED'
        ) {
          throw new StaffError('INVALID_STATE_TRANSITION');
        }
        const changedFields = Object.keys(patch).filter(
          (key) =>
            patch[key as keyof typeof patch] !==
            seller[key as keyof typeof seller],
        );
        if (nextState !== seller.state) changedFields.push('state');
        if (changedFields.length === 0)
          return { id: seller.id, version: seller.version };
        const { now } = await this.clock(tx);
        const updated = await tx.sellerLegalEntity.update({
          where: { id: sellerId },
          data: {
            ...patch,
            state: nextState,
            archivedAt: nextState === 'ARCHIVED' ? now : null,
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        await this.success(tx, {
          actorKind: 'STAFF',
          actorUserId: actor.id,
          action: 'seller.changed',
          entityType: 'SellerLegalEntity',
          entityId: sellerId,
          outcome: 'SUCCESS',
          reasonCode: null,
          requestId: request.requestId,
          changes: {
            sellerId,
            changedFields,
            ...(nextState !== seller.state
              ? { previousState: seller.state, state: nextState }
              : {}),
          },
        });
        return { id: updated.id, version: updated.version };
      },
    );
    return mutation(request, output);
  }

  async listAudit(request: StaffRequest, limit: number, cursor?: string) {
    const after = cursor ? decodeAuditCursor(cursor) : undefined;
    const rows = await this.db.auditEvent.findMany({
      where: after
        ? {
            OR: [
              { occurredAt: { lt: new Date(after.occurredAt) } },
              { occurredAt: new Date(after.occurredAt), id: { lt: after.id } },
            ],
          }
        : undefined,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map((event) => ({
        id: event.id,
        occurredAt: event.occurredAt.toISOString(),
        actorKind: event.actorKind,
        actorUserId: event.actorUserId,
        operatorLabel: event.operatorLabel,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        outcome: event.outcome,
        reasonCode: event.reasonCode,
        requestId: event.requestId,
        changes: event.changes,
      })),
      meta: {
        requestId: request.requestId,
        nextCursor: hasMore
          ? encodeCursor({
              occurredAt: page.at(-1)!.occurredAt.toISOString(),
              id: page.at(-1)!.id,
            })
          : null,
      },
    };
  }

  async getFileMetadata(request: StaffRequest, fileId: string) {
    const actor = this.principal(request);
    const object = await this.db.fileObject.findUnique({
      where: { id: fileId },
      include: {
        versions: { orderBy: { number: 'asc' } },
        links: { select: { visibility: true } },
      },
    });
    if (!object || object.state !== 'ACTIVE') throw new StaffError('NOT_FOUND');
    const canRead =
      object.ownerStaffUserId === actor.id ||
      (object.visibility === 'INTERNAL' &&
        actor.permissionCodes.includes('sellers.read') &&
        object.links.some(({ visibility }) => visibility === 'INTERNAL'));
    if (!canRead) throw new StaffError('NOT_FOUND');
    return {
      data: {
        id: object.id,
        ownerStaffUserId: object.ownerStaffUserId,
        displayName: object.displayName,
        visibility: object.visibility,
        state: object.state,
        version: object.version,
        versions: object.versions.map((version) => ({
          id: version.id,
          number: version.number,
          sha256: Buffer.from(version.sha256).toString('hex'),
          sizeBytes: Number(version.sizeBytes),
          mimeType: version.mimeType,
          originalFilename: version.originalFilename,
          safetyState: 'UNCHECKED',
          createdAt: version.createdAt.toISOString(),
        })),
      },
      meta: { requestId: request.requestId },
    };
  }

  private async command<T>(
    request: StaffRequest,
    permission: string,
    auditAction: string,
    protectAdmins: boolean,
    work: (
      tx: Prisma.TransactionClient,
      actorPermissions: string[],
    ) => Promise<T>,
    lockPlan: (tx: Prisma.TransactionClient) => Promise<{
      userIds?: string[];
      roleIds?: string[];
      sessionUserIds?: string[];
    }> = async () => ({}),
  ): Promise<T> {
    const actor = this.principal(request);
    try {
      return await this.db.$transaction(
        async (tx) => {
          if (protectAdmins) await acquireAdminInvariantLock(tx);
          const plan = await lockPlan(tx);
          const userIds = [
            ...new Set([actor.id, ...(plan.userIds ?? [])]),
          ].sort();
          await lockStaffUserRows(tx, userIds);
          await lockRoleRows(tx, plan.roleIds ?? []);
          await lockStaffSessionRows(tx, plan.sessionUserIds ?? [], [
            actor.sessionId,
          ]);
          const actorPermissions = await assertCurrentActor(
            tx,
            actor,
            permission,
            false,
            true,
          );
          const result = await work(tx, actorPermissions);
          if (protectAdmins) await assertAdminInvariants(tx);
          return result;
        },
        { isolationLevel: 'ReadCommitted' },
      );
    } catch (error) {
      const mapped = this.mapCommandError(error, auditAction);
      if (mapped instanceof StaffError && mapped.code !== 'AUDIT_UNAVAILABLE')
        await this.deny(request, auditAction, mapped);
      throw mapped;
    }
  }

  private async success(tx: Prisma.TransactionClient, input: AuditInput) {
    try {
      await createAuditEvent(tx, input);
    } catch {
      throw new StaffError('AUDIT_UNAVAILABLE');
    }
  }

  private async deny(request: StaffRequest, action: string, error: unknown) {
    const actor = this.principal(request);
    const code = error instanceof StaffError ? error.code : 'INTERNAL_ERROR';
    await this.audit.writeDenied({
      actorKind: 'STAFF',
      actorUserId: actor.id,
      action,
      outcome: code === 'INTERNAL_ERROR' ? 'FAILURE' : 'DENIED',
      reasonCode: code === 'INTERNAL_ERROR' ? 'INTERNAL_ERROR' : code,
      requestId: request.requestId,
    });
  }

  private mapCommandError(error: unknown, action: string) {
    if (error instanceof StaffError) return error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        if (action === 'staff.user.created')
          return new StaffError('EMAIL_IN_USE');
        return new StaffError('VERSION_CONFLICT');
      }
      if (error.code === 'P2003' || error.code === 'P2025')
        return new StaffError('NOT_FOUND');
    }
    return new StaffError('DEPENDENCY_UNAVAILABLE');
  }

  private principal(request: StaffRequest): StaffPrincipal {
    if (!request.staff) throw new StaffError('AUTH_REQUIRED');
    return request.staff;
  }

  private clock(tx: Prisma.TransactionClient) {
    return tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`.then(
      (rows) => {
        const row = rows[0];
        if (!row) throw new StaffError('DEPENDENCY_UNAVAILABLE');
        return row;
      },
    );
  }
}

function mutation(
  request: StaffRequest,
  value: { id: string; version: number },
) {
  return { data: value, meta: { requestId: request.requestId } };
}

function encodeCursor(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor<T extends Record<string, unknown>>(
  value: string,
  validate: (decoded: Record<string, unknown>) => decoded is T,
): T {
  try {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error();
    const raw = Buffer.from(value, 'base64url');
    if (raw.toString('base64url') !== value) throw new Error();
    const decoded = JSON.parse(raw.toString('utf8')) as T;
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      Array.isArray(decoded) ||
      !validate(decoded as Record<string, unknown>)
    )
      throw new Error();
    return decoded as T;
  } catch {
    throw new StaffError('VALIDATION_ERROR', [
      { field: 'cursor', code: 'INVALID_CURSOR' },
    ]);
  }
}

function hasOnlyKeys(value: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function decodeIdCursor(value: string) {
  return decodeCursor<{ id: string }>(
    value,
    (decoded): decoded is { id: string } =>
      hasOnlyKeys(decoded, ['id']) && isUuid(decoded.id),
  );
}

function decodePermissionCursor(value: string) {
  return decodeCursor<{ code: string }>(
    value,
    (decoded): decoded is { code: string } =>
      hasOnlyKeys(decoded, ['code']) &&
      typeof decoded.code === 'string' &&
      /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(decoded.code),
  );
}

function decodeAuditCursor(value: string) {
  return decodeCursor<{ occurredAt: string; id: string }>(
    value,
    (decoded): decoded is { occurredAt: string; id: string } => {
      if (
        !hasOnlyKeys(decoded, ['occurredAt', 'id']) ||
        !isUuid(decoded.id) ||
        typeof decoded.occurredAt !== 'string'
      )
        return false;
      const parsed = new Date(decoded.occurredAt);
      return (
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString() === decoded.occurredAt
      );
    },
  );
}

export function parsePage(limit: unknown, cursor: unknown) {
  const size =
    limit === undefined
      ? 50
      : typeof limit === 'string' && /^[0-9]{1,3}$/.test(limit)
        ? Number(limit)
        : NaN;
  if (!Number.isInteger(size) || size < 1 || size > 100)
    throw new StaffError('VALIDATION_ERROR', [
      { field: 'limit', code: 'OUT_OF_RANGE' },
    ]);
  if (
    cursor !== undefined &&
    (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 256)
  )
    throw new StaffError('VALIDATION_ERROR', [
      { field: 'cursor', code: 'INVALID_CURSOR' },
    ]);
  return { limit: size, cursor: cursor as string | undefined };
}

export function parseExpectedVersion(value: unknown) {
  const parsed =
    typeof value === 'string' && /^[0-9]{1,10}$/.test(value)
      ? Number(value)
      : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2_147_483_647)
    throw new StaffError('VALIDATION_ERROR', [
      { field: 'expectedVersion', code: 'OUT_OF_RANGE' },
    ]);
  return parsed;
}

function sellerInput(
  input:
    | CreateSellerDto
    | {
        displayName: string;
        legalName: string | null;
        kind: string;
        inn: string | null;
        kpp: string | null;
        ogrn: string | null;
        legalAddress: string | null;
      },
) {
  return {
    displayName: input.displayName.trim(),
    legalName: input.legalName ?? null,
    kind: input.kind,
    inn: input.inn ?? null,
    kpp: input.kpp ?? null,
    ogrn: input.ogrn ?? null,
    legalAddress: input.legalAddress ?? null,
  };
}

function sellerPatch(input: PatchSellerDto) {
  const patch: Record<string, string | null> = {};
  for (const key of [
    'displayName',
    'legalName',
    'kind',
    'inn',
    'kpp',
    'ogrn',
    'legalAddress',
  ] as const) {
    if (input[key] !== undefined)
      patch[key] =
        key === 'displayName' && typeof input[key] === 'string'
          ? input[key].trim()
          : (input[key] as string | null);
  }
  return patch;
}

function validateSeller(
  seller: {
    displayName: string;
    legalName: string | null;
    kind: string;
    inn: string | null;
    kpp: string | null;
    ogrn: string | null;
    legalAddress: string | null;
  },
  state: string,
) {
  const valid =
    seller.kind === 'OOO'
      ? (!seller.inn || /^[0-9]{10}$/.test(seller.inn)) &&
        (!seller.kpp || /^[0-9]{9}$/.test(seller.kpp)) &&
        (!seller.ogrn || /^[0-9]{13}$/.test(seller.ogrn))
      : seller.kind === 'IP' &&
        (!seller.inn || /^[0-9]{12}$/.test(seller.inn)) &&
        seller.kpp === null &&
        (!seller.ogrn || /^[0-9]{15}$/.test(seller.ogrn));
  if (
    !valid ||
    (state === 'ACTIVE' && (!seller.legalName?.trim() || !seller.inn))
  )
    throw new StaffError('VALIDATION_ERROR', [
      { field: 'requisites', code: 'INVALID_COMBINATION' },
    ]);
}

function sellerDto(seller: {
  id: string;
  displayName: string;
  legalName: string | null;
  kind: string;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  state: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...seller,
    createdAt: seller.createdAt.toISOString(),
    updatedAt: seller.updatedAt.toISOString(),
  };
}
