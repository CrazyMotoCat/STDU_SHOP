import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogTestSiteEnabled } from './test-site-config';
import {
  getPublicProduct,
  listPublicCategories,
  searchPublicProducts,
} from './api';
import { demoProducts, makeDemoProducts } from './demo-products';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('explicit staging catalog boundary', () => {
  it('requires APP_ENV=test and exact opt-in; NODE_ENV never enables it', () => {
    expect(
      catalogTestSiteEnabled({
        APP_ENV: 'test',
        CATALOG_TEST_SITE_ENABLED: 'true',
        NODE_ENV: 'production',
      }),
    ).toBe(true);
    for (const env of [
      {},
      { APP_ENV: 'production', CATALOG_TEST_SITE_ENABLED: 'true' },
      { APP_ENV: 'development', CATALOG_TEST_SITE_ENABLED: 'true' },
      { APP_ENV: 'test' },
      { APP_ENV: 'test', CATALOG_TEST_SITE_ENABLED: '1' },
      { NODE_ENV: 'test', CATALOG_TEST_SITE_ENABLED: 'true' },
    ])
      expect(catalogTestSiteEnabled(env)).toBe(false);
  });
  it('uses the normal API in production/default, including on failures and matching demo slugs', async () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('CATALOG_TEST_SITE_ENABLED', 'true');
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    expect(await getPublicProduct(demoProducts[0]!.slug)).toEqual({
      ok: false,
      kind: 'unavailable',
    });
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('CATALOG_TEST_SITE_ENABLED', '');
    expect(await searchPublicProducts({ q: 'AR-M06N-1-C006' })).toEqual({
      ok: false,
      kind: 'unavailable',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('serves categories/search/details with no API calls only under explicit staging config', async () => {
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('CATALOG_TEST_SITE_ENABLED', 'true');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const categories = await listPublicCategories();
    expect(categories.ok && categories.data.data).toHaveLength(2);
    const leaf = await listPublicCategories({ parentSlug: 'rcbo' });
    expect(leaf.ok && leaf.data.data).toHaveLength(0);
    const found = await searchPublicProducts({ q: 'AR-B06S-1N-C06C030' });
    expect(found.ok && found.data.data).toHaveLength(1);
    const scoped = await searchPublicProducts({ categorySlug: 'breakers' });
    expect(scoped.ok && scoped.data.data[0]?.originalPartNumber).toBe(
      'AR-M06N-1-C006',
    );
    expect(await getPublicProduct('not-a-product')).toEqual({
      ok: false,
      kind: 'not-found',
    });
    expect(
      await searchPublicProducts({ filter: ['rated_current:eq:6'] }),
    ).toEqual({ ok: false, kind: 'validation' });
    expect(fetch).not.toHaveBeenCalled();
    expect(makeDemoProducts()).toEqual(makeDemoProducts());
    expect(demoProducts.map((p) => p.attributes)).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            attributeCode: 'rated_operating_voltage',
            value: 400,
          }),
        ]),
        expect.arrayContaining([
          expect.objectContaining({
            attributeCode: 'rated_operating_voltage',
            value: 230,
          }),
        ]),
      ]),
    );
  });
});
