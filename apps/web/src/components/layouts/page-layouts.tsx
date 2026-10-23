import type { HTMLAttributes, ReactNode } from 'react';
import { SiteFooter } from '../site/site-footer';
import { SiteHeader } from '../site/site-header';
import { Container } from '../ui/primitives';

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <SiteHeader />
      {children}
      <SiteFooter />
    </>
  );
}

export function CatalogLayout({
  children,
  filters,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode; filters?: ReactNode }) {
  return (
    <section className="container catalog-layout" {...props}>
      {filters ? (
        <aside className="catalog-layout__filters">{filters}</aside>
      ) : null}
      <div className="catalog-layout__content">{children}</div>
    </section>
  );
}

export function ServiceLayout({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Container className="service-layout">
      <article className="service-layout__content">{children}</article>
      {aside ? <aside className="service-layout__aside">{aside}</aside> : null}
    </Container>
  );
}

export function StaffLayout({ children }: { children: ReactNode }) {
  return <div className="staff-layout">{children}</div>;
}
