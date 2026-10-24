'use client';

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import styles from './page.module.css';

type RequestKind = 'equipment' | 'panels' | 'engineering';
type PanelRequestType = 'project-ready' | 'typical-change' | 'new-design';
type ContactChannel = 'any' | 'email' | 'phone';
type DirectionOption = {
  kind: RequestKind;
  index: string;
  title: string;
  description: string;
};
type EquipmentLine = {
  id: number;
  name: string;
  brand: string;
  article: string;
  modification: string;
  quantity: string;
  unit: string;
  note: string;
};
type ContactDetails = {
  name: string;
  organization: string;
  email: string;
  phone: string;
  channel: ContactChannel;
  region: string;
  deadline: string;
  comment: string;
};
type PanelDetails = {
  requestType: PanelRequestType;
  purpose: string;
  task: string;
  requirements: string;
  documentation: string;
  services: string[];
  quantity: string;
  notes: string;
};
type EngineeringDetails = {
  object: string;
  serviceArea: string;
  subject: string;
  documentation: string;
  scope: string;
  outcomes: string;
  notes: string;
};
type LocalFile = { id: number; name: string; size: number; type: string };
type ValidationErrors = Record<string, string>;

const directions: readonly DirectionOption[] = [
  {
    kind: 'equipment',
    index: '01',
    title: 'Оборудование',
    description: 'Позиции, артикулы или описание свободным текстом.',
  },
  {
    kind: 'panels',
    index: '02',
    title: 'Электрощиты',
    description: 'Комплектация, изменения или разработка по ТЗ.',
  },
  {
    kind: 'engineering',
    index: '03',
    title: 'Проектирование',
    description: 'Инженерные работы и ожидаемые результаты.',
  },
];

const panelTypes: ReadonlyArray<{
  value: PanelRequestType;
  title: string;
  description: string;
}> = [
  {
    value: 'project-ready',
    title: 'Есть готовый проект',
    description: 'Комплектация, сборка или работы по документации.',
  },
  {
    value: 'typical-change',
    title: 'Изменить типовое решение',
    description: 'Скорректировать состав или характеристики шкафа.',
  },
  {
    value: 'new-design',
    title: 'Разработать по ТЗ',
    description: 'Проработать новое решение с нуля.',
  },
];

const panelServices = [
  'Проектирование',
  'Комплектация',
  'Сборка',
  'Программирование',
  'Испытания',
  'ПНР',
] as const;

const engineeringAreas = [
  'Проектирование ЭОМ',
  'Автоматизация и диспетчеризация',
  'Программы контроллеров',
  'Подбор оборудования',
  'Разработка спецификации',
  'Испытания и ПНР',
  'Другая инженерная задача',
] as const;

const allowedFileTypes: Readonly<Record<string, string>> = {
  xlsx: 'Таблица XLSX',
  csv: 'Таблица CSV',
  pdf: 'Документ PDF',
};

const initialContact: ContactDetails = {
  name: '',
  organization: '',
  email: '',
  phone: '',
  channel: 'any',
  region: '',
  deadline: '',
  comment: '',
};

const initialPanel: PanelDetails = {
  requestType: 'project-ready',
  purpose: '',
  task: '',
  requirements: '',
  documentation: 'unknown',
  services: [],
  quantity: '1',
  notes: '',
};

const initialEngineering: EngineeringDetails = {
  object: '',
  serviceArea: '',
  subject: '',
  documentation: '',
  scope: '',
  outcomes: '',
  notes: '',
};

