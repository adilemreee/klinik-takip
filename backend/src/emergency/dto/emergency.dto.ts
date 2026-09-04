import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmergencyStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Notice what is *not* validated here: latitude and longitude have no range
 * constraint.
 *
 * That is on purpose. A `@Min(-90)` would turn a phone reporting a bad fix into
 * a 400, and a 400 on this endpoint means the patient pressed the button and
 * nothing happened. The range check lives in `sanitiseLocation`, where a bad
 * value costs the pin rather than the alarm.
 */
export class TriggerEmergencyDto {
  @ApiPropertyOptional({ description: 'WGS84 latitude; dropped if implausible, never refused' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ description: 'WGS84 longitude; dropped if implausible, never refused' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ maxLength: 1000, description: 'What is happening, in the patient\'s words' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ResolveEmergencyDto {
  @ApiProperty({ maxLength: 2000, description: 'How it was resolved; required' })
  @IsString()
  @MaxLength(2000)
  resolution!: string;

  @ApiPropertyOptional({ default: false, description: 'Closes it as a false alarm rather than a real one' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  falseAlarm?: boolean;
}

export class EmergencyQueueQueryDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeClosed?: boolean;
}

export class EmergencyNumberDto {
  @ApiProperty({ example: '112' })
  number!: string;

  @ApiProperty({ example: 'DE', description: 'Country the number was chosen for' })
  countryCode!: string;

  @ApiProperty({ enum: ['country', 'international'] })
  source!: 'country' | 'international';

  @ApiProperty({
    example: '112',
    nullable: true,
    description: 'A second number to try; null when the first one already is 112',
  })
  alsoTry!: string | null;
}

export class GuidanceStepDto {
  @ApiProperty({ example: 'stay-put' })
  id!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty({ description: 'The one line that points away from the clinic' })
  critical!: boolean;
}

export class EmergencyGuidanceDto {
  @ApiProperty({ example: 'tr' })
  language!: string;

  @ApiProperty({ type: EmergencyNumberDto })
  emergencyNumber!: EmergencyNumberDto;

  @ApiProperty({ type: [GuidanceStepDto] })
  steps!: GuidanceStepDto[];
}

export class EmergencyEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty({ enum: EmergencyStatus })
  status!: EmergencyStatus;

  @ApiProperty({ format: 'date-time' })
  triggeredAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  latitude!: string | null;

  @ApiPropertyOptional({ nullable: true })
  longitude!: string | null;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;

  @ApiProperty({ description: 'Highest rung of the ladder taken: 0 now, 1 at 2 min, 2 at 5 min' })
  escalationLevel!: number;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  acknowledgedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  resolution!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  resolvedAt!: Date | null;
}

export class PatientEmergencyViewDto {
  @ApiProperty({ type: EmergencyEventDto })
  event!: EmergencyEventDto;

  @ApiProperty({ type: EmergencyGuidanceDto })
  guidance!: EmergencyGuidanceDto;

  @ApiProperty({ description: 'The button was pressed again on a call already open' })
  alreadyOpen!: boolean;
}

export class LastSurgeryDto {
  @ApiProperty()
  procedureName!: string;

  @ApiProperty({ format: 'date-time' })
  performedAt!: Date;

  @ApiProperty()
  daysAgo!: number;
}

export class EmergencySummaryDto {
  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty()
  mrn!: string;

  @ApiProperty()
  fullName!: string;

  @ApiPropertyOptional({ nullable: true })
  age!: number | null;

  @ApiProperty()
  sex!: string;

  @ApiProperty()
  country!: string;

  @ApiPropertyOptional({ nullable: true })
  city!: string | null;

  @ApiPropertyOptional({ nullable: true })
  phone!: string | null;

  @ApiProperty()
  preferredLanguage!: string;

  @ApiPropertyOptional({ nullable: true })
  bloodType!: string | null;

  @ApiProperty({ type: [String] })
  allergies!: string[];

  @ApiProperty({ type: [String] })
  chronicConditions!: string[];

  @ApiProperty({ type: [String] })
  currentMedications!: string[];

  @ApiPropertyOptional({ type: LastSurgeryDto, nullable: true })
  lastSurgery!: LastSurgeryDto | null;

  @ApiPropertyOptional({ nullable: true })
  assignedDoctor!: string | null;
}

export class StaffEmergencyViewDto {
  @ApiProperty({ type: EmergencyEventDto })
  event!: EmergencyEventDto;

  @ApiProperty({ type: EmergencySummaryDto })
  summary!: EmergencySummaryDto;

  @ApiProperty()
  waitingMinutes!: number;

  @ApiPropertyOptional({ nullable: true })
  responseMinutes!: number | null;

  @ApiProperty({ description: 'The ladder ran out and it is still unanswered' })
  unanswered!: boolean;
}
