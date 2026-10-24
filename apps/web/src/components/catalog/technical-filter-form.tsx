'use client';

import { useState } from 'react';
import { technicalFilterHref } from '../../lib/catalog/query';
import styles from './catalog.module.css';

type FilterOperator = 'eq' | 'contains' | 'gte' | 'lte';
type FilterRow = { code: string; operator: FilterOperator; value: string };

const operators: Array<{ value: FilterOperator; label: string }> = [
  { value: 'eq', label: 'равно' },
  { value: 'contains', label: 'содержит текст' },
  { value: 'gte', label: 'не меньше' },
  { value: 'lte', label: 'не больше' },
];

function parseFilter(value: string): FilterRow | undefined {
  const first = value.indexOf(':');
  const second = value.indexOf(':', first + 1);
  if (first < 1 || second < first + 2) return undefined;
  const operator = value.slice(first + 1, second);
  if (!operators.some((option) => option.value === operator)) return undefined;
  return {
    code: value.slice(0, first),
    operator: operator as FilterOperator,
    value: value.slice(second + 1),
  };
}

export function TechnicalFilterForm({
  action,
  categorySlug,
  pathLabel,
  initialFilters,
  preservedQuery,
}: {
  action: string;
  categorySlug: string;
  pathLabel: string;
  initialFilters: string[];
  preservedQuery: string;
}) {
  const [rows, setRows] = useState<FilterRow[]>(
    initialFilters
      .map(parseFilter)
      .filter((row): row is FilterRow => Boolean(row)),
  );
  const [error, setError] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  function update(index: number, patch: Partial<FilterRow>) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const filters: string[] = [];
    for (const row of rows) {
      if (!row.code.trim() && !row.value.trim()) continue;
      if (!row.code.trim() || !row.value.trim()) {
        setError(
          'Заполните код атрибута и значение или удалите пустую строку.',
        );
        return;
      }
      const filter = `${row.code.trim()}:${row.operator}:${row.value.trim()}`;
      if (filter.length > 240) {
        setError('Длина одного фильтра не должна превышать 240 символов.');
        return;
      }
      filters.push(filter);
    }
    if (filters.length > 40) {
      setError('Можно применить не более 40 фильтров.');
      return;
    }
    const uniqueKeys = filters.map((filter) => {
      const first = filter.indexOf(':');
      const second = filter.indexOf(':', first + 1);
      return filter.slice(0, second);
    });
    if (new Set(uniqueKeys).size !== uniqueKeys.length) {
      setError('Один код атрибута и оператор можно указать только один раз.');
      return;
    }

    setIsApplying(true);
    window.location.assign(
      technicalFilterHref(action, preservedQuery, categorySlug, filters),
    );
  }

  return (
    <section
      className={styles.technicalFilter}
      aria-labelledby="technical-filter-title"
    >
      <div>
        <p className={styles.eyebrow}>ТОЧНАЯ КАТЕГОРИЯ</p>
        <h3 id="technical-filter-title">Технический фильтр</h3>
        <p>
          Фильтрация применяется к определениям «{pathLabel}» без наследования.
          Введите код атрибута из спецификации.
        </p>
      </div>
      <form onSubmit={apply}>
        {rows.length ? (
          <div className={styles.filterRows}>
            {rows.map((row, index) => (
              <fieldset className={styles.filterRow} key={index}>
                <legend className={styles.visuallyHidden}>
                  Параметр {index + 1}
                </legend>
                <label className={styles.field}>
                  <span>Код</span>
                  <input
                    autoComplete="off"
                    maxLength={64}
                    onChange={(event) =>
                      update(index, { code: event.target.value })
                    }
                    placeholder="например voltage"
                    value={row.code}
                  />
                </label>
                <label className={styles.field}>
                  <span>Условие</span>
                  <select
                    onChange={(event) =>
                      update(index, {
                        operator: event.target.value as FilterOperator,
                      })
                    }
                    value={row.operator}
                  >
                    {operators.map((operator) => (
                      <option key={operator.value} value={operator.value}>
                        {operator.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Значение</span>
                  <input
                    maxLength={180}
                    onChange={(event) =>
                      update(index, { value: event.target.value })
                    }
                    placeholder="значение параметра"
                    value={row.value}
                  />
                </label>
                <button
                  aria-label={`Удалить параметр ${index + 1}`}
                  className={styles.removeFilter}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((_, rowIndex) => rowIndex !== index),
                    )
                  }
                  type="button"
                >
                  ×
                </button>
              </fieldset>
            ))}
          </div>
        ) : (
          <p className={styles.inlineNote}>
            Технические параметры пока не заданы.
          </p>
        )}
        <div className={styles.filterActions}>
          <button
            className={styles.secondaryButton}
            disabled={rows.length >= 40}
            onClick={() =>
              setRows((current) => [
                ...current,
                { code: '', operator: 'eq', value: '' },
              ])
            }
            type="button"
          >
            Добавить условие
          </button>
          <button
            className={styles.applyButton}
            disabled={isApplying}
            type="submit"
          >
            {isApplying ? 'Загрузка товаров…' : 'Применить фильтры'}{' '}
            <span aria-hidden="true">{isApplying ? '◌' : '→'}</span>
          </button>
        </div>
        {error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : null}
        <p className={styles.formNote}>
          Поддерживаются: равно для всех типов, текст содержит, числовые не
          меньше и не больше. При любом фильтре запрос явно ограничивается этой
          категорией.
        </p>
      </form>
    </section>
  );
}
