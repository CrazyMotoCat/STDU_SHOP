'use client';

import { useEffect, useRef, useState } from 'react';
import {
  auth,
  mutate,
  request,
  StaffRequestError,
} from '../../catalog/references/api';
import styles from '../workspace.module.css';
import layout from './ingestion.module.css';
import {
  commandAttempt,
  display,
  fieldLabels,
  type Application,
  type Attempt,
  type Preview,
} from './model';

const fields = [
  'purchaseCost',
  'currency',
  'sourceVatText',
  'availabilityText',
  'leadTimeText',
  'sourceUrl',
] as const;
type Field = (typeof fields)[number];
type Edit = { op: 'KEEP' | 'SET' | 'CLEAR'; reason: string };
type EditResult = {
  fields: {
    field: Field;
    current: string | null;
    result: string | null;
    sourceFreshness: string | null;
    currentFreshness: string | null;
  }[];
  evidence: { sourceHash: string; capturedAt: string } | null;
  blockedReason: string | null;
  previewToken: string | null;
};
const initial: Edit = { op: 'KEEP', reason: '' };
const messages: Record<string, string> = {
  VERSION_CONFLICT:
    'Версия изменилась. Загрузите актуальное сравнение и заново проверьте свои правки.',
  ALREADY_APPLIED: 'Строка уже использована.',
  PRICE_CLEAR_EVIDENCE_REQUIRED:
    'Для очистки цены и валюты выберите проверенное основание из источника.',
  INCONSISTENT_PRICE_CURRENCY:
    'Очистите цену и связанную валюту явными действиями.',
  STALE_OR_UNDATED_FACT:
    'Предложенное значение требует актуального наблюдения.',
  NO_CHANGED_FIELDS: 'Предложение остаётся без изменений.',
  IDENTITY_MISMATCH: 'Точное соответствие предложения строке не подтверждено.',
  CURRENCY_MISMATCH: 'Для валюты требуется согласованное изменение цены.',
};

