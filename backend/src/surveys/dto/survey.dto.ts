import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SurveyAnswerType, SurveyStatus } from '@prisma/client';
import { IsObject } from 'class-validator';

export class SubmitSurveyDto {
  @ApiProperty({
    description:
      'Answers keyed by question id. A value that does not fit its question is refused rather than coerced — a blank must not become a nought',
    example: { pain: 4, swelling: 2, sleep: 7, satisfaction: 9, comment: 'İyiyim' },
  })
  @IsObject()
  answers!: Record<string, unknown>;
}

export class SurveyQuestionDto {
  @ApiProperty() id!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ enum: SurveyAnswerType }) type!: SurveyAnswerType;
  @ApiPropertyOptional({
    enum: ['higher-is-worse', 'higher-is-better'],
    description: 'Which way is bad. Stated per question so no alert can be inverted',
  })
  direction?: string;
  @ApiPropertyOptional({ description: 'A clinician sees this answer whatever the trend' })
  alarmAt?: number;
  @ApiPropertyOptional() required?: boolean;
}

export class PendingSurveyDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Days after the operation this one is about' })
  milestoneDays!: number;
  @ApiProperty() scheduledFor!: Date;
  @ApiProperty({ nullable: true, description: 'After this it can no longer be answered' })
  expiresAt!: Date | null;
  @ApiProperty({ type: [SurveyQuestionDto] }) questions!: SurveyQuestionDto[];
}

export class SurveyFindingDto {
  @ApiProperty({ enum: ['worsened', 'severe'] }) kind!: string;
  @ApiProperty() questionId!: string;
  @ApiProperty() questionText!: string;
  @ApiProperty() value!: number;
  @ApiPropertyOptional({ description: 'The same question last time' }) previous?: number;
}

export class SubmitResultDto {
  @ApiProperty({
    type: [SurveyFindingDto],
    description: 'What the clinic was told about. The patient is never shown a clinical reading',
  })
  findings!: SurveyFindingDto[];
  @ApiProperty({ description: 'Whether a review invitation was sent' }) invited!: boolean;
}

export class SurveyPointDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty() milestoneDays!: number;
  @ApiProperty() submittedAt!: Date;
  @ApiProperty({ description: 'Question id to answer, for the chart' })
  values!: Record<string, number>;
  @ApiProperty() answeredCount!: number;
  @ApiProperty() questionCount!: number;
  @ApiProperty({
    description: 'Too little answered to sit beside a full response. Still shown, marked',
  })
  partial!: boolean;
}

export class PatientSurveyViewDto {
  @ApiProperty() template!: unknown;
  @ApiProperty({ type: [SurveyPointDto] }) series!: SurveyPointDto[];
  @ApiProperty({ type: [SurveyFindingDto], description: 'From the most recent response only' })
  latestFindings!: SurveyFindingDto[];
  @ApiProperty({ description: 'False while there is one response: a line needs two points' })
  hasTrend!: boolean;
  @ApiProperty({ description: 'Asked and not yet answered' }) pending!: unknown[];
}

export class SurveyAssignmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: SurveyStatus }) status!: SurveyStatus;
  @ApiProperty() milestoneDays!: number;
  @ApiProperty() scheduledFor!: Date;
}
