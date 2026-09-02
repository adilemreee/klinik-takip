import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MilestoneStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { templateNames } from '../templates';

export class GenerateScheduleDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  surgeryDate!: Date;

  @ApiPropertyOptional({ enum: templateNames(), default: 'default' })
  @IsOptional()
  @IsIn(templateNames())
  template?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  surgeryId?: string;

  @ApiPropertyOptional({ default: 'Europe/Istanbul', description: "The clinic's timezone" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class SetMilestoneStatusDto {
  @ApiProperty({
    enum: [MilestoneStatus.COMPLETED, MilestoneStatus.SKIPPED, MilestoneStatus.MISSED],
  })
  @IsEnum(MilestoneStatus)
  status!: MilestoneStatus;
}

export class MilestoneDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'D1, W1, M1, M2, M3, M6, Y1 — matches the photo phase labels' })
  label!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  dueAt!: Date;

  @ApiProperty({ enum: MilestoneStatus })
  status!: MilestoneStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  notifiedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: Date | null;
}

export class FollowUpScheduleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  surgeryDate!: Date;

  @ApiProperty({ nullable: true })
  template!: string | null;

  @ApiProperty({ type: [MilestoneDto], description: 'Soonest first' })
  milestones!: MilestoneDto[];
}
