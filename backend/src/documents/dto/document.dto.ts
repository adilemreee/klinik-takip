import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType, ProcessingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListDocumentsDto {
  @ApiPropertyOptional({ description: 'Id of the last item on the previous page' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;
}

export class DocumentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: DocumentType })
  type!: DocumentType;

  @ApiProperty({ nullable: true })
  originalName!: string | null;

  @ApiProperty({ description: 'Detected from the bytes, not from what was declared' })
  mime!: string;

  @ApiProperty()
  size!: number;

  @ApiProperty({ enum: ProcessingStatus })
  ocrStatus!: ProcessingStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class DocumentPageDto {
  @ApiProperty({ type: [DocumentDto] })
  items!: DocumentDto[];

  @ApiProperty({ nullable: true, description: 'Null on the last page' })
  nextCursor!: string | null;
}

export class UploadedDocumentDto extends DocumentDto {
  @ApiProperty({ format: 'uuid', description: 'The processing job queued for this upload' })
  jobId!: string;
}

export class DownloadUrlDto {
  @ApiProperty({ description: 'Short-lived and single-purpose; never stored' })
  url!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;

  @ApiProperty()
  filename!: string;
}

export class JobDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  queue!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ProcessingStatus })
  status!: ProcessingStatus;

  @ApiProperty()
  attempts!: number;

  @ApiProperty({ nullable: true, description: 'Safe to show staff; never file contents' })
  error!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
