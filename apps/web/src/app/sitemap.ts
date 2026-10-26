import type { MetadataRoute } from 'next';
import { getPublicSeoConfig } from '../lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const { origin, indexingEnabled } = getPublicSeoConfig();
  if (!indexingEnabled || !origin) return [];
  return ['/', '/catalog', '/panels', '/engineering'].map((path) => ({
    url: new URL(path, origin).href,
  }));
}
