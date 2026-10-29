'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import {
  addUploadCapability,
  generateRfqSecret,
  hasValidUploadFilenameLength,
  PublicInquiryApiError,
} from './request-quote-api';
import {
  MAX_EQUIPMENT_LINES,
  mapRequestQuoteToCreateInquiryRequest,
  validateRequestQuoteForm,
  type ContactChannel,
  type ContactDetails,
  type DocumentationAvailability,
  type EngineeringDetails,
  type EquipmentLine,
  type PanelDetails,
  type PanelRequestType,
  type RequestKind,
  type ValidationErrors,
} from './request-quote-dto';
import {
  hasUnconfirmedCreateAfterNavigation,
  PublicInquirySubmission,
  type SubmissionView,
} from './request-quote-submission';
import styles from './page.module.css';

type DirectionOption = {
  kind: RequestKind;
  index: string;
  title: string;
  description: string;
};
type LocalFile = {
  id: number;
  name: string;
  size: number;
  type: string;
  declaredMimeType: string;
};
type LocalRequestPreview =
  | {
      kind: 'equipment';
      productContext?: { value: string; verified: false };
      positions: Array<{
        id: number;
        description: string;
        quantity: string;
        unit: string;
      }>;
      contact: ContactDetails;
      files: LocalFile[];
    }
  | {
      kind: 'panels';
      details: PanelDetails;
      contact: ContactDetails;
      files: LocalFile[];
    }
  | {
      kind: 'engineering';
      details: EngineeringDetails;
      contact: ContactDetails;
      files: LocalFile[];
    };

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

const allowedFileTypes: Readonly<
  Record<string, { label: string; declaredMimeType: string }>
