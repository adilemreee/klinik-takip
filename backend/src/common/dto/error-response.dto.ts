import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The shape every failure takes, so a client can handle errors in one place
 * rather than per endpoint.
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({
    description:
      'Human-readable text, or a machine-readable code for authentication failures ' +
      '(INVALID_CREDENTIALS, MFA_REQUIRED, ACCOUNT_LOCKED, …).',
    example: 'Missing permission: patients.write',
  })
  message!: string | string[];

  @ApiPropertyOptional({ example: 'Forbidden' })
  error?: string;
}
