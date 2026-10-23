import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  type PipeTransform,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { StaffOperation } from '../identity/authorization.js';
import { StaffError } from '../identity/errors.js';
import {
  CsrfGuard,
  PermissionGuard,
  StaffSessionGuard,
} from '../identity/guards.js';
import type { StaffRequest } from '../identity/request.js';
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
import {
  parseExpectedVersion,
  parsePage,
  StaffService,
} from './staff.service.js';
import { STAFF_OPENAPI_MODELS } from '../openapi.dto.js';

const idV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class UuidV4Pipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (typeof value !== 'string' || !idV4.test(value))
      throw new StaffError('VALIDATION_ERROR', [
        { field: 'id', code: 'INVALID_UUID' },
      ]);
    return value.toLowerCase();
  }
}

const uuidPipe = new UuidV4Pipe();

function staffErrors(
  options: {
    notFound?: boolean;
    conflict?: boolean;
    unsupportedMedia?: boolean;
  } = {},
) {
  return applyDecorators(
    ApiBadRequestResponse({ schema: { $ref: '#/components/schemas/Error' } }),
    ApiUnauthorizedResponse({ schema: { $ref: '#/components/schemas/Error' } }),
    ApiForbiddenResponse({ schema: { $ref: '#/components/schemas/Error' } }),
    ...(options.notFound
      ? [
          ApiNotFoundResponse({
            schema: { $ref: '#/components/schemas/Error' },
          }),
        ]
      : []),
    ...(options.conflict
      ? [
          ApiResponse({
            status: 409,
            schema: { $ref: '#/components/schemas/Error' },
          }),
        ]
      : []),
    ...(options.unsupportedMedia
      ? [
          ApiResponse({
            status: 415,
            schema: { $ref: '#/components/schemas/Error' },
          }),
        ]
      : []),
    ApiResponse({
      status: 500,
      schema: { $ref: '#/components/schemas/Error' },
    }),
    ApiResponse({
      status: 503,
      schema: { $ref: '#/components/schemas/Error' },
    }),
  );
}

function listQuery() {
  return applyDecorators(
    ApiQuery({
      name: 'limit',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    }),
    ApiQuery({
      name: 'cursor',
      required: false,
      schema: { type: 'string', minLength: 1, maxLength: 256 },
    }),
  );
}

function idParam(name: string, description: string) {
  return ApiParam({
    name,
    required: true,
    description,
    schema: { type: 'string', format: 'uuid' },
  });
}

function mutationResponse(status = 200) {
  return ApiResponse({
    status,
    schema: { $ref: '#/components/schemas/MutationResponse' },
  });
}

