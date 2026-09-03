import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UploadProtocolDto {
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @Length(3, 300)
  title!: string;

  @ApiProperty({ description: 'The document text. Chunked on the way in' })
  @IsString()
  @Length(50, 500_000)
  content!: string;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Restricts retrieval to patients who had this procedure; omit for general advice',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  procedureType?: string;

  @ApiPropertyOptional({ default: 'tr' })
  @IsOptional()
  @IsString()
  @Length(2, 5)
  language?: string;
}

export class ProtocolDocumentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  procedureType!: string | null;

  @ApiProperty()
  language!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class ProtocolSummaryDto {
  @ApiProperty({ type: ProtocolDocumentDto })
  document!: ProtocolDocumentDto;

  @ApiProperty({ description: 'How many pieces the document was split into' })
  chunks!: number;

  @ApiProperty({ description: 'False when no embedding provider was configured' })
  embedded!: boolean;
}
