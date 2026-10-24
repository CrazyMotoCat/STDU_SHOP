import Image from 'next/image';
import { PublicLayout } from '../components/layouts/page-layouts';
import { SwitchgearIllustration } from '../components/site/switchgear-illustration';
import { EngineeringMotionShowcase } from '../components/visual/engineering-motion-showcase';
import {
  Badge,
  Breadcrumbs,
  Button,
  Container,
  SearchInput,
  Section,
  ServiceCard,
  Status,
} from '../components/ui/primitives';

const directions = [
  {
    id: 'equipment',
    index: '01',
    title: 'Оборудование',
    description: 'Точная идентификация компонентов для промышленных систем.',
    visual: 'equipment',
  },
  {
    id: 'panels',
    index: '02',
    title: 'Изготовление электрощитов',
    description: 'Типовые и индивидуальные шкафы с инженерной проработкой.',
    visual: 'panel',
  },
  {
    id: 'engineering',
    index: '03',
    title: 'Проектирование и программирование',
    description:
      'Инженерная проработка решений для управления промышленными процессами.',
    visual: 'engineering',
  },
] as const;

function DirectionVisual({
  type,
}: {
  type: (typeof directions)[number]['visual'];
}) {
  if (type === 'panel') {
    return (
      <span className="direction-media direction-media--panel">
        <Image
          src="/images/engineering/cabinet-industrial.webp"
          alt=""
          fill
          sizes="(max-width: 760px) 128px, 400px"
        />
        <span className="direction-media__caption">Фото: ОВЕН</span>
      </span>
    );
  }

  if (type === 'engineering') {
    return (
      <span className="direction-media direction-media--engineering">
        <svg aria-hidden="true" fill="none" viewBox="0 0 340 160">
          <path d="M24 35H110V80H230V126H316M24 126H85V80M230 80V35H316" />
          <circle cx="24" cy="35" r="4" />
          <circle cx="316" cy="126" r="4" />
          <circle cx="316" cy="35" r="4" />
        </svg>
        <Image
          src="/images/engineering/controller-owen.webp"
          alt=""
          width={398}
          height={426}
          sizes="(max-width: 760px) 110px, 190px"
        />
      </span>
    );
  }

  return (
    <span className="direction-media direction-media--equipment">
      <Image
        src="/images/engineering/breaker-iek.webp"
        alt=""
        width={480}
        height={477}
        sizes="(max-width: 760px) 75px, 160px"
      />
      <Image
        src="/images/engineering/power-meanwell-hdr60.webp"
        alt=""
        width={395}
        height={624}
        sizes="(max-width: 760px) 60px, 135px"
      />
    </span>
  );
}

