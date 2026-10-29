import { describe, expect, it, vi } from 'vitest';
import type { CreateInquiryRequest } from './request-quote-dto';
import {
  PublicInquiryApiError,
  type PublicInquiryApi,
  type PublicInquiryReceipt,
  type UploadIntentReceipt,
} from './request-quote-api';
import { PublicInquirySubmission } from './request-quote-submission';

const receipt: PublicInquiryReceipt = {
  publicReference: 'RFQ-2026-000000000001',
  createdAt: '2026-10-28T02:00:00.000Z',
  message: 'Заявка принята.',
};
const request: CreateInquiryRequest = {
  kind: 'ENGINEERING',
  contact: { contactName: 'Тестовый контакт', email: 'test@example.invalid' },
  engineering: { technicalTask: 'Испытательная заявка' },
};
const capability = 'C'.repeat(43);

function nextSecret() {
  let counter = 0;
  return () => {
    counter += 1;
    return `${'A'.repeat(42)}${counter.toString(36)}`;
  };
}

function intent(intentId: string, maxBytes: number): UploadIntentReceipt {
  return {
    intentId,
    expiresAt: '2026-10-28T02:10:00.000Z',
    maxBytes,
  };
}

const firstIntentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const secondIntentId = '0f8fad5b-d9cb-469f-a165-70867728950e';

function apiMock(overrides: Partial<PublicInquiryApi> = {}): PublicInquiryApi {
  return {
    createInquiry: vi.fn(async () => receipt),
    createUploadIntent: vi.fn(async () => intent(firstIntentId, 3)),
    uploadFile: vi.fn(async () => ({
      accepted: true as const,
      sizeBytes: 3,
      securityState: 'QUARANTINED' as const,
    })),
    cancelUploadIntent: vi.fn(async () => undefined),
    ...overrides,
  };
}

function selectedFile(id = 1) {
  return {
    id,
    file: new File(['abc'], `fixture-${id}.pdf`, { type: 'application/pdf' }),
    declaredMimeType: 'application/pdf',
  };
}

