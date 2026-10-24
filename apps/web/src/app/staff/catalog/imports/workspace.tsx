'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './workspace.module.css';

type RecordValue = Record<string, unknown>;
type Run = RecordValue & {
  id: string;
  state: string;
  version: number;
  mappingVersion: number;
};
type Row = RecordValue & {
  id: string;
  sourceRowNumber: number;
  sheetIndex: number;
  version: number;
  candidateState: string;
};
type Reference = { id: string; name: string; slug: string; state: string };
type ColumnMap = {
  columnIndex: number;
  target: string;
  attributeDefinitionId?: string;
  categoryId?: string;
};
type SheetMap = {
  sheetIndex: number;
  headerRowNumber: number;
  fixedCategoryId?: string;
  fixedBrandId?: string;
  columnMappings: ColumnMap[];
  referenceMappings: {
    target: 'categoryId' | 'brandId';
    sourceValue: string;
    targetId: string;
  }[];
};

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';
function apiUrl(path: string) {
  if (apiBase.startsWith('/'))
    return new URL(
      `${apiBase.replace(/\/$/, '')}${path}`,
      window.location.origin,
    );
  return new URL(path, apiBase);
}
const targets = [
  ['displayName', 'Название'],
  ['summary', 'Краткое описание'],
  ['description', 'Описание'],
  ['manufacturerName', 'Производитель'],
  ['originalPartNumber', 'Артикул'],
  ['modification', 'Модификация'],
  ['categoryId', 'Категория из колонки'],
  ['brandId', 'Бренд из колонки'],
  ['attribute', 'Атрибут'],
];

function getData<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || !('data' in value))
    throw new Error('Сервер вернул неожиданный ответ.');
  return (value as { data: T }).data;
}

