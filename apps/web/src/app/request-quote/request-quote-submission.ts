import type { CreateInquiryRequest } from './request-quote-dto';
import {
  createPublicInquiryApi,
  generateRfqSecret,
  PublicInquiryApiError,
  type PublicInquiryApi,
  type PublicInquiryReceipt,
  type UploadIntentReceipt,
} from './request-quote-api';

export type SelectedUpload = {
  id: number;
  file: File;
  declaredMimeType: string;
};

export type SubmissionPhase =
  | 'idle'
  | 'creating'
  | 'create-unknown'
  | 'create-rejected'
  | 'create-blocked'
  | 'uploading'
  | 'partial'
  | 'complete';

export type FileUploadPhase =
  | 'queued'
  | 'creating-intent'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'skipped';

export type FileUploadView = {
  id: number;
  name: string;
  size: number;
  phase: FileUploadPhase;
  message?: string;
  retryable: boolean;
  retryAfterSeconds?: number;
};

export type SubmissionView = {
  phase: SubmissionPhase;
  receipt?: PublicInquiryReceipt;
  message?: string;
  retryCreate: boolean;
  retryAfterSeconds?: number;
  fieldErrors: Array<{ field: string; code: string }>;
  files: FileUploadView[];
};

type FileAttempt = {
  selected: Omit<SelectedUpload, 'file'>;
  file?: File;
  name: string;
  size: number;
  phase: 'intent' | 'upload' | 'done' | 'skipped';
  intentBody: string;
  intentKey: string;
  intent?: UploadIntentReceipt;
  uploadKey?: string;
  retryMode: 'same-intent' | 'same-upload' | 'none';
  message?: string;
  retryAfterSeconds?: number;
};

type SubmissionOptions = {
  request: CreateInquiryRequest;
  capability?: string;
  files: SelectedUpload[];
  api?: PublicInquiryApi;
  createSecret?: () => string;
  onChange?: (view: SubmissionView) => void;
};

function errorMessage(
  error: unknown,
  operation: 'create' | 'upload' | 'cancel',
): { message: string; retry: boolean; retryAfterSeconds?: number } {
  if (!(error instanceof PublicInquiryApiError)) {
    return {
      message:
        operation === 'create'
          ? 'Не удалось подготовить отправку. Данные не отправлены.'
          : 'Не удалось подготовить загрузку файла.',
      retry: false,
    };
  }

  if (error.kind === 'configuration') {
    return {
      message: 'Отправка недоступна в этой среде. Данные не отправлены.',
      retry: false,
    };
  }
  if (error.kind === 'transport' || error.outcomeUnknown) {
    return {
      message:
        operation === 'create'
          ? 'Соединение прервалось до подтверждения. Неизвестно, создана ли заявка. Повторите отправку тех же данных: она использует тот же ключ операции. Не отправляйте новую заявку.'
          : 'Не удалось подтвердить результат загрузки. Повтор той же операции использует прежние данные и ключ; заявка повторно не создаётся.',
      retry: true,
    };
  }

  if (error.status === 400)
    return {
      message:
        operation === 'create'
          ? 'Сервер отклонил данные формы. Проверьте отмеченные поля.'
          : 'Сервер не принял файл. Заявка создана, файл не приложен.',
      retry: false,
    };
  if (error.status === 409) {
    return {
      message:
        operation === 'create'
          ? 'Возник конфликт ключа операции. Создание заявки не подтверждено; не отправляйте новую заявку с другими данными.'
          : 'Сервер не подтвердил загрузку. Заявка создана, файл не приложен.',
      retry: false,
    };
  }
  if (error.status === 413)
    return {
      message:
        operation === 'create'
          ? 'Размер запроса превышает допустимый предел сервера.'
          : 'Файл превышает серверный предел. Заявка создана, файл не приложен.',
      retry: false,
    };
  if (error.status === 415)
    return {
      message:
        operation === 'create'
          ? 'Сервер не принимает указанный формат запроса.'
          : 'Сервер отклонил формат файла. Заявка создана, файл не приложен.',
      retry: false,
    };
  if (error.status === 429) {
    const wait = error.retryAfterSeconds;
    return {
      message: wait
        ? `Слишком много запросов. Подождите ${wait} сек. и повторите вручную.`
        : 'Слишком много запросов. Повторите ту же операцию вручную.',
      retry: operation !== 'cancel',
      retryAfterSeconds: wait ?? undefined,
    };
  }
  if (error.status === 503)
    return {
      message:
        operation === 'create'
          ? 'Сервис временно недоступен. Результат создания заявки не подтверждён.'
          : 'Сервис вложений временно недоступен. Созданная заявка сохранена.',
      retry: operation !== 'cancel',
      retryAfterSeconds: error.retryAfterSeconds ?? undefined,
    };
  if (error.status === 401 || error.status === 404)
    return {
      message:
        operation === 'create'
          ? 'Сервис не принял запрос. Создание заявки не подтверждено.'
          : 'Срок загрузки истёк или файл больше недоступен. Заявка создана.',
      retry: false,
    };
  return {
    message:
      operation === 'create'
        ? 'Сервер отклонил запрос. Создание заявки не подтверждено.'
        : 'Сервер не принял файл. Заявка создана, файл не приложен.',
    retry: false,
  };
}

