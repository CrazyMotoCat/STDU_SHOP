import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import {
  getPublicPageRobots,
  getPublicSeoConfig,
  NO_INDEX_ROBOTS,
} from './seo';

const publicEnv = {
  APP_ENV: 'production',
  PUBLIC_SITE_INDEXING_ENABLED: 'true',
  PUBLIC_WEB_ORIGIN: 'https://seo-fixture.example/',
};

afterEach(() => vi.unstubAllEnvs());

describe('public SEO configuration', () => {
  it('requires explicit production opt-in and a valid public origin', () => {
    expect(getPublicSeoConfig(publicEnv)).toEqual({
      origin: 'https://seo-fixture.example',
      indexingEnabled: true,
    });
    for (const override of [
      { APP_ENV: 'development' },
      { APP_ENV: 'preview' },
      { PUBLIC_SITE_INDEXING_ENABLED: undefined },
      { PUBLIC_SITE_INDEXING_ENABLED: 'false' },
      { PUBLIC_WEB_ORIGIN: undefined },
    ]) {
      expect(
        getPublicSeoConfig({ ...publicEnv, ...override }).indexingEnabled,
      ).toBe(false);
    }
  });

  it.each([
    'not-a-url',
    'http://seo-fixture.example',
    'https://localhost',
    'https://preview.localhost',
    'https://shop.internal',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://[::1]',
    'https://user:password@seo-fixture.example',
    'https://seo-fixture.example/path',
    'https://seo-fixture.example?q=1',
    'https://seo-fixture.example/#fragment',
  ])('rejects unsafe or non-origin configuration: %s', (origin) => {
    expect(
      getPublicSeoConfig({ ...publicEnv, PUBLIC_WEB_ORIGIN: origin }),
    ).toEqual({
      origin: undefined,
      indexingEnabled: false,
    });
  });

  it('generates only the four approved URLs and excludes staff and RFQ', () => {
    for (const [key, value] of Object.entries(publicEnv))
      vi.stubEnv(key, value);
    expect(sitemap().map(({ url }) => url)).toEqual([
      'https://seo-fixture.example/',
      'https://seo-fixture.example/catalog',
      'https://seo-fixture.example/panels',
      'https://seo-fixture.example/engineering',
    ]);
    expect(robots()).toEqual({
      rules: {
        userAgent: '*',
        allow: '/',
        disallow: ['/staff', '/request-quote'],
      },
      sitemap: 'https://seo-fixture.example/sitemap.xml',
    });
    expect(getPublicPageRobots().index).toBe(true);
  });

  it('fails closed without inventing absolute URLs', () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('PUBLIC_SITE_INDEXING_ENABLED', 'true');
    vi.stubEnv('PUBLIC_WEB_ORIGIN', undefined);
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
    expect(sitemap()).toEqual([]);
    expect(getPublicPageRobots()).toEqual(NO_INDEX_ROBOTS);
  });
});
