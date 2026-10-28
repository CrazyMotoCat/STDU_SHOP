import type { components } from './inquiry-schema';
import type { CreateInquiryRequest } from './request-quote-dto';

export type PublicInquiryReceipt =
  components['schemas']['PublicInquiryReceipt']['data'];
export type CreateUploadIntentRequest =
  components['schemas']['CreateUploadIntentRequest'];
export type UploadIntentReceipt =
  components['schemas']['UploadIntentReceipt']['data'];
export type DocumentUploadReceipt =
  components['schemas']['DocumentUploadReceipt']['data'];

export type ApiFieldError = { field: string; code: string };
export type ApiErrorKind = 'transport' | 'http' | 'protocol' | 'configuration';

export class PublicInquiryApiError extends Error {
  readonly name = 'PublicInquiryApiError';

  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number | null,
    readonly code: string | null,
    readonly fields: ApiFieldError[],
    readonly retryAfterSeconds: number | null,
    readonly outcomeUnknown: boolean,
  ) {
    // Never include response text, URL, request payload, or the capability.
    super('Public inquiry API request failed.');
  }
}

export interface PublicInquiryApi {
  createInquiry(
    idempotencyKey: string,
    body: string,
  ): Promise<PublicInquiryReceipt>;
  createUploadIntent(
    idempotencyKey: string,
    capability: string,
    body: string,
  ): Promise<UploadIntentReceipt>;
  uploadFile(
    intentId: string,
    idempotencyKey: string,
    capability: string,
    file: File,
  ): Promise<DocumentUploadReceipt>;
  cancelUploadIntent(
    intentId: string,
    idempotencyKey: string,
    capability: string,
  ): Promise<void>;
}

type ApiClientOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type ApiErrorEnvelope = {
  code?: unknown;
  fields?: unknown;
};

const defaultApiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{43}$/;
const capabilityPattern = /^[A-Za-z0-9_-]{43}$/;
export const MAX_UPLOAD_FILENAME_CODE_UNITS = 255;

export function hasValidUploadFilenameLength(filename: string) {
  // String.length matches the API's UTF-16 code-unit filename limit.
  return filename.length <= MAX_UPLOAD_FILENAME_CODE_UNITS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value)
    ? value
    : null;
}

function safeFields(value: unknown): ApiFieldError[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap((item) => {
    if (!isRecord(item)) return [];
    if (
      typeof item.field !== 'string' ||
      item.field.length > 128 ||
      typeof item.code !== 'string'
    )
      return [];
    return [{ field: item.field, code: safeCode(item.code) ?? 'INVALID' }];
  });
}

function getRetryAfter(response: Response): number | null {
  const value = response.headers.get('Retry-After');
  if (!value || !/^\d{1,6}$/.test(value)) return null;
  return Math.min(Number(value), 24 * 60 * 60);
}

function apiError(
  kind: ApiErrorKind,
  status: number | null = null,
  code: string | null = null,
  fields: ApiFieldError[] = [],
  retryAfterSeconds: number | null = null,
  outcomeUnknown = false,
) {
  return new PublicInquiryApiError(
    kind,
    status,
    code,
    fields,
    retryAfterSeconds,
    outcomeUnknown,
  );
}

function endpoint(baseUrl: string, path: string): string {
  if (baseUrl.startsWith('/')) {
    let relative: URL;
    try {
      relative = new URL(baseUrl, 'https://same-origin.invalid');
    } catch {
      throw apiError('configuration');
    }
    if (
      relative.origin !== 'https://same-origin.invalid' ||
      relative.search ||
      relative.hash
    )
      throw apiError('configuration');
    return `${relative.pathname.replace(/\/$/, '')}${path}`;
  }

  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw apiError('configuration');
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw apiError('configuration');
  return new URL(path, base).toString();
}

function assertIdempotencyKey(value: string) {
  if (!idempotencyKeyPattern.test(value)) throw apiError('configuration');
}

function assertCapability(value: string) {
  if (!capabilityPattern.test(value)) throw apiError('configuration');
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function readReceiptData<T>(value: unknown, fields: string[]): T | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['data', 'meta']) ||
    !isRecord(value.meta) ||
    !exactKeys(value.meta, ['requestId']) ||
    !isUuid(value.meta.requestId) ||
    !isRecord(value.data)
  )
    return null;
  if (!exactKeys(value.data, fields)) return null;
  return value.data as T;
}

function parseInquiryReceipt(value: unknown): PublicInquiryReceipt | null {
  const data = readReceiptData<PublicInquiryReceipt>(value, [
    'publicReference',
    'createdAt',
    'message',
  ]);
  if (!data) return null;
  if (
    typeof data.publicReference !== 'string' ||
    data.publicReference.length < 20 ||
    data.publicReference.length > 32 ||
    typeof data.createdAt !== 'string' ||
    Number.isNaN(Date.parse(data.createdAt)) ||
    typeof data.message !== 'string' ||
    data.message.length > 240
  )
    return null;
  // Whitelist the public receipt. Never retain server-supplied internal fields.
  return {
    publicReference: data.publicReference,
    createdAt: data.createdAt,
    message: data.message,
  };
}

