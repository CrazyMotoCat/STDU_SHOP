import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { useId } from 'react';

function classes(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ');
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet';
  size?: 'small' | 'medium' | 'large';
};

export function Button({
  variant = 'primary',
  size = 'medium',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      className={classes(
        'button',
        `button--${variant}`,
        `button--${size}`,
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className={classes('icon-button', className)}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export function Container({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes('container', className)} {...props} />;
}

export function Section({
  tone = 'plain',
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { tone?: 'plain' | 'soft' | 'dark' }) {
  return (
    <section
      className={classes('section', `section--${tone}`, className)}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={classes('input', className)} {...props} />;
}

export function SearchInput({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={classes('search-field', className)}>
      <svg
        aria-hidden="true"
        className="search-field__icon"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <span className="visually-hidden">{label}</span>
      <input
        className="search-field__input"
        type="search"
        aria-label={label}
        {...props}
      />
    </label>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={classes('card', className)} {...props} />;
}

export type ServiceCardProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  index: string;
  title: string;
  description: string;
  tag?: string;
  visual?: ReactNode;
};

export function ServiceCard({
  index,
  title,
  description,
  tag = 'Направление',
  visual,
  className,
  ...props
}: ServiceCardProps) {
  return (
    <a className={classes('service-card', className)} {...props}>
      <span className="service-card__topline">
        <span className="service-card__index" aria-hidden="true">
          {index}
        </span>
        {visual ? (
          <span className="service-card__visual" aria-hidden="true">
            {visual}
          </span>
        ) : null}
        <span className="service-card__tag">{tag}</span>
      </span>
      <span className="service-card__title">{title}</span>
      <span className="service-card__description">{description}</span>
      <span className="service-card__link">
        Смотреть направление
        <span aria-hidden="true">↗</span>
      </span>
    </a>
  );
}

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'accent' | 'unavailable';
}) {
  return (
    <span
      className={classes('badge', `badge--${tone}`, className)}
      {...props}
    />
  );
}

export function Status({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={classes('status-message', className)} role="status">
      <Badge tone="unavailable">{label}</Badge>
      <p>{children}</p>
    </div>
  );
}

export function NavigationLink({
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={classes('navigation-link', className)} {...props} />;
}

export type BreadcrumbItem = { label: string; href?: string };

export function Breadcrumbs({
  items,
  className,
}: {
  items: readonly BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav aria-label="Навигационная цепочка" className={className}>
      <ol className="breadcrumbs">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href && index < items.length - 1 ? (
              <NavigationLink href={item.href}>{item.label}</NavigationLink>
            ) : (
              <span
                aria-current={index === items.length - 1 ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="state-panel" aria-labelledby={titleId}>
      <p className="state-panel__eyebrow">Пока нет данных</p>
      <h2 id={titleId}>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

export function LoadingState({ label = 'Загрузка' }: { label?: string }) {
  return (
    <p className="inline-state" role="status" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorState({
  title = 'Не удалось загрузить данные',
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="state-panel state-panel--error" role="alert">
      <p className="state-panel__eyebrow">Ошибка</p>
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

export type TechnicalColumn = { key: string; label: string };

export function TechnicalDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: readonly TechnicalColumn[];
  rows: readonly Readonly<Record<string, ReactNode>>[];
}) {
  return (
    <div className="technical-table">
      <table className="technical-table__wide">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column.key}>{row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="technical-table__stacked" aria-label={caption}>
        {rows.map((row, rowIndex) => (
          <li className="technical-table__record" key={rowIndex}>
            <dl>
              {columns.map((column) => (
                <div key={column.key}>
                  <dt>{column.label}</dt>
                  <dd>{row[column.key]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
