'use client';

import { useEffect, useState } from 'react';
import { request, StaffRequestError } from '../../catalog/references/api';
import styles from '../workspace.module.css';
import layout from './ingestion.module.css';
import { display, uuid, type Preview } from './model';

type Item = {
  submission: {
    id: string;
    digest: string;
    operation: 'UPDATE' | 'CREATE';
    offer_id: string | null;
    target_revision_id: string | null;
    requester_id: string;
    archived_duplicate_ids: string[];
    reason: string;
  };
  evidence: {
    reference: string;
    kind: string;
    artifact_version: string;
    artifact_digest: string;
    attested_at: string;
    brand_id: string;
    manufacturer_name: string;
    part_number: string;
    modification: string | null;
    modification_evidence: string;
  };
  confirmation: { approver_id: string; reason: string } | null;
  execution: { application_id: string } | null;
};

export function ReconcileOffer({
  rowId,
  mode = 'UPDATE',
  rowVersion,
  preview,
  decisionId,
  consumed,
  busy,
  canSubmit,
  canApprove,
  canExecute,
  runExclusive,
  command,
  onApplied,
}: {
  rowId: string;
  mode?: 'UPDATE' | 'CREATE';
  rowVersion: number;
  preview: Preview | null;
  decisionId: string | null;
  consumed: boolean;
  busy: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canExecute: boolean;
  runExclusive: (work: () => Promise<void>) => Promise<void>;
  command: (path: string, body: unknown) => Promise<unknown>;
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [actorId, setActorId] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const path =
    '/v1/staff/ingestion/rows/' + rowId + '/identity-reconciliations';

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void request<{ data: Item[]; actorId: string }>(path, {
      signal: controller.signal,
    })
      .then(({ data, actorId }) => {
        if (!controller.signal.aborted) {
          setItems(data.filter((item) => item.submission.operation === mode));
          setActorId(actorId);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Не удалось загрузить историю сверки.');
      });
    return () => controller.abort();
  }, [open, path, refresh, mode]);

  const creating = mode === 'CREATE';
  const submitPath = creating ? path + '/create' : path;

  function run(action: () => Promise<unknown>, applied = false) {
    void runExclusive(async () => {
      setError('');
      try {
        await action();
        setConfirming('');
        setRefresh((value) => value + 1);
        if (applied) onApplied();
      } catch (cause) {
        setConfirming('');
        setError(
          cause instanceof StaffRequestError && cause.status === 409
            ? 'Данные изменились или доказательство неприменимо. Обновите историю и проверьте актуальную редакцию.'
            : cause instanceof Error
              ? cause.message
              : 'Не удалось выполнить действие.',
        );
      }
    });
  }

  return (
    <details
      className={layout.editPanel}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Ручная сверка идентичности · {mode}</summary>
      {error && <p role="alert">{error}</p>}
      {canSubmit && !consumed && (creating || preview) && decisionId && (
        <fieldset disabled={busy}>
          <legend>
            {creating
              ? 'Подтвердить идентичность для нового предложения'
              : 'Связать подтверждённый документ с редакцией'}
          </legend>
          {preview && !creating && (
            <p>
              {preview.offer.id} · {preview.offer.currentRevision.id}
            </p>
          )}{' '}
          <label>
            Идентификатор проверенного доказательства
            <input
              value={evidenceId}
              onChange={(event) => setEvidenceId(event.target.value)}
            />
          </label>
          <label>
            Основание сверки
            <input
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            className={styles.secondary}
            type="button"
            disabled={!uuid(evidenceId) || !reason.trim()}
            onClick={() =>
              run(() =>
                command(submitPath, {
                  ...(!creating && preview
                    ? {
                        offerId: preview.offer.id,
                        expectedOfferVersion: preview.offer.version,
                        expectedOfferRevisionId:
                          preview.offer.currentRevision.id,
                      }
                    : {}),
                  expectedRowVersion: rowVersion,
                  decisionId,
                  evidenceId,
                  reason,
                }),
              )
            }
          >
            Передать на независимое подтверждение
          </button>
        </fieldset>
      )}
      {items.length === 0 && <p>По этой строке пока нет сверок.</p>}
      <ul className={layout.history}>
        {items.map(({ submission, evidence, confirmation, execution }) => (
          <li key={submission.id}>
            <h3>
              {submission.operation} ·{' '}
              {execution
                ? 'Применено'
                : confirmation
                  ? 'Подтверждено'
                  : 'Ожидает подтверждения'}
            </h3>
            <p>Редакция · {display(submission.target_revision_id)}</p>
            <p>
              {evidence.manufacturer_name} · {evidence.part_number} ·{' '}
              {evidence.modification ?? evidence.modification_evidence}
            </p>
            <p>Бренд · {evidence.brand_id}</p>
            <p>
              {evidence.kind} · {evidence.reference} ·{' '}
              {evidence.artifact_version} · {evidence.attested_at}
            </p>
            <p>Digest доказательства · {evidence.artifact_digest}</p>
            <p>Digest сверки · {submission.digest}</p>
            <p>Основание · {submission.reason}</p>
            {confirmation && (
              <p>Решение проверяющего · {confirmation.reason}</p>
            )}
            {execution && <p>Квитанция · {execution.application_id}</p>}
            {submission.archived_duplicate_ids.length > 0 && (
              <>
                <p>
                  Архивные совпадения ·{' '}
                  {submission.archived_duplicate_ids.join(', ')}
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledged[submission.id] ?? false}
                    onChange={(event) =>
                      setAcknowledged((prev) => ({
                        ...prev,
                        [submission.id]: event.target.checked,
                      }))
                    }
                  />
                  Архивные совпадения проверены
                </label>
              </>
            )}
            {!consumed &&
              !confirmation &&
              canApprove &&
              actorId &&
              actorId !== submission.requester_id && (
                <fieldset disabled={busy}>
                  <legend>Независимое подтверждение</legend>
                  <label>
                    Подтверждение доказательства
                    <input
                      maxLength={500}
                      value={approval[submission.id] ?? ''}
                      onChange={(event) =>
                        setApproval((current) => ({
                          ...current,
                          [submission.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={
                      !approval[submission.id]?.trim() ||
                      (submission.archived_duplicate_ids.length > 0 &&
                        !acknowledged[submission.id])
                    }
                    onClick={() =>
                      run(() =>
                        command(
                          path +
                            '/' +
                            submission.id +
                            (creating ? '/confirm-create' : '/confirm'),
                          {
                            digest: submission.digest,
                            reason: approval[submission.id],
                            acknowledgedDuplicateIds:
                              submission.archived_duplicate_ids,
                          },
                        ),
                      )
                    }
                  >
                    Подтвердить сверку
                  </button>
                </fieldset>
              )}
            {!consumed &&
              confirmation &&
              !execution &&
              canExecute &&
              actorId &&
              actorId !== confirmation.approver_id && (
                <fieldset disabled={busy}>
                  <legend>Отдельное применение сверки</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={confirming === submission.id}
                      onChange={(event) =>
                        setConfirming(event.target.checked ? submission.id : '')
                      }
                    />
                    Подтверждаю применение к показанной редакции
                  </label>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={
                      confirming !== submission.id ||
                      (submission.archived_duplicate_ids.length > 0 &&
                        !acknowledged[submission.id])
                    }
                    onClick={() =>
                      run(
                        () =>
                          command(
                            path +
                              '/' +
                              submission.id +
                              (creating ? '/create-offer' : '/apply'),
                            {
                              digest: submission.digest,
                              confirmed: true,
                              acknowledgedDuplicateIds:
                                submission.archived_duplicate_ids,
                            },
                          ),
                        true,
                      )
                    }
                  >
                    {creating
                      ? 'Создать предложение'
                      : 'Применить подтверждённую сверку'}
                  </button>
                </fieldset>
              )}
          </li>
        ))}
      </ul>
    </details>
  );
}
