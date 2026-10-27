import { Module } from '@nestjs/common';
import { readConfig } from './config.js';
import { DependencyProbe, READINESS_PROBE } from './health/dependencies.js';
import { HealthController } from './health/health.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { StaffModule } from './staff/staff.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';
import { InquiriesModule } from './inquiries/inquiries.module.js';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    StaffModule,
    CatalogModule,
    SuppliersModule,
    InquiriesModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: READINESS_PROBE,
      useFactory: () => new DependencyProbe(readConfig(process.env)),
    },
  ],
})
export class AppModule {}