export class PublicInquirySubmission {
  private readonly api: PublicInquiryApi;
  private readonly createSecret: () => string;
  private readonly notify?: (view: SubmissionView) => void;
  private requestBody: string;
  private readonly files: FileAttempt[];
  private readonly initialFileViews: FileUploadView[];
  private createKey: string;
  private capability?: string;
  private phase: SubmissionPhase = 'idle';
  private receipt?: PublicInquiryReceipt;
  private message?: string;
  private retryCreate = false;
  private retryAfterSeconds?: number;
  private fieldErrors: Array<{ field: string; code: string }> = [];

  constructor(options: SubmissionOptions) {
    this.api = options.api ?? createPublicInquiryApi();
    this.createSecret = options.createSecret ?? generateRfqSecret;
    this.notify = options.onChange;
    this.capability = options.capability;
    this.requestBody = JSON.stringify(options.request);
    this.createKey = this.createSecret();
    this.files = options.files.map((selected) => ({
      selected: {
        id: selected.id,
        declaredMimeType: selected.declaredMimeType,
      },
      file: selected.file,
      name: selected.file.name,
      size: selected.file.size,
      phase: 'intent',
      intentBody: JSON.stringify({
        filename: selected.file.name,
        declaredMimeType: selected.declaredMimeType,
        sizeBytes: selected.file.size,
      }),
      intentKey: this.createSecret(),
      retryMode: 'none',
    }));
    this.initialFileViews = this.files.map((file) => ({
      id: file.selected.id,
      name: file.name,
      size: file.size,
      phase: 'queued',
      retryable: false,
    }));
  }

  getSnapshot(): SubmissionView {
    const fileViews = this.files.map((attempt) => ({
      id: attempt.selected.id,
      name: attempt.name,
      size: attempt.size,
      phase: this.fileViewPhase(attempt),
      message: attempt.message,
      retryable: attempt.retryMode !== 'none',
      retryAfterSeconds: attempt.retryAfterSeconds,
    }));
    return {
      phase: this.phase,
      receipt: this.receipt,
      message: this.message,
      retryCreate: this.retryCreate,
      retryAfterSeconds: this.retryAfterSeconds,
      fieldErrors: [...this.fieldErrors],
      files: fileViews.length ? fileViews : this.initialFileViews,
    };
  }

  async start() {
    if (this.phase !== 'idle') return;
    await this.createInquiry();
  }

  async retryCreation() {
    if (this.phase !== 'create-unknown' && !this.retryCreate) return;
    await this.createInquiry();
  }

  async retryFile(fileId: number) {
    if (this.phase !== 'partial') return;
    const attempt = this.files.find((file) => file.selected.id === fileId);
    if (!attempt || attempt.retryMode === 'none') return;
    this.phase = 'uploading';
    this.message = undefined;
    this.publish();
    if (attempt.retryMode === 'same-intent') {
      await this.createIntentAndUpload(attempt);
    } else {
      await this.uploadExistingIntent(attempt);
    }
    this.finishUploads();
  }

  async skipFailedFile(fileId: number) {
    if (this.phase !== 'partial') return;
    const attempt = this.files.find((file) => file.selected.id === fileId);
    if (!attempt || attempt.phase === 'done' || attempt.retryMode !== 'none')
      return;

    this.phase = 'uploading';
    this.message = undefined;
    this.publish();
    if (attempt.intent)
      await this.cancelIntentBestEffort(attempt.intent.intentId);
    attempt.phase = 'skipped';
    attempt.message = 'Файл не приложен. Заявка сохранена.';
    attempt.file = undefined;
    this.finishUploads();
  }

  private async createInquiry() {
    this.phase = 'creating';
    this.message = undefined;
    this.retryCreate = false;
    this.retryAfterSeconds = undefined;
    this.fieldErrors = [];
    this.publish();
    try {
      this.receipt = await this.api.createInquiry(
        this.createKey,
        this.requestBody,
      );
    } catch (error) {
      const result = errorMessage(error, 'create');
      this.message = result.message;
      this.retryAfterSeconds = result.retryAfterSeconds;
      this.fieldErrors =
        error instanceof PublicInquiryApiError ? [...error.fields] : [];
      this.retryCreate = result.retry;
      this.phase =
        error instanceof PublicInquiryApiError &&
        error.status === 409 &&
        error.code === 'IDEMPOTENCY_KEY_REUSED'
          ? 'create-blocked'
          : error instanceof PublicInquiryApiError && error.outcomeUnknown
            ? 'create-unknown'
            : result.retry
              ? 'create-rejected'
              : 'create-rejected';
      if (!this.retryCreate) {
        this.requestBody = '';
        this.createKey = '';
      }
      this.publish();
      return;
    }

    this.requestBody = '';
    this.createKey = '';
    this.phase = this.files.length ? 'uploading' : 'complete';
    this.fieldErrors = [];
    this.publish();
    if (this.files.length) {
      for (const attempt of this.files) {
        await this.createIntentAndUpload(attempt);
      }
      this.finishUploads();
    } else {
      this.clearCreateSecrets();
      this.publish();
    }
  }

