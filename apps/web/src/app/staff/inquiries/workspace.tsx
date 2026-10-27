'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './workspace.module.css';

type Json = Record<string, unknown>;
type Permission =
  | 'inquiries.read_assigned'
  | 'inquiries.read_all'
  | 'inquiries.contacts.read'
  | 'inquiries.assign_manager'
  | 'inquiries.assign_engineer'
  | 'inquiries.transition'
  | 'inquiries.comment'
  | 'inquiries.documents.read'
  | 'inquiries.documents.download';
type Inquiry = {
  id: string;
  publicReference: string;
  kind: string;
  status: string;
  stageDueAt: string | null;
  version: number;
  createdAt: string;
  assignedManagerUserId: string | null;
  assignedEngineerUserId: string | null;
  contact?: Json;
  catalogProductContext?: string | null;
  kindDetails?: Json;
  equipmentLines?: Json[];
};
type EventRow = {
  action: string;
  outcome: string;
  occurredAt: string;
  actorStaffUserId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
};
type CommentRow = { id: string; body: string; createdAt: string };
type DocumentRow = {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  detectedMimeType: string;
  securityState: string;
  uploadedAt: string;
};
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';
const statuses = [
  'NEW',
  'TRIAGE',
  'NEEDS_CLARIFICATION',
  'ENGINEERING_REVIEW',
  'READY_FOR_QUOTE',
  'QUOTE_SENT',
  'CLOSED',
];
const nextStatuses: Record<string, Array<[string, string]>> = {
  NEW: [['TRIAGE', 'TRIAGE_STARTED']],
  TRIAGE: [
    ['NEEDS_CLARIFICATION', 'MORE_INFORMATION_REQUIRED'],
    ['ENGINEERING_REVIEW', 'ENGINEERING_STARTED'],
  ],
  NEEDS_CLARIFICATION: [
    ['TRIAGE', 'INFORMATION_RECEIVED'],
    ['ENGINEERING_REVIEW', 'ENGINEERING_STARTED'],
  ],
  ENGINEERING_REVIEW: [
    ['NEEDS_CLARIFICATION', 'RETURN_TO_CLARIFICATION'],
    ['READY_FOR_QUOTE', 'ENGINEERING_COMPLETE'],
  ],
  READY_FOR_QUOTE: [['NEEDS_CLARIFICATION', 'RETURN_TO_CLARIFICATION']],
};
const closureReasons = [
  'DUPLICATE',
  'CUSTOMER_WITHDRAWN',
  'OUT_OF_SCOPE',
  'SPAM',
  'NOT_FEASIBLE',
];

function apiUrl(path: string) {
  if (apiBase.startsWith('/'))
    return new URL(
      `${apiBase.replace(/\/$/, '')}${path}`,
      window.location.origin,
    );
  return new URL(path, apiBase);
}

function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

function unwrap<T>(value: unknown): T {
  return object(value).data as T;
}

function message(value: unknown, fallback: string) {
  const response = object(value);
  return typeof response.message === 'string'
    ? `${String(response.code ?? 'ERROR')}: ${response.message}`
    : fallback;
}

function newKey() {
  return `inquiry-${globalThis.crypto.randomUUID()}`;
}

function human(value: string) {
  return value.replaceAll('_', ' ').toLocaleLowerCase('ru-RU');
}

