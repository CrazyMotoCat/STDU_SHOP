'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  catalog,
  readAll,
  type Brand,
  type Category,
  type Definition,
  type Detail,
} from './api';
import styles from '../imports/workspace.module.css';
import layout from './products.module.css';

function nullable(value: FormDataEntryValue | null) {
  return String(value ?? '').trim() || null;
}

export default function ProductEditor({
  product,
  categories,
  brands,
  busy,
  save,
}: {
  product: Detail | null;
  categories: Category[];
  brands: Brand[];
  busy: boolean;
  save: (data: unknown) => void;
}) {
  const revision = product?.editorRevision;
  const [categoryId, setCategoryId] = useState(revision?.categoryId ?? '');
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [loadedCategory, setLoadedCategory] = useState('');
  const [loadError, setLoadError] = useState('');
  const [attempt, retry] = useState(0);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (revision?.attributes ?? []).map(({ attributeCode, value }) => [
        attributeCode,
        typeof value === 'object' ? value.code : String(value),
      ]),
    ),
  );
  const [attributesChanged, setAttributesChanged] = useState(false);
  const identityLocked =
    product?.revisionHistory.some((item) => item.submittedAt) ?? false;

  useEffect(() => {
    if (!categoryId) return;
    const controller = new AbortController();
    void readAll<Definition>(
      catalog + '/attributes?' + new URLSearchParams({ categoryId }),
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setDefinitions(data);
        setLoadedCategory(categoryId);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error.message);
      });
    return () => controller.abort();
  }, [categoryId, attempt]);

  const ready =
    Boolean(categoryId) && categoryId === loadedCategory && !loadError;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) return;
    const data = new FormData(event.currentTarget);
    const attributes = definitions.flatMap((definition) => {
      const value = values[definition.code]?.trim();
      if (!value) return [];
      return [
        {
          attributeDefinitionId: definition.id,
          valueType: definition.valueType,
          value:
            definition.valueType === 'INTEGER'
              ? Number(value)
              : definition.valueType === 'BOOLEAN'
                ? value === 'true'
                : definition.valueType === 'ENUM'
                  ? { code: value }
                  : value,
        },
      ];
    });
    save({
      ...(product && revision
        ? { expectedVersion: product.version, baseRevisionId: revision.id }
        : { slug: nullable(data.get('slug')) }),
      ...(!identityLocked
        ? {
            brandId: nullable(data.get('brandId')),
            manufacturerName: nullable(data.get('manufacturerName')),
            originalPartNumber: nullable(data.get('originalPartNumber')),
            modification: nullable(data.get('modification')),
          }
        : {}),
      categoryId,
      displayName: nullable(data.get('displayName')),
      summary: nullable(data.get('summary')),
      description: nullable(data.get('description')),
      ...(!revision || attributesChanged ? { attributes } : {}),
    });
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <fieldset className={layout.fields} disabled={busy}>
        {!product && (
          <label>
            URL-идентификатор
            <input
              name="slug"
              required
              maxLength={160}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="test-control-module"
            />
          </label>
        )}
        <label>
          Название
          <input
            name="displayName"
            required
            maxLength={240}
            defaultValue={revision?.displayName}
          />
        </label>
        <label>
          Категория
          <select
            required
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setLoadedCategory('');
              setLoadError('');
              setValues({});
              setAttributesChanged(true);
            }}
          >
            <option value="">Выберите категорию</option>
            {categories
              .filter(
                (item) =>
                  item.state === 'ACTIVE' || item.id === revision?.categoryId,
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.slug}
                </option>
              ))}
          </select>
        </label>
        <label>
          Бренд
          <select
            name="brandId"
            defaultValue={revision?.brandId ?? ''}
            disabled={identityLocked}
          >
            <option value="">Без бренда</option>
            {brands
              .filter(
                (item) =>
                  item.state === 'ACTIVE' || item.id === revision?.brandId,
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Производитель
          <input
            name="manufacturerName"
            maxLength={200}
            disabled={identityLocked}
            defaultValue={revision?.manufacturerNameSnapshot ?? ''}
          />
        </label>
        <label>
          Артикул
          <input
            name="originalPartNumber"
            maxLength={160}
            disabled={identityLocked}
            defaultValue={revision?.originalPartNumberSnapshot ?? ''}
          />
        </label>
        <label>
          Модификация
          <input
            name="modification"
            maxLength={160}
            disabled={identityLocked}
            defaultValue={revision?.modificationSnapshot ?? ''}
          />
        </label>
        <label>
          Краткое описание
          <textarea
            name="summary"
            maxLength={500}
            defaultValue={revision?.summary ?? ''}
          />
        </label>
        <label className={layout.fullWidth}>
          Описание
          <textarea
            name="description"
            maxLength={12000}
            defaultValue={revision?.description ?? ''}
          />
        </label>
      </fieldset>
      {categoryId && (
        <fieldset className={layout.fields} disabled={busy}>
          <legend>Характеристики</legend>
          {loadError ? (
            <div className={layout.fullWidth}>
              <p role="alert">{loadError}</p>
              <button
                type="button"
                onClick={() => {
                  setLoadError('');
                  retry(attempt + 1);
                }}
              >
                Повторить загрузку
              </button>
            </div>
          ) : !ready ? (
            <p role="status">Загрузка определений…</p>
          ) : null}
          {ready &&
            definitions
              .filter((item) => item.state === 'ACTIVE' || values[item.code])
              .map((item) => {
                const value = values[item.code] ?? '';
                const change = (next: string) => {
                  setValues((previous) => ({ ...previous, [item.code]: next }));
                  setAttributesChanged(true);
                };
                return (
                  <label key={item.id}>
                    {item.label}
                    {item.unitLabel ? `, ${item.unitLabel}` : ''}
                    {item.state === 'ARCHIVED' ? (
                      <span>{value} (архив)</span>
                    ) : item.valueType === 'ENUM' ||
                      item.valueType === 'BOOLEAN' ? (
                      <select
                        value={value}
                        onChange={(event) => change(event.target.value)}
                      >
                        <option value="">Не задано</option>
                        {(item.valueType === 'BOOLEAN'
                          ? [
                              { code: 'true', label: 'Да' },
                              { code: 'false', label: 'Нет' },
                            ]
                          : (item.enumOptions ?? [])
                        ).map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={value}
                        onChange={(event) => change(event.target.value)}
                        inputMode={
                          item.valueType === 'INTEGER'
                            ? 'numeric'
                            : item.valueType === 'DECIMAL'
                              ? 'decimal'
                              : undefined
                        }
                        pattern={
                          item.valueType === 'INTEGER'
                            ? '-?[0-9]+'
                            : item.valueType === 'DECIMAL'
                              ? '-?(0|[1-9][0-9]*)(\\.[0-9]*[1-9])?'
                              : undefined
                        }
                      />
                    )}
                  </label>
                );
              })}
          {ready && !definitions.some((item) => item.state === 'ACTIVE') && (
            <p>Для категории нет действующих определений.</p>
          )}
        </fieldset>
      )}
      <div>
        <button disabled={busy || !ready} type="submit">
          {product ? 'Сохранить изменения' : 'Создать черновик'}
        </button>
      </div>
    </form>
  );
}
