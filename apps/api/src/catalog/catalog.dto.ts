import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const attributeCodePattern = /^[a-z][a-z0-9_]{1,79}$/;
const optionCodePattern = /^[a-z][a-z0-9_-]{0,79}$/;
const errorCodes = [
  'VALIDATION_ERROR',
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'CSRF_INVALID',
  'ORIGIN_FORBIDDEN',
  'NOT_FOUND',
  'EMAIL_IN_USE',
  'LAST_ADMIN_REQUIRED',
  'SELF_PRIVILEGE_CHANGE_FORBIDDEN',
  'GRANT_CEILING_EXCEEDED',
  'ROLE_IN_USE',
  'VERSION_CONFLICT',
  'INVALID_STATE_TRANSITION',
  'ALREADY_AUTHENTICATED',
  'RATE_LIMITED',
  'UNSUPPORTED_MEDIA_TYPE',
  'AUDIT_UNAVAILABLE',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
  'CURRENT_PASSWORD_INVALID',
  'IDENTITY_CONFLICT',
  'SLUG_CONFLICT',
  'CATEGORY_CYCLE',
  'CATEGORY_INACTIVE_PARENT',
  'ATTRIBUTE_NOT_APPLICABLE',
  'PUBLICATION_NOT_READY',
  'REFERENCE_IN_USE',
  'FILE_NOT_ACCESSIBLE',
  'ENCODING_REQUIRED',
  'INVALID_ENCODING',
  'FILE_REJECTED',
  'FILE_TOO_LARGE',
  'IMPORT_LIMIT_EXCEEDED',
  'IDEMPOTENCY_KEY_REUSED',
  'IMPORT_ROW_CONFLICT',
  'INGESTION_UNAVAILABLE',
] as const;

@ApiSchema({ name: 'CatalogError' })
export class CatalogErrorDto {
  @ApiProperty({ type: 'string', enum: [...errorCodes] }) code!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 240 })
  message!: string;
  @ApiProperty({ type: 'string', format: 'uuid' }) requestId!: string;
  @ApiPropertyOptional({
    type: 'array',
    maxItems: 100,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['field', 'code'],
      properties: {
        field: { type: 'string', minLength: 1, maxLength: 100 },
        code: { type: 'string', minLength: 1, maxLength: 64 },
      },
    },
  })
  fields?: { field: string; code: string }[];
}

@ApiSchema({ name: 'Meta' })
export class CatalogMetaDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) requestId!: string;
}

@ApiSchema({ name: 'CatalogBrand' })
export class CatalogBrandDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', pattern: slugPattern.source, maxLength: 120 })
  slug!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 160 }) name!: string;
  @ApiProperty({ type: 'string', enum: ['ACTIVE', 'ARCHIVED'] }) state!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
}

@ApiSchema({ name: 'CatalogCategory' })
export class CatalogCategoryDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  parentId!: string | null;
  @ApiProperty({ type: 'string', pattern: slugPattern.source, maxLength: 120 })
  slug!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 160 }) name!: string;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 2000 })
  description!: string | null;
  @ApiProperty({ type: 'string', enum: ['ACTIVE', 'ARCHIVED'] }) state!: string;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  })
  sortOrder!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
}

@ApiSchema({ name: 'CatalogEnumOption' })
export class CatalogEnumOptionDto {
  @ApiProperty({ type: 'string', pattern: optionCodePattern.source })
  code!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 160 })
  label!: string;
}

@ApiSchema({ name: 'CatalogAttributeDefinition' })
export class CatalogAttributeDefinitionDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'string', format: 'uuid' }) categoryId!: string;
  @ApiProperty({
    type: 'string',
    pattern: attributeCodePattern.source,
    maxLength: 80,
  })
  code!: string;
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 160 }) label!: string;
  @ApiProperty({
    type: 'string',
    enum: ['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'],
  })
  valueType!: string;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 32 })
  unitCode!: string | null;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 48 })
  unitLabel!: string | null;
  @ApiProperty({
    type: 'array',
    nullable: true,
    maxItems: 200,
    items: { type: 'object', additionalProperties: false },
  })
  enumOptions!: CatalogEnumOptionDto[] | null;
  @ApiProperty({ type: 'boolean' }) filterable!: boolean;
  @ApiProperty({ type: 'boolean' }) searchable!: boolean;
  @ApiProperty({ type: 'boolean' }) comparable!: boolean;
  @ApiProperty({ type: 'string', enum: ['ACTIVE', 'ARCHIVED'] }) state!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
}

@ApiSchema({ name: 'CatalogReferencePageMeta' })
export class CatalogReferencePageMetaDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) requestId!: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 }) limit!: number;
  @ApiProperty({ type: 'string', nullable: true, maxLength: 256 })
  nextCursor!: string | null;
}

