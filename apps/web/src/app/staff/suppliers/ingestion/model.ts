export type Value = Record<string, unknown>;
export type Session = {
  permissions: string[];
  passwordChangeRequired: boolean;
};
export type Source = {
  id: string;
  supplierId: string;
  version: number;
  state: string;
  fixtureKey: string;
};
export type Run = {
  id: string;
  sourceId: string;
  state: string;
  processed: number;
  candidateCount: number;
  errorCount: number;
};
export type Row = {
  id: string;
  runId: string;
  rowNumber: number;
  version: number;
  reviewState: string;
  normalized: Value | null;
  warnings: string[];
  errorCode: string | null;
};
export type Decision = {
  id: string;
  decision: string;
  reason: string;
  actorId: string;
  createdAt: string;
};
export type Application = Value & {
  id: string;
  offerId: string;
  revisionId: string;
  createdAt: string;
};
export type Offer = {
  id: string;
  version: number;
  freshness: string;
  currentRevision: Value & { id: string };
};
export type Preview = {
  row: Row;
  offer: Offer;
  original: Value | null;
  fields: {
    field: string;
    current: unknown;
    proposed: unknown;
    state: string;
  }[];
  eligible: boolean;
  blockedReason: string | null;
  application: Application | null;
  conflicts: {
    id: string;
    actorUserId: string | null;
    reasonCode: string | null;
    createdAt: string;
  }[];
};

export const freshnessLabels: Record<string, string> = {
  CURRENT: 'CURRENT · Цена актуальна',
  STALE: 'STALE · Цена устарела — требуется уточнение',
  UNKNOWN: 'UNKNOWN · Актуальность цены неизвестна',
};
export const stateLabels: Record<string, string> = {
  QUEUED: 'В очереди',
  RUNNING: 'Обработка',
  RETRY_WAIT: 'Ожидание повтора',
  COMPLETE: 'Завершён',
  PARTIAL: 'Частично обработан',
  FAILED: 'Ошибка',
  PENDING: 'Ожидает проверки',
  ACCEPTED: 'Одобрено',
  REJECTED: 'Отклонено',
  ERROR: 'Ошибка строки',
  NEW: 'Новое значение',
  CHANGED: 'Изменено',
  UNCHANGED: 'Без изменений',
  MISSING: 'Нет в источнике · сохраняется текущее',
};
export const fieldLabels: Record<string, string> = {
  supplierPartNumber: 'Артикул поставщика',
  sourceBrandText: 'Бренд по источнику',
  manufacturerName: 'Производитель',
  originalPartNumber: 'Оригинальный артикул',
  modification: 'Модификация',
  purchaseCost: 'Закупочная цена',
  currency: 'Валюта',
  sourceVatText: 'НДС по источнику',
  availabilityText: 'Наличие по источнику',
  leadTimeText: 'Срок поставки',
  sourceObservedAt: 'Дата источника',
  sourceUrl: 'Ссылка на источник',
};
export function display(value: unknown): string {
  return value === null || value === undefined || value === ''
    ? 'Не указано'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
}
export function uuid(value: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value,
  );
}
export type Attempt = { signature: string; key: string };
export function commandAttempt(
  previous: Attempt | null,
  path: string,
  body: unknown,
  create: () => string,
): Attempt {
  const signature = path + '\n' + JSON.stringify(body);
  return previous?.signature === signature
    ? previous
    : { signature, key: create() };
}

export type CreateInspection = {
  row: Row;
  original: Value | null;
  supplierId: string;
  decisionEligible: boolean;
  decisionId: string | null;
  brands: { id: string; name: string }[];
};
export type CreateInput = {
  supplierId: string;
  brandId: string;
  decisionId: string;
  expectedRowVersion: number;
};
export type CreatePreview = {
  eligible: boolean;
  blockedReason: string | null;
  previewToken: string | null;
  supplierId: string;
  identity: {
    brandId: string;
    brandName: string;
    manufacturerName: string;
    originalPartNumber: string;
    modificationEvidence: string;
    modification: string | null;
  } | null;
  duplicates: {
    offerId: string;
    version: number;
    revisionId: string;
    state: string;
  }[];
};
export type Provenance = Application & {
  operation: 'CREATE' | 'UPDATE';
  rowId: string;
  runId: string;
  sourceId: string;
  sourceHash: string;
  decisionId: string;
  actorId: string;
  version: number;
  baseRevisionId: string | null;
};

export const createBlockedLabels: Record<string, string> = {
  ACTIVE_DUPLICATE:
    'у поставщика уже есть активное предложение с этой идентичностью.',
  NEEDS_REVIEW: 'возможное совпадение требует ручной проверки.',
  INCOMPLETE_IDENTITY: 'исходных данных недостаточно для точной идентификации.',
  SOURCE_DISABLED: 'источник отключён.',
  SOURCE_CHANGED: 'версия источника изменилась.',
  SUPPLIER_INACTIVE: 'поставщик неактивен.',
  SUPPLIER_MISMATCH: 'строка относится к другому поставщику.',
  NOT_ACCEPTED: 'строка ещё не принята.',
  INVALID_CANDIDATE: 'состояние строки или запуска не допускает создание.',
  ALREADY_APPLIED: 'строка уже применена.',
};
