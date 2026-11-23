import type { Metadata } from 'next';
import { connection } from 'next/server';
import IngestionWorkspace from './workspace';

export const metadata: Metadata = {
  title: 'Обработка предложений поставщиков | SHOP-STDU',
  robots: { index: false, follow: false },
};

export default async function SupplierIngestionPage() {
  await connection();
  return (
    <IngestionWorkspace
      reconcileCreateEnabled={
        process.env.SUPPLIER_INGESTION_RECONCILE_CREATE_ENABLED === 'true'
      }
      reconcileUpdateEnabled={
        process.env.SUPPLIER_INGESTION_RECONCILE_UPDATE_ENABLED === 'true'
      }
      editsEnabled={process.env.SUPPLIER_INGESTION_CLEAR_ENABLED === 'true'}
    />
  );
}
