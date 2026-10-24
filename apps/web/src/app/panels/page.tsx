import type { Metadata } from 'next';
import Image from 'next/image';
import { PublicLayout } from '../../components/layouts/page-layouts';
import { Breadcrumbs, Container } from '../../components/ui/primitives';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Проектирование и изготовление электрощитов | SHOP-STDU',
  description:
    'Электрощиты автоматизации, мониторинга и распределения. Состав работ, компонентная база и этапы инженерной проработки по техническому заданию.',
};

const panelTypes = [
  {
    index: '01',
    title: 'Автоматизация и управление',
    description:
      'Компоновка контроллеров, аппаратов защиты и цепей управления в соответствии с задачей объекта.',
    code: 'CTRL',
  },
  {
    index: '02',
    title: 'Мониторинг и диспетчеризация',
    description:
      'Инженерная проработка сигналов и связи для наблюдения за оборудованием и процессами.',
    code: 'DATA',
  },
  {
    index: '03',
    title: 'Силовые и распределительные',
    description:
      'Распределение питания и защита цепей согласно исходной схеме и параметрам объекта.',
    code: 'PWR',
  },
  {
    index: '04',
    title: 'Управление инженерными системами',
    description:
      'Шкафы для вентиляции, насосных установок, отопления и других систем здания или производства.',
    code: 'HVAC',
  },
] as const;

const workflow = [
  [
    '01',
    'Техническое задание',
    'Исходные данные, ограничения и состав объекта.',
  ],
  [
    '02',
    'Проектирование',
    'Схемы, компоновка и объём работ по согласованной задаче.',
  ],
  ['03', 'Комплектация', 'Выбор компонентной базы по техническим требованиям.'],
  ['04', 'Сборка', 'Монтаж компонентов и соединений по документации.'],
  ['05', 'Программирование', 'Логика управления, если входит в состав работ.'],
  ['06', 'Проверка', 'Проверки по согласованной программе проекта.'],
  [
    '07',
    'Документация',
    'Состав передаваемых материалов определяется проектом.',
  ],
] as const;

const components = [
  {
    src: '/images/engineering/breaker-iek.webp',
    alt: 'Модульный автоматический выключатель IEK BA47-29',
    label: 'Защитная аппаратура',
    source: 'Источник: АтлантСнаб',
    href: 'https://atlantsnab.ru/catalog/modulnye-avtomaticheskie-vyklyuchateli/',
    width: 480,
    height: 477,
  },
  {
    src: '/images/engineering/controller-owen.webp',
    alt: 'Программируемый логический контроллер ОВЕН ПЛК210',
    label: 'Контроллеры',
    source: 'Источник: ОВЕН',
    href: 'https://owen.ru/product/plk210',
    width: 398,
    height: 426,
  },
  {
    src: '/images/engineering/relay-wirenboard.webp',
    alt: 'Релейный модуль Wiren Board WB-MR6C v.3',
    label: 'Модули управления',
    source: 'Источник: Wiren Board',
    href: 'https://wirenboard.com/ru/product/WB-MR6C_v3/',
    width: 420,
    height: 378,
  },
] as const;

