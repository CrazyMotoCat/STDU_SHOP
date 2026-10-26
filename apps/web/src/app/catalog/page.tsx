import type { Metadata } from 'next';
import { CatalogListingPage } from '../../components/catalog/catalog-listing-page';
import type { PageSearchParams } from '../../lib/catalog/query';

export const metadata: Metadata = {
  title: 'Каталог электротехнического оборудования | SHOP-STDU',
  description:
    'Публичный каталог электротехнического оборудования: поиск по артикулам, брендам и опубликованным характеристикам.',
};

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  return <CatalogListingPage searchParams={await searchParams} />;
}
