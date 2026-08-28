import { ApiProperty } from '@nestjs/swagger';
import { MeasurementSource } from '@prisma/client';

export class SeriesPointDto {
  @ApiProperty({ type: String, format: 'date-time' })
  measuredAt!: Date;

  @ApiProperty()
  value!: number;

  @ApiProperty({ nullable: true, description: 'Diastolic, for blood pressure' })
  secondaryValue!: number | null;

  @ApiProperty()
  unit!: string;

  @ApiProperty({ enum: MeasurementSource })
  source!: MeasurementSource;
}

export class BmiPointDto {
  @ApiProperty({ type: String, format: 'date-time' })
  measuredAt!: Date;

  @ApiProperty({ example: 22.9 })
  bmi!: number;

  @ApiProperty({
    enum: ['UNDERWEIGHT', 'NORMAL', 'OVERWEIGHT', 'OBESE_I', 'OBESE_II', 'OBESE_III'],
  })
  category!: string;

  @ApiProperty({ description: 'The weight this point was computed from' })
  weightKg!: number;

  @ApiProperty({ description: 'The height in effect when that weight was taken' })
  heightCm!: number;
}

export class MeasurementDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  value!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  measuredAt!: Date;
}

export class BodyChartDto {
  @ApiProperty({ type: [SeriesPointDto] })
  weight!: SeriesPointDto[];

  @ApiProperty({ type: [BmiPointDto] })
  bmi!: BmiPointDto[];

  @ApiProperty({ nullable: true, description: 'Null when no goal has been set' })
  targetWeightKg!: number | null;

  @ApiProperty({ nullable: true, description: 'The same goal on the BMI axis' })
  targetBmi!: number | null;
}