function listResponse<T>(items: new () => T) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    required: ['data', 'meta'],
    properties: {
      data: {
        type: 'array',
        items: { $ref: `#/components/schemas/${items.name}` },
      },
      meta: { $ref: '#/components/schemas/CatalogReferencePageMeta' },
    },
  };
}

@ApiSchema({ name: 'CatalogBrandListResponse' })
export class CatalogBrandListResponseDto {
  @ApiProperty(listResponse(CatalogBrandDto).properties.data as never)
  data!: CatalogBrandDto[];
  @ApiProperty({ type: () => CatalogReferencePageMetaDto })
  meta!: CatalogReferencePageMetaDto;
}

@ApiSchema({ name: 'CatalogCategoryListResponse' })
export class CatalogCategoryListResponseDto {
  @ApiProperty(listResponse(CatalogCategoryDto).properties.data as never)
  data!: CatalogCategoryDto[];
  @ApiProperty({ type: () => CatalogReferencePageMetaDto })
  meta!: CatalogReferencePageMetaDto;
}

@ApiSchema({ name: 'CatalogAttributeListResponse' })
export class CatalogAttributeListResponseDto {
  @ApiProperty(
    listResponse(CatalogAttributeDefinitionDto).properties.data as never,
  )
  data!: CatalogAttributeDefinitionDto[];
  @ApiProperty({ type: () => CatalogReferencePageMetaDto })
  meta!: CatalogReferencePageMetaDto;
}

@ApiSchema({ name: 'CatalogBrandResponse' })
export class CatalogBrandResponseDto {
  @ApiProperty({ type: () => CatalogBrandDto }) data!: CatalogBrandDto;
  @ApiProperty({ type: () => CatalogMetaDto }) meta!: CatalogMetaDto;
}

@ApiSchema({ name: 'CatalogCategoryResponse' })
export class CatalogCategoryResponseDto {
  @ApiProperty({ type: () => CatalogCategoryDto }) data!: CatalogCategoryDto;
  @ApiProperty({ type: () => CatalogMetaDto }) meta!: CatalogMetaDto;
}

@ApiSchema({ name: 'CatalogAttributeResponse' })
export class CatalogAttributeResponseDto {
  @ApiProperty({ type: () => CatalogAttributeDefinitionDto })
  data!: CatalogAttributeDefinitionDto;
  @ApiProperty({ type: () => CatalogMetaDto }) meta!: CatalogMetaDto;
}

export class VersionCommandDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}

