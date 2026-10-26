'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './workspace.module.css';

type RecordValue = Record<string, unknown>;
type View = 'directory' | 'detail' | 'offers' | 'matches';
type Supplier = RecordValue & {
  id: string;
  legalName: string;
  state: 'ACTIVE' | 'ARCHIVED';
  version: number;
};
type Offer = RecordValue & {
  id: string;
  supplierId: string;
  supplierName: string;
  state: string;
  version: number;
  currentMatchProposalId: string | null;
  currentRevision: RecordValue;
};
type Proposal = RecordValue & {
  id: string;
  offerId: string;
  productId: string;
  state: 'PENDING' | 'APPROVED' | 'REJECTED';
  version: number;
  currentForOffer: boolean;
};
type Candidate = RecordValue & {
  productId: string;
  productVersion: number;
  manufacturerName: string;
  originalPartNumber: string;
  identityEvidenceKind: string;
};
type Reference = { id: string; name: string; state: string };

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';

function apiUrl(path: string) {
  if (apiBase.startsWith('/'))
    return new URL(
      `${apiBase.replace(/\/$/, '')}${path}`,
      window.location.origin,
    );
  return new URL(path, apiBase);
}

function object(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as RecordValue;
}

function data<T>(value: unknown): T {
  return object(value).data as T;
}

