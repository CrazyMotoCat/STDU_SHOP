import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';
import { SupplierIngestionWorker } from '../../src/supplier-ingestion/supplier-ingestion.worker.js';

if (
  process.env.R1_008B_TEST_ENABLED !== 'true' ||
  !/^stdu-r1-008b-test-\d+-[a-f0-9]{8}$/.test(
    process.env.R1_008B_TEST_COMPOSE_PROJECT ?? '',
  )
) {
  throw new Error(
    'This crash fixture only runs on the isolated R1-008B project.',
  );
}
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
const claimed = await app.get(SupplierIngestionWorker).claim(process.argv[2]!);
if (!claimed) throw new Error('TEST worker failed to claim its run.');
console.log('TEST durable claim acquired; abrupt process termination follows.');
process.exit(91);