export function EditOffer({
  preview,
  decisionId,
  onApplied,
  disabled,
  runExclusive,
}: {
  preview: Preview;
  decisionId: string;
  onApplied: (receipt: Application) => void;
  disabled: boolean;
  runExclusive: (work: () => Promise<void>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<Record<Field, Edit>>>({});
  const [evidenceHash, setEvidenceHash] = useState('');
  const [result, setResult] = useState<EditResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<Attempt | null>(null);
  const lock = useRef(false);
  const endpoint = '/v1/staff/ingestion/rows/' + preview.row.id;
  const body = {
    offerId: preview.offer.id,
    decisionId,
    expectedRowVersion: preview.row.version,
    expectedOfferVersion: preview.offer.version,
    expectedOfferRevisionId: preview.offer.currentRevision.id,
    evidenceHash: evidenceHash || undefined,
    edits: Object.fromEntries(
      fields.flatMap((field) => {
        const edit = draft[field];
        if (!edit || edit.op === 'KEEP') return [];
        return [
          [
            field,
            edit.op === 'CLEAR'
              ? { op: 'CLEAR', reason: edit.reason }
              : {
                  op: 'SET',
                  value: preview.fields.find((entry) => entry.field === field)
                    ?.proposed,
                },
          ],
        ];
      }),
    ),
  };

  const context = [
    body.expectedRowVersion,
    body.expectedOfferVersion,
    body.expectedOfferRevisionId,
  ].join('/');
  const [previewContext, setPreviewContext] = useState('');
  const active = previewContext === context ? result : null;
  const planValid =
    fields.some((field) => draft[field] && draft[field].op !== 'KEEP') &&
    fields.every(
      (field) => draft[field]?.op !== 'CLEAR' || draft[field].reason.trim(),
    );

  function change(field: Field, edit: Edit) {
    setDraft((prior) => ({ ...prior, [field]: edit }));
    setResult(null);
    setConfirmed(false);
  }

  async function run(apply: boolean) {
    if (
      lock.current ||
      !planValid ||
      (apply && (!confirmed || !active?.previewToken))
    )
      return;
    if (disabled) return;
    lock.current = true;
    await runExclusive(async () => {
      setError('');
      try {
        if (!apply) {
          setConfirmed(false);
          setResult(null);
          const { data } = await mutate<EditResult>(
            endpoint + '/edit-preview',
            'POST',
            body,
          );
          setResult(data);
          setPreviewContext(context);
        } else {
          const path = endpoint + '/apply-edits';
          const command = {
            ...body,
            previewToken: active?.previewToken,
            confirmed: true,
          };
          const retry = commandAttempt(attempt.current, path, command, () =>
            crypto.randomUUID(),
          );
          attempt.current = retry;
          const {
            data: { token },
          } = await request<{ data: { token: string } }>(auth + '/csrf');
          const { data } = await request<{ data: Application }>(path, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': token,
              'Idempotency-Key': retry.key,
            },
            body: JSON.stringify(command),
          });
          setResult(null);
          onApplied(data);
        }
      } catch (cause) {
        if (cause instanceof StaffRequestError && cause.status === 409) {
          setResult(null);
          setConfirmed(false);
          setError(messages.VERSION_CONFLICT ?? 'Версия изменилась.');
        } else {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Операция пока недоступна.',
          );
        }
      }
    }).finally(() => {
      lock.current = false;
    });
  }

  return (
    <details className={layout.editPanel}>
      <summary>Явные правки предложения</summary>
      <fieldset disabled={disabled}>
        <legend>Выберите действие для каждого поля</legend>
        {fields.map((field) => {
          const edit = draft[field] ?? initial;
          const values = preview.fields.find((entry) => entry.field === field);
          return (
            <div key={field}>
              <label htmlFor={'edit-operation-' + field}>
                {fieldLabels[field]}
              </label>
              <select
                id={'edit-operation-' + field}
                value={edit.op}
                onChange={(event) =>
                  change(field, {
                    ...edit,
                    op: event.target.value as Edit['op'],
                  })
                }
              >
                <option value="KEEP">Сохранить</option>
                <option
                  value="SET"
                  disabled={typeof values?.proposed !== 'string'}
                >
                  Взять из источника
                </option>
                <option value="CLEAR">Очистить</option>
              </select>
              {edit.op === 'CLEAR' && (
                <label>
                  Причина · {fieldLabels[field]}
                  <input
                    value={edit.reason}
                    maxLength={500}
                    onChange={(event) =>
                      change(field, { ...edit, reason: event.target.value })
                    }
                  />
                </label>
              )}
            </div>
          );
        })}
        {active?.evidence &&
          (draft.purchaseCost?.op === 'CLEAR' ||
            draft.currency?.op === 'CLEAR') &&
          !evidenceHash && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setEvidenceHash(active.evidence?.sourceHash ?? '');
                setResult(null);
              }}
            >
              Подтвердить основание из снимка источника
            </button>
          )}
        {evidenceHash && <p>Снимок источника выбран как основание.</p>}
        <button
          type="button"
          className={styles.secondary}
          disabled={!planValid}
          onClick={() => void run(false)}
        >
          Проверить явные правки
        </button>
        {active && (
          <>
            <ul className={layout.history}>
              {active.fields.map((field) => (
                <li key={field.field}>
                  {fieldLabels[field.field]} · {display(field.current)} →{' '}
                  {display(field.result)}
                  {field.currentFreshness &&
                    ' · текущее: ' + field.currentFreshness}
                  {field.sourceFreshness &&
                    ' · источник: ' + field.sourceFreshness}
                </li>
              ))}
            </ul>
            {active.blockedReason && (
              <p role="status">
                {messages[active.blockedReason] ?? active.blockedReason}
              </p>
            )}
            {active.previewToken && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  Подтверждаю показанные изменения и очистку перечисленных полей
                </label>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!confirmed}
                  onClick={() => void run(true)}
                >
                  Применить явные правки
                </button>
              </>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </details>
  );
}

type EditHistoryData = {
  applicationId: string;
  baseRevisionId: string;
  revisionId: string;
  edits: Partial<Record<Field, { op: string; reason?: string }>>;
  evidence: {
    sourceVersion: number;
    rowNumber: number;
    priceEvidence?: { sourceHash: string; observedAt: string } | null;
  };
  fields: { field: Field; before: string | null; after: string | null }[];
};

export function EditHistory({ rowId }: { rowId: string }) {
  const [history, setHistory] = useState<EditHistoryData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<{ data: EditHistoryData | null }>(
      '/v1/staff/ingestion/rows/' + rowId + '/edit-history',
      { signal: controller.signal },
    )
      .then(({ data }) => {
        if (!controller.signal.aborted) setHistory(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [rowId]);
  if (error)
    return <p role="status">Не удалось загрузить подробности применения.</p>;
  if (!history) return null;
  return (
    <details>
      <summary>История явных правок</summary>
      <p>
        Редакции {history.baseRevisionId} → {history.revisionId}
      </p>
      <ul className={layout.history}>
        {history.fields
          .filter(({ field }) => history.edits[field])
          .map((field) => (
            <li key={field.field}>
              {fieldLabels[field.field]} · {display(field.before)} →{' '}
              {display(field.after)}
              {history.edits[field.field]?.reason && (
                <p>Причина · {history.edits[field.field]?.reason}</p>
              )}
            </li>
          ))}
      </ul>
      <p>
        Источник · версия {history.evidence.sourceVersion}, строка{' '}
        {history.evidence.rowNumber}
      </p>
      {history.evidence.priceEvidence && (
        <p>
          Снимок · {history.evidence.priceEvidence.sourceHash} ·{' '}
          {history.evidence.priceEvidence.observedAt}
        </p>
      )}
    </details>
  );
}