export class CreateCatalogBrandDto {
  @ApiProperty({ type: 'string', pattern: slugPattern.source, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  @Matches(slugPattern)
  slug!: string;

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 160 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;
}

export class PatchCatalogBrandDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 160 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;
}

export class CreateCatalogCategoryDto {
  @ApiPropertyOptional({ type: 'string', format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @ApiProperty({ type: 'string', pattern: slugPattern.source, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  @Matches(slugPattern)
  slug!: string;

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 160 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder?: number;
}

export class PatchCatalogCategoryDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: 'string', format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 160 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, maximum: 2147483647 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder?: number;
}

export class CreateCatalogEnumOptionDto {
  @ApiProperty({
    type: 'string',
    pattern: optionCodePattern.source,
    maxLength: 80,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  @Matches(optionCodePattern)
  code!: string;

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 160 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label!: string;
}

export class CreateCatalogAttributeDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  categoryId!: string;

  @ApiProperty({
    type: 'string',
    pattern: attributeCodePattern.source,
    maxLength: 80,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  @Matches(attributeCodePattern)
  code!: string;

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 160 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label!: string;

  @ApiProperty({
    type: 'string',
    enum: ['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'],
  })
  @IsEnum(['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'])
  valueType!: 'TEXT' | 'DECIMAL' | 'INTEGER' | 'BOOLEAN' | 'ENUM';

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  unitCode?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 48 })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  unitLabel?: string | null;

  @ApiPropertyOptional({
    type: 'array',
    nullable: true,
    minItems: 1,
    maxItems: 200,
    items: { type: 'object', additionalProperties: false },
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique((option: CreateCatalogEnumOptionDto) => option.code)
  @ValidateNested({ each: true })
  @Type(() => CreateCatalogEnumOptionDto)
  enumOptions?: CreateCatalogEnumOptionDto[] | null;

  @ApiProperty({ type: 'boolean' })
  @IsBoolean()
  filterable!: boolean;

  @ApiProperty({ type: 'boolean' })
  @IsBoolean()
  searchable!: boolean;

  @ApiProperty({ type: 'boolean' })
  @IsBoolean()
  comparable!: boolean;
}

export class PatchCatalogAttributeDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 160 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label?: string;

  @ApiPropertyOptional({ type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  filterable?: boolean;

  @ApiPropertyOptional({ type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  searchable?: boolean;

  @ApiPropertyOptional({ type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  comparable?: boolean;
}

export class CatalogAttributeInputDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  attributeDefinitionId!: string;

  @ApiProperty({
    type: 'string',
    enum: ['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'],
  })
  @IsEnum(['TEXT', 'DECIMAL', 'INTEGER', 'BOOLEAN', 'ENUM'])
  valueType!: 'TEXT' | 'DECIMAL' | 'INTEGER' | 'BOOLEAN' | 'ENUM';

  // The value is deliberately validated as a discriminated wire value by the
  // service together with the persisted AttributeDefinition.
  @ApiProperty({})
  @IsDefined()
  value!: unknown;
}

export class CreateCatalogProductDto {
  @ApiProperty({ type: 'string', pattern: slugPattern.source, maxLength: 160 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(160)
  @Matches(slugPattern)
  slug!: string;

  @ApiPropertyOptional({ type: 'string', format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  brandId?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturerName?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  originalPartNumber?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  modification?: string | null;

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  categoryId!: string;

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 240 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  displayName!: string;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string | null;

  @ApiPropertyOptional({
    type: 'array',
    maxItems: 300,
    items: { type: 'object' },
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => CatalogAttributeInputDto)
  attributes?: CatalogAttributeInputDto[];
}

export class PatchCatalogProductDraftDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  baseRevisionId!: string;

  @ApiPropertyOptional({ type: 'string', format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  brandId?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturerName?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  originalPartNumber?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  modification?: string | null;

  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 240 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  displayName?: string;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string | null;

  @ApiPropertyOptional({
    type: 'array',
    maxItems: 300,
    items: { type: 'object' },
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => CatalogAttributeInputDto)
  attributes?: CatalogAttributeInputDto[];
}

export class SubmitCatalogProductDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}

export class CatalogProductReviewDecisionDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  revisionId!: string;

  @ApiProperty({
    type: 'string',
    enum: ['PUBLISH', 'RETURN_FOR_CHANGES', 'REJECT'],
  })
  @IsEnum(['PUBLISH', 'RETURN_FOR_CHANGES', 'REJECT'])
  decision!: 'PUBLISH' | 'RETURN_FOR_CHANGES' | 'REJECT';

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 1000 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason?: string;
}

export class CatalogProductRelationInputDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  targetProductId!: string;

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  targetRevisionId!: string;

  @ApiProperty({ type: 'string', enum: ['ACCESSORY', 'COMPATIBLE_EQUIPMENT'] })
  @IsEnum(['ACCESSORY', 'COMPATIBLE_EQUIPMENT'])
  relationType!: 'ACCESSORY' | 'COMPATIBLE_EQUIPMENT';

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2147483647 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder!: number;
}

export class ReplaceCatalogProductRelationsDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;

  @ApiProperty({ type: 'array', maxItems: 100, items: { type: 'object' } })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CatalogProductRelationInputDto)
  relations!: CatalogProductRelationInputDto[];
}

export class CatalogProductMediaInputDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  fileVersionId!: string;

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 240 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  altText!: string;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption!: string | null;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2147483647 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder!: number;

  @ApiProperty({ type: 'boolean' })
  @IsBoolean()
  isPrimary!: boolean;
}

export class ReplaceCatalogProductMediaDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;

  @ApiProperty({ type: 'array', maxItems: 100, items: { type: 'object' } })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CatalogProductMediaInputDto)
  items!: CatalogProductMediaInputDto[];
}

export class CatalogProductDocumentInputDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  fileVersionId!: string;

  @ApiProperty({
    type: 'string',
    enum: ['DATASHEET', 'MANUAL', 'CERTIFICATE', 'SCHEME', 'OTHER'],
  })
  @IsEnum(['DATASHEET', 'MANUAL', 'CERTIFICATE', 'SCHEME', 'OTHER'])
  documentKind!: 'DATASHEET' | 'MANUAL' | 'CERTIFICATE' | 'SCHEME' | 'OTHER';

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 240 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  displayName!: string;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 35 })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  locale!: string | null;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2147483647 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder!: number;
}

export class ReplaceCatalogProductDocumentsDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;

  @ApiProperty({ type: 'array', maxItems: 100, items: { type: 'object' } })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CatalogProductDocumentInputDto)
  items!: CatalogProductDocumentInputDto[];
}

export const CATALOG_OPENAPI_MODELS = [
  CatalogErrorDto,
  CatalogMetaDto,
  CatalogBrandDto,
  CatalogCategoryDto,
  CatalogEnumOptionDto,
  CatalogAttributeDefinitionDto,
  CatalogReferencePageMetaDto,
  CatalogBrandListResponseDto,
  CatalogCategoryListResponseDto,
  CatalogAttributeListResponseDto,
  CatalogBrandResponseDto,
  CatalogCategoryResponseDto,
  CatalogAttributeResponseDto,
  VersionCommandDto,
  CreateCatalogBrandDto,
  PatchCatalogBrandDto,
  CreateCatalogCategoryDto,
  PatchCatalogCategoryDto,
  CreateCatalogAttributeDto,
  PatchCatalogAttributeDto,
];
