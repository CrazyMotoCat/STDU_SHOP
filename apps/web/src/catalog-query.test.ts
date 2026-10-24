import { describe, expect, it } from 'vitest';
import {
  categoryHref,
  hrefWithQuery,
  productFiltersFromSearchParams,
  productQueryFromSearchParams,
  technicalFilterHref,
} from './lib/catalog/query';

describe('public catalog URL contract', () => {
  it('parses the frozen search, sort and pagination parameters', () => {
    const query = productQueryFromSearchParams({
      q: '   ACB-100   ',
      brandSlug: 'acme',
      sort: 'part_number_asc',
      page: '4',
      pageSize: '48',
      categorySlug: 'breakers',
      includeDescendants: 'true',
      filter: ['voltage:gte:220', 'poles:eq:3'],
    });

    expect(query).toMatchObject({
      q: '   ACB-100   ',
      brandSlug: 'acme',
      sort: 'part_number_asc',
      page: 4,
      pageSize: 48,
      categorySlug: 'breakers',
      includeDescendants: true,
      filter: ['voltage:gte:220', 'poles:eq:3'],
    });
    expect(
      productFiltersFromSearchParams({ filter: ['a:eq:1', 'b:eq:2'] }),
    ).toEqual(['a:eq:1', 'b:eq:2']);
  });

  it('falls back to safe pagination and sort values for malformed URLs', () => {
    expect(
      productQueryFromSearchParams({
        page: '0',
        pageSize: '1000',
        sort: 'random',
      }),
    ).toMatchObject({ page: 1, pageSize: 24, sort: 'name_asc' });
  });

  it('carries the parent path in a nested category URL', () => {
    expect(categoryHref(['switchgear', 'breakers', 'mcb'])).toBe(
      '/catalog/category/mcb?ancestor=switchgear&ancestor=breakers',
    );
  });

  it('preserves filters when switching views or pages', () => {
    const source = {
      q: 'ACB',
      categorySlug: 'breakers',
      includeDescendants: 'false',
      filter: ['voltage:gte:220'],
      page: '2',
      view: 'grid',
    };

    expect(
      hrefWithQuery('/catalog/category/breakers', source, { view: 'table' }),
    ).toBe(
      '/catalog/category/breakers?q=ACB&categorySlug=breakers&includeDescendants=false&filter=voltage%3Agte%3A220&page=2&view=table',
    );
  });

  it('always scopes technical filters to one category and explicitly disables descendants', () => {
    const href = technicalFilterHref(
      '/catalog/category/breakers',
      'q=ACB&page=3&categoryCursor=stale&filter=old%3Aeq%3A1',
      'breakers',
      ['voltage:gte:220', 'poles:eq:3'],
    );
    const query = new URL(href, 'http://localhost').searchParams;

    expect(query.get('categorySlug')).toBe('breakers');
    expect(query.get('includeDescendants')).toBe('false');
    expect(query.getAll('filter')).toEqual(['voltage:gte:220', 'poles:eq:3']);
    expect(query.get('page')).toBeNull();
    expect(query.get('categoryCursor')).toBeNull();
  });
});
