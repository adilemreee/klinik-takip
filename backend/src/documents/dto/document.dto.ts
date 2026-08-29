import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType, ProcessingStatus, UploadStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
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

export class BeginUploadDto {
  @ApiProperty({ enum: DocumentType, default: DocumentType.OTHER })
  @IsEnum(DocumentType)
  type!: DocumentType;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalName?: string;
}

export class CompleteUploadDto {
  @ApiPropertyOptional({
    description:
      'SHA-256 the client computed over the file it read. Checked against the ' +
      'assembled bytes, so a corrupted transfer is refused rather than filed.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  checksum?: string;
}

export class UploadSessionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'The offset to send next — resume from here' })
  receivedBytes!: number;

  @ApiProperty({ enum: UploadStatus })
  status!: UploadStatus;

  @ApiProperty({ nullable: true, description: 'Detected from the first chunk' })
  mime!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Set once completed' })
  documentId!: string | null;
}
