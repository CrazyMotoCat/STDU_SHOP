import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NO_INDEX_ROBOTS } from '../lib/seo';
import './styles.css';

export const metadata: Metadata = {
  title: 'SHOP-STDU — оборудование и инженерные решения',
  description:
    'Промышленное электротехническое оборудование, электрощиты, проектирование и программирование.',
  robots: NO_INDEX_ROBOTS,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
