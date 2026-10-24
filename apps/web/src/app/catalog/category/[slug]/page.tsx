import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CatalogListingPage } from '../../../../components/catalog/catalog-listing-page';
import { resolveCategoryPath } from '../../../../lib/catalog/api';
import { categoryAncestorsFromSearchParams } from '../../../../lib/catalog/query';
import type { PageSearchParams } from '../../../../lib/catalog/query';

type RouteProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<PageSearchParams>;
};

export async function generateMetadata({
  params,
  searchParams,
}: RouteProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await resolveCategoryPath(
    categoryAncestorsFromSearchParams(query),
    slug,
  );
  if (!result.ok && result.kind === 'not-found') notFound();
  const category = result.ok ? result.path.at(-1) : undefined;
  return {
    title: category
      ? `${category.name} — каталог оборудования | STDU SHOP`
      : 'Категория оборудования | STDU SHOP',
    description: category
      ? `Опубликованное электротехническое оборудование категории «${category.name}».`
      : 'Каталог опубликованного электротехнического оборудования.',
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: RouteProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return <CatalogListingPage searchParams={query} categorySlug={slug} />;
}
