'use client';

import styles from '../../components/catalog/catalog.module.css';

export default function CatalogErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className={styles.content}>
      <div className={styles.errorPanel} role="alert">
        <span className={styles.stateIndex}>CAT / ERROR</span>
        <h1>Каталог не загрузился</h1>
        <p>
          Попробуйте обновить данные. Если ошибка повторится, вернитесь позже.
        </p>
        <button className={styles.applyButton} onClick={reset} type="button">
          Попробовать ещё раз
        </button>
      </div>
    </main>
  );
}
