import type { components } from '../../../../../packages/staff-client/src/inquiry-schema';
import { sanitizeProductHint } from './request-quote-utils';

export type RequestKind = 'equipment' | 'panels' | 'engineering';
export type PanelRequestType =
  'project-ready' | 'typical-change' | 'new-design';
export type ContactChannel = 'any' | 'email' | 'phone';
export type DocumentationAvailability =
  'unknown' | 'available' | 'partial' | 'none';

export type EquipmentLine = {
  id: number;
  name: string;
  brand: string;
  article: string;
  modification: string;
  quantity: string;
  unit: string;
  note: string;
};

export type ContactDetails = {
  name: string;
  organization: string;
  email: string;
  phone: string;
  channel: ContactChannel;
  region: string;
  deadline: string;
  comment: string;
};

export type PanelDetails = {
  requestType: PanelRequestType;
  purpose: string;
  task: string;
  requirements: string;
  documentation: DocumentationAvailability;
  services: string[];
  quantity: string;
  notes: string;
};

export type EngineeringDetails = {
  object: string;
  serviceArea: string;
  subject: string;
  documentation: string;
  scope: string;
  outcomes: string;
  notes: string;
};

export type RequestQuoteFormState = {
  kind: RequestKind;
  equipmentLines: EquipmentLine[];
  panel: PanelDetails;
  engineering: EngineeringDetails;
  contact: ContactDetails;
};

export type ValidationErrors = Record<string, string>;
export type CreateInquiryRequest =
  components['schemas']['CreateInquiryRequest'];

export const MAX_EQUIPMENT_LINES = 50;

