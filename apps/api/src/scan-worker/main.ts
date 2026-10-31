import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ScanWorkerModule } from './scan-worker.module.js';
import { ScanWorkerService } from './scan-worker.service.js';

async function main() {
  const app = await NestFactory.createApplicationContext(ScanWorkerModule, {
    logger: ['error', 'warn'],
  });
  const worker = app.get(ScanWorkerService);
  const loop = worker.run();
  const signal = new Promise<void>((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
  try {
    await Promise.race([loop, signal]);
  } finally {
    await worker.stop();
    await app.close();
    await loop;
  }
}

void main().catch(() => {
  process.stderr.write('Scanner worker startup failed.\n');
  process.exitCode = 1;
});
