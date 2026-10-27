'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import styles from './public-error.module.css';

export default function PublicErrorBoundary({
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry?: () => void;
}) {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.focus();
  }, []);

  return (
    <>
      <meta name="robots" content="noindex, nofollow" />
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <header className={styles.brandBar}>
        <Link
          className={styles.brandLink}
          href="/"
          aria-label="SHOP-STDU — главная"
        >
          SHOP-STDU
        </Link>
      </header>
      <main
        className={styles.page}
        id="main"
        ref={mainRef}
        tabIndex={-1}
        aria-labelledby="page-error-title"
      >
        <section
          className={`${styles.shell} ${styles.errorShell}`}
          role="alert"
        >
          <div className={`${styles.content} ${styles.errorContent}`}>
            <p className={styles.eyebrow}>Временная ошибка</p>
            <h1 className={styles.title} id="page-error-title">
              Не удалось загрузить страницу
            </h1>
            <p className={styles.description}>
              Произошла временная ошибка. Попробуйте ещё раз или вернитесь на
              главную.
            </p>
            <nav className={`${styles.actions} ${styles.errorActions}`}>
              <button
                className={styles.retryButton}
                onClick={retry ?? reset}
                type="button"
              >
                Повторить
              </button>
              <Link className={styles.action} href="/">
                На главную
              </Link>
            </nav>
          </div>
        </section>
      </main>
    </>
  );
}
