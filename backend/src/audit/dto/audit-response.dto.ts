import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction, Role } from '@prisma/client';

export class AuditEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Null for anonymous events' })
  actorId!: string | null;

  @ApiProperty({ enum: Role, nullable: true })
  actorRole!: Role | null;

  @ApiProperty({ enum: AuditAction })
  action!: AuditAction;

  @ApiProperty({ example: 'patients' })
  entityType!: string;

  @ApiProperty({ nullable: true })
  entityId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  patientId!: string | null;

  @ApiPropertyOptional({
    description: 'State before the change. Null for reads. Credentials are redacted.',
  })
  before?: unknown;

  @ApiPropertyOptional({ description: 'State after the change. Credentials are redacted.' })
  after?: unknown;

  @ApiProperty({ nullable: true })
  ipAddress!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditEntryDto] })
  items!: AuditEntryDto[];

  @ApiProperty({ nullable: true })
  nextCursor!: string | null;
}

export class AnomalyDto {
  @ApiProperty({ enum: ['BULK_ACCESS', 'OFF_HOURS_ACCESS', 'REPEATED_LOGIN_FAILURE'] })
  kind!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  actorId!: string | null;

  @ApiProperty({ enum: Role, nullable: true })
  actorRole!: Role | null;

  @ApiProperty()
  count!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  windowStart!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  windowEnd!: Date;

  @ApiProperty({ example: '120 distinct patient files read' })
  detail!: string;
}
