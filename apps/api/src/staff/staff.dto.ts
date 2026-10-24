import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { REGISTERED_PERMISSION_CODES } from '../permissions/policy.js';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const rolePattern = /^[a-z][a-z0-9.-]{1,63}$/;
@ApiSchema({ name: 'CreateStaffUser' })
export class CreateStaffUserDto {
  @ApiProperty({
    type: 'string',
    format: 'email',
    minLength: 1,
    maxLength: 254,
    pattern: emailPattern.source,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  @Matches(emailPattern)
  email!: string;

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({
    type: 'string',
    format: 'password',
    minLength: 15,
    maxLength: 128,
    writeOnly: true,
  })
  @IsString()
  @MinLength(15)
  @MaxLength(128)
  initialPassword!: string;
}

@ApiSchema({ name: 'UserState' })
export class UserStateDto {
  @ApiProperty({ type: 'string', enum: ['ACTIVE', 'BLOCKED'] })
  @IsEnum(['ACTIVE', 'BLOCKED'])
  state!: 'ACTIVE' | 'BLOCKED';

  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}

@ApiSchema({ name: 'Versioned' })
export class VersionedDto {
  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}

@ApiSchema({ name: 'CreateRole' })
export class CreateRoleDto {
  @ApiProperty({
    type: 'string',
    minLength: 2,
    maxLength: 64,
    pattern: rolePattern.source,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(rolePattern)
  code!: string;

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

@ApiSchema({ name: 'PatchRole' })
export class PatchRoleDto {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 120 })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: 'string', enum: ['ARCHIVED'] })
  @IsOptional()
  @IsEnum(['ARCHIVED'])
  state?: 'ARCHIVED';

  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}

@ApiSchema({ name: 'ReplaceRolePermissions' })
export class ReplaceRolePermissionsDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string', enum: [...REGISTERED_PERMISSION_CODES] },
    maxItems: 100,
    uniqueItems: true,
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsEnum(REGISTERED_PERMISSION_CODES, { each: true })
  permissions!: string[];

  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}

@ApiSchema({ name: 'CreateSeller' })
export class CreateSellerDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 160 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName!: string;

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 500,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  legalName?: string | null;

  @ApiProperty({ type: 'string', enum: ['OOO', 'IP'] })
  @IsEnum(['OOO', 'IP'])
  kind!: 'OOO' | 'IP';

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 12,
    pattern: '^(?:[0-9]{10}|[0-9]{12})$',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(12)
  @Matches(/^(?:[0-9]{10}|[0-9]{12})$/)
  inn?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    minLength: 9,
    maxLength: 9,
    pattern: '^[0-9]{9}$',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(9)
  @MaxLength(9)
  @Matches(/^[0-9]{9}$/)
  kpp?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 15,
    pattern: '^(?:[0-9]{13}|[0-9]{15})$',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Matches(/^(?:[0-9]{13}|[0-9]{15})$/)
  ogrn?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 1000,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  legalAddress?: string | null;
}

@ApiSchema({ name: 'PatchSeller' })
export class PatchSellerDto {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 160 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName?: string;

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 500,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  legalName?: string | null;

  @ApiPropertyOptional({ type: 'string', enum: ['OOO', 'IP'] })
  @IsOptional()
  @IsEnum(['OOO', 'IP'])
  kind?: 'OOO' | 'IP';

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 12,
    pattern: '^(?:[0-9]{10}|[0-9]{12})$',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(12)
  @Matches(/^(?:[0-9]{10}|[0-9]{12})$/)
  inn?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    minLength: 9,
    maxLength: 9,
    pattern: '^[0-9]{9}$',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(9)
  @MaxLength(9)
  @Matches(/^[0-9]{9}$/)
  kpp?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 15,
    pattern: '^(?:[0-9]{13}|[0-9]{15})$',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Matches(/^(?:[0-9]{13}|[0-9]{15})$/)
  ogrn?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 1000,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  legalAddress?: string | null;

  @ApiPropertyOptional({
    type: 'string',
    enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'],
  })
  @IsOptional()
  @IsEnum(['DRAFT', 'ACTIVE', 'ARCHIVED'])
  state?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

  @ApiProperty({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: 2147483647,
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}
