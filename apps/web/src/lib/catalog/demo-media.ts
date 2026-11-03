import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import data from './iek-demo-data.json';
import type { PublicProductCard } from './api';

// Explicit demo allowlist. Never consult API media fields, query strings or URLs.
const identities = ['AR-M06N-1-C006', 'AR-B06S-1N-C06C030'] as const;
export function demoMediaEnabled() {
  return (
    ['development', 'test'].includes(process.env.APP_ENV ?? '') &&
    ['owner-local', 'synthetic'].includes(
      process.env.CATALOG_DEMO_MEDIA_MODE ?? '',
    )
  );
}
export function readDemoImage(asset: string) {
  if (!demoMediaEnabled()) return undefined;
  for (const product of data.products) {
    if (!identities.some((sku) => sku === product.manufacturerSKU)) continue;
    for (const image of product.images) {
      const key = `${product.slug}-${image.role === 'primary' ? 'main' : 'group'}.webp`;
      if (key !== asset) continue;
      try {
        const path = resolve(
          process.cwd(),
          '../../.local/vis-cat-01b/media',
          process.env.CATALOG_DEMO_MEDIA_MODE!,
          image.src,
        );
        if (statSync(path).size > 150_000) return undefined;
        const bytes = readFileSync(path);
        const expected =
          process.env.CATALOG_DEMO_MEDIA_MODE === 'synthetic'
            ? data.syntheticFixture.sha256
            : image.sha256;
        if (createHash('sha256').update(bytes).digest('hex') !== expected)
          return undefined;
        return bytes;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
export function getDemoMedia(product: PublicProductCard) {
  if (
    !demoMediaEnabled() ||
    product.brand?.name !== 'IEK' ||
    product.manufacturerName !== 'IEK'
  )
    return undefined;
  const item = data.products.find(
    (entry) =>
      identities.some((sku) => sku === entry.manufacturerSKU) &&
      entry.manufacturerSKU === product.originalPartNumber,
  );
  if (!item) return undefined;
  const images = item.images.flatMap((image) => {
    const asset = `${item.slug}-${image.role === 'primary' ? 'main' : 'group'}.webp`;
    if (!readDemoImage(asset)) return [];
    return [
      {
        src: `/demo-media/iek-armat/${asset}`,
        alt:
          process.env.CATALOG_DEMO_MEDIA_MODE === 'synthetic'
            ? `Синтетическая тестовая иллюстрация: ${item.displayName}`
            : image.alt,
        width: image.width,
        height: image.height,
        role: image.role,
      },
    ];
  });
  if (images[0]?.role !== 'primary') return undefined;
  return { images, summary: item.summary, item };
}
