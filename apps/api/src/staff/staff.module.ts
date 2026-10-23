import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