> = {
  xlsx: {
    label: 'Таблица XLSX',
    declaredMimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  csv: { label: 'Таблица CSV', declaredMimeType: 'text/csv' },
  pdf: { label: 'Документ PDF', declaredMimeType: 'application/pdf' },
};

// The frozen API does not expose the selected upload profile. Use its strictest
// profile in the UI; the API remains authoritative and may apply lower quotas.
const MAX_SELECTED_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 25 * 1024 * 1024;

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

// Page-local display model only. This is not a server request DTO.
function buildLocalRequestPreview({
  kind,
  equipmentLines,
  panel,
  engineering,
  contact,
  files,
  productHint,
}: {
  kind: RequestKind;
  equipmentLines: EquipmentLine[];
  panel: PanelDetails;
  engineering: EngineeringDetails;
  contact: ContactDetails;
  files: LocalFile[];
  productHint?: string;
}): LocalRequestPreview {
  const shared = {
    contact: { ...contact },
    files: files.map((file) => ({ ...file })),
  };

  if (kind === 'equipment') {
    return {
      kind,
      ...shared,
      productContext: productHint
        ? { value: productHint, verified: false }
        : undefined,
      positions: equipmentLines
        .filter(equipmentLineHasDescription)
        .map((line) => ({
          id: line.id,
          description: equipmentLineSummary(line),
          quantity: line.quantity,
          unit: line.unit,
        })),
    };
  }

  if (kind === 'panels') {
    return {
      kind,
      ...shared,
      details: { ...panel, services: [...panel.services] },
    };
  }

  return { kind, ...shared, details: { ...engineering } };
}

export function RequestQuoteForm({
  initialKind,
  productHint,
  previewEnabled,
  apiSubmissionEnabled,
}: {
  initialKind: RequestKind;
  productHint?: string;
  previewEnabled: boolean;
  apiSubmissionEnabled: boolean;
}) {
  const idPrefix = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const lineCounter = useRef(1);
  const fileCounter = useRef(0);
  const fileBytes = useRef(new Map<number, File>());
  const uploadCapability = useRef<string | undefined>(undefined);
  const submissionController = useRef<PublicInquirySubmission | null>(null);
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
  const [localReviewPassed, setLocalReviewPassed] = useState(false);
  const [unconfirmedPreviousCreate, setUnconfirmedPreviousCreate] =
    useState(false);
  const [submission, setSubmission] = useState<SubmissionView>({
    phase: 'idle',
    retryCreate: false,
    fieldErrors: [],
    files: [],
  });

  const formLocked =
    submission.phase === 'creating' ||
    submission.phase === 'create-unknown' ||
    submission.phase === 'create-blocked' ||
    submission.phase === 'uploading' ||
    submission.phase === 'partial' ||
    submission.phase === 'complete' ||
    (submission.phase === 'create-rejected' && submission.retryCreate);

  useEffect(() => {
    setUnconfirmedPreviousCreate(hasUnconfirmedCreateAfterNavigation());
    return () => {
      submissionController.current?.dispose();
      fileBytes.current.clear();
      uploadCapability.current = undefined;
    };
  }, []);

  useEffect(() => {
    const shouldWarnBeforeLeaving =
      submission.phase === 'creating' ||
      submission.phase === 'create-unknown' ||
      submission.phase === 'uploading' ||
      submission.phase === 'partial';
    if (!shouldWarnBeforeLeaving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [submission.phase]);

  const fieldId = (key: string) =>
    `${idPrefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  function clearValidation() {
    setErrors({});
    setLocalReviewPassed(false);
    if (submission.phase === 'create-rejected' && !submission.retryCreate) {
      submissionController.current = null;
      setSubmission({
        phase: 'idle',
        retryCreate: false,
        fieldErrors: [],
        files: [],
      });
    }
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
    if (equipmentLines.length >= MAX_EQUIPMENT_LINES) return;
    lineCounter.current += 1;
    const newLine: EquipmentLine = {
      id: lineCounter.current,
      name: '',
      brand: '',
      article: '',
      modification: '',
      quantity: '1',
      unit: 'шт',
      note: '',
    };
    setEquipmentLines((current) =>
      current.length >= MAX_EQUIPMENT_LINES ? current : [...current, newLine],
    );
    clearValidation();
  }

  function removeEquipmentLine(id: number) {
    setEquipmentLines((current) => current.filter((line) => line.id !== id));
    clearValidation();
  }

  function addFiles(selectedFiles: FileList | File[]) {
    if (formLocked) return;
    const accepted: LocalFile[] = [];
    const rejected: string[] = [];
    const currentBytes = files.reduce((total, file) => total + file.size, 0);
    let pendingBytes = currentBytes;
    let needsCapability = false;

    for (const file of Array.from(selectedFiles)) {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      const descriptor = allowedFileTypes[extension];
      if (!descriptor) {
        rejected.push(`${file.name} (формат не поддерживается)`);
        continue;
      }
      if (!hasValidUploadFilenameLength(file.name)) {
        rejected.push(`${file.name} (имя должно быть не длиннее 255 символов)`);
        continue;
      }
      if (file.size < 1 || file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name} (допустимо до 10 МиБ на файл)`);
        continue;
      }
      if (files.length + accepted.length >= MAX_SELECTED_FILES) {
        rejected.push(`${file.name} (не более 5 файлов)`);
        continue;
      }
      if (pendingBytes + file.size > MAX_TOTAL_FILE_BYTES) {
        rejected.push(`${file.name} (общий предел — 25 МиБ)`);
        continue;
      }
      fileCounter.current += 1;
      if (apiSubmissionEnabled) {
        fileBytes.current.set(fileCounter.current, file);
        needsCapability = true;
      }
      accepted.push({
        id: fileCounter.current,
        name: file.name,
        size: file.size,
        type: descriptor.label,
        declaredMimeType: descriptor.declaredMimeType,
      });
      pendingBytes += file.size;
    }

    if (needsCapability && !uploadCapability.current) {
      try {
        uploadCapability.current = generateRfqSecret();
      } catch {
        accepted.forEach((file) => fileBytes.current.delete(file.id));
        setFileError(
          'Этот браузер не поддерживает безопасную подготовку загрузки. Выбранные файлы не добавлены.',
        );
        return;
      }
    }

    if (accepted.length) setFiles((current) => [...current, ...accepted]);
    setFileError(
      rejected.length
        ? `Не добавлены файлы: ${rejected.slice(0, 5).join(', ')}.`
        : '',
    );
  }

  function removeSelectedFile(id: number) {
    fileBytes.current.delete(id);
    const next = files.filter((file) => file.id !== id);
    setFiles(next);
    if (next.length === 0) uploadCapability.current = undefined;
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  }

  function handleFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (formLocked) return;
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  function validateForm() {
    const nextErrors = validateRequestQuoteForm({
      kind,
      equipmentLines,
      panel,
      engineering,
      contact,
    });
    return nextErrors;
  }

  function validateForLocalReview() {
    const nextErrors = validateForm();
    setErrors(nextErrors);
    const isValid = Object.keys(nextErrors).length === 0;
    setLocalReviewPassed(isValid);
    if (!isValid) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
    }
  }

  function mapApiFieldErrors(
    fieldErrors: SubmissionView['fieldErrors'],
  ): ValidationErrors {
    const mapped: ValidationErrors = {};
    for (const error of fieldErrors) {
      if (error.field === 'contact' || error.field.startsWith('contact.')) {
        const suffix = error.field.split('.').at(-1);
        const key =
          suffix === 'contactName' || suffix === 'name'
            ? 'contact.name'
            : suffix === 'email' || suffix === 'phone'
              ? `contact.${suffix}`
              : suffix === 'preferredChannel'
                ? 'contact.channel'
                : undefined;
        if (key) mapped[key] = 'Проверьте это поле.';
        continue;
      }
      if (error.field === 'equipmentLines') {
        const firstLine = equipmentLines[0];
        if (firstLine)
          mapped[`equipment.${firstLine.id}.name`] =
            'Проверьте позиции оборудования.';
        continue;
      }
      if (error.field === 'panels') {
        mapped['panels.task'] = 'Проверьте описание задачи по электрощиту.';
        continue;
      }
      if (error.field === 'engineering') {
        mapped['engineering.subject'] = 'Проверьте описание инженерной задачи.';
      }
    }
    return mapped;
  }

  function onSubmissionChange(next: SubmissionView) {
    setSubmission(next);
    if (next.fieldErrors.length) setErrors(mapApiFieldErrors(next.fieldErrors));
    for (const file of next.files) {
      if (file.phase === 'uploaded' || file.phase === 'skipped')
        fileBytes.current.delete(file.id);
    }
    if (next.phase === 'complete') uploadCapability.current = undefined;
  }

  function fileStatus(fileId: number) {
    const state = submission.files.find((item) => item.id === fileId);
    if (!state) return undefined;
    const label =
      state.phase === 'queued'
        ? 'Ожидает загрузки'
        : state.phase === 'creating-intent'
          ? 'Подготовка загрузки…'
          : state.phase === 'uploading'
            ? 'Загружается…'
            : state.phase === 'uploaded'
              ? 'Принят · карантин до проверки безопасности'
              : state.phase === 'skipped'
                ? 'Не приложен'
                : (state.message ?? 'Загрузка не завершена');
    return { ...state, label };
  }

  function submitInquiry() {
    if (!apiSubmissionEnabled) return;
    if (hasUnconfirmedCreateAfterNavigation()) {
      setUnconfirmedPreviousCreate(true);
      return;
    }
    if (submission.phase === 'create-unknown' || submission.retryCreate) {
      void submissionController.current?.retryCreation();
      return;
    }
    if (submissionController.current) return;
    if (submission.phase !== 'idle' && submission.phase !== 'create-rejected')
      return;

    const nextErrors = validateForm();
    setErrors(nextErrors);
    setLocalReviewPassed(false);
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }

    try {
      const mapped = mapRequestQuoteToCreateInquiryRequest(
        { kind, equipmentLines, panel, engineering, contact },
        productHint,
      );
      const request = addUploadCapability(
        mapped,
        files.length ? uploadCapability.current : undefined,
      );
      const uploads = files.flatMap((file) => {
        const selected = fileBytes.current.get(file.id);
        return selected
          ? [
              {
                id: file.id,
                file: selected,
                declaredMimeType: file.declaredMimeType,
              },
            ]
          : [];
      });
      if (uploads.length !== files.length) {
        setFileError(
          'Файл больше недоступен в памяти страницы. Выберите его снова.',
        );
        return;
      }
      if (files.length && !uploadCapability.current) {
        setFileError('Не удалось подготовить безопасную загрузку файлов.');
        return;
      }
      const controller = new PublicInquirySubmission({
        request,
        capability: files.length ? uploadCapability.current : undefined,
        files: uploads,
        onChange: onSubmissionChange,
      });
      submissionController.current = controller;
      setSubmission(controller.getSnapshot());
      void controller.start();
    } catch (error) {
      setErrors({ request: 'Не удалось подготовить заявку к отправке.' });
      if (error instanceof PublicInquiryApiError)
        setFileError('Безопасная отправка в этой среде недоступна.');
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
  const equipmentLineLimitReached =
    equipmentLines.length >= MAX_EQUIPMENT_LINES;
  const localPreview = buildLocalRequestPreview({
    kind,
    equipmentLines,
    panel,
    engineering,
    contact,
    files,
    productHint,
  });

  return (
    <>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Заявка без регистрации</span>
          <h1>Запросить коммерческое предложение</h1>
          <p>
            Опишите запрос по оборудованию, электрощитам или инженерным работам.
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
              ЕДИНАЯ ФОРМА · 3 НАПРАВЛЕНИЯ
            </span>
            <p>Детали запроса можно уточнить позже.</p>
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
          {apiSubmissionEnabled
            ? 'Тестовый режим: данные отправляются только в изолированную среду. Вложения остаются в карантине до проверки.'
            : 'Предпросмотр: данные остаются в браузере; отправка и загрузка файлов отключены.'}
        </p>
      </div>

      <div className={styles.workspace}>
        <div className={styles.formColumn}>
          <fieldset className={styles.formFieldset} disabled={formLocked}>
            <legend className={styles.formLegend}>Данные заявки</legend>
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
                  Заполните обязательные поля; остальные детали укажите, если
                  информация уже известна.
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
                  <div className={styles.lineList}>
                    {equipmentLines.map((line, index) => {
                      const lineDescriptionError =
                        errors[`equipment.${line.id}.name`] ??
                        (index === 0 && !describedLines.length
                          ? errors['equipment.lines']
                          : undefined);
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
                          <div className={styles.fieldsGrid}>
                            <FieldFrame
                              id={fieldId(`equipment.${line.id}.name`)}
                              label="Наименование"
                              error={lineDescriptionError}
                              className={styles.fieldWide}
                            >
                              <input
                                aria-describedby={getFieldDescription(
                                  fieldId(`equipment.${line.id}.name`),
                                  undefined,
                                  lineDescriptionError,
                                )}
                                aria-invalid={Boolean(lineDescriptionError)}
                                aria-required="true"
                                autoComplete="off"
                                className={styles.control}
                                id={fieldId(`equipment.${line.id}.name`)}
                                maxLength={500}
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
                                maxLength={200}
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
                                maxLength={160}
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
                                id={fieldId(
                                  `equipment.${line.id}.modification`,
                                )}
                                maxLength={200}
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
                                maxLength={19}
                                onChange={(event) =>
                                  updateEquipmentLine(
                                    line.id,
                                    'quantity',
                                    event.target.value,
                                  )
                                }
                                pattern="^(?=.*[1-9])(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?$"
                                type="text"
                                value={line.quantity}
                              />
                            </FieldFrame>
                            <FieldFrame
                              id={fieldId(`equipment.${line.id}.unit`)}
                              label="Единица измерения"
                              error={errors[`equipment.${line.id}.unit`]}
                            >
                              <input
                                aria-describedby={getFieldDescription(
                                  fieldId(`equipment.${line.id}.unit`),
                                  undefined,
                                  errors[`equipment.${line.id}.unit`],
                                )}
                                aria-invalid={Boolean(
                                  errors[`equipment.${line.id}.unit`],
                                )}
                                aria-required="true"
                                className={styles.control}
                                id={fieldId(`equipment.${line.id}.unit`)}
                                maxLength={40}
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
                                maxLength={4000}
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
                    aria-describedby={
                      equipmentLineLimitReached
                        ? fieldId('equipment.line-limit')
                        : undefined
                    }
                    className={styles.addLine}
                    disabled={equipmentLineLimitReached}
                    onClick={addEquipmentLine}
                    type="button"
                  >
                    <span aria-hidden="true">＋</span> Добавить позицию
                  </button>
                  {equipmentLineLimitReached ? (
                    <p
                      className={styles.sectionFootnote}
                      id={fieldId('equipment.line-limit')}
                      role="status"
                    >
                      Достигнут лимит: не более 50 позиций. Чтобы добавить ещё,
                      удалите ненужную строку.
                    </p>
                  ) : null}
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
                        maxLength={2000}
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
                        inputMode="decimal"
                        maxLength={19}
                        onChange={(event) =>
                          updatePanel('quantity', event.target.value)
                        }
                        pattern="^(?=.*[1-9])(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?$"
                        type="text"
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
                        maxLength={8000}
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
                        maxLength={8000}
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
                          updatePanel(
                            'documentation',
                            event.target.value as DocumentationAvailability,
                          )
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
                        maxLength={200}
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
                        maxLength={8000}
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
                  Контактное лицо и хотя бы один корректный email или телефон
                  обязательны. Организация не обязательна.
                </p>
              </div>
              <div className={styles.fieldsGrid}>
                <FieldFrame
                  id={fieldId('contact.name')}
                  label="Контактное лицо *"
                  error={errors['contact.name']}
                >
                  <input
                    aria-describedby={getFieldDescription(
                      fieldId('contact.name'),
                      undefined,
                      errors['contact.name'],
                    )}
                    aria-invalid={Boolean(errors['contact.name'])}
                    aria-required="true"
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
                    maxLength={200}
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
                  error={errors['contact.channel']}
                >
                  <select
                    aria-describedby={getFieldDescription(
                      fieldId('contact.channel'),
                      undefined,
                      errors['contact.channel'],
                    )}
                    aria-invalid={Boolean(errors['contact.channel'])}
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
                Укажите предпочтительный канал только при заполненном контакте
                этого типа.
              </p>
            </section>
          </fieldset>

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
                disabled={formLocked}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                Выбрать файлы
              </button>
              <input
                accept=".xlsx,.csv,.pdf"
                aria-hidden="true"
                className={styles.fileInput}
                disabled={formLocked}
                multiple
                onChange={handleFileChange}
                ref={fileInputRef}
                tabIndex={-1}
                type="file"
              />
            </div>
            <p className={styles.fileNote} id="file-help">
              {apiSubmissionEnabled
                ? 'Разрешены PDF, CSV и XLSX. Файл проверяется сервером и остаётся в карантине до проверки безопасности.'
                : 'Предпросмотр без загрузки: тип определён по расширению, содержимое не проверяется. Корректный разбор документов не гарантируется.'}
            </p>
            {fileError ? (
              <p className={styles.fieldError} role="alert">
                {fileError}
              </p>
            ) : null}
            {files.length ? (
              <ul aria-label="Выбранные файлы" className={styles.fileList}>
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
                      {fileStatus(file.id) ? (
                        <span
                          aria-live="polite"
                          className={
                            fileStatus(file.id)?.phase === 'failed'
                              ? styles.fileStatusError
                              : styles.fileStatus
                          }
                        >
                          {fileStatus(file.id)?.label}
                        </span>
                      ) : null}
                    </span>
                    {fileStatus(file.id)?.retryable ? (
                      <button
                        className={styles.retryFileButton}
                        disabled={submission.phase !== 'partial'}
                        onClick={() =>
                          void submissionController.current?.retryFile(file.id)
                        }
                        type="button"
                      >
                        Повторить файл
                      </button>
                    ) : null}
                    {fileStatus(file.id)?.phase === 'failed' &&
                    !fileStatus(file.id)?.retryable ? (
                      <button
                        aria-label={`Продолжить без файла ${file.name}`}
                        className={styles.retryFileButton}
                        disabled={submission.phase !== 'partial'}
                        onClick={() =>
                          void submissionController.current?.skipFailedFile(
                            file.id,
                          )
                        }
                        type="button"
                      >
                        Не прикладывать
                      </button>
                    ) : null}
                    <button
                      aria-label={`Удалить файл ${file.name}`}
                      className={styles.removeFile}
                      disabled={formLocked}
                      onClick={() => removeSelectedFile(file.id)}
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
              {!apiSubmissionEnabled ? (
                <button
                  className={styles.reviewButton}
                  onClick={validateForLocalReview}
                  type="button"
                >
                  Проверить заполнение <span aria-hidden="true">↗</span>
                </button>
              ) : null}
              <button
                aria-describedby={`${idPrefix}-unavailable-note`}
                className={styles.submitButton}
                disabled={
                  !apiSubmissionEnabled ||
                  unconfirmedPreviousCreate ||
                  submission.phase === 'creating' ||
                  submission.phase === 'uploading' ||
                  submission.phase === 'partial' ||
                  submission.phase === 'complete' ||
                  submission.phase === 'create-blocked'
                }
                onClick={submitInquiry}
                type="button"
              >
                {!apiSubmissionEnabled
                  ? 'Отправка недоступна'
                  : submission.phase === 'creating'
                    ? 'Создаём заявку…'
                    : submission.phase === 'uploading'
                      ? 'Заявка создана · загружаем файлы…'
                      : submission.phase === 'partial'
                        ? 'Проверьте загрузку файлов ниже'
                        : submission.phase === 'complete'
                          ? 'Заявка создана'
                          : submission.phase === 'create-blocked'
                            ? 'Создание не подтверждено'
                            : submission.retryCreate
                              ? 'Повторить ту же отправку'
                              : 'Отправить в тестовую среду'}
              </button>
            </div>
            <p
              className={styles.unavailableNote}
              id={`${idPrefix}-unavailable-note`}
            >
              {apiSubmissionEnabled
                ? 'Отправка доступна только в development/test. Повтор создания использует исходный текст и ключ операции.'
                : 'API заявок в этой среде отключён. Проверка выполняется только в браузере — запрос никуда не отправляется.'}
            </p>
            {unconfirmedPreviousCreate ? (
              <p className={styles.submissionError} role="alert">
                Результат предыдущей отправки не подтверждён: заявка могла быть
                создана. Не отправляйте её повторно.
              </p>
            ) : null}
            {submission.message ? (
              <p
                aria-live="polite"
                className={
                  submission.phase === 'create-unknown' ||
                  submission.phase === 'partial' ||
                  submission.phase === 'uploading'
                    ? styles.submissionNotice
                    : styles.submissionError
                }
                role={
                  submission.phase === 'create-unknown' ||
                  submission.phase === 'partial' ||
                  submission.phase === 'uploading'
                    ? 'status'
                    : 'alert'
                }
              >
                {submission.message}
              </p>
            ) : null}
            {submission.receipt ? (
              <div className={styles.receiptPanel} role="status">
                <strong>{submission.receipt.message}</strong>
                <span>
                  Публичный номер: {submission.receipt.publicReference}
                </span>
                <span>
                  Создано:{' '}
                  {new Intl.DateTimeFormat('ru-RU', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(submission.receipt.createdAt))}
                </span>
                <small>
                  Номер не является кодом доступа; публичный просмотр статуса не
                  предусмотрен.
                </small>
              </div>
            ) : null}
          </div>
        </div>

        <aside
          className={styles.summaryColumn}
          aria-labelledby={`${idPrefix}-summary-title`}
        >
          <div className={styles.summaryCard}>
            <div className={styles.summaryHeader}>
              <span className={styles.sectionIndex}>05 / РЕЗЮМЕ</span>
              <span className={styles.localBadge}>
                {apiSubmissionEnabled ? 'ТЕСТОВЫЙ РЕЖИМ' : 'ЛОКАЛЬНО'}
              </span>
            </div>
            <h2 id={`${idPrefix}-summary-title`}>Ваш запрос</h2>
            <p className={styles.summaryLead}>
              {apiSubmissionEnabled
                ? 'Сводка данных перед отправкой в тестовую среду.'
                : 'Черновой обзор введённых данных.'}
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
                  {files.length ? `${files.length} · выбраны` : 'Не приложены'}
                </dd>
              </div>
            </dl>
            {localReviewPassed ? (
              <div
                aria-live="polite"
                className={styles.reviewSuccess}
                role="status"
              >
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Проверка доступных полей пройдена</strong>
                  <p>
                    Требования к отправке будут применены после подключения
                    сервиса. Данные не сохранены и не отправлены.
                  </p>
                </div>
              </div>
            ) : null}
            <p className={styles.summaryFootnote}>
              {contactHasChannel
                ? apiSubmissionEnabled
                  ? 'Данные остаются только в текущей сессии и не сохраняются в браузере.'
                  : 'Контактные значения показаны только в текущем предпросмотре.'
                : 'Для проверки заполните контактное лицо и email или телефон.'}
            </p>
          </div>

          <div className={styles.summaryFiles}>
            <span className={styles.summaryFilesIcon} aria-hidden="true">
              ↗
            </span>
            <div>
              <strong>
                {apiSubmissionEnabled
                  ? 'Загруженные файлы в карантине'
                  : 'Файлы остаются у вас'}
              </strong>
              <p>
                {apiSubmissionEnabled
                  ? 'Состояние каждого вложения показано рядом с его именем.'
                  : 'До включения API документы не покидают устройство.'}
              </p>
            </div>
          </div>
        </aside>
      </div>

      {!apiSubmissionEnabled && localReviewPassed ? (
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
            {localPreview.kind === 'equipment' ? (
              <div className={styles.reviewWide}>
                <dt>Позиции</dt>
                <dd>
                  {localPreview.positions.length ? (
                    <ul className={styles.reviewLines}>
                      {localPreview.positions.map((line) => (
                        <li key={line.id}>
                          <span>{line.description}</span>
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
            {localPreview.kind === 'equipment' &&
            localPreview.productContext ? (
              <div className={styles.reviewWide}>
                <dt>Контекст каталога</dt>
                <dd>
                  {localPreview.productContext.value} · подсказка, не
                  подтверждённая позиция
                </dd>
              </div>
            ) : null}
            {localPreview.kind === 'panels' ? (
              <>
                <div>
                  <dt>Тип задачи</dt>
                  <dd>
                    {
                      panelTypes.find(
                        (item) =>
                          item.value === localPreview.details.requestType,
                      )?.title
                    }
                  </dd>
                </div>
                <div>
                  <dt>Желаемый срок</dt>
                  <dd>{formatValue(localPreview.contact.deadline)}</dd>
                </div>
                <div>
                  <dt>Назначение</dt>
                  <dd>{formatValue(localPreview.details.purpose)}</dd>
                </div>
                <div>
                  <dt>Количество шкафов</dt>
                  <dd>{formatValue(localPreview.details.quantity)}</dd>
                </div>
                <div>
                  <dt>Документация</dt>
                  <dd>
                    {localPreview.details.documentation === 'available'
                      ? 'Есть'
                      : localPreview.details.documentation === 'partial'
                        ? 'Есть частично'
                        : localPreview.details.documentation === 'none'
                          ? 'Нет'
                          : 'Пока не знаю'}
                  </dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Описание</dt>
                  <dd>{formatValue(localPreview.details.task)}</dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Основные требования</dt>
                  <dd>{formatValue(localPreview.details.requirements)}</dd>
                </div>
                <div>
                  <dt>Услуги</dt>
                  <dd>
                    {localPreview.details.services.join(', ') || 'Не выбраны'}
                  </dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Примечания</dt>
                  <dd>{formatValue(localPreview.details.notes)}</dd>
                </div>
              </>
            ) : null}
            {localPreview.kind === 'engineering' ? (
              <>
                <div>
                  <dt>Объект / система</dt>
                  <dd>{formatValue(localPreview.details.object)}</dd>
                </div>
                <div>
                  <dt>Направление работ</dt>
                  <dd>{formatValue(localPreview.details.serviceArea)}</dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Предмет работ</dt>
                  <dd>{formatValue(localPreview.details.subject)}</dd>
                </div>
                <div>
                  <dt>Объём</dt>
                  <dd>{formatValue(localPreview.details.scope)}</dd>
                </div>
                <div>
                  <dt>Результаты</dt>
                  <dd>{formatValue(localPreview.details.outcomes)}</dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Исходная документация</dt>
                  <dd>{formatValue(localPreview.details.documentation)}</dd>
                </div>
                <div className={styles.reviewWide}>
                  <dt>Дополнительные комментарии</dt>
                  <dd>{formatValue(localPreview.details.notes)}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Контактное лицо</dt>
              <dd>{formatValue(localPreview.contact.name)}</dd>
            </div>
            <div>
              <dt>Организация</dt>
              <dd>{formatValue(localPreview.contact.organization)}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{formatValue(localPreview.contact.email)}</dd>
            </div>
            <div>
              <dt>Телефон</dt>
              <dd>{formatValue(localPreview.contact.phone)}</dd>
            </div>
            <div>
              <dt>Предпочтительный канал</dt>
              <dd>
                {localPreview.contact.channel === 'email'
                  ? 'Email'
                  : localPreview.contact.channel === 'phone'
                    ? 'Телефон'
                    : 'Любой'}
              </dd>
            </div>
            <div>
              <dt>Регион</dt>
              <dd>{formatValue(localPreview.contact.region)}</dd>
            </div>
            <div>
              <dt>Желаемый срок</dt>
              <dd>{formatValue(localPreview.contact.deadline)}</dd>
            </div>
            <div className={styles.reviewWide}>
              <dt>Комментарий</dt>
              <dd>{formatValue(localPreview.contact.comment)}</dd>
            </div>
            <div className={styles.reviewWide}>
              <dt>Выбранные документы</dt>
              <dd>
                {localPreview.files.length
                  ? localPreview.files.map((file) => file.name).join(', ')
                  : 'Не приложены'}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <p className={styles.legalNote}>
        {apiSubmissionEnabled
          ? 'Тестовая отправка доступна только в development/test. Не вводите реальные персональные данные. Для production ещё нужны утверждённые правила обработки данных и условия приёма документов.'
          : 'Перед включением отправки будут утверждены правила обработки персональных данных и условия приёма документов. Сейчас форма не передаёт введённые данные.'}
      </p>
    </>
  );
}
