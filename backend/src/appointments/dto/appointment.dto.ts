import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, AppointmentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class BookAppointmentDto {
  @ApiProperty({ enum: AppointmentType })
  @IsEnum(AppointmentType)
  type!: AppointmentType;

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  scheduledAt!: Date;

  @ApiPropertyOptional({ format: 'uuid', description: 'The staff member being booked' })
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional({ minimum: 5, maximum: 480, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RescheduleDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  scheduledAt!: Date;
}

export class CancelDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CalendarQueryDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  to!: Date;
}

export class AppointmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  staffId!: string | null;

  @ApiProperty({ enum: AppointmentType })
  type!: AppointmentType;

  @ApiProperty({ enum: AppointmentStatus })
  status!: AppointmentStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt!: Date;

  @ApiProperty()
  durationMinutes!: number;

  @ApiProperty({ nullable: true })
  location!: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;

  @ApiProperty({ nullable: true })
  cancelledReason!: string | null;

  @ApiProperty({
    type: [String],
    description: 'Reminders already sent — P7D, P1D, PT2H',
  })
  remindersSent!: string[];
}


/** Who an appointment on a cross-patient calendar belongs to. */
export class CalendarPatientDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '2026-K7RMPX' })
  mrn!: string;

  @ApiProperty({ example: 'Ayşe Yılmaz' })
  fullName!: string;
}

export class CalendarEntryDto {
  @ApiProperty({ type: AppointmentDto })
  appointment!: AppointmentDto;

  @ApiProperty({ type: CalendarPatientDto })
  patient!: CalendarPatientDto;
}

/**
 * A weekly window a clinician is bookable in (spec M10).
 *
 * Local wall-clock times in a named zone rather than instants: "Tuesdays,
 * 09:00 to 17:00" is what a clinic decides, and it stays true across a
 * daylight-saving change that would move any instant computed from it.
 */
export class AvailabilityWindowDto {
  @ApiProperty() id!: string;
  @ApiProperty() staffId!: string;
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday .. 6 = Saturday' })
  dayOfWeek!: number;
  @ApiProperty({ example: '09:00' }) startTime!: string;
  @ApiProperty({ example: '17:00' }) endTime!: string;
  @ApiProperty({ example: 'Europe/Istanbul' }) timezone!: string;
  @ApiProperty() isActive!: boolean;
}

export class SetAvailabilityWindowDto {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  /**
   * `HH:MM`, validated by shape here and by ordering in the service.
   *
   * A pattern rather than a Date: the window is a wall-clock rule, and parsing
   * it into an instant would pin it to one day and one offset.
   */
  @ApiProperty({ example: '09:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM' })
  startTime!: string;

  @ApiProperty({ example: '17:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:MM' })
  endTime!: string;

  @ApiPropertyOptional({ example: 'Europe/Istanbul' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ description: 'Off without deleting, for a week away' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
