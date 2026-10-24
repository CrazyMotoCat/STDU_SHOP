import { notFound } from 'next/navigation';
import type { PageSearchParams } from '../../lib/catalog/query';
import {
  categoryAncestorsFromSearchParams,
  firstValue,
  productFiltersFromSearchParams,
  productQueryFromSearchParams,
} from '../../lib/catalog/query';
import {
  listPublicCategories,
  resolveCategoryPath,
  searchPublicProducts,
} from '../../lib/catalog/api';
import {
  CatalogBreadcrumbs,
  CatalogError,
  CatalogHero,
  CatalogResults,
  CategoryCollection,
  EmptyCatalog,
  ProductSearchForm,
} from './catalog-ui';
import { TechnicalFilterForm } from './technical-filter-form';
import styles from './catalog.module.css';

export async function CatalogListingPage({
  searchParams,
  categorySlug,
}: {
  searchParams: PageSearchParams;
  categorySlug?: string;
}) {
  const categoryPath = categorySlug
    ? await resolveCategoryPath(
        categoryAncestorsFromSearchParams(searchParams),
        categorySlug,
      )
    : undefined;

  if (categoryPath && !categoryPath.ok && categoryPath.kind === 'not-found')
    notFound();

  if (categoryPath && !categoryPath.ok) {
    return (
      <>
        <CatalogHero
          eyebrow="ПУБЛИЧНЫЙ КАТАЛОГ"
          title="Категория временно недоступна"
          description="Не удалось проверить путь категории. Попробуйте открыть её позже."
        />
        <main id="main" className={styles.content}>
          <CatalogError kind="unavailable" />
        </main>
      </>
    );
  }

  const path = categoryPath?.ok ? categoryPath.path : [];
  const currentCategory = path.at(-1);
  const scopedCategorySlug =
    currentCategory?.slug ??
    (firstValue(searchParams, 'categorySlug') || undefined);
  const categoryCursor =
    firstValue(searchParams, 'categoryCursor') || undefined;
  const pathname = categorySlug
    ? `/catalog/category/${encodeURIComponent(categorySlug)}`
    : '/catalog';
  const query = productQueryFromSearchParams(searchParams, {
    ...(scopedCategorySlug ? { categorySlug: scopedCategorySlug } : {}),
  });

  const [categories, products] = await Promise.all([
    listPublicCategories({
      ...(currentCategory ? { parentSlug: currentCategory.slug } : {}),
      ...(categoryCursor ? { cursor: categoryCursor } : {}),
      pageSize: 24,
    }),
    searchPublicProducts(query),
  ]);

  const categoryNames = path.map(({ name }) => name);
  const brands = products.ok
    ? Array.from(
        new Map(
          products.data.data
            .flatMap(({ brand }) =>
              brand ? [[brand.slug, brand.name] as const] : [],
            )
            .map(([slug, name]) => [slug, { slug, name }]),
        ).values(),
      )
    : [];
  const filterValues = productFiltersFromSearchParams(searchParams);
  const filterCategory = query.categorySlug ?? currentCategory?.slug;
  const categoryLabel =
    categoryNames.join(' / ') || filterCategory || 'выбранной категории';

  return (
    <>
      <CatalogHero
        eyebrow={
          currentCategory ? 'КАТЕГОРИЯ ОБОРУДОВАНИЯ' : 'ПУБЛИЧНЫЙ КАТАЛОГ'
        }
        title={currentCategory?.name ?? 'Инженерное оборудование'}
        description={
          currentCategory
            ? `Опубликованные товары и дочерние разделы: ${currentCategory.name}.`
            : 'Электротехническое оборудование для комплектации проектов и инженерных решений.'
        }
        meta={currentCategory ? `CAT / ${currentCategory.slug}` : 'PUBLIC / R1'}
      />
      {categoryNames.length ? (
        <CatalogBreadcrumbs
          items={[
            { label: 'Каталог', href: '/catalog' },
            ...path.map((category, index) => ({
              label: category.name,
              href:
                index < path.length - 1
                  ? `/catalog/category/${encodeURIComponent(category.slug)}?${new URLSearchParams(
                      path
                        .slice(0, index)
                        .map(
                          ({ slug }) => ['ancestor', slug] as [string, string],
                        ),
                    ).toString()}`
                  : undefined,
            })),
          ]}
        />
      ) : null}
      <main id="main" className={styles.content}>
        <div className={styles.browseBand}>
          <aside className={styles.filterPanel} aria-label="Параметры каталога">
            <h2>Поиск и фильтры</h2>
            <ProductSearchForm
              action={pathname}
              searchParams={searchParams}
              query={query}
              brands={brands}
              categorySlug={scopedCategorySlug}
              pathLabel={categoryLabel}
              lockedToCategory={filterValues.length > 0}
            />
            {filterCategory ? (
              <TechnicalFilterForm
                action={pathname}
                categorySlug={filterCategory}
                pathLabel={categoryLabel}
                initialFilters={filterValues}
                preservedQuery={new URLSearchParams(
                  Object.entries(searchParams).flatMap(([key, value]) =>
                    value === undefined
                      ? []
                      : (Array.isArray(value) ? value : [value]).map(
                          (item) => [key, item] as [string, string],
                        ),
                  ),
                ).toString()}
              />
            ) : (
              <p className={styles.inlineNote}>
                Для технических фильтров сначала откройте точную категорию.
                Список определений параметров публичный API пока не
                предоставляет.
              </p>
            )}
          </aside>
          <div>
            {categories.ok ? (
              <CategoryCollection
                categories={categories.data.data}
                path={path.map(({ slug }) => slug)}
                nextCursor={categories.data.meta.nextCursor}
                searchParams={searchParams}
                heading={
                  currentCategory
                    ? `Разделы: ${currentCategory.name}`
                    : 'Категории оборудования'
                }
              />
            ) : (
              <CatalogError
                kind={
                  categories.kind === 'validation'
                    ? 'validation'
                    : 'unavailable'
                }
              />
            )}
            {products.ok ? (
              <CatalogResults
                products={products.data.data}
                meta={products.data.meta}
                pathname={pathname}
                searchParams={searchParams}
              />
            ) : (
              <CatalogError
                kind={
                  products.kind === 'not-found'
                    ? 'invalid-response'
                    : products.kind
                }
              />
            )}
          </div>
        </div>
        {!categories.ok && !products.ok ? (
          <EmptyCatalog title="Каталог временно недоступен">
            Обновите страницу немного позже.
          </EmptyCatalog>
        ) : null}
      </main>
    </>
  );
}
