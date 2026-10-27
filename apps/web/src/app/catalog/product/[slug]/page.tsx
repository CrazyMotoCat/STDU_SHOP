import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  CatalogError,
  ProductDetailView,
} from '../../../../components/catalog/catalog-ui';
import { getPublicProduct } from '../../../../lib/catalog/api';

type RouteProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicProduct(slug);
  if (
    !result.ok &&
    (result.kind === 'not-found' || result.kind === 'validation')
  ) {
    notFound();
  }
  if (!result.ok) return { title: 'Карточка оборудования | STDU SHOP' };
  const product = result.data.data;
  return {
    title: `${product.displayName} — ${product.originalPartNumber ?? product.category.name} | STDU SHOP`,
    description:
      product.summary ??
      `Технические характеристики ${product.displayName}. Цена по запросу.`,
  };
}

export default async function ProductPage({ params }: RouteProps) {
  const { slug } = await params;
  const result = await getPublicProduct(slug);
  if (
    !result.ok &&
    (result.kind === 'not-found' || result.kind === 'validation')
  ) {
    notFound();
  }
  return result.ok ? (
    <ProductDetailView product={result.data.data} />
  ) : (
    <main id="main" className="container">
      <CatalogError
        kind={result.kind === 'validation' ? 'validation' : 'unavailable'}
      />
    </main>
  );
}
