import type { Metadata } from 'next';
import Image from 'next/image';
import { PublicLayout } from '../../components/layouts/page-layouts';
import { Breadcrumbs, Container } from '../../components/ui/primitives';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Проектирование и программирование автоматики | SHOP-STDU',
  description:
    'Электротехническое проектирование, промышленная автоматизация, программирование контроллеров, испытания и пусконаладка инженерных систем.',
};

const serviceGroups = [
  {
    index: '01',
    title: 'Проектирование',
    intro: 'Сформировать понятное техническое решение до начала реализации.',
    services: [
      'Проектирование электротехнических систем',
      'Разработка систем автоматизации и диспетчеризации',
      'Подбор оборудования и составление спецификаций',
      'Решения для инженерных систем',
    ],
  },
  {
    index: '02',
    title: 'Программирование',
    intro: 'Реализовать согласованную логику управления и взаимодействия.',
    services: [
      'Программирование промышленных контроллеров',
      'Алгоритмы управления технологическими и инженерными системами',
    ],
  },
  {
    index: '03',
    title: 'Испытания и ПНР',
    intro:
      'Проверить решение и выполнить пусконаладочные работы в границах проекта.',
    services: ['Испытания оборудования и систем', 'Пусконаладочные работы'],
  },
] as const;

const workflow = [
  ['01', 'Исходные данные'],
  ['02', 'Анализ ТЗ'],
  ['03', 'Проектное решение'],
  ['04', 'Разработка'],
  ['05', 'Проверка'],
  ['06', 'Передача результата'],
] as const;

