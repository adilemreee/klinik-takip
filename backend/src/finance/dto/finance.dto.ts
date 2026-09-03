import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Currency,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Amounts cross the wire as strings, in and out.
 *
 * A JSON number is a double once a client has parsed it, and two of the four
 * currencies here routinely produce amounts a double cannot hold exactly. The
 * pattern also rejects exponent notation and more than two decimal places,
 * both of which would be silently mangled by the column.
 */
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const AMOUNT_MESSAGE = 'must be an amount like "1250.00"';

/** Rates keep eight places; they are not money. */
const RATE = /^\d{1,10}(\.\d{1,8})?$/;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One line of what a case cost the clinic.
 *
 * A shape rather than free-form JSON, because "gelir–gider" has to be summable
 * and a total assembled from whatever happened to be in the column is a total
 * nobody can check.
 */
export class CostItemDto {
  @ApiProperty({ maxLength: 100, example: 'İmplant' })
  @IsString()
  @MaxLength(100)
  label!: string;

  @ApiProperty({ example: '1200.00', description: "In the record's currency" })
  @Matches(AMOUNT, { message: `cost amount ${AMOUNT_MESSAGE}` })
  amount!: string;
}

export class CreateFinanceRecordDto {
  @ApiProperty({ maxLength: 200, example: 'Rinoplasti' })
  @IsString()
  @MaxLength(200)
  procedureName!: string;

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiProperty({ example: '4500.00', description: 'Before discount' })
  @Matches(AMOUNT, { message: `grossAmount ${AMOUNT_MESSAGE}` })
  grossAmount!: string;

  @ApiPropertyOptional({ example: '500.00' })
  @IsOptional()
  @Matches(AMOUNT, { message: `discount ${AMOUNT_MESSAGE}` })
  discount?: string;

  @ApiPropertyOptional({
    type: [CostItemDto],
    description:
      'Cost breakdown. The net is what the patient pays; this is what it cost the clinic',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CostItemDto)
  costItems?: CostItemDto[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agencyId?: string;

  @ApiPropertyOptional({
    example: '450.00',
    description: "Overrides the agency's standing rate for a negotiated case",
  })
  @IsOptional()
  @Matches(AMOUNT, { message: `agencyCommission ${AMOUNT_MESSAGE}` })
  agencyCommission?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class UpdateFinanceRecordDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  procedureName?: string;

  @ApiPropertyOptional({ example: '4500.00' })
  @IsOptional()
  @Matches(AMOUNT, { message: `grossAmount ${AMOUNT_MESSAGE}` })
  grossAmount?: string;

  @ApiPropertyOptional({ example: '500.00' })
  @IsOptional()
  @Matches(AMOUNT, { message: `discount ${AMOUNT_MESSAGE}` })
  discount?: string;

  @ApiPropertyOptional({ type: [CostItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CostItemDto)
  costItems?: CostItemDto[];

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  agencyId?: string | null;

  @ApiPropertyOptional({ example: '450.00', nullable: true })
  @IsOptional()
  agencyCommission?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CancelFinanceRecordDto {
  @ApiProperty({
    maxLength: 500,
    description: 'Why the bill was written off. Kept on the record',
  })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class RecordPaymentDto {
  @ApiProperty({ example: '1500.00' })
  @Matches(AMOUNT, { message: `amount ${AMOUNT_MESSAGE}` })
  amount!: string;

  @ApiPropertyOptional({
    enum: Currency,
    description: "Defaults to the record's currency",
  })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({
    example: '1200.00',
    description:
      'How much of the bill this settles. Required when the payment is in another currency — the rate that settles a bill is the one the bank used, not one this software guessed',
  })
  @IsOptional()
  @Matches(AMOUNT, { message: `appliedAmount ${AMOUNT_MESSAGE}` })
  appliedAmount?: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'When the money moved, which is not when it was typed in. Defaults to now',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  paidAt?: Date;

  @ApiPropertyOptional({ maxLength: 100, description: 'Receipt or transfer reference' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ enum: PaymentKind, default: PaymentKind.PAYMENT })
  @IsOptional()
  @IsEnum(PaymentKind)
  kind?: PaymentKind;
}

export class ReversePaymentDto {
  @ApiProperty({ maxLength: 500, description: 'Why it was wrong. Kept on the row' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ListFinanceRecordsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ enum: Currency })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agencyId?: string;

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

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class CollectionsQueryDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  to!: Date;

  @ApiPropertyOptional({
    enum: Currency,
    default: Currency.TRY,
    description: 'Everything is converted into this, at each payment\'s own date',
  })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}

export class OutstandingQueryDto {
  @ApiPropertyOptional({ enum: Currency, default: Currency.TRY })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}

export class PutRateDto {
  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  base!: Currency;

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  quote!: Currency;

  @ApiProperty({ example: '35.42000000', description: 'One unit of base costs this much quote' })
  @Matches(RATE, { message: 'rate must be a positive number with up to 8 decimal places' })
  rate!: string;

  @ApiProperty({ example: '2026-09-03', description: 'The day the rate is for' })
  @Matches(DAY, { message: 'validOn must be YYYY-MM-DD' })
  validOn!: string;
}

export class ListRatesDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  to!: Date;
}

export class CreateAgencyDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactEmail?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @ApiPropertyOptional({
    example: '0.1000',
    description: 'Fraction of the net, 0–1. Applied when a record names this agency',
  })
  @IsOptional()
  @Matches(/^0(\.\d{1,4})?$|^1(\.0{1,4})?$/, {
    message: 'commissionRate must be between 0 and 1, e.g. "0.1000"',
  })
  commissionRate?: string;
}

// ------------------------------------------------------------------ responses

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: PaymentKind }) kind!: PaymentKind;
  @ApiProperty({ example: '1500.00' }) amount!: string;
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty({ example: '1200.00' }) appliedAmount!: string;
  @ApiProperty({ nullable: true, example: '0.80000000' }) rate!: string | null;
  @ApiProperty({ enum: PaymentMethod }) method!: PaymentMethod;
  @ApiProperty() paidAt!: Date;
  @ApiProperty({ nullable: true }) reference!: string | null;
  @ApiProperty({ nullable: true }) note!: string | null;
  @ApiProperty({ nullable: true, description: 'Reversed rows stay, and stop counting' })
  reversedAt!: Date | null;
  @ApiProperty({ nullable: true }) reversalReason!: string | null;
}

export class FinancePatientDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() mrn!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() country!: string;
}