function list<T>(value: unknown): T[] {
  const rows = data<unknown>(value);
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function nullable(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function newIdempotencyKey() {
  return `staff-${crypto.randomUUID()}`;
}

export default function SupplierWorkspace({
  view,
  supplierId,
}: {
  view: View;
  supplierId?: string;
}) {
  const router = useRouter();
  const csrfRef = useRef('');
  const sessionEpoch = useRef(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [identity, setIdentity] = useState<RecordValue | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [revisions, setRevisions] = useState<RecordValue[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [brands, setBrands] = useState<Reference[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const [auditRows, setAuditRows] = useState<RecordValue[]>([]);
  const [auditError, setAuditError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const requestEpoch = sessionEpoch.current;
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined)
      headers.set('Content-Type', 'application/json');
    if (
      csrfRef.current &&
      !headers.has('X-CSRF-Token') &&
      init.method &&
      !['GET', 'HEAD'].includes(init.method.toUpperCase())
    )
      headers.set('X-CSRF-Token', csrfRef.current);
    if (
      init.method &&
      !['GET', 'HEAD'].includes(init.method.toUpperCase()) &&
      !headers.has('Idempotency-Key') &&
      path.startsWith('/v1/staff/supplier')
    )
      headers.set('Idempotency-Key', newIdempotencyKey());
    const response = await fetch(apiUrl(path), {
      ...init,
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
    if (requestEpoch !== sessionEpoch.current)
      throw new Error('Запрос отменён после смены сессии.');
    const body = (await response.json().catch(() => ({}))) as RecordValue;
    if (requestEpoch !== sessionEpoch.current)
      throw new Error('Запрос отменён после смены сессии.');
    if (!response.ok)
      throw new Error(
        typeof body.message === 'string'
          ? `${String(body.code ?? response.status)}: ${body.message}`
          : `HTTP ${response.status}`,
      );
    return body;
  }, []);

  const refreshCsrf = useCallback(async () => {
    const requestEpoch = sessionEpoch.current;
    const response = await request('/v1/staff/auth/csrf');
    if (requestEpoch !== sessionEpoch.current)
      throw new Error('Запрос отменён после смены сессии.');
    const token = data<{ token?: string }>(response)?.token;
    if (!token) throw new Error('Не удалось получить токен формы.');
    csrfRef.current = token;
    return token;
  }, [request]);

  const clearUserData = useCallback(() => {
    sessionEpoch.current += 1;
    csrfRef.current = '';
    setAuthenticated(false);
    setIdentity(null);
    setSuppliers([]);
    setSupplier(null);
    setRevisions([]);
    setOffers([]);
    setBrands([]);
    setProposals([]);
    setCandidates([]);
    setSelectedOfferId('');
    setAuditRows([]);
    setAuditError('');
    setError('');
    setNotice('');
  }, []);

  const loadWorkspace = useCallback(async () => {
    const epoch = sessionEpoch.current;
    const isCurrentSession = () => epoch === sessionEpoch.current;
    setError('');
    if (view === 'directory') {
      const response = await request(
        '/v1/staff/suppliers?state=ACTIVE&limit=50',
      );
      if (isCurrentSession()) setSuppliers(list<Supplier>(response));
      return;
    }
    if (view === 'detail' && supplierId) {
      const [profile, history, supplierOffers] = await Promise.all([
        request(`/v1/staff/suppliers/${supplierId}`),
        request(`/v1/staff/suppliers/${supplierId}/revisions?limit=50`),
        request(`/v1/staff/suppliers/${supplierId}/offers?limit=50`),
      ]);
      if (!isCurrentSession()) return;
      setSupplier(data<Supplier>(profile));
      setRevisions(list<RecordValue>(history));
      setOffers(list<Offer>(supplierOffers));
      setAuditError('');
      try {
        const auditResponse = await request(
          `/v1/staff/suppliers/${supplierId}/audit?limit=50`,
        );
        if (!isCurrentSession()) return;
        setAuditRows(list<RecordValue>(auditResponse));
      } catch (caught) {
        if (isCurrentSession())
          setAuditError(
            caught instanceof Error ? caught.message : 'Нет доступа к аудиту.',
          );
      }
      return;
    }
    if (view === 'offers') {
      const [supplierResponse, offerResponse, brandResponse] =
        await Promise.all([
          request('/v1/staff/suppliers?state=ACTIVE&limit=100'),
          request('/v1/staff/supplier-offers?limit=50'),
          request('/v1/staff/catalog/brands?limit=100'),
        ]);
      if (!isCurrentSession()) return;
      setSuppliers(list<Supplier>(supplierResponse));
      setOffers(list<Offer>(offerResponse));
      setBrands(
        list<Reference>(brandResponse).filter(
          (brand) => brand.state === 'ACTIVE',
        ),
      );
      return;
    }
    if (view === 'matches') {
      const [offerResponse, proposalResponse] = await Promise.all([
        request('/v1/staff/supplier-offers?state=ACTIVE&limit=100'),
        request('/v1/staff/supplier-match-proposals?limit=100'),
      ]);
      if (!isCurrentSession()) return;
      const nextOffers = list<Offer>(offerResponse);
      setOffers(nextOffers);
      setProposals(list<Proposal>(proposalResponse));
      setSelectedOfferId((current) => {
        if (current && nextOffers.some((offer) => offer.id === current))
          return current;
        const queryOffer = new URLSearchParams(window.location.search).get(
          'offerId',
        );
        return queryOffer && nextOffers.some((offer) => offer.id === queryOffer)
          ? queryOffer
          : (nextOffers[0]?.id ?? '');
      });
    }
  }, [request, supplierId, view]);

  const loadCandidates = useCallback(async () => {
    const epoch = sessionEpoch.current;
    if (view !== 'matches' || !selectedOfferId) {
      setCandidates([]);
      return;
    }
    try {
      const response = await request(
        `/v1/staff/supplier-offers/${selectedOfferId}/match-candidates`,
      );
      if (epoch !== sessionEpoch.current) return;
      const dataValue = data<{ candidates?: Candidate[] }>(response);
      setCandidates(dataValue?.candidates ?? []);
    } catch (caught) {
      if (epoch !== sessionEpoch.current) return;
      setCandidates([]);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось загрузить кандидатов.',
      );
    }
  }, [request, selectedOfferId, view]);

  useEffect(() => {
    let active = true;
    const epoch = sessionEpoch.current;
    void (async () => {
      try {
        const csrfResponse = await request('/v1/staff/auth/csrf');
        const token = data<{ token?: string }>(csrfResponse)?.token;
        if (token && active && epoch === sessionEpoch.current) {
          csrfRef.current = token;
        }
        const profile = await request('/v1/staff/auth/me');
        if (!active || epoch !== sessionEpoch.current) return;
        setIdentity(data<RecordValue>(profile));
        setAuthenticated(true);
      } catch {
        if (active && epoch === sessionEpoch.current) clearUserData();
      }
    })();
    return () => {
      active = false;
    };
  }, [clearUserData, request]);

  useEffect(() => {
    if (!authenticated) return;
    const epoch = sessionEpoch.current;
    void loadWorkspace().catch((caught: unknown) => {
      if (epoch !== sessionEpoch.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось загрузить раздел.',
      );
    });
  }, [authenticated, loadWorkspace]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const currentOffer = useMemo(
    () => offers.find((offer) => offer.id === selectedOfferId) ?? null,
    [offers, selectedOfferId],
  );

  async function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearUserData();
    setBusy(true);
    try {
      const token = await refreshCsrf();
      const response = await request('/v1/staff/auth/login', {
        method: 'POST',
        headers: { 'X-CSRF-Token': token },
        body: JSON.stringify({ email, password }),
      });
      setIdentity(data<RecordValue>(response));
      setAuthenticated(true);
      setPassword('');
      setNotice('Вход выполнен.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Не удалось выполнить вход.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await request('/v1/staff/auth/logout', { method: 'POST', body: '{}' });
      clearUserData();
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

  async function submitSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const taxIdentifier = nullable(form.get('taxIdentifier'));
      const created = data<{ id: string }>(
        await request('/v1/staff/suppliers', {
          method: 'POST',
          body: JSON.stringify({
            legalName: form.get('legalName'),
            shortName: nullable(form.get('shortName')),
            taxIdentifier,
            taxJurisdiction: taxIdentifier
              ? nullable(form.get('taxJurisdiction'))
              : null,
          }),
        }),
      );
      setNotice('Поставщик создан.');
      router.push(`/staff/suppliers/${created.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось создать поставщика.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplier) return;
    const form = new FormData(event.currentTarget);
    const taxIdentifier = nullable(form.get('taxIdentifier'));
    const taxJurisdiction = taxIdentifier
      ? nullable(form.get('taxJurisdiction'))
      : null;
    setBusy(true);
    setError('');
    try {
      await request(`/v1/staff/suppliers/${supplier.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: supplier.version,
          legalName: form.get('legalName'),
          shortName: nullable(form.get('shortName')),
          taxIdentifier,
          taxJurisdiction,
          contactName: nullable(form.get('contactName')),
          email: nullable(form.get('email')),
          phone: nullable(form.get('phone')),
          website: nullable(form.get('website')),
          internalNotes: nullable(form.get('internalNotes')),
        }),
      });
      setNotice('Изменения сохранены отдельной редакцией.');
      await loadWorkspace();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось сохранить поставщика.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function archiveSupplier() {
    if (!supplier || !window.confirm(`Архивировать «${supplier.legalName}»?`))
      return;
    setBusy(true);
    setError('');
    try {
      await request(`/v1/staff/suppliers/${supplier.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: supplier.version,
          reasonCode: 'STAFF_ARCHIVE',
        }),
      });
      setNotice('Поставщик архивирован.');
      router.push('/staff/suppliers');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось архивировать поставщика.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function createOffer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await request('/v1/staff/supplier-offers', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: form.get('supplierId'),
          brandId: nullable(form.get('brandId')),
          manufacturerName: nullable(form.get('manufacturerName')),
          originalPartNumber: nullable(form.get('originalPartNumber')),
          modification: nullable(form.get('modification')),
          modificationEvidence: form.get('modificationEvidence'),
          supplierPartNumber: nullable(form.get('supplierPartNumber')),
          offerName: nullable(form.get('offerName')),
          purchaseCost: nullable(form.get('purchaseCost')),
          currency: nullable(form.get('currency')),
          availabilityText: nullable(form.get('availabilityText')),
          leadTimeText: nullable(form.get('leadTimeText')),
          sourceUrl: nullable(form.get('sourceUrl')),
          sourceObservedAt: new Date().toISOString(),
        }),
      });
      setNotice('Предложение поставщика создано.');
      event.currentTarget.reset();
      await loadWorkspace();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось создать предложение.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function archiveOffer(offer: Offer) {
    if (!window.confirm(`Архивировать предложение ${offer.id.slice(0, 8)}?`))
      return;
    setBusy(true);
    try {
      await request(`/v1/staff/supplier-offers/${offer.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: offer.version,
          reasonCode: 'STAFF_ARCHIVE',
        }),
      });
      setNotice('Предложение архивировано.');
      await loadWorkspace();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось архивировать предложение.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function proposeMatch(candidate: Candidate) {
    if (!currentOffer) return;
    setBusy(true);
    setError('');
    try {
      await request(
        `/v1/staff/supplier-offers/${currentOffer.id}/match-proposals`,
        {
          method: 'POST',
          body: JSON.stringify({
            productId: candidate.productId,
            expectedOfferVersion: currentOffer.version,
            expectedProductVersion: candidate.productVersion,
          }),
        },
      );
      setNotice('Предложение создано и ожидает решения сотрудника.');
      await loadWorkspace();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось создать предложение связи.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function decideProposal(
    proposal: Proposal,
    decision: 'APPROVE' | 'REJECT',
  ) {
    if (!currentOffer) return;
    setBusy(true);
    setError('');
    try {
      const product = data<RecordValue>(
        await request(`/v1/staff/catalog/products/${proposal.productId}`),
      );
      await request(
        `/v1/staff/supplier-match-proposals/${proposal.id}/decision`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            expectedVersion: proposal.version,
            expectedOfferVersion: currentOffer.version,
            expectedProductVersion: product.version,
            expectedCurrentMatchProposalId: currentOffer.currentMatchProposalId,
            reasonCode:
              decision === 'APPROVE' ? 'IDENTITY_CONFIRMED' : 'STAFF_REJECTED',
          }),
        },
      );
      setNotice(
        decision === 'APPROVE'
          ? 'Связь подтверждена вручную.'
          : 'Предложение отклонено.',
      );
      await loadWorkspace();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Решение не сохранено. Обновите данные.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function unlinkMatch() {
    if (!currentOffer?.currentMatchProposalId) return;
    if (!window.confirm('Снять подтверждённую связь с товаром?')) return;
    setBusy(true);
    setError('');
    try {
      await request(
        `/v1/staff/supplier-offers/${currentOffer.id}/match/unlink`,
        {
          method: 'POST',
          body: JSON.stringify({
            expectedVersion: currentOffer.version,
            expectedCurrentMatchProposalId: currentOffer.currentMatchProposalId,
            reasonCode: 'MANUAL_REVIEW',
            reason: 'Staff removed the association after review.',
          }),
        },
      );
      setNotice(
        'Связь снята. Предыдущая связь не восстановлена автоматически.',
      );
      await loadWorkspace();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Не удалось снять связь.',
      );
    } finally {
      setBusy(false);
    }
  }

  const nav = (
    <nav className={styles.nav} aria-label="Разделы поставщиков">
      <Link
        aria-current={view === 'directory' ? 'page' : undefined}
        href="/staff/suppliers"
      >
        Поставщики
      </Link>
      <Link
        aria-current={view === 'offers' ? 'page' : undefined}
        href="/staff/suppliers/offers"
      >
        Предложения
      </Link>
      <Link
        aria-current={view === 'matches' ? 'page' : undefined}
        href="/staff/suppliers/matches"
      >
        Сопоставления
      </Link>
    </nav>
  );

  if (!authenticated)
    return (
      <main className={styles.authShell}>
        <form className={styles.loginCard} onSubmit={submitLogin}>
          <p className={styles.eyebrow}>STDU / STAFF</p>
          <h1>Рабочее пространство поставщиков</h1>
          <p>Войдите под сотрудником с выданными разрешениями R1-007.</p>
          <label>
            Рабочая почта
            <input
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Пароль
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button className={styles.primary} disabled={busy} type="submit">
            {busy ? 'Проверяем…' : 'Войти'}
          </button>
        </form>
      </main>
    );

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>STDU / STAFF / SUPPLIERS</p>
          <h1>
            {view === 'directory'
              ? 'Поставщики'
              : view === 'detail'
                ? 'Карточка поставщика'
                : view === 'offers'
                  ? 'Предложения поставщиков'
                  : 'Ручные сопоставления'}
          </h1>
        </div>
        <div className={styles.userBox}>
          <span>{String(identity?.displayName ?? identity?.email ?? '')}</span>
          <button
            className={styles.secondary}
            disabled={busy}
            onClick={signOut}
            type="button"
          >
            Выйти
          </button>
        </div>
      </header>
      {nav}
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

      {view === 'directory' && (
        <section className={styles.grid}>
          <form className={styles.card} onSubmit={submitSupplier}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>НОВАЯ ЗАПИСЬ</p>
                <h2>Добавить поставщика</h2>
              </div>
            </div>
            <label>
              Юридическое или торговое имя
              <input maxLength={240} name="legalName" required />
            </label>
            <div className={styles.twoColumns}>
              <label>
                Короткое имя
                <input maxLength={160} name="shortName" />
              </label>
              <label>
                Юрисдикция
                <input defaultValue="RU" maxLength={2} name="taxJurisdiction" />
              </label>
            </div>
            <label>
              Налоговый идентификатор
              <input maxLength={64} name="taxIdentifier" />
            </label>
            <button className={styles.primary} disabled={busy} type="submit">
              Создать поставщика
            </button>
          </form>
          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>АКТИВНЫЕ</p>
                <h2>Справочник</h2>
              </div>
              <button
                className={styles.secondary}
                onClick={() => void loadWorkspace()}
                type="button"
              >
                Обновить
              </button>
            </div>
            {suppliers.length === 0 ? (
              <p className={styles.muted}>Активных поставщиков пока нет.</p>
            ) : (
              <div className={styles.rows}>
                {suppliers.map((item) => (
                  <Link
                    className={styles.row}
                    href={`/staff/suppliers/${item.id}`}
                    key={item.id}
                  >
                    <span>
                      <strong>{item.legalName}</strong>
                      <small>
                        {item.shortName
                          ? String(item.shortName)
                          : 'Профиль поставщика'}
                      </small>
                    </span>
                    <span className={styles.rowArrow}>Открыть ↗</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </section>
      )}

      {view === 'detail' && supplier && (
        <div className={styles.grid}>
          <form className={styles.card} onSubmit={updateSupplier}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>
                  ПРОФИЛЬ · ВЕРСИЯ {supplier.version}
                </p>
                <h2>{supplier.legalName}</h2>
              </div>
              <span className={styles.state}>{supplier.state}</span>
            </div>
            <div className={styles.twoColumns}>
              <label>
                Полное имя
                <input
                  defaultValue={supplier.legalName}
                  maxLength={240}
                  name="legalName"
                  required
                />
              </label>
              <label>
                Короткое имя
                <input
                  defaultValue={String(supplier.shortName ?? '')}
                  maxLength={160}
                  name="shortName"
                />
              </label>
              <label>
                Налоговый идентификатор
                <input
                  defaultValue={String(supplier.taxIdentifier ?? '')}
                  maxLength={64}
                  name="taxIdentifier"
                />
              </label>
              <label>
                Юрисдикция
                <input
                  defaultValue={String(supplier.taxJurisdiction ?? '')}
                  maxLength={2}
                  name="taxJurisdiction"
                />
              </label>
              <label>
                Контактное лицо
                <input
                  defaultValue={String(supplier.contactName ?? '')}
                  maxLength={160}
                  name="contactName"
                />
              </label>
              <label>
                Рабочая почта
                <input
                  defaultValue={String(supplier.email ?? '')}
                  maxLength={254}
                  name="email"
                  type="email"
                />
              </label>
              <label>
                Телефон
                <input
                  defaultValue={String(supplier.phone ?? '')}
                  maxLength={64}
                  name="phone"
                />
              </label>
              <label>
                Сайт
                <input
                  defaultValue={String(supplier.website ?? '')}
                  maxLength={2048}
                  name="website"
                  type="url"
                />
              </label>
            </div>
            <label>
              Внутренние заметки
              <textarea
                defaultValue={String(supplier.internalNotes ?? '')}
                maxLength={4000}
                name="internalNotes"
                rows={4}
              />
            </label>
            <div className={styles.actions}>
              <button className={styles.primary} disabled={busy} type="submit">
                Сохранить новую редакцию
              </button>
              <button
                className={styles.danger}
                disabled={busy || supplier.state !== 'ACTIVE'}
                onClick={() => void archiveSupplier()}
                type="button"
              >
                Архивировать
              </button>
            </div>
          </form>
          <div className={styles.stack}>
            <section className={styles.card}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>ТЕКУЩИЕ ЗАПИСИ</p>
                  <h2>Предложения</h2>
                </div>
                <Link
                  className={styles.textLink}
                  href="/staff/suppliers/offers"
                >
                  Все предложения ↗
                </Link>
              </div>
              {offers.map((offer) => (
                <Link
                  className={styles.compactRow}
                  href={`/staff/suppliers/matches?offerId=${offer.id}`}
                  key={offer.id}
                >
                  <span>
                    <strong>
                      {String(
                        offer.currentRevision.originalPartNumber ??
                          offer.currentRevision.offerName ??
                          'Без артикула',
                      )}
                    </strong>
                    <small>
                      {String(
                        offer.currentRevision.manufacturerName ??
                          'Производитель не указан',
                      )}
                    </small>
                  </span>
                  <span>
                    {String(
                      offer.currentRevision.purchaseCost ?? 'Цена не указана',
                    )}{' '}
                    {String(offer.currentRevision.currency ?? '')}
                  </span>
                </Link>
              ))}
              {offers.length === 0 && (
                <p className={styles.muted}>Предложений пока нет.</p>
              )}
            </section>
            <section className={styles.card}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>НЕИЗМЕНЯЕМАЯ ИСТОРИЯ</p>
                  <h2>Редакции профиля</h2>
                </div>
              </div>
              {revisions.map((revision) => (
                <div className={styles.compactRow} key={String(revision.id)}>
                  <span>Редакция {String(revision.revisionNo)}</span>
                  <time>
                    {new Date(String(revision.recordedAt)).toLocaleString(
                      'ru-RU',
                    )}
                  </time>
                </div>
              ))}
            </section>
            <section className={styles.card}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>ЖУРНАЛ ДОСТУПА</p>
                  <h2>Аудит</h2>
                </div>
              </div>
              {auditError && <p className={styles.muted}>{auditError}</p>}
              {auditRows.map((row) => (
                <div className={styles.compactRow} key={String(row.id)}>
                  <span>
                    <strong>{String(row.action)}</strong>
                    <small>
                      {(row.changedFieldNames as string[] | undefined)?.join(
                        ', ',
                      ) ?? ''}
                    </small>
                  </span>
                  <time>
                    {new Date(String(row.createdAt)).toLocaleString('ru-RU')}
                  </time>
                </div>
              ))}
            </section>
          </div>
        </div>
      )}

      {view === 'offers' && (
        <div className={styles.grid}>
          <form className={styles.card} onSubmit={createOffer}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>НОВАЯ РЕДАКЦИЯ</p>
                <h2>Добавить предложение</h2>
              </div>
            </div>
            <label>
              Поставщик
              <select name="supplierId" required>
                <option value="">Выберите поставщика</option>
                {suppliers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.legalName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Бренд
              <select name="brandId">
                <option value="">Не указан</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.twoColumns}>
              <label>
                Производитель
                <input maxLength={200} name="manufacturerName" />
              </label>
              <label>
                Оригинальный артикул
                <input maxLength={160} name="originalPartNumber" />
              </label>
            </div>
            <div className={styles.twoColumns}>
              <label>
                Модификация
                <input maxLength={160} name="modification" />
              </label>
              <label>
                Статус модификации
                <select name="modificationEvidence">
                  <option value="CONFIRMED_NONE">
                    Подтверждено: без модификации
                  </option>
                  <option value="SPECIFIED">Указана модификация</option>
                  <option value="UNKNOWN">Неизвестно</option>
                </select>
              </label>
            </div>
            <div className={styles.twoColumns}>
              <label>
                Закупочная стоимость
                <input
                  inputMode="decimal"
                  name="purchaseCost"
                  pattern="(?:[1-9][0-9]*(?:\.[0-9]*[1-9])?|0\.[0-9]*[1-9])"
                  placeholder="Без стоимости — оставить пустым"
                />
              </label>
              <label>
                Валюта
                <select name="currency">
                  <option value="">Не указана</option>
                  <option>RUB</option>
                  <option>CNY</option>
                  <option>USD</option>
                  <option>EUR</option>
                </select>
              </label>
            </div>
            <div className={styles.twoColumns}>
              <label>
                Артикул поставщика
                <input maxLength={160} name="supplierPartNumber" />
              </label>
              <label>
                Название предложения
                <input maxLength={240} name="offerName" />
              </label>
              <label>
                Наличие
                <input maxLength={500} name="availabilityText" />
              </label>
              <label>
                Срок поставки
                <input maxLength={160} name="leadTimeText" />
              </label>
            </div>
            <label>
              URL источника
              <input maxLength={2048} name="sourceUrl" type="url" />
            </label>
            <button
              className={styles.primary}
              disabled={busy || suppliers.length === 0}
              type="submit"
            >
              Сохранить предложение
            </button>
          </form>
          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>ВНУТРЕННИЙ РЕЕСТР</p>
                <h2>Предложения</h2>
              </div>
              <button
                className={styles.secondary}
                onClick={() => void loadWorkspace()}
                type="button"
              >
                Обновить
              </button>
            </div>
            {offers.map((offer) => (
              <article className={styles.offerRow} key={offer.id}>
                <div>
                  <strong>{String(offer.supplierName)}</strong>
                  <small>
                    {String(
                      offer.currentRevision.manufacturerName ??
                        'Производитель не указан',
                    )}{' '}
                    ·{' '}
                    {String(
                      offer.currentRevision.originalPartNumber ??
                        'Артикул не указан',
                    )}
                  </small>
                  <small>
                    {String(
                      offer.currentRevision.availabilityText ??
                        'Наличие не указано',
                    )}{' '}
                    ·{' '}
                    {String(
                      offer.currentRevision.leadTimeText ?? 'Срок не указан',
                    )}
                  </small>
                </div>
                <div className={styles.offerCost}>
                  <strong>
                    {String(offer.currentRevision.purchaseCost ?? 'По запросу')}
                  </strong>
                  <small>{String(offer.currentRevision.currency ?? '')}</small>
                  <small>
                    {String(offer.freshness ?? '')} ·{' '}
                    {String(offer.matchStatus ?? '')}
                  </small>
                </div>
                <div className={styles.inlineActions}>
                  <Link
                    className={styles.textLink}
                    href={`/staff/suppliers/matches?offerId=${offer.id}`}
                  >
                    Связи
                  </Link>
                  <button
                    className={styles.dangerSmall}
                    disabled={busy || offer.state !== 'ACTIVE'}
                    onClick={() => void archiveOffer(offer)}
                    type="button"
                  >
                    Архив
                  </button>
                </div>
              </article>
            ))}
            {offers.length === 0 && (
              <p className={styles.muted}>Предложений пока нет.</p>
            )}
          </section>
        </div>
      )}

      {view === 'matches' && (
        <div className={styles.stack}>
          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>ТОЛЬКО РУЧНЫЕ РЕШЕНИЯ</p>
                <h2>Выберите предложение</h2>
              </div>
              <button
                className={styles.secondary}
                onClick={() => void loadWorkspace()}
                type="button"
              >
                Обновить
              </button>
            </div>
            <label>
              Предложение поставщика
              <select
                onChange={(event) => setSelectedOfferId(event.target.value)}
                value={selectedOfferId}
              >
                <option value="">Выберите предложение</option>
                {offers.map((offer) => (
                  <option key={offer.id} value={offer.id}>
                    {offer.supplierName} ·{' '}
                    {String(
                      offer.currentRevision.originalPartNumber ??
                        offer.currentRevision.offerName ??
                        offer.id,
                    )}
                  </option>
                ))}
              </select>
            </label>
            {currentOffer && (
              <div className={styles.offerSummary}>
                <div>
                  <strong>{String(currentOffer.supplierName)}</strong>
                  <span>
                    {String(
                      currentOffer.currentRevision.manufacturerName ?? '',
                    )}{' '}
                    ·{' '}
                    {String(
                      currentOffer.currentRevision.originalPartNumber ?? '',
                    )}
                  </span>
                </div>
                <span className={styles.state}>
                  {String(currentOffer.matchStatus ?? 'UNMATCHED')}
                </span>
                <span>
                  {String(
                    currentOffer.currentRevision.purchaseCost ?? 'Без цены',
                  )}{' '}
                  {String(currentOffer.currentRevision.currency ?? '')}
                </span>
                {currentOffer.currentMatchProposalId && (
                  <button
                    className={styles.dangerSmall}
                    disabled={busy}
                    onClick={() => void unlinkMatch()}
                    type="button"
                  >
                    Снять связь
                  </button>
                )}
              </div>
            )}
          </section>
          {currentOffer && (
            <section className={styles.card}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>СТРОГОЕ СОВПАДЕНИЕ</p>
                  <h2>Точные кандидаты</h2>
                </div>
                <span className={styles.muted}>Без автосвязей и аналогов</span>
              </div>
              {candidates.length === 0 ? (
                <p className={styles.muted}>
                  Совпадений по полному идентификатору нет. Проверьте бренд,
                  производителя, артикул и модификацию.
                </p>
              ) : (
                candidates.map((candidate) => {
                  const pending = proposals.some(
                    (proposal) =>
                      proposal.offerId === currentOffer.id &&
                      proposal.productId === candidate.productId &&
                      proposal.state === 'PENDING',
                  );
                  return (
                    <article
                      className={styles.candidateRow}
                      key={candidate.productId}
                    >
                      <div>
                        <strong>
                          {candidate.manufacturerName} ·{' '}
                          {candidate.originalPartNumber}
                        </strong>
                        <small>
                          {String(candidate.modification ?? 'Без модификации')}{' '}
                          · {String(candidate.identityEvidenceKind)}
                        </small>
                        <small>Каталог: {candidate.productId}</small>
                      </div>
                      <button
                        className={pending ? styles.secondary : styles.primary}
                        disabled={busy || pending}
                        onClick={() => void proposeMatch(candidate)}
                        type="button"
                      >
                        {pending ? 'Ожидает решения' : 'Предложить связь'}
                      </button>
                    </article>
                  );
                })
              )}
            </section>
          )}
          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>ИСТОРИЯ РЕШЕНИЙ</p>
                <h2>Предложения связи</h2>
              </div>
            </div>
            {proposals
              .filter(
                (proposal) =>
                  !selectedOfferId || proposal.offerId === selectedOfferId,
              )
              .map((proposal) => (
                <article className={styles.proposalRow} key={proposal.id}>
                  <div>
                    <strong>
                      {String(proposal.state)} · {proposal.productId}
                    </strong>
                    <small>
                      {proposal.id} · версия {proposal.version}
                    </small>
                    <small>
                      {proposal.decisionReasonCode
                        ? String(proposal.decisionReasonCode)
                        : 'Ожидает решения сотрудника'}
                    </small>
                  </div>
                  {proposal.state === 'PENDING' && (
                    <div className={styles.inlineActions}>
                      <button
                        className={styles.primary}
                        disabled={busy || !currentOffer}
                        onClick={() => void decideProposal(proposal, 'APPROVE')}
                        type="button"
                      >
                        Подтвердить
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={busy || !currentOffer}
                        onClick={() => void decideProposal(proposal, 'REJECT')}
                        type="button"
                      >
                        Отклонить
                      </button>
                    </div>
                  )}
                  {proposal.currentForOffer && (
                    <span className={styles.state}>Текущая связь</span>
                  )}
                </article>
              ))}
            {proposals.filter(
              (proposal) =>
                !selectedOfferId || proposal.offerId === selectedOfferId,
            ).length === 0 && (
              <p className={styles.muted}>История решений пуста.</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
