import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RiskLevel } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class InterpretLabsDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Limit the panel to one uploaded document; otherwise the recent verified results',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;
}

export class ReviewReportDto {
  @ApiProperty({ description: 'Whether the patient may see the plain-language half' })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  release!: boolean;
}

export class AIReportDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty({ example: 'lab' })
  source!: string;

  @ApiProperty({ description: 'Clinical rendering, for staff' })
  contentMd!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Plain-language rendering. Only returned to the patient once released',
  })
  patientFacingMd!: string | null;

  @ApiPropertyOptional({ enum: RiskLevel, nullable: true })
  riskLevel!: RiskLevel | null;

  @ApiProperty({ description: 'The model that actually answered' })
  model!: string;

  @ApiPropertyOptional({ nullable: true })
  modelVersion!: string | null;

  @ApiProperty({ format: 'date-time' })
  generatedAt!: Date;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  reviewedById!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  reviewedAt!: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  releasedToPatientAt!: Date | null;
}

export class ReportViewDto {
  @ApiProperty({ type: AIReportDto })
  report!: AIReportDto;

  @ApiProperty({
    description: 'The warning that goes under every AI output (spec M5), in the patient\'s language',
  })
  disclaimer!: string;

  @ApiProperty()
  visibleToPatient!: boolean;
}

/**
 * What the patient is given, which is a different document from the staff view:
 * the plain-language rendering only, and no risk label — "CRITICAL" on a
 * patient's screen with no clinician attached to it is a verdict.
 */
export class PatientReportDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'lab' })
  source!: string;

  @ApiProperty({ description: 'The plain-language rendering' })
  contentMd!: string;

  @ApiProperty({ format: 'date-time' })
  generatedAt!: Date;

  @ApiProperty({ format: 'date-time' })
  releasedAt!: Date;

  @ApiProperty({ description: 'The warning that goes under every AI output (spec M5)' })
  disclaimer!: string;
}
