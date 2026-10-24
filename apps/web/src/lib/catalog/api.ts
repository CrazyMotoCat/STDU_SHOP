import type { components, operations } from '@stdu/catalog-client/schema';

type CategoryList = components['schemas']['PublicCatalogCategoryListResponse'];
type ProductList = components['schemas']['PublicCatalogProductListResponse'];
type ProductDetail = components['schemas']['PublicCatalogProductResponse'];
export type PublicCategory = components['schemas']['PublicCatalogCategory'];
export type PublicProductCard =
  components['schemas']['PublicCatalogProductCard'];
export type PublicProduct = components['schemas']['PublicCatalogProduct'];
export type PublicAttribute = components['schemas']['PublicAttributeValue'];
export type PublicProductQuery = NonNullable<
  operations['searchPublicCatalogProducts']['parameters']['query']
>;

export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: 'not-found' | 'validation' | 'unavailable' | 'invalid-response';
    };

const apiBaseUrl = () =>
  (process.env.API_INTERNAL_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function readJson<T>(
  path: string,
  params?: URLSearchParams,
): Promise<ApiResult<T>> {
  const url = new URL(`${apiBaseUrl()}${path}`);
  if (params) url.search = params.toString();

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 404) return { ok: false, kind: 'not-found' };
    if (response.status === 400) return { ok: false, kind: 'validation' };
    if (!response.ok) return { ok: false, kind: 'unavailable' };

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !('data' in payload))
      return { ok: false, kind: 'invalid-response' };

    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
}

export function listPublicCategories(
  options: {
    parentSlug?: string;
    cursor?: string;
    pageSize?: number;
  } = {},
) {
  const params = new URLSearchParams();
  if (options.parentSlug) params.set('parentSlug', options.parentSlug);
  if (options.cursor) params.set('cursor', options.cursor);
  params.set('pageSize', String(options.pageSize ?? 24));
  return readJson<CategoryList>('/v1/public/catalog/categories', params);
}

export function searchPublicProducts(query: PublicProductQuery) {
  const params = new URLSearchParams();
  if (query.categorySlug) params.set('categorySlug', query.categorySlug);
  if (query.includeDescendants !== undefined)
    params.set('includeDescendants', String(query.includeDescendants));
  if (query.brandSlug) params.set('brandSlug', query.brandSlug);
  if (query.q) params.set('q', query.q);
  for (const filter of query.filter ?? []) params.append('filter', filter);
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined)
    params.set('pageSize', String(query.pageSize));
  if (query.sort) params.set('sort', query.sort);
  return readJson<ProductList>('/v1/public/catalog/products', params);
}

export function getPublicProduct(slug: string) {
  return readJson<ProductDetail>(
    `/v1/public/catalog/products/${encodeURIComponent(slug)}`,
  );
}

export type CategoryPathResult =
  | { ok: true; path: PublicCategory[] }
  | { ok: false; kind: 'not-found' | 'unavailable' | 'invalid-response' };

async function findDirectChild(
  parentSlug: string | undefined,
  targetSlug: string,
): Promise<ApiResult<PublicCategory>> {
  let cursor: string | undefined;
  const seen = new Set<string>();

  do {
    const page = await listPublicCategories({
      parentSlug,
      cursor,
      pageSize: 100,
    });
    if (!page.ok) return page;
    const match = page.data.data.find(
      (category) => category.slug === targetSlug,
    );
    if (match) return { ok: true, data: match };
    cursor = page.data.meta.nextCursor ?? undefined;
    if (cursor && seen.has(cursor))
      return { ok: false, kind: 'invalid-response' };
    if (cursor) seen.add(cursor);
  } while (cursor);

  return { ok: false, kind: 'not-found' };
}

function categoryPathError(
  result: Exclude<ApiResult<unknown>, { ok: true }>,
): CategoryPathResult {
  if (result.kind === 'not-found' || result.kind === 'unavailable')
    return { ok: false, kind: result.kind };
  return { ok: false, kind: 'invalid-response' };
}

async function allDirectChildren(
  parentSlug?: string,
): Promise<ApiResult<PublicCategory[]>> {
  const categories: PublicCategory[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await listPublicCategories({
      parentSlug,
      cursor,
      pageSize: 100,
    });
    if (!page.ok) return page;
    categories.push(...page.data.data);
    cursor = page.data.meta.nextCursor ?? undefined;
    if (cursor && seen.has(cursor))
      return { ok: false, kind: 'invalid-response' };
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { ok: true, data: categories };
}

async function findAnyCategoryPath(
  targetSlug: string,
): Promise<CategoryPathResult> {
  const roots = await allDirectChildren();
  if (!roots.ok) return categoryPathError(roots);
  const queue = roots.data.map((category) => ({ path: [category] }));
  const visited = new Set(roots.data.map((category) => category.slug));

  for (let index = 0; index < queue.length; index += 1) {
    const entry = queue[index];
    if (!entry) continue;
    const parent = entry.path.at(-1);
    if (!parent) continue;

    const children = await allDirectChildren(parent.slug);
    if (!children.ok) {
      if (children.kind === 'not-found') continue;
      return categoryPathError(children);
    }
    for (const child of children.data) {
      if (child.slug === targetSlug)
        return { ok: true, path: [...entry.path, child] };
      if (!visited.has(child.slug)) {
        visited.add(child.slug);
        queue.push({ path: [...entry.path, child] });
      }
    }
  }

  return { ok: false, kind: 'not-found' };
}

export async function resolveCategoryPath(
  ancestors: string[],
  targetSlug: string,
): Promise<CategoryPathResult> {
  if (ancestors.length === 0) {
    const root = await findDirectChild(undefined, targetSlug);
    if (root.ok) return { ok: true, path: [root.data] };
    if (root.kind !== 'not-found') return categoryPathError(root);
    return findAnyCategoryPath(targetSlug);
  }

  const path: PublicCategory[] = [];
  let parentSlug: string | undefined;
  for (const slug of [...ancestors, targetSlug]) {
    const category = await findDirectChild(parentSlug, slug);
    if (!category.ok) return categoryPathError(category);
    path.push(category.data);
    parentSlug = category.data.slug;
  }
  return { ok: true, path };
}

export function formatAttributeValue(attribute: PublicAttribute): string {
  let value: string;
  if (typeof attribute.value === 'string') value = attribute.value;
  else if (typeof attribute.value === 'number') value = String(attribute.value);
  else if (typeof attribute.value === 'boolean')
    value = attribute.value ? 'Да' : 'Нет';
  else value = attribute.value.label;

  return attribute.unitLabel ? `${value} ${attribute.unitLabel}` : value;
}
