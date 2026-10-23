import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { IdentityCrypto } from './crypto.js';
import { CsrfGuard, PermissionGuard, StaffSessionGuard } from './guards.js';
import { RateLimitService } from './rate-limit.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuditService,
    IdentityCrypto,
    RateLimitService,
    StaffSessionGuard,
    CsrfGuard,
    PermissionGuard,
  ],
  exports: [
    AuthService,
    AuditService,
    IdentityCrypto,
    RateLimitService,
    StaffSessionGuard,
    CsrfGuard,
    PermissionGuard,
  ],
})
export class IdentityModule {}
