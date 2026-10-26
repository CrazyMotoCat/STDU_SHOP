import type { MetadataRoute } from 'next';
import { getPublicSeoConfig } from '../lib/seo';

export default function robots(): MetadataRoute.Robots {
  const { origin, indexingEnabled } = getPublicSeoConfig();
  if (!indexingEnabled || !origin) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/staff', '/request-quote'],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
