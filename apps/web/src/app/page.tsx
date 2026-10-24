import Image from 'next/image';
import './home.css';
import { PublicLayout } from '../components/layouts/page-layouts';
import { CatalogSearch } from '../components/site/catalog-search';
import { SwitchgearIllustration } from '../components/site/switchgear-illustration';
import { EngineeringMotionShowcase } from '../components/visual/engineering-motion-showcase';
import {
  Badge,
  Breadcrumbs,
  Button,
  Container,
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
          sizes="(max-width: 760px) 100vw, 440px"
        />
        <span className="direction-media__caption">Фото: ОВЕН</span>
      </span>
    );
  }

  if (type === 'engineering') {
    return (
      <span className="direction-media direction-media--engineering">
        <Image
          src="/images/engineering/ai-relay-detail-concept.webp"
          alt=""
          fill
          sizes="(max-width: 760px) 100vw, 440px"
        />
        <span className="direction-media__caption">
          AI-концепт · по референсу WB
        </span>
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
        sizes="(max-width: 760px) 140px, 200px"
      />
      <Image
        src="/images/engineering/power-meanwell-hdr60.webp"
        alt=""
        width={395}
        height={624}
        sizes="(max-width: 760px) 110px, 170px"
      />
    </span>
  );
}

export default function Home() {
  return (
    <PublicLayout>
      <main className="home-page" id="main" tabIndex={-1}>
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
                aria-label="Поиск оборудования и сервисы платформы"
              >
                <CatalogSearch label="Поиск оборудования на главной" />
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
                Загрузка файлов и отправка коммерческих запросов пока
                недоступны. Подключение этих сервисов запланировано на следующих
                этапах разработки.
              </p>
              <Status
                className="hero-status"
                label="КП и файлы пока недоступны"
              >
                Загрузка спецификации и запрос КП появятся после запуска
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
                  href={
                    direction.id === 'equipment'
                      ? '/catalog'
                      : `#${direction.id}`
                  }
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
          <Image
            className="closing-section__photo"
            src="/images/engineering/ai-workshop-concept.webp"
            alt=""
            fill
            sizes="100vw"
          />
          <Container className="closing-section__inner">
            <svg
              aria-hidden="true"
              className="closing-section__circuit"
              viewBox="0 0 420 120"
              fill="none"
            >
              <g stroke="currentColor" strokeWidth="1">
                <path d="M0 60h80m64 0h66m64 0h66m64 0h16M32 50v20m-6-15h12m-12 10h12" />
                <rect x="80" y="22" width="64" height="76" rx="4" />
                <rect x="210" y="22" width="64" height="76" rx="4" />
                <rect x="340" y="22" width="64" height="76" rx="4" />
                <path d="M94 38h36m-36 44h36m94-44h36m-36 44h36m94-44h36m-36 44h36M106 48v24m12-24v24m118-24v24m12-24v24m112-24h24m-24 8h24m-24 8h24" />
                <path d="M8 8h20M8 8v20m404 64v20h-20" opacity="0.5" />
              </g>
              <g fill="currentColor">
                <circle cx="177" cy="60" r="2.5" />
                <circle cx="307" cy="60" r="2.5" />
              </g>
            </svg>
            <div>
              <p className="eyebrow">GRAPHITE &amp; PETROL</p>
              <h2>Инженерная ясность начинается с исходных данных.</h2>
            </div>
            <p>
              STDU SHOP — платформа для последовательной инженерной проработки.
            </p>
          </Container>
          <a
            className="closing-section__source"
            href="https://owen.ru/project/avtomatizaciya_varochnogo_kotla_na_pticepererabatyvayushchem_proizvodstve"
            target="_blank"
            rel="noreferrer"
          >
            AI-концепт среды · исходный референс ОВЕН ↗
          </a>
        </Section>
      </main>
    </PublicLayout>
  );
}