@ApiTags('staff')
@ApiExtraModels(...STAFF_OPENAPI_MODELS)
@Controller('v1/staff')
@UseGuards(StaffSessionGuard, CsrfGuard, PermissionGuard)
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @Get('users')
  @StaffOperation({
    permission: 'staff.users.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'listStaffUsers' })
  @listQuery()
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/StaffUserListResponse' },
  })
  @staffErrors()
  listUsers(
    @Req() request: StaffRequest,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    const page = parsePage(limit, cursor);
    return this.staff.listUsers(request, page.limit, page.cursor);
  }

  @Post('users')
  @HttpCode(201)
  @StaffOperation({
    permission: 'staff.users.create',
    csrf: 'STAFF_BOUND',
    audit: 'staff.user.created',
  })
  @ApiOperation({ operationId: 'createStaffUser' })
  @ApiBody({ type: CreateStaffUserDto })
  @mutationResponse(201)
  @staffErrors({ conflict: true, unsupportedMedia: true })
  createUser(@Req() request: StaffRequest, @Body() input: CreateStaffUserDto) {
    return this.staff.createUser(request, input);
  }

  @Patch('users/:userId/status')
  @StaffOperation({
    permission: 'staff.users.status.write',
    csrf: 'STAFF_BOUND',
    audit: 'staff.user.state.changed; staff.sessions.revoked',
  })
  @ApiOperation({ operationId: 'setStaffUserState' })
  @idParam('userId', 'Target staff user UUID')
  @ApiBody({ type: UserStateDto })
  @mutationResponse()
  @staffErrors({ notFound: true, conflict: true, unsupportedMedia: true })
  setUserState(
    @Req() request: StaffRequest,
    @Param('userId', uuidPipe) userId: string,
    @Body() input: UserStateDto,
  ) {
    return this.staff.setUserState(request, userId, input);
  }

  @Post('users/:userId/sessions/revoke')
  @HttpCode(200)
  @StaffOperation({
    permission: 'staff.sessions.revoke',
    csrf: 'STAFF_BOUND',
    audit: 'staff.sessions.revoked',
  })
  @ApiOperation({ operationId: 'revokeStaffUserSessions' })
  @idParam('userId', 'Target staff user UUID')
  @ApiBody({ type: VersionedDto })
  @mutationResponse()
  @staffErrors({ notFound: true, conflict: true, unsupportedMedia: true })
  revokeSessions(
    @Req() request: StaffRequest,
    @Param('userId', uuidPipe) userId: string,
    @Body() input: VersionedDto,
  ) {
    return this.staff.revokeUserSessions(request, userId, input);
  }

  @Put('users/:userId/roles/:roleId')
  @StaffOperation({
    permission: 'staff.roles.assign',
    csrf: 'STAFF_BOUND',
    audit: 'staff.role.assigned; staff.sessions.revoked',
  })
  @ApiOperation({ operationId: 'assignStaffRole' })
  @idParam('userId', 'Target staff user UUID')
  @idParam('roleId', 'Role UUID')
  @ApiBody({ type: VersionedDto })
  @mutationResponse()
  @staffErrors({ notFound: true, conflict: true, unsupportedMedia: true })
  assignRole(
    @Req() request: StaffRequest,
    @Param('userId', uuidPipe) userId: string,
    @Param('roleId', uuidPipe) roleId: string,
    @Body() input: VersionedDto,
  ) {
    return this.staff.assignRole(request, userId, roleId, input);
  }

  @Delete('users/:userId/roles/:roleId')
  @StaffOperation({
    permission: 'staff.roles.assign',
    csrf: 'STAFF_BOUND',
    audit: 'staff.role.removed; staff.sessions.revoked',
  })
  @ApiOperation({ operationId: 'removeStaffRole' })
  @idParam('userId', 'Target staff user UUID')
  @idParam('roleId', 'Role UUID')
  @ApiQuery({
    name: 'expectedVersion',
    required: true,
    schema: {
      type: 'integer',
      format: 'int32',
      minimum: 1,
      maximum: 2147483647,
    },
  })
  @mutationResponse()
  @staffErrors({ notFound: true, conflict: true, unsupportedMedia: true })
  removeRole(
    @Req() request: StaffRequest,
    @Param('userId', uuidPipe) userId: string,
    @Param('roleId', uuidPipe) roleId: string,
    @Query('expectedVersion') version: unknown,
  ) {
    return this.staff.removeRole(
      request,
      userId,
      roleId,
      parseExpectedVersion(version),
    );
  }

  @Get('roles')
  @StaffOperation({
    permission: 'staff.roles.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'listRoles' })
  @listQuery()
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/RoleListResponse' } })
  @staffErrors()
  listRoles(
    @Req() request: StaffRequest,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    const page = parsePage(limit, cursor);
    return this.staff.listRoles(request, page.limit, page.cursor);
  }

  @Post('roles')
  @HttpCode(201)
  @StaffOperation({
    permission: 'staff.roles.write',
    csrf: 'STAFF_BOUND',
    audit: 'staff.role.created',
  })
  @ApiOperation({ operationId: 'createRole' })
  @ApiBody({ type: CreateRoleDto })
  @mutationResponse(201)
  @staffErrors({ conflict: true, unsupportedMedia: true })
  createRole(@Req() request: StaffRequest, @Body() input: CreateRoleDto) {
    return this.staff.createRole(request, input);
  }

  @Patch('roles/:roleId')
  @StaffOperation({
    permission: 'staff.roles.write',
    csrf: 'STAFF_BOUND',
    audit: 'staff.role.changed',
  })
  @ApiOperation({ operationId: 'changeRole' })
  @idParam('roleId', 'Role UUID')
  @ApiBody({ type: PatchRoleDto })
  @mutationResponse()
  @staffErrors({ notFound: true, conflict: true, unsupportedMedia: true })
  changeRole(
    @Req() request: StaffRequest,
    @Param('roleId', uuidPipe) roleId: string,
    @Body() input: PatchRoleDto,
  ) {
    return this.staff.changeRole(request, roleId, input);
  }

  @Put('roles/:roleId/permissions')
  @StaffOperation({
    permission: 'staff.roles.permissions.write',
    csrf: 'STAFF_BOUND',
    audit: 'staff.role.permissions.changed; staff.sessions.revoked',
  })
  @ApiOperation({ operationId: 'replaceRolePermissions' })
  @idParam('roleId', 'Role UUID')
  @ApiBody({ type: ReplaceRolePermissionsDto })
  @mutationResponse()
  @staffErrors({ notFound: true, conflict: true, unsupportedMedia: true })
  replacePermissions(
    @Req() request: StaffRequest,
    @Param('roleId', uuidPipe) roleId: string,
    @Body() input: ReplaceRolePermissionsDto,
  ) {
    return this.staff.replaceRolePermissions(request, roleId, input);
  }

  @Get('permissions')
  @StaffOperation({
    permission: 'staff.roles.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'listRegisteredPermissions' })
  @listQuery()
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/PermissionListResponse' },
  })
  @staffErrors()
  listPermissions(
    @Req() request: StaffRequest,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    const page = parsePage(limit, cursor);
    return this.staff.listPermissions(request, page.limit, page.cursor);
  }

  @Get('sellers')
  @StaffOperation({ permission: 'sellers.read', csrf: 'NONE', audit: 'none' })
  @ApiOperation({ operationId: 'listSellers' })
  @listQuery()
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/SellerListResponse' },
  })
  @staffErrors()
  listSellers(
    @Req() request: StaffRequest,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    const page = parsePage(limit, cursor);
    return this.staff.listSellers(request, page.limit, page.cursor);
  }

  @Post('sellers')
  @HttpCode(201)
  @StaffOperation({
    permission: 'sellers.write',
    csrf: 'STAFF_BOUND',
    audit: 'seller.created',
  })
  @ApiOperation({ operationId: 'createSeller' })
  @ApiBody({ type: CreateSellerDto })
  @mutationResponse(201)
  @staffErrors({ conflict: true, unsupportedMedia: true })
  createSeller(@Req() request: StaffRequest, @Body() input: CreateSellerDto) {
    return this.staff.createSeller(request, input);
  }

  @Get('sellers/:sellerId')
  @StaffOperation({ permission: 'sellers.read', csrf: 'NONE', audit: 'none' })
  @ApiOperation({ operationId: 'getSeller' })
  @idParam('sellerId', 'Seller legal entity UUID')
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SellerResponse' } })
  @staffErrors({ notFound: true })
  getSeller(
    @Req() request: StaffRequest,
    @Param('sellerId', uuidPipe) sellerId: string,
  ) {
    return this.staff.getSeller(request, sellerId);
  }

  @Patch('sellers/:sellerId')
  @StaffOperation({
    permission: 'sellers.write',
    csrf: 'STAFF_BOUND',
    audit: 'seller.changed',
  })
  @ApiOperation({ operationId: 'changeSeller' })
  @idParam('sellerId', 'Seller legal entity UUID')
  @ApiBody({ type: PatchSellerDto })
  @mutationResponse()
  @staffErrors({ notFound: true, conflict: true, unsupportedMedia: true })
  changeSeller(
    @Req() request: StaffRequest,
    @Param('sellerId', uuidPipe) sellerId: string,
    @Body() input: PatchSellerDto,
  ) {
    return this.staff.changeSeller(request, sellerId, input);
  }

  @Get('audit')
  @StaffOperation({ permission: 'audit.read', csrf: 'NONE', audit: 'none' })
  @ApiOperation({ operationId: 'listAudit' })
  @listQuery()
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/AuditEventListResponse' },
  })
  @staffErrors()
  listAudit(
    @Req() request: StaffRequest,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    const page = parsePage(limit, cursor);
    return this.staff.listAudit(request, page.limit, page.cursor);
  }

  @Get('files/:fileId/metadata')
  @StaffOperation({
    permission: 'files.metadata.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'getFileMetadata' })
  @idParam('fileId', 'File object UUID')
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/FileMetadataResponse' },
  })
  @staffErrors({ notFound: true })
  getFileMetadata(
    @Req() request: StaffRequest,
    @Param('fileId', uuidPipe) fileId: string,
  ) {
    return this.staff.getFileMetadata(request, fileId);
  }
}
