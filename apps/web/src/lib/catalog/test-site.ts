import type { components } from '@stdu/catalog-client/schema';
import type { ApiResult, PublicProductQuery } from './api';
import { demoProducts, demoCards, demoCategories } from './demo-products';

const meta = { requestId: '00000000-0000-4000-8000-00000000001b' };
type CategoryList = components['schemas']['PublicCatalogCategoryListResponse'];
type ProductList = components['schemas']['PublicCatalogProductListResponse'];
type ProductDetail = components['schemas']['PublicCatalogProductResponse'];
export function testSiteCategories(options: {
  parentSlug?: string;
  cursor?: string;
  pageSize?: number;
}): ApiResult<CategoryList> {
  if (options.cursor) return { ok: false, kind: 'validation' };
  const rows = options.parentSlug ? [] : demoCategories;
  return {
    ok: true,
    data: {
      data: rows,
      meta: { ...meta, pageSize: options.pageSize ?? 24, nextCursor: null },
    },
  };
}
export function testSiteProduct(slug: string): ApiResult<ProductDetail> {
  const product = demoProducts.find((item) => item.slug === slug);
  return product
    ? { ok: true, data: { data: product, meta } }
    : { ok: false, kind: 'not-found' };
}
export function testSiteProducts(
  query: PublicProductQuery,
): ApiResult<ProductList> {
  // Fixtures do not pretend to implement the catalog's advanced filter engine.
  if (query.filter?.length) return { ok: false, kind: 'validation' };
  const q = query.q?.toLocaleLowerCase('ru');
  const rows = demoCards.filter(
    (product) =>
      (!query.categorySlug || query.categorySlug === product.category.slug) &&
      (!query.brandSlug || query.brandSlug === product.brand?.slug) &&
      (!q ||
        [
          product.displayName,
          product.brand?.name,
          product.manufacturerName,
          product.originalPartNumber,
          product.modification,
        ].some((value) => value?.toLocaleLowerCase('ru').includes(q))),
  );
  rows.sort((left, right) => {
    const field =
      query.sort === 'part_number_asc'
        ? 'originalPartNumber'
        : query.sort === 'brand_asc'
          ? 'brand'
          : 'displayName';
    const a = field === 'brand' ? left.brand?.name : left[field];
    const b = field === 'brand' ? right.brand?.name : right[field];
    return (
      (a ?? '').localeCompare(b ?? '', 'ru') *
      (query.sort === 'name_desc' ? -1 : 1)
    );
  });
  const page = query.page ?? 1,
    pageSize = query.pageSize ?? 24;
  return {
    ok: true,
    data: {
      data: rows.slice((page - 1) * pageSize, page * pageSize),
      meta: {
        ...meta,
        page,
        pageSize,
        total: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      },
    },
  };
}
