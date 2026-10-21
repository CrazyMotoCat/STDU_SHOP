import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { readConfig } from './config.js';

async function bootstrap() {
  const config = readConfig(process.env);
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
}

bootstrap().catch(() => {
  console.error('API startup failed; check the required environment keys.');
  process.exitCode = 1;
});
