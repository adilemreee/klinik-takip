import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { NOTIFICATION_TYPES } from '../templates';

export class RegisterPushTokenDto {
  @ApiProperty({ maxLength: 512 })
  @IsString()
  @MaxLength(512)
  token!: string;

  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform!: string;

  @ApiPropertyOptional({ description: 'So a reinstall replaces its own token, not another' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;
}

export class UpdatePreferenceDto {
  @ApiProperty({ enum: Object.values(NOTIFICATION_TYPES) })
  @IsIn(Object.values(NOTIFICATION_TYPES))
  type!: string;

  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'Local wall clock, "HH:MM"' })
  @IsOptional()
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/)
  quietHoursStart?: string;

  @ApiPropertyOptional({ description: 'Local wall clock, "HH:MM"' })
  @IsOptional()
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/)
  quietHoursEnd?: string;

  @ApiPropertyOptional({ default: 'Europe/Istanbul' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class PreferenceDto {
  @ApiProperty()
  type!: string;

  @ApiProperty({ enum: NotificationChannel })
  channel!: NotificationChannel;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ nullable: true })
  quietHoursStart!: string | null;

  @ApiProperty({ nullable: true })
  quietHoursEnd!: string | null;

  @ApiProperty()
  timezone!: string;
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ enum: NotificationChannel })
  channel!: NotificationChannel;

  @ApiProperty({ enum: NotificationStatus })
  status!: NotificationStatus;

  @ApiProperty({ nullable: true, description: 'Why this attempt did not arrive' })
  failureReason!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'The attempt this one is standing in for',
  })
  fallbackForId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sentAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
