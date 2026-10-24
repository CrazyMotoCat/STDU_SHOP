import {
  ApiProperty,
  ApiPropertyOptional,
  ApiSchema,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export enum SupplierRootState {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum SupplierFreshness {
  CURRENT = 'CURRENT',
  STALE = 'STALE',
  UNKNOWN = 'UNKNOWN',
}

export enum SupplierMatchStatus {
  CURRENT = 'CURRENT',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  UNMATCHED = 'UNMATCHED',
}

export enum SupplierProposalState {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum ModificationEvidence {
  SPECIFIED = 'SPECIFIED',
  CONFIRMED_NONE = 'CONFIRMED_NONE',
  UNKNOWN = 'UNKNOWN',
}

@ApiSchema({ name: 'SupplierError' })
export class SupplierErrorDto {
  @ApiProperty({ type: 'string', maxLength: 80 }) code!: string;
  @ApiProperty({ type: 'string', maxLength: 500 }) message!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      type: 'array',
      items: { type: 'string', maxLength: 120 },
    },
  })
  fields?: Record<string, string[]>;
  @ApiProperty({ type: 'string', format: 'uuid' }) requestId!: string;
}

export class LimitCursorQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    type: 'string',
    maxLength: 512,
    pattern: '^[A-Za-z0-9_-]+$',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}

export class SupplierListQueryDto extends LimitCursorQueryDto {
  @ApiPropertyOptional({ enum: SupplierRootState })
  @IsOptional()
  @IsEnum(SupplierRootState)
  state?: SupplierRootState;
}

export class OfferListQueryDto extends SupplierListQueryDto {
  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  supplierId?: string;

  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  catalogProductId?: string;

  @ApiPropertyOptional({ enum: SupplierFreshness })
  @IsOptional()
  @IsEnum(SupplierFreshness)
  freshness?: SupplierFreshness;

  @ApiPropertyOptional({ enum: SupplierMatchStatus })
  @IsOptional()
  @IsEnum(SupplierMatchStatus)
  matchStatus?: SupplierMatchStatus;

  @ApiPropertyOptional({ type: 'string', pattern: '^[A-Z]{3}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({
    enum: ['observedAt', 'purchaseCost', 'supplierName'],
    default: 'observedAt',
  })
  @IsOptional()
  @IsEnum(['observedAt', 'purchaseCost', 'supplierName'])
  sortBy?: 'observedAt' | 'purchaseCost' | 'supplierName';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortDirection?: 'ASC' | 'DESC';
}

export class ProposalListQueryDto extends LimitCursorQueryDto {
  @ApiPropertyOptional({ enum: SupplierProposalState })
  @IsOptional()
  @IsEnum(SupplierProposalState)
  state?: SupplierProposalState;
}

export class CreateSupplierDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 240 })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  legalName!: string;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  shortName?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxIdentifier?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    pattern: '^[A-Z]{2}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  taxJurisdiction?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  contactName?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 254 })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 2048 })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  website?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  internalNotes?: string | null;
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ArchiveSupplierDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  reasonCode!: string;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
}

export class OfferRevisionFieldsDto {
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  brandId!: string | null;

