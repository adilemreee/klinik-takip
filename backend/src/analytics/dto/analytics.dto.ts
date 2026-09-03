import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional } from 'class-validator';

export class RangeQueryDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  to!: Date;
}

export class MoneyRangeQueryDto extends RangeQueryDto {
  @ApiPropertyOptional({
    enum: Currency,
    default: Currency.TRY,
    description: "Everything is converted into this, at each amount's own date",
  })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}

// ------------------------------------------------------------------ responses

export class AmountDto {
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty({ example: '4000.00' }) amount!: string;
}

export class TotalsDto {
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty({ example: '128400.00' }) converted!: string;
  @ApiProperty({ type: [AmountDto] }) byCurrency!: AmountDto[];
  @ApiProperty({
    type: [AmountDto],
    description:
      'What had no rate for its day, in its own currency. Non-empty means `converted` is not the whole answer',
  })
  unconverted!: AmountDto[];
  @ApiProperty() complete!: boolean;
}

export class MonthlyCountDto {
  @ApiProperty({ example: '2026-03' }) month!: string;
  @ApiProperty() count!: number;
}

export class NamedCountDto {
  @ApiProperty({ description: "The clinic's own spelling" }) label!: string;
  @ApiProperty() count!: number;
  @ApiProperty({
    nullable: true,
    description: 'Null when there are too few cases to state a proportion — not zero',
  })
  share!: number | null;
}

export class ProcedureReportDto {
  @ApiProperty() from!: Date;
  @ApiProperty() to!: Date;
  @ApiProperty() total!: number;
  @ApiProperty({ type: [MonthlyCountDto], description: 'Every month in range, empty ones included' })
  byMonth!: MonthlyCountDto[];
  @ApiProperty({ type: [NamedCountDto] }) byProcedure!: NamedCountDto[];
}

export class GeographyReportDto {
  @ApiProperty() from!: Date;
  @ApiProperty() to!: Date;
  @ApiProperty() total!: number;
  @ApiProperty({ type: [NamedCountDto] }) byCountry!: NamedCountDto[];
  @ApiProperty({ type: [NamedCountDto] }) byCity!: NamedCountDto[];
  @ApiProperty({ description: 'Patients with no city recorded, so the shares add up' })
  cityUnknown!: number;
}

export class ChannelRowDto {
  @ApiProperty() label!: string;
  @ApiProperty() key!: string;
  @ApiProperty() patients!: number;
  @ApiProperty() converted!: number;
  @ApiProperty({ nullable: true }) conversionRate!: number | null;
  @ApiPropertyOptional({ type: TotalsDto, description: 'Only for a caller who may see money' })
  revenue?: TotalsDto;
}

export class ChannelReportDto {
  @ApiProperty() from!: Date;
  @ApiProperty() to!: Date;
  @ApiProperty() total!: number;
  @ApiProperty({ type: [ChannelRowDto] }) channels!: ChannelRowDto[];
  @ApiProperty({
    description:
      'True when the caller may not see money. Said out loud, because an absent revenue column otherwise reads as "no revenue"',
  })
  revenueWithheld!: boolean;
  @ApiProperty({ description: 'What "converted" means here' }) conversionDefinition!: string;
  @ApiProperty({ description: 'Below this many cases, a rate is null' }) minimumForRate!: number;
}

export class MonthlyNetDto {
  @ApiProperty({ example: '2026-03' }) month!: string;
  @ApiProperty({ example: '128400.00' }) net!: string;
  @ApiProperty({ description: 'False when this month had amounts with no rate' })
  converted!: boolean;
}

export class CurrencyAverageDto {
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty({ example: '4000.00' }) average!: string;
  @ApiProperty() count!: number;
}

export class RevenueReportDto {
  @ApiProperty() from!: Date;
  @ApiProperty() to!: Date;
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty({ type: TotalsDto }) gross!: TotalsDto;
  @ApiProperty({ type: TotalsDto }) discount!: TotalsDto;
  @ApiProperty({ type: TotalsDto }) net!: TotalsDto;
  @ApiProperty({ type: TotalsDto }) cost!: TotalsDto;
  @ApiProperty({ type: TotalsDto }) agencyCommission!: TotalsDto;
  @ApiProperty({ type: TotalsDto, description: 'Net less costs and commission' })
  margin!: TotalsDto;
  @ApiProperty({ type: [MonthlyNetDto] }) byMonth!: MonthlyNetDto[];
  @ApiProperty({
    type: [CurrencyAverageDto],
    description: 'Exact, per currency. An average blended across currencies is a fiction',
  })
  averageByCurrency!: CurrencyAverageDto[];
  @ApiProperty() recordCount!: number;
  @ApiProperty({ description: 'Cancelled bills left out of the figures' })
  cancelledExcluded!: number;
  @ApiProperty({
    description: 'Cost lines that could not be read. Non-zero means the margin is missing something',
  })
  unreadableCostLines!: number;
}

export class MonthlyOccupancyDto {
  @ApiProperty({ example: '2026-03' }) month!: string;
  @ApiProperty() bookedMinutes!: number;
  @ApiProperty() availableMinutes!: number;
  @ApiProperty({
    nullable: true,
    description: 'Null when no working hours are configured — not zero, which would read as an empty diary',
  })
  rate!: number | null;
  @ApiProperty() appointments!: number;
}

export class OccupancyReportDto {
  @ApiProperty() from!: Date;
  @ApiProperty() to!: Date;
  @ApiProperty({ type: [MonthlyOccupancyDto] }) byMonth!: MonthlyOccupancyDto[];
  @ApiProperty({ description: 'True when no availability window exists at all' })
  capacityUnconfigured!: boolean;
}
