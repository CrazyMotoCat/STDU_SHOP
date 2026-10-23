import type { Type } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { ApiSchema } from '@nestjs/swagger';
import { PERMISSION_CODES } from './permissions/policy.js';

const permissionCodes = PERMISSION_CODES;

const errorCodes = [
  'VALIDATION_ERROR',
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'CSRF_INVALID',
  'ORIGIN_FORBIDDEN',
  'NOT_FOUND',
  'EMAIL_IN_USE',
  'LAST_ADMIN_REQUIRED',
  'SELF_PRIVILEGE_CHANGE_FORBIDDEN',
  'GRANT_CEILING_EXCEEDED',
  'ROLE_IN_USE',
  'VERSION_CONFLICT',
  'INVALID_STATE_TRANSITION',
  'ALREADY_AUTHENTICATED',
  'RATE_LIMITED',
  'UNSUPPORTED_MEDIA_TYPE',
  'AUDIT_UNAVAILABLE',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
  'CURRENT_PASSWORD_INVALID',
] as const;
const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

@ApiSchema({ name: 'Meta' })
export class MetaDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) requestId!: string;
}

@ApiSchema({ name: 'Error' })
export class ErrorDto {
  @ApiProperty({ type: 'string', enum: [...errorCodes] }) code!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 240 })
  message!: string;
  @ApiProperty({ type: 'string', format: 'uuid' }) requestId!: string;
  @ApiProperty({
    type: 'array',
    maxItems: 100,
    required: false,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        field: { type: 'string', minLength: 1, maxLength: 100 },
        code: { type: 'string', minLength: 1, maxLength: 64 },
      },
      required: ['field', 'code'],
    },
  })
  fields?: { field: string; code: string }[];
}

@ApiSchema({ name: 'Csrf' })
export class CsrfDataDto {
  @ApiProperty({
    type: 'string',
    minLength: 43,
    maxLength: 43,
    pattern: '^[A-Za-z0-9_-]{43}$',
    description:
      'Session/challenge-bound HMAC, not staff credential; no logs/storage.',
  })
  token!: string;
  @ApiProperty({ type: 'string', enum: ['LOGIN', 'STAFF'] }) context!:
    'LOGIN' | 'STAFF';
}

@ApiSchema({ name: 'Me' })
export class MeDataDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({
    type: 'string',
    format: 'email',
    minLength: 1,
    maxLength: 254,
    pattern: emailPattern.source,
  })
  email!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 120 })
  displayName!: string;
  @ApiProperty({ type: 'string', enum: ['ACTIVE'] }) state!: 'ACTIVE';
  @ApiProperty({ type: 'boolean' }) passwordChangeRequired!: boolean;
}

@ApiSchema({ name: 'MyPermissions' })
export class MyPermissionsDataDto {
  @ApiProperty({
    type: [String],
    enum: [...permissionCodes],
    maxItems: 100,
    uniqueItems: true,
  })
  permissions!: string[];
  @ApiProperty({ type: 'boolean' }) passwordChangeRequired!: boolean;
}

@ApiSchema({ name: 'Success' })
export class SuccessDataDto {
  @ApiProperty({ type: 'boolean', enum: [true] }) success!: true;
}

@ApiSchema({ name: 'StaffUser' })
export class StaffUserDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({
    type: 'string',
    format: 'email',
    minLength: 1,
    maxLength: 254,
    pattern: emailPattern.source,
  })
  email!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 120 })
  displayName!: string;
  @ApiProperty({ type: 'string', enum: ['ACTIVE', 'BLOCKED'] }) state!:
    'ACTIVE' | 'BLOCKED';
  @ApiProperty({ type: 'boolean' }) passwordChangeRequired!: boolean;
  @ApiProperty({
    type: [String],
    items: { type: 'string', format: 'uuid' },
    uniqueItems: true,
  })
  roleIds!: string[];
  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
  })
  version!: number;
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string;
}

@ApiSchema({ name: 'Role' })
export class RoleDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({
    type: 'string',
    minLength: 2,
    maxLength: 64,
    pattern: '^[a-z][a-z0-9.-]{1,63}$',
  })
  code!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 120 }) name!: string;
  @ApiProperty({ type: 'string', enum: ['ACTIVE', 'ARCHIVED'] }) state!:
    'ACTIVE' | 'ARCHIVED';
  @ApiProperty({
    type: [String],
    enum: [...permissionCodes],
    maxItems: 100,
    uniqueItems: true,
  })
  permissions!: string[];
  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
  })
  version!: number;
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string;
}

@ApiSchema({ name: 'Permission' })
export class PermissionDto {
  @ApiProperty({ type: 'string', enum: [...permissionCodes] }) code!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 240 })
  description!: string;
}

