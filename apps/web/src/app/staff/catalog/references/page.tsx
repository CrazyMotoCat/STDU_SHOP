import type { Metadata } from 'next';
import ReferencesWorkspace from './workspace';

export const metadata: Metadata = {
  title: 'Справочники каталога | SHOP-STDU',
  robots: { index: false, follow: false },
};

export default function CatalogReferencesPage() {
  return <ReferencesWorkspace />;
}
