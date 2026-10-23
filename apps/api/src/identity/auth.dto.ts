import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

@ApiSchema({ name: 'Login' })
export class LoginDto {
  @ApiProperty({
    type: 'string',
    format: 'email',
    minLength: 1,
    maxLength: 254,
    pattern: emailPattern.source,
    description:
      'ASCII only; trim before canonicalization; lowercase entire string for DB uniqueness; no alias/dot rewriting.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  @Matches(emailPattern)
  email!: string;

  @ApiProperty({
    type: 'string',
    format: 'password',
    minLength: 15,
    maxLength: 128,
    writeOnly: true,
    description:
      'No normalization/trim/truncation; <=512 UTF-8 bytes. Never echoed/logged.',
  })
  @IsString()
  @MinLength(15)
  @MaxLength(128)
  password!: string;
}

@ApiSchema({ name: 'ChangePassword' })
export class ChangePasswordDto {
  @ApiProperty({
    type: 'string',
    format: 'password',
    minLength: 1,
    maxLength: 128,
    writeOnly: true,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

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
  newPassword!: string;
}
