import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TokensDto {
  @ApiProperty({ description: 'JWT bearer token; short-lived' })
  accessToken!: string;

  @ApiProperty({ description: 'Single-use. Presenting a consumed token revokes the whole device session.' })
  refreshToken!: string;

  @ApiProperty({ description: 'Access token lifetime in seconds', example: 900 })
  expiresIn!: number;
}

export class LoginResponseDto {
  @ApiProperty({
    enum: ['OK', 'MFA_REQUIRED', 'MFA_SETUP_REQUIRED'],
    description:
      'OK carries tokens. MFA_REQUIRED means resend the request with totpCode. ' +
      'MFA_SETUP_REQUIRED means the account is staff and has no second factor yet; ' +
      'use setupToken against the 2FA endpoints, then sign in again.',
  })
  status!: 'OK' | 'MFA_REQUIRED' | 'MFA_SETUP_REQUIRED';

  @ApiPropertyOptional()
  accessToken?: string;

  @ApiPropertyOptional()
  refreshToken?: string;

  @ApiPropertyOptional({ example: 900 })
  expiresIn?: number;

  @ApiPropertyOptional({
    description: 'Only with MFA_SETUP_REQUIRED. Valid for five minutes and accepted only by /auth/2fa/setup and /auth/2fa/confirm.',
  })
  setupToken?: string;
}

export class SessionDto {
  @ApiProperty({ description: 'Session family id; pass to DELETE /auth/sessions/{familyId}' })
  familyId!: string;

  @ApiProperty({ nullable: true, example: 'iPhone 15' })
  deviceName!: string | null;

  @ApiProperty({ nullable: true, example: 'ios' })
  platform!: string | null;

  @ApiProperty({ nullable: true })
  ipAddress!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  lastSeenAt!: Date;

  @ApiProperty({ description: 'True for the device making this request' })
  current!: boolean;
}

export class TotpSetupDto {
  @ApiProperty({ description: 'Base32 secret, shown once so it can be entered by hand' })
  secret!: string;

  @ApiProperty({ description: 'otpauth:// URI to render as a QR code' })
  uri!: string;
}

export class InvitationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description: 'Returned exactly once, for delivery by SMS or e-mail. Only its hash is stored.',
  })
  code!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;
}

export class AcceptInvitationResponseDto {
  @ApiProperty()
  userId!: string;
}
