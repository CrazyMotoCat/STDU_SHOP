import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import {
  CatalogPublicController,
  CatalogStaffController,
} from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CatalogProductService } from './catalog.product.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [CatalogStaffController, CatalogPublicController],
  providers: [CatalogService, CatalogProductService],
})
export class CatalogModule {}