const positiveDecimalPattern =
  /^(?=.*[1-9])(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[\d\s().-]+$/;

function hasText(value: string) {
  return value.trim().length > 0;
}

function checkMaxLength(
  errors: ValidationErrors,
  key: string,
  value: string,
  maximum: number,
  label: string,
) {
  if (value.length > maximum) {
    errors[key] = `Для поля «${label}» допустимо не более ${maximum} символов.`;
  }
}

function checkOptionalText(
  errors: ValidationErrors,
  key: string,
  value: string,
  maximum: number,
  label: string,
) {
  if (hasText(value)) checkMaxLength(errors, key, value, maximum, label);
}

function validPhone(value: string) {
  return phonePattern.test(value) && (value.match(/\d/g)?.length ?? 0) >= 6;
}

function validateContact(contact: ContactDetails, errors: ValidationErrors) {
  if (!hasText(contact.name)) {
    errors['contact.name'] = 'Укажите контактное лицо.';
  }
  checkMaxLength(errors, 'contact.name', contact.name, 180, 'Контактное лицо');
  checkOptionalText(
    errors,
    'contact.organization',
    contact.organization,
    200,
    'Организация',
  );
  checkOptionalText(errors, 'contact.email', contact.email, 254, 'Email');
  checkOptionalText(errors, 'contact.phone', contact.phone, 40, 'Телефон');
  checkOptionalText(errors, 'contact.region', contact.region, 120, 'Регион');
  checkOptionalText(errors, 'contact.deadline', contact.deadline, 120, 'Срок');
  checkOptionalText(
    errors,
    'contact.comment',
    contact.comment,
    3000,
    'Комментарий',
  );

  const email = contact.email.trim();
  const phone = contact.phone.trim();
  const hasValidEmail = emailPattern.test(email) && email.length <= 254;
  const hasValidPhone = validPhone(phone) && phone.length <= 40;

  if (email && !hasValidEmail && !errors['contact.email']) {
    errors['contact.email'] = 'Проверьте формат email.';
  }
  if (phone && !hasValidPhone && !errors['contact.phone']) {
    errors['contact.phone'] = 'Проверьте формат телефона.';
  }
  if (!hasValidEmail && !hasValidPhone && !email && !phone) {
    errors['contact.email'] = 'Укажите email или телефон для связи.';
  }
  if (contact.channel === 'email' && !hasValidEmail) {
    errors['contact.channel'] =
      'Укажите корректный email для выбранного способа связи.';
  }
  if (contact.channel === 'phone' && !hasValidPhone) {
    errors['contact.channel'] =
      'Укажите корректный телефон для выбранного способа связи.';
  }
}

function validateEquipment(lines: EquipmentLine[], errors: ValidationErrors) {
  if (lines.length === 0) {
    errors['equipment.lines'] = 'Добавьте хотя бы одну позицию.';
  }
  if (lines.length > MAX_EQUIPMENT_LINES) {
    errors['equipment.limit'] = 'Можно указать не более 50 позиций.';
  }

  for (const line of lines) {
    const titleKey = `equipment.${line.id}.name`;
    if (!hasText(line.name)) {
      errors[titleKey] = 'Укажите наименование позиции.';
    }
    checkMaxLength(errors, titleKey, line.name, 500, 'Наименование');
    checkOptionalText(
      errors,
      `equipment.${line.id}.brand`,
      line.brand,
      200,
      'Производитель',
    );
    checkOptionalText(
      errors,
      `equipment.${line.id}.article`,
      line.article,
      160,
      'Артикул',
    );
    checkOptionalText(
      errors,
      `equipment.${line.id}.modification`,
      line.modification,
      200,
      'Модификация',
    );
    if (!positiveDecimalPattern.test(line.quantity)) {
      errors[`equipment.${line.id}.quantity`] =
        'Укажите количество больше нуля; можно использовать точку или запятую и до 6 знаков после неё.';
    }
    if (!hasText(line.unit)) {
      errors[`equipment.${line.id}.unit`] = 'Укажите единицу измерения.';
    }
    checkMaxLength(
      errors,
      `equipment.${line.id}.unit`,
      line.unit,
      40,
      'Единица измерения',
    );
    checkOptionalText(
      errors,
      `equipment.${line.id}.note`,
      line.note,
      4000,
      'Примечание',
    );
  }
}

function validatePanels(panel: PanelDetails, errors: ValidationErrors) {
  checkOptionalText(
    errors,
    'panels.purpose',
    panel.purpose,
    2000,
    'Назначение шкафа',
  );
  checkOptionalText(
    errors,
    'panels.requirements',
    panel.requirements,
    8000,
    'Требования',
  );
  checkOptionalText(errors, 'panels.notes', panel.notes, 3000, 'Примечания');
  if (!hasText(panel.task)) {
    errors['panels.task'] = 'Коротко опишите, что требуется сделать со шкафом.';
  }
  checkMaxLength(errors, 'panels.task', panel.task, 8000, 'Описание задачи');
  if (panel.quantity.trim() && !positiveDecimalPattern.test(panel.quantity)) {
    errors['panels.quantity'] =
      'Укажите количество больше нуля; можно использовать точку или запятую и до 6 знаков после неё.';
  }
  if (panel.quantity.length > 19) {
    errors['panels.quantity'] =
      'Количество должно содержать не более 19 символов.';
  }
  if (panel.services.length > 50) {
    errors['panels.services'] = 'Выберите не более 50 видов работ.';
  }
  panel.services.forEach((service, index) =>
    checkMaxLength(
      errors,
      `panels.services.${index}`,
      service,
      500,
      'Вид работ',
    ),
  );
}

function validateEngineering(
  engineering: EngineeringDetails,
  errors: ValidationErrors,
) {
  checkOptionalText(
    errors,
    'engineering.object',
    engineering.object,
    200,
    'Тип объекта или системы',
  );
  checkOptionalText(
    errors,
    'engineering.area',
    engineering.serviceArea,
    200,
    'Направление работ',
  );
  if (!hasText(engineering.subject)) {
    errors['engineering.subject'] = 'Опишите предмет инженерной задачи.';
  }
  checkMaxLength(
    errors,
    'engineering.subject',
    engineering.subject,
    8000,
    'Предмет работ',
  );
  checkOptionalText(
    errors,
    'engineering.documentation',
    engineering.documentation,
    1500,
    'Исходная документация',
  );
  checkOptionalText(
    errors,
    'engineering.scope',
    engineering.scope,
    2500,
    'Объём работ',
  );
  checkOptionalText(
    errors,
    'engineering.outcomes',
    engineering.outcomes,
    1800,
    'Ожидаемые результаты',
  );
  checkOptionalText(
    errors,
    'engineering.notes',
    engineering.notes,
    2500,
    'Комментарий',
  );
}

export function validateRequestQuoteForm(
  form: RequestQuoteFormState,
): ValidationErrors {
  const errors: ValidationErrors = {};
  validateContact(form.contact, errors);

  if (form.kind === 'equipment') validateEquipment(form.equipmentLines, errors);
  if (form.kind === 'panels') validatePanels(form.panel, errors);
  if (form.kind === 'engineering')
    validateEngineering(form.engineering, errors);

  return errors;
}

function optionalText(value: string) {
  return hasText(value) ? value : null;
}

function mapContact(contact: ContactDetails) {
  const email = optionalText(contact.email.trim());
  const phone = optionalText(contact.phone.trim());
  const preferredChannel =
    contact.channel === 'email'
      ? 'EMAIL'
      : contact.channel === 'phone'
        ? 'PHONE'
        : null;
  const common = {
    contactName: contact.name,
    organization: optionalText(contact.organization),
    taxIdentifier: null,
    preferredChannel,
    region: optionalText(contact.region),
    desiredDeadline: optionalText(contact.deadline),
    customerComment: optionalText(contact.comment),
  };

  if (email) return { ...common, email, phone };
  if (phone) return { ...common, email: null, phone };
  throw new Error('Перед маппингом укажите email или телефон.');
}

const panelRequestTypeMap = {
  'project-ready': 'PROJECT_READY',
  'typical-change': 'MODIFY_TYPICAL',
  'new-design': 'DEVELOP_FROM_BRIEF',
} as const;

const documentationAvailabilityMap = {
  unknown: 'UNKNOWN',
  available: 'AVAILABLE',
  partial: 'PARTIAL',
  none: 'NONE',
} as const;

export function mapRequestQuoteToCreateInquiryRequest(
  form: RequestQuoteFormState,
  productHint?: string,
): CreateInquiryRequest {
  const errors = validateRequestQuoteForm(form);
  if (Object.keys(errors).length > 0) {
    throw new Error('Проверьте локальную форму перед преобразованием DTO.');
  }

  const contact = mapContact(form.contact);

  if (form.kind === 'equipment') {
    return {
      kind: 'EQUIPMENT',
      contact,
      catalogProductContext: sanitizeProductHint(productHint) ?? null,
      equipmentLines: form.equipmentLines.map((line) => ({
        rawTitle: line.name,
        manufacturerName: optionalText(line.brand),
        originalSku: optionalText(line.article),
        modification: optionalText(line.modification),
        quantity: line.quantity,
        unit: line.unit,
        notes: optionalText(line.note),
      })),
    };
  }

  if (form.kind === 'panels') {
    return {
      kind: 'PANELS',
      contact,
      panels: {
        requestType: panelRequestTypeMap[form.panel.requestType],
        description: form.panel.task,
        cabinetPurpose: optionalText(form.panel.purpose),
        requirements: optionalText(form.panel.requirements),
        requestedWork: [...form.panel.services],
        quantity: optionalText(form.panel.quantity),
        documentationAvailability:
          documentationAvailabilityMap[form.panel.documentation],
        notes: optionalText(form.panel.notes),
      },
    };
  }

  return {
    kind: 'ENGINEERING',
    contact,
    engineering: {
      technicalTask: form.engineering.subject,
      systemType: optionalText(form.engineering.object),
      engineeringDirection: optionalText(form.engineering.serviceArea),
      expectedDeliverables: optionalText(form.engineering.outcomes),
      sourceDocumentDescription: optionalText(form.engineering.documentation),
      scope: optionalText(form.engineering.scope),
      notes: optionalText(form.engineering.notes),
    },
  };
}
