import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplicationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ReportComplicationDto {
  @ApiProperty({ description: 'What is wrong, in the patient\'s own words', maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bodyArea?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Photos already uploaded for this patient',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  // No version constraint: ids here are UUIDv7, and asking for v4 rejects every
  // real one. Everywhere else in the codebase leaves the version unspecified
  // for the same reason.
  @IsUUID(undefined, { each: true })
  photoIds?: string[];
}

export class RespondDto {
  @ApiProperty({ description: 'What the clinician told the patient', maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}

export class QueueQueryDto {
  @ApiPropertyOptional({ description: 'Include reports already resolved', default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeResolved?: boolean;
}

export class ComplicationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty({ enum: ComplicationStatus })
  status!: ComplicationStatus;

  @ApiProperty()
  note!: string;

  @ApiProperty({ nullable: true })
  bodyArea!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  reportedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  acknowledgedAt!: Date | null;

  @ApiProperty({ nullable: true, description: 'What the clinician answered' })
  firstResponse!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: Date | null;

  @ApiProperty({ nullable: true })
  resolution!: string | null;
}

export class ComplicationViewDto {
  @ApiProperty({ type: ComplicationDto })
  complication!: ComplicationDto;

  @ApiProperty({ type: [Object], description: 'Photos attached to the report' })
  photos!: unknown[];

  @ApiProperty({ description: 'Minutes from report to first answer, or to now while waiting' })
  waitingMinutes!: number;

  @ApiProperty({ nullable: true, description: 'Null until someone answered' })
  responseMinutes!: number | null;

  @ApiProperty({ description: 'Still unanswered past the clinic threshold' })
  overdue!: boolean;
}
