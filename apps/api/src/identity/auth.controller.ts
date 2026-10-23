import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto, LoginDto } from './auth.dto.js';
import { OptionalSession, StaffOperation } from './authorization.js';
import { CsrfGuard, StaffSessionGuard } from './guards.js';
import type { StaffRequest } from './request.js';
import { STAFF_OPENAPI_MODELS } from '../openapi.dto.js';

@ApiTags('staff-auth')
@ApiExtraModels(...STAFF_OPENAPI_MODELS)
@Controller('v1/staff/auth')
@UseGuards(StaffSessionGuard, CsrfGuard)
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('csrf')
  @OptionalSession()
  @ApiOperation({ operationId: 'getCsrf' })
  @StaffOperation({ permission: null, csrf: 'NONE', audit: 'none' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/CsrfResponse' } })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiResponse({ status: 429 })
  @ApiResponse({ status: 500 })
  @ApiResponse({ status: 503 })
  async csrf(
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.getCsrf(request, response);
  }

  @Post('login')
  @HttpCode(200)
  @OptionalSession()
  @ApiOperation({ operationId: 'login' })
  @StaffOperation({
    permission: null,
    csrf: 'LOGIN_OR_STAFF_BOUND',
    audit: 'auth.login; staff.sessions.revoked if session-limit eviction',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/MeResponse' } })
  @ApiBadRequestResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiResponse({ status: 409 })
  @ApiResponse({ status: 415 })
  @ApiResponse({ status: 429 })
  @ApiResponse({ status: 500 })
  @ApiResponse({ status: 503 })
  async login(
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() input: LoginDto,
  ) {
    return this.auth.login(request, response, input);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ operationId: 'logout' })
  @StaffOperation({
    permission: null,
    csrf: 'STAFF_BOUND',
    audit: 'auth.logout',
  })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessResponse' } })
  @ApiBadRequestResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiResponse({ status: 415 })
  @ApiResponse({ status: 500 })
  @ApiResponse({ status: 503 })
  logout(
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.logout(request, response);
  }

  @Get('me')
  @ApiOperation({ operationId: 'getMe' })
  @StaffOperation({ permission: null, csrf: 'NONE', audit: 'none' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/MeResponse' } })
  @ApiBadRequestResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiResponse({ status: 500 })
  @ApiResponse({ status: 503 })
  me(@Req() request: StaffRequest) {
    return this.auth.getMe(request);
  }

  @Get('me/permissions')
  @ApiOperation({ operationId: 'getMyPermissions' })
  @StaffOperation({ permission: null, csrf: 'NONE', audit: 'none' })
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/MyPermissionsResponse' },
  })
  @ApiBadRequestResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiResponse({ status: 500 })
  @ApiResponse({ status: 503 })
  permissions(@Req() request: StaffRequest) {
    return this.auth.getMyPermissions(request);
  }

  @Put('me/password')
  @ApiOperation({ operationId: 'changeMyPassword' })
  @StaffOperation({
    permission: null,
    csrf: 'STAFF_BOUND',
    audit:
      'staff.password.changed; staff.sessions.revoked; auth.session.rotated',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/MeResponse' } })
  @ApiBadRequestResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiResponse({ status: 409 })
  @ApiResponse({ status: 415 })
  @ApiResponse({ status: 429 })
  @ApiResponse({ status: 500 })
  @ApiResponse({ status: 503 })
  changePassword(
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() input: ChangePasswordDto,
  ) {
    return this.auth.changePassword(request, response, input);
  }
}
