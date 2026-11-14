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
