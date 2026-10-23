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
  },
  {
    id: 'panels',
    index: '02',
    title: 'Изготовление электрощитов',
    description: 'Типовые и индивидуальные шкафы с инженерной проработкой.',
  },
  {
    id: 'engineering',
    index: '03',
    title: 'Проектирование и программирование',
    description:
      'Инженерная проработка решений для управления промышленными процессами.',
  },
] as const;

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
