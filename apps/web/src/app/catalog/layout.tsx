import type { ReactNode } from 'react';
import { PublicLayout } from '../../components/layouts/page-layouts';

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return <PublicLayout>{children}</PublicLayout>;
}