function getFieldDescription(
  id: string,
  hint?: string,
  error?: string,
): string | undefined {
  const describedBy = [
    hint ? `${id}-hint` : undefined,
    error ? `${id}-error` : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  return describedBy || undefined;
}

function FieldFrame({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <span className={styles.fieldHint} id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className={styles.fieldError} id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function DirectionMark({ kind }: { kind: RequestKind }) {
  if (kind === 'equipment') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 42 42">
        <rect height="27" rx="2" width="14" x="14" y="8" />
        <path d="M17 13h8M17 18h8M17 23h8M18 29h6M21 3v5M21 35v4" />
        <circle cx="21" cy="27" r="1" />
      </svg>
    );
  }
  if (kind === 'panels') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 42 42">
        <path d="M7 9h28v26H7zM12 14h18v16H12zM16 18h4v8h-4zM23 18h4v4h-4z" />
        <path d="M3 14h4M3 21h4M3 28h4M35 14h4M35 28h4" />
        <circle cx="27" cy="26" r="1" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 42 42">
      <path d="M5 12h11v11H5zM26 5h11v11H26zM26 26h11v11H26z" />
      <path d="M16 17.5h5.5V10H26M21.5 17.5v14H26" />
      <circle cx="10.5" cy="17.5" r="1.5" />
      <circle cx="31.5" cy="10.5" r="1.5" />
      <circle cx="31.5" cy="31.5" r="1.5" />
    </svg>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

function formatValue(value: string) {
  return value.trim() || 'Не указано';
}

function requestTitle(kind: RequestKind) {
  return directions.find((direction) => direction.kind === kind)?.title ?? '';
}

function equipmentLineHasDescription(line: EquipmentLine) {
  return [
    line.name,
    line.brand,
    line.article,
    line.modification,
    line.note,
  ].some((value) => value.trim());
}

function equipmentLineSummary(line: EquipmentLine) {
  return [line.name, line.brand, line.article, line.modification, line.note]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(' · ');
}

export function RequestQuoteForm({
  initialKind,
  productHint,
  previewEnabled,
}: {
  initialKind: RequestKind;
  productHint?: string;
  previewEnabled: boolean;
}) {
  const idPrefix = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const lineCounter = useRef(1);
  const fileCounter = useRef(0);
  const [kind, setKind] = useState<RequestKind>(initialKind);
  const [contact, setContact] = useState<ContactDetails>(initialContact);
  const [equipmentLines, setEquipmentLines] = useState<EquipmentLine[]>([
    {
      id: 1,
      name: '',
      brand: '',
      article: '',
      modification: '',
      quantity: '1',
      unit: 'шт',
      note: '',
    },
  ]);
  const [panel, setPanel] = useState<PanelDetails>(initialPanel);
  const [engineering, setEngineering] =
    useState<EngineeringDetails>(initialEngineering);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [fileError, setFileError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);

  const fieldId = (key: string) =>
    `${idPrefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  function clearValidation() {
    setErrors({});
    setReviewReady(false);
  }

  function updateContact<K extends keyof ContactDetails>(
    key: K,
    value: ContactDetails[K],
  ) {
    setContact((current) => ({ ...current, [key]: value }));
    clearValidation();
  }

  function updatePanel<K extends keyof PanelDetails>(
    key: K,
    value: PanelDetails[K],
  ) {
    setPanel((current) => ({ ...current, [key]: value }));
    clearValidation();
  }

  function updateEngineering<K extends keyof EngineeringDetails>(
    key: K,
    value: EngineeringDetails[K],
  ) {
    setEngineering((current) => ({ ...current, [key]: value }));
    clearValidation();
  }

  function updateEquipmentLine<K extends keyof EquipmentLine>(
    id: number,
    key: K,
    value: EquipmentLine[K],
  ) {
    setEquipmentLines((current) =>
      current.map((line) =>
        line.id === id ? { ...line, [key]: value } : line,
      ),
    );
    clearValidation();
  }

  function addEquipmentLine() {
    lineCounter.current += 1;
    setEquipmentLines((current) => [
      ...current,
      {
        id: lineCounter.current,
        name: '',
        brand: '',
        article: '',
        modification: '',
        quantity: '1',
        unit: 'шт',
        note: '',
      },
    ]);
    clearValidation();
  }

  function removeEquipmentLine(id: number) {
    setEquipmentLines((current) => current.filter((line) => line.id !== id));
    clearValidation();
  }

  function addFiles(selectedFiles: FileList | File[]) {
    const accepted: LocalFile[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(selectedFiles)) {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      const type = allowedFileTypes[extension];
      if (!type) {
        rejected.push(file.name);
        continue;
      }
      fileCounter.current += 1;
      accepted.push({
        id: fileCounter.current,
        name: file.name,
        size: file.size,
        type,
      });
    }

    if (accepted.length) setFiles((current) => [...current, ...accepted]);
    setFileError(
      rejected.length
        ? `Не добавлены файлы неподдерживаемого формата: ${rejected.join(', ')}. Доступны XLSX, CSV и PDF.`
        : '',
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  }

  function handleFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  function validateForLocalReview() {
    const nextErrors: ValidationErrors = {};

    if (
      contact.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())
    ) {
      nextErrors['contact.email'] = 'Проверьте формат email.';
    }
    if (
      contact.phone.trim() &&
      !/^\+?[\d\s().-]{6,}$/.test(contact.phone.trim())
    ) {
      nextErrors['contact.phone'] = 'Проверьте формат телефона.';
    }

    if (kind === 'equipment') {
      const describedLines = equipmentLines.filter(equipmentLineHasDescription);
      if (!describedLines.length) {
        nextErrors['equipment.lines'] =
          'Добавьте хотя бы одну описанную позицию или свободное наименование.';
      }
      for (const line of describedLines) {
        const quantity = Number(line.quantity.replace(',', '.'));
        if (!Number.isFinite(quantity) || quantity <= 0) {
          nextErrors[`equipment.${line.id}.quantity`] =
            'Укажите количество больше нуля.';
        }
      }
      if (
        describedLines.length &&
        describedLines.length < equipmentLines.length
      ) {
        for (const line of equipmentLines) {
          if (!equipmentLineHasDescription(line)) {
            nextErrors[`equipment.${line.id}.description`] =
              'Заполните позицию или удалите её.';
          }
        }
      }
    }
    if (kind === 'panels' && !panel.task.trim()) {
      nextErrors['panels.task'] =
        'Коротко опишите, что требуется сделать со шкафом.';
    }
    if (kind === 'panels' && panel.quantity.trim()) {
      const quantity = Number(panel.quantity.replace(',', '.'));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        nextErrors['panels.quantity'] =
          'Укажите количество больше нуля или оставьте поле пустым.';
      }
    }
    if (kind === 'engineering' && !engineering.subject.trim()) {
      nextErrors['engineering.subject'] = 'Опишите предмет инженерной задачи.';
    }

    setErrors(nextErrors);
    const isValid = Object.keys(nextErrors).length === 0;
    setReviewReady(isValid);
    if (!isValid) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
    }
  }

  if (!previewEnabled) {
    return (
      <section className={styles.unavailable} aria-labelledby="preview-title">
        <span className={styles.eyebrow}>Предварительный интерфейс</span>
        <h1 id="preview-title">Запрос КП пока не подключён</h1>
        <p>
          Форма будет доступна после утверждения контракта заявок и подключения
          безопасной отправки. Сейчас этот адрес не принимает и не сохраняет
          данные.
        </p>
        <a href="/">Вернуться на главную</a>
      </section>
    );
  }

  const activeDirection = directions.find(
    (direction) => direction.kind === kind,
  );
  const contactHasChannel = Boolean(
    contact.email.trim() || contact.phone.trim(),
  );
  const describedLines = equipmentLines.filter(equipmentLineHasDescription);

  return (
    <>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Заявка без регистрации</span>
          <h1>Запросить коммерческое предложение</h1>
          <p>
            Оборудование, электрощиты и инженерные решения — опишите задачу и
            приложите исходные материалы.
          </p>
        </div>
        <div className={styles.heroAside}>
          <span className={styles.heroMark} aria-hidden="true">
            <svg fill="none" viewBox="0 0 48 48">
              <path d="M7 11h13v13H7zM28 6h13v13H28zM28 29h13v13H28z" />
              <path d="M20 17.5h5.5V12H28M25.5 17.5v18H28" />
              <circle cx="13.5" cy="17.5" r="1.7" />
              <circle cx="34.5" cy="12.5" r="1.7" />
              <circle cx="34.5" cy="35.5" r="1.7" />
            </svg>
          </span>
          <div>
            <span className={styles.heroAsideKicker}>
              ОДИН ПРОЦЕСС · 3 НАПРАВЛЕНИЯ
            </span>
            <p>Укажите состав запроса — детали можно уточнить позже.</p>
          </div>
        </div>
      </header>

      {productHint ? (
        <aside className={styles.contextNotice} aria-label="Контекст перехода">
          <span className={styles.contextMark} aria-hidden="true">
            ↗
          </span>
          <p>
            Вы перешли из карточки каталога. Параметр ссылки — только подсказка:
            проверьте и укажите нужную позицию вручную.
          </p>
          <code>{productHint}</code>
        </aside>
      ) : null}

      <div className={styles.previewNotice} role="note">
        <span className={styles.previewDot} aria-hidden="true" />
        <p>
          Режим предпросмотра. Данные остаются только в открытой странице, файлы
          не загружаются, отправка отключена.
        </p>
      </div>

      <div className={styles.workspace}>
        <div className={styles.formColumn}>
          <section
            className={styles.directionSection}
            aria-labelledby="direction-title"
          >
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.sectionIndex}>01 / НАПРАВЛЕНИЕ</span>
                <h2 id="direction-title">Что требуется?</h2>
              </div>
              <p>Выберите сценарий — состав полей изменится под задачу.</p>
            </div>
            <div
              className={styles.directionGrid}
              role="group"
              aria-label="Направление заявки"
            >
              {directions.map((direction) => (
                <button
                  aria-pressed={kind === direction.kind}
                  className={[
                    styles.directionCard,
                    kind === direction.kind ? styles.directionCardActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={direction.kind}
                  onClick={() => {
                    setKind(direction.kind);
                    clearValidation();
                  }}
                  type="button"
                >
                  <span className={styles.directionTopline}>
                    <span className={styles.directionIndex}>
                      {direction.index}
                    </span>
                    <span className={styles.directionMark}>
                      <DirectionMark kind={direction.kind} />
                    </span>
                    <span className={styles.selectionMark} aria-hidden="true">
                      {kind === direction.kind ? 'Выбрано' : 'Выбрать'}
                    </span>
                  </span>
                  <strong>{direction.title}</strong>
                  <span className={styles.directionDescription}>
                    {direction.description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section
            className={styles.detailSection}
            aria-labelledby="request-details-title"
          >
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.sectionIndex}>
                  02 / ПРЕДМЕТ ЗАПРОСА
                </span>
                <h2 id="request-details-title">{activeDirection?.title}</h2>
              </div>
              <p>
                Укажите известные детали. Поля можно оставить пустыми, если
                информации пока нет.
              </p>
            </div>

            {kind === 'equipment' ? (
              <div className={styles.detailBody}>
                {productHint ? (
                  <p className={styles.inlineNote}>
                    Контекст карточки не подтверждён и не заменяет описание
                    позиции.
                  </p>
                ) : null}
                {errors['equipment.lines'] ? (
                  <p className={styles.fieldError} role="alert">
                    {errors['equipment.lines']}
                  </p>
                ) : null}
                <div className={styles.lineList}>
                  {equipmentLines.map((line, index) => {
                    const lineDescriptionError =
                      errors[`equipment.${line.id}.description`];
                    const quantityKey = `equipment.${line.id}.quantity`;
                    const quantityId = fieldId(quantityKey);
                    return (
                      <article className={styles.equipmentLine} key={line.id}>
                        <div className={styles.lineHeading}>
                          <span>
                            Позиция {String(index + 1).padStart(2, '0')}
                          </span>
                          <button
                            aria-label={`Удалить позицию ${index + 1}`}
                            className={styles.removeLine}
                            onClick={() => removeEquipmentLine(line.id)}
                            type="button"
                          >
                            Удалить <span aria-hidden="true">×</span>
                          </button>
                        </div>
                        {lineDescriptionError ? (
                          <p className={styles.fieldError} role="alert">
                            {lineDescriptionError}
                          </p>
                        ) : null}
                        <div className={styles.fieldsGrid}>
                          <FieldFrame
                            id={fieldId(`equipment.${line.id}.name`)}
                            label="Наименование"
                            className={styles.fieldWide}
                          >
                            <input
                              autoComplete="off"
                              className={styles.control}
                              id={fieldId(`equipment.${line.id}.name`)}
                              maxLength={240}
                              onChange={(event) =>
                                updateEquipmentLine(
                                  line.id,
                                  'name',
                                  event.target.value,
                                )
                              }
                              placeholder="Например, модульный автоматический выключатель"
                              type="text"
                              value={line.name}
                            />
                          </FieldFrame>
                          <FieldFrame
                            id={fieldId(`equipment.${line.id}.brand`)}
                            label="Производитель / бренд"
                          >
                            <input
                              className={styles.control}
                              id={fieldId(`equipment.${line.id}.brand`)}
                              maxLength={120}
                              onChange={(event) =>
                                updateEquipmentLine(
                                  line.id,
                                  'brand',
                                  event.target.value,
                                )
                              }
                              placeholder="Если известен"
                              type="text"
                              value={line.brand}
                            />
                          </FieldFrame>
                          <FieldFrame
                            id={fieldId(`equipment.${line.id}.article`)}
                            label="Оригинальный артикул"
                          >
                            <input
                              className={styles.control}
                              id={fieldId(`equipment.${line.id}.article`)}
                              maxLength={120}
                              onChange={(event) =>
                                updateEquipmentLine(
                                  line.id,
                                  'article',
                                  event.target.value,
                                )
                              }
                              placeholder="Артикул или код"
                              type="text"
                              value={line.article}
                            />
                          </FieldFrame>
                          <FieldFrame
                            id={fieldId(`equipment.${line.id}.modification`)}
                            label="Модификация"
                          >
                            <input
                              className={styles.control}
                              id={fieldId(`equipment.${line.id}.modification`)}
                              maxLength={120}
                              onChange={(event) =>
                                updateEquipmentLine(
                                  line.id,
                                  'modification',
                                  event.target.value,
                                )
                              }
                              placeholder="При наличии"
                              type="text"
                              value={line.modification}
                            />
                          </FieldFrame>
                          <FieldFrame
                            id={quantityId}
                            label="Количество"
                            error={errors[quantityKey]}
                          >
                            <input
                              aria-describedby={getFieldDescription(
                                quantityId,
                                undefined,
                                errors[quantityKey],
                              )}
                              aria-invalid={Boolean(errors[quantityKey])}
                              className={styles.control}
                              id={quantityId}
                              inputMode="decimal"
                              onChange={(event) =>
                                updateEquipmentLine(
                                  line.id,
                                  'quantity',
                                  event.target.value,
                                )
                              }
                              step="any"
                              type="number"
                              value={line.quantity}
                            />
                          </FieldFrame>
                          <FieldFrame
                            id={fieldId(`equipment.${line.id}.unit`)}
                            label="Единица измерения"
                          >
                            <input
                              className={styles.control}
                              id={fieldId(`equipment.${line.id}.unit`)}
                              maxLength={32}
                              onChange={(event) =>
                                updateEquipmentLine(
                                  line.id,
                                  'unit',
                                  event.target.value,
                                )
                              }
                              type="text"
                              value={line.unit}
                            />
                          </FieldFrame>
                          <FieldFrame
                            id={fieldId(`equipment.${line.id}.note`)}
                            label="Примечание к позиции"
                            className={styles.fieldWide}
                          >
                            <input
                              className={styles.control}
                              id={fieldId(`equipment.${line.id}.note`)}
                              maxLength={500}
                              onChange={(event) =>
                                updateEquipmentLine(
                                  line.id,
                                  'note',
                                  event.target.value,
                                )
                              }
                              placeholder="Параметры, комплектность или условия"
                              type="text"
                              value={line.note}
                            />
                          </FieldFrame>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <button
                  className={styles.addLine}
                  onClick={addEquipmentLine}
                  type="button"
                >
                  <span aria-hidden="true">＋</span> Добавить позицию
                </button>
                <p className={styles.sectionFootnote}>
                  Можно описать изделие своими словами — выбор из каталога не
                  обязателен.
                </p>
              </div>
            ) : null}

            {kind === 'panels' ? (
              <div className={styles.detailBody}>
                <fieldset className={styles.choiceFieldset}>
                  <legend>Тип задачи</legend>
                  <div className={styles.panelTypeGrid}>
                    {panelTypes.map((item) => (
                      <label className={styles.radioCard} key={item.value}>
                        <input
                          checked={panel.requestType === item.value}
                          name={`${idPrefix}-panel-type`}
                          onChange={() =>
                            updatePanel('requestType', item.value)
                          }
                          type="radio"
                          value={item.value}
                        />
                        <span className={styles.radioCardCopy}>
                          <strong>{item.title}</strong>
                          <span>{item.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className={styles.fieldsGrid}>
                  <FieldFrame
                    id={fieldId('panels.purpose')}
                    label="Назначение шкафа"
                  >
                    <input
                      className={styles.control}
                      id={fieldId('panels.purpose')}
                      maxLength={180}
                      onChange={(event) =>
                        updatePanel('purpose', event.target.value)
                      }
                      placeholder="Например, управление вентиляцией"
                      type="text"
                      value={panel.purpose}
                    />
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('panels.quantity')}
                    label="Количество шкафов"
                    error={errors['panels.quantity']}
                  >
                    <input
                      aria-describedby={getFieldDescription(
                        fieldId('panels.quantity'),
                        undefined,
                        errors['panels.quantity'],
                      )}
                      aria-invalid={Boolean(errors['panels.quantity'])}
                      className={styles.control}
                      id={fieldId('panels.quantity')}
                      inputMode="numeric"
                      onChange={(event) =>
                        updatePanel('quantity', event.target.value)
                      }
                      step="1"
                      type="number"
                      value={panel.quantity}
                    />
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('panels.task')}
                    label="Кратко опишите задачу"
                    error={errors['panels.task']}
                    hint="Для локальной проверки укажите, что нужно выполнить."
                    className={styles.fieldWide}
                  >
                    <textarea
                      aria-describedby={getFieldDescription(
                        fieldId('panels.task'),
                        'Кратко опишите, что требуется сделать со шкафом.',
                        errors['panels.task'],
                      )}
                      aria-invalid={Boolean(errors['panels.task'])}
                      className={styles.control}
                      id={fieldId('panels.task')}
                      maxLength={3000}
                      onChange={(event) =>
                        updatePanel('task', event.target.value)
                      }
                      placeholder="Опишите исходную задачу, изменения или желаемый результат"
                      rows={4}
                      value={panel.task}
                    />
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('panels.requirements')}
                    label="Основные требования"
                    className={styles.fieldWide}
                  >
                    <textarea
                      className={styles.control}
                      id={fieldId('panels.requirements')}
                      maxLength={3000}
                      onChange={(event) =>
                        updatePanel('requirements', event.target.value)
                      }
                      placeholder="Параметры системы, условия эксплуатации или ограничения"
                      rows={3}
                      value={panel.requirements}
                    />
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('panels.documentation')}
                    label="Проектная документация"
                  >
                    <select
                      className={styles.control}
                      id={fieldId('panels.documentation')}
                      onChange={(event) =>
                        updatePanel('documentation', event.target.value)
                      }
                      value={panel.documentation}
                    >
                      <option value="unknown">Пока не знаю</option>
                      <option value="available">Есть</option>
                      <option value="partial">Есть частично</option>
                      <option value="none">Нет</option>
                    </select>
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('panels.notes')}
                    label="Дополнительные примечания"
                    className={styles.fieldWide}
                  >
                    <textarea
                      className={styles.control}
                      id={fieldId('panels.notes')}
                      maxLength={3000}
                      onChange={(event) =>
                        updatePanel('notes', event.target.value)
                      }
                      rows={3}
                      value={panel.notes}
                    />
                  </FieldFrame>
                </div>
                <fieldset className={styles.choiceFieldset}>
                  <legend>
                    Возможные услуги <span>— можно выбрать несколько</span>
                  </legend>
                  <div className={styles.checkGrid}>
                    {panelServices.map((service) => (
                      <label className={styles.checkOption} key={service}>
                        <input
                          checked={panel.services.includes(service)}
                          onChange={(event) =>
                            updatePanel(
                              'services',
                              event.target.checked
                                ? [...panel.services, service]
                                : panel.services.filter(
                                    (value) => value !== service,
                                  ),
                            )
                          }
                          type="checkbox"
                          value={service}
                        />
                        <span>{service}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className={styles.sectionFootnote}>
                  Выбор описывает запрос и не является автоматическим подбором
                  комплектации или расчётом стоимости.
                </p>
              </div>
            ) : null}

            {kind === 'engineering' ? (
              <div className={styles.detailBody}>
                <div className={styles.fieldsGrid}>
                  <FieldFrame
                    id={fieldId('engineering.object')}
                    label="Тип объекта или системы"
                  >
                    <input
                      className={styles.control}
                      id={fieldId('engineering.object')}
                      maxLength={180}
                      onChange={(event) =>
                        updateEngineering('object', event.target.value)
                      }
                      placeholder="Например, насосная станция или линия"
                      type="text"
                      value={engineering.object}
                    />
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('engineering.area')}
                    label="Направление работ"
                  >
                    <select
                      className={styles.control}
                      id={fieldId('engineering.area')}
                      onChange={(event) =>
                        updateEngineering('serviceArea', event.target.value)
                      }
                      value={engineering.serviceArea}
                    >
                      <option value="">Выберите, если известно</option>
                      {engineeringAreas.map((area) => (
                        <option key={area} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('engineering.subject')}
                    label="Предмет работ"
                    error={errors['engineering.subject']}
                    hint="Для локальной проверки опишите задачу в свободной форме."
                    className={styles.fieldWide}
                  >
                    <textarea
                      aria-describedby={getFieldDescription(
                        fieldId('engineering.subject'),
                        'Укажите ожидаемую инженерную задачу.',
                        errors['engineering.subject'],
                      )}
                      aria-invalid={Boolean(errors['engineering.subject'])}
                      className={styles.control}
                      id={fieldId('engineering.subject')}
                      maxLength={3000}
                      onChange={(event) =>
                        updateEngineering('subject', event.target.value)
                      }
                      placeholder="Что требуется спроектировать, настроить или проверить?"
                      rows={4}
                      value={engineering.subject}
                    />
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('engineering.documentation')}
                    label="Исходная документация"
                    className={styles.fieldWide}
                  >
                    <textarea
                      className={styles.control}
                      id={fieldId('engineering.documentation')}
                      maxLength={1500}
                      onChange={(event) =>
                        updateEngineering('documentation', event.target.value)
                      }
                      placeholder="Какие схемы, ТЗ или исходные материалы уже есть?"
                      rows={3}
                      value={engineering.documentation}
                    />
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('engineering.scope')}
                    label="Предполагаемый объём работ"
                  >
                    <textarea
                      className={styles.control}
                      id={fieldId('engineering.scope')}
                      maxLength={2500}
                      onChange={(event) =>
                        updateEngineering('scope', event.target.value)
                      }
                      rows={3}
                      value={engineering.scope}
                    />
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('engineering.outcomes')}
                    label="Ожидаемые результаты"
                  >
                    <textarea
                      className={styles.control}
                      id={fieldId('engineering.outcomes')}
                      maxLength={1800}
                      onChange={(event) =>
                        updateEngineering('outcomes', event.target.value)
                      }
                      placeholder="Например, схемы, программа или спецификация"
                      rows={3}
                      value={engineering.outcomes}
                    />
                  </FieldFrame>
                  <FieldFrame
                    id={fieldId('engineering.notes')}
                    label="Дополнительные комментарии"
                    className={styles.fieldWide}
                  >
                    <textarea
                      className={styles.control}
                      id={fieldId('engineering.notes')}
                      maxLength={2500}
                      onChange={(event) =>
                        updateEngineering('notes', event.target.value)
                      }
                      rows={3}
                      value={engineering.notes}
                    />
                  </FieldFrame>
                </div>
                <p className={styles.sectionFootnote}>
                  Подробный готовый проект не обязателен — опишите задачу так,
                  как удобно.
                </p>
              </div>
            ) : null}
          </section>

          <section
            className={styles.contactSection}
            aria-labelledby="contact-title"
          >
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.sectionIndex}>
                  03 / КОНТАКТЫ И СРОКИ
                </span>
                <h2 id="contact-title">Как с вами связаться?</h2>
              </div>
              <p>
                Укажите удобный канал и желаемый срок, если он уже определён.
                Организация и ИНН не обязательны.
              </p>
            </div>
            <div className={styles.fieldsGrid}>
              <FieldFrame id={fieldId('contact.name')} label="Контактное лицо">
                <input
                  autoComplete="name"
                  className={styles.control}
                  id={fieldId('contact.name')}
                  maxLength={180}
                  onChange={(event) =>
                    updateContact('name', event.target.value)
                  }
                  placeholder="Имя для обращения"
                  type="text"
                  value={contact.name}
                />
              </FieldFrame>
              <FieldFrame
                id={fieldId('contact.organization')}
                label="Организация"
              >
                <input
                  autoComplete="organization"
                  className={styles.control}
                  id={fieldId('contact.organization')}
                  maxLength={180}
                  onChange={(event) =>
                    updateContact('organization', event.target.value)
                  }
                  placeholder="Необязательно"
                  type="text"
                  value={contact.organization}
                />
              </FieldFrame>
              <FieldFrame
                id={fieldId('contact.email')}
                label="Email"
                error={errors['contact.email']}
              >
                <input
                  aria-describedby={getFieldDescription(
                    fieldId('contact.email'),
                    undefined,
                    errors['contact.email'],
                  )}
                  aria-invalid={Boolean(errors['contact.email'])}
                  autoComplete="email"
                  className={styles.control}
                  id={fieldId('contact.email')}
                  maxLength={254}
                  onChange={(event) =>
                    updateContact('email', event.target.value)
                  }
                  placeholder="name@company.ru"
                  type="email"
                  value={contact.email}
                />
              </FieldFrame>
              <FieldFrame
                id={fieldId('contact.phone')}
                label="Телефон"
                error={errors['contact.phone']}
              >
                <input
                  aria-describedby={getFieldDescription(
                    fieldId('contact.phone'),
                    undefined,
                    errors['contact.phone'],
                  )}
                  aria-invalid={Boolean(errors['contact.phone'])}
                  autoComplete="tel"
                  className={styles.control}
                  id={fieldId('contact.phone')}
                  maxLength={40}
                  onChange={(event) =>
                    updateContact('phone', event.target.value)
                  }
                  placeholder="+7 (___) ___-__-__"
                  type="tel"
                  value={contact.phone}
                />
              </FieldFrame>
              <FieldFrame
                id={fieldId('contact.channel')}
                label="Предпочтительный способ связи"
              >
                <select
                  className={styles.control}
                  id={fieldId('contact.channel')}
                  onChange={(event) =>
                    updateContact(
                      'channel',
                      event.target.value as ContactChannel,
                    )
                  }
                  value={contact.channel}
                >
                  <option value="any">Подойдёт любой</option>
                  <option value="email">Email</option>
                  <option value="phone">Телефон</option>
                </select>
              </FieldFrame>
              <FieldFrame
                id={fieldId('contact.region')}
                label="Город или регион"
              >
                <input
                  autoComplete="address-level1"
                  className={styles.control}
                  id={fieldId('contact.region')}
                  maxLength={120}
                  onChange={(event) =>
                    updateContact('region', event.target.value)
                  }
                  placeholder="При необходимости"
                  type="text"
                  value={contact.region}
                />
              </FieldFrame>
              <FieldFrame
                id={fieldId('contact.deadline')}
                label="Желаемый срок"
              >
                <input
                  className={styles.control}
                  id={fieldId('contact.deadline')}
                  maxLength={120}
                  onChange={(event) =>
                    updateContact('deadline', event.target.value)
                  }
                  placeholder="Если уже определён"
                  type="text"
                  value={contact.deadline}
                />
              </FieldFrame>
              <FieldFrame
                id={fieldId('contact.comment')}
                label="Комментарий к запросу"
                className={styles.fieldWide}
              >
                <textarea
                  className={styles.control}
                  id={fieldId('contact.comment')}
                  maxLength={3000}
                  onChange={(event) =>
                    updateContact('comment', event.target.value)
                  }
                  rows={3}
                  value={contact.comment}
                />
              </FieldFrame>
            </div>
            <p className={styles.sectionFootnote}>
              Обязательность контактных полей будет определена после утверждения
              контракта заявки.
            </p>
          </section>

          <section
            className={styles.filesSection}
            aria-labelledby="files-title"
          >
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.sectionIndex}>
                  04 / ИСХОДНЫЕ МАТЕРИАЛЫ
                </span>
                <h2 id="files-title">Документы и спецификации</h2>
              </div>
              <p>
                Приложите материалы, если они помогают точнее описать задачу.
              </p>
            </div>
            <div
              className={[
                styles.dropzone,
                dragActive ? styles.dropzoneActive : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  setDragActive(false);
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleFileDrop}
            >
              <div className={styles.dropIcon} aria-hidden="true">
                <svg fill="none" viewBox="0 0 32 32">
                  <path d="M16 21V5m0 0-6 6m6-6 6 6M5 20v7h22v-7" />
                </svg>
              </div>
              <div className={styles.dropCopy}>
                <strong>Перетащите файлы сюда</strong>
                <span>или выберите их с устройства · XLSX, CSV, PDF</span>
              </div>
              <button
                aria-describedby="file-help"
                className={styles.fileSelectButton}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                Выбрать файлы
              </button>
              <input
                accept=".xlsx,.csv,.pdf"
                aria-hidden="true"
                className={styles.fileInput}
                multiple
                onChange={handleFileChange}
                ref={fileInputRef}
                tabIndex={-1}
                type="file"
              />
            </div>
            <p className={styles.fileNote} id="file-help">
              Локальный список для предпросмотра: файлы не отправляются. Тип
              определён по расширению, фактическое содержимое здесь не
              проверяется. Корректный разбор документов не гарантируется.
            </p>
            {fileError ? (
              <p className={styles.fieldError} role="alert">
                {fileError}
              </p>
            ) : null}
            {files.length ? (
              <ul
                aria-label="Выбранные файлы, локальный предпросмотр"
                className={styles.fileList}
              >
                {files.map((file) => (
                  <li className={styles.fileItem} key={file.id}>
                    <span className={styles.fileType} aria-hidden="true">
                      {file.type
                        .replace('Таблица ', '')
                        .replace('Документ ', '')}
                    </span>
                    <span className={styles.fileDetails}>
                      <strong>{file.name}</strong>
                      <span>
                        {file.type} · {formatBytes(file.size)}
                      </span>
                    </span>
                    <button
                      aria-label={`Удалить файл ${file.name}`}
                      className={styles.removeFile}
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((item) => item.id !== file.id),
                        )
                      }
                      type="button"
                    >
                      Удалить
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <div className={styles.finalActions}>
            {Object.keys(errors).length ? (
              <div
                aria-labelledby={`${idPrefix}-error-title`}
                className={styles.errorSummary}
                ref={errorSummaryRef}
                role="alert"
                tabIndex={-1}
              >
                <strong id={`${idPrefix}-error-title`}>
                  Проверьте отмеченные поля
                </strong>
                <ul>
                  {Object.entries(errors).map(([key, message]) => (
                    <li key={key}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className={styles.actionRow}>
              <button
                className={styles.reviewButton}
                onClick={validateForLocalReview}
                type="button"
              >
                Проверить заполнение <span aria-hidden="true">↗</span>
              </button>
              <button
                aria-describedby={`${idPrefix}-unavailable-note`}
                className={styles.submitButton}
                disabled
                type="button"
              >
                Отправка недоступна
              </button>
            </div>
            <p
              className={styles.unavailableNote}
              id={`${idPrefix}-unavailable-note`}
            >
              API заявок ещё не подключён. Проверка выполняется только в
              браузере — запрос никуда не отправляется.
            </p>
          </div>
        </div>

        <aside
          className={styles.summaryColumn}
          aria-labelledby={`${idPrefix}-summary-title`}
        >
          <div className={styles.summaryCard}>
            <div className={styles.summaryHeader}>
              <span className={styles.sectionIndex}>05 / РЕЗЮМЕ</span>
              <span className={styles.localBadge}>ЛОКАЛЬНО</span>
            </div>
            <h2 id={`${idPrefix}-summary-title`}>Ваш запрос</h2>
            <p className={styles.summaryLead}>
              Черновой обзор введённых данных.
            </p>
            <dl className={styles.summaryList}>
              <div>
                <dt>Направление</dt>
                <dd>{requestTitle(kind)}</dd>
              </div>
              {kind === 'equipment' ? (
                <div>
                  <dt>Описано позиций</dt>
                  <dd>{describedLines.length}</dd>
                </div>
              ) : null}
              {kind === 'panels' ? (
                <>
                  <div>
                    <dt>Тип задачи</dt>
                    <dd>
                      {
                        panelTypes.find(
                          (item) => item.value === panel.requestType,
                        )?.title
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Возможные услуги</dt>
                    <dd>
                      {panel.services.length
                        ? panel.services.join(', ')
                        : 'Пока не выбраны'}
                    </dd>
                  </div>
                </>
              ) : null}
              {kind === 'engineering' ? (
                <div>
                  <dt>Направление работ</dt>
                  <dd>{formatValue(engineering.serviceArea)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Контакт</dt>
                <dd>{formatValue(contact.name)}</dd>
              </div>
              <div>
                <dt>Способ связи</dt>
                <dd>
                  {contactHasChannel
                    ? [contact.email, contact.phone].filter(Boolean).join(' · ')
                    : 'Не указан'}
                </dd>
              </div>
              <div>
                <dt>Файлы</dt>
                <dd>
                  {files.length ? `${files.length} · локально` : 'Не приложены'}
                </dd>
              </div>
            </dl>
            {reviewReady ? (
              <div
                aria-live="polite"
                className={styles.reviewSuccess}
                role="status"
              >
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Локальная проверка пройдена</strong>
                  <p>Это резюме не сохранено и не отправлено.</p>
                </div>
              </div>
            ) : null}
            <p className={styles.summaryFootnote}>
              {contactHasChannel
                ? 'Контактные значения показаны только в текущем предпросмотре.'
                : 'Обязательность контактного канала будет определена в контракте.'}
            </p>
          </div>

          <div className={styles.summaryFiles}>
            <span className={styles.summaryFilesIcon} aria-hidden="true">
              ↗
            </span>
            <div>
              <strong>Файлы остаются у вас</strong>
              <p>
                До подключения API выбранные документы не покидают устройство.
              </p>
            </div>
          </div>
        </aside>
      </div>

      {reviewReady ? (
        <section
          aria-labelledby={`${idPrefix}-review-title`}
          className={styles.reviewPanel}
        >
          <div className={styles.reviewPanelHeading}>
            <div>
              <span className={styles.sectionIndex}>ЛОКАЛЬНЫЙ ПРОСМОТР</span>
              <h2 id={`${idPrefix}-review-title`}>Проверьте детали запроса</h2>
            </div>
            <span className={styles.reviewPill}>Не отправлен</span>
          </div>
          <dl className={styles.reviewGrid}>
            <div>
              <dt>Направление</dt>
              <dd>{requestTitle(kind)}</dd>
            </div>
            {kind === 'equipment' ? (
              <div className={styles.reviewWide}>
                <dt>Позиции</dt>
                <dd>
                  {describedLines.length ? (
                    <ul className={styles.reviewLines}>
                      {describedLines.map((line) => (
                        <li key={line.id}>
                          <span>{equipmentLineSummary(line) || line.note}</span>
                          <span>
                            {line.quantity} {line.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    'Не указаны'
                  )}
                </dd>
              </div>
            ) : null}
            {kind === 'panels' ? (
              <>
                <div>
                  <dt>Тип задачи</dt>
                  <dd>
                    {
                      panelTypes.find(
                        (item) => item.value === panel.requestType,
                      )?.title
                    }
                  </dd>
                </div>
                <div>
                  <dt>Желаемый срок</dt>
                  <dd>{formatValue(contact.deadline)}</dd>
                </div>
                <div>
                  <dt>Назначение</dt>
                  <dd>{formatValue(panel.purpose)}</dd>
                </div>
                <div>
                  <dt>Количество шкафов</dt>
                  <dd>{formatValue(panel.quantity)}</dd>
                </div>
                <div>
                  <dt>Документация</dt>
                  <dd>
                    {panel.documentation === 'available'
                      ? 'Есть'
                      : panel.documentation === 'partial'
                        ? 'Есть частично'
                        : panel.documentation === 'none'
                          ? 'Нет'
                          : 'Пока не знаю'}
                  </dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Описание</dt>
                  <dd>{formatValue(panel.task)}</dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Основные требования</dt>
                  <dd>{formatValue(panel.requirements)}</dd>
                </div>
                <div>
                  <dt>Услуги</dt>
                  <dd>{panel.services.join(', ') || 'Не выбраны'}</dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Примечания</dt>
                  <dd>{formatValue(panel.notes)}</dd>
                </div>
              </>
            ) : null}
            {kind === 'engineering' ? (
              <>
                <div>
                  <dt>Объект / система</dt>
                  <dd>{formatValue(engineering.object)}</dd>
                </div>
                <div>
                  <dt>Направление работ</dt>
                  <dd>{formatValue(engineering.serviceArea)}</dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Предмет работ</dt>
                  <dd>{formatValue(engineering.subject)}</dd>
                </div>
                <div>
                  <dt>Объём</dt>
                  <dd>{formatValue(engineering.scope)}</dd>
                </div>
                <div>
                  <dt>Результаты</dt>
                  <dd>{formatValue(engineering.outcomes)}</dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Исходная документация</dt>
                  <dd>{formatValue(engineering.documentation)}</dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Дополнительные комментарии</dt>
                  <dd>{formatValue(engineering.notes)}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Контактное лицо</dt>
              <dd>{formatValue(contact.name)}</dd>
            </div>
            <div>
              <dt>Организация</dt>
              <dd>{formatValue(contact.organization)}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{formatValue(contact.email)}</dd>
            </div>
            <div>
              <dt>Телефон</dt>
              <dd>{formatValue(contact.phone)}</dd>
            </div>
            <div>
              <dt>Предпочтительный канал</dt>
              <dd>
                {contact.channel === 'email'
                  ? 'Email'
                  : contact.channel === 'phone'
                    ? 'Телефон'
                    : 'Любой'}
              </dd>
            </div>
            <div>
              <dt>Регион</dt>
              <dd>{formatValue(contact.region)}</dd>
            </div>
            <div>
              <dt>Желаемый срок</dt>
              <dd>{formatValue(contact.deadline)}</dd>
            </div>
            <div className={styles.reviewWide}>
              <dt>Комментарий</dt>
              <dd>{formatValue(contact.comment)}</dd>
            </div>
            <div className={styles.reviewWide}>
              <dt>Выбранные документы</dt>
              <dd>
                {files.length
                  ? files.map((file) => file.name).join(', ')
                  : 'Не приложены'}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <p className={styles.legalNote}>
        Перед запуском формы будут утверждены правила обработки персональных
        данных и условия приёма документов. Сейчас отправки и юридического
        согласия нет.
      </p>
    </>
  );
}
