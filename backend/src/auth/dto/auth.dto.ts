import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class LoginDto {
  @ApiProperty({ description: 'E-mail address or phone number' })
  @IsString()
  @MaxLength(200)
  identifier!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({ description: 'Six-digit TOTP code, when 2FA is enabled' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  totpCode?: string;

  @ApiPropertyOptional({ description: 'Shown in the session list, e.g. "iPhone 15"' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;

  @ApiPropertyOptional({ enum: ['ios', 'android', 'web'] })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  platform?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  refreshToken!: string;
}

export class TotpCodeDto {
  @ApiProperty()
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  newPassword!: string;
}

export class CreateInvitationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role!: Role;

  @ApiPropertyOptional({ description: 'Links the new account to an existing patient file' })
  @IsOptional()
  @IsString()
  patientId?: string;
}

export class AcceptInvitationDto {
  @ApiProperty({ description: 'The e-mail or phone the invitation was sent to' })
  @IsString()
  @MaxLength(200)
  identifier!: string;

  @ApiProperty()
  @IsString()
  @Length(6, 6)
  code!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;
}
