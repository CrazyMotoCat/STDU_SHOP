import data from './iek-demo-data.json';
import type { PublicProductCard } from './api';

// Four owner-approved static assets. No API URLs, filesystem paths or upload IDs.
const identities = ['AR-M06N-1-C006', 'AR-B06S-1N-C06C030'] as const;
export function getDemoMedia(product: PublicProductCard) {
  if (product.brand?.name !== 'IEK' || product.manufacturerName !== 'IEK')
    return undefined;
  const item = data.products.find(
    (entry) =>
      identities.some((sku) => sku === entry.manufacturerSKU) &&
      entry.manufacturerSKU === product.originalPartNumber,
  );
  if (!item) return undefined;
  return {
    item,
    summary: item.summary,
    images: item.images.map((image) => ({
      src: image.publicSrc,
      alt: image.alt,
      width: image.width,
      height: image.height,
      role: image.role,
    })),
  };
}