  @ApiProperty({ type: 'string', maxLength: 200, nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(200)
  manufacturerName!: string | null;

  @ApiProperty({ type: 'string', maxLength: 160, nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(160)
  originalPartNumber!: string | null;

  @ApiProperty({ type: 'string', maxLength: 160, nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(160)
  modification!: string | null;

  @ApiProperty({ enum: ModificationEvidence })
  @IsEnum(ModificationEvidence)
  modificationEvidence!: ModificationEvidence;

  @ApiPropertyOptional({ type: 'string', maxLength: 160, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  sourceBrandText?: string | null;

  @ApiPropertyOptional({ type: 'string', maxLength: 160, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  supplierPartNumber?: string | null;

  @ApiPropertyOptional({ type: 'string', maxLength: 240, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  offerName?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    maxLength: 64,
    nullable: true,
    pattern: '^(?:[1-9][0-9]*(?:\\.[0-9]*[1-9])?|0\\.[0-9]*[1-9])$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(?:[1-9][0-9]*(?:\.[0-9]*[1-9])?|0\.[0-9]*[1-9])$/)
  @MaxLength(64)
  purchaseCost?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    maxLength: 3,
    nullable: true,
    pattern: '^[A-Z]{3}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string | null;

  @ApiPropertyOptional({ type: 'string', maxLength: 160, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  sourceVatText?: string | null;

  @ApiPropertyOptional({ type: 'string', maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  availabilityText?: string | null;

  @ApiPropertyOptional({ type: 'string', maxLength: 160, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  leadTimeText?: string | null;

  @ApiPropertyOptional({ type: 'string', format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString()
  sourceObservedAt?: string | null;

  @ApiPropertyOptional({ type: 'string', format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    format: 'uri',
    maxLength: 2048,
    nullable: true,
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  sourceUrl?: string | null;
}

export class CreateSupplierOfferDto extends OfferRevisionFieldsDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  supplierId!: string;
}

export class ReviseSupplierOfferDto extends OfferRevisionFieldsDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateMatchProposalDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  productId!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedOfferVersion!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedProductVersion!: number;
}

export class DecideMatchProposalDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsEnum(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedOfferVersion!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedProductVersion!: number;

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  expectedCurrentMatchProposalId!: string | null;

  @ApiProperty({ type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  reasonCode!: string;

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason?: string;
}

export class UnlinkMatchDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  expectedCurrentMatchProposalId!: string | null;

  @ApiProperty({ type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  reasonCode!: string;

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

@ApiSchema({ name: 'SupplierMeta' })
export class SupplierMetaDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) requestId!: string;
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100 })
  limit?: number;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 512 })
  nextCursor?: string | null;
}

@ApiSchema({ name: 'Supplier' })
export class SupplierDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 240 })
  legalName!: string;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  shortName?: string | null;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 64 })
  taxIdentifier!: string | null;
  @ApiProperty({ type: 'string', nullable: true, pattern: '^[A-Z]{2}$' })
  taxJurisdiction!: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  contactName?: string | null;
  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    format: 'email',
    maxLength: 254,
  })
  email?: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 64 })
  phone?: string | null;
  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    format: 'uri',
    maxLength: 2048,
  })
  website?: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 4000 })
  internalNotes?: string | null;
  @ApiProperty({ enum: SupplierRootState }) state!: SupplierRootState;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty({ type: 'string', format: 'uuid' }) currentRevisionId!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string;
}

@ApiSchema({ name: 'SupplierRevision' })
export class SupplierRevisionDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', format: 'uuid' }) supplierId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) revisionNo!: number;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 240 })
  legalName!: string;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 160 })
  shortName!: string | null;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 64 })
  taxIdentifier!: string | null;
  @ApiProperty({ type: 'string', nullable: true, pattern: '^[A-Z]{2}$' })
  taxJurisdiction!: string | null;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 160 })
  contactName!: string | null;
  @ApiProperty({
    type: 'string',
    nullable: true,
    format: 'email',
    maxLength: 254,
  })
  email!: string | null;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 64 })
  phone!: string | null;
  @ApiProperty({
    type: 'string',
    nullable: true,
    format: 'uri',
    maxLength: 2048,
  })
  website!: string | null;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 4000 })
  internalNotes!: string | null;
  @ApiProperty({ type: 'string', format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: 'string', format: 'uuid' })
  recordedByStaffUserId!: string;
}

