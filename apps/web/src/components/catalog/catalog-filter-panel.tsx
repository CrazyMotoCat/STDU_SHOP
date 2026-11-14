'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import styles from './catalog.module.css';

export function CatalogFilterPanel({
  activeCount,
  children,
}: {
  activeCount: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      aria-label="Параметры каталога"
      className={styles.filterPanel}
      data-filters-expanded={expanded}
    >
      <button
        aria-controls="catalog-search-options catalog-technical-filters"
        aria-expanded={expanded}
        className={styles.mobileFiltersButton}
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        Фильтры{activeCount ? ` (${activeCount})` : ''}
      </button>
      {children}
    </aside>
  );
}
