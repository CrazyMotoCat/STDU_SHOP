import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { StaffError, safeMessage } from './errors.js';
import type { StaffRequest } from './request.js';

@Catch()
export class HttpBoundaryFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<StaffRequest>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId ?? randomUUID();
    if (!request.path.startsWith('/v1/staff')) {
      const legacy = exception instanceof HttpException ? exception : null;
      response.status(legacy?.getStatus() ?? 500).json(
        legacy?.getResponse() ?? {
          statusCode: 500,
          message: 'Internal server error',
        },
      );
      return;
    }

    const error = exception instanceof StaffError ? exception : null;
    const code = error?.code ?? 'INTERNAL_ERROR';
    const status = error?.getStatus() ?? 500;
    if (error?.retryAfter)
      response.setHeader('Retry-After', String(error.retryAfter));
    if (status >= 500) console.error(`requestId=${requestId} code=${code}`);
    response.status(status).json({
      code,
      message: error ? safeMessage(code) : safeMessage('INTERNAL_ERROR'),
      requestId,
      ...(error?.fields?.length ? { fields: error.fields } : {}),
    });
  }
}

export function installRequestBoundary(
  request: Request,
  response: Response,
  next: () => void,
) {
  const requestId = randomUUID();
  (request as StaffRequest).requestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}
