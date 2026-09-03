import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExportKind, ProcessingStatus } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';

export class RequestSummaryDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Photographs. Off by default: they are the most sensitive thing an export can carry, and only those with a live photo-usage consent are included whatever this says',
  })
  @IsOptional()
  @IsBoolean()
  includePhotos?: boolean;
}

export class ExportResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ExportKind }) kind!: ExportKind;
  @ApiProperty({ enum: ProcessingStatus }) status!: ProcessingStatus;
  @ApiProperty({ nullable: true, format: 'uuid' }) patientId!: string | null;
  @ApiProperty({ nullable: true }) size!: number | null;
  @ApiProperty({
    nullable: true,
    description: 'What went in, and what was left out and why',
  })
  contents!: unknown;
  @ApiProperty({ nullable: true }) error!: string | null;
  @ApiProperty({ nullable: true, description: 'After this the stored file is deleted' })
  expiresAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class DownloadLinkDto {
  @ApiProperty({ description: 'Short-lived and signed' }) url!: string;
  @ApiProperty() expiresAt!: Date;
  @ApiProperty() filename!: string;
}