export default function EngineeringPage() {
  return (
    <PublicLayout>
      <main className={styles.page} id="main" tabIndex={-1}>
        <section aria-labelledby="engineering-title" className={styles.hero}>
          <Container className={styles.heroInner}>
            <Breadcrumbs
              className={styles.breadcrumbs}
              items={[
                { label: 'Главная', href: '/' },
                { label: 'Проектирование и программирование' },
              ]}
            />
            <div className={styles.heroGrid}>
              <div className={styles.heroCopy}>
                <p className={styles.eyebrow}>ИНЖЕНЕРНЫЕ УСЛУГИ</p>
                <h1 id="engineering-title">
                  Проектирование и программирование <em>систем управления</em>
                </h1>
                <p className={styles.heroLead}>
                  Электротехника, промышленная автоматизация и работа с
                  контроллерами — от анализа исходных требований до проверки и
                  передачи результата.
                </p>
                <div className={styles.heroActions}>
                  <a
                    className={styles.primaryLink}
                    href="#engineering-services"
                  >
                    Направления услуг <span aria-hidden="true">↓</span>
                  </a>
                  <a
                    className={styles.secondaryLink}
                    href="#engineering-process"
                  >
                    Как строится работа <span aria-hidden="true">↗</span>
                  </a>
                </div>
                <div className={styles.heroFoot}>
                  <span>ЭЛЕКТРОТЕХНИКА</span>
                  <span>АВТОМАТИЗАЦИЯ</span>
                  <span>ИНЖЕНЕРНЫЕ СИСТЕМЫ</span>
                </div>
              </div>

              <figure className={styles.heroFigure}>
                <div className={styles.heroImageFrame}>
                  <Image
                    alt="Открытый шкаф диспетчеризации с контроллерами и релейными модулями из материала Wiren Board"
                    className={styles.heroImage}
                    fill
                    priority
                    sizes="(max-width: 800px) 100vw, 55vw"
                    src="/images/engineering/cabinet-dispatch.webp"
                  />
                  <div aria-hidden="true" className={styles.imageReadout}>
                    <span>Система автоматизации</span>
                    <i />
                  </div>
                  <div aria-hidden="true" className={styles.imageCorner} />
                </div>
                <figcaption className={styles.photoCaption}>
                  <span>Шкаф диспетчеризации · фото из статьи Wiren Board</span>
                  <a
                    href="https://habr.com/ru/companies/wirenboard/articles/992886/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Источник ↗
                  </a>
                </figcaption>
              </figure>
            </div>
          </Container>
        </section>

        <section
          aria-labelledby="engineering-services-title"
          className={styles.servicesSection}
          id="engineering-services"
        >
          <Container>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrowLight}>СОСТАВ УСЛУГ</p>
                <h2 id="engineering-services-title">
                  Отдельные компетенции. Общая инженерная логика.
                </h2>
              </div>
              <p>
                Проектирование, программирование и пусконаладка могут
                заказываться независимо или сочетаться в рамках одной задачи.
              </p>
            </div>

            <div className={styles.serviceGrid}>
              {serviceGroups.map((group) => (
                <article className={styles.serviceCard} key={group.index}>
                  <div className={styles.serviceCardTop}>
                    <span>{group.index}</span>
                    <svg aria-hidden="true" fill="none" viewBox="0 0 88 58">
                      {group.index === '01' ? (
                        <>
                          <path d="M2 29h23m19 0h19m20 0h3M25 8v42m38-42v42" />
                          <rect x="25" y="14" width="19" height="30" rx="2" />
                          <rect x="63" y="19" width="20" height="20" rx="2" />
                          <circle cx="53" cy="29" r="3" />
                        </>
                      ) : group.index === '02' ? (
                        <>
                          <rect x="4" y="10" width="27" height="38" rx="3" />
                          <rect x="57" y="10" width="27" height="38" rx="3" />
                          <path d="M31 21h26M31 37h26M43 21v16" />
                          <circle cx="43" cy="29" r="4" />
                        </>
                      ) : (
                        <>
                          <path d="M3 29h18m46 0h18M21 9v40m46-40v40" />
                          <rect x="21" y="14" width="21" height="30" rx="2" />
                          <rect x="46" y="14" width="21" height="30" rx="2" />
                          <path d="M26 22h11m-11 8h11m-11 8h11m14-16h11m-11 8h11m-11 8h11" />
                        </>
                      )}
                    </svg>
                  </div>
                  <h3>{group.title}</h3>
                  <p className={styles.serviceIntro}>{group.intro}</p>
                  <ul>
                    {group.services.map((service) => (
                      <li key={service}>{service}</li>
                    ))}
                  </ul>
                  <span aria-hidden="true" className={styles.serviceRule} />
                </article>
              ))}
            </div>
          </Container>
        </section>

        <section
          aria-labelledby="engineering-process-title"
          className={styles.processSection}
          id="engineering-process"
        >
          <Container className={styles.processLayout}>
            <div className={styles.processIntro}>
              <p className={styles.eyebrow}>РАБОЧИЙ ПРОЦЕСС</p>
              <h2 id="engineering-process-title">
                Сначала требования. Затем решение.
              </h2>
              <p>
                Состав документации и глубина проработки согласуются по
                техническому заданию. Проверка и передача материалов входят в
                объём только в согласованных границах.
              </p>
              <a href="#engineering-toolbox">
                Технологическая направленность <span aria-hidden="true">↓</span>
              </a>
            </div>
            <ol className={styles.processList}>
              {workflow.map(([index, title]) => (
                <li key={index}>
                  <span>{index}</span>
                  <strong>{title}</strong>
                  <i aria-hidden="true" />
                </li>
              ))}
            </ol>
          </Container>
        </section>

        <section
          aria-labelledby="engineering-toolbox-title"
          className={styles.toolboxSection}
          id="engineering-toolbox"
        >
          <Container className={styles.toolboxLayout}>
            <div className={styles.toolboxCopy}>
              <p className={styles.eyebrowLight}>ТЕХНОЛОГИЧЕСКИЙ ФОКУС</p>
              <h2 id="engineering-toolbox-title">
                Промышленная автоматика и электротехника
              </h2>
              <p>
                Работа с контроллерами, модулями ввода-вывода, цепями коммутации
                и инженерной документацией. Конкретная технологическая база и
                состав результата определяются задачей, исходными данными и
                проектными ограничениями.
              </p>
              <div className={styles.focusList}>
                <span>Контроллеры и модули</span>
                <span>Электрические схемы</span>
                <span>Сигналы и управление</span>
                <span>Проверка решения</span>
              </div>
              <p className={styles.brandNote}>
                В качестве компонентной базы могут рассматриваться Wiren Board,
                ОВЕН, IEK, КЭАЗ, Systeme Electric, ДКС, EKF и Mean Well. Это
                примеры отраслевых марок, а не перечень партнёров или наличие
                товаров.
              </p>
            </div>

            <div className={styles.toolboxVisual}>
              <figure className={styles.toolboxMainFigure}>
                <div>
                  <Image
                    alt="Реальная компоновка шкафа автоматизации из материала Wiren Board"
                    fill
                    sizes="(max-width: 800px) 100vw, 35vw"
                    src="/images/engineering/panel-assembly.webp"
                  />
                </div>
                <figcaption>
                  <span>Компоновка шкафа автоматизации</span>
                  <a
                    href="https://wirenboard.com/ru/pages/comfort-life-piter-kvartira/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Источник: Wiren Board ↗
                  </a>
                </figcaption>
              </figure>
              <figure className={styles.toolboxProductFigure}>
                <div>
                  <Image
                    alt="Программируемый логический контроллер Wiren Board 8M"
                    fill
                    sizes="(max-width: 800px) 45vw, 18vw"
                    src="/images/engineering/controller-wirenboard.webp"
                  />
                </div>
                <figcaption>
                  <span>Контроллер</span>
                  <a
                    href="https://wirenboard.com/ru/product/wiren-board-8M/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Источник ↗
                  </a>
                </figcaption>
              </figure>
              <div aria-hidden="true" className={styles.toolboxDiagram}>
                <svg fill="none" viewBox="0 0 100 100">
                  <path d="M10 50h20m20 0h20m20 0h10M30 20v60m40-60v60" />
                  <rect x="30" y="31" width="20" height="38" rx="2" />
                  <rect x="70" y="36" width="20" height="28" rx="2" />
                  <circle cx="60" cy="50" r="4" />
                </svg>
                <span>СХЕМА / УСЛОВНО</span>
              </div>
            </div>
          </Container>
        </section>

        <section
          aria-labelledby="engineering-request-title"
          className={styles.requestSection}
        >
          <Container className={styles.requestInner}>
            <div className={styles.requestCopy}>
              <p className={styles.eyebrow}>ПЕРЕДАТЬ ЗАДАЧУ</p>
              <h2 id="engineering-request-title">
                Подготовьте исходные данные для инженерной оценки
              </h2>
              <p>
                Здесь будет доступна передача ТЗ и запрос коммерческого
                предложения. До подключения сервиса отправка файлов и заявок
                отключена.
              </p>
            </div>
            <div className={styles.requestAction}>
              <button aria-describedby="engineering-request-status" disabled>
                Запросить оценку
              </button>
              <p id="engineering-request-status">
                Онлайн-заявка пока недоступна. Данные не отправляются.
              </p>
            </div>
            <svg
              aria-hidden="true"
              className={styles.requestCircuit}
              fill="none"
              viewBox="0 0 280 110"
            >
              <path d="M1 55h44m38 0h34m36 0h38m38 0h48M20 17v76m82-90v104m86-80v56m52-48v40" />
              <rect x="45" y="30" width="38" height="50" rx="2" />
              <rect x="117" y="37" width="36" height="36" rx="2" />
              <rect x="191" y="32" width="38" height="46" rx="2" />
              <circle cx="102" cy="55" r="3" />
              <circle cx="179" cy="55" r="3" />
            </svg>
          </Container>
        </section>
      </main>
    </PublicLayout>
  );
}
