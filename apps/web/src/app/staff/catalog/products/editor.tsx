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

function draftFields(product: Detail | null) {
  const revision = product?.editorRevision;
  return {
    slug: '',
    categoryId: revision?.categoryId ?? '',
    brandId: revision?.brandId ?? '',
    displayName: revision?.displayName ?? '',
    manufacturerName: revision?.manufacturerNameSnapshot ?? '',
    originalPartNumber: revision?.originalPartNumberSnapshot ?? '',
    modification: revision?.modificationSnapshot ?? '',
    summary: revision?.summary ?? '',
    description: revision?.description ?? '',
  };
}

type Fields = ReturnType<typeof draftFields>;
const fieldLabels: Record<keyof Fields, string> = {
  slug: 'URL-идентификатор',
  categoryId: 'Категория',
  brandId: 'Бренд',
  displayName: 'Название',
  manufacturerName: 'Производитель',
  originalPartNumber: 'Артикул',
  modification: 'Модификация',
  summary: 'Краткое описание',
  description: 'Описание',
};
const fieldKeys = Object.keys(fieldLabels) as (keyof Fields)[];
export type DraftInput = {
  fields: Partial<Fields>;
  attributes: Array<{ label: string; value: string }>;
};

function draftAttributes(product: Detail | null): Record<string, string> {
  return Object.fromEntries(
    (product?.editorRevision?.attributes ?? []).map(
      ({ attributeCode, value }) => [
        attributeCode,
        typeof value === 'object' ? value.code : String(value),
      ],
    ),
  );
}

export function LocalDraft({
  input,
  categories,
  brands,
}: {
  input: DraftInput;
  categories: Category[];
  brands: Brand[];
}) {
  return (
    <details open>
      <summary>Мои несохранённые данные</summary>
      <p>Скопируйте нужные значения в актуальный черновик перед сохранением.</p>
      <dl className={layout.facts}>
        {fieldKeys
          .filter((key) => input.fields[key] !== undefined)
          .map((key) => (
            <div key={key}>
              <dt>{fieldLabels[key]}</dt>
              <dd className={layout.description}>
                {(key === 'categoryId'
                  ? (categories.find(
                      (item) => item.id === input.fields.categoryId,
                    )?.name ?? input.fields[key])
                  : key === 'brandId'
                    ? (brands.find((item) => item.id === input.fields.brandId)
                        ?.name ?? input.fields[key])
                    : input.fields[key]) || '—'}
              </dd>
            </div>
          ))}
        {input.attributes.map((item, index) => (
          <div key={index}>
            <dt>{item.label}</dt>
            <dd>{item.value || '—'}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export default function ProductEditor({
  product,
  categories,
  brands,
  busy,
  save,
  onDirty,
  onTransfer,
  conflict = false,
}: {
  product: Detail | null;
  categories: Category[];
  brands: Brand[];
  busy: boolean;
  save: (data: unknown) => void;
  onDirty: (dirty: boolean) => void;
  onTransfer?: (input: DraftInput) => void;
  conflict?: boolean;
}) {
  const revision = product?.editorRevision;
  const baseline = draftFields(product);
  const [fields, setFields] = useState(baseline);
  const categoryId = fields.categoryId;
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [loadedCategory, setLoadedCategory] = useState('');
  const [loadError, setLoadError] = useState('');
  const [attempt, retry] = useState(0);
  const originalValues = draftAttributes(product);
  const [values, setValues] = useState(originalValues);
  const attributesChanged =
    categoryId !== baseline.categoryId ||
    Array.from(
      new Set([...Object.keys(values), ...Object.keys(originalValues)]),
    ).some((key) => (values[key] ?? '') !== (originalValues[key] ?? ''));

  function update(nextFields: Fields, nextValues: Record<string, string>) {
    setFields(nextFields);
    setValues(nextValues);
    onDirty(
      fieldKeys.some((key) => nextFields[key] !== baseline[key]) ||
        Array.from(
          new Set([...Object.keys(nextValues), ...Object.keys(originalValues)]),
        ).some(
          (key) => (nextValues[key] ?? '') !== (originalValues[key] ?? ''),
        ),
    );
  }

  function fieldProps(key: keyof Fields) {
    return {
      name: key,
      value: fields[key],
      onChange: (
        event: React.ChangeEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >,
      ) => update({ ...fields, [key]: event.target.value }, values),
    };
  }

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
    if (!ready || busy || conflict || onTransfer) return;
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
        : { slug: nullable(fields.slug) }),
      ...(!identityLocked
        ? {
            brandId: nullable(fields.brandId),
            manufacturerName: nullable(fields.manufacturerName),
            originalPartNumber: nullable(fields.originalPartNumber),
            modification: nullable(fields.modification),
          }
        : {}),
      categoryId,
      displayName: nullable(fields.displayName),
      summary: nullable(fields.summary),
      description: nullable(fields.description),
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
              {...fieldProps('slug')}
              required
              maxLength={160}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="test-control-module"
            />
          </label>
        )}
        <label>
          Название
          <input {...fieldProps('displayName')} required maxLength={240} />
        </label>
        <label>
          Категория
          <select
            required
            value={categoryId}
            onChange={(event) => {
              update(
                { ...fields, categoryId: event.target.value },
                event.target.value === baseline.categoryId
                  ? originalValues
                  : {},
              );
              setLoadedCategory('');
              setLoadError('');
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
          <select {...fieldProps('brandId')} disabled={identityLocked}>
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
            {...fieldProps('manufacturerName')}
            maxLength={200}
            disabled={identityLocked}
          />
        </label>
        <label>
          Артикул
          <input
            {...fieldProps('originalPartNumber')}
            maxLength={160}
            disabled={identityLocked}
          />
        </label>
        <label>
          Модификация
          <input
            {...fieldProps('modification')}
            maxLength={160}
            disabled={identityLocked}
          />
        </label>
        <label>
          Краткое описание
          <textarea {...fieldProps('summary')} maxLength={500} />
        </label>
        <label className={layout.fullWidth}>
          Описание
          <textarea {...fieldProps('description')} maxLength={12000} />
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
                  update(fields, { ...values, [item.code]: next });
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
      <div className={layout.actions}>
        {onTransfer && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const codes = new Set([
                ...Object.keys(values),
                ...Object.keys(originalValues),
              ]);
              onTransfer({
                fields: Object.fromEntries(
                  fieldKeys
                    .filter((key) => fields[key] !== baseline[key])
                    .map((key) => [key, fields[key]]),
                ),
                attributes: Array.from(codes)
                  .filter((code) =>
                    categoryId !== baseline.categoryId
                      ? Boolean(values[code])
                      : (values[code] ?? '') !== (originalValues[code] ?? ''),
                  )
                  .map((code) => {
                    const definition =
                      loadedCategory === categoryId
                        ? definitions.find((item) => item.code === code)
                        : undefined;
                    const value = values[code] ?? '';
                    return {
                      label: definition?.label ?? code,
                      value:
                        definition?.enumOptions?.find(
                          (option) => option.code === value,
                        )?.label ??
                        (definition?.valueType === 'BOOLEAN' && value
                          ? value === 'true'
                            ? 'Да'
                            : 'Нет'
                          : value),
                    };
                  }),
              });
            }}
          >
            Перенести правки вручную
          </button>
        )}
        <button
          disabled={busy || !ready || conflict || Boolean(onTransfer)}
          type="submit"
        >
          {product ? 'Сохранить изменения' : 'Создать черновик'}
        </button>
      </div>
    </form>
  );
}
