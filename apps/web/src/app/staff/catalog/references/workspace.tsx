'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { auth, catalog, mutate, request, StaffRequestError } from './api';
import {
  categoryTree,
  type Category,
  type Kind,
  type Reference,
} from './model';
import ReferenceEditor from './editor';
import { useReferencePages } from './use-reference-pages';
import styles from '../imports/workspace.module.css';
import layout from './references.module.css';

const sections = [
  {
    kind: 'categories',
    label: 'Категории',
    permission: 'catalog.categories.write',
  },
  { kind: 'brands', label: 'Бренды', permission: 'catalog.brands.write' },
  {
    kind: 'attributes',
    label: 'Характеристики',
    permission: 'catalog.attributes.write',
  },
] as const;
type Session = { permissions: string[]; passwordChangeRequired: boolean };

export default function ReferencesWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [kind, setKind] = useState<Kind>('categories');
  const [categoryId, setCategoryId] = useState('');
  const [pinnedCategory, setPinnedCategory] = useState<Category | null>(null);
  const [selected, setSelected] = useState<Reference | null>(null);
  const [editing, setEditing] = useState(false);
  const [editorKey, resetEditor] = useState(0);
  const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const read =
    session?.permissions.includes('catalog.references.read') ?? false;
  const section = sections.find((item) => item.kind === kind)!;
  const writable = session?.permissions.includes(section.permission) ?? false;
  const categories = useReferencePages<Reference>(
    read && kind !== 'brands' ? catalog + '/categories' : null,
  );
  const brands = useReferencePages<Reference>(
    read && kind === 'brands' ? catalog + '/brands' : null,
  );
  const attributes = useReferencePages<Reference>(
    read && kind === 'attributes' && categoryId
      ? catalog + '/attributes?' + new URLSearchParams({ categoryId })
      : null,
  );
  const pages =
    kind === 'categories'
      ? categories
      : kind === 'brands'
        ? brands
        : attributes;
  const categoryItems = categories.items as Category[];
  const chosenCategory =
    categoryItems.find((item) => item.id === categoryId) ?? pinnedCategory;
  const tree = categoryTree(categoryItems);

  useEffect(() => {
    const controller = new AbortController();
    void request<{ data: Session }>(auth + '/me/permissions', {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted) setSession(data);
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          !(error instanceof StaffRequestError && error.status === 401)
        )
          setError(
            error instanceof Error
              ? error.message
              : 'Не удалось проверить сессию.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function discardAllowed() {
    return !dirty || window.confirm('Сбросить несохранённые изменения?');
  }

  function open(record: Reference | null, show = true) {
    setSelected(record);
    setEditing(show);
    setDirty(false);
    setConflict(false);
    setError('');
    setNotice('');
    resetEditor((value) => value + 1);
    if (show) editorHeading.current?.focus();
  }

  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await operation();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Операция не выполнена.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      await mutate(auth + '/login', 'POST', {
        email: data.get('email'),
        password: data.get('password'),
      });
      form.reset();
      setSession(
        (await request<{ data: Session }>(auth + '/me/permissions')).data,
      );
    });
  }

  function save(body: unknown, archive = false) {
    void run(async () => {
      try {
        const path =
          catalog +
          '/' +
          kind +
          (selected ? '/' + selected.id : '') +
          (archive ? '/archive' : '');
        const { data: result } = await mutate<{ id: string; version: number }>(
          path,
          selected && !archive ? 'PATCH' : 'POST',
          body,
        );
        open(null, false);
        setNotice(archive ? 'Запись архивирована.' : 'Запись сохранена.');
        const { data } = await request<{ data: Reference }>(
          catalog + '/' + kind + '/' + result.id,
        );
        pages.upsert(data);
        open(data);
        setNotice(archive ? 'Запись архивирована.' : 'Запись сохранена.');
      } catch (error) {
        if (
          selected &&
          error instanceof StaffRequestError &&
          error.status === 409
        )
          setConflict(true);
        throw error;
      }
    });
  }

  function openCurrent(id: string) {
    void run(async () => {
      const { data } = await request<{ data: Reference }>(
        catalog + '/' + kind + '/' + id,
      );
      pages.upsert(data);
      open(data);
    });
  }

  const term = query.trim().toLocaleLowerCase('ru');
  const rows =
    kind === 'categories'
      ? tree
      : pages.items.map((item) => ({
          item,
          depth: 0,
          path: 'name' in item ? item.name : item.label,
        }));
  const matches = rows.filter(({ item, path }) =>
    [path, 'slug' in item ? item.slug : item.code].some((value) =>
      value.toLocaleLowerCase('ru').includes(term),
    ),
  );
  const canCreate =
    writable &&
    !pages.loading &&
    !pages.error &&
    (kind !== 'attributes' || chosenCategory?.state === 'ACTIVE');

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>SHOP-STDU · РАБОЧЕЕ МЕСТО</p>
          <h1>Справочники каталога</h1>
          <p>Категории, бренды и определения характеристик.</p>
        </div>
        <nav className={layout.actions} aria-label="Навигация каталога">
          <Link
            href="/staff/catalog/imports"
            onNavigate={(event) => {
              if (!discardAllowed()) event.preventDefault();
            }}
          >
            Импорт каталога
          </Link>
          {session && (
            <button
              disabled={busy}
              type="button"
              onClick={() => {
                if (!discardAllowed()) return;
                void run(async () => {
                  await mutate(auth + '/logout', 'POST', {});
                  open(null, false);
                  setSession(null);
                  setCategoryId('');
                  setPinnedCategory(null);
                });
              }}
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
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              Войти
            </button>
          </form>
        </section>
      ) : !read ? (
        <p className={styles.panel} role="status">
          {session.passwordChangeRequired
            ? 'Для доступа сначала смените пароль сотрудника.'
            : 'У вашей роли нет доступа к справочникам каталога.'}
        </p>
      ) : (
        <>
          <nav className={layout.tabs} aria-label="Справочники">
            {sections.map((item) => (
              <button
                key={item.kind}
                type="button"
                aria-pressed={kind === item.kind}
                disabled={busy}
                onClick={() => {
                  if (kind === item.kind || !discardAllowed()) return;
                  open(null, false);
                  setQuery('');
                  setKind(item.kind);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className={layout.workspace}>
            <section className={styles.panel} aria-labelledby="references-list">
              <div className={layout.actions}>
                <h2 id="references-list">{section.label}</h2>
                {canCreate && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (discardAllowed()) open(null);
                    }}
                  >
                    Новая запись
                  </button>
                )}
              </div>
              <div className={styles.form}>
                {kind === 'attributes' && (
                  <label>
                    Категория
                    <select
                      value={categoryId}
                      disabled={busy}
                      onChange={(event) => {
                        if (!discardAllowed()) return;
                        const id = event.target.value;
                        open(null, false);
                        setCategoryId(id);
                        setPinnedCategory(
                          categoryItems.find((item) => item.id === id) ?? null,
                        );
                      }}
                    >
                      <option value="">Выберите категорию</option>
                      {chosenCategory &&
                        !categoryItems.some(
                          (item) => item.id === chosenCategory.id,
                        ) && (
                          <option value={chosenCategory.id}>
                            {chosenCategory.name}
                          </option>
                        )}
                      {tree.map(({ item, path }) => (
                        <option key={item.id} value={item.id}>
                          {path}
                          {item.state === 'ARCHIVED' ? ' · архив' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Поиск по загруженным записям
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
              {kind === 'attributes' && (
                <PageControls page={categories} label="категории" busy={busy} />
              )}
              {kind === 'categories' &&
                (categories.cursor || categories.windowed) && (
                  <p>
                    Показана часть дерева. Вложенность видна, когда загружена
                    родительская категория.
                  </p>
                )}
              {kind === 'attributes' && !categoryId ? (
                <p>Выберите категорию, чтобы увидеть характеристики.</p>
              ) : pages.loading && !pages.items.length ? (
                <p role="status">Загрузка записей…</p>
              ) : matches.length ? (
                <ul className={layout.rows}>
                  {matches.map(({ item, path, depth }) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={busy}
                        aria-current={
                          selected?.id === item.id ? 'true' : undefined
                        }
                        style={{
                          paddingInlineStart:
                            0.75 + Math.min(depth, 5) * 0.7 + 'rem',
                        }}
                        onClick={() => {
                          if (selected?.id !== item.id && discardAllowed())
                            openCurrent(item.id);
                        }}
                      >
                        <strong>
                          {'name' in item ? item.name : item.label}
                        </strong>
                        <small>
                          {depth > 0 ? path + ' · ' : ''}
                          {'parentId' in item && item.parentId && depth === 0
                            ? 'Родитель вне загруженной части · '
                            : ''}
                          {'slug' in item ? item.slug : item.code}
                          {'valueType' in item ? ' · ' + item.valueType : ''}
                        </small>
                        {item.state === 'ARCHIVED' && (
                          <span className={layout.archive}>Архив</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                !pages.error && <p>В загруженной части записи не найдены.</p>
              )}
              <PageControls
                page={pages}
                label={section.label.toLocaleLowerCase('ru')}
                busy={busy}
              />
            </section>
            <section
              className={styles.panel}
              aria-labelledby="references-editor"
            >
              <h2 id="references-editor" ref={editorHeading} tabIndex={-1}>
                {editing
                  ? selected
                    ? 'Карточка записи'
                    : 'Новая запись'
                  : 'Детали записи'}
              </h2>
              {editing ? (
                <>
                  {conflict && selected && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!discardAllowed()) return;
                        openCurrent(selected.id);
                      }}
                    >
                      Загрузить актуальную запись
                    </button>
                  )}
                  <ReferenceEditor
                    key={editorKey}
                    kind={kind}
                    record={selected}
                    categoryId={categoryId}
                    tree={tree}
                    categoryPaging={
                      kind === 'categories' ? (
                        <PageControls
                          page={categories}
                          label="категории"
                          busy={busy}
                        />
                      ) : null
                    }
                    busy={busy}
                    writable={selected ? writable : canCreate}
                    onDirty={setDirty}
                    onSave={(body) => save(body)}
                    onArchive={() => {
                      if (
                        selected &&
                        !dirty &&
                        window.confirm('Архивировать эту запись?')
                      )
                        save({ expectedVersion: selected.version }, true);
                    }}
                  />
                </>
              ) : (
                <p>Выберите запись из списка.</p>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function PageControls({
  page,
  label,
  busy,
}: {
  page: {
    loading: boolean;
    error: string;
    cursor: string | null;
    windowed: boolean;
    more: () => void;
    restart: () => void;
  };
  label: string;
  busy: boolean;
}) {
  if (!page.error && !page.cursor && !page.windowed) return null;
  return (
    <div className={layout.actions}>
      {page.error && (
        <p role="alert" className={styles.error}>
          {page.error}
        </p>
      )}
      {page.windowed && (
        <small>
          Показано до 250 последних загруженных записей. Поиск действует только
          в этой части.
        </small>
      )}
      {(page.cursor || page.error) && (
        <button
          type="button"
          disabled={busy || page.loading}
          onClick={page.more}
        >
          {page.error ? 'Повторить загрузку' : 'Загрузить ещё'} · {label}
        </button>
      )}
      {page.windowed && (
        <button
          type="button"
          disabled={busy || page.loading}
          onClick={page.restart}
        >
          С начала · {label}
        </button>
      )}
    </div>
  );
}