export class FinanceRecordResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) patientId!: string;
  @ApiProperty({
    type: FinancePatientDto,
    nullable: true,
    description: 'Name, file number and country. Nothing clinical',
  })
  patient!: FinancePatientDto | null;
  @ApiProperty() procedureName!: string;
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty({ example: '4500.00' }) grossAmount!: string;
  @ApiProperty({ example: '500.00' }) discount!: string;
  @ApiProperty({ example: '4000.00' }) netAmount!: string;
  @ApiProperty({ example: '1500.00' }) paidAmount!: string;
  @ApiProperty({ example: '0.00' }) refundedAmount!: string;
  @ApiProperty({ example: '2500.00', description: 'Negative when overpaid' })
  balance!: string;
  @ApiProperty({ enum: PaymentStatus, description: 'Derived from the ledger, never set by a client' })
  paymentStatus!: PaymentStatus;
  @ApiProperty({ nullable: true }) paidAt!: Date | null;
  @ApiProperty({ nullable: true }) cancelledAt!: Date | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) agencyId!: string | null;
  @ApiProperty({ nullable: true }) agencyName!: string | null;
  @ApiProperty({ nullable: true }) agencyCommission!: string | null;
  @ApiProperty({ nullable: true }) costItems!: unknown;
  @ApiProperty({ nullable: true }) note!: string | null;
  @ApiProperty({ type: [PaymentResponseDto] }) payments!: PaymentResponseDto[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class AmountDto {
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty({ example: '4000.00' }) amount!: string;
}

export class TotalsDto {
  @ApiProperty({ enum: Currency, description: 'What everything was converted into' })
  currency!: Currency;
  @ApiProperty({ example: '128400.00' }) converted!: string;
  @ApiProperty({ type: [AmountDto], description: 'Every currency present, converted or not' })
  byCurrency!: AmountDto[];
  @ApiProperty({
    type: [AmountDto],
    description:
      'What had no rate for its day, in its own currency. Non-empty means `converted` is not the whole answer',
  })
  unconverted!: AmountDto[];
  @ApiProperty({ description: 'Whether `converted` accounts for everything' })
  complete!: boolean;
}

export class MethodTotalsDto {
  @ApiProperty({ enum: PaymentMethod }) method!: PaymentMethod;
  @ApiProperty({ type: TotalsDto }) totals!: TotalsDto;
}

export class CollectionReportDto {
  @ApiProperty() from!: Date;
  @ApiProperty() to!: Date;
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty({ type: TotalsDto }) received!: TotalsDto;
  @ApiProperty({ type: TotalsDto }) refunded!: TotalsDto;
  @ApiProperty({ type: TotalsDto, description: 'Received less refunded' }) net!: TotalsDto;
  @ApiProperty({ type: [MethodTotalsDto] }) byMethod!: MethodTotalsDto[];
  @ApiProperty() paymentCount!: number;
}

export class AgeingBucketDto {
  @ApiProperty({ enum: ['current', 'd30', 'd60', 'over90'] }) bucket!: string;
  @ApiProperty({ type: TotalsDto }) totals!: TotalsDto;
  @ApiProperty() recordCount!: number;
}

export class OutstandingReportDto {
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty({ type: TotalsDto }) outstanding!: TotalsDto;
  @ApiProperty({ type: [AgeingBucketDto] }) ageing!: AgeingBucketDto[];
  @ApiProperty() recordCount!: number;
}

export class ExchangeRateDto {
  @ApiProperty({ enum: Currency }) base!: Currency;
  @ApiProperty({ enum: Currency }) quote!: Currency;
  @ApiProperty({ example: '35.42000000' }) rate!: string;
  @ApiProperty({ type: String, format: 'date' }) validOn!: Date;
}

export class AgencyDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) country!: string | null;
  @ApiProperty({ nullable: true }) contactName!: string | null;
  @ApiProperty({ nullable: true }) contactEmail!: string | null;
  @ApiProperty({ nullable: true }) contactPhone!: string | null;
  @ApiProperty({ nullable: true, example: '0.1000' }) commissionRate!: string | null;
  @ApiProperty() isActive!: boolean;
}

export class FinanceRecordPageDto {
  @ApiProperty({ type: [FinanceRecordResponseDto] }) items!: FinanceRecordResponseDto[];
  @ApiProperty({ nullable: true, format: 'uuid' }) nextCursor!: string | null;
}
