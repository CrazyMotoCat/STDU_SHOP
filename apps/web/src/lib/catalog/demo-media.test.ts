import { afterEach, describe, expect, it, vi } from 'vitest';
import data from './iek-demo-data.json';
import { getDemoMedia, readDemoImage } from './demo-media';
import { readFileSync, statSync } from 'node:fs';
import type { PublicProductCard } from './api';
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), statSync: vi.fn() }));
const product = {
  brand: { name: 'IEK', slug: 'iek' },
  manufacturerName: 'IEK',
  originalPartNumber: 'AR-M06N-1-C006',
} as PublicProductCard;
function enable() {
  vi.stubEnv('APP_ENV', 'test');
  vi.stubEnv('CATALOG_DEMO_MEDIA_MODE', 'synthetic');
  vi.mocked(readFileSync).mockReturnValue(
    Buffer.from(data.syntheticFixture.base64, 'base64'),
  );
  vi.mocked(statSync).mockReturnValue({ size: 1000 } as ReturnType<
    typeof statSync
  >);
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe('two-SKU local demo media boundary', () => {
  it('only resolves the exact brand, manufacturer and factory part number', () => {
    enable();
    expect(getDemoMedia(product)?.images).toHaveLength(2);
    expect(
      getDemoMedia({ ...product, originalPartNumber: 'AR-B06S-1N-C06C030' })
        ?.images,
    ).toHaveLength(2);
    for (const change of [
      { brand: null },
      { brand: { name: 'Other', slug: 'other' } },
      { manufacturerName: 'Other' },
      { originalPartNumber: 'ar-m06n-1-c006' },
      { originalPartNumber: 'AR-M06N-1-C006-fake' },
      { originalPartNumber: null },
    ])
      expect(getDemoMedia({ ...product, ...change })).toBeUndefined();
  });
  it('is off by default, in production, and with malformed configuration', () => {
    enable();
    vi.stubEnv('CATALOG_DEMO_MEDIA_MODE', '');
    expect(getDemoMedia(product)).toBeUndefined();
    vi.stubEnv('CATALOG_DEMO_MEDIA_MODE', 'invalid');
    expect(getDemoMedia(product)).toBeUndefined();
    vi.stubEnv('CATALOG_DEMO_MEDIA_MODE', 'synthetic');
    vi.stubEnv('APP_ENV', 'production');
    expect(getDemoMedia(product)).toBeUndefined();
  });
  it('rejects arbitrary asset names, missing and corrupted files', () => {
    enable();
    expect(readDemoImage('../manifest.json')).toBeUndefined();
    expect(readDemoImage('https://example.invalid/image.webp')).toBeUndefined();
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('missing');
    });
    expect(getDemoMedia(product)).toBeUndefined();
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('corrupted'));
    expect(getDemoMedia(product)).toBeUndefined();
  });
});