function parseIntentReceipt(value: unknown): UploadIntentReceipt | null {
  const data = readReceiptData<UploadIntentReceipt>(value, [
    'intentId',
    'expiresAt',
    'maxBytes',
  ]);
  if (!data) return null;
  if (
    !isUuid(data.intentId) ||
    typeof data.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(data.expiresAt)) ||
    !Number.isSafeInteger(data.maxBytes) ||
    data.maxBytes < 1 ||
    data.maxBytes > 52_428_800
  )
    return null;
  return {
    intentId: data.intentId,
    expiresAt: data.expiresAt,
    maxBytes: data.maxBytes,
  };
}

function parseDocumentReceipt(value: unknown): DocumentUploadReceipt | null {
  const data = readReceiptData<DocumentUploadReceipt>(value, [
    'accepted',
    'sizeBytes',
    'securityState',
  ]);
  if (!data) return null;
  if (
    data.accepted !== true ||
    !Number.isSafeInteger(data.sizeBytes) ||
    data.sizeBytes < 1 ||
    data.securityState !== 'QUARANTINED'
  )
    return null;
  return {
    accepted: true,
    sizeBytes: data.sizeBytes,
    securityState: 'QUARANTINED',
  };
}

async function errorFromResponse(response: Response) {
  let body: ApiErrorEnvelope = {};
  try {
    const value: unknown = await response.json();
    if (isRecord(value)) body = value;
  } catch {
    // Status remains authoritative; response text is intentionally discarded.
  }
  return apiError(
    'http',
    response.status,
    safeCode(body.code),
    safeFields(body.fields),
    getRetryAfter(response),
    response.status >= 500,
  );
}

export function generateRfqSecret(): string {
  if (!globalThis.crypto?.getRandomValues || typeof btoa !== 'function')
    throw apiError('configuration');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function createPublicInquiryApi(
  options: ApiClientOptions = {},
): PublicInquiryApi {
  const baseUrl = options.baseUrl ?? defaultApiBase;
  const fetcher = options.fetcher ?? globalThis.fetch;

  async function request(
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    idempotencyKey: string,
    body?: string | File,
    capability?: string,
    contentType?: string,
    expectedStatus = 201,
  ): Promise<unknown> {
    assertIdempotencyKey(idempotencyKey);
    if (capability !== undefined) assertCapability(capability);

    const headers = new Headers({
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
    });
    if (contentType) headers.set('Content-Type', contentType);
    if (capability !== undefined)
      headers.set('X-Inquiry-Upload-Capability', capability);

    const url = endpoint(baseUrl, path);
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: body as BodyInit }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal:
          typeof AbortSignal !== 'undefined' &&
          typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(60_000)
            : undefined,
      });
    } catch {
      throw apiError('transport', null, null, [], null, true);
    }

    if (response.status !== expectedStatus) {
      if (!response.ok) throw await errorFromResponse(response);
      throw apiError('protocol', response.status, null, [], null, true);
    }
    if (expectedStatus === 204) return undefined;
    try {
      return await response.json();
    } catch {
      throw apiError('protocol', response.status, null, [], null, true);
    }
  }

  return {
    async createInquiry(idempotencyKey, body) {
      const response = await request(
        '/v1/public/inquiries',
        'POST',
        idempotencyKey,
        body,
        undefined,
        'application/json',
      );
      const receipt = parseInquiryReceipt(response);
      if (!receipt) throw apiError('protocol', 201, null, [], null, true);
      return receipt;
    },
    async createUploadIntent(idempotencyKey, capability, body) {
      const response = await request(
        '/v1/public/inquiry-attachments/upload-intents',
        'POST',
        idempotencyKey,
        body,
        capability,
        'application/json',
      );
      const receipt = parseIntentReceipt(response);
      if (!receipt) throw apiError('protocol', 201, null, [], null, true);
      return receipt;
    },
    async uploadFile(intentId, idempotencyKey, capability, file) {
      const response = await request(
        `/v1/public/inquiry-attachments/upload-intents/${encodeURIComponent(intentId)}/content`,
        'PUT',
        idempotencyKey,
        file,
        capability,
        'application/octet-stream',
      );
      const receipt = parseDocumentReceipt(response);
      if (!receipt) throw apiError('protocol', 201, null, [], null, true);
      return receipt;
    },
    async cancelUploadIntent(intentId, idempotencyKey, capability) {
      await request(
        `/v1/public/inquiry-attachments/upload-intents/${encodeURIComponent(intentId)}`,
        'DELETE',
        idempotencyKey,
        undefined,
        capability,
        undefined,
        204,
      );
    },
  };
}

export function addUploadCapability(
  request: CreateInquiryRequest,
  capability: string | undefined,
): CreateInquiryRequest {
  if (!capability) return request;
  return { ...request, uploadCapability: capability };
}
