import { describe, expect, it } from 'vitest';
import {
  mapRequestQuoteToCreateInquiryRequest,
  validateRequestQuoteForm,
  type ContactDetails,
  type EquipmentLine,
  type RequestQuoteFormState,
} from './request-quote-dto';

const validContact: ContactDetails = {
  name: 'Анна Инженерова',
  organization: '',
  email: 'anna@example.ru',
  phone: '',
  channel: 'any',
  region: '',
  deadline: '',
  comment: '',
};

function equipmentLine(overrides: Partial<EquipmentLine> = {}): EquipmentLine {
  return {
    id: 1,
    name: 'Модульный автоматический выключатель',
    brand: 'IEK',
    article: 'ВА47-29',
    modification: 'C16',
    quantity: '1',
    unit: 'шт',
    note: '',
    ...overrides,
  };
}

function formState(
  overrides: Partial<RequestQuoteFormState> = {},
): RequestQuoteFormState {
  return {
    kind: 'equipment',
    equipmentLines: [equipmentLine()],
    panel: {
      requestType: 'project-ready',
      purpose: '',
      task: '',
      requirements: '',
      documentation: 'unknown',
      services: [],
      quantity: '',
      notes: '',
    },
    engineering: {
      object: '',
      serviceArea: '',
      subject: '',
      documentation: '',
      scope: '',
      outcomes: '',
      notes: '',
    },
    contact: { ...validContact },
    ...overrides,
  };
}