export default function PanelsPage() {
  return (
    <PublicLayout>
      <main className={styles.page} id="main" tabIndex={-1}>
        <section aria-labelledby="panels-title" className={styles.hero}>
          <Container className={styles.heroInner}>
            <Breadcrumbs
              className={styles.breadcrumbs}
              items={[
                { label: 'Главная', href: '/' },
                { label: 'Электрощиты' },
              ]}
            />
            <div className={styles.heroGrid}>
              <div className={styles.heroCopy}>
                <p className={styles.eyebrow}>ЭЛЕКТРОТЕХНИЧЕСКИЕ ШКАФЫ</p>
                <h1 id="panels-title">
                  Проектирование и изготовление <em>электрощитов</em>
                </h1>
                <p className={styles.heroLead}>
                  От технической задачи и схемы до комплектации, сборки и
                  проверки. Состав решения определяется исходными данными и
                  согласованным объёмом работ.
                </p>
                <div className={styles.heroActions}>
                  <a className={styles.primaryLink} href="#panel-types">
                    Типы решений <span aria-hidden="true">↓</span>
                  </a>
                  <a className={styles.secondaryLink} href="#panel-workflow">
                    Этапы работ <span aria-hidden="true">↗</span>
                  </a>
                </div>
                <div aria-label="Области работ" className={styles.heroTags}>
                  <span>Автоматизация</span>
                  <span>Распределение</span>
                  <span>Мониторинг</span>
                </div>
              </div>

              <figure className={styles.heroFigure}>
                <div className={styles.heroImageFrame}>
                  <Image
                    alt="Открытый шкаф управления из материала ОВЕН"
                    className={styles.heroImage}
                    fill
                    priority
                    sizes="(max-width: 800px) 100vw, 55vw"
                    src="/images/engineering/cabinet-industrial.webp"
                  />
                  <span aria-hidden="true" className={styles.imageIndex}>
                    PANEL SYSTEMS <b>01</b>
                  </span>
                  <svg
                    aria-hidden="true"
                    className={styles.imageTrace}
                    fill="none"
                    viewBox="0 0 240 180"
                  >
                    <path d="M1 1h44v39h51v38h67v38h76v63" />
                    <circle cx="96" cy="40" r="3" />
                    <circle cx="163" cy="78" r="3" />
                    <circle cx="239" cy="116" r="3" />
                  </svg>
                </div>
                <figcaption className={styles.photoCaption}>
                  <span>Открытый шкаф управления · пример компоновки</span>
                  <a
                    href="https://owen.ru/project/avtomatizaciya_varochnogo_kotla_na_pticepererabatyvayushchem_proizvodstve"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Фото: ОВЕН ↗
                  </a>
                </figcaption>
              </figure>
            </div>
            <div className={styles.heroFoot}>
              <span>01 / ПРОЕКТИРОВАНИЕ</span>
              <span>02 / КОМПЛЕКТАЦИЯ</span>
              <span>03 / СБОРКА И ПРОВЕРКА</span>
            </div>
          </Container>
        </section>

        <section
          aria-labelledby="panel-types-title"
          className={styles.typesSection}
          id="panel-types"
        >
          <Container>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrowLight}>НАПРАВЛЕНИЯ</p>
                <h2 id="panel-types-title">Шкаф — под задачу системы</h2>
              </div>
              <p>
                Типовые направления помогают определить назначение. Конкретная
                компоновка и состав аппаратуры формируются по техническим
                требованиям объекта.
              </p>
            </div>

            <div className={styles.typesLayout}>
              <ol className={styles.typeList}>
                {panelTypes.map((type) => (
                  <li className={styles.typeItem} key={type.index}>
                    <span aria-hidden="true" className={styles.typeIndex}>
                      {type.index}
                    </span>
                    <div>
                      <div className={styles.typeTitleRow}>
                        <h3>{type.title}</h3>
                        <span>{type.code}</span>
                      </div>
                      <p>{type.description}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <figure className={styles.assemblyFigure}>
                <div className={styles.assemblyImageFrame}>
                  <Image
                    alt="Собранная компоновка шкафа автоматизации из материала Wiren Board"
                    fill
                    sizes="(max-width: 800px) 100vw, 42vw"
                    src="/images/engineering/panel-assembly.webp"
                  />
                  <span className={styles.assemblyLabel}>
                    ФРАГМЕНТ РЕАЛЬНОЙ КОМПОНОВКИ
                  </span>
                </div>
                <figcaption className={styles.photoCaptionLight}>
                  Фото из материала Wiren Board. Это референс оборудования, а не
                  проект SHOP-STDU.
                  <a
                    href="https://wirenboard.com/ru/pages/comfort-life-piter-kvartira/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Источник ↗
                  </a>
                </figcaption>
              </figure>
            </div>

            <aside
              aria-labelledby="custom-panel-title"
              className={styles.customPanel}
            >
              <div className={styles.customPanelMark} aria-hidden="true">
                <svg fill="none" viewBox="0 0 80 80">
                  <path d="M8 20h19v18h22v22h23" />
                  <path d="M8 60h12V48h14V20h28" />
                  <circle cx="8" cy="20" r="3" />
                  <circle cx="72" cy="60" r="3" />
                  <rect x="34" y="12" width="17" height="16" rx="2" />
                  <rect x="39" y="50" width="15" height="16" rx="2" />
                </svg>
              </div>
              <div>
                <p className={styles.customKicker}>ИНДИВИДУАЛЬНОЕ РЕШЕНИЕ</p>
                <h3 id="custom-panel-title">
                  Для задачи, которой нет в типовом ряду
                </h3>
                <p>
                  Изготовление по проекту заказчика или разработка с нуля —
                  формат работ, состав документации и границы поставки
                  определяются после изучения технического задания.
                </p>
              </div>
              <span aria-hidden="true" className={styles.customArrow}>
                INDIVIDUAL / SPEC
              </span>
            </aside>
          </Container>
        </section>

        <section
          aria-labelledby="panel-workflow-title"
          className={styles.workflowSection}
          id="panel-workflow"
        >
          <Container>
            <div className={styles.workflowHeading}>
              <div>
                <p className={styles.eyebrow}>СОСТАВ ВОЗМОЖНЫХ РАБОТ</p>
                <h2 id="panel-workflow-title">
                  От исходных данных до передачи документации
                </h2>
              </div>
              <p>
                Этапы могут выполняться вместе или отдельно — состав зависит от
                проекта и запроса заказчика.
              </p>
            </div>
            <ol className={styles.workflowList}>
              {workflow.map(([index, title, description]) => (
                <li className={styles.workflowStep} key={index}>
                  <span className={styles.workflowIndex}>{index}</span>
                  <span aria-hidden="true" className={styles.workflowNode} />
                  <h3>{title}</h3>
                  <p>{description}</p>
                </li>
              ))}
            </ol>
            <p className={styles.workflowNote}>
              Содержание и последовательность работ согласуются для каждого
              проекта отдельно.
            </p>
          </Container>
        </section>

        <section
          aria-labelledby="components-title"
          className={styles.componentsSection}
        >
          <Container>
            <div className={styles.componentIntro}>
              <p className={styles.eyebrowLight}>КОМПОНЕНТНАЯ БАЗА</p>
              <h2 id="components-title">Подбор по требованиям системы</h2>
              <p>
                В проектах могут использоваться аппараты защиты, контроллеры,
                релейные модули и источники питания разных производителей.
                Точные позиции определяются проектной документацией и
                согласованной спецификацией.
              </p>
              <p className={styles.brandNote}>
                Для подбора могут рассматриваться Wiren Board, IEK, EKF, КЭАЗ,
                ОВЕН, Systeme Electric, ДКС и Mean Well. Упоминание марок не
                означает партнёрство или наличие товара.
              </p>
            </div>
            <div className={styles.componentRail}>
              {components.map((component) => (
                <figure className={styles.componentCard} key={component.src}>
                  <div className={styles.componentImage}>
                    <Image
                      alt={component.alt}
                      height={component.height}
                      sizes="(max-width: 760px) 30vw, 15vw"
                      src={component.src}
                      width={component.width}
                    />
                  </div>
                  <figcaption>
                    <strong>{component.label}</strong>
                    <a href={component.href} rel="noreferrer" target="_blank">
                      {component.source} ↗
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          </Container>
        </section>

        <section
          aria-labelledby="panel-request-title"
          className={styles.requestSection}
        >
          <Container className={styles.requestInner}>
            <div className={styles.requestArtwork} aria-hidden="true">
              <svg fill="none" viewBox="0 0 360 150">
                <path d="M0 75h62m52 0h53m50 0h57m48 0h38M37 32v86m117-97v107m114-85v63" />
                <rect x="62" y="37" width="52" height="76" rx="2" />
                <rect x="167" y="48" width="50" height="54" rx="2" />
                <rect x="274" y="42" width="48" height="66" rx="2" />
                <path d="M75 50h26m-26 14h26m-26 14h26m-26 14h26m54-33h25m-25 13h25m-25 13h25m63-28h25m-25 14h25m-25 14h25" />
                <circle cx="140" cy="75" r="3" />
                <circle cx="242" cy="75" r="3" />
              </svg>
            </div>
            <div className={styles.requestCopy}>
              <p className={styles.eyebrow}>СЛЕДУЮЩИЙ ШАГ</p>
              <h2 id="panel-request-title">
                Обсудить изготовление или изменение шкафа
              </h2>
              <p>
                Область для передачи технического задания и запроса стоимости
                предусмотрена. Онлайн-заявка подключается в следующем этапе.
              </p>
            </div>
            <div className={styles.requestAction}>
              <button aria-describedby="panel-request-status" disabled>
                Запросить изготовление
              </button>
              <p id="panel-request-status">
                Форма заявки пока недоступна. Кнопка не отправляет данные.
              </p>
            </div>
          </Container>
        </section>
      </main>
    </PublicLayout>
  );
}
