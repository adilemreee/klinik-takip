import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, AppointmentType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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
