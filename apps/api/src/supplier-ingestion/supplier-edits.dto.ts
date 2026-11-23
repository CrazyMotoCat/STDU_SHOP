import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsObject,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { StaffError } from '../identity/errors.js';
import { IngestionApplyInput } from './supplier-ingestion.dto.js';

export const editableFacts = {
  purchaseCost: 'purchase_cost',
  currency: 'currency',
  sourceVatText: 'source_vat_text',
  availabilityText: 'availability_text',
  leadTimeText: 'lead_time_text',
  sourceUrl: 'source_url',
} as const;

export type EditedField = keyof typeof editableFacts;
export type FactEdit =
  | { op: 'KEEP' }
  | { op: 'SET'; value: string }
  | { op: 'CLEAR'; reason: string };

export class IngestionEditsPreviewInput extends IngestionApplyInput {
  @ApiProperty({
    type: 'object',
    description:
      'Field-specific KEEP, SET (with value) or CLEAR (with reason) operations. Omission is KEEP.',
    additionalProperties: {
      oneOf: [
        {
          type: 'object',
          required: ['op'],
          properties: { op: { type: 'string', enum: ['KEEP'] } },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['op', 'value'],
          properties: {
            op: { type: 'string', enum: ['SET'] },
            value: { type: 'string', minLength: 1, maxLength: 2048 },
          },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['op', 'reason'],
          properties: {
            op: { type: 'string', enum: ['CLEAR'] },
            reason: { type: 'string', minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
      ],
    },
  })
  @IsObject()
  edits!: Partial<Record<EditedField, FactEdit>>;

  @ApiPropertyOptional({
    type: String,
    pattern: '^[a-f0-9]{64}$',
    description:
      'Digest of the captured source snapshot used as evidence for clearing price or currency.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  evidenceHash?: string;
}

export class IngestionApplyEditsInput extends IngestionEditsPreviewInput {
  @ApiProperty({ type: String, pattern: '^\\d{13}\\.[a-f0-9]{64}$' })
  @IsString()
  @Matches(/^\d{13}\.[a-f0-9]{64}$/)
  previewToken!: string;

  @ApiProperty({ type: Boolean, enum: [true] })
  @Equals(true)
  confirmed!: true;
}

export function readEdits(value: IngestionEditsPreviewInput['edits']) {
  const result: Partial<Record<EditedField, FactEdit>> = {};
  for (const [name, edit] of Object.entries(value)) {
    if (
      !Object.hasOwn(editableFacts, name) ||
      !edit ||
      typeof edit !== 'object' ||
      Array.isArray(edit)
    )
      throw new StaffError('VALIDATION_ERROR');
    const field = name as EditedField;
    const size = Object.keys(edit).length;
    if (edit.op === 'KEEP' && size === 1) continue;
    if (
      edit.op === 'SET' &&
      size === 2 &&
      typeof edit.value === 'string' &&
      edit.value.trim() &&
      edit.value.length <= 2048
    ) {
      result[field] = edit;
      continue;
    }
    if (
      edit.op === 'CLEAR' &&
      size === 2 &&
      typeof edit.reason === 'string' &&
      edit.reason.trim() &&
      edit.reason.length <= 500 &&
      !edit.reason.includes(String.fromCharCode(0))
    ) {
      result[field] = edit;
      continue;
    }
    throw new StaffError('VALIDATION_ERROR');
  }
  return result;
}
