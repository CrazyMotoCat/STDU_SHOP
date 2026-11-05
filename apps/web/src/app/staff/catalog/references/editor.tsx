'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import {
  parseEnumOptions,
  type Attribute,
  type Category,
  type Kind,
  type Reference,
} from './model';
import styles from '../imports/workspace.module.css';
import layout from './references.module.css';

const types = ['TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'ENUM'] as const;
const flags = {
  filterable: 'Фильтрация',
  searchable: 'Поиск',
  comparable: 'Сравнение',
} as const;
const flagKeys = ['filterable', 'searchable', 'comparable'] as const;

export default function ReferenceEditor({
  kind,
  record,
  categoryId,
  tree,
  categoryPaging,
  busy,
  writable,
  onDirty,
  onSave,
  onArchive,
}: {
  kind: Kind;
  record: Reference | null;
  categoryId: string;
  categoryPaging: ReactNode;
  tree: Array<{ item: Category; path: string }>;
  busy: boolean;
  writable: boolean;
  onDirty: (dirty: boolean) => void;
  onSave: (body: unknown) => void;
  onArchive: () => void;
}) {
  const category = kind === 'categories' ? (record as Category | null) : null;
  const attribute = kind === 'attributes' ? (record as Attribute | null) : null;
  const initial = {
    name: record ? ('name' in record ? record.name : record.label) : '',
    code: record ? ('slug' in record ? record.slug : record.code) : '',
    parentId: category?.parentId ?? '',
    description: category?.description ?? '',
    sortOrder: String(category?.sortOrder ?? 0),
    valueType: attribute?.valueType ?? 'TEXT',
    unitCode: attribute?.unitCode ?? '',
    unitLabel: attribute?.unitLabel ?? '',
    options:
      attribute?.enumOptions
        ?.map(({ code, label }) => code + ' = ' + label)
        .join('\n') ?? '',
    filterable: attribute?.filterable ?? false,
    searchable: attribute?.searchable ?? false,
    comparable: attribute?.comparable ?? false,
  };
  const [values, setValues] = useState(initial);
  const [error, setError] = useState('');
  const numeric =
    values.valueType === 'INTEGER' || values.valueType === 'DECIMAL';
  const editable = writable && record?.state !== 'ARCHIVED';
  const changed = JSON.stringify(values) !== JSON.stringify(initial);

  function update<K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) {
    const next = { ...values, [key]: value };
    setValues(next);
    onDirty(JSON.stringify(next) !== JSON.stringify(initial));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || busy || (record && !changed)) return;
    try {
      const name = values.name.trim();
      const version = record ? { expectedVersion: record.version } : {};
      const identity = record ? {} : { slug: values.code.trim() };
      if (kind === 'brands') onSave({ ...version, ...identity, name });
      if (kind === 'categories')
        onSave({
          ...version,
          ...identity,
          name,
          parentId: values.parentId || null,
          description: values.description.trim() || null,
          sortOrder: Number(values.sortOrder),
        });
      if (kind === 'attributes') {
        const unitCode = values.unitCode.trim();
        const unitLabel = values.unitLabel.trim();
        if (!record && numeric && Boolean(unitCode) !== Boolean(unitLabel))
          throw new Error(
            'Заполните код и обозначение единицы измерения либо оставьте оба поля пустыми.',
          );
        onSave({
          ...version,
          label: name,
          filterable: values.filterable,
          searchable: values.searchable,
          comparable: values.comparable,
          ...(!record
            ? {
                categoryId,
                code: values.code.trim(),
                valueType: values.valueType,
                ...(numeric && unitCode ? { unitCode, unitLabel } : {}),
                ...(values.valueType === 'ENUM'
                  ? { enumOptions: parseEnumOptions(values.options) }
                  : {}),
              }
            : {}),
        });
      }
      setError('');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Проверьте поля формы.',
      );
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {record && (
        <p className={layout.meta}>
          {record.state === 'ARCHIVED' ? 'Архив' : 'Активная запись'} · Версия{' '}
          {record.version}
        </p>
      )}
      <fieldset className={layout.fields} disabled={!editable || busy}>
        <label>
          Название
          <input
            required
            maxLength={160}
            value={values.name}
            onChange={(event) => update('name', event.target.value)}
          />
        </label>
        <label>
          {kind === 'attributes' ? 'Код' : 'URL-идентификатор'}
          <input
            required
            readOnly={Boolean(record)}
            maxLength={kind === 'attributes' ? 80 : 120}
            pattern={
              kind === 'attributes'
                ? '[a-z][a-z0-9_]{1,79}'
                : '[a-z0-9]+(-[a-z0-9]+)*'
            }
            value={values.code}
            onChange={(event) => update('code', event.target.value)}
          />
        </label>
        {kind === 'categories' && (
          <>
            <label>
              Родительская категория
              <select
                value={values.parentId}
                onChange={(event) => update('parentId', event.target.value)}
              >
                <option value="">Верхний уровень</option>
                {values.parentId &&
                  !tree.some(({ item }) => item.id === values.parentId) && (
                    <option value={values.parentId}>
                      Текущий родитель вне загруженной части
                    </option>
                  )}
                {tree
                  .filter(
                    ({ item }) =>
                      item.id !== record?.id &&
                      (item.state === 'ACTIVE' || item.id === values.parentId),
                  )
                  .map(({ item, path }) => (
                    <option key={item.id} value={item.id}>
                      {path}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Порядок сортировки
              <input
                type="number"
                min={0}
                max={2147483647}
                step={1}
                required
                value={values.sortOrder}
                onChange={(event) => update('sortOrder', event.target.value)}
              />
            </label>
            <label className={layout.full}>
              Описание
              <textarea
                maxLength={2000}
                value={values.description}
                onChange={(event) => update('description', event.target.value)}
              />
            </label>
          </>
        )}
        {kind === 'attributes' && (
          <>
            <label>
              Тип значения
              <select
                disabled={Boolean(record)}
                value={values.valueType}
                onChange={(event) =>
                  update(
                    'valueType',
                    event.target.value as Attribute['valueType'],
                  )
                }
              >
                {types.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            {numeric && (
              <>
                <label>
                  Код единицы
                  <input
                    readOnly={Boolean(record)}
                    maxLength={32}
                    value={values.unitCode}
                    onChange={(event) => update('unitCode', event.target.value)}
                  />
                </label>
                <label>
                  Обозначение единицы
                  <input
                    readOnly={Boolean(record)}
                    maxLength={48}
                    value={values.unitLabel}
                    onChange={(event) =>
                      update('unitLabel', event.target.value)
                    }
                  />
                </label>
                <p className={layout.full}>
                  Единица необязательна. Код и обозначение заполняются вместе.
                </p>
              </>
            )}
            {values.valueType === 'ENUM' && (
              <label className={layout.full}>
                Варианты ENUM
                <textarea
                  rows={5}
                  required
                  readOnly={Boolean(record)}
                  value={values.options}
                  onChange={(event) => update('options', event.target.value)}
                />
                <small>
                  От 1 до 200 вариантов. Одна строка на вариант в формате «код =
                  название».
                </small>
              </label>
            )}
            {record && (
              <p className={layout.full}>
                Тип, единицы, код и варианты ENUM задаются при создании.
              </p>
            )}
            <div className={layout.flags}>
              {flagKeys.map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={values[key]}
                    onChange={(event) => update(key, event.target.checked)}
                  />
                  {flags[key]}
                </label>
              ))}
            </div>
          </>
        )}
      </fieldset>
      {categoryPaging}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {editable && (
        <div className={layout.actions}>
          <button type="submit" disabled={busy || Boolean(record && !changed)}>
            {record ? 'Сохранить' : 'Создать'}
          </button>
          {record && (
            <button
              type="button"
              className={layout.secondary}
              disabled={busy || changed}
              onClick={onArchive}
            >
              Архивировать
            </button>
          )}
        </div>
      )}
      {editable && changed && record && (
        <p role="status">Сохраните правки перед архивированием.</p>
      )}
      {record?.state === 'ARCHIVED' && (
        <p>Архивная запись доступна для просмотра.</p>
      )}
    </form>
  );
}
