import { catalogTestSiteEnabled } from '../../lib/catalog/test-site-config';
import styles from '../../components/catalog/catalog.module.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PublicLayout } from '../../components/layouts/page-layouts';
import { getPublicPageRobots } from '../../lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: getPublicPageRobots(),
};

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return (
    <PublicLayout>
      {catalogTestSiteEnabled() ? (
        <p role="note" className={styles.testSiteNotice}>
          Тестовый каталог IEK ARMAT · Серверные демонстрационные данные, без
          публикации товаров в БД.
        </p>
      ) : null}
      {children}
    </PublicLayout>
  );
}
