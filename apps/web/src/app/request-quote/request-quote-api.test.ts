import { describe, expect, it, vi } from 'vitest';
import {
  createPublicInquiryApi,
  generateRfqSecret,
  hasValidUploadFilenameLength,
  PublicInquiryApiError,
} from './request-quote-api';

const requestId = 'b37b4b47-bc89-4acc-a030-82d38d32bfbb';
const key = 'K'.repeat(43);
const capability = 'C'.repeat(43);
const publicData = {
  publicReference: 'RFQ-2026-000000000001',
  createdAt: '2026-10-28T02:00:00.000Z',
  message: 'Заявка принята.',
};

function success(data: unknown, status = 201) {
  return Response.json({ data, meta: { requestId } }, { status });
}

function fetchMock(implementation: typeof fetch) {
  return vi.fn(implementation) as unknown as typeof fetch;
}

describe('public inquiry API client', () => {
  it('matches the server filename limit in UTF-16 code units', () => {
    expect(hasValidUploadFilenameLength('😀'.repeat(127) + 'a')).toBe(true);
    expect(hasValidUploadFilenameLength('😀'.repeat(128))).toBe(false);
  });

  it('generates 256-bit base64url secrets with the contract length', () => {
    const value = generateRfqSecret();
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('accepts only a confirmed 201 receipt and retains public fields only', async () => {
    const fetcher = fetchMock(async () => success(publicData));
    const api = createPublicInquiryApi({
      baseUrl: 'http://127.0.0.1:3001',
      fetcher,
    });
    const receipt = await api.createInquiry(key, '{"kind":"ENGINEERING"}');

    expect(receipt).toEqual(publicData);
    expect(receipt).not.toHaveProperty('inquiryId');
  });

  it('sends the stable JSON command without cookies or capability headers', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = fetchMock(async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return success(publicData);
    });
    const body = JSON.stringify({
      kind: 'ENGINEERING',
      contact: { contactName: 'Test Contact', email: 'test@example.invalid' },
    });
    const api = createPublicInquiryApi({
      baseUrl: 'http://127.0.0.1:3001',
      fetcher,
    });

    await api.createInquiry(key, body);
    const call = calls[0]!;
    const headers = new Headers(call.init.headers);
    expect(call.url).toBe('http://127.0.0.1:3001/v1/public/inquiries');
    expect(call.init.method).toBe('POST');
    expect(call.init.body).toBe(body);
    expect(headers.get('Idempotency-Key')).toBe(key);
    expect(headers.has('X-Inquiry-Upload-Capability')).toBe(false);
    expect(call.init.credentials).toBe('omit');
    expect(call.init.cache).toBe('no-store');
    expect(call.init.redirect).toBe('error');
    expect(call.init.referrerPolicy).toBe('no-referrer');
  });

  it('uses the capability header and streams the selected File to frozen endpoints', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = fetchMock(async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      if (calls.length === 1)
        return success({
          intentId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          expiresAt: '2026-10-28T02:10:00.000Z',
          maxBytes: 3,
        });
      return success({
        accepted: true,
        sizeBytes: 3,
        securityState: 'QUARANTINED',
      });
    });
    const api = createPublicInquiryApi({
      baseUrl: 'http://127.0.0.1:3001',
      fetcher,
    });
    const intentKey = 'I'.repeat(43);
    const uploadKey = 'U'.repeat(43);
    const intentBody = JSON.stringify({
      filename: 'fixture.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: 3,
    });
    const file = new File(['abc'], 'fixture.pdf', { type: 'application/pdf' });

    await api.createUploadIntent(intentKey, capability, intentBody);
    const uploaded = await api.uploadFile(
      'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      uploadKey,
      capability,
      file,
    );

    expect(uploaded.securityState).toBe('QUARANTINED');
    expect(
      calls[0]!.url.endsWith('/v1/public/inquiry-attachments/upload-intents'),
    ).toBe(true);
    expect(calls[0]!.init.body).toBe(intentBody);
    const intentHeaders = new Headers(calls[0]!.init.headers);
    expect(intentHeaders.get('X-Inquiry-Upload-Capability')).toBe(capability);
    expect(intentHeaders.get('Idempotency-Key')).toBe(intentKey);
    expect(
      calls[1]!.url.endsWith(
        '/v1/public/inquiry-attachments/upload-intents/f47ac10b-58cc-4372-a567-0e02b2c3d479/content',
      ),
    ).toBe(true);
    expect(calls[1]!.init.body).toBe(file);
    expect(calls.some(({ url }) => url.includes(capability))).toBe(false);
    expect(
      new Headers(calls[1]!.init.headers).get('X-Inquiry-Upload-Capability'),
    ).toBe(capability);
    expect(new Headers(calls[1]!.init.headers).get('Content-Type')).toBe(
      'application/octet-stream',
    );
  });

  it('rejects unexpected statuses and receipts without exposing server text', async () => {
    const unexpectedStatus = createPublicInquiryApi({
      fetcher: fetchMock(async () => success(publicData, 200)),
    });
    await expect(
      unexpectedStatus.createInquiry(key, '{}'),
    ).rejects.toMatchObject({
      kind: 'protocol',
      status: 200,
      outcomeUnknown: true,
    });

    const malformed = createPublicInquiryApi({
      fetcher: fetchMock(async () =>
        success({ ...publicData, inquiryId: 'internal-id' }),
      ),
    });
    await expect(malformed.createInquiry(key, '{}')).rejects.toMatchObject({
      kind: 'protocol',
      status: 201,
      outcomeUnknown: true,
    });

    const internalText = 'SQL stack at private-internal-host';
    const serverFailure = createPublicInquiryApi({
      fetcher: fetchMock(async () =>
        Response.json(
          { code: 'DEPENDENCY_UNAVAILABLE', message: internalText, requestId },
          { status: 503 },
        ),
      ),
    });
    try {
      await serverFailure.createInquiry(key, '{}');
      throw new Error('Expected server failure.');
    } catch (error) {
      expect(error).toBeInstanceOf(PublicInquiryApiError);
      expect((error as Error).message).not.toContain(internalText);
      expect((error as Error).message).not.toContain('private-internal-host');
      expect((error as PublicInquiryApiError).outcomeUnknown).toBe(true);
    }
  });

  it('maps field errors and Retry-After without retaining response messages', async () => {
    const badRequest = createPublicInquiryApi({
      fetcher: fetchMock(async () =>
        Response.json(
          {
            code: 'VALIDATION_ERROR',
            message: 'PII or internal text must not be surfaced',
            requestId,
            fields: [{ field: 'contact.email', code: 'INVALID_FORMAT' }],
          },
          { status: 400 },
        ),
      ),
    });
    await expect(badRequest.createInquiry(key, '{}')).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: [{ field: 'contact.email', code: 'INVALID_FORMAT' }],
      outcomeUnknown: false,
    });

    const throttled = createPublicInquiryApi({
      fetcher: fetchMock(
        async () =>
          new Response(null, { status: 429, headers: { 'Retry-After': '18' } }),
      ),
    });
    await expect(throttled.createInquiry(key, '{}')).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 18,
      outcomeUnknown: false,
    });
  });

  it.each([
    [409, 'IDEMPOTENCY_KEY_REUSED', false],
    [413, 'PAYLOAD_TOO_LARGE', false],
    [415, 'UNSUPPORTED_MEDIA_TYPE', false],
    [503, 'DEPENDENCY_UNAVAILABLE', true],
  ])(
    'classifies HTTP %i using the contract code and safe retry certainty',
    async (status, code, outcomeUnknown) => {
      const api = createPublicInquiryApi({
        fetcher: fetchMock(async () =>
          Response.json(
            { code, message: 'never display this backend text', requestId },
            { status },
          ),
        ),
      });
      try {
        await api.createInquiry(key, '{}');
        throw new Error('Expected HTTP failure.');
      } catch (error) {
        expect(error).toBeInstanceOf(PublicInquiryApiError);
        expect(error).toMatchObject({ status, code, outcomeUnknown });
        expect((error as Error).message).not.toContain('backend text');
      }
    },
  );

  it('rejects protocol-relative and query-bearing API base paths', async () => {
    for (const baseUrl of ['//external.example/api', '/api?token=private']) {
      const fetcher = fetchMock(async () => success(publicData));
      const api = createPublicInquiryApi({ baseUrl, fetcher });
      await expect(api.createInquiry(key, '{}')).rejects.toMatchObject({
        kind: 'configuration',
        status: null,
      });
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it('fails closed when a receipt does not report QUARANTINED', async () => {
    const api = createPublicInquiryApi({
      fetcher: fetchMock(async () =>
        success({ accepted: true, sizeBytes: 3, securityState: 'CLEAN' }),
      ),
    });
    await expect(
      api.uploadFile(
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        key,
        capability,
        new File(['abc'], 'fixture.pdf'),
      ),
    ).rejects.toMatchObject({
      kind: 'protocol',
      status: 201,
      outcomeUnknown: true,
    });
  });

  it('cancels only an upload intent with the capability header and accepts 204', async () => {
    let call: { url: string; init: RequestInit } | undefined;
    const fetcher = fetchMock(async (input, init) => {
      call = { url: String(input), init: init ?? {} };
      return new Response(null, { status: 204 });
    });
    const api = createPublicInquiryApi({
      baseUrl: 'http://127.0.0.1:3001',
      fetcher,
    });

    await expect(
      api.cancelUploadIntent(
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        key,
        capability,
      ),
    ).resolves.toBeUndefined();
    expect(call?.url).toBe(
      'http://127.0.0.1:3001/v1/public/inquiry-attachments/upload-intents/f47ac10b-58cc-4372-a567-0e02b2c3d479',
    );
    expect(call?.init.method).toBe('DELETE');
    expect(call?.init.body).toBeUndefined();
    const headers = new Headers(call?.init.headers);
    expect(headers.get('Idempotency-Key')).toBe(key);
    expect(headers.get('X-Inquiry-Upload-Capability')).toBe(capability);
  });
});
