import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './public-error.module.css';

export const metadata: Metadata = {
  title: '404 — Такой страницы пока нет | SHOP-STDU',
};

export default function NotFound() {
  return (
    <>
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
      <main className={styles.page} id="main" tabIndex={-1}>
        <section className={styles.shell} aria-labelledby="not-found-title">
          <div className={styles.content}>
            <p className={styles.eyebrow}>Страница не найдена · 404</p>
            <h1 className={styles.title} id="not-found-title">
              404 — Такой страницы пока нет
            </h1>
            <p className={styles.description}>
              Возможно, адрес изменился или страница больше недоступна. Вы
              можете перейти в нужный раздел SHOP-STDU.
            </p>
            <nav className={styles.actions} aria-label="Основные разделы">
              <Link className={styles.primaryAction} href="/">
                На главную
              </Link>
              <Link className={styles.action} href="/catalog">
                Оборудование
              </Link>
              <Link className={styles.action} href="/panels">
                Электрощиты
              </Link>
              <Link className={styles.action} href="/engineering">
                Проектирование и программирование
              </Link>
            </nav>
          </div>
          <div className={styles.visual} aria-hidden="true">
            <svg
              className={styles.illustration}
              viewBox="0 0 420 300"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              focusable="false"
            >
              <path
                d="M31 72h60v44h52v-24h42m-154 96h52v-35h57v26h61m88-108h-45v42h-42m105 74h-61v-39h-48"
                stroke="var(--art-line)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M91 72v-24h42m154 0h42v36m-198 142v-25h-40m178 25h38v-36h38"
                stroke="var(--art-line-soft)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <rect
                x="114"
                y="75"
                width="192"
                height="142"
                rx="12"
                fill="var(--art-panel)"
                stroke="var(--art-line-soft)"
                strokeWidth="1.5"
              />
              <path
                d="M135 101h150M135 190h150"
                stroke="var(--art-line-soft)"
                strokeWidth="1"
              />
              <text
                x="210"
                y="166"
                fill="var(--color-white)"
                fontFamily="var(--font-mono)"
                fontSize="64"
                fontWeight="700"
                letterSpacing="-5"
                textAnchor="middle"
              >
                404
              </text>
              <circle cx="31" cy="72" r="5" fill="var(--art-accent)" />
              <circle cx="369" cy="48" r="5" fill="var(--art-accent)" />
              <circle cx="370" cy="204" r="5" fill="var(--art-indicator)" />
              <circle cx="93" cy="240" r="4" fill="var(--art-accent)" />
              <path
                d="M338 108h32m-16-16v32M58 226h20m-10-10v20"
                stroke="var(--art-line-soft)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </section>
      </main>
    </>
  );
}