export default function CatalogImportsWorkspace() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [csrf, setCsrf] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Reference[]>([]);
  const [brands, setBrands] = useState<Reference[]>([]);
  const [sheetMaps, setSheetMaps] = useState<Record<number, SheetMap>>({});
  const [referenceDraft, setReferenceDraft] = useState<Record<number, string>>(
    {},
  );
  const [rowCursor, setRowCursor] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [csvEncoding, setCsvEncoding] = useState('UTF-8');
  const [csvDelimiter, setCsvDelimiter] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      if (
        csrf &&
        init.method &&
        !['GET', 'HEAD'].includes(init.method.toUpperCase())
      )
        headers.set('X-CSRF-Token', csrf);
      const response = await fetch(apiUrl(path), {
        ...init,
        headers,
        credentials: 'include',
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => ({}))) as RecordValue;
      if (!response.ok)
        throw new Error(
          typeof body.message === 'string'
            ? `${body.code ?? response.status}: ${body.message}`
            : `HTTP ${response.status}`,
        );
      return body;
    },
    [csrf],
  );

  const refreshCsrf = useCallback(async () => {
    const result = getData<{ token: string }>(
      await request('/v1/staff/auth/csrf'),
    );
    setCsrf(result.token);
    return result.token;
  }, [request]);

  const loadReferences = useCallback(async () => {
    const [categoryResponse, brandResponse] = await Promise.all([
      request('/v1/staff/catalog/categories?limit=100'),
      request('/v1/staff/catalog/brands?limit=100'),
    ]);
    setCategories(
      (getData<Reference[]>(categoryResponse) ?? []).filter(
        (item) => item.state === 'ACTIVE',
      ),
    );
    setBrands(
      (getData<Reference[]>(brandResponse) ?? []).filter(
        (item) => item.state === 'ACTIVE',
      ),
    );
  }, [request]);

  const loadRuns = useCallback(async () => {
    const result = getData<Run[]>(
      await request('/v1/staff/catalog/imports?pageSize=100'),
    );
    setRuns(result);
  }, [request]);

  const loadRun = useCallback(
    async (id: string) => {
      setBusy(true);
      setError('');
      try {
        const selected = getData<Run>(
          await request(`/v1/staff/catalog/imports/${id}`),
        );
        const rowResponse = await request(
          `/v1/staff/catalog/imports/${id}/rows?pageSize=100`,
        );
        const listed = getData<Row[]>(rowResponse);
        const meta = rowResponse.meta as RecordValue | undefined;
        setRowCursor(
          typeof meta?.nextCursor === 'string' ? meta.nextCursor : null,
        );
        setRun(selected);
        setRows(listed);
        setSheetMaps((prior) => {
          const next = { ...prior };
          for (const row of listed)
            if (!(row.sheetIndex in next))
              next[row.sheetIndex] = {
                sheetIndex: row.sheetIndex,
                headerRowNumber: 1,
                columnMappings: [],
                referenceMappings: [],
              };
          return next;
        });
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Не удалось открыть импорт.',
        );
      } finally {
        setBusy(false);
      }
    },
    [request],
  );

  const loadMoreRows = useCallback(async () => {
    if (!run || !rowCursor) return;
    setBusy(true);
    setError('');
    try {
      const result = await request(
        `/v1/staff/catalog/imports/${run.id}/rows?pageSize=100&cursor=${encodeURIComponent(rowCursor)}`,
      );
      setRows((prior) => [...prior, ...getData<Row[]>(result)]);
      const meta = result.meta as RecordValue | undefined;
      setRowCursor(
        typeof meta?.nextCursor === 'string' ? meta.nextCursor : null,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось загрузить следующие строки.',
      );
    } finally {
      setBusy(false);
    }
  }, [request, rowCursor, run]);

  const refresh = useCallback(async () => {
    await loadRuns();
    if (run) await loadRun(run.id);
  }, [loadRun, loadRuns, run]);

  useEffect(() => {
    if (!authenticated) return;
    void Promise.all([loadRuns(), loadReferences()]).catch((caught: unknown) =>
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось загрузить данные.',
      ),
    );
  }, [authenticated, loadReferences, loadRuns]);

  useEffect(() => {
    let current = true;
    void request('/v1/staff/auth/me')
      .then(async () => {
        if (!current) return;
        await refreshCsrf();
        if (current) setAuthenticated(true);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [refreshCsrf, request]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const token = await refreshCsrf();
      const response = await fetch(apiUrl('/v1/staff/auth/login'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
          'X-CSRF-Token': token,
        },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => ({}))) as RecordValue;
      if (!response.ok)
        throw new Error(
          typeof body.message === 'string' ? body.message : 'Вход не выполнен.',
        );
      setAuthenticated(true);
      setPassword('');
      await refreshCsrf();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Вход не выполнен.');
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const form = new FormData();
      form.set('file', file);
      if (file.name.toLowerCase().endsWith('.csv')) {
        form.set('csvEncoding', csvEncoding);
        if (csvDelimiter) form.set('csvDelimiter', csvDelimiter);
      }
      const result = getData<Run>(
        await request('/v1/staff/catalog/imports', {
          method: 'POST',
          body: form,
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }),
      );
      setRun(result);
      setFile(null);
      await Promise.all([loadRuns(), loadRun(result.id)]);
      setMessage(
        'Источник сохранён приватно; его статус безопасности остался UNCHECKED.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Загрузка не выполнена.',
      );
    } finally {
      setBusy(false);
    }
  }

  const sheets = useMemo(
    () =>
      [...new Set(rows.map((item) => item.sheetIndex))].sort((a, b) => a - b),
    [rows],
  );

  function updateSheet(sheetIndex: number, update: Partial<SheetMap>) {
    setSheetMaps((prior) => ({
      ...prior,
      [sheetIndex]: { ...prior[sheetIndex]!, ...update },
    }));
  }

  function updateColumn(
    sheetIndex: number,
    columnIndex: number,
    target: string,
  ) {
    const sheet = sheetMaps[sheetIndex]!;
    const existing = sheet.columnMappings.find(
      (item) => item.columnIndex === columnIndex,
    );
    const columnMappings = sheet.columnMappings.filter(
      (item) => item.columnIndex !== columnIndex,
    );
    if (target !== '')
      columnMappings.push({
        columnIndex,
        target,
        ...(target === 'attribute' && existing?.attributeDefinitionId
          ? {
              attributeDefinitionId: existing.attributeDefinitionId,
              categoryId: existing.categoryId,
            }
          : {}),
      });
    updateSheet(sheetIndex, {
      columnMappings: columnMappings.sort(
        (a, b) => a.columnIndex - b.columnIndex,
      ),
    });
  }

  async function saveMapping() {
    if (!run) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const selectedSheets = sheets
        .map((index) => {
          const sheet = sheetMaps[index]!;
          const referenceText = referenceDraft[index];
          if (referenceText === undefined) return sheet;
          let referenceMappings: SheetMap['referenceMappings'];
          try {
            referenceMappings = JSON.parse(
              referenceText,
            ) as SheetMap['referenceMappings'];
          } catch {
            throw new Error(
              `Reference mappings для листа ${index + 1} должны быть корректным JSON-массивом.`,
            );
          }
          if (!Array.isArray(referenceMappings))
            throw new Error(
              `Reference mappings листа ${index + 1} должны быть массивом.`,
            );
          return { ...sheet, referenceMappings };
        })
        .filter(Boolean);
      const result = getData<Run>(
        await request(`/v1/staff/catalog/imports/${run.id}/mapping`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersion: run.version,
            mappingSchemaVersion: 1,
            sheetMappings: selectedSheets,
          }),
        }),
      );
      setRun(result);
      setMessage('Mapping сохранён с контролем версии.');
      await loadRun(run.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Mapping не сохранён.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!run) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = getData<Run>(
        await request(`/v1/staff/catalog/imports/${run.id}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      setRun(result);
      await loadRun(run.id);
      setMessage('Предпросмотр пересчитан по сохранённым исходным строкам.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Предпросмотр не выполнен.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function decide(row: Row, action: string) {
    if (!run) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body: RecordValue = {
        expectedRowVersion: row.version,
        action,
        reasonCode:
          action === 'ACCEPT_CREATE' || action === 'ACCEPT_REVISION'
            ? undefined
            : 'OTHER',
      };
      if (action === 'ACCEPT_REVISION') {
        body.expectedProductVersion = row.expectedProductVersion;
        body.expectedCurrentRevisionId = row.expectedCurrentRevisionId;
      }
      const result = await request(
        `/v1/staff/catalog/imports/${run.id}/rows/${row.id}/decision`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
      );
      const decision = getData<RecordValue>(result);
      setMessage(
        `Решение ${decision.outcome} записано для строки ${row.sourceRowNumber}.`,
      );
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Решение не записано.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await request('/v1/staff/auth/logout', { method: 'POST' });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Выход не подтверждён сервером.',
      );
      return;
    } finally {
      setBusy(false);
    }
    setAuthenticated(false);
    setRun(null);
    setRows([]);
    setRuns([]);
    setCsrf('');
    setSheetMaps({});
    setReferenceDraft({});
  }

  if (!authenticated)
    return (
      <main className={styles.shell}>
        <section className={styles.loginCard}>
          <p className={styles.eyebrow}>STDU · STAFF WORKSPACE</p>
          <h1>Импорт каталога</h1>
          <p>
            Войдите в защищённую рабочую область. Доступ к исходным строкам
            проверяется сервером.
          </p>
          <form onSubmit={login} className={styles.form}>
            <label>
              Email
              <input
                autoComplete="username"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Пароль
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button disabled={busy}>{busy ? 'Проверка…' : 'Войти'}</button>
          </form>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </section>
      </main>
    );

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>STDU · CATALOG OPERATIONS</p>
          <h1>Ручной импорт</h1>
          <p>
            Загрузка, проверка и поштучные решения. Публикация остаётся
            отдельным действием.
          </p>
        </div>
        <button
          className={styles.secondary}
          disabled={busy}
          onClick={() => void logout()}
        >
          Выйти
        </button>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      <section className={styles.panel}>
        <h2>Новый источник</h2>
        <form onSubmit={upload} className={styles.uploadForm}>
          <label>
            CSV или XLSX
            <input
              data-testid="import-file"
              type="file"
              accept=".csv,.xlsx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
            />
          </label>
          {file?.name.toLowerCase().endsWith('.csv') && (
            <>
              <label>
                Кодировка
                <select
                  value={csvEncoding}
                  onChange={(event) => setCsvEncoding(event.target.value)}
                >
                  <option>UTF-8</option>
                  <option>WINDOWS-1251</option>
                </select>
              </label>
              <label>
                Разделитель
                <select
                  value={csvDelimiter}
                  onChange={(event) => setCsvDelimiter(event.target.value)}
                >
                  <option value="">Определить однозначно</option>
                  <option value=",">Запятая</option>
                  <option value=";">Точка с запятой</option>
                  <option value="\t">Табуляция</option>
                </select>
              </label>
            </>
          )}
          <button disabled={busy || !file}>
            {busy ? 'Загрузка…' : 'Загрузить приватно'}
          </button>
        </form>
      </section>
      <div className={styles.columns}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}>
            <h2>Импорты</h2>
            <button
              className={styles.secondary}
              onClick={() => void loadRuns()}
            >
              Обновить
            </button>
          </div>
          {runs.length === 0 ? (
            <p className={styles.muted}>Пока нет импортов.</p>
          ) : (
            <ul className={styles.runList}>
              {runs.map((item) => (
                <li key={item.id}>
                  <button
                    className={item.id === run?.id ? styles.selectedRun : ''}
                    onClick={() => void loadRun(item.id)}
                  >
                    <strong>{String(item.originalFilename)}</strong>
                    <span>
                      {item.state} · {String(item.uploadedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {run && (
          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div>
                <h2>{String(run.originalFilename)}</h2>
                <p className={styles.muted}>
                  {run.state} · версия {run.version} · mapping{' '}
                  {run.mappingVersion}
                </p>
              </div>
              <button
                className={styles.secondary}
                onClick={() => void loadRun(run.id)}
              >
                Перечитать
              </button>
            </div>
            <div className={styles.summary}>
              <span>
                Строк:{' '}
                {String(
                  (run.rowCounts as RecordValue | undefined)?.total ??
                    rows.length,
                )}
              </span>
              <span>
                Готово:{' '}
                {String((run.rowCounts as RecordValue | undefined)?.ready ?? 0)}
              </span>
              <span>
                Применено:{' '}
                {String(
                  (run.rowCounts as RecordValue | undefined)?.applied ?? 0,
                )}
              </span>
            </div>
            <p className={styles.muted}>
              SHA-256: <code>{String(run.sourceSha256)}</code>
            </p>
          </section>
        )}
      </div>
      {run && (
        <>
          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div>
                <h2>Mapping и предпросмотр</h2>
                <p className={styles.muted}>
                  Выберите заголовок и назначьте поля. Фиксированные справочники
                  действуют только на этот лист.
                </p>
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => void saveMapping()}
                >
                  Сохранить mapping
                </button>
                <button
                  disabled={busy || run.mappingVersion === 0}
                  onClick={() => void preview()}
                >
                  Проверить строки
                </button>
              </div>
            </div>
            <div className={styles.sheetGrid}>
              {sheets.map((index) => {
                const sheet = sheetMaps[index];
                const header = rows.find(
                  (item) =>
                    item.sheetIndex === index &&
                    item.sourceRowNumber === sheet?.headerRowNumber,
                );
                const cells = Array.isArray(header?.sourceCells)
                  ? (header.sourceCells as RecordValue[])
                  : [];
                return (
                  <article className={styles.sheetCard} key={index}>
                    <h3>
                      Лист {index + 1} ·{' '}
                      {String(
                        rows.find((item) => item.sheetIndex === index)
                          ?.sheetName ?? 'CSV',
                      )}
                    </h3>
                    <label>
                      Строка заголовка
                      <input
                        type="number"
                        min="1"
                        value={sheet?.headerRowNumber ?? 1}
                        onChange={(event) =>
                          updateSheet(index, {
                            headerRowNumber: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <div className={styles.referenceGrid}>
                      <label>
                        Фиксированная категория
                        <select
                          value={sheet?.fixedCategoryId ?? ''}
                          onChange={(event) =>
                            updateSheet(index, {
                              fixedCategoryId: event.target.value || undefined,
                            })
                          }
                        >
                          <option value="">Не задана</option>
                          {categories.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Фиксированный бренд
                        <select
                          value={sheet?.fixedBrandId ?? ''}
                          onChange={(event) =>
                            updateSheet(index, {
                              fixedBrandId: event.target.value || undefined,
                            })
                          }
                        >
                          <option value="">Не задан</option>
                          {brands.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {cells.map((cell) => {
                      const columnIndex = Number(cell.columnIndex);
                      const mapping = sheet?.columnMappings.find(
                        (item) => item.columnIndex === columnIndex,
                      );
                      return (
                        <div className={styles.mapRow} key={columnIndex}>
                          <span>
                            <b>{columnIndex + 1}.</b>{' '}
                            {String(
                              cell.rawValue || `Колонка ${columnIndex + 1}`,
                            )}
                          </span>
                          <select
                            aria-label={`Назначение колонки ${columnIndex + 1}`}
                            value={mapping?.target ?? ''}
                            onChange={(event) =>
                              updateColumn(
                                index,
                                columnIndex,
                                event.target.value,
                              )
                            }
                          >
                            <option value="">Не использовать</option>
                            {targets.map(([value, label]) => (
                              <option value={value} key={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          {mapping?.target === 'attribute' && (
                            <>
                              <input
                                aria-label={`Attribute definition ${columnIndex + 1}`}
                                placeholder="AttributeDefinition UUID"
                                value={mapping.attributeDefinitionId ?? ''}
                                onChange={(event) =>
                                  updateColumnAttribute(
                                    index,
                                    columnIndex,
                                    event.target.value,
                                    mapping.categoryId ??
                                      sheet?.fixedCategoryId ??
                                      '',
                                  )
                                }
                              />
                              <input
                                aria-label={`Attribute category ${columnIndex + 1}`}
                                placeholder="Category UUID"
                                value={
                                  mapping.categoryId ??
                                  sheet?.fixedCategoryId ??
                                  ''
                                }
                                onChange={(event) =>
                                  updateColumnAttribute(
                                    index,
                                    columnIndex,
                                    mapping.attributeDefinitionId ?? '',
                                    event.target.value,
                                  )
                                }
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                    <label>
                      Явные справочные сопоставления (JSON)
                      <textarea
                        rows={4}
                        aria-label={`Reference mappings sheet ${index + 1}`}
                        value={
                          referenceDraft[index] ??
                          JSON.stringify(
                            sheet?.referenceMappings ?? [],
                            null,
                            2,
                          )
                        }
                        onChange={(event) =>
                          setReferenceDraft((prior) => ({
                            ...prior,
                            [index]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </article>
                );
              })}
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div>
                <h2>Строки источника</h2>
                <p className={styles.muted}>
                  Сырые данные видны только после серверной проверки доступа.
                  Каждое решение отправляется отдельно.
                </p>
              </div>
            </div>
            {rows.map((row) => (
              <article
                className={styles.rowCard}
                key={row.id}
                data-testid="import-row"
              >
                <div className={styles.rowHeading}>
                  <strong>
                    Лист {row.sheetIndex + 1}, строка {row.sourceRowNumber}
                  </strong>
                  <span className={styles.state}>{row.candidateState}</span>
                </div>
                <div className={styles.rowData}>
                  <div>
                    <h4>Исходные ячейки</h4>
                    <pre>{JSON.stringify(row.sourceCells, null, 2)}</pre>
                  </div>
                  <div>
                    <h4>Нормализованный кандидат</h4>
                    <pre>
                      {JSON.stringify(row.normalizedCandidate, null, 2)}
                    </pre>
                  </div>
                </div>
                {Array.isArray(row.validationIssues) &&
                  row.validationIssues.length > 0 && (
                    <p className={styles.error}>
                      Проверки: {JSON.stringify(row.validationIssues)}
                    </p>
                  )}
                <div className={styles.actions}>
                  {row.candidateState === 'NEW' ||
                  row.candidateState === 'NO_DEDUP_KEY' ? (
                    <button
                      disabled={busy}
                      onClick={() => void decide(row, 'ACCEPT_CREATE')}
                    >
                      Создать DRAFT
                    </button>
                  ) : null}
                  {row.candidateState === 'EXACT_MATCH' ? (
                    <button
                      disabled={busy}
                      onClick={() => void decide(row, 'ACCEPT_REVISION')}
                    >
                      Создать DRAFT-редакцию
                    </button>
                  ) : null}
                  {!['APPLIED', 'REJECTED', 'HEADER', 'IGNORED'].includes(
                    row.candidateState,
                  ) && (
                    <>
                      <button
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() => void decide(row, 'HOLD')}
                      >
                        Отложить
                      </button>
                      <button
                        className={styles.danger}
                        disabled={busy}
                        onClick={() => void decide(row, 'REJECT')}
                      >
                        Отклонить строку
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
            {rowCursor && (
              <button
                className={styles.secondary}
                disabled={busy}
                onClick={() => void loadMoreRows()}
              >
                Загрузить следующие строки
              </button>
            )}
          </section>
        </>
      )}
    </main>
  );

  function updateColumnAttribute(
    sheetIndex: number,
    columnIndex: number,
    attributeDefinitionId: string,
    categoryId: string,
  ) {
    setSheetMaps((prior) => {
      const sheet = prior[sheetIndex]!;
      return {
        ...prior,
        [sheetIndex]: {
          ...sheet,
          columnMappings: sheet.columnMappings.map((item) =>
            item.columnIndex === columnIndex
              ? {
                  ...item,
                  target: 'attribute',
                  ...(attributeDefinitionId ? { attributeDefinitionId } : {}),
                  ...(categoryId ? { categoryId } : {}),
                }
              : item,
          ),
        },
      };
    });
  }
}
