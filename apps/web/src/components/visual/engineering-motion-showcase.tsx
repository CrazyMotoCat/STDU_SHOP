'use client';

import { useEffect, useId, useRef, useState } from 'react';

const stages = [
  {
    id: 'equipment',
    index: '01',
    label: 'Оборудование',
    title: 'Компоненты и обозначения',
    description:
      'Подбор оборудования начинается с точных характеристик и документации на компоненты.',
  },
  {
    id: 'panel',
    index: '02',
    label: 'Электрощит',
    title: 'Компоновка шкафа',
    description:
      'Электрощит объединяет аппараты и электрические связи в одной инженерной компоновке.',
  },
  {
    id: 'engineering',
    index: '03',
    label: 'Инжиниринг',
    title: 'Структура системы управления',
    description:
      'Система управления связывает контроллер, оборудование и измерительные узлы в общую схему.',
  },
] as const;

type StageId = (typeof stages)[number]['id'];

export function EngineeringMotionShowcase() {
  const [activeId, setActiveId] = useState<StageId>('equipment');
  const instanceId = useId().replaceAll(':', '');
  const drawingRef = useRef<SVGSVGElement>(null);
  const [decorationVisible, setDecorationVisible] = useState(false);

  useEffect(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;

    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window)
    ) {
      setDecorationVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setDecorationVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(drawing);
    return () => observer.disconnect();
  }, []);
  const activeStage =
    stages.find((stage) => stage.id === activeId) ?? stages[0];
  const titleId = `${instanceId}-title`;
  const descriptionId = `${instanceId}-description`;
  const gridId = `${instanceId}-grid`;
  const glowId = `${instanceId}-glow`;

  return (
    <div className="engineering-showcase">
      <div className="engineering-showcase__layout">
        <div className="engineering-showcase__copy">
          <p className="eyebrow">ИНЖЕНЕРНЫЕ НАПРАВЛЕНИЯ</p>
          <h3 className="engineering-showcase__title">Выберите этап</h3>
          <p className="engineering-showcase__intro">
            Один инженерный процесс: от выбора оборудования до структуры
            электрощита и системы управления.
          </p>

          <div
            aria-label="Состояния инженерной схемы"
            className="engineering-showcase__choices"
            role="group"
          >
            {stages.map((stage) => (
              <button
                aria-pressed={activeId === stage.id}
                className="engineering-showcase__choice"
                key={stage.id}
                onClick={() => setActiveId(stage.id)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="engineering-showcase__choice-index"
                >
                  {stage.index}
                </span>
                <span>{stage.label}</span>
              </button>
            ))}
          </div>

          <div
            aria-atomic="true"
            aria-live="polite"
            className="engineering-showcase__summary"
          >
            <div
              className="engineering-showcase__summary-content"
              key={activeId}
            >
              <span className="engineering-showcase__summary-index">
                {activeStage.index} / 03
              </span>
              <p className="engineering-showcase__summary-title">
                {activeStage.title}
              </p>
              <p>{activeStage.description}</p>
            </div>
          </div>
          <p className="engineering-showcase__note">
            Иллюстрация направлений работы, не конфигуратор и не подключённая
            система.
          </p>
        </div>

        <figure className="engineering-showcase__figure">
          <svg
            aria-labelledby={`${titleId} ${descriptionId}`}
            className="engineering-showcase__drawing"
            data-revealed={decorationVisible}
            ref={drawingRef}
            fill="none"
            role="img"
            viewBox="0 0 760 440"
          >
            <title id={titleId}>Схема инженерных направлений</title>
            <desc id={descriptionId}>
              Оригинальная техническая иллюстрация компонентов, шкафа и системы
              управления. Это статическая демонстрационная схема.
            </desc>
            <defs>
              <pattern
                height="28"
                id={gridId}
                patternUnits="userSpaceOnUse"
                width="28"
              >
                <path
                  d="M28 0H0V28"
                  stroke="var(--showcase-grid)"
                  strokeWidth="1"
                />
              </pattern>
              <radialGradient id={glowId}>
                <stop stopColor="var(--showcase-accent)" stopOpacity="0.18" />
                <stop
                  offset="1"
                  stopColor="var(--showcase-accent)"
                  stopOpacity="0"
                />
              </radialGradient>
            </defs>
            <rect height="440" width="760" fill="var(--showcase-background)" />
            <rect height="440" width="760" fill={`url(#${gridId})`} />
            <circle cx="608" cy="94" r="150" fill={`url(#${glowId})`} />
            <path
              className="engineering-showcase__decor-line"
              d="M36 398H724"
              stroke="var(--showcase-frame)"
              strokeWidth="1"
            />
            <path
              d="M36 48H724"
              stroke="var(--showcase-frame)"
              strokeWidth="1"
            />
            <text
              fill="var(--showcase-caption)"
              fontFamily="var(--font-mono)"
              fontSize="10"
              letterSpacing="1.2"
              x="42"
              y="34"
            >
              ENGINEERING / OVERVIEW
            </text>
            <text
              fill="var(--showcase-caption)"
              fontFamily="var(--font-mono)"
              fontSize="10"
              letterSpacing="1.2"
              textAnchor="end"
              x="718"
              y="34"
            >
              {activeStage.index} / 03
            </text>

            <g
              aria-hidden="true"
              className="engineering-showcase__stage"
              data-active={activeId === 'equipment'}
            >
              <path
                className="engineering-showcase__connection"
                d="M174 218H236M324 218H386M474 218H536"
              />
              {[174, 236, 324, 386, 474, 536].map((x) => (
                <circle
                  className="engineering-showcase__node"
                  cx={x}
                  cy="218"
                  key={x}
                  r="3.5"
                />
              ))}
              <g
                className="engineering-showcase__component"
                transform="translate(76 130)"
              >
                <rect height="176" rx="8" width="98" />
                <path d="M18 27H80M18 148H80" />
                <rect
                  className="engineering-showcase__component-core"
                  height="72"
                  rx="5"
                  width="42"
                  x="28"
                  y="53"
                />
                <path d="M49 68V103M38 86H60" />
                <circle cx="49" cy="34" r="4" />
                <text x="49" y="195">
                  QF
                </text>
              </g>
              <g
                className="engineering-showcase__component"
                transform="translate(236 130)"
              >
                <rect height="176" rx="8" width="88" />
                <path d="M15 30H73M15 148H73" />
                <rect
                  className="engineering-showcase__component-core"
                  height="72"
                  rx="5"
                  width="52"
                  x="18"
                  y="53"
                />
                <path d="M28 89C28 77 40 77 40 89S52 101 52 89S64 77 64 89" />
                <text x="44" y="195">
                  K
                </text>
              </g>
              <g
                className="engineering-showcase__component"
                transform="translate(386 130)"
              >
                <rect height="176" rx="8" width="88" />
                <path d="M15 30H73M15 148H73" />
                <rect
                  className="engineering-showcase__component-core"
                  height="72"
                  rx="5"
                  width="52"
                  x="18"
                  y="53"
                />
                <path d="M27 71H61M27 82H61M27 93H61M27 104H52" />
                <text x="44" y="195">
                  24 V
                </text>
              </g>
              <g
                className="engineering-showcase__component"
                transform="translate(536 130)"
              >
                <rect height="176" rx="8" width="98" />
                <path d="M18 27H80M18 148H80" />
                <rect
                  className="engineering-showcase__component-core"
                  height="72"
                  rx="5"
                  width="54"
                  x="22"
                  y="53"
                />
                <path d="M32 67H66M32 80H66M32 93H66M32 106H58" />
                <text x="49" y="195">
                  I/O
                </text>
              </g>
            </g>

            <g
              aria-hidden="true"
              className="engineering-showcase__stage"
              data-active={activeId === 'panel'}
            >
              <path
                className="engineering-showcase__panel-side"
                d="M515 90 560 112V356L515 374Z"
              />
              <path
                className="engineering-showcase__panel-face"
                d="M205 90H515V374H205Z"
              />
              <path
                className="engineering-showcase__panel-outline"
                d="M205 90H515L560 112V356L515 374H205Z"
              />
              <path
                className="engineering-showcase__panel-door"
                d="M225 110H494V354H225Z"
              />
              <path
                className="engineering-showcase__panel-rail"
                d="M252 149H465M252 285H465"
              />
              <path
                className="engineering-showcase__panel-wire"
                d="M285 193V247M354 193V247M423 193V247M285 247H423"
              />
              <path
                className="engineering-showcase__panel-wire engineering-showcase__panel-wire--accent"
                d="M271 305H450"
              />
              <g
                className="engineering-showcase__device"
                transform="translate(267 160)"
              >
                <rect height="52" rx="4" width="38" />
                <path d="M19 8V25M11 30H27" />
              </g>
              <g
                className="engineering-showcase__device"
                transform="translate(336 160)"
              >
                <rect height="52" rx="4" width="38" />
                <path d="M8 26C8 16 19 16 19 26S30 36 30 26" />
              </g>
              <g
                className="engineering-showcase__device"
                transform="translate(405 160)"
              >
                <rect height="52" rx="4" width="38" />
                <path d="M8 13H30M8 23H30M8 33H25" />
              </g>
              <g
                className="engineering-showcase__device engineering-showcase__device--wide"
                transform="translate(305 253)"
              >
                <rect height="50" rx="4" width="98" />
                <path d="M15 14H83M15 25H83M15 36H60" />
              </g>
              <path
                className="engineering-showcase__handle"
                d="M478 227H486V263H478Z"
              />
              <circle
                className="engineering-showcase__node"
                cx="515"
                cy="111"
                r="4"
              />
              <circle
                className="engineering-showcase__node"
                cx="515"
                cy="355"
                r="4"
              />
            </g>

            <g
              aria-hidden="true"
              className="engineering-showcase__stage"
              data-active={activeId === 'engineering'}
            >
              <path
                className="engineering-showcase__connection engineering-showcase__connection--diagram"
                d="M210 145H300V204M210 292H300V236M460 204V145H550M460 236V292H550M380 270V328H270M380 328H500"
              />
              <path
                className="engineering-showcase__connection engineering-showcase__connection--highlight"
                d="M210 145H300V204"
              />
              <g
                className="engineering-showcase__node-card"
                transform="translate(90 112)"
              >
                <rect height="66" rx="6" width="120" />
                <circle cx="18" cy="19" r="4" />
                <text x="60" y="42">
                  Датчик
                </text>
              </g>
              <g
                className="engineering-showcase__node-card"
                transform="translate(90 259)"
              >
                <rect height="66" rx="6" width="120" />
                <circle cx="18" cy="19" r="4" />
                <text x="60" y="42">
                  Вводы
                </text>
              </g>
              <g
                className="engineering-showcase__controller"
                transform="translate(300 174)"
              >
                <rect height="94" rx="8" width="160" />
                <path d="M22 24H138M22 38H95M22 66H70" />
                <circle cx="136" cy="65" r="4" />
                <text x="80" y="58">
                  PLC
                </text>
              </g>
              <g
                className="engineering-showcase__node-card"
                transform="translate(550 112)"
              >
                <rect height="66" rx="6" width="120" />
                <circle cx="18" cy="19" r="4" />
                <text x="60" y="42">
                  Привод
                </text>
              </g>
              <g
                className="engineering-showcase__node-card"
                transform="translate(550 259)"
              >
                <rect height="66" rx="6" width="120" />
                <circle cx="18" cy="19" r="4" />
                <text x="60" y="42">
                  Оператор
                </text>
              </g>
              <g
                className="engineering-showcase__node-card"
                transform="translate(210 328)"
              >
                <rect height="48" rx="6" width="120" />
                <circle cx="18" cy="16" r="3" />
                <text x="60" y="31">
                  Сеть
                </text>
              </g>
              <g
                className="engineering-showcase__node-card"
                transform="translate(500 328)"
              >
                <rect height="48" rx="6" width="120" />
                <circle cx="18" cy="16" r="3" />
                <text x="60" y="31">
                  Объект
                </text>
              </g>
            </g>
          </svg>
          <figcaption className="engineering-showcase__caption">
            <span>Схематичное представление направлений</span>
            <span>{activeStage.index} / 03</span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
