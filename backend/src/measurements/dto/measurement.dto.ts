import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MeasurementSource, MeasurementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class RecordMeasurementDto {
  @ApiProperty({ enum: MeasurementType })
  @IsEnum(MeasurementType)
  type!: MeasurementType;

  @ApiProperty({ description: 'Systolic, for blood pressure' })
  @Type(() => Number)
  @IsNumber()
  value!: number;

  @ApiPropertyOptional({ description: 'Diastolic; only blood pressure uses it' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  secondaryValue?: number;

  @ApiPropertyOptional({ description: 'Defaults to the unit the type is stored in' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ description: 'Defaults to now; set it when entering an older reading' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  measuredAt?: Date;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Whether this reading came off a health device rather than being typed
   * (spec M20).
   *
   * A boolean rather than the source enum, deliberately. The patient still
   * cannot label a reading as a nurse's — the only thing this decides is
   * PATIENT versus DEVICE, which is a claim about their own phone and one they
   * are entitled to make.
   */
  @ApiPropertyOptional({
    description: 'True when the reading was synchronised from HealthKit or Health Connect',
  })
  @IsOptional()
  @IsBoolean()
  fromDevice?: boolean;
}

export class StaffRecordMeasurementDto extends RecordMeasurementDto {
  @ApiProperty({
    enum: MeasurementSource,
    description: 'Device readings are kept distinguishable from entered ones (spec M20)',
  })
  @IsEnum(MeasurementSource)
  source!: MeasurementSource;
}

export class SeriesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
