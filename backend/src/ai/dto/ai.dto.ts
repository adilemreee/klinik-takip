import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AIUsageDto {
  @ApiProperty({ description: 'False when no provider is configured' })
  enabled!: boolean;

  @ApiProperty({ example: 'anthropic' })
  provider!: string;

  @ApiProperty({ example: 'claude-sonnet-5' })
  model!: string;

  @ApiProperty({ format: 'date-time', description: "Midnight on the 1st, clinic time" })
  monthStart!: Date;

  @ApiProperty({ description: 'USD spent since the start of the month' })
  spentUsd!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Null when no cap is set' })
  budgetUsd!: number | null;

  @ApiPropertyOptional({ nullable: true, description: '0–1, null when no cap is set' })
  budgetUsedFraction!: number | null;

  @ApiProperty()
  calls!: number;

  @ApiProperty({ description: 'Calls that failed or were refused' })
  failed!: number;

  @ApiProperty()
  tokensIn!: number;

  @ApiProperty()
  tokensOut!: number;
}