export default function InquiryWorkspace({
  inquiryId,
}: {
  inquiryId?: string;
}) {
  const csrf = useRef('');
  const epoch = useRef(0);
  const nextCursorRef = useRef('');
  const [profile, setProfile] = useState<Json | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rows, setRows] = useState<Inquiry[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [assignee, setAssignee] = useState('ME');
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [detailErrors, setDetailErrors] = useState<string[]>([]);
  const [targetStaffId, setTargetStaffId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [closureReason, setClosureReason] = useState(closureReasons[0]!);

  const canReadAll = permissions.includes('inquiries.read_all');
  const canRead = canReadAll || permissions.includes('inquiries.read_assigned');

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const requestEpoch = epoch.current;
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined)
      headers.set('Content-Type', 'application/json');
    const method = (init.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method) && csrf.current)
      headers.set('X-CSRF-Token', csrf.current);
    if (
      !['GET', 'HEAD'].includes(method) &&
      path.startsWith('/v1/staff/inquiries') &&
      !headers.has('Idempotency-Key')
    )
      headers.set('Idempotency-Key', newKey());
    const response = await fetch(apiUrl(path), {
      ...init,
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
    if (requestEpoch !== epoch.current)
      throw new Error('Запрос отменён после смены сеанса.');
    const raw = await response.text();
    const parsed = parseJson(raw);
    if (requestEpoch !== epoch.current)
      throw new Error('Запрос отменён после смены сеанса.');
    if (!response.ok)
      throw new Error(message(parsed, `HTTP ${response.status}`));
    return parsed;
  }, []);

  const refreshCsrf = useCallback(async () => {
    const result = await request('/v1/staff/auth/csrf');
    const token = unwrap<{ token?: string }>(result)?.token;
    if (!token) throw new Error('Не удалось получить CSRF-токен.');
    csrf.current = token;
    return token;
  }, [request]);

  const clearSession = useCallback(() => {
    epoch.current += 1;
    csrf.current = '';
    setAuthenticated(false);
    setProfile(null);
    setPermissions([]);
    setForcePasswordChange(false);
    setRows([]);
    setInquiry(null);
    setEvents([]);
    setComments([]);
    setDocuments([]);
  }, []);

  const loadQueue = useCallback(
    async (append = false) => {
      const params = new URLSearchParams({ limit: '50' });
      if (status) params.set('status', status);
      if (kind) params.set('kind', kind);
      if (assignee) params.set('assignee', assignee);
      if (append && nextCursorRef.current)
        params.set('cursor', nextCursorRef.current);
      const response = await request(`/v1/staff/inquiries?${params}`);
      const page = unwrap<Inquiry[]>(response) ?? [];
      setRows((current) => (append ? [...current, ...page] : page));
      const cursor = String(object(object(response).meta).nextCursor ?? '');
      nextCursorRef.current = cursor;
      setNextCursor(cursor);
    },
    [assignee, kind, request, status],
  );

  const loadDetail = useCallback(async () => {
    if (!inquiryId) return;
    setDetailErrors([]);
    const jobs: Array<[string, Promise<unknown>]> = [
      ['Заявка', request(`/v1/staff/inquiries/${inquiryId}`)],
      ['История', request(`/v1/staff/inquiries/${inquiryId}/events?limit=50`)],
    ];
    if (permissions.includes('inquiries.comment'))
      jobs.push([
        'Комментарии',
        request(`/v1/staff/inquiries/${inquiryId}/comments?limit=50`),
      ]);
    if (permissions.includes('inquiries.documents.read'))
      jobs.push([
        'Вложения',
        request(`/v1/staff/inquiries/${inquiryId}/documents`),
      ]);
    const settled = await Promise.allSettled(jobs.map(([, job]) => job));
    const failures: string[] = [];
    for (let index = 0; index < settled.length; index++) {
      const result = settled[index]!;
      const name = jobs[index]![0];
      if (result.status === 'rejected') {
        failures.push(
          `${name}: ${result.reason instanceof Error ? result.reason.message : 'ошибка запроса'}`,
        );
        continue;
      }
      if (name === 'Заявка') setInquiry(unwrap<Inquiry>(result.value));
      if (name === 'История') setEvents(unwrap<EventRow[]>(result.value) ?? []);
      if (name === 'Комментарии')
        setComments(unwrap<CommentRow[]>(result.value) ?? []);
      if (name === 'Вложения')
        setDocuments(unwrap<DocumentRow[]>(result.value) ?? []);
    }
    setDetailErrors(failures);
  }, [inquiryId, permissions, request]);

  useEffect(() => {
    let active = true;
    const initialEpoch = epoch.current;
    void (async () => {
      try {
        await refreshCsrf();
        const me = await request('/v1/staff/auth/me');
        const myPermissions = await request('/v1/staff/auth/me/permissions');
        if (!active || initialEpoch !== epoch.current) return;
        const currentProfile = unwrap<Json>(me);
        const currentPermissions = unwrap<{
          permissions?: Permission[];
          passwordChangeRequired?: boolean;
        }>(myPermissions);
        setProfile(currentProfile);
        setPermissions(currentPermissions.permissions ?? []);
        setForcePasswordChange(
          Boolean(
            currentPermissions.passwordChangeRequired ??
            currentProfile.passwordChangeRequired,
          ),
        );
        setAuthenticated(true);
      } catch {
        if (active && initialEpoch === epoch.current) clearSession();
      }
    })();
    return () => {
      active = false;
    };
  }, [clearSession, refreshCsrf, request]);

  useEffect(() => {
    if (!authenticated || inquiryId || !canRead) return;
    setError('');
    void loadQueue().catch((caught: unknown) =>
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось загрузить очередь.',
      ),
    );
  }, [assignee, authenticated, canRead, inquiryId, kind, loadQueue, status]);

  useEffect(() => {
    if (!authenticated || !inquiryId || !canRead) return;
    void loadDetail().catch((caught: unknown) =>
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось загрузить заявку.',
      ),
    );
  }, [authenticated, canRead, inquiryId, loadDetail]);

  const userId = useMemo(() => String(profile?.id ?? ''), [profile]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      clearSession();
      await refreshCsrf();
      const me = await request('/v1/staff/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      await refreshCsrf();
      const myPermissions = await request('/v1/staff/auth/me/permissions');
      const currentProfile = unwrap<Json>(me);
      const currentPermissions = unwrap<{
        permissions?: Permission[];
        passwordChangeRequired?: boolean;
      }>(myPermissions);
      setProfile(currentProfile);
      setPermissions(currentPermissions.permissions ?? []);
      setForcePasswordChange(
        Boolean(
          currentPermissions.passwordChangeRequired ??
          currentProfile.passwordChangeRequired,
        ),
      );
      setPassword('');
      setAuthenticated(true);
      setNotice('Вход выполнен.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось войти.');
    } finally {
      setBusy(false);
    }
  }

  async function changeOwnPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Новый пароль и подтверждение не совпадают.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/v1/staff/auth/me/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refreshCsrf();
      const me = await request('/v1/staff/auth/me');
      const myPermissions = await request('/v1/staff/auth/me/permissions');
      const currentProfile = unwrap<Json>(me);
      const currentPermissions = unwrap<{
        permissions?: Permission[];
        passwordChangeRequired?: boolean;
      }>(myPermissions);
      setProfile(currentProfile);
      setPermissions(currentPermissions.permissions ?? []);
      setForcePasswordChange(
        Boolean(
          currentPermissions.passwordChangeRequired ??
          currentProfile.passwordChangeRequired,
        ),
      );
      setNotice('Пароль изменён; остальные сессии отозваны.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось изменить пароль.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await request('/v1/staff/auth/logout', { method: 'POST', body: '{}' });
      clearSession();
      setNotice('Сеанс завершён.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось завершить сеанс.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function mutate(
    path: string,
    method: string,
    body: Json,
    version?: number,
  ) {
    if (!inquiry) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(path, {
        method,
        headers: version ? { 'If-Match': `"${version}"` } : undefined,
        body: JSON.stringify(body),
      });
      setNotice('Изменение сохранено.');
      await loadDetail();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Изменение не сохранено.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function assign(role: 'manager' | 'engineer') {
    if (!inquiry) return;
    await mutate(
      `/v1/staff/inquiries/${inquiry.id}/${role}`,
      'PATCH',
      { staffUserId: targetStaffId || userId },
      inquiry.version,
    );
  }

  async function setDue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inquiry) return;
    await mutate(
      `/v1/staff/inquiries/${inquiry.id}/stage-deadline`,
      'PUT',
      { stageDueAt: deadline ? new Date(deadline).toISOString() : null },
      inquiry.version,
    );
  }

  async function transition(toStatus: string, reasonCode: string) {
    if (!inquiry) return;
    await mutate(
      `/v1/staff/inquiries/${inquiry.id}/transition`,
      'POST',
      { toStatus, reasonCode },
      inquiry.version,
    );
  }

  async function addComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inquiry) return;
    const form = new FormData(event.currentTarget);
    const body = String(form.get('body') ?? '').trim();
    if (!body) return;
    await mutate(`/v1/staff/inquiries/${inquiry.id}/comments`, 'POST', {
      body,
    });
    event.currentTarget.reset();
  }

  async function download(document: DocumentRow) {
    if (!inquiry) return;
    try {
      const response = await fetch(
        apiUrl(
          `/v1/staff/inquiries/${inquiry.id}/documents/${document.id}/download`,
        ),
        { credentials: 'include', cache: 'no-store' },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(message(body, `HTTP ${response.status}`));
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = document.originalFilename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Не удалось скачать файл.',
      );
    }
  }

  if (!authenticated)
    return (
      <main className={styles.authShell}>
        <form className={styles.loginCard} onSubmit={signIn}>
          <p className={styles.eyebrow}>STDU · STAFF</p>
          <h1>Вход в заявки</h1>
          <p>
            Для просмотра очереди требуется действующая учётная запись
            сотрудника.
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <label>
            Рабочая почта
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
      </main>
    );

  if (forcePasswordChange)
    return (
      <main className={styles.authShell}>
        <form className={styles.loginCard} onSubmit={changeOwnPassword}>
          <p className={styles.eyebrow}>STDU · STAFF</p>
          <h1>Смените временный пароль</h1>
          <p>До смены пароля доступ к заявкам и другим операциям ограничен.</p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <label>
            Текущий пароль
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label>
            Новый пароль
            <input
              autoComplete="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>
          <label>
            Повторите новый пароль
            <input
              autoComplete="new-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </label>
          <button disabled={busy}>
            {busy ? 'Сохранение…' : 'Изменить пароль'}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => void signOut()}
          >
            Завершить сеанс
          </button>
        </form>
      </main>
    );

  if (!canRead)
    return (
      <main className={styles.shell}>
        <p className={styles.eyebrow}>STDU · STAFF</p>
        <h1>Нет доступа к очереди заявок</h1>
        <p>
          Учётной записи не назначено `inquiries.read_assigned` или
          `inquiries.read_all`.
        </p>
        <button disabled={busy} onClick={() => void signOut()}>
          Завершить сеанс
        </button>
      </main>
    );

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>STDU · STAFF WORKSPACE</p>
          <h1>
            {inquiryId
              ? `Заявка ${inquiry?.publicReference ?? ''}`
              : 'Очередь заявок'}
          </h1>
        </div>
        <div className={styles.userBox}>
          <span>{String(profile?.displayName ?? profile?.email ?? '')}</span>
          <button
            disabled={busy}
            className={styles.secondaryButton}
            onClick={() => void signOut()}
          >
            Выйти
          </button>
        </div>
      </header>
      <nav className={styles.nav} aria-label="Рабочее пространство">
        <Link
          href="/staff/inquiries"
          aria-current={!inquiryId ? 'page' : undefined}
        >
          Очередь
        </Link>
        {inquiryId && <Link href="/staff/inquiries">К списку</Link>}
      </nav>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {!inquiryId ? (
        <section className={styles.card} aria-labelledby="queue-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>РАБОЧАЯ ОЧЕРЕДЬ</p>
              <h2 id="queue-heading">Входящие обращения</h2>
            </div>
            <button
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => void loadQueue()}
            >
              Обновить
            </button>
          </div>
          <div className={styles.filters}>
            <label>
              Статус
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">Все статусы</option>
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {human(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Тип
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="">Все типы</option>
                <option value="EQUIPMENT">Оборудование</option>
                <option value="PANELS">Электрощиты</option>
                <option value="ENGINEERING">Инженерная задача</option>
              </select>
            </label>
            {canReadAll && (
              <label>
                Назначение
                <select
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                >
                  <option value="ME">Назначенные мне</option>
                  <option value="UNASSIGNED">Без назначения</option>
                </select>
              </label>
            )}
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Ссылка</th>
                  <th>Тип</th>
                  <th>Стадия</th>
                  <th>Создана</th>
                  <th>Срок стадии</th>
                  <th>Менеджер</th>
                  <th>Инженер</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/staff/inquiries/${row.id}`}>
                        {row.publicReference}
                      </Link>
                    </td>
                    <td>{human(row.kind)}</td>
                    <td>
                      <span className={styles.pill}>{human(row.status)}</span>
                    </td>
                    <td>{new Date(row.createdAt).toLocaleString('ru-RU')}</td>
                    <td>
                      {row.stageDueAt
                        ? new Date(row.stageDueAt).toLocaleString('ru-RU')
                        : '—'}
                    </td>
                    <td>{row.assignedManagerUserId ?? '—'}</td>
                    <td>{row.assignedEngineerUserId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className={styles.empty}>Заявок по выбранным фильтрам нет.</p>
            )}
          </div>
          {nextCursor && (
            <button
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => void loadQueue(true)}
            >
              Загрузить ещё
            </button>
          )}
        </section>
      ) : (
        <DetailWorkspace
          inquiry={inquiry}
          events={events}
          comments={comments}
          documents={documents}
          errors={detailErrors}
          busy={busy}
          targetStaffId={targetStaffId}
          setTargetStaffId={setTargetStaffId}
          deadline={deadline}
          setDeadline={setDeadline}
          closureReason={closureReason}
          setClosureReason={setClosureReason}
          permissions={permissions}
          userId={userId}
          onAssign={assign}
          onDue={setDue}
          onTransition={transition}
          onComment={addComment}
          onDownload={download}
        />
      )}
    </main>
  );
}

function DetailWorkspace({
  inquiry,
  events,
  comments,
  documents,
  errors,
  busy,
  targetStaffId,
  setTargetStaffId,
  deadline,
  setDeadline,
  closureReason,
  setClosureReason,
  permissions,
  userId,
  onAssign,
  onDue,
  onTransition,
  onComment,
  onDownload,
}: {
  inquiry: Inquiry | null;
  events: EventRow[];
  comments: CommentRow[];
  documents: DocumentRow[];
  errors: string[];
  busy: boolean;
  targetStaffId: string;
  setTargetStaffId: (value: string) => void;
  deadline: string;
  setDeadline: (value: string) => void;
  closureReason: string;
  setClosureReason: (value: string) => void;
  permissions: Permission[];
  userId: string;
  onAssign: (role: 'manager' | 'engineer') => void;
  onDue: (event: React.FormEvent<HTMLFormElement>) => void;
  onTransition: (toStatus: string, reason: string) => void;
  onComment: (event: React.FormEvent<HTMLFormElement>) => void;
  onDownload: (document: DocumentRow) => void;
}) {
  if (!inquiry)
    return (
      <section className={styles.card}>
        <h2>Заявка недоступна</h2>
        {errors.length ? (
          <ul>
            {errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Загрузка заявки…</p>
        )}
      </section>
    );
  const details = object(inquiry.kindDetails);
  const readContacts = permissions.includes('inquiries.contacts.read');
  const noLongerOpen = ['QUOTE_SENT', 'CLOSED'].includes(inquiry.status);
  return (
    <div className={styles.detailGrid}>
      <div className={styles.stack}>
        <section className={styles.card}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>
                ЗАЯВКА · {inquiry.publicReference}
              </p>
              <h2>
                {human(inquiry.kind)} · {human(inquiry.status)}
              </h2>
            </div>
            <span className={styles.pill}>версия {inquiry.version}</span>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Создана</dt>
              <dd>{new Date(inquiry.createdAt).toLocaleString('ru-RU')}</dd>
            </div>
            <div>
              <dt>Срок текущей стадии</dt>
              <dd>
                {inquiry.stageDueAt
                  ? new Date(inquiry.stageDueAt).toLocaleString('ru-RU')
                  : 'Не задан'}
              </dd>
            </div>
            <div>
              <dt>Назначенный менеджер</dt>
              <dd>{inquiry.assignedManagerUserId ?? 'Не назначен'}</dd>
            </div>
            <div>
              <dt>Назначенный инженер</dt>
              <dd>{inquiry.assignedEngineerUserId ?? 'Не назначен'}</dd>
            </div>
            <div>
              <dt>Контекст каталога</dt>
              <dd>{inquiry.catalogProductContext || 'Не передан'}</dd>
            </div>
          </dl>
          {readContacts ? (
            <div className={styles.contactBox}>
              <h3>Контакт</h3>
              {Object.entries(object(inquiry.contact)).map(([key, value]) => (
                <p key={key}>
                  <strong>{human(key)}:</strong> {String(value ?? '—')}
                </p>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>
              Контактные данные скрыты: нет `inquiries.contacts.read`.
            </p>
          )}
          <h3>Технические сведения</h3>
          <pre className={styles.json}>
            {JSON.stringify(
              { ...details, equipmentLines: inquiry.equipmentLines },
              null,
              2,
            )}
          </pre>
        </section>

        {!noLongerOpen && permissions.includes('inquiries.transition') && (
          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>РУЧНЫЕ ДЕЙСТВИЯ</p>
                <h2>Стадия и срок</h2>
              </div>
            </div>
            <form className={styles.inlineForm} onSubmit={onDue}>
              <label>
                Срок текущей стадии
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </label>
              <button disabled={busy}>Сохранить срок</button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busy}
                onClick={() => setDeadline('')}
              >
                Очистить поле
              </button>
            </form>
            <div className={styles.actionList}>
              {(nextStatuses[inquiry.status] ?? []).map(([to, reason]) => (
                <button
                  key={to}
                  disabled={busy}
                  onClick={() => onTransition(to, reason)}
                >
                  Перевести: {human(to)}
                </button>
              ))}
            </div>
            {inquiry.status !== 'QUOTE_SENT' && inquiry.status !== 'CLOSED' && (
              <form
                className={styles.inlineForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  onTransition('CLOSED', closureReason);
                }}
              >
                <label>
                  Закрыть без КП
                  <select
                    value={closureReason}
                    onChange={(event) => setClosureReason(event.target.value)}
                  >
                    {closureReasons.map((reason) => (
                      <option key={reason}>{reason}</option>
                    ))}
                  </select>
                </label>
                <button className={styles.dangerButton} disabled={busy}>
                  Закрыть заявку
                </button>
              </form>
            )}
          </section>
        )}

        {(permissions.includes('inquiries.assign_manager') ||
          permissions.includes('inquiries.assign_engineer')) &&
          !noLongerOpen && (
            <section className={styles.card}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>ОТВЕТСТВЕННЫЕ</p>
                  <h2>Назначение</h2>
                </div>
              </div>
              <label>
                UUID сотрудника, пусто — назначить себя
                <input
                  value={targetStaffId}
                  onChange={(event) => setTargetStaffId(event.target.value)}
                  placeholder={userId}
                />
              </label>
              <div className={styles.actionList}>
                {permissions.includes('inquiries.assign_manager') && (
                  <button
                    disabled={busy}
                    onClick={() => void onAssign('manager')}
                  >
                    Назначить менеджером
                  </button>
                )}
                {permissions.includes('inquiries.assign_engineer') && (
                  <button
                    disabled={busy}
                    onClick={() => void onAssign('engineer')}
                  >
                    Назначить инженером
                  </button>
                )}
              </div>
            </section>
          )}

        {permissions.includes('inquiries.comment') && (
          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>ВНУТРЕННЯЯ ИСТОРИЯ</p>
                <h2>Комментарии</h2>
              </div>
            </div>
            <form className={styles.stack} onSubmit={onComment}>
              <label>
                Внутренний комментарий
                <textarea name="body" maxLength={4000} rows={4} required />
              </label>
              <button disabled={busy}>Добавить комментарий</button>
            </form>
            <ul className={styles.timeline}>
              {comments.map((comment) => (
                <li key={comment.id}>
                  <time>
                    {new Date(comment.createdAt).toLocaleString('ru-RU')}
                  </time>
                  <p>{comment.body}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className={styles.stack}>
        <section className={styles.card}>
          <p className={styles.eyebrow}>ИСТОРИЯ</p>
          <h2>События</h2>
          {events.length ? (
            <ol className={styles.timeline}>
              {events.map((event, index) => (
                <li key={`${event.action}-${event.occurredAt}-${index}`}>
                  <time>
                    {new Date(event.occurredAt).toLocaleString('ru-RU')}
                  </time>
                  <strong>{human(event.action)}</strong>
                  <p>
                    {event.fromStatus && `${human(event.fromStatus)} → `}
                    {event.toStatus
                      ? human(event.toStatus)
                      : human(event.outcome)}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.muted}>Событий пока нет.</p>
          )}
        </section>
        {permissions.includes('inquiries.documents.read') && (
          <section className={styles.card}>
            <p className={styles.eyebrow}>ПРИВАТНЫЕ ВЛОЖЕНИЯ</p>
            <h2>Файлы</h2>
            {documents.length ? (
              <ul className={styles.documentList}>
                {documents.map((document) => (
                  <li key={document.id}>
                    <div>
                      <strong>{document.originalFilename}</strong>
                      <small>
                        {document.detectedMimeType} ·{' '}
                        {(document.sizeBytes / 1024 / 1024).toFixed(2)} MiB
                      </small>
                      <span className={styles.pill}>
                        {document.securityState}
                      </span>
                    </div>
                    {document.securityState === 'CLEAN' &&
                      permissions.includes('inquiries.documents.download') && (
                        <button
                          className={styles.secondaryButton}
                          onClick={() => onDownload(document)}
                        >
                          Скачать
                        </button>
                      )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>Вложений нет.</p>
            )}
            <p className={styles.muted}>
              Без подтверждённого сканера файлы остаются в карантине и
              недоступны для скачивания.
            </p>
          </section>
        )}
      </aside>
      {errors.length > 0 && (
        <section className={styles.card}>
          <h2>Часть разделов недоступна</h2>
          <ul>
            {errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
