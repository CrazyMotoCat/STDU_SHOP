'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
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
  freshnessLabels,
  stateLabels,
  uuid,
  type Application,
  type Attempt,
  type Decision,
  type Preview,
  type Row,
  type Run,
  type Session,
  type Source,
} from './model';

const base = '/v1/staff/ingestion';
const pageSize = 20;
type Page<T> = {
  data: T[];
  nextCursor?: string | null;
  nextAfter?: number | null;
};

function usePage<T>(
  path: string | null,
  refresh: number,
  failed: (error: unknown) => void,
) {
  const [page, setPage] = useState<{ path: string; result: Page<T> } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    if (!path) {
      setPage(null);
      return;
    }
    setLoading(true);
    void request<Page<T>>(path, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setPage({ path, result });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setError('Не удалось загрузить страницу. Можно повторить запрос.');
        failed(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, refresh, failed]);
  return { result: page?.path === path ? page.result : null, loading, error };
}

export default function IngestionWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const detailEpoch = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [sourceCursor, setSourceCursor] = useState('');
  const [runCursor, setRunCursor] = useState('');
  const [afterRow, setAfterRow] = useState(0);
  const [source, setSource] = useState<Source | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const [offerId, setOfferId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const has = (permission: string) =>
    session?.permissions.includes(permission) ?? false;
  const readable = has('ingestion.read') && !session?.passwordChangeRequired;
  const canPreview =
    readable && has('suppliers.read') && has('suppliers.offers.read');
  const canReview = has('ingestion.review');
  const canApply = canPreview && canReview && has('suppliers.offers.write');

  const failed = useCallback((caught: unknown) => {
    if (caught instanceof StaffRequestError && caught.status === 401) {
      detailEpoch.current++;
      setSession(null);
      setSource(null);
      setRun(null);
      setRow(null);
      setPreview(null);
      setDecisions([]);
      setApplications([]);
      setReason('');
      setOfferId('');
      setConfirming(false);
    }
    setError(
      caught instanceof Error ? caught.message : 'Не удалось выполнить запрос.',
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void request<{ data: Session }>(auth + '/me/permissions', {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted) setSession(data);
      })
      .catch((caught: unknown) => {
        if (
          !controller.signal.aborted &&
          !(caught instanceof StaffRequestError && caught.status === 401)
        )
          failed(caught);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [failed]);

  useEffect(() => {
    if (!reason.trim()) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [reason]);

  const sources = usePage<Source>(
    readable
      ? `${base}/sources?limit=${pageSize}${sourceCursor ? '&cursor=' + sourceCursor : ''}`
      : null,
    refresh,
    failed,
  );
  const runs = usePage<Run>(
    readable
      ? `${base}/runs?limit=${pageSize}${runCursor ? '&cursor=' + runCursor : ''}`
      : null,
    refresh,
    failed,
  );
  const rows = usePage<Row>(
    readable && run
      ? `${base}/runs/${run.id}/rows?limit=${pageSize}&afterRow=${afterRow}`
      : null,
    refresh,
    failed,
  );

  function discard() {
    return (
      !reason.trim() ||
      window.confirm(
        'Есть несохранённая причина решения. Отбросить введённый текст?',
      )
    );
  }
  function resetDetail() {
    detailEpoch.current++;
    setRow(null);
    setPreview(null);
    setDecisions([]);
    setApplications([]);
    setReason('');
    setOfferId('');
    setConfirming(false);
    setDetailLoading(false);
    setPreviewLoading(false);
  }
  async function execute(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (caught) {
      failed(caught);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function command<T>(path: string, body: unknown) {
    attempt.current = commandAttempt(
      attempt.current,
      path,
      body,
      () => 'ingestion-ui-' + crypto.randomUUID(),
    );
    const {
      data: { token },
    } = await request<{ data: { token: string } }>(auth + '/csrf');
    const result = await request<{ data: T }>(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
        'Idempotency-Key': attempt.current.key,
      },
      body: JSON.stringify(body),
    });
    attempt.current = null;
    return result.data;
  }
  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void execute(async () => {
      await mutate(auth + '/login', 'POST', {
        email: values.get('email'),
        password: values.get('password'),
      });
      form.reset();
      setSession(
        (await request<{ data: Session }>(auth + '/me/permissions')).data,
      );
    });
  }
  async function loadDetail(selected: Row) {
    const epoch = ++detailEpoch.current;
    setRow(selected);
    setPreview(null);
    setConfirming(false);
    setDecisions([]);
    setApplications([]);
    setDetailLoading(true);
    try {
      const [history, applied] = await Promise.all([
        request<{ data: Decision[] }>(`${base}/rows/${selected.id}/decisions`),
        request<{ data: Application[] }>(
          `${base}/rows/${selected.id}/applications`,
        ),
      ]);
      if (epoch !== detailEpoch.current) return;
      setDecisions(history.data);
      setApplications(applied.data);
    } catch (caught) {
      if (epoch === detailEpoch.current) failed(caught);
    } finally {
      if (epoch === detailEpoch.current) setDetailLoading(false);
    }
  }
  function selectRow(selected: Row) {
    if (busy || !discard()) return;
    setReason('');
    setOfferId('');
    setError('');
    void loadDetail(selected);
  }
  async function compare() {
    if (!row || !uuid(offerId) || !canPreview) return;
    const epoch = ++detailEpoch.current;
    setPreview(null);
    setConfirming(false);
    setPreviewLoading(true);
    setError('');
    try {
      const result = await request<{ data: Preview }>(
        `${base}/rows/${row.id}/preview?offerId=${encodeURIComponent(offerId)}`,
      );
      if (epoch !== detailEpoch.current) return;
      setPreview(result.data);
      setRow(result.data.row);
      const [history, applied] = await Promise.all([
        request<{ data: Decision[] }>(`${base}/rows/${row.id}/decisions`),
        request<{ data: Application[] }>(`${base}/rows/${row.id}/applications`),
      ]);
      if (epoch === detailEpoch.current) {
        setDecisions(history.data);
        setApplications(applied.data);
      }
    } catch (caught) {
      if (epoch === detailEpoch.current) failed(caught);
    } finally {
      if (epoch === detailEpoch.current) setPreviewLoading(false);
    }
  }
  const reviewable = Boolean(
    preview && (preview.eligible || preview.blockedReason === 'NOT_ACCEPTED'),
  );
  function decide(decision: 'ACCEPT' | 'REJECT') {
    if (
      !row ||
      !reason.trim() ||
      !canReview ||
      (decision === 'ACCEPT' && !reviewable)
    )
      return;
    const selected = row;
    void execute(async () => {
      await command(`${base}/rows/${selected.id}/decision`, {
        expectedVersion: selected.version,
        decision,
        reason: reason.trim(),
      });
      setReason('');
      setNotice(
        decision === 'ACCEPT'
          ? 'Строка одобрена. Применение выполняется отдельным действием.'
          : 'Строка отклонена.',
      );
      const updated = {
        ...selected,
        version: selected.version + 1,
        reviewState: decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
      };
      await loadDetail(updated);
      setRefresh((value) => value + 1);
    });
  }
  function apply() {
    const decision = decisions.find((item) => item.decision === 'ACCEPT');
    if (!row || !preview?.eligible || !decision || !canApply || !confirming)
      return;
    const selected = row;
    const current = preview;
    setConfirming(false);
    void execute(async () => {
      try {
        await command(`${base}/rows/${selected.id}/apply`, {
          offerId: current.offer.id,
          expectedRowVersion: selected.version,
          expectedOfferVersion: current.offer.version,
          expectedOfferRevisionId: current.offer.currentRevision.id,
          decisionId: decision.id,
        });
        setNotice('Изменения применены. Создана новая редакция предложения.');
        await loadDetail(selected);
        setRefresh((value) => value + 1);
      } catch (caught) {
        if (caught instanceof StaffRequestError && caught.status === 409) {
          setPreview(null);
          setNotice(
            'Предложение или состояние строки изменилось. Повторно сравните версии перед новым применением.',
          );
        }
        throw caught;
      }
    });
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>SHOP-STDU · ПОСТАВЩИКИ</p>
          <h1>Проверка предложений</h1>
          <p>Сравнение, индивидуальное решение и ручное применение.</p>
        </div>
        {session && (
          <button
            className={styles.secondary}
            disabled={busy}
            onClick={() => {
              if (!discard()) return;
              void execute(async () => {
                await mutate(auth + '/logout', 'POST', {});
                resetDetail();
                setSession(null);
                setSource(null);
                setRun(null);
              });
            }}
            type="button"
          >
            Выйти
          </button>
        )}
      </header>
      <nav className={styles.nav} aria-label="Разделы поставщиков">
        {(
          [
            ['/staff/suppliers', 'Поставщики'],
            ['/staff/suppliers/offers', 'Предложения'],
            ['/staff/suppliers/matches', 'Сопоставления'],
          ] as const
        ).map(([href, label]) => (
          <Link
            key={href}
            href={href}
            onNavigate={(event) => {
              if (!discard()) event.preventDefault();
            }}
          >
            {label}
          </Link>
        ))}
        <Link href="/staff/suppliers/ingestion" aria-current="page">
          Проверка источников
        </Link>
      </nav>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {checking ? (
        <p role="status">Проверка сессии…</p>
      ) : !session ? (
        <section className={styles.loginCard}>
          <h2>Вход сотрудника</h2>
          <form onSubmit={login}>
            <label>
              Рабочая почта
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
            <button className={styles.primary} disabled={busy} type="submit">
              Войти
            </button>
          </form>
        </section>
      ) : !readable ? (
        <p role="status">
          {session.passwordChangeRequired
            ? 'Сначала смените пароль сотрудника.'
            : 'Нет разрешения на просмотр обработки предложений.'}
        </p>
      ) : (
        <>
          <div className={styles.actions}>
            <button
              className={styles.secondary}
              disabled={busy || sources.loading || runs.loading || rows.loading}
              onClick={() => {
                if (!discard()) return;
                resetDetail();
                setRefresh((value) => value + 1);
              }}
              type="button"
            >
              Обновить данные
            </button>
          </div>
          <div className={layout.layout}>
            <aside className={layout.panel}>
              <section className={styles.card}>
                <h2>Источники</h2>
                <p>
                  Показана одна страница. Запуск выполняется вручную для
                  выбранного источника.
                </p>
                {sources.loading && <p role="status">Загрузка источников…</p>}
                {sources.error && <p role="alert">{sources.error}</p>}
                <ul className={layout.list}>
                  {sources.result?.data.map((item) => (
                    <li key={item.id}>
                      <button
                        className={layout.item}
                        disabled={busy}
                        aria-pressed={source?.id === item.id}
                        onClick={() => setSource(item)}
                        type="button"
                      >
                        <strong>
                          {item.fixtureKey} · {item.state}
                        </strong>
                        <small>Источник {item.id}</small>
                        <small>
                          Поставщик {item.supplierId} · версия {item.version}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
                {sources.result?.data.length === 0 && (
                  <p>Источников пока нет.</p>
                )}
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    disabled={!sourceCursor || busy || sources.loading}
                    onClick={() => setSourceCursor('')}
                    type="button"
                  >
                    Первая страница
                  </button>
                  <button
                    className={styles.secondary}
                    disabled={
                      !sources.result?.nextCursor || busy || sources.loading
                    }
                    onClick={() =>
                      setSourceCursor(sources.result?.nextCursor ?? '')
                    }
                    type="button"
                  >
                    Следующие источники
                  </button>
                </div>
                {has('ingestion.run') && (
                  <button
                    className={styles.primary}
                    disabled={busy || !source || source.state !== 'ENABLED'}
                    onClick={() => {
                      if (!source || !discard()) return;
                      const selected = source;
                      void execute(async () => {
                        const created = await command<Run>(base + '/runs', {
                          sourceId: selected.id,
                          expectedSourceVersion: selected.version,
                        });
                        resetDetail();
                        setRun(created);
                        setAfterRow(0);
                        setRunCursor('');
                        setRefresh((value) => value + 1);
                        setNotice(
                          'Запуск поставлен в очередь. Обновите данные после обработки.',
                        );
                      });
                    }}
                    type="button"
                  >
                    Запустить выбранный источник
                  </button>
                )}
              </section>
              <section className={`${styles.card} ${styles.stack}`}>
                <h2>Запуски</h2>
                <p>Все источники · {pageSize} записей на странице.</p>
                {runs.loading && <p role="status">Загрузка запусков…</p>}
                {runs.error && <p role="alert">{runs.error}</p>}
                <ul className={layout.list}>
                  {runs.result?.data.map((item) => (
                    <li key={item.id}>
                      <button
                        className={layout.item}
                        disabled={busy}
                        aria-pressed={run?.id === item.id}
                        data-testid={`run-${item.id}`}
                        onClick={() => {
                          if (!discard()) return;
                          resetDetail();
                          setRun(item);
                          setAfterRow(0);
                        }}
                        type="button"
                      >
                        <strong>{stateLabels[item.state] ?? item.state}</strong>
                        <small>{item.id}</small>
                        <small>
                          Кандидатов {item.candidateCount} · ошибок{' '}
                          {item.errorCount}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
                {runs.result?.data.length === 0 && <p>Запусков пока нет.</p>}
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    disabled={!runCursor || busy || runs.loading}
                    onClick={() => setRunCursor('')}
                    type="button"
                  >
                    Первая страница
                  </button>
                  <button
                    className={styles.secondary}
                    disabled={!runs.result?.nextCursor || busy || runs.loading}
                    onClick={() => setRunCursor(runs.result?.nextCursor ?? '')}
                    type="button"
                  >
                    Следующие запуски
                  </button>
                </div>
              </section>
            </aside>
            <div className={`${layout.panel} ${styles.stack}`}>
              <section className={styles.card}>
                <h2>Строки обработки</h2>
                {!run ? (
                  <p>Выберите запуск для проверки предложений.</p>
                ) : (
                  <>
                    <p className={layout.meta}>
                      Запуск {run.id} · источник {run.sourceId}
                    </p>
                    {rows.loading && <p role="status">Загрузка строк…</p>}
                    {rows.error && <p role="alert">{rows.error}</p>}
                    <div
                      className={layout.tableScroll}
                      tabIndex={0}
                      role="region"
                      aria-label="Таблица строк обработки"
                    >
                      <table className={layout.table}>
                        <caption>
                          Выберите строку для сравнения и решения.
                        </caption>
                        <thead>
                          <tr>
                            <th>Строка</th>
                            <th>Предложение источника</th>
                            <th>Состояние</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.result?.data.map((item) => (
                            <tr key={item.id}>
                              <td>
                                <button
                                  className={styles.secondary}
                                  disabled={busy}
                                  data-testid={`row-${item.id}`}
                                  onClick={() => selectRow(item)}
                                  type="button"
                                >
                                  Строка {item.rowNumber}
                                </button>
                              </td>
                              <td>
                                {display(item.normalized?.offer_name)}
                                <br />
                                {display(item.normalized?.supplier_part_number)}
                              </td>
                              <td>
                                {stateLabels[item.reviewState] ??
                                  item.reviewState}
                                {item.errorCode && (
                                  <>
                                    <br />
                                    {item.errorCode}
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {rows.result?.data.length === 0 && (
                      <p>
                        Строк пока нет. Для незавершённого запуска обновите
                        данные позднее.
                      </p>
                    )}
                    <div className={styles.actions}>
                      <button
                        className={styles.secondary}
                        disabled={!afterRow || busy || rows.loading}
                        onClick={() => {
                          if (!discard()) return;
                          resetDetail();
                          setAfterRow(0);
                        }}
                        type="button"
                      >
                        Первые строки
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={
                          !rows.result?.nextAfter || busy || rows.loading
                        }
                        onClick={() => {
                          if (!discard()) return;
                          resetDetail();
                          setAfterRow(rows.result?.nextAfter ?? 0);
                        }}
                        type="button"
                      >
                        Следующие строки
                      </button>
                    </div>
                  </>
                )}
              </section>
              {row && (
                <section
                  className={styles.card}
                  aria-labelledby="review-heading"
                >
                  <h2 id="review-heading">Проверка строки {row.rowNumber}</h2>
                  <p>
                    {stateLabels[row.reviewState] ?? row.reviewState} · версия{' '}
                    {row.version}
                  </p>
                  <p className={layout.meta}>Строка {row.id}</p>
                  {detailLoading && <p role="status">Загрузка истории…</p>}
                  {row.errorCode && (
                    <p className={styles.error}>
                      Ошибка источника {row.errorCode}. Применение недоступно.
                    </p>
                  )}
                  {row.warnings.length > 0 && (
                    <p>Предупреждения источника: {row.warnings.join(', ')}</p>
                  )}
                  <h3>Нормализованные данные</h3>
                  <pre className={layout.code}>
                    {JSON.stringify(row.normalized, null, 2)}
                  </pre>
                  {canPreview ? (
                    <>
                      <label>
                        ID существующего предложения
                        <input
                          aria-describedby="offer-hint"
                          value={offerId}
                          maxLength={36}
                          disabled={busy}
                          onChange={(event) => {
                            detailEpoch.current++;
                            setOfferId(event.target.value);
                            setPreview(null);
                            setConfirming(false);
                            setPreviewLoading(false);
                          }}
                        />
                      </label>
                      <p id="offer-hint">
                        Выберите предложение в разделе «Предложения» и
                        скопируйте его ID. Сопоставление с товаром каталога
                        выполняется отдельно.
                      </p>
                      <button
                        className={styles.secondary}
                        disabled={busy || previewLoading || !uuid(offerId)}
                        onClick={() => void compare()}
                        type="button"
                      >
                        {previewLoading
                          ? 'Сравнение…'
                          : 'Сравнить с предложением'}
                      </button>
                    </>
                  ) : (
                    <p>
                      Для сравнения нужны права чтения поставщиков и их
                      предложений.
                    </p>
                  )}
                  {preview && (
                    <>
                      <h3>
                        Сравнение с редакцией {preview.offer.currentRevision.id}
                      </h3>
                      <p>
                        {freshnessLabels[preview.offer.freshness] ??
                          'Актуальность цены неизвестна'}
                      </p>
                      <p>
                        Пустые значения источника сохраняют текущие данные.
                        Название, идентичность и связи с каталогом здесь не
                        изменяются.
                      </p>
                      <div
                        className={layout.tableScroll}
                        tabIndex={0}
                        role="region"
                        aria-label="Сравнение редакций"
                      >
                        <table className={layout.table}>
                          <thead>
                            <tr>
                              <th>Поле</th>
                              <th>Сейчас</th>
                              <th>Из источника</th>
                              <th>Изменение</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.fields.map((field) => (
                              <tr key={field.field}>
                                <th scope="row">
                                  {fieldLabels[field.field] ?? field.field}
                                </th>
                                <td>{display(field.current)}</td>
                                <td>{display(field.proposed)}</td>
                                <td>
                                  {stateLabels[field.state] ?? field.state}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <details>
                        <summary>Исходная строка источника</summary>
                        <pre className={layout.code}>
                          {JSON.stringify(preview.original, null, 2)}
                        </pre>
                      </details>
                      {preview.blockedReason &&
                        preview.blockedReason !== 'NOT_ACCEPTED' && (
                          <p role="status">
                            Применение ограничено: {preview.blockedReason}
                          </p>
                        )}
                    </>
                  )}
                  {canReview &&
                    row.reviewState === 'PENDING' &&
                    !row.errorCode && (
                      <>
                        <label>
                          Причина решения
                          <textarea
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            maxLength={500}
                            rows={3}
                            disabled={busy}
                          />
                        </label>
                        <div className={styles.actions}>
                          <button
                            className={styles.primary}
                            disabled={busy || !reason.trim() || !reviewable}
                            onClick={() => decide('ACCEPT')}
                            type="button"
                          >
                            Одобрить строку (ACCEPT)
                          </button>
                          <button
                            className={styles.danger}
                            disabled={busy || !reason.trim()}
                            onClick={() => decide('REJECT')}
                            type="button"
                          >
                            Отклонить строку (REJECT)
                          </button>
                        </div>
                        {!reviewable && (
                          <p>
                            Для одобрения сначала сравните строку с совместимым
                            существующим предложением.
                          </p>
                        )}
                      </>
                    )}
                  {canApply &&
                    row.reviewState === 'ACCEPTED' &&
                    preview?.eligible &&
                    applications.length === 0 &&
                    !preview.application && (
                      <div className={styles.actions}>
                        <button
                          className={styles.primary}
                          disabled={busy || detailLoading || previewLoading}
                          onClick={() => setConfirming(true)}
                          type="button"
                        >
                          Применить одобренную строку
                        </button>
                      </div>
                    )}
                  {confirming && preview && (
                    <div
                      className={layout.confirm}
                      role="group"
                      aria-label="Подтверждение применения"
                    >
                      <h3>Создать новую редакцию предложения?</h3>
                      <p>
                        Предложение {preview.offer.id}, версия{' '}
                        {preview.offer.version}. Будут применены показанные
                        непустые значения одной одобренной строки.
                      </p>
                      <div className={styles.actions}>
                        <button
                          className={styles.primary}
                          disabled={busy}
                          onClick={apply}
                          type="button"
                        >
                          Подтвердить APPLY
                        </button>
                        <button
                          className={styles.secondary}
                          disabled={busy}
                          onClick={() => setConfirming(false)}
                          type="button"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}
                  <h3>История решения</h3>
                  {!detailLoading && decisions.length === 0 && (
                    <p>Решение ещё не принято.</p>
                  )}
                  <ol className={layout.history}>
                    {decisions.map((item) => (
                      <li key={item.id}>
                        <strong>{item.decision}</strong> · {item.createdAt}
                        <br />
                        {item.reason}
                        <br />
                        Сотрудник {item.actorId}
                      </li>
                    ))}
                  </ol>
                  {preview && preview.conflicts?.length > 0 && (
                    <>
                      <h3>История конфликтов применения</h3>
                      <ol className={layout.history}>
                        {preview.conflicts.map((item) => (
                          <li key={item.id}>
                            {item.createdAt} · {item.reasonCode}
                            <br />
                            Сотрудник {item.actorUserId ?? 'Не указан'}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  <h3>История применения</h3>
                  {!detailLoading && applications.length === 0 && (
                    <p>Строка не применена.</p>
                  )}
                  <ol className={layout.history}>
                    {applications.map((item) => (
                      <li key={item.id}>
                        Применено {item.createdAt}
                        <br />
                        Предложение {item.offerId}
                        <br />
                        Редакция {item.revisionId}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
