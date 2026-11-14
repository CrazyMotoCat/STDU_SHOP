import { describe, expect, it } from 'vitest';
import { getDemoMedia } from './demo-media';
import type { PublicProductCard } from './api';
const product = {
  brand: { name: 'IEK', slug: 'iek' },
  manufacturerName: 'IEK',
  originalPartNumber: 'AR-M06N-1-C006',
} as PublicProductCard;
describe('owner-approved static media allowlist', () => {
  it('resolves only exact brand, manufacturer and factory part numbers to fixed local URLs', () => {
    const first = getDemoMedia(product),
      second = getDemoMedia({
        ...product,
        originalPartNumber: 'AR-B06S-1N-C06C030',
      });
    expect(first?.images).toHaveLength(2);
    expect(second?.images).toHaveLength(2);
    expect(first?.images[0]?.src).not.toBe(second?.images[0]?.src);
    for (const image of [...first!.images, ...second!.images])
      expect(image.src).toMatch(
        /^\/images\/catalog\/demo\/iek-armat\/ar-[a-z0-9-]+-(main|group)\.webp$/,
      );
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
});
