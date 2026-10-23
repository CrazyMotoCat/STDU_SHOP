import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: 'STDU SHOP — оборудование и инженерные решения',
  description:
    'Промышленное электротехническое оборудование, электрощиты, проектирование и программирование.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
