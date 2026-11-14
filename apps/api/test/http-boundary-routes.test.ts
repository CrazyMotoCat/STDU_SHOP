import 'reflect-metadata';
import {
  Controller,
  Get,
  HttpException,
  Module,
  NotFoundException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  HttpBoundaryFilter,
  installRequestBoundary,
} from '../src/identity/http-boundary.js';
import { StaffError } from '../src/identity/errors.js';

const handler = vi.fn();
class Routes {
  download() {
    handler();
    throw new StaffError('FILE_NOT_ACCESSIBLE');
  }
  catalog() {
    return { data: [] };
  }
  publicCatalog() {
    return { data: [] };
  }
  inquiry() {
    return { data: [] };
  }
  internal() {
    throw new Error('SECRET INTERNAL');
  }
  httpFailure() {
    throw new HttpException('SECRET HTTP', 503);
  }
  missing() {
    throw new NotFoundException('SECRET RESOURCE');
  }
}
class TestModule {}

Controller()(Routes);
Get('v1/staff/inquiries/:inquiryId/documents/:documentId/download')(
  Routes.prototype,
  'download',
  Object.getOwnPropertyDescriptor(Routes.prototype, 'download')!,
);
Get('v1/staff/catalog/products')(
  Routes.prototype,
  'catalog',
  Object.getOwnPropertyDescriptor(Routes.prototype, 'catalog')!,
);
Get('v1/public/catalog/products')(
  Routes.prototype,
  'publicCatalog',
  Object.getOwnPropertyDescriptor(Routes.prototype, 'publicCatalog')!,
);
Get('v1/public/inquiries')(
  Routes.prototype,
  'inquiry',
  Object.getOwnPropertyDescriptor(Routes.prototype, 'inquiry')!,
);
Get('v1/staff/internal-failure')(
  Routes.prototype,
  'internal',
  Object.getOwnPropertyDescriptor(Routes.prototype, 'internal')!,
);
Get('v1/staff/http-failure')(
  Routes.prototype,
  'httpFailure',
  Object.getOwnPropertyDescriptor(Routes.prototype, 'httpFailure')!,
);
Get('v1/staff/missing')(
  Routes.prototype,
  'missing',
  Object.getOwnPropertyDescriptor(Routes.prototype, 'missing')!,
);
Module({ controllers: [Routes] })(TestModule);

describe('SEC-API-ROUTE-001 HTTP boundary and route matching', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base: string;
  const path =
    '/v1/staff/inquiries/11111111-1111-4111-8111-111111111111/documents/22222222-2222-4222-8222-222222222222/download';
  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    app.use(installRequestBoundary);
    app.useGlobalFilters(new HttpBoundaryFilter());
    await app.listen(0, '127.0.0.1');
    base =
      'http://127.0.0.1:' + (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each([
    path.replace('/download', '/%64ownload'),
    path.replace('/download', '/%2564ownload'),
    path.replace('/documents/', '/%64ocuments/'),
    path.replace('/download', '//download'),
    path.replace('/download', '/%2fdownload'),
    path.replace('/download', '/%2Fdownload'),
    path.replace('/download', '/%252fdownload'),
    path.replace('/download', '/down%2fload'),
    path.replace('/inquiries/', '/%69nquiries/'),
    path.replace('/download', '/not-registered'),
    '/v1/staff/unregistered',
    '/v1/staff/catalog/not-registered',
    '/v1/staff/catalog/%70roducts',
    '/v1/staff/catalog//products',
    '/v1/public/catalog/not-registered',
    '/v1/public/inquiries/not-registered',
    '/v1/public/inquiry-attachments/not-registered',
  ])(
    'normalizes an unmatched URL without invoking the handler: %s',
    async (url) => {
      handler.mockClear();
      const response = await fetch(base + url);
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.code).toBe('NOT_FOUND');
      expect(body.requestId).toBe(response.headers.get('x-request-id'));
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(JSON.stringify(body)).not.toContain(url);
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each([
    path,
    path.replace('/download', '/DOWNLOAD'),
    path + '/',
    path.replace('11111111', '%31111111'),
  ])('preserves existing routing and domain denial: %s', async (url) => {
    handler.mockClear();
    const response = await fetch(base + url);
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('FILE_NOT_ACCESSIBLE');
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each(['%E0%A4%A', '%ZZ'])(
    'keeps malformed dynamic parameter decoding a 400: %s',
    async (id) => {
      handler.mockClear();
      const response = await fetch(
        base + path.replace('11111111-1111-4111-8111-111111111111', id),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('VALIDATION_ERROR');
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('preserves the legacy boundary for unrelated unmatched routes', async () => {
    const response = await fetch(base + '/unregistered');
    expect(response.status).toBe(404);
    expect((await response.json()).statusCode).toBe(404);
  });

  it.each(['/v1/staff/internal-failure', '/v1/staff/http-failure'])(
    'keeps real internal failures sanitized and diagnosed: %s',
    async (url) => {
      const log = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      try {
        const response = await fetch(base + url);
        expect(response.status).toBe(500);
        expect((await response.json()).code).toBe('INTERNAL_ERROR');
        expect(log).toHaveBeenCalledWith(
          expect.stringContaining('code=INTERNAL_ERROR'),
        );
      } finally {
        log.mockRestore();
      }
    },
  );

  it('sanitizes a framework 404 independently of its resource message', async () => {
    const response = await fetch(base + '/v1/staff/missing');
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).toContain('NOT_FOUND');
    expect(text).not.toContain('SECRET');
  });

  it.each([
    '/v1/staff/catalog/products',
    '/v1/public/catalog/products',
    '/v1/public/inquiries',
  ])('preserves registered routes: %s', async (url) => {
    const response = await fetch(base + url);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });
});