describe('RFQ local validation and contract mapping', () => {
  it('maps one equipment position to the frozen request DTO', () => {
    const result = mapRequestQuoteToCreateInquiryRequest(
      formState({
        equipmentLines: [
          equipmentLine({
            name: '  Автомат защиты двигателя  ',
            quantity: '2,125000',
          }),
        ],
      }),
    );

    expect(result).toMatchObject({
      kind: 'EQUIPMENT',
      equipmentLines: [
        {
          rawTitle: '  Автомат защиты двигателя  ',
          manufacturerName: 'IEK',
          originalSku: 'ВА47-29',
          modification: 'C16',
          quantity: '2,125000',
          unit: 'шт',
          notes: null,
        },
      ],
    });
  });

  it('preserves order and decimal strings for multiple equipment lines', () => {
    const result = mapRequestQuoteToCreateInquiryRequest(
      formState({
        equipmentLines: [
          equipmentLine({
            id: 1,
            name: 'Первая позиция',
            quantity: '0,000001',
          }),
          equipmentLine({ id: 2, name: 'Вторая позиция', quantity: '12.5' }),
        ],
      }),
    );

    expect(
      result.equipmentLines?.map(({ rawTitle, quantity }) => [
        rawTitle,
        quantity,
      ]),
    ).toEqual([
      ['Первая позиция', '0,000001'],
      ['Вторая позиция', '12.5'],
    ]);
  });

  it('allows 50 equipment positions and rejects 51 without changing the input', () => {
    const lines = Array.from({ length: 50 }, (_, index) =>
      equipmentLine({ id: index + 1, name: `Позиция ${index + 1}` }),
    );
    const state = formState({ equipmentLines: lines });
    expect(validateRequestQuoteForm(state)).toEqual({});
    expect(
      mapRequestQuoteToCreateInquiryRequest(state).equipmentLines,
    ).toHaveLength(50);

    const overLimit = [...lines, equipmentLine({ id: 51, name: 'Позиция 51' })];
    const overLimitState = formState({ equipmentLines: overLimit });
    expect(validateRequestQuoteForm(overLimitState)['equipment.limit']).toMatch(
      /не более 50/,
    );
    expect(overLimitState.equipmentLines).toHaveLength(51);
  });

  it('requires a raw title, positive decimal quantity and unit for each line', () => {
    const errors = validateRequestQuoteForm(
      formState({
        equipmentLines: [
          equipmentLine({ name: ' ', quantity: '01,2', unit: '' }),
        ],
      }),
    );

    expect(errors['equipment.1.name']).toMatch(/наименование/);
    expect(errors['equipment.1.quantity']).toMatch(/больше нуля/);
    expect(errors['equipment.1.unit']).toMatch(/единицу измерения/);
  });

  it('requires a contact person and reports missing email or phone locally', () => {
    const errors = validateRequestQuoteForm(
      formState({
        contact: { ...validContact, name: '', email: '', phone: '' },
      }),
    );

    expect(errors['contact.name']).toMatch(/контактное лицо/);
    expect(errors['contact.email']).toMatch(/email или телефон/);
  });

  it('accepts email-only and phone-only contacts', () => {
    const emailOnly = formState({
      contact: { ...validContact, phone: '' },
    });
    expect(validateRequestQuoteForm(emailOnly)).toEqual({});
    expect(
      mapRequestQuoteToCreateInquiryRequest(emailOnly).contact,
    ).toMatchObject({
      email: 'anna@example.ru',
      phone: null,
    });

    const phoneOnly = formState({
      contact: {
        ...validContact,
        email: '',
        phone: '+7 (900) 123-45-67',
      },
    });
    expect(validateRequestQuoteForm(phoneOnly)).toEqual({});
    expect(
      mapRequestQuoteToCreateInquiryRequest(phoneOnly).contact,
    ).toMatchObject({
      email: null,
      phone: '+7 (900) 123-45-67',
    });
  });

  it('requires the selected preferred contact channel to be filled and valid', () => {
    const state = formState({
      contact: { ...validContact, email: '', channel: 'email' },
    });
    expect(validateRequestQuoteForm(state)['contact.channel']).toMatch(
      /корректный email/,
    );
  });

  it('maps each panel request type and preserves the panel details', () => {
    const expected = [
      ['project-ready', 'PROJECT_READY'],
      ['typical-change', 'MODIFY_TYPICAL'],
      ['new-design', 'DEVELOP_FROM_BRIEF'],
    ] as const;

    for (const [requestType, dtoType] of expected) {
      const state = formState({
        kind: 'panels',
        panel: {
          requestType,
          purpose: 'Насосная станция',
          task: 'Изготовить шкаф по проекту',
          requirements: 'IP54',
          documentation: 'partial',
          services: ['Проектирование', 'Сборка'],
          quantity: '2,5',
          notes: '',
        },
      });
      const result = mapRequestQuoteToCreateInquiryRequest(state);

      expect(result.kind).toBe('PANELS');
      expect(result.panels).toMatchObject({
        requestType: dtoType,
        description: 'Изготовить шкаф по проекту',
        cabinetPurpose: 'Насосная станция',
        requirements: 'IP54',
        requestedWork: ['Проектирование', 'Сборка'],
        quantity: '2,5',
        documentationAvailability: 'PARTIAL',
        notes: null,
      });
    }
  });

  it('maps a minimal engineering task and nulls for absent optional fields', () => {
    const result = mapRequestQuoteToCreateInquiryRequest(
      formState({
        kind: 'engineering',
        engineering: {
          object: '',
          serviceArea: '',
          subject: 'Разработать программу управления насосом',
          documentation: '',
          scope: '',
          outcomes: '',
          notes: '',
        },
      }),
    );

    expect(result.engineering).toEqual({
      technicalTask: 'Разработать программу управления насосом',
      systemType: null,
      engineeringDirection: null,
      expectedDeliverables: null,
      sourceDocumentDescription: null,
      scope: null,
      notes: null,
    });
  });

  it('keeps product context as an untrusted hint without adding a SKU', () => {
    const result = mapRequestQuoteToCreateInquiryRequest(
      formState(),
      '  TEST-PRODUCT-HINT  ',
    );

    expect(result.catalogProductContext).toBe('TEST-PRODUCT-HINT');
    expect(result.equipmentLines?.[0]).not.toHaveProperty(
      'catalogProductSlugContext',
    );
    expect(result.equipmentLines?.[0]?.originalSku).toBe('ВА47-29');
  });

  it('enforces OpenAPI text limits before mapping', () => {
    const atLimit = formState({
      equipmentLines: [equipmentLine({ name: 'x'.repeat(500) })],
    });
    expect(validateRequestQuoteForm(atLimit)).toEqual({});

    const overLimit = formState({
      equipmentLines: [equipmentLine({ name: 'x'.repeat(501) })],
    });
    expect(validateRequestQuoteForm(overLimit)['equipment.1.name']).toMatch(
      /500 символов/,
    );
  });
});
