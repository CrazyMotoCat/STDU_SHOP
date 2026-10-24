import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { components } from '@stdu/catalog-client/schema';
import type {
  PublicAttribute,
  PublicCategory,
  PublicProduct,
  PublicProductCard,
} from '../../lib/catalog/api';
import { formatAttributeValue } from '../../lib/catalog/api';
import {
  categoryHref,
  hrefWithQuery,
  type PageSearchParams,
  type ProductSort,
} from '../../lib/catalog/query';
import styles from './catalog.module.css';

export function CatalogHero({
  eyebrow,
  title,
  description,
  meta,
  visual = false,
  titleAs = 'h1',
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta?: string;
  visual?: boolean;
  titleAs?: 'h1' | 'p';
}) {
  const Title = titleAs;
  return (
    <section className={styles.hero} aria-labelledby="catalog-title">
      <div className={styles.heroGrid}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <Title className={styles.heroTitle} id="catalog-title">
            {title}
          </Title>
          <p className={styles.heroDescription}>{description}</p>
        </div>
        {visual ? (
          <div className={styles.heroVisual}>
            <Image
              alt="Пример промышленного шкафа управления — иллюстрация каталога"
              className={styles.heroImage}
              fill
              priority
              sizes="(max-width: 760px) 100vw, 35vw"
              src="/images/engineering/cabinet-industrial.webp"
            />
            <div className={styles.heroVisualCaption}>
              <span>ИНЖЕНЕРНОЕ ОБОРУДОВАНИЕ</span>
            </div>
            {meta ? (
              <span className={styles.heroVisualMeta}>{meta}</span>
            ) : null}
          </div>
        ) : (
          <div className={styles.heroAside}>
            <span className={styles.heroAsideMark} aria-hidden="true">
              STDU / CAT
            </span>
            <p>Подбор оборудования по точной идентификации и параметрам.</p>
            {meta ? <span className={styles.heroMeta}>{meta}</span> : null}
          </div>
        )}
      </div>
    </section>
  );
}

