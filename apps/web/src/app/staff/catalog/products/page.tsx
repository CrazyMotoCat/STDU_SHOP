import type { Metadata } from 'next';
import CatalogProductsWorkspace from './workspace';

export const metadata: Metadata = {
  title: 'Управление товарами | SHOP-STDU',
  robots: { index: false, follow: false },
};

export default function CatalogProductsPage() {
  return <CatalogProductsWorkspace />;
}