describe('public inquiry submission and upload retry state', () => {
  it('keeps create outcome unknown if a replay is rejected', async () => {
    const createInquiry = vi
      .fn<PublicInquiryApi['createInquiry']>()
      .mockRejectedValueOnce(
        new PublicInquiryApiError('transport', null, null, [], null, true),
      )
      .mockRejectedValueOnce(
        new PublicInquiryApiError(
          'http',
          400,
          'VALIDATION_ERROR',
          [],
          null,
          false,
        ),
      );
    const submission = new PublicInquirySubmission({
      request,
      files: [],
      api: apiMock({ createInquiry }),
      createSecret: nextSecret(),
    });
    await submission.start();
    await submission.retryCreation();
    expect(submission.getSnapshot().phase).toBe('create-blocked');
    expect(submission.getSnapshot().message).toMatch(/не подтверждён/);
    await submission.retryCreation();
    expect(createInquiry).toHaveBeenCalledTimes(2);
  });

  it('does not start another file after disposal during upload', async () => {
    let resolveUpload!: (
      value: Awaited<ReturnType<PublicInquiryApi['uploadFile']>>,
    ) => void;
    const uploadFile = vi.fn<PublicInquiryApi['uploadFile']>(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const api = apiMock({ uploadFile });
    const onChange = vi.fn();
    const submission = new PublicInquirySubmission({
      request: { ...request, uploadCapability: capability },
      capability,
      files: [selectedFile(1), selectedFile(2)],
      api,
      createSecret: nextSecret(),
      onChange,
    });
    const pending = submission.start();
    await vi.waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    const callsBeforeDispose = onChange.mock.calls.length;
    submission.dispose();
    resolveUpload({
      accepted: true,
      sizeBytes: 3,
      securityState: 'QUARANTINED',
    });
    await pending;
    expect(api.createUploadIntent).toHaveBeenCalledTimes(1);
    expect(uploadFile.mock.calls[0]?.[4]?.aborted).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(callsBeforeDispose);
  });
  it('starts only one create during concurrent starts and stops after disposal', async () => {
    let resolveCreate!: (value: PublicInquiryReceipt) => void;
    const createInquiry = vi.fn<PublicInquiryApi['createInquiry']>(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const api = apiMock({ createInquiry });
    const onChange = vi.fn();
    const submission = new PublicInquirySubmission({
      request: { ...request, uploadCapability: capability },
      capability,
      files: [selectedFile()],
      api,
      createSecret: nextSecret(),
      onChange,
    });
    const attempts = Array.from({ length: 10 }, () => submission.start());
    expect(createInquiry).toHaveBeenCalledTimes(1);
    const signal = createInquiry.mock.calls[0]?.[2];
    const callsBeforeDispose = onChange.mock.calls.length;
    submission.dispose();
    expect(signal?.aborted).toBe(true);
    resolveCreate(receipt);
    await Promise.all(attempts);
    expect(api.createUploadIntent).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(callsBeforeDispose);
  });

  it('prevents concurrent retries of an unknown create', async () => {
    let resolveRetry!: (value: PublicInquiryReceipt) => void;
    const createInquiry = vi
      .fn<PublicInquiryApi['createInquiry']>()
      .mockRejectedValueOnce(
        new PublicInquiryApiError('transport', null, null, [], null, true),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRetry = resolve;
          }),
      );
    const api = apiMock({ createInquiry });
    const submission = new PublicInquirySubmission({
      request,
      files: [],
      api,
      createSecret: nextSecret(),
    });
    await submission.start();
    const retries = [submission.retryCreation(), submission.retryCreation()];
    expect(createInquiry).toHaveBeenCalledTimes(2);
    expect(createInquiry.mock.calls[0]).toEqual(createInquiry.mock.calls[1]);
    resolveRetry(receipt);
    await Promise.all(retries);
    expect(submission.getSnapshot().phase).toBe('complete');
  });
  it.each([401, 404])(
    'preserves an unknown upload result after replay returns %i',
    async (status) => {
      const file = selectedFile();
      const uploadFile = vi
        .fn<PublicInquiryApi['uploadFile']>()
        .mockRejectedValueOnce(
          new PublicInquiryApiError('transport', null, null, [], null, true),
        )
        .mockRejectedValueOnce(
          new PublicInquiryApiError('http', status, null, [], null, false),
        );
      const api = apiMock({ uploadFile });
      const submission = new PublicInquirySubmission({
        request: { ...request, uploadCapability: capability },
        capability,
        files: [file],
        api,
        createSecret: nextSecret(),
      });
      await submission.start();
      await submission.retryFile(file.id);
      expect(submission.getSnapshot().files[0]).toMatchObject({
        phase: 'unknown',
        retryable: false,
      });
      expect(submission.getSnapshot().files[0]?.message).toMatch(
        /мог быть принят/,
      );
      await submission.skipFailedFile(file.id);
      expect(submission.getSnapshot().files[0]?.phase).toBe('unknown');
      expect(api.createInquiry).toHaveBeenCalledTimes(1);
      expect(api.createUploadIntent).toHaveBeenCalledTimes(1);
      expect(uploadFile.mock.calls[0]).toEqual(uploadFile.mock.calls[1]);
    },
  );
  it('retries an unknown create with the same key and exact request body', async () => {
    const createInquiry = vi
      .fn<PublicInquiryApi['createInquiry']>()
      .mockRejectedValueOnce(
        new PublicInquiryApiError('transport', null, null, [], null, true),
      )
      .mockResolvedValueOnce(receipt);
    const api = apiMock({ createInquiry });
    const submission = new PublicInquirySubmission({
      request,
      files: [],
      api,
      createSecret: nextSecret(),
    });
    const expectedBody = JSON.stringify(request);

    await submission.start();
    expect(submission.getSnapshot().phase).toBe('create-unknown');
    expect(submission.getSnapshot().receipt).toBeUndefined();
    await submission.retryCreation();

    expect(createInquiry).toHaveBeenCalledTimes(2);
    expect(createInquiry.mock.calls[0]).toEqual(createInquiry.mock.calls[1]);
    expect(createInquiry.mock.calls[0]![1]).toBe(expectedBody);
    expect(submission.getSnapshot().phase).toBe('complete');
    expect(submission.getSnapshot().receipt).toEqual(receipt);
    expect(api.createUploadIntent).not.toHaveBeenCalled();
  });

  it('retries an uncertain file upload with the same intent, key and File without recreating the inquiry', async () => {
    const file = selectedFile();
    const uploadFile = vi
      .fn<PublicInquiryApi['uploadFile']>()
      .mockRejectedValueOnce(
        new PublicInquiryApiError('transport', null, null, [], null, true),
      )
      .mockResolvedValueOnce({
        accepted: true,
        sizeBytes: 3,
        securityState: 'QUARANTINED',
      });
    const api = apiMock({ uploadFile });
    const submission = new PublicInquirySubmission({
      request: { ...request, uploadCapability: capability },
      capability,
      files: [file],
      api,
      createSecret: nextSecret(),
    });

    await submission.start();
    expect(submission.getSnapshot().phase).toBe('partial');
    expect(submission.getSnapshot().receipt).toEqual(receipt);
    expect(submission.getSnapshot().files[0]?.retryable).toBe(true);
    await submission.retryFile(file.id);

    expect(api.createInquiry).toHaveBeenCalledTimes(1);
    expect(api.createUploadIntent).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile.mock.calls[0]).toEqual(uploadFile.mock.calls[1]);
    expect(uploadFile.mock.calls[0]?.[3]).toBe(file.file);
    expect(submission.getSnapshot().phase).toBe('complete');
    expect(submission.getSnapshot().files[0]?.phase).toBe('uploaded');
    expect(submission.getSnapshot().files[0]?.message).toMatch(/карантине/);
  });

  it('replays a rate-limited upload with the same intent and key, without resending the inquiry', async () => {
    const file = selectedFile();
    const createUploadIntent = vi
      .fn<PublicInquiryApi['createUploadIntent']>()
      .mockResolvedValueOnce(intent(firstIntentId, 3));
    const uploadFile = vi
      .fn<PublicInquiryApi['uploadFile']>()
      .mockRejectedValueOnce(
        new PublicInquiryApiError('http', 429, 'RATE_LIMITED', [], 1, false),
      )
      .mockResolvedValueOnce({
        accepted: true,
        sizeBytes: 3,
        securityState: 'QUARANTINED',
      });
    const api = apiMock({ createUploadIntent, uploadFile });
    const submission = new PublicInquirySubmission({
      request: { ...request, uploadCapability: capability },
      capability,
      files: [file],
      api,
      createSecret: nextSecret(),
    });

    await submission.start();
    expect(api.createInquiry).toHaveBeenCalledTimes(1);
    expect(submission.getSnapshot().files[0]?.retryable).toBe(true);
    await submission.retryFile(file.id);

    expect(createUploadIntent).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile.mock.calls[0]?.[0]).toBe(firstIntentId);
    expect(uploadFile.mock.calls[1]?.[0]).toBe(firstIntentId);
    expect(uploadFile.mock.calls[0]?.[1]).toBe(uploadFile.mock.calls[1]?.[1]);
    expect(uploadFile.mock.calls[0]?.[3]).toBe(uploadFile.mock.calls[1]?.[3]);
    expect(api.cancelUploadIntent).not.toHaveBeenCalled();
    expect(submission.getSnapshot().phase).toBe('complete');
  });

  it.each([
    [400, 'VALIDATION_ERROR'],
    [413, 'REQUEST_TOO_LARGE'],
    [415, 'FILE_TYPE_NOT_ALLOWED'],
  ] as const)(
    'does not retry HTTP %i for a rejected upload intent and lets the user continue without the file',
    async (status, code) => {
      const file = selectedFile();
      const createUploadIntent = vi
        .fn<PublicInquiryApi['createUploadIntent']>()
        .mockRejectedValueOnce(
          new PublicInquiryApiError('http', status, code, [], null, false),
        );
      const api = apiMock({ createUploadIntent });
      const submission = new PublicInquirySubmission({
        request: { ...request, uploadCapability: capability },
        capability,
        files: [file],
        api,
        createSecret: nextSecret(),
      });

      await submission.start();
      expect(submission.getSnapshot().phase).toBe('partial');
      expect(submission.getSnapshot().files[0]?.retryable).toBe(false);
      await submission.retryFile(file.id);
      expect(createUploadIntent).toHaveBeenCalledTimes(1);

      await submission.skipFailedFile(file.id);
      expect(api.createInquiry).toHaveBeenCalledTimes(1);
      expect(submission.getSnapshot().phase).toBe('complete');
      expect(submission.getSnapshot().files[0]?.phase).toBe('skipped');
    },
  );

  it.each([
    [400, 'VALIDATION_ERROR'],
    [413, 'REQUEST_TOO_LARGE'],
    [415, 'MIME_MISMATCH'],
  ] as const)(
    'does not spend a second intent after HTTP %i upload rejection and allows safe completion',
    async (status, code) => {
      const file = selectedFile();
      const uploadFile = vi
        .fn<PublicInquiryApi['uploadFile']>()
        .mockRejectedValueOnce(
          new PublicInquiryApiError('http', status, code, [], null, false),
        );
      const api = apiMock({ uploadFile });
      const submission = new PublicInquirySubmission({
        request: { ...request, uploadCapability: capability },
        capability,
        files: [file],
        api,
        createSecret: nextSecret(),
      });

      await submission.start();
      expect(submission.getSnapshot().phase).toBe('partial');
      expect(submission.getSnapshot().files[0]?.retryable).toBe(false);
      await submission.retryFile(file.id);
      expect(api.createUploadIntent).toHaveBeenCalledTimes(1);
      expect(uploadFile).toHaveBeenCalledTimes(1);

      await submission.skipFailedFile(file.id);
      expect(api.createInquiry).toHaveBeenCalledTimes(1);
      expect(api.createUploadIntent).toHaveBeenCalledTimes(1);
      expect(api.cancelUploadIntent).toHaveBeenCalledTimes(1);
      expect(submission.getSnapshot().phase).toBe('complete');
      expect(submission.getSnapshot().files[0]?.phase).toBe('skipped');
    },
  );

  it('keeps successful attachments and retries only failed files after partial success', async () => {
    const first = selectedFile(1);
    const second = selectedFile(2);
    const createUploadIntent = vi
      .fn<PublicInquiryApi['createUploadIntent']>()
      .mockResolvedValueOnce(intent(firstIntentId, 3))
      .mockResolvedValueOnce(intent(secondIntentId, 3));
    const uploadFile = vi
      .fn<PublicInquiryApi['uploadFile']>()
      .mockResolvedValueOnce({
        accepted: true,
        sizeBytes: 3,
        securityState: 'QUARANTINED',
      })
      .mockRejectedValueOnce(
        new PublicInquiryApiError(
          'http',
          503,
          'DEPENDENCY_UNAVAILABLE',
          [],
          null,
          true,
        ),
      )
      .mockResolvedValueOnce({
        accepted: true,
        sizeBytes: 3,
        securityState: 'QUARANTINED',
      });
    const api = apiMock({ createUploadIntent, uploadFile });
    const submission = new PublicInquirySubmission({
      request: { ...request, uploadCapability: capability },
      capability,
      files: [first, second],
      api,
      createSecret: nextSecret(),
    });

    await submission.start();
    expect(submission.getSnapshot().phase).toBe('partial');
    expect(submission.getSnapshot().files.map(({ phase }) => phase)).toEqual([
      'uploaded',
      'failed',
    ]);
    await submission.retryFile(second.id);

    expect(api.createInquiry).toHaveBeenCalledTimes(1);
    expect(createUploadIntent).toHaveBeenCalledTimes(2);
    expect(uploadFile).toHaveBeenCalledTimes(3);
    expect(submission.getSnapshot().phase).toBe('complete');
    expect(submission.getSnapshot().files.map(({ phase }) => phase)).toEqual([
      'uploaded',
      'uploaded',
    ]);
  });

  it('does not add privacy consent or create a capability when no files are selected', async () => {
    const createInquiry = vi.fn<PublicInquiryApi['createInquiry']>(
      async () => receipt,
    );
    const api = apiMock({ createInquiry });
    const submission = new PublicInquirySubmission({
      request,
      files: [],
      api,
      createSecret: nextSecret(),
    });
    await submission.start();

    expect(api.createInquiry).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(createInquiry.mock.calls[0]![1]) as Record<
      string,
      unknown
    >;
    expect(sent).not.toHaveProperty('uploadCapability');
    expect(sent).not.toHaveProperty('privacyNotice');
    expect(api.createUploadIntent).not.toHaveBeenCalled();
  });
});