export function CatalogBreadcrumbs({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
      <ol>
        <li>
          <Link href="/">Главная</Link>
        </li>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            <span aria-hidden="true">/</span>
            {item.href && index < items.length - 1 ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span
                aria-current={index === items.length - 1 ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function CategoryCollection({
  categories,
  path,
  nextCursor,
  searchParams,
  heading = 'Категории оборудования',
}: {
  categories: PublicCategory[];
  path: string[];
  nextCursor: string | null;
  searchParams: PageSearchParams;
  heading?: string;
}) {
  return (
    <section
      className={styles.categorySection}
      aria-labelledby="category-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>НАВИГАЦИЯ ПО КАТАЛОГУ</p>
          <h2 id="category-heading">{heading}</h2>
        </div>
        <span className={styles.sectionIndex}>РАЗДЕЛЫ КАТАЛОГА</span>
      </div>
      {categories.length ? (
        <ul className={styles.categoryGrid}>
          {categories.map((category, index) => (
            <li key={category.slug}>
              <Link
                className={styles.categoryCard}
                href={categoryHref([...path, category.slug])}
              >
                <span className={styles.categoryNumber}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className={styles.categoryVisual} aria-hidden="true">
                  <svg fill="none" viewBox="0 0 72 48">
                    <path d="M4 24h18m28 0h18M22 12v24m28-24v24M22 12h28m-28 24h28" />
                    <rect height="16" rx="2" width="14" x="29" y="16" />
                    <circle cx="4" cy="24" r="2" />
                    <circle cx="68" cy="24" r="2" />
                    <path d="M36 20v8m-4-4h8" />
                  </svg>
                </span>
                <span className={styles.categoryName}>{category.name}</span>
                <span className={styles.categoryArrow} aria-hidden="true">
                  ↗
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.inlineNote}>
          В этой категории нет дочерних разделов.
        </p>
      )}
      {nextCursor ? (
        <Link
          className={styles.moreLink}
          href={hrefWithQuery(
            path.length ? categoryHref(path).split('?')[0]! : '/catalog',
            searchParams,
            { categoryCursor: nextCursor },
            { omit: ['categoryCursor'], resetPage: true },
          )}
        >
          Загрузить следующую страницу категорий{' '}
          <span aria-hidden="true">↓</span>
        </Link>
      ) : null}
    </section>
  );
}

export function ProductImage({
  label,
  state = 'unavailable',
  compact = false,
}: {
  label: string;
  state?: 'loading' | 'unavailable';
  compact?: boolean;
}) {
  return (
    <div
      className={`${styles.productImage} ${compact ? styles.productImageCompact : ''}`}
      data-state={state}
      role="img"
      aria-label={
        state === 'loading'
          ? `Загрузка изображения: ${label}`
          : `Публичная фотография товара не подключена: ${label}`
      }
      aria-busy={state === 'loading'}
    >
      <svg aria-hidden="true" viewBox="0 0 64 64" fill="none">
        <path d="M13 14h12M13 14v12m38-12H39m12 0v12M13 50h12m-12 0V38m38 12H39m12 0V38" />
        <path d="M19 32h8l5-8 8 16 5-8h1" />
        <circle cx="19" cy="32" r="2" />
        <circle cx="45" cy="32" r="2" />
      </svg>
      <span>
        {state === 'loading' ? 'Загрузка изображения' : 'Фото не подключено'}
      </span>
    </div>
  );
}

function ProductIdentity({ product }: { product: PublicProductCard }) {
  return (
    <div className={styles.productIdentity}>
      <div className={styles.productKicker}>
        <span>{product.brand?.name ?? 'Бренд не указан'}</span>
        <span>{product.category.name}</span>
      </div>
      <h3 className={styles.productName}>
        <Link href={`/catalog/product/${encodeURIComponent(product.slug)}`}>
          {product.displayName}
        </Link>
      </h3>
      <dl className={styles.identityList}>
        {product.manufacturerName ? (
          <div>
            <dt>Производитель</dt>
            <dd>{product.manufacturerName}</dd>
          </div>
        ) : null}
        {product.originalPartNumber ? (
          <div>
            <dt>Артикул</dt>
            <dd>{product.originalPartNumber}</dd>
          </div>
        ) : null}
        {product.modification ? (
          <div>
            <dt>Модификация</dt>
            <dd>{product.modification}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function PriceDisplay({ product }: { product: PublicProductCard }) {
  return (
    <p className={styles.priceDisplay}>
      <span>Стоимость</span>
      <strong>{product.priceDisplay.label}</strong>
    </p>
  );
}

function ProductTile({ product }: { product: PublicProductCard }) {
  return (
    <article className={styles.productTile}>
      <ProductImage label={product.displayName} />
      <div className={styles.productTileBody}>
        <ProductIdentity product={product} />
        <div className={styles.productTileFooter}>
          <PriceDisplay product={product} />
          <Link
            className={styles.detailsLink}
            href={`/catalog/product/${encodeURIComponent(product.slug)}`}
          >
            Технические данные <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

function ProductListItem({ product }: { product: PublicProductCard }) {
  return (
    <article className={styles.productListItem}>
      <ProductImage compact label={product.displayName} />
      <ProductIdentity product={product} />
      <PriceDisplay product={product} />
      <Link
        className={styles.detailsLink}
        href={`/catalog/product/${encodeURIComponent(product.slug)}`}
      >
        Открыть <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

function ProductTable({ products }: { products: PublicProductCard[] }) {
  return (
    <div
      className={styles.tableScroll}
      tabIndex={0}
      aria-label="Таблица оборудования"
    >
      <table className={styles.productTable}>
        <caption className={styles.visuallyHidden}>
          Опубликованное оборудование и основные сведения
        </caption>
        <thead>
          <tr>
            <th scope="col">Оборудование</th>
            <th scope="col">Бренд / производитель</th>
            <th scope="col">Артикул / модификация</th>
            <th scope="col">Категория</th>
            <th scope="col">Цена</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.slug}>
              <td>
                <Link
                  className={styles.tableProductLink}
                  href={`/catalog/product/${encodeURIComponent(product.slug)}`}
                >
                  {product.displayName}
                </Link>
              </td>
              <td>
                <strong>{product.brand?.name ?? '—'}</strong>
                {product.manufacturerName ? (
                  <span className={styles.tableSecondary}>
                    {product.manufacturerName}
                  </span>
                ) : null}
              </td>
              <td>
                {product.originalPartNumber ?? '—'}
                {product.modification ? (
                  <span className={styles.tableSecondary}>
                    {product.modification}
                  </span>
                ) : null}
              </td>
              <td>{product.category.name}</td>
              <td className={styles.tablePrice}>
                {product.priceDisplay.label}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.inlineNote}>
        Технические характеристики и единицы измерения доступны в карточке
        товара.
      </p>
    </div>
  );
}

export function ProductCollection({
  products,
  view,
}: {
  products: PublicProductCard[];
  view: 'grid' | 'list' | 'table';
}) {
  if (view === 'table') return <ProductTable products={products} />;
  if (view === 'list')
    return (
      <div className={styles.productList}>
        {products.map((product) => (
          <ProductListItem key={product.slug} product={product} />
        ))}
      </div>
    );
  return (
    <div
      className={`${styles.productGrid} ${
        products.length === 1
          ? styles.productGridSingle
          : products.length === 2
            ? styles.productGridDouble
            : ''
      }`}
    >
      {products.map((product) => (
        <ProductTile key={product.slug} product={product} />
      ))}
    </div>
  );
}

export function ProductSearchForm({
  action,
  searchParams,
  query,
  brands,
  categorySlug,
  pathLabel,
  lockedToCategory = false,
}: {
  action: string;
  searchParams: PageSearchParams;
  query: {
    q?: string;
    brandSlug?: string;
    sort?: ProductSort;
    pageSize?: number;
    includeDescendants?: boolean;
  };
  brands: Array<{ slug: string; name: string }>;
  categorySlug?: string;
  pathLabel?: string;
  lockedToCategory?: boolean;
}) {
  const replaced = [
    'q',
    'brandSlug',
    'sort',
    'page',
    'pageSize',
    'includeDescendants',
    'categoryCursor',
    'categorySlug',
  ];
  const hiddenParams = new URLSearchParams();
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(searchParams)) {
    if (replaced.includes(key) || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value])
      entries.push([key, item]);
  }
  if (categorySlug) entries.push(['categorySlug', categorySlug]);
  for (const [key, value] of entries) hiddenParams.append(key, value);

  const sort = query.sort ?? 'name_asc';
  const includeDescendants = query.includeDescendants ?? true;

  return (
    <form className={styles.searchForm} action={action} method="get">
      {[...hiddenParams.entries()].map(([key, value], index) => (
        <input key={`${key}-${index}`} type="hidden" name={key} value={value} />
      ))}
      <div className={styles.searchPrimary}>
        <label className={styles.field}>
          <span>Поиск по каталогу</span>
          <input
            aria-label="Поиск по каталогу"
            maxLength={128}
            name="q"
            placeholder="Название, артикул, бренд, параметр"
            type="search"
            defaultValue={query.q ?? ''}
          />
        </label>
        <button className={styles.applyButton} type="submit">
          Применить параметры <span aria-hidden="true">→</span>
        </button>
      </div>
      <details
        className={styles.searchOptions}
        open={Boolean(query.brandSlug || categorySlug)}
      >
        <summary>
          <span>Настройки выдачи</span>
          <span className={styles.detailsToggle} aria-hidden="true" />
        </summary>
        <div className={styles.searchOptionsGrid}>
          <label className={styles.field}>
            <span>Бренд</span>
            <input
              aria-label="Slug бренда"
              autoComplete="off"
              list="catalog-brand-options"
              maxLength={120}
              name="brandSlug"
              placeholder="Выберите или введите slug"
              defaultValue={query.brandSlug ?? ''}
            />
            <datalist id="catalog-brand-options">
              {brands.map((brand) => (
                <option
                  key={brand.slug}
                  value={brand.slug}
                  label={brand.name}
                />
              ))}
            </datalist>
            <small>Список собран по загруженной странице товаров.</small>
          </label>
          {categorySlug ? (
            <label className={styles.field}>
              <span>Область категории</span>
              {lockedToCategory ? (
                <>
                  <input
                    type="hidden"
                    name="includeDescendants"
                    value="false"
                  />
                  <span className={styles.lockedScope}>
                    Только «{pathLabel ?? categorySlug}» — требуется для
                    технических фильтров
                  </span>
                </>
              ) : (
                <select
                  name="includeDescendants"
                  defaultValue={includeDescendants ? 'true' : 'false'}
                >
                  <option value="true">Категория и вложенные разделы</option>
                  <option value="false">Только эта категория</option>
                </select>
              )}
            </label>
          ) : null}
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>Сортировка</span>
              <select name="sort" defaultValue={sort}>
                <option value="name_asc">Название: А → Я</option>
                <option value="name_desc">Название: Я → А</option>
                <option value="brand_asc">Бренд: А → Я</option>
                <option value="part_number_asc">Артикул: А → Я</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>На странице</span>
              <select
                name="pageSize"
                defaultValue={String(query.pageSize ?? 24)}
              >
                <option value="24">24</option>
                <option value="48">48</option>
                <option value="100">100</option>
              </select>
            </label>
          </div>
        </div>
      </details>
      <p className={styles.formNote}>
        Поиск — буквальное совпадение без исправления опечаток.
      </p>
    </form>
  );
}

export function TechnicalSummary({
  attributes,
  title = 'Технические характеристики',
}: {
  attributes: PublicAttribute[];
  title?: string;
}) {
  if (!attributes.length)
    return (
      <section className={styles.detailSection} aria-labelledby="spec-title">
        <h2 id="spec-title">{title}</h2>
        <p className={styles.inlineNote}>Характеристики не опубликованы.</p>
      </section>
    );

  return (
    <section className={styles.detailSection} aria-labelledby="spec-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>ПАРАМЕТРЫ ИЗ ОПУБЛИКОВАННОЙ РЕДАКЦИИ</p>
          <h2 id="spec-title">{title}</h2>
        </div>
        <span className={styles.sectionIndex}>
          {String(attributes.length).padStart(2, '0')} / параметров
        </span>
      </div>
      <div className={styles.attributeTableWrap}>
        <table className={styles.attributeTable}>
          <caption className={styles.visuallyHidden}>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Параметр</th>
              <th scope="col">Значение</th>
              <th scope="col">Код</th>
            </tr>
          </thead>
          <tbody>
            {attributes.map((attribute) => (
              <tr key={attribute.attributeCode}>
                <th scope="row">{attribute.label}</th>
                <td>{formatAttributeValue(attribute)}</td>
                <td className={styles.attributeCode}>
                  {attribute.attributeCode}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ProductRelations({ product }: { product: PublicProduct }) {
  const accessories = product.relations.filter(
    ({ relationType }) => relationType === 'ACCESSORY',
  );
  const compatible = product.relations.filter(
    ({ relationType }) => relationType === 'COMPATIBLE_EQUIPMENT',
  );
  if (!accessories.length && !compatible.length) return null;

  const groups = [
    { title: 'Аксессуары', items: accessories },
    { title: 'Совместимое оборудование', items: compatible },
  ].filter(({ items }) => items.length);

  return (
    <div className={styles.relationGroups}>
      {groups.map((group) => (
        <section className={styles.detailSection} key={group.title}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>РУЧНАЯ СВЯЗЬ КАТАЛОГА</p>
              <h2>{group.title}</h2>
            </div>
          </div>
          <ul className={styles.relationList}>
            {group.items.map(({ target }) => (
              <li key={target.slug}>
                <Link
                  href={`/catalog/product/${encodeURIComponent(target.slug)}`}
                >
                  <span>{target.brand?.name ?? 'Бренд не указан'}</span>
                  <strong>{target.displayName}</strong>
                  <small>
                    {target.originalPartNumber ?? 'Артикул не указан'}
                  </small>
                  <span className={styles.priceDisplay}>
                    {target.priceDisplay.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function EmptyCatalog({
  title,
  children,
  href = '/catalog',
  linkLabel = 'Сбросить параметры',
}: {
  title: string;
  children: ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className={styles.statePanel} role="status">
      <span className={styles.stateIndex} aria-hidden="true">
        00 / EMPTY
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      <Link className={styles.detailsLink} href={href}>
        {linkLabel} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

export function CatalogError({
  kind,
}: {
  kind: 'validation' | 'unavailable' | 'invalid-response';
}) {
  const message =
    kind === 'validation'
      ? 'Проверьте параметры поиска. Технические фильтры требуют точную категорию и режим без вложенных категорий.'
      : 'Каталог временно не отвечает. Обновите страницу немного позже.';
  return (
    <div className={styles.errorPanel} role="alert">
      <span className={styles.stateIndex} aria-hidden="true">
        API / READ
      </span>
      <h2>
        {kind === 'validation'
          ? 'Параметры не приняты'
          : 'Не удалось загрузить каталог'}
      </h2>
      <p>{message}</p>
    </div>
  );
}

export function ViewSwitcher({
  value,
  pathname,
  searchParams,
}: {
  value: 'grid' | 'list' | 'table';
  pathname: string;
  searchParams: PageSearchParams;
}) {
  const options = [
    { id: 'grid' as const, label: 'Плитка', symbol: '▦' },
    { id: 'list' as const, label: 'Список', symbol: '≡' },
    { id: 'table' as const, label: 'Таблица', symbol: '▤' },
  ];
  return (
    <nav className={styles.viewSwitcher} aria-label="Режим отображения товаров">
      {options.map((option) => (
        <Link
          aria-current={option.id === value ? 'page' : undefined}
          className={option.id === value ? styles.viewActive : styles.viewLink}
          href={hrefWithQuery(pathname, searchParams, { view: option.id })}
          key={option.id}
        >
          <span aria-hidden="true">{option.symbol}</span> {option.label}
        </Link>
      ))}
    </nav>
  );
}

export function ProductPagination({
  meta,
  pathname,
  searchParams,
}: {
  meta: components['schemas']['PublicPageMeta'];
  pathname: string;
  searchParams: PageSearchParams;
}) {
  const previous = meta.page > 1 ? meta.page - 1 : undefined;
  const next = meta.page < meta.totalPages ? meta.page + 1 : undefined;
  return (
    <nav className={styles.pagination} aria-label="Страницы каталога">
      <span>
        Страница {meta.page} из {Math.max(meta.totalPages, 1)} · {meta.total}{' '}
        товаров
      </span>
      <div>
        {previous ? (
          <Link
            href={hrefWithQuery(pathname, searchParams, {
              page: String(previous),
            })}
          >
            ← Назад
          </Link>
        ) : (
          <span aria-disabled="true">← Назад</span>
        )}
        {next ? (
          <Link
            href={hrefWithQuery(pathname, searchParams, { page: String(next) })}
          >
            Далее →
          </Link>
        ) : (
          <span aria-disabled="true">Далее →</span>
        )}
      </div>
    </nav>
  );
}

export function CatalogResults({
  products,
  meta,
  pathname,
  searchParams,
}: {
  products: PublicProductCard[];
  meta: components['schemas']['PublicPageMeta'];
  pathname: string;
  searchParams: PageSearchParams;
}) {
  const requestedView = firstView(searchParams.view);
  return (
    <section
      className={styles.resultsSection}
      aria-labelledby="products-heading"
    >
      <div className={styles.resultsHeader}>
        <div>
          <h2 id="products-heading">Оборудование</h2>
          <p className={styles.resultCount}>
            Найдено: {meta.total} · страница {meta.page} из{' '}
            {Math.max(meta.totalPages, 1)}
          </p>
        </div>
        <ViewSwitcher
          value={requestedView}
          pathname={pathname}
          searchParams={searchParams}
        />
      </div>
      {products.length ? (
        <ProductCollection products={products} view={requestedView} />
      ) : (
        <EmptyCatalog title="Ничего не найдено">
          Измените запрос или сбросьте фильтры, чтобы увидеть опубликованные
          товары.
        </EmptyCatalog>
      )}
      {meta.totalPages > 1 ? (
        <ProductPagination
          meta={meta}
          pathname={pathname}
          searchParams={searchParams}
        />
      ) : null}
    </section>
  );
}

export function ProductDetailView({ product }: { product: PublicProduct }) {
  return (
    <>
      <CatalogBreadcrumbs
        items={[
          { label: 'Каталог', href: '/catalog' },
          {
            label: product.category.name,
            href: `/catalog/category/${encodeURIComponent(product.category.slug)}`,
          },
          { label: product.displayName },
        ]}
      />
      <main id="main" className={styles.content}>
        <div className={styles.productDetailHeader}>
          <section
            className={styles.detailMedia}
            aria-label="Изображения и документы"
          >
            <ProductImage label={product.displayName} />
            <p className={styles.mediaNote}>
              Публичные фото и документы не подключены.
            </p>
          </section>
          <section aria-label="Идентификация товара">
            <p className={styles.eyebrow}>ИДЕНТИФИКАЦИЯ</p>
            <h1 className={styles.productTitle}>{product.displayName}</h1>
            <p className={styles.productSubtitle}>
              {product.brand?.name ?? 'Бренд не указан'}
              {product.manufacturerName ? ` · ${product.manufacturerName}` : ''}
            </p>
            <dl className={styles.productFacts}>
              <div>
                <dt>Оригинальный артикул</dt>
                <dd>{product.originalPartNumber ?? 'Не указан'}</dd>
              </div>
              <div>
                <dt>Модификация</dt>
                <dd>{product.modification ?? 'Не указана'}</dd>
              </div>
              <div>
                <dt>Категория</dt>
                <dd>{product.category.name}</dd>
              </div>
              {product.brand ? (
                <div>
                  <dt>Бренд</dt>
                  <dd>{product.brand.name}</dd>
                </div>
              ) : null}
            </dl>
            <div className={styles.priceCallout}>
              <span>Стоимость</span>
              <strong>{product.priceDisplay.label}</strong>
              <button className={styles.disabledQuote} type="button" disabled>
                Запросить коммерческое предложение — скоро
              </button>
            </div>
          </section>
        </div>

        {product.summary ? (
          <section
            className={styles.descriptionBlock}
            aria-labelledby="summary-title"
          >
            <p className={styles.eyebrow}>КРАТКО</p>
            <h2 id="summary-title">Описание</h2>
            <p>{product.summary}</p>
          </section>
        ) : null}
        {product.description ? (
          <section
            className={styles.descriptionBlock}
            aria-labelledby="description-title"
          >
            <p className={styles.eyebrow}>ОПУБЛИКОВАННЫЕ ДАННЫЕ</p>
            <h2 id="description-title">Подробное описание</h2>
            <p>{product.description}</p>
          </section>
        ) : null}
        <TechnicalSummary attributes={product.attributes} />
        <ProductRelations product={product} />
        <nav
          className={styles.bottomNavigation}
          aria-label="Навигация по каталогу"
        >
          <Link
            href={`/catalog/category/${encodeURIComponent(product.category.slug)}`}
          >
            ← К категории {product.category.name}
          </Link>
          <Link href="/catalog">Все оборудование →</Link>
        </nav>
      </main>
    </>
  );
}

function firstView(
  value: string | string[] | undefined,
): 'grid' | 'list' | 'table' {
  const view = Array.isArray(value) ? value[0] : value;
  return view === 'list' || view === 'table' ? view : 'grid';
}