@ApiSchema({ name: 'OfferRevision' })
export class OfferRevisionResponseDto {
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  brandId!: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  sourceBrandText?: string | null;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 200 })
  manufacturerName!: string | null;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 160 })
  originalPartNumber!: string | null;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 160 })
  modification!: string | null;
  @ApiProperty({ enum: ModificationEvidence })
  modificationEvidence!: ModificationEvidence;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  supplierPartNumber?: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 240 })
  offerName?: string | null;
  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    maxLength: 64,
    pattern: '^(?:[1-9][0-9]*(?:\\.[0-9]*[1-9])?|0\\.[0-9]*[1-9])$',
  })
  purchaseCost?: string | null;
  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    maxLength: 3,
    pattern: '^[A-Z]{3}$',
  })
  currency?: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  sourceVatText?: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500 })
  availabilityText?: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  leadTimeText?: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, format: 'date-time' })
  sourceObservedAt?: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, format: 'date-time' })
  expiresAt?: string | null;
  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    format: 'uri',
    maxLength: 2048,
    pattern: '^https?://',
  })
  sourceUrl?: string | null;
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) revisionNo!: number;
  @ApiProperty({ type: 'string', enum: ['MANUAL'] }) origin!: 'MANUAL';
  @ApiProperty({ type: 'string', format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: 'string', format: 'uuid' })
  recordedByStaffUserId!: string;
}

@ApiSchema({ name: 'SupplierOffer' })
export class SupplierOfferDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', format: 'uuid' }) supplierId!: string;
  @ApiProperty({ type: 'string', maxLength: 240 }) supplierName!: string;
  @ApiPropertyOptional({ type: 'string', nullable: true, format: 'uuid' })
  catalogProductId?: string | null;
  @ApiProperty({ enum: SupplierRootState }) state!: SupplierRootState;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty({ type: () => OfferRevisionResponseDto })
  currentRevision!: OfferRevisionResponseDto;
  @ApiProperty({ enum: SupplierFreshness }) freshness!: SupplierFreshness;
  @ApiProperty({ enum: SupplierMatchStatus }) matchStatus!: SupplierMatchStatus;
  @ApiProperty({ type: 'string', nullable: true, format: 'uuid' })
  currentMatchProposalId!: string | null;
}

@ApiSchema({ name: 'SupplierAuditEvent' })
export class SupplierAuditEventDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', maxLength: 80 }) action!: string;
  @ApiProperty({ type: 'string', format: 'uuid' }) entityId!: string;
  @ApiProperty({ type: 'string', format: 'uuid' }) actorId!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string;
  @ApiProperty({
    type: 'array',
    maxItems: 32,
    items: { type: 'string', maxLength: 80 },
  })
  changedFieldNames!: string[];
  @ApiProperty({ type: 'string', nullable: true, maxLength: 64 })
  reasonCode!: string | null;
}

@ApiSchema({ name: 'SupplierResponse' })
export class SupplierResponseDto {
  @ApiProperty({ type: () => SupplierDto }) data!: SupplierDto;
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}

@ApiSchema({ name: 'SupplierListResponse' })
export class SupplierListResponseDto {
  @ApiProperty({ type: () => [SupplierDto] }) data!: SupplierDto[];
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}

@ApiSchema({ name: 'SupplierRevisionListResponse' })
export class SupplierRevisionListResponseDto {
  @ApiProperty({ type: () => [SupplierRevisionDto] })
  data!: SupplierRevisionDto[];
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}
@ApiSchema({ name: 'OfferListResponse' })
export class OfferListResponseDto {
  @ApiProperty({ type: () => [SupplierOfferDto] }) data!: SupplierOfferDto[];
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}
@ApiSchema({ name: 'RevisionListResponse' })
export class OfferRevisionListResponseDto {
  @ApiProperty({ type: () => [OfferRevisionResponseDto] })
  data!: OfferRevisionResponseDto[];
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}

