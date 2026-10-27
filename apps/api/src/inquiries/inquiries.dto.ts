import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ContactSnapshotDto {
  @ApiProperty({ minLength: 1, maxLength: 180 })
  @IsString()
  @Length(1, 180)
  contactName!: string;

  @ApiPropertyOptional({ nullable: true, format: 'email', maxLength: 254 })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 24 })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  taxIdentifier?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: ['EMAIL', 'PHONE'] })
  @IsOptional()
  @IsIn(['EMAIL', 'PHONE'])
  preferredChannel?: 'EMAIL' | 'PHONE' | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  desiredDeadline?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 3000 })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  customerComment?: string | null;
}

export class EquipmentLineDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @Length(1, 500)
  rawTitle!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  originalSku?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturerName?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  modification?: string | null;

  @ApiProperty({
    maxLength: 19,
    pattern: '^(?=.*[1-9])(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?$',
  })
  @IsString()
  @Matches(/^(?=.*[1-9])(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?$/)
  quantity!: string;

  @ApiProperty({ minLength: 1, maxLength: 40 })
  @IsString()
  @Length(1, 40)
  unit!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  catalogProductSlugContext?: string | null;
}

export class PanelsDetailsDto {
  @ApiProperty({
    enum: ['PROJECT_READY', 'MODIFY_TYPICAL', 'DEVELOP_FROM_BRIEF'],
  })
  @IsIn(['PROJECT_READY', 'MODIFY_TYPICAL', 'DEVELOP_FROM_BRIEF'])
  requestType!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cabinetPurpose?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 19 })
  @IsOptional()
  @IsString()
  @Matches(/^(?=.*[1-9])(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?$/)
  quantity?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 8000 })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  requirements?: string | null;
  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    items: { type: 'string', maxLength: 500 },
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  requestedWork?: string[];
  @ApiProperty({ minLength: 1, maxLength: 8000 })
  @IsString()
  @Length(1, 8000)
  description!: string;
  @ApiPropertyOptional({
    nullable: true,
    enum: ['UNKNOWN', 'AVAILABLE', 'PARTIAL', 'NONE'],
  })
  @IsOptional()
  @IsIn(['UNKNOWN', 'AVAILABLE', 'PARTIAL', 'NONE'])
  documentationAvailability?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 3000 })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  notes?: string | null;
}

export class EngineeringDetailsDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  engineeringDirection?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  systemType?: string | null;
  @ApiProperty({ minLength: 1, maxLength: 8000 })
  @IsString()
  @Length(1, 8000)
  technicalTask!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 1800 })
  @IsOptional()
  @IsString()
  @MaxLength(1800)
  expectedDeliverables?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 1500 })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  sourceDocumentDescription?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 2500 })
  @IsOptional()
  @IsString()
  @MaxLength(2500)
  scope?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 2500 })
  @IsOptional()
  @IsString()
  @MaxLength(2500)
  notes?: string | null;
}

export class PrivacyNoticeDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  version!: string;
  @ApiProperty()
  @IsBoolean()
  accepted!: boolean;
}