@ApiSchema({ name: 'Seller' })
export class SellerDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 160 })
  displayName!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500, nullable: true })
  legalName!: string | null;
  @ApiProperty({ type: 'string', enum: ['OOO', 'IP'] }) kind!: 'OOO' | 'IP';
  @ApiProperty({
    type: 'string',
    minLength: 1,
    maxLength: 12,
    pattern: '^(?:[0-9]{10}|[0-9]{12})$',
    nullable: true,
  })
  inn!: string | null;
  @ApiProperty({
    type: 'string',
    minLength: 9,
    maxLength: 9,
    pattern: '^[0-9]{9}$',
    nullable: true,
  })
  kpp!: string | null;
  @ApiProperty({
    type: 'string',
    minLength: 1,
    maxLength: 15,
    pattern: '^(?:[0-9]{13}|[0-9]{15})$',
    nullable: true,
  })
  ogrn!: string | null;
  @ApiProperty({
    type: 'string',
    minLength: 1,
    maxLength: 1000,
    nullable: true,
  })
  legalAddress!: string | null;
  @ApiProperty({ type: 'string', enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] })
  state!: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
  })
  version!: number;
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string;
}

@ApiSchema({ name: 'AuditChanges' })
export class AuditChangesDto {
  @ApiProperty({
    type: [String],
    minLength: 1,
    maxLength: 64,
    maxItems: 100,
    required: false,
  })
  changedFields?: string[];
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 32, required: false })
  previousState?: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 32, required: false })
  state?: string;
  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  roleId?: string;
  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  targetUserId?: string;
  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  sellerId?: string;
  @ApiProperty({
    type: [String],
    enum: [...permissionCodes],
    maxItems: 100,
    uniqueItems: true,
    required: false,
  })
  addedPermissions?: string[];
  @ApiProperty({
    type: [String],
    enum: [...permissionCodes],
    maxItems: 100,
    uniqueItems: true,
    required: false,
  })
  removedPermissions?: string[];
  @ApiProperty({ type: 'integer', minimum: 0, required: false })
  affectedUserCount?: number;
  @ApiProperty({ type: 'integer', minimum: 0, required: false }) count?: number;
  @ApiProperty({ type: 'boolean', required: false })
  passwordChangeRequired?: boolean;
  @ApiProperty({
    type: 'string',
    enum: ['NORMAL', 'LAST_ADMIN_OWNER'],
    required: false,
  })
  recoveryMode?: 'NORMAL' | 'LAST_ADMIN_OWNER';
  @ApiProperty({
    type: 'string',
    minLength: 64,
    maxLength: 64,
    pattern: '^[a-f0-9]{64}$',
    required: false,
  })
  accountFingerprint?: string;
  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
    required: false,
  })
  version?: number;
}

@ApiSchema({ name: 'AuditEvent' })
export class AuditEventDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ type: 'string', enum: ['STAFF', 'ANONYMOUS', 'OPERATOR'] })
  actorKind!: string;
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  actorUserId!: string | null;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 80, nullable: true })
  operatorLabel!: string | null;
  @ApiProperty({
    type: 'string',
    minLength: 1,
    maxLength: 80,
    enum: [
      'auth.login',
      'auth.logout',
      'staff.sessions.revoked',
      'auth.session.rotated',
      'auth.session.expired',
      'staff.bootstrap',
      'staff.access.recovered',
      'staff.password.changed',
      'staff.password.rehashed',
      'staff.user.created',
      'staff.user.state.changed',
      'staff.role.created',
      'staff.role.changed',
      'staff.role.assigned',
      'staff.role.removed',
      'staff.role.permissions.changed',
      'seller.created',
      'seller.changed',
      'file.metadata.changed',
      'file.version.created',
      'file.link.changed',
    ],
  })
  action!: string;
  @ApiProperty({
    type: 'string',
    enum: [
      'StaffUser',
      'Role',
      'StaffSession',
      'SellerLegalEntity',
      'FileObject',
      'FileVersion',
      'FileLink',
      null,
    ],
    nullable: true,
  })
  entityType!: string | null;
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) entityId!:
    string | null;
  @ApiProperty({ type: 'string', enum: ['SUCCESS', 'DENIED', 'FAILURE'] })
  outcome!: string;
  @ApiProperty({
    type: 'string',
    enum: [
      'ACCESS_RECOVERED',
      'ADMIN_REVOKE',
      'ALREADY_AUTHENTICATED',
      'AUTH_REQUIRED',
      'BOOTSTRAP',
      'BOOTSTRAP_ALREADY_COMPLETED',
      'CREDENTIALS_VERIFIED',
      'CSRF_INVALID',
      'CURRENT_PASSWORD_INVALID',
      'DEPENDENCY_UNAVAILABLE',
      'EMAIL_IN_USE',
      'FORBIDDEN',
      'GRANT_CEILING_EXCEEDED',
      'HASH_UPGRADED',
      'INTERNAL_ERROR',
      'INVALID_CREDENTIALS',
      'INVALID_STATE_TRANSITION',
      'LAST_ADMIN_REQUIRED',
      'LOGOUT',
      'NOT_FOUND',
      null,
      'ORIGIN_FORBIDDEN',
      'OWNER_CONFIRMED',
      'PASSWORD_CHANGE_REQUIRED',
      'PASSWORD_CHANGED',
      'RATE_LIMITED',
      'ROLE_ASSIGNED',
      'ROLE_IN_USE',
      'ROLE_PERMISSIONS_CHANGED',
      'ROLE_REMOVED',
      'SELF_PRIVILEGE_CHANGE_FORBIDDEN',
      'SESSION_ABSOLUTE_EXPIRED',
      'SESSION_IDLE_EXPIRED',
      'SESSION_LIMIT',
      'UNSUPPORTED_MEDIA_TYPE',
      'USER_BLOCKED',
      'USER_UNBLOCKED',
      'VALIDATION_ERROR',
      'VERSION_CONFLICT',
    ],
    nullable: true,
  })
  reasonCode!: string | null;
  @ApiProperty({ type: 'string', format: 'uuid' }) requestId!: string;
  @ApiProperty({ type: () => AuditChangesDto }) changes!: AuditChangesDto;
}

