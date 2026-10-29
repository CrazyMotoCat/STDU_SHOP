import { Module } from '@nestjs/common';
import { ScanWorkerService } from './scan-worker.service.js';

@Module({ providers: [ScanWorkerService], exports: [ScanWorkerService] })
export class ScanWorkerModule {}
