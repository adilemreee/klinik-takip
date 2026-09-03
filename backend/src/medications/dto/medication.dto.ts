import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicationLogStatus, MedicationSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PrescribeDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @Length(2, 200)
  drugName!: string;

  @ApiProperty({ maxLength: 100, example: '500 mg' })
  @IsString()
  @Length(1, 100)
  dose!: string;

  @ApiPropertyOptional({ maxLength: 100, example: 'tablet' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  form?: string;

  @ApiProperty({
    example: 'FREQ=DAILY;COUNT=16;BYHOUR=9,21',
    description:
      'RFC 5545 RRULE. Supported: FREQ=DAILY|WEEKLY|HOURLY, INTERVAL, COUNT, UNTIL, BYHOUR, BYMINUTE, BYDAY. Anything else is refused rather than guessed at',
  })
  @IsString()
  @Length(5, 300)
  frequencyRule!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  startDate!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  @ApiPropertyOptional({ example: '09:00', description: "Wall-clock time of the first dose" })
  @IsOptional()
  @Matches(/^\d{1,2}:\d{2}$/, { message: 'startTime must look like 09:00' })
  startTime?: string;

  @ApiPropertyOptional({
    example: 'Europe/Berlin',
    description: "The patient's timezone — a dose is a wall-clock event",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;
}

export class CheckInDto {
  @ApiProperty({ enum: ['taken', 'skipped', 'snooze'] })
  @IsIn(['taken', 'skipped', 'snooze'])
  action!: 'taken' | 'skipped' | 'snooze';

  @ApiPropertyOptional({ minimum: 5, maximum: 720, default: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(720)
  snoozeMinutes?: number;
}

export class MedicationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty()
  drugName!: string;

  @ApiProperty()
  dose!: string;

  @ApiPropertyOptional({ nullable: true })
  form!: string | null;

  @ApiProperty()
  frequencyRule!: string;

  @ApiProperty({ description: "The patient's timezone the doses were generated in" })
  timezone!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startDate!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  endDate!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  instructions!: string | null;

  @ApiProperty({ enum: MedicationSource })
  source!: MedicationSource;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Patient-reported medication is inert until this is set',
  })
  approvedAt!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  stoppedAt!: Date | null;
}

export class AdherenceDto {
  @ApiPropertyOptional({
    nullable: true,
    description: '0–1 over the doses that have come due. Null before any have',
  })
  score!: number | null;

  @ApiProperty()
  taken!: number;

  @ApiProperty()
  missed!: number;

  @ApiProperty({ description: 'Doses that have come due' })
  due!: number;

  @ApiProperty({ description: 'Still ahead: not counted, not missed' })
  upcoming!: number;

  @ApiProperty({ description: 'Consecutive days with every due dose taken' })
  streak!: number;
}

export class MedicationLogDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  medicationId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  takenAt!: Date | null;

  @ApiProperty({ enum: MedicationLogStatus })
  status!: MedicationLogStatus;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  snoozedUntil!: Date | null;
}

export class MedicationViewDto {
  @ApiProperty({ type: MedicationDto })
  medication!: MedicationDto;

  @ApiProperty({ description: 'The rule in a sentence, so a clinician can check it' })
  schedule!: string;

  @ApiProperty({ type: AdherenceDto })
  adherence!: AdherenceDto;

  @ApiProperty({ type: [String] })
  badges!: string[];

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  nextDose!: Date | null;
}

export class MyMedicationsDto {
  @ApiProperty({ type: [MedicationViewDto] })
  medications!: MedicationViewDto[];

  @ApiProperty({ type: [MedicationLogDto], description: "Today's doses, in order" })
  today!: MedicationLogDto[];

  @ApiProperty({ type: AdherenceDto })
  overall!: AdherenceDto;

  @ApiProperty({
    type: [String],
    description: 'Withheld while a course is going badly — the tone rule from M9',
  })
  badges!: string[];
}

export class PrescribedDrugDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'As it was written' })
  drugName!: string;
}

export class InteractionWarningDto {
  @ApiProperty({ enum: ['CONTRAINDICATED', 'MAJOR', 'MODERATE', 'MINOR'] })
  severity!: string;

  @ApiProperty({ description: 'What a clinician needs to know, in one sentence' })
  note!: string;

  @ApiProperty({ type: [String], description: 'Ingredient codes' })
  ingredients!: string[];

  @ApiProperty({ type: [PrescribedDrugDto], description: 'The two medications, as written' })
  between!: PrescribedDrugDto[];
}

export class InteractionCheckDto {
  @ApiProperty({ type: [InteractionWarningDto], description: 'Most serious first' })
  warnings!: InteractionWarningDto[];

  @ApiProperty({
    type: [PrescribedDrugDto],
    description:
      'Drugs the reference did not recognise. Read this before reading an empty warning list as safety',
  })
  unrecognised!: PrescribedDrugDto[];

  @ApiProperty({ description: 'How many pairs were compared. Zero means nothing was checked' })
  comparedPairs!: number;
}
