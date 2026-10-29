import type { Metadata } from 'next';
import { PublicLayout } from '../../components/layouts/page-layouts';
import { Breadcrumbs, Container } from '../../components/ui/primitives';
import { RequestQuoteForm } from './request-quote-form';
import { sanitizeProductHint } from './request-quote-utils';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Запросить коммерческое предложение | SHOP-STDU',
  description:
    'Предварительный локальный интерфейс заявки на оборудование, электрощиты и инженерные услуги.',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

type SearchParams = Record<string, string | string[] | undefined>;

const requestKinds = ['equipment', 'panels', 'engineering'] as const;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RequestQuotePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const kindParam = firstValue(params.kind);
  const initialKind = requestKinds.includes(
    kindParam as (typeof requestKinds)[number],
  )
    ? (kindParam as (typeof requestKinds)[number])
    : 'equipment';
  const productHint = sanitizeProductHint(firstValue(params.product));
  const previewEnabled =
    process.env.NODE_ENV === 'development' ||
    process.env.RFQ_PREVIEW_ENABLED === 'true';
  const apiSubmissionEnabled =
    (process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test') &&
    process.env.RFQ_API_SUBMISSION_ENABLED === 'true';

  return (
    <PublicLayout>
      <main className={styles.page} id="main" tabIndex={-1}>
        <Container>
          <Breadcrumbs
            className={styles.breadcrumbs}
            items={[
              { label: 'Главная', href: '/' },
              { label: 'Запрос коммерческого предложения' },
            ]}
          />
          <RequestQuoteForm
            initialKind={initialKind}
            previewEnabled={previewEnabled}
            apiSubmissionEnabled={apiSubmissionEnabled}
            productHint={productHint || undefined}
          />
        </Container>
      </main>
    </PublicLayout>
  );
}
