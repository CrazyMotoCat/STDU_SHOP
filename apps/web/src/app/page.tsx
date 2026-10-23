import { PublicLayout } from '../components/layouts/page-layouts';
import { SwitchgearIllustration } from '../components/site/switchgear-illustration';
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
    description:
      'Электротехнические компоненты и оборудование для промышленных систем.',
  },
  {
    id: 'panels',
    index: '02',
    title: 'Изготовление электрощитов',
    description:
      'Типовые шкафы и индивидуальные решения с инженерной проработкой.',
  },
  {
    id: 'engineering',
    index: '03',
    title: 'Проектирование и программирование',
    description:
      'Проектирование систем управления и программирование оборудования.',
  },
] as const;

const details = [
  {
    id: 'equipment',
    number: '01',
    eyebrow: 'Оборудование',
    title: 'Технический выбор начинается с исходных данных',
    description:
      'Будущий каталог будет строиться вокруг характеристик, документации и точной идентификации оборудования.',
    note: 'Каталог и поиск пока недоступны.',
  },
  {
    id: 'panels',
    number: '02',
    eyebrow: 'Электрощиты',
    title: 'Типовые решения и проектирование под задачу',
    description:
      'Интерфейс предусматривает место для типовых шкафов, исходных спецификаций и ручной инженерной проверки изменений.',
    note: 'Раздел электрощитов пока готовится.',
  },
  {
    id: 'engineering',
    number: '03',
    eyebrow: 'Инжиниринг',
    title: 'Проектирование и программирование систем',
    description:
      'Направление объединит инженерную проработку, проектирование и программирование в рамках утверждённого объёма платформы.',
    note: 'Информация и сервисы подключаются поэтапно.',
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
                Оборудование · электрощиты · инженерия
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
              <Status className="hero-status" label="Сервисы готовятся">
                Поиск, загрузка спецификации и запрос коммерческого предложения
                пока недоступны.
              </Status>
              <a className="hero-scroll-link" href="#directions">
                <span aria-hidden="true">↓</span>
                Посмотреть направления
              </a>
            </div>

            <div className="hero-visual">
              <SwitchgearIllustration />
              <div className="hero-visual__index" aria-hidden="true">
                <span>ЭЛЕКТРОТЕХНИЧЕСКИЕ СИСТЕМЫ</span>
                <span>STDU / 01</span>
              </div>
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
                <h2 id="directions-title">
                  Три направления. Одна инженерная логика.
                </h2>
              </div>
              <p>
                Структура платформы объединяет поставку оборудования,
                электрощитовое направление и инжиниринг.
              </p>
            </div>
            <div className="service-grid">
              {directions.map((direction) => (
                <ServiceCard
                  description={direction.description}
                  href={`#${direction.id}`}
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
                <h2 id="overview-title">
                  От компонента — к целостному решению.
                </h2>
              </div>
              <p>
                Разделы будут открываться по мере готовности соответствующих
                сервисов. Сейчас доступен обзор их назначения.
              </p>
            </div>

            <div className="direction-details">
              {details.map((detail) => (
                <article
                  aria-labelledby={`${detail.id}-title`}
                  className="direction-detail"
                  id={detail.id}
                  key={detail.id}
                >
                  <div className="direction-detail__index" aria-hidden="true">
                    {detail.number}
                  </div>
                  <div className="direction-detail__body">
                    <p className="eyebrow">{detail.eyebrow}</p>
                    <h3 id={`${detail.id}-title`}>{detail.title}</h3>
                    <p>{detail.description}</p>
                  </div>
                  <div className="direction-detail__status">
                    <Badge tone="unavailable">Раздел готовится</Badge>
                    <span>{detail.note}</span>
                  </div>
                </article>
              ))}
            </div>
          </Container>
        </Section>

        <Section className="closing-section" tone="dark">
          <Container className="closing-section__inner">
            <div>
              <p className="eyebrow">GRAPHITE &amp; PETROL</p>
              <h2>Технические решения требуют ясной структуры.</h2>
            </div>
            <p>
              STDU SHOP — основа для последовательной работы с оборудованием,
              щитами и инженерными проектами.
            </p>
          </Container>
        </Section>
      </main>
    </PublicLayout>
  );
}