  private async createIntentAndUpload(attempt: FileAttempt) {
    attempt.phase = 'intent';
    attempt.message = undefined;
    attempt.retryAfterSeconds = undefined;
    this.publish();
    try {
      attempt.intent = await this.api.createUploadIntent(
        attempt.intentKey,
        this.requireCapability(),
        attempt.intentBody,
      );
    } catch (error) {
      const result = errorMessage(error, 'upload');
      attempt.message = result.message;
      attempt.retryAfterSeconds = result.retryAfterSeconds;
      attempt.retryMode = result.retry ? 'same-intent' : 'none';
      this.publish();
      return;
    }

    if (attempt.intent.maxBytes !== attempt.size) {
      attempt.message =
        attempt.intent.maxBytes < attempt.size
          ? 'Серверный лимит вложений ниже размера файла. Заявка создана, файл не отправлен.'
          : 'Сервис вернул некорректный лимит для файла. Заявка создана, файл не отправлен.';
      attempt.retryMode = 'none';
      this.publish();
      return;
    }

    attempt.phase = 'upload';
    try {
      attempt.uploadKey = this.createSecret();
    } catch {
      attempt.message = 'Не удалось безопасно подготовить загрузку файла.';
      attempt.retryMode = 'none';
      this.publish();
      return;
    }
    await this.uploadExistingIntent(attempt);
  }

  private async uploadExistingIntent(attempt: FileAttempt) {
    if (!attempt.intent || !attempt.uploadKey) return;
    attempt.phase = 'upload';
    attempt.message = undefined;
    attempt.retryAfterSeconds = undefined;
    this.publish();
    try {
      const receipt = await this.api.uploadFile(
        attempt.intent.intentId,
        attempt.uploadKey,
        this.requireCapability(),
        this.requireFile(attempt),
      );
      if (receipt.sizeBytes !== attempt.size) {
        throw new PublicInquiryApiError('protocol', 201, null, [], null, true);
      }
      attempt.phase = 'done';
      attempt.message =
        'Файл принят сервером и находится в карантине до проверки безопасности.';
      attempt.retryMode = 'none';
      attempt.uploadKey = undefined;
      attempt.file = undefined;
      this.publish();
    } catch (error) {
      const result = errorMessage(error, 'upload');
      attempt.message = result.message;
      attempt.retryAfterSeconds = result.retryAfterSeconds;
      if (error instanceof PublicInquiryApiError && error.outcomeUnknown) {
        // Replay the exact intent, key and File bytes after an unknown result.
        attempt.retryMode = 'same-upload';
      } else {
        // Confirmed rate limits can safely replay the exact idempotent upload.
        // Deterministic rejection must not reserve another upload intent.
        attempt.retryMode = result.retry ? 'same-upload' : 'none';
      }
      this.publish();
    }
  }

  private async cancelIntentBestEffort(intentId: string) {
    try {
      await this.api.cancelUploadIntent(
        intentId,
        this.createSecret(),
        this.requireCapability(),
      );
    } catch {
      // An unused intent expires on the server; never log its capability or ID.
    }
  }

  private finishUploads() {
    const failed = this.files.some(
      (file) => file.phase !== 'done' && file.phase !== 'skipped',
    );
    this.phase = failed ? 'partial' : 'complete';
    if (!failed) this.clearCreateSecrets();
    this.publish();
  }

  private fileViewPhase(attempt: FileAttempt): FileUploadPhase {
    if (attempt.phase === 'done') return 'uploaded';
    if (attempt.phase === 'skipped') return 'skipped';
    if (attempt.message) return 'failed';
    if (attempt.phase === 'upload') return 'uploading';
    if (this.phase === 'uploading' && attempt.phase === 'intent')
      return 'creating-intent';
    return 'queued';
  }

  private requireCapability() {
    if (!this.capability)
      throw new PublicInquiryApiError(
        'configuration',
        null,
        null,
        [],
        null,
        false,
      );
    return this.capability;
  }

  private clearCreateSecrets() {
    this.capability = undefined;
    this.requestBody = '';
    this.createKey = '';
  }

  private requireFile(attempt: FileAttempt) {
    if (!attempt.file) throw new Error('Upload bytes are no longer available.');
    return attempt.file;
  }

  private publish() {
    this.notify?.(this.getSnapshot());
  }
}
