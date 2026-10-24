import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { readConfig } from './config.js';
import {
  HttpBoundaryFilter,
  installRequestBoundary,
} from './identity/http-boundary.js';
import { StaffError } from './identity/errors.js';

export async function createApiApp() {
  const config = readConfig(process.env);
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use(installRequestBoundary);
  if (config.cookieProfile === 'loopback')
    app.enableCors({
      origin: config.allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Origin',
        'X-CSRF-Token',
        'Idempotency-Key',
      ],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      exceptionFactory: (errors) =>
        new StaffError(
          'VALIDATION_ERROR',
          errors.slice(0, 100).map((error) => ({
            field: error.property.slice(0, 100),
            code: 'INVALID',
          })),
        ),
    }),
  );
  app.useGlobalFilters(new HttpBoundaryFilter());
  app.enableShutdownHooks();
  return app;
}
