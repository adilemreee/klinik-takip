import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

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

export class AiProviderInfoDto {
  @ApiProperty({ enum: ['anthropic', 'openai', 'gemini', 'deepseek'] }) id!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ type: [String], description: 'Suggested models. Not a closed list' })
  models!: string[];
  @ApiProperty({ description: 'Where the operator reads the current price' })
  pricingUrl!: string;
  @ApiProperty({ description: 'Where the operator gets a key' }) consoleUrl!: string;
  @ApiProperty({
    description:
      'What the clinic has to satisfy itself about before clinical prompts are allowed',
  })
  retentionNote!: string;
}

export class AiSettingsDto {
  @ApiProperty({ nullable: true, enum: ['anthropic', 'openai', 'gemini', 'deepseek'] })
  provider!: string | null;
  @ApiProperty({ nullable: true }) model!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'The last four characters. The key itself is never returned',
  })
  apiKeyLast4!: string | null;
  @ApiProperty() hasApiKey!: boolean;
  @ApiProperty({ nullable: true }) inputPricePerMTok!: string | null;
  @ApiProperty({ nullable: true }) outputPricePerMTok!: string | null;
  @ApiProperty({
    description: 'Per provider. Cleared whenever the provider changes (spec 14.5)',
  })
  zeroRetentionConfirmed!: boolean;
  @ApiProperty({ nullable: true }) zeroRetentionNote!: string | null;
  @ApiProperty({ nullable: true }) zeroRetentionAt!: Date | null;
  @ApiProperty({ nullable: true }) monthlyBudgetUsd!: string | null;
  @ApiProperty({ description: 'Whether the AI layer would run with what is saved' })
  ready!: boolean;
  @ApiProperty({ type: [String], description: 'What is missing, in the order to fix it' })
  missing!: string[];
  @ApiProperty({ nullable: true }) updatedAt!: Date | null;
}

export class UpdateAiSettingsDto {
  @ApiPropertyOptional({ enum: ['anthropic', 'openai', 'gemini', 'deepseek'] })
  @IsOptional()
  @IsIn(['anthropic', 'openai', 'gemini', 'deepseek'])
  provider?: 'anthropic' | 'openai' | 'gemini' | 'deepseek';

  @ApiPropertyOptional({ example: 'claude-sonnet-5' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @ApiPropertyOptional({
    description: 'Write-only. Omit to leave the stored key alone; it is never returned',
  })
  @IsOptional()
  @IsString()
  @Length(8, 400)
  apiKey?: string;

  @ApiPropertyOptional({ example: '3.00', description: 'USD per million input tokens' })
  @IsOptional()
  @Matches(/^\d{1,6}(\.\d{1,6})?$/, { message: 'inputPricePerMTok must be a number' })
  inputPricePerMTok?: string;

  @ApiPropertyOptional({ example: '15.00', description: 'USD per million output tokens' })
  @IsOptional()
  @Matches(/^\d{1,6}(\.\d{1,6})?$/, { message: 'outputPricePerMTok must be a number' })
  outputPricePerMTok?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Null means no ceiling' })
  @IsOptional()
  monthlyBudgetUsd?: string | null;

  @ApiPropertyOptional({
    description:
      'Spec 14.5. Applies to the provider selected here; changing the provider clears it',
  })
  @IsOptional()
  @IsBoolean()
  zeroRetentionConfirmed?: boolean;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Which agreement, signed when and by whom. The flag alone is not a record',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  zeroRetentionNote?: string;
}

export class AiConnectionTestDto {
  @ApiProperty({ description: 'Whether the saved key reached the provider' }) ok!: boolean;
  @ApiProperty({ nullable: true }) model!: string | null;
  @ApiProperty({ nullable: true, description: "The provider's own words, truncated" })
  error!: string | null;
}