export default function Home() {
  return (
    <PublicLayout>
      <main id="main" tabIndex={-1}>
        <Section aria-labelledby="hero-title" className="hero-section">
          <Container className="hero-grid">
            <div className="hero-copy">
              <Breadcrumbs
                className="hero-breadcrumbs"
                items={[{ label: 'Главная' }]}
              />
              <Badge className="hero-badge" tone="accent">
                Электротехнические решения
              </Badge>
              <h1 id="hero-title">
                Инженерная точность
                <br />
                <span>на каждом этапе.</span>
              </h1>
              <p className="hero-copy__intro">
                Промышленное электротехническое оборудование, проектирование
                электрощитов и программирование систем управления.
              </p>
            </div>

            <div className="hero-visual hero-visual--photo">
              <figure className="hero-reference">
                <div className="hero-reference__image">
                  <Image
                    src="/images/engineering/cabinet-dispatch.webp"
                    alt="Реальный шкаф диспетчеризации: контроллер Wiren Board, аппараты защиты, блок питания и реле на DIN-рейках"
                    width={1200}
                    height={1178}
                    sizes="(max-width: 760px) 100vw, 50vw"
                    preload
                  />
                  <span className="hero-reference__label">
                    Системы управления
                  </span>
                </div>
                <figcaption className="hero-reference__caption">
                  <div>
                    <strong>Инженерия в каждой связи.</strong>
                    <a
                      href="https://habr.com/ru/companies/wirenboard/articles/992886/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Пример компоновки · фото Wiren Board ↗
                    </a>
                  </div>
                  <div className="hero-reference__scheme">
                    <SwitchgearIllustration />
                    <span>Условная схема</span>
                  </div>
                </figcaption>
              </figure>
            </div>

            <div className="hero-tools-area">
              <div
                className="hero-tools"
                aria-label="Будущие возможности платформы"
              >
                <SearchInput
                  aria-describedby="unavailable-actions"
                  disabled
                  label="Поиск по каталогу — пока недоступен"
                  placeholder="Поиск по каталогу"
                />
                <div className="hero-tools__actions">
                  <Button
                    aria-describedby="unavailable-actions"
                    disabled
                    size="small"
                    variant="secondary"
                  >
                    Загрузить спецификацию
                  </Button>
                  <Button
                    aria-describedby="unavailable-actions"
                    disabled
                    size="small"
                  >
                    Запросить КП
                  </Button>
                </div>
              </div>
              <p className="visually-hidden" id="unavailable-actions">
                Поиск, загрузка файлов и отправка коммерческих запросов пока
                недоступны. Подключение этих сервисов запланировано на следующих
                этапах разработки.
              </p>
              <Status className="hero-status" label="Сервисы пока недоступны">
                Поиск, загрузка спецификации и запрос КП появятся после запуска
                соответствующих сервисов.
              </Status>
              <a className="hero-scroll-link" href="#directions">
                <span aria-hidden="true">↓</span>
                Посмотреть направления
              </a>
            </div>
          </Container>
          <div className="hero-section__rule" aria-hidden="true" />
        </Section>

        <Section
          aria-labelledby="directions-title"
          className="directions-section"
          id="directions"
          tone="soft"
        >
          <Container>
            <div className="section-heading">
              <div>
                <p className="eyebrow">ОСНОВНЫЕ НАПРАВЛЕНИЯ</p>
                <h2 id="directions-title">Три направления. Единая логика.</h2>
              </div>
              <p>
                Единый подход опирается на точные исходные данные и инженерную
                проработку.
              </p>
            </div>
            <div className="service-grid">
              {directions.map((direction) => (
                <ServiceCard
                  className="service-card--direction service-card--photo"
                  description={direction.description}
                  href={`#${direction.id}`}
                  id={direction.id}
                  index={direction.index}
                  key={direction.id}
                  title={direction.title}
                  visual={<DirectionVisual type={direction.visual} />}
                />
              ))}
            </div>
          </Container>
        </Section>

        <Section aria-labelledby="overview-title" className="overview-section">
          <Container>
            <div className="section-heading section-heading--compact">
              <div>
                <p className="eyebrow">СТРУКТУРА ПЛАТФОРМЫ</p>
                <h2 id="overview-title">Инженерная схема.</h2>
              </div>
              <p>
                Схема показывает, как компоненты, компоновка шкафа и управление
                связаны в одном решении.
              </p>
            </div>

            <EngineeringMotionShowcase />

            <div className="engineering-principle">
              <span className="engineering-principle__label">
                ИНЖЕНЕРНЫЙ ПОДХОД
              </span>
              <p>
                Техническое решение формируется по исходной документации и
                проходит проверку инженером.
              </p>
            </div>
          </Container>
        </Section>

        <Section className="closing-section" tone="dark">
          <Container className="closing-section__inner">
            <div>
              <p className="eyebrow">GRAPHITE &amp; PETROL</p>
              <h2>Инженерная ясность начинается с исходных данных.</h2>
            </div>
            <p>
              STDU SHOP — платформа для последовательной инженерной проработки.
            </p>
          </Container>
        </Section>
      </main>
    </PublicLayout>
  );
}
