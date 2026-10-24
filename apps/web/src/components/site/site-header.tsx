'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Container } from '../ui/primitives';
import { CatalogSearch } from './catalog-search';

const directions = [
  {
    id: 'equipment',
    label: 'Оборудование',
    href: '/catalog',
    description: 'Промышленные электротехнические компоненты.',
  },
  {
    id: 'panels',
    label: 'Электрощиты',
    href: '/#panels',
    description: 'Типовые и индивидуальные шкафы управления.',
  },
  {
    id: 'engineering',
    label: 'Проектирование',
    href: '/#engineering',
    description: 'Проектирование и программирование систем.',
  },
] as const;

export function SiteHeader() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () =>
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const triggerId = target.dataset.menuTrigger;
    const menuId = target.dataset.menuLink;
    const menuIndex = Number(target.dataset.menuIndex);

    if (event.key === 'Escape') {
      event.preventDefault();
      if (openMenu) {
        const trigger = triggerRefs.current[openMenu];
        setOpenMenu(null);
        requestAnimationFrame(() => trigger?.focus());
      } else if (mobileOpen) {
        setMobileOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
      return;
    }

    if (event.key === 'ArrowDown' && triggerId) {
      event.preventDefault();
      setOpenMenu(triggerId);
      requestAnimationFrame(() =>
        menuLinkRefs.current[`${triggerId}-0`]?.focus(),
      );
      return;
    }

    if (menuId && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const menuLinkCount = 2;
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? menuLinkCount - 1
            : (menuIndex +
                (event.key === 'ArrowDown' ? 1 : -1) +
                menuLinkCount) %
              menuLinkCount;
      event.preventDefault();
      menuLinkRefs.current[`${menuId}-${next}`]?.focus();
    }
  }

  function closeWhenFocusLeaves(event: React.FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpenMenu(null);
      setMobileOpen(false);
    }
  }

  function handlePointerLeave(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse') setOpenMenu(null);
  }

  return (
    <header
      className="site-header"
      onBlurCapture={closeWhenFocusLeaves}
      onKeyDown={handleKeyDown}
      ref={headerRef}
    >
      <span className="visually-hidden" id="service-availability">
        Отправка запросов КП пока недоступна.
      </span>
      <div className="site-header__top">
        <Container className="site-header__top-inner">
          <a
            className="brand"
            href="/#main"
            aria-label="STDU SHOP — на главную"
          >
            <span className="brand__mark" aria-hidden="true">
              S
            </span>
            <span className="brand__wordmark">
              <strong>STDU</strong>
              <span>SHOP / ENGINEERING</span>
            </span>
          </a>
          <p className="site-header__descriptor">
            Промышленное оборудование и инженерные решения
          </p>
          <button
            aria-controls="primary-navigation"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Закрыть меню' : 'Открыть меню'}
            className="mobile-menu-toggle"
            onClick={() => {
              setMobileOpen((value) => !value);
              setOpenMenu(null);
            }}
            ref={menuButtonRef}
            type="button"
          >
            <span aria-hidden="true" className="mobile-menu-toggle__icon">
              <span />
              <span />
            </span>
            <span className="mobile-menu-toggle__label">Меню</span>
          </button>
        </Container>
      </div>

      <div className="site-header__bottom">
        <Container className="site-header__bottom-inner">
          <nav
            aria-label="Основная навигация"
            className="site-nav"
            data-mobile-open={mobileOpen}
            id="primary-navigation"
            onPointerLeave={handlePointerLeave}
          >
            <ul className="site-nav__list">
              {directions.map((direction) => {
                if (direction.id === 'equipment') {
                  return (
                    <li
                      className="site-nav__item"
                      key={direction.id}
                      onPointerEnter={() => setOpenMenu(null)}
                    >
                      <a
                        className="site-nav__trigger"
                        href={direction.href}
                        onClick={() => {
                          setOpenMenu(null);
                          setMobileOpen(false);
                        }}
                      >
                        {direction.label}
                      </a>
                    </li>
                  );
                }
                const expanded = openMenu === direction.id;
                const panelId = `mega-panel-${direction.id}`;
                return (
                  <li
                    className="site-nav__item"
                    key={direction.id}
                    onPointerEnter={(event) => {
                      if (event.pointerType === 'mouse')
                        setOpenMenu(direction.id);
                    }}
                  >
                    <button
                      aria-controls={panelId}
                      aria-expanded={expanded}
                      className="site-nav__trigger"
                      data-menu-trigger={direction.id}
                      onClick={() =>
                        setOpenMenu(expanded ? null : direction.id)
                      }
                      ref={(node) => {
                        triggerRefs.current[direction.id] = node;
                      }}
                      type="button"
                    >
                      {direction.label}
                      <svg aria-hidden="true" viewBox="0 0 16 16">
                        <path d="m3 6 5 5 5-5" />
                      </svg>
                    </button>
                    <div
                      className="mega-panel"
                      hidden={!expanded}
                      id={panelId}
                      role="group"
                      aria-label={`${direction.label}: подменю`}
                    >
                      <div className="mega-panel__intro">
                        <span className="mega-panel__eyebrow">Направление</span>
                        <p>{direction.description}</p>
                      </div>
                      <a
                        className="mega-panel__link"
                        data-menu-index="0"
                        data-menu-link={direction.id}
                        href={direction.href}
                        onClick={() => {
                          setOpenMenu(null);
                          setMobileOpen(false);
                        }}
                        ref={(node) => {
                          menuLinkRefs.current[`${direction.id}-0`] = node;
                        }}
                      >
                        <span>Перейти к разделу</span>
                        <span aria-hidden="true">↗</span>
                      </a>
                      <a
                        className="mega-panel__secondary-link"
                        data-menu-index="1"
                        data-menu-link={direction.id}
                        href="#platform-status"
                        onClick={() => {
                          setOpenMenu(null);
                          setMobileOpen(false);
                        }}
                        ref={(node) => {
                          menuLinkRefs.current[`${direction.id}-1`] = node;
                        }}
                      >
                        О статусе платформы
                      </a>
                      <p className="mega-panel__note">
                        Информация и сервисы подключаются поэтапно.
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="site-header__actions">
            <CatalogSearch label="Поиск в каталоге из шапки" />
            <Button
              aria-describedby="service-availability"
              className="header-quote-button"
              disabled
              size="small"
              variant="secondary"
            >
              Запрос КП
            </Button>
          </div>
        </Container>
      </div>
    </header>
  );
}
