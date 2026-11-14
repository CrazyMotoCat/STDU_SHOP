import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { SupplierApplyService } from './supplier-apply.service.js';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { SupplierExtractionClient } from './supplier-extraction.client.js';
import {
  IngestionBoundary,
  SupplierIngestionController,
} from './supplier-ingestion.controller.js';
import { SupplierIngestionService } from './supplier-ingestion.service.js';
import { SupplierIngestionWorker } from './supplier-ingestion.worker.js';

@Module({
  imports: [IdentityModule, SuppliersModule],
  controllers: [SupplierIngestionController],
  providers: [
    SupplierApplyService,
    SupplierExtractionClient,
    SupplierIngestionService,
    SupplierIngestionWorker,
    IngestionBoundary,
  ],
})
export class SupplierIngestionModule {}
