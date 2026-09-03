import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BriefingYesterdayDto {
  @ApiProperty({ description: 'Patient messages that were triaged' })
  newMessages!: number;

  @ApiProperty({ description: 'Of those, the ones triaged urgent or higher' })
  urgentMessages!: number;

  @ApiProperty()
  emergencies!: number;

  @ApiProperty()
  complications!: number;

  @ApiProperty()
  criticalLabs!: number;
}

export class BriefingTodayDto {
  @ApiProperty()
  appointments!: number;

  @ApiProperty()
  followUps!: number;
}

export class RiskItemDto {
  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty()
  patientName!: string;

  @ApiProperty({
    enum: [
      'emergency-unanswered',
      'message-urgent',
      'complication-overdue',
      'follow-up-missed',
      'report-unreviewed',
    ],
  })
  kind!: string;

  @ApiProperty({ description: "What is waiting; never the patient's own words" })
  detail!: string;

  @ApiProperty()
  waitingMinutes!: number;
}

export class BriefingFactsDto {
  @ApiProperty({ format: 'date-time' })
  generatedAt!: Date;

  @ApiProperty({ type: BriefingYesterdayDto })
  yesterday!: BriefingYesterdayDto;

  @ApiProperty({ type: BriefingTodayDto })
  today!: BriefingTodayDto;

  @ApiProperty({ type: [RiskItemDto], description: 'Emergencies first, then longest waiting' })
  atRisk!: RiskItemDto[];
}

export class BriefingDto {
  @ApiProperty({ type: BriefingFactsDto, description: 'The briefing. Always present' })
  facts!: BriefingFactsDto;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A paragraph over the numbers. Null when the AI layer is off or declined',
  })
  narrative!: string | null;

  @ApiProperty({ description: 'Nothing happened and nothing is waiting' })
  quiet!: boolean;
}