@ApiSchema({ name: 'FileVersionMetadata' })
export class FileVersionMetadataDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
  })
  number!: number;
  @ApiProperty({
    type: 'string',
    minLength: 64,
    maxLength: 64,
    pattern: '^[a-f0-9]{64}$',
  })
  sha256!: string;
  @ApiProperty({
    type: 'integer',
    format: 'int64',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  sizeBytes!: number;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 127 })
  mimeType!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 255 })
  originalFilename!: string;
  @ApiProperty({ type: 'string', enum: ['UNCHECKED'] })
  safetyState!: 'UNCHECKED';
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string;
}

@ApiSchema({ name: 'FileMetadata' })
export class FileMetadataDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', format: 'uuid' }) ownerStaffUserId!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 255 })
  displayName!: string;
  @ApiProperty({ type: 'string', enum: ['PRIVATE', 'INTERNAL'] })
  visibility!: string;
  @ApiProperty({ type: 'string', enum: ['ACTIVE', 'ARCHIVED'] }) state!: string;
  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
  })
  version!: number;
  @ApiProperty({ type: [FileVersionMetadataDto] })
  versions!: FileVersionMetadataDto[];
}

function responseSchema(name: string, data: Type<unknown>) {
  @ApiSchema({ name })
  class ResponseDto {
    @ApiProperty({ type: () => data }) data!: unknown;
    @ApiProperty({ type: () => MetaDto }) meta!: MetaDto;
  }
  return ResponseDto;
}

function listResponseSchema(name: string, item: Type<unknown>) {
  @ApiSchema({ name })
  class ResponseDto {
    @ApiProperty({ type: [item], maxItems: 100 }) data!: unknown[];
    @ApiProperty({
      type: 'object',
      additionalProperties: false,
      selfRequired: true,
      properties: {
        requestId: { type: 'string', format: 'uuid' },
        nextCursor: {
          type: 'string',
          minLength: 1,
          maxLength: 256,
          nullable: true,
        },
      },
      required: ['requestId', 'nextCursor'],
    })
    meta!: { requestId: string; nextCursor: string | null };
  }
  return ResponseDto;
}

export const CsrfResponseDto = responseSchema('CsrfResponse', CsrfDataDto);
export const MeResponseDto = responseSchema('MeResponse', MeDataDto);
export const MyPermissionsResponseDto = responseSchema(
  'MyPermissionsResponse',
  MyPermissionsDataDto,
);
export const SuccessResponseDto = responseSchema(
  'SuccessResponse',
  SuccessDataDto,
);
export const SellerResponseDto = responseSchema('SellerResponse', SellerDto);
export const FileMetadataResponseDto = responseSchema(
  'FileMetadataResponse',
  FileMetadataDto,
);
export const StaffUserListResponseDto = listResponseSchema(
  'StaffUserListResponse',
  StaffUserDto,
);
export const RoleListResponseDto = listResponseSchema(
  'RoleListResponse',
  RoleDto,
);
export const PermissionListResponseDto = listResponseSchema(
  'PermissionListResponse',
  PermissionDto,
);
export const SellerListResponseDto = listResponseSchema(
  'SellerListResponse',
  SellerDto,
);
export const AuditEventListResponseDto = listResponseSchema(
  'AuditEventListResponse',
  AuditEventDto,
);
@ApiSchema({ name: 'MutationResponse' })
export class MutationResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    selfRequired: true,
    required: ['id', 'version'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      version: {
        type: 'integer',
        format: 'int32',
        minimum: 1,
        maximum: 2147483647,
      },
    },
  })
  data!: { id: string; version: number };
  @ApiProperty({ type: () => MetaDto }) meta!: MetaDto;
}

export const STAFF_OPENAPI_MODELS = [
  MetaDto,
  ErrorDto,
  CsrfDataDto,
  MeDataDto,
  MyPermissionsDataDto,
  SuccessDataDto,
  StaffUserDto,
  RoleDto,
  PermissionDto,
  SellerDto,
  AuditChangesDto,
  AuditEventDto,
  FileVersionMetadataDto,
  FileMetadataDto,
  CsrfResponseDto,
  MeResponseDto,
  MyPermissionsResponseDto,
  SuccessResponseDto,
  SellerResponseDto,
  FileMetadataResponseDto,
  StaffUserListResponseDto,
  RoleListResponseDto,
  PermissionListResponseDto,
  SellerListResponseDto,
  AuditEventListResponseDto,
  MutationResponseDto,
];
