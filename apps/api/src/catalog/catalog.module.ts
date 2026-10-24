import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import {
  CatalogPublicController,
  CatalogStaffController,
} from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CatalogProductService } from './catalog.product.service.js';
import { CatalogImportController } from '../catalog-import/catalog-import.controller.js';
import { CatalogImportService } from '../catalog-import/catalog-import.service.js';
import { PrivateFileStorage } from '../storage/private-file-storage.js';

@Module({
  imports: [IdentityModule],
  controllers: [
    CatalogStaffController,
    CatalogPublicController,
    CatalogImportController,
  ],
  providers: [
    CatalogService,
    CatalogProductService,
    CatalogImportService,
    PrivateFileStorage,
  ],
})
export class CatalogModule {}
