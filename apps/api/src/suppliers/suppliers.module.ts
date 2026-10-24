import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { SupplierStaffController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [SupplierStaffController],
  providers: [SuppliersService],
})
export class SuppliersModule {}
