import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LabFlag } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyLabResultDto {
  @ApiPropertyOptional({ description: 'Corrected analyte name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  analyteName?: string;

  @ApiPropertyOptional({ description: 'LOINC code; supplying it teaches the mapping' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  analyteCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  refLow?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  refHigh?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  measuredAt?: Date;
}

export class LabResultDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, description: 'LOINC, where it could be mapped' })
  analyteCode!: string | null;

  @ApiProperty()
  analyteName!: string;

  @ApiProperty()
  value!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty({ nullable: true })
  refLow!: string | null;

  @ApiProperty({ nullable: true })
  refHigh!: string | null;

  @ApiProperty({ enum: LabFlag, nullable: true, description: 'Null when there is no range' })
  flag!: LabFlag | null;

  @ApiProperty({ type: String, format: 'date-time' })
  measuredAt!: Date;

  @ApiProperty({ nullable: true, description: "The engine's confidence, 0..1" })
  ocrConfidence!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  verifiedAt!: Date | null;
}

export class ReviewItemDto {
  @ApiProperty({ type: LabResultDto })
  result!: LabResultDto;

  @ApiProperty({ description: 'The engine was unsure; look at this one first' })
  needsAttention!: boolean;

  @ApiProperty({ description: 'The printed name has no code yet' })
  awaitingMapping!: boolean;
}