export class CreateInquiryDto {
  @ApiProperty({ enum: ['EQUIPMENT', 'PANELS', 'ENGINEERING'] })
  @IsIn(['EQUIPMENT', 'PANELS', 'ENGINEERING'])
  kind!: 'EQUIPMENT' | 'PANELS' | 'ENGINEERING';
  @ApiProperty({ type: ContactSnapshotDto })
  @ValidateNested()
  @Type(() => ContactSnapshotDto)
  contact!: ContactSnapshotDto;
  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  catalogProductContext?: string | null;
  @ApiPropertyOptional({ nullable: true, pattern: '^[A-Za-z0-9_-]{43}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  uploadCapability?: string | null;
  @ApiPropertyOptional({ type: [EquipmentLineDto], minItems: 1, maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EquipmentLineDto)
  equipmentLines?: EquipmentLineDto[];
  @ApiPropertyOptional({ type: PanelsDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PanelsDetailsDto)
  panels?: PanelsDetailsDto;
  @ApiPropertyOptional({ type: EngineeringDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EngineeringDetailsDto)
  engineering?: EngineeringDetailsDto;
  @ApiPropertyOptional({ type: PrivacyNoticeDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacyNoticeDto)
  privacyNotice?: { version: string; accepted: boolean } | null;
}

export class CreateUploadIntentDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  filename!: string;
  @ApiProperty({ minLength: 3, maxLength: 127 })
  @IsString()
  @Length(3, 127)
  declaredMimeType!: string;
  @ApiProperty({ minimum: 1, maximum: 52428800 })
  @IsInt()
  @Min(1)
  @Max(52428800)
  sizeBytes!: number;
  @ApiPropertyOptional({ nullable: true, pattern: '^[a-fA-F0-9]{64}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  expectedSha256?: string | null;
}

export class AssignmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  staffUserId!: string;
}

export class StageDeadlineDto {
  @ApiProperty({
    nullable: true,
    format: 'date-time',
    pattern:
      '^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$',
  })
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @Matches(
    /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
  )
  @IsISO8601({ strict: true, strictSeparator: true })
  stageDueAt!: string | null;
}

const standardTransitionPairs = new Set([
  'TRIAGE:TRIAGE_STARTED',
  'NEEDS_CLARIFICATION:MORE_INFORMATION_REQUIRED',
  'TRIAGE:INFORMATION_RECEIVED',
  'ENGINEERING_REVIEW:ENGINEERING_STARTED',
  'NEEDS_CLARIFICATION:RETURN_TO_CLARIFICATION',
  'READY_FOR_QUOTE:ENGINEERING_COMPLETE',
]);
const closureReasons = new Set([
  'DUPLICATE',
  'CUSTOMER_WITHDRAWN',
  'OUT_OF_SCOPE',
  'SPAM',
  'NOT_FEASIBLE',
]);

@ValidatorConstraint({ name: 'inquiryTransitionPair', async: false })
class InquiryTransitionPairConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const dto = args.object as { toStatus?: unknown; reasonCode?: unknown };
    if (typeof dto.toStatus !== 'string' || typeof dto.reasonCode !== 'string')
      return false;
    return dto.toStatus === 'CLOSED'
      ? closureReasons.has(dto.reasonCode)
      : standardTransitionPairs.has(`${dto.toStatus}:${dto.reasonCode}`);
  }

  defaultMessage() {
    return 'Transition status and reasonCode must match one strict request variant.';
  }
}

export class TransitionDto {
  @ApiProperty({
    enum: [
      'TRIAGE',
      'NEEDS_CLARIFICATION',
      'ENGINEERING_REVIEW',
      'READY_FOR_QUOTE',
      'CLOSED',
    ],
  })
  @IsString()
  @MaxLength(40)
  @Validate(InquiryTransitionPairConstraint)
  toStatus!: string;

  @ApiProperty({
    enum: [
      'TRIAGE_STARTED',
      'MORE_INFORMATION_REQUIRED',
      'INFORMATION_RECEIVED',
      'ENGINEERING_STARTED',
      'ENGINEERING_COMPLETE',
      'RETURN_TO_CLARIFICATION',
      'DUPLICATE',
      'CUSTOMER_WITHDRAWN',
      'OUT_OF_SCOPE',
      'SPAM',
      'NOT_FEASIBLE',
    ],
  })
  @IsString()
  @MaxLength(64)
  reasonCode!: string;
}

export class CreateCommentDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 4000,
    pattern: '\\S',
  })
  @IsString()
  @Length(1, 4000)
  @Matches(/\S/)
  body!: string;
}

export class InquiryListQueryDto {
  @ApiPropertyOptional({
    enum: [
      'NEW',
      'TRIAGE',
      'NEEDS_CLARIFICATION',
      'ENGINEERING_REVIEW',
      'READY_FOR_QUOTE',
      'QUOTE_SENT',
      'CLOSED',
    ],
  })
  @IsOptional()
  @IsIn([
    'NEW',
    'TRIAGE',
    'NEEDS_CLARIFICATION',
    'ENGINEERING_REVIEW',
    'READY_FOR_QUOTE',
    'QUOTE_SENT',
    'CLOSED',
  ])
  status?: string;
  @ApiPropertyOptional({ enum: ['EQUIPMENT', 'PANELS', 'ENGINEERING'] })
  @IsOptional()
  @IsIn(['EQUIPMENT', 'PANELS', 'ENGINEERING'])
  kind?: string;
  @ApiPropertyOptional({ enum: ['ME', 'UNASSIGNED'] })
  @IsOptional()
  @IsIn(['ME', 'UNASSIGNED'])
  assignee?: 'ME' | 'UNASSIGNED';
  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PageQueryDto {
  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
