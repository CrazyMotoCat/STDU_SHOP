import type { operations } from '@stdu/catalog-client/schema';
import type { PublicProductQuery } from './api';

export type PageSearchParams = Record<string, string | string[] | undefined>;

const productQueryKeys = [
  'categorySlug',
  'includeDescendants',
  'brandSlug',
  'q',
  'filter',
  'page',
  'pageSize',
  'sort',
] as const;

export function valuesFor(params: PageSearchParams, key: string): string[] {
  const value = params[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

export function firstValue(params: PageSearchParams, key: string) {
  return valuesFor(params, key)[0] ?? '';
}

export function appendSearchParams(
  target: URLSearchParams,
  source: PageSearchParams,
  omitted: string[] = [],
) {
  const skip = new Set(omitted);
  for (const [key, value] of Object.entries(source)) {
    if (skip.has(key) || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value])
      target.append(key, item);
  }
}

export function hrefWithQuery(
  pathname: string,
  source: PageSearchParams,
  updates: Record<string, string | undefined>,
  options: { omit?: string[]; resetPage?: boolean } = {},
) {
  const params = new URLSearchParams();
  appendSearchParams(params, source, options.omit);
  if (options.resetPage) params.delete('page');
  for (const [key, value] of Object.entries(updates)) {
    params.delete(key);
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function categoryHref(slugs: string[]) {
  const [slug, ...ancestors] = [...slugs].reverse();
  if (!slug) return '/catalog';
  const pathname = `/catalog/category/${encodeURIComponent(slug)}`;
  const params = new URLSearchParams();
  for (const ancestor of ancestors.reverse())
    params.append('ancestor', ancestor);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export type ProductSort = NonNullable<
  NonNullable<
    operations['searchPublicCatalogProducts']['parameters']['query']
  >['sort']
>;

const productSorts: ProductSort[] = [
  'name_asc',
  'name_desc',
  'brand_asc',
  'part_number_asc',
];

function numberParam(
  value: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function productQueryFromSearchParams(
  params: PageSearchParams,
  overrides: Partial<PublicProductQuery> = {},
): PublicProductQuery {
  const requestedSort = firstValue(params, 'sort');
  const page = numberParam(firstValue(params, 'page'), 1, 1, 10_000);
  const pageSize = numberParam(firstValue(params, 'pageSize'), 24, 1, 100);
  const includeValue = firstValue(params, 'includeDescendants');
  const query: PublicProductQuery = {
    page,
    pageSize,
    sort: productSorts.includes(requestedSort as ProductSort)
      ? (requestedSort as ProductSort)
      : 'name_asc',
    ...(firstValue(params, 'categorySlug')
      ? { categorySlug: firstValue(params, 'categorySlug') }
      : {}),
    ...(firstValue(params, 'brandSlug')
      ? { brandSlug: firstValue(params, 'brandSlug') }
      : {}),
    ...(firstValue(params, 'q')
      ? { q: firstValue(params, 'q').slice(0, 128) }
      : {}),
    ...(includeValue === 'true' || includeValue === 'false'
      ? { includeDescendants: includeValue === 'true' }
      : {}),
    ...(valuesFor(params, 'filter').length
      ? { filter: valuesFor(params, 'filter') }
      : {}),
  };

  return { ...query, ...overrides };
}

export function productFiltersFromSearchParams(params: PageSearchParams) {
  return valuesFor(params, 'filter');
}

export function categoryAncestorsFromSearchParams(params: PageSearchParams) {
  return valuesFor(params, 'ancestor');
}

export function preserveQueryString(
  params: PageSearchParams,
  omit: string[] = [],
) {
  const query = new URLSearchParams();
  appendSearchParams(query, params, omit);
  return query.toString();
}

export function technicalFilterHref(
  action: string,
  preservedQuery: string,
  categorySlug: string,
  filters: string[],
) {
  const query = new URLSearchParams(preservedQuery);
  query.delete('filter');
  query.delete('page');
  query.delete('categoryCursor');
  query.set('categorySlug', categorySlug);
  query.set('includeDescendants', 'false');
  for (const filter of filters) query.append('filter', filter);
  return `${action}?${query.toString()}`;
}

export function safeProductQueryKeys() {
  return productQueryKeys;
}
