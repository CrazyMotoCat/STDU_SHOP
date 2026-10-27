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
    const catalogRequest =
      request.path.startsWith('/v1/staff/catalog') ||
      request.path.startsWith('/v1/public/catalog');
    const publicInquiryRequest =
      request.path.startsWith('/v1/public/inquiries') ||
      request.path.startsWith('/v1/public/inquiry-attachments');
    if (
      !request.path.startsWith('/v1/staff') &&
      !catalogRequest &&
      !publicInquiryRequest
    ) {
      const legacy = exception instanceof HttpException ? exception : null;
      response.status(legacy?.getStatus() ?? 500).json(
        legacy?.getResponse() ?? {
          statusCode: 500,
          message: 'Internal server error',
        },
      );
      return;
    }

    const multerCode =
      exception && typeof exception === 'object' && 'code' in exception
        ? (exception as { code?: unknown }).code
        : null;
    const parserType =
      exception && typeof exception === 'object' && 'type' in exception
        ? (exception as { type?: unknown }).type
        : null;
    const parserStatus =
      exception && typeof exception === 'object' && 'status' in exception
        ? (exception as { status?: unknown }).status
        : null;
    const error =
      exception instanceof StaffError
        ? exception
        : publicInquiryRequest && exception instanceof HttpException
          ? new StaffError(
              exception.getStatus() === 404
                ? 'NOT_FOUND'
                : exception.getStatus() === 413
                  ? 'FILE_TOO_LARGE'
                  : exception.getStatus() === 415
                    ? 'UNSUPPORTED_MEDIA_TYPE'
                    : 'VALIDATION_ERROR',
            )
          : multerCode === 'LIMIT_FILE_SIZE' ||
              parserType === 'entity.too.large' ||
              parserStatus === 413
            ? new StaffError('FILE_TOO_LARGE')
            : parserType === 'entity.parse.failed' || parserStatus === 400
              ? new StaffError('VALIDATION_ERROR')
              : null;
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
