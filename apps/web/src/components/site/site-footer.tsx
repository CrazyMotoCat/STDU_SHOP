import { Container } from '../ui/primitives';

export function SiteFooter() {
  return (
    <footer className="site-footer" id="platform-status">
      <Container className="site-footer__inner">
        <a className="site-footer__brand" href="#main">
          STDU <span>SHOP</span>
        </a>
        <p>Оборудование · электрощиты · проектирование и программирование</p>
        <p className="site-footer__note">
          Публичные сервисы платформы подключаются поэтапно.
        </p>
      </Container>
    </footer>
  );
}
