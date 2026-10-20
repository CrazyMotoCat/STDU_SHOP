import { Module } from '@nestjs/common';
import { readConfig } from './config.js';
import { DependencyProbe, READINESS_PROBE } from './health/dependencies.js';
import { HealthController } from './health/health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: READINESS_PROBE,
      useFactory: () => new DependencyProbe(readConfig(process.env)),
    },
  ],
})
export class AppModule {}
