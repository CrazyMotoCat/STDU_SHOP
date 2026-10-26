import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PublicLayout } from '../../components/layouts/page-layouts';
import { getPublicPageRobots } from '../../lib/seo';

export const metadata: Metadata = {
  robots: getPublicPageRobots(),
};

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return <PublicLayout>{children}</PublicLayout>;
}
