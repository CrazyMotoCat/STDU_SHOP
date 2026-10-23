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
  if (type === 'equipment') {
    return (
      <svg fill="none" viewBox="0 0 112 68">
        <path
          className="direction-visual__outline"
          d="M20 9H77L91 18V57H20V9Z"
        />
        <path
          className="direction-visual__line"
          d="M77 9V18H91M30 19H68M30 48H81"
        />
        <rect
          className="direction-visual__module"
          height="19"
          rx="2"
          width="13"
          x="31"
          y="25"
        />
        <rect
          className="direction-visual__module"
          height="19"
          rx="2"
          width="13"
          x="51"
          y="25"
        />
        <path
          className="direction-visual__accent"
          d="M37.5 21V25M57.5 21V25M37.5 44V48M57.5 44V48"
        />
        <circle className="direction-visual__node" cx="83" cy="24" r="2.5" />
      </svg>
    );
  }

  if (type === 'panel') {
    return (
      <svg fill="none" viewBox="0 0 112 68">
        <path
          className="direction-visual__side"
          d="M74 11 91 18V56L74 62V11Z"
        />
        <path className="direction-visual__outline" d="M22 11H74V62H22V11Z" />
        <path
          className="direction-visual__line"
          d="M29 18H67V54H29V18ZM35 26H61M35 44H61"
        />
        <path
          className="direction-visual__accent"
          d="M38 26V35M48 26V35M58 26V35M38 35H58"
        />
        <path className="direction-visual__line" d="M68 33H71V42H68" />
        <circle className="direction-visual__node" cx="83" cy="22" r="2.5" />
      </svg>
    );
  }

  return (
    <svg fill="none" viewBox="0 0 112 68">
      <path
        className="direction-visual__line"
        d="M27 22H49V45H67M49 22H78M27 45H37"
      />
      <rect
        className="direction-visual__module"
        height="16"
        rx="3"
        width="22"
        x="12"
        y="14"
      />
      <rect
        className="direction-visual__module"
        height="18"
        rx="3"
        width="24"
        x="37"
        y="36"
      />
      <rect
        className="direction-visual__module"
        height="16"
        rx="3"
        width="22"
        x="78"
        y="14"
      />
      <path
        className="direction-visual__accent"
        d="M18 22H28M44 45H54M84 22H94"
      />
      <circle className="direction-visual__node" cx="49" cy="22" r="3" />
      <circle className="direction-visual__node" cx="67" cy="45" r="3" />
    </svg>
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

            <div className="hero-visual">
              <SwitchgearIllustration />
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
                  className="service-card--direction"
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
