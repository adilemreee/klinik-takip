import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExportKind, ProcessingStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsOptional,
  IsBoolean,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

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

export class RequestPatientListDto {
  @ApiPropertyOptional({ enum: ['CSV', 'XLSX'], default: 'CSV' })
  @IsOptional()
  @IsIn(['CSV', 'XLSX'])
  format?: 'CSV' | 'XLSX';

  @ApiPropertyOptional({
    type: [String],
    description:
      'Column keys, in the order they should appear. A column you may not export is refused, not quietly dropped',
    example: ['mrn', 'firstName', 'lastName', 'country'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  columns?: string[];

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ maxLength: 2, example: 'DE' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  country?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Matches any of the patient\'s surgeries' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  procedure?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assignedDoctorId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agencyId?: string;
}

export class ExportColumnDto {
  @ApiProperty() key!: string;
  @ApiProperty() header!: string;
  @ApiProperty({ enum: ['identity', 'clinical', 'finance'] }) group!: string;
  @ApiProperty({ description: 'You need this to export the column' })
  permission!: string;
  @ApiProperty({ description: 'Whether you hold it' }) available!: boolean;
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
