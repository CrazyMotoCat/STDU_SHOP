import { HttpException } from '@nestjs/common';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'CSRF_INVALID',
  'ORIGIN_FORBIDDEN',
  'NOT_FOUND',
  'EMAIL_IN_USE',
  'LAST_ADMIN_REQUIRED',
  'SELF_PRIVILEGE_CHANGE_FORBIDDEN',
  'GRANT_CEILING_EXCEEDED',
  'ROLE_IN_USE',
  'VERSION_CONFLICT',
  'INVALID_STATE_TRANSITION',
  'ALREADY_AUTHENTICATED',
  'RATE_LIMITED',
  'UNSUPPORTED_MEDIA_TYPE',
  'AUDIT_UNAVAILABLE',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
  'CURRENT_PASSWORD_INVALID',
  'IDENTITY_CONFLICT',
  'SLUG_CONFLICT',
  'CATEGORY_CYCLE',
  'CATEGORY_INACTIVE_PARENT',
  'ATTRIBUTE_NOT_APPLICABLE',
  'PUBLICATION_NOT_READY',
  'REFERENCE_IN_USE',
  'FILE_NOT_ACCESSIBLE',
  'ENCODING_REQUIRED',
  'INVALID_ENCODING',
  'FILE_REJECTED',
  'FILE_TOO_LARGE',
  'IMPORT_LIMIT_EXCEEDED',
  'IDEMPOTENCY_KEY_REUSED',
  'IMPORT_ROW_CONFLICT',
  'INGESTION_UNAVAILABLE',
  'SUPPLIER_IDENTITY_CONFLICT',
  'IDENTITY_CHANGED',
  'MATCH_ALREADY_PENDING',
  'INCOMPLETE_IDENTITY',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export interface ErrorField {
  field: string;
  code: string;
}

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  AUTH_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  CSRF_INVALID: 403,
  ORIGIN_FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_IN_USE: 409,
  LAST_ADMIN_REQUIRED: 409,
  SELF_PRIVILEGE_CHANGE_FORBIDDEN: 403,
  GRANT_CEILING_EXCEEDED: 403,
  ROLE_IN_USE: 409,
  VERSION_CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  ALREADY_AUTHENTICATED: 409,
  RATE_LIMITED: 429,
  UNSUPPORTED_MEDIA_TYPE: 415,
  AUDIT_UNAVAILABLE: 503,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
  CURRENT_PASSWORD_INVALID: 400,
  IDENTITY_CONFLICT: 409,
  SLUG_CONFLICT: 409,
  CATEGORY_CYCLE: 409,
  CATEGORY_INACTIVE_PARENT: 409,
  ATTRIBUTE_NOT_APPLICABLE: 400,
  PUBLICATION_NOT_READY: 409,
  REFERENCE_IN_USE: 409,
  FILE_NOT_ACCESSIBLE: 404,
  ENCODING_REQUIRED: 400,
  INVALID_ENCODING: 400,
  FILE_REJECTED: 400,
  FILE_TOO_LARGE: 413,
  IMPORT_LIMIT_EXCEEDED: 413,
  IDEMPOTENCY_KEY_REUSED: 409,
  IMPORT_ROW_CONFLICT: 409,
  INGESTION_UNAVAILABLE: 503,
  SUPPLIER_IDENTITY_CONFLICT: 409,
  IDENTITY_CHANGED: 409,
  MATCH_ALREADY_PENDING: 409,
  INCOMPLETE_IDENTITY: 422,
};

const messages: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Request validation failed.',
  AUTH_REQUIRED: 'Authentication is required.',
  INVALID_CREDENTIALS: 'Не удалось выполнить вход.',
  FORBIDDEN: 'The requested action is not permitted.',
  PASSWORD_CHANGE_REQUIRED: 'Change your password before continuing.',
  CSRF_INVALID: 'The request could not be verified.',
  ORIGIN_FORBIDDEN: 'The request origin is not permitted.',
  NOT_FOUND: 'The requested resource was not found.',
  EMAIL_IN_USE: 'The email address is already in use.',
  LAST_ADMIN_REQUIRED: 'The change would remove the last usable administrator.',
  SELF_PRIVILEGE_CHANGE_FORBIDDEN: 'You cannot change your own access.',
  GRANT_CEILING_EXCEEDED: 'The requested access exceeds your permissions.',
  ROLE_IN_USE: 'The role is assigned to an employee.',
  VERSION_CONFLICT: 'The resource changed; reload it and try again.',
  INVALID_STATE_TRANSITION: 'The requested state transition is not permitted.',
  ALREADY_AUTHENTICATED: 'Log out before signing in again.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  UNSUPPORTED_MEDIA_TYPE: 'Only JSON requests are supported.',
  AUDIT_UNAVAILABLE: 'The operation could not be recorded.',
  DEPENDENCY_UNAVAILABLE: 'A required service is unavailable.',
  INTERNAL_ERROR: 'The request could not be completed.',
  CURRENT_PASSWORD_INVALID: 'The current password is incorrect.',
  IDENTITY_CONFLICT: 'The product identity is already in use.',
  SLUG_CONFLICT: 'The catalog slug is already in use.',
  CATEGORY_CYCLE: 'The category change would create a cycle.',
  CATEGORY_INACTIVE_PARENT: 'The selected parent category is unavailable.',
  ATTRIBUTE_NOT_APPLICABLE: 'The attribute is not valid for this category.',
  PUBLICATION_NOT_READY: 'The product revision is not ready for publication.',
  REFERENCE_IN_USE: 'The catalog reference is still in use.',
  FILE_NOT_ACCESSIBLE: 'The file metadata is not accessible.',
  ENCODING_REQUIRED: 'Select a supported CSV delimiter.',
  INVALID_ENCODING: 'The file encoding is not supported.',
  FILE_REJECTED: 'The file could not be parsed safely.',
  FILE_TOO_LARGE: 'The file exceeds the upload limit.',
  IMPORT_LIMIT_EXCEEDED: 'The file exceeds an import limit.',
  IDEMPOTENCY_KEY_REUSED: 'The idempotency key was used for another request.',
  IMPORT_ROW_CONFLICT: 'The import row changed; reload it and try again.',
  INGESTION_UNAVAILABLE: 'The bounded file parser is unavailable.',
  SUPPLIER_IDENTITY_CONFLICT:
    'An active supplier already uses this tax identity.',
  IDENTITY_CHANGED:
    'The supplier or catalog identity changed; refresh and review it again.',
  MATCH_ALREADY_PENDING:
    'A pending proposal already exists for this offer and product.',
  INCOMPLETE_IDENTITY:
    'The offer does not contain sufficient exact identity evidence.',
};

export class StaffError extends HttpException {
  readonly code: ErrorCode;
  readonly fields?: ErrorField[];
  readonly retryAfter?: number;

  constructor(code: ErrorCode, fields?: ErrorField[], retryAfter?: number) {
    super(messages[code], statusByCode[code]);
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

export function statusFor(code: ErrorCode): number {
  return statusByCode[code];
}

export function safeMessage(code: ErrorCode): string {
  return messages[code];
}
