'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  auth,
  catalog,
  mutate,
  readAll,
  request,
  RequestError,
  type Brand,
  type Category,
  type Detail,
  type PermissionSet,
  type Product,
  type Revision,
} from './api';
import ProductEditor from './editor';
import styles from '../imports/workspace.module.css';
import layout from './products.module.css';

const labels = {
  DRAFT: 'Черновик',
  PENDING_REVIEW: 'На проверке',
  PUBLISHED: 'Опубликован',
  ARCHIVED: 'Архив',
};

function RevisionSummary({ revision }: { revision: Revision }) {
  return (
    <>
      <h3>{revision.displayName}</h3>
      <dl className={layout.facts}>
        <dt>Редакция</dt>
        <dd>{revision.revisionNo}</dd>
        <dt>Категория</dt>
        <dd>{revision.categoryNameSnapshot}</dd>
        <dt>Бренд</dt>
        <dd>{revision.brandNameSnapshot ?? '—'}</dd>
        <dt>Производитель</dt>
        <dd>{revision.manufacturerNameSnapshot ?? '—'}</dd>
        <dt>Артикул</dt>
        <dd>{revision.originalPartNumberSnapshot ?? '—'}</dd>
        {revision.modificationSnapshot && (
          <>
            <dt>Модификация</dt>
            <dd>{revision.modificationSnapshot}</dd>
          </>
        )}
      </dl>
      {revision.summary && <p>{revision.summary}</p>}
      {revision.description && (
        <p className={layout.description}>{revision.description}</p>
      )}
      {revision.attributes.length > 0 && (
        <dl className={layout.facts}>
          {revision.attributes.map((item) => (
            <div key={item.attributeCode}>
              <dt>{item.label}</dt>
              <dd>
                {typeof item.value === 'object'
                  ? item.value.label
                  : typeof item.value === 'boolean'
                    ? item.value
                      ? 'Да'
                      : 'Нет'
                    : item.value}{' '}
                {item.unitLabel}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

export default function CatalogProductsWorkspace() {
  const [session, setSession] = useState<PermissionSet | null>(null);
  const [checking, setChecking] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);
  const [staleId, setStaleId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const can = (permission: string) => session?.permissions.includes(permission);
  const read = can('catalog.products.read');
  const edit =
    read && can('catalog.products.write') && can('catalog.references.read');

  useEffect(() => {
    const controller = new AbortController();
    void request<{ data: PermissionSet }>(auth + '/me/permissions', {
      signal: controller.signal,
    })
      .then(({ data }) => setSession(data))
      .catch((error) => {
        if (
          !controller.signal.aborted &&
          !(error instanceof RequestError && error.status === 401)
        )
          setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!read) return;
    const controller = new AbortController();
    void readAll<Product>(catalog + '/products', controller.signal)
      .then(setProducts)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [read]);

  useEffect(() => {
    if (!edit) return;
    const controller = new AbortController();
    void Promise.all([
      readAll<Category>(catalog + '/categories', controller.signal),
      readAll<Brand>(catalog + '/brands', controller.signal),
    ])
      .then(([nextCategories, nextBrands]) => {
        setCategories(nextCategories);
        setBrands(nextBrands);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [edit]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Операция не выполнена.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await run(async () => {
      await mutate(auth + '/login', 'POST', {
        email: data.get('email'),
        password: data.get('password'),
      });
      form.reset();
      setSession(
        (await request<{ data: PermissionSet }>(auth + '/me/permissions')).data,
      );
    });
  }

  async function open(id: string) {
    const { data } = await request<{ data: Detail }>(
      catalog + '/products/' + id,
    );
    setSelected(data);
    setCreating(false);
    setStaleId(null);
  }

  async function command(
    path: string,
    method: 'POST' | 'PATCH',
    data: unknown,
    message: string,
  ) {
    await run(async () => {
      const response = await mutate<{ id: string }>(
        catalog + '/products' + path,
        method,
        data,
      );
      // The command has committed. Prevent a second write until the new version is loaded.
      const id = selected?.id ?? response.data.id;
      setStaleId(id);
      setNotice(message);
      await open(id);
      setProducts(await readAll<Product>(catalog + '/products'));
    });
  }

  const query = search.trim().toLocaleLowerCase();
  const rows = products.filter(
    (item) =>
      (!state || item.publicationState === state) &&
      [item.slug, item.originalPartNumber, item.manufacturerName].some(
        (value) => value?.toLocaleLowerCase().includes(query),
      ),
  );
  const revision =
    selected?.pendingRevision ??
    selected?.editorRevision ??
    selected?.publishedRevision;
  const pending = selected?.pendingRevision;
  const draft = selected?.editorRevision;
  const locked = busy || Boolean(staleId);
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>SHOP-STDU · РАБОЧЕЕ МЕСТО</p>
          <h1>Управление товарами</h1>
        </div>
        <nav className={layout.actions} aria-label="Рабочее место каталога">
          <Link href="/staff/catalog/imports">Импорт</Link>
          <Link href="/catalog">Публичный каталог</Link>
          {session && (
            <button
              disabled={busy}
              type="button"
              onClick={() =>
                void run(async () => {
                  await mutate(auth + '/logout', 'POST', {});
                  setSession(null);
                  setSelected(null);
                  setCreating(false);
                  setProducts([]);
                  setStaleId(null);
                  setCategories([]);
                  setBrands([]);
                })
              }
            >
              Выйти
            </button>
          )}
        </nav>
      </header>
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
          <form className={styles.form} onSubmit={login}>
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button disabled={busy} type="submit">
              Войти
            </button>
          </form>
        </section>
      ) : !read ? (
        <p className={styles.panel} role="status">
          {session.passwordChangeRequired
            ? 'Для доступа сначала смените пароль сотрудника.'
            : 'У вашей роли нет доступа к просмотру товаров.'}
        </p>
      ) : (
        <div className={layout.workspace}>
          <section
            className={styles.panel}
            aria-labelledby="product-list-heading"
          >
            <div className={layout.actions}>
              <h2 id="product-list-heading">Товары</h2>
              {edit && (
                <button
                  disabled={locked}
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setCreating(true);
                    setError('');
                    setNotice('');
                  }}
                >
                  Новый товар
                </button>
              )}
            </div>
            <div className={styles.form}>
              <label>
                Поиск по артикулу, производителю или URL-идентификатору
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                Статус
                <select
                  value={state}
                  onChange={(event) => setState(event.target.value)}
                >
                  <option value="">Все статусы</option>
                  {Object.entries(labels).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy}
                type="button"
                onClick={() =>
                  void run(async () => {
                    setProducts(await readAll<Product>(catalog + '/products'));
                    if (staleId) await open(staleId);
                  })
                }
              >
                Обновить список
              </button>
            </div>
            {rows.length ? (
              <ul className={layout.rows}>
                {rows.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={
                        selected?.id === item.id ? 'true' : undefined
                      }
                      disabled={busy}
                      onClick={() => void run(() => open(item.id))}
                    >
                      <strong>{item.originalPartNumber || item.slug}</strong>
                      <span>{item.slug}</span>
                      <span>
                        {labels[item.publicationState]}
                        {item.publicationState === 'PUBLISHED' &&
                        item.pendingRevisionId
                          ? ' · новая редакция на проверке'
                          : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Товары не найдены.</p>
            )}
          </section>
          <section
            className={styles.panel}
            aria-labelledby="product-detail-heading"
          >
            <h2 id="product-detail-heading">
              {creating
                ? 'Новый товар'
                : selected
                  ? 'Карточка товара'
                  : 'Редактор'}
            </h2>
            {creating && edit ? (
              <ProductEditor
                product={null}
                categories={categories}
                brands={brands}
                busy={locked}
                save={(data) =>
                  void command('', 'POST', data, 'Черновик создан.')
                }
              />
            ) : selected ? (
              <>
                <p>
                  <code>{selected.slug}</code> ·{' '}
                  {labels[selected.publicationState]}
                </p>
                {revision && <RevisionSummary revision={revision} />}
                {edit && draft && !pending && (
                  <details className={layout.editor} open>
                    <summary>Редактировать черновик</summary>
                    <ProductEditor
                      key={draft.id}
                      product={selected}
                      categories={categories}
                      brands={brands}
                      busy={locked}
                      save={(data) =>
                        void command(
                          '/' + selected.id,
                          'PATCH',
                          data,
                          'Изменения сохранены.',
                        )
                      }
                    />
                  </details>
                )}
                <div className={layout.actions}>
                  {draft && !pending && can('catalog.products.submit') && (
                    <button
                      disabled={locked}
                      type="button"
                      onClick={() =>
                        void command(
                          '/' + selected.id + '/submit',
                          'POST',
                          { expectedVersion: selected.version },
                          'Редакция отправлена на проверку.',
                        )
                      }
                    >
                      Отправить на проверку
                    </button>
                  )}
                  {pending && can('catalog.products.publish') && (
                    <button
                      disabled={locked}
                      type="button"
                      onClick={() =>
                        void command(
                          '/' + selected.id + '/review',
                          'POST',
                          {
                            expectedVersion: selected.version,
                            revisionId: pending.id,
                            decision: 'PUBLISH',
                          },
                          'Редакция опубликована.',
                        )
                      }
                    >
                      Опубликовать редакцию {pending.revisionNo}
                    </button>
                  )}
                  {selected.publishedRevision && (
                    <Link
                      href={
                        '/catalog/product/' + encodeURIComponent(selected.slug)
                      }
                    >
                      Публичная карточка
                    </Link>
                  )}
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() => void run(() => open(selected.id))}
                  >
                    Обновить карточку
                  </button>
                </div>
              </>
            ) : (
              <p>Выберите товар из списка или создайте черновик.</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
