import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  ArrayMaxSize,
  ArrayUnique,
  IsInt,
  Min,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IngestionApplyInput } from './supplier-ingestion.dto.js';

export class IngestionSubmitIdentityInput extends IngestionApplyInput {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('4')
  evidenceId!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/u)
  reason!: string;
}

export class IngestionIdentityConfirmationInput {
  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    maxItems: 20,
  })
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  acknowledgedDuplicateIds!: string[];

  @ApiProperty({ type: String, pattern: '^[a-f0-9]{64}$' })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  digest!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/u)
  reason!: string;
}

export class IngestionIdentityExecutionInput {
  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    maxItems: 20,
  })
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  acknowledgedDuplicateIds!: string[];

  @ApiProperty({ type: String, pattern: '^[a-f0-9]{64}$' })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  digest!: string;

  @ApiProperty({ type: Boolean, enum: [true] })
  @Equals(true)
  confirmed!: true;
}

export class IngestionSubmitCreateIdentityInput {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('4')
  decisionId!: string;

  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRowVersion!: number;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('4')
  evidenceId!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/u)
  reason!: string;
}
