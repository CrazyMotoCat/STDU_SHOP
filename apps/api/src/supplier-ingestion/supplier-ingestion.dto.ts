import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class IngestionSourceInput {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('4')
  supplierId!: string;
  @ApiProperty({ type: String, enum: ['fixture-json/1'] })
  @IsIn(['fixture-json/1'])
  adapterVersion!: string;
  @ApiProperty({ type: String, enum: ['offers-v1', 'mixed-v1'] })
  @IsIn(['offers-v1', 'mixed-v1'])
  fixtureKey!: string;
  @ApiProperty({ type: Number, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  maxRows!: number;
  @ApiProperty({ type: Number, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  maxAttempts!: number;
  @ApiProperty({ type: Number, minimum: 100, maximum: 10000 })
  @IsInt()
  @Min(100)
  @Max(10000)
  timeoutMs!: number;
}
export class IngestionSourcePatch {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
  @ApiProperty({ type: String, enum: ['ENABLED', 'DISABLED'] })
  @IsIn(['ENABLED', 'DISABLED'])
  state!: string;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(100)
  maxRows?: number;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 5 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(5)
  maxAttempts?: number;
  @ApiPropertyOptional({ type: Number, minimum: 100, maximum: 10000 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(100)
  @Max(10000)
  timeoutMs?: number;
}
export class IngestionRunInput {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') sourceId!: string;
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  expectedSourceVersion!: number;
}
export class IngestionDecisionInput {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
  @ApiProperty({ type: String, enum: ['ACCEPT', 'REJECT'] })
  @IsIn(['ACCEPT', 'REJECT'])
  decision!: string;
  @ApiProperty({ type: String, maxLength: 500, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/u)
  reason!: string;
}
export class IngestionPage {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  cursor?: string;
}
export class IngestionRowsPage {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 100, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  afterRow?: number;
}