@ApiSchema({ name: 'MatchCandidate' })
export class MatchCandidateDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) productId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) productVersion!: number;
  @ApiProperty({ type: 'string', format: 'uuid' }) brandId!: string;
  @ApiPropertyOptional({ type: 'string', maxLength: 160 }) brandName?: string;
  @ApiProperty({ type: 'string', maxLength: 200 }) manufacturerName!: string;
  @ApiProperty({ type: 'string', maxLength: 160 }) originalPartNumber!: string;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 160 })
  modification!: string | null;
  @ApiProperty({ type: 'string', enum: ['STRICT_IDENTITY_EXACT'] })
  identityEvidenceKind!: 'STRICT_IDENTITY_EXACT';
}

@ApiSchema({ name: 'CandidateListData' })
export class CandidateListDataDto {
  @ApiProperty({ type: 'boolean' }) identityComplete!: boolean;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 64 })
  reasonCode?: string | null;
  @ApiProperty({ type: () => [MatchCandidateDto] })
  candidates!: MatchCandidateDto[];
}

@ApiSchema({ name: 'CandidateListResponse' })
export class CandidateListResponseDto {
  @ApiProperty({ type: () => CandidateListDataDto })
  data!: CandidateListDataDto;
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}

@ApiSchema({ name: 'Proposal' })
export class ProposalDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', format: 'uuid' }) offerId!: string;
  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  offerRevisionId?: string;
  @ApiProperty({ type: 'string', format: 'uuid' }) productId!: string;
  @ApiProperty({ enum: SupplierProposalState }) state!: SupplierProposalState;
  @ApiProperty({ type: 'string', enum: ['STRICT_IDENTITY_EXACT'] })
  evidenceKind!: 'STRICT_IDENTITY_EXACT';
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ type: 'string', format: 'date-time', nullable: true })
  decidedAt?: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 64 })
  decisionReasonCode?: string | null;
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 1000 })
  decisionComment?: string | null;
  @ApiProperty({ type: 'boolean' }) currentForOffer!: boolean;
}

@ApiSchema({ name: 'ProposalListResponse' })
export class ProposalListResponseDto {
  @ApiProperty({ type: () => [ProposalDto] }) data!: ProposalDto[];
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}

@ApiSchema({ name: 'ProposalResponse' })
export class ProposalResponseDto {
  @ApiProperty({ type: () => ProposalDto }) data!: ProposalDto;
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}
@ApiSchema({ name: 'AuditListResponse' })
export class AuditListResponseDto {
  @ApiProperty({ type: () => [SupplierAuditEventDto] })
  data!: SupplierAuditEventDto[];
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}

@ApiSchema({ name: 'SupplierMutationData' })
export class SupplierMutationDataDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiPropertyOptional({ type: 'string', format: 'uuid' }) revisionId?: string;
}

@ApiSchema({ name: 'OfferMutationData' })
export class OfferMutationDataDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiPropertyOptional({ type: 'string', format: 'uuid' }) revisionId?: string;
}

@ApiSchema({ name: 'SupplierMutationReceipt' })
export class SupplierMutationReceiptDto {
  @ApiProperty({ type: () => SupplierMutationDataDto })
  data!: SupplierMutationDataDto;
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}

@ApiSchema({ name: 'OfferMutationReceipt' })
export class OfferMutationReceiptDto {
  @ApiProperty({ type: () => OfferMutationDataDto })
  data!: OfferMutationDataDto;
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}

@ApiSchema({ name: 'OfferUnlinkMutationData' })
export class OfferUnlinkMutationDataDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
}

@ApiSchema({ name: 'OfferUnlinkMutationReceipt' })
export class OfferUnlinkMutationReceiptDto {
  @ApiProperty({ type: () => OfferUnlinkMutationDataDto })
  data!: OfferUnlinkMutationDataDto;
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}

@ApiSchema({ name: 'OfferResponse' })
export class OfferResponseDto {
  @ApiProperty({ type: () => SupplierOfferDto }) data!: SupplierOfferDto;
  @ApiProperty({ type: () => SupplierMetaDto }) meta!: SupplierMetaDto;
}
