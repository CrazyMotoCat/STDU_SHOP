import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { readConfig } from './config.js';
import {
  HttpBoundaryFilter,
  installRequestBoundary,
} from './identity/http-boundary.js';
import { StaffError } from './identity/errors.js';

export async function createApiApp() {
  const config = readConfig(process.env);
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use(installRequestBoundary);
  app.use((request: Request, _response: Response, next: NextFunction) => {
    const isRawUpload =
      request.method === 'PUT' &&
      /^\/v1\/public\/inquiry-attachments\/upload-intents\/[^/]+\/content$/.test(
        request.path,
      );
    request.setTimeout(isRawUpload ? 60_000 : 120_000, () => {
      request.destroy(new Error('HTTP_REQUEST_IDLE_TIMEOUT'));
    });
    next();
  });
  app.use(
    express.json({ limit: '2mb', strict: true, type: 'application/json' }),
  );
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
        'If-Match',
        'X-Inquiry-Upload-Capability',
      ],
      exposedHeaders: ['ETag', 'X-Request-Id', 'Retry-After'],
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
  const server = app.getHttpServer();
  server.headersTimeout = 60_000;
  server.requestTimeout = 62 * 60_000;
  return app;
}
