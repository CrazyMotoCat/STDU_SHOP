import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SiteHeader } from './components/site/site-header';
import {
  Badge,
  Breadcrumbs,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  SearchInput,
  ServiceCard,
  TechnicalDataTable,
} from './components/ui/primitives';

describe('R1-003 UI foundation server rendering', () => {
  it('renders typed buttons with variants and disabled state', () => {
    const html = renderToStaticMarkup(
      <div>
        <Button variant="secondary" disabled>
          Запрос КП
        </Button>
        <Badge tone="unavailable">Раздел готовится</Badge>
      </div>,
    );

    expect(html).toContain('class="button button--secondary button--medium"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Запрос КП');
    expect(html).toContain('Раздел готовится');
  });

  it('renders a labelled search field without implying it is active', () => {
    const html = renderToStaticMarkup(
      <SearchInput
        disabled
        label="Поиск по каталогу — пока недоступен"
        placeholder="Поиск по каталогу"
      />,
    );

    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Поиск по каталогу — пока недоступен"');
    expect(html).toContain('disabled=""');
  });

  it('renders breadcrumbs with a current page marker and real anchor targets', () => {
    const html = renderToStaticMarkup(
      <Breadcrumbs
        items={[{ label: 'Главная', href: '#main' }, { label: 'Направления' }]}
      />,
    );

    expect(html).toContain('aria-label="Навигационная цепочка"');
    expect(html).toContain('href="#main"');
    expect(html).toContain('aria-current="page"');
  });

  it('renders desktop tables and a labelled mobile record pattern', () => {
    const html = renderToStaticMarkup(
      <TechnicalDataTable
        caption="Технические параметры"
        columns={[
          { key: 'name', label: 'Параметр' },
          { key: 'value', label: 'Значение' },
        ]}
        rows={[{ name: 'Напряжение', value: '24 В' }]}
      />,
    );

    expect(html).toContain('<table');
    expect(html).toContain('<th scope="col">Параметр</th>');
    expect(html).toContain('class="technical-table__stacked"');
    expect(html).toContain('<dt>Параметр</dt><dd>Напряжение</dd>');
    expect(html).toContain('<dt>Значение</dt><dd>24 В</dd>');
  });

  it('renders explicit empty, loading, and error semantics', () => {
    const html = renderToStaticMarkup(
      <div>
        <EmptyState title="Нет позиций">Данные появятся позже.</EmptyState>
        <EmptyState title="Нет файлов">Загрузите данные позже.</EmptyState>
        <LoadingState label="Загрузка" />
        <ErrorState>Попробуйте позже.</ErrorState>
      </div>,
    );

    expect(html).toContain('Пока нет данных');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="alert"');
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renders service cards as named links instead of action buttons', () => {
    const html = renderToStaticMarkup(
      <ServiceCard
        description="Описание направления."
        href="#equipment"
        index="01"
        title="Оборудование"
      />,
    );

    expect(html).toContain('<a class="service-card" href="#equipment">');
    expect(html).toContain('Оборудование');
    expect(html).not.toContain('<button');
  });

  it('renders responsive navigation in its closed, labelled state', () => {
    const html = renderToStaticMarkup(<SiteHeader />);

    expect(html).toContain('aria-label="Основная навигация"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Открыть меню"');
    expect(html).toContain('aria-controls="mega-panel-equipment"');
    expect(html).toContain('disabled=""');
  });
});
