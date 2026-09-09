import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class TravelPlanDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiPropertyOptional({ nullable: true, example: 'TK1980' })
  arrivalFlight!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  arrivalAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  departureFlight!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  departureAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  hotelName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  hotelAddress!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  hotelCheckIn!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  hotelCheckOut!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  greeterName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  greeterPhone!: string | null;

  @ApiPropertyOptional({ nullable: true })
  transferNote!: string | null;

  @ApiPropertyOptional({ nullable: true })
  interpreterName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  interpreterLanguage!: string | null;

  @ApiPropertyOptional({ nullable: true })
  interpreterPhone!: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set by a clinician; never computed from the surgery date',
  })
  clearedToFlyAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty()
  version!: number;
}

export class TravelPlanViewDto {
  @ApiPropertyOptional({ type: TravelPlanDto, nullable: true })
  plan!: TravelPlanDto | null;

  @ApiPropertyOptional({ nullable: true, description: 'Who signed off the flight' })
  clearedToFlyBy!: string | null;
}

/** Every field optional: a coordinator fills the trip in as it is booked. */
export class UpsertTravelPlanDto {
  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  arrivalFlight?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  arrivalAt?: Date;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  departureFlight?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  departureAt?: Date;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  hotelName?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hotelAddress?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  hotelCheckIn?: Date;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  hotelCheckOut?: Date;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  greeterName?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  greeterPhone?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  transferNote?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  interpreterName?: string;

  @ApiPropertyOptional({ maxLength: 40, example: 'de' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  interpreterLanguage?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  interpreterPhone?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Version the client read; a mismatch is refused' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class ClearToFlyDto {
  @ApiProperty({ description: 'True when a clinician says the patient may fly' })
  @IsBoolean()
  cleared!: boolean;
}
