import type { Metadata } from 'next';
import IngestionWorkspace from './workspace';

export const metadata: Metadata = {
  title: 'Обработка предложений поставщиков | SHOP-STDU',
  robots: { index: false, follow: false },
};

export default function SupplierIngestionPage() {
  return <IngestionWorkspace />;
}
