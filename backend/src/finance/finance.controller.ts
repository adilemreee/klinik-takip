import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuditAction, Currency } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import {
  AgencyDto,
  CancelFinanceRecordDto,
  CollectionReportDto,
  CollectionsQueryDto,
  CreateAgencyDto,
  CreateFinanceRecordDto,
  ExchangeRateDto,
  FinanceRecordPageDto,
  FinanceRecordResponseDto,
  ListFinanceRecordsDto,
  ListRatesDto,
  OutstandingQueryDto,
  OutstandingReportDto,
  PutRateDto,
  RecordPaymentDto,
  ReversePaymentDto,
  UpdateFinanceRecordDto,
} from './dto/finance.dto';
import {
  FinanceService,
  type AgencyView,
  type CollectionReport,
  type FinanceRecordView,
  type OutstandingReport,
} from './finance.service';

/**
 * The finance desk (spec M11, T6.3).
 *
 * Every route here is gated on a `finance.*` permission and none of them
 * touches clinical data — which is the other half of the rule in spec section
 * 2, whose first half is that the nurse holds no finance permission at all.
 * Both directions have negative tests.
 *
 * Access is deliberately clinic-wide rather than scoped to a care team: the
 * books are not divisible, and the FINANCE role has no patient scope precisely
 * because it is not supposed to browse patients — it sees a name, a file
 * number and a country attached to a bill.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('records')
  @RequirePermissions('finance.read')
  @Audit({ entityType: 'finance_records', action: AuditAction.READ })
  @ApiOperation({ summary: 'Finance records, newest first' })
  @ApiOkResponse({ type: FinanceRecordPageDto })
  @ApiStandardErrors()
  async list(
    @Query() query: ListFinanceRecordsDto,
  ): Promise<{ items: FinanceRecordView[]; nextCursor: string | null }> {
    return this.finance.list(query);
  }

  @Get('records/:id')
  @RequirePermissions('finance.read')
  @Audit({ entityType: 'finance_records', action: AuditAction.READ, entityIdParam: 'id' })
  @ApiOperation({ summary: 'One record, with its payment ledger' })
  @ApiOkResponse({ type: FinanceRecordResponseDto })
  @ApiStandardErrors()
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<FinanceRecordView> {
    return this.finance.get(id);
  }

  @Patch('records/:id')
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Edit a bill. The net is recomputed, never supplied' })
  @ApiOkResponse({ type: FinanceRecordResponseDto })
  @ApiStandardErrors()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinanceRecordDto,
  ): Promise<FinanceRecordView> {
    return this.finance.update(user, id, dto);
  }

  @Post('records/:id/cancel')
  @RequirePermissions('finance.write')
  @ApiOperation({
    summary: 'Write a bill off. Not a delete — collected money still has to be accounted for',
  })
  @ApiOkResponse({ type: FinanceRecordResponseDto })
  @ApiStandardErrors()
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelFinanceRecordDto,
  ): Promise<FinanceRecordView> {
    return this.finance.cancel(user, id, dto.reason);
  }

  @Post('records/:id/payments')
  @RequirePermissions('finance.write')
  @ApiOperation({
    summary: 'Record money that arrived. The payment status follows from the ledger',
  })
  @ApiCreatedResponse({ type: FinanceRecordResponseDto })
  @ApiStandardErrors()
  async addPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
  ): Promise<FinanceRecordView> {
    return this.finance.addPayment(user, id, dto);
  }

  @Post('payments/:id/reverse')
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Correct a mistyped payment. The row stays, with its numbers' })
  @ApiOkResponse({ type: FinanceRecordResponseDto })
  @ApiStandardErrors()
  async reversePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePaymentDto,
  ): Promise<FinanceRecordView> {
    return this.finance.reversePayment(user, id, dto.reason);
  }

  @Get('collections')
  @RequirePermissions('finance.report')
  @Audit({ entityType: 'finance_reports', action: AuditAction.READ })
  @ApiOperation({
    summary: 'Money received in a period, each payment converted at its own date',
  })
  @ApiOkResponse({ type: CollectionReportDto })
  @ApiStandardErrors()
  async collections(@Query() query: CollectionsQueryDto): Promise<CollectionReport> {
    return this.finance.collections(query.from, query.to, query.currency ?? Currency.TRY);
  }

  @Get('outstanding')
  @RequirePermissions('finance.report')
  @Audit({ entityType: 'finance_reports', action: AuditAction.READ })
  @ApiOperation({ summary: 'What is still owed, and for how long' })
  @ApiOkResponse({ type: OutstandingReportDto })
  @ApiStandardErrors()
  async outstanding(@Query() query: OutstandingQueryDto): Promise<OutstandingReport> {
    return this.finance.outstanding(query.currency ?? Currency.TRY);
  }

  @Get('rates')
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Recorded exchange rates' })
  @ApiOkResponse({ type: [ExchangeRateDto] })
  @ApiStandardErrors()
  async listRates(@Query() query: ListRatesDto): Promise<ExchangeRateDto[]> {
    const rates = await this.finance.listRates(query.from, query.to);

    return rates.map((rate) => ({
      base: rate.base,
      quote: rate.quote,
      rate: rate.rate.toString(),
      validOn: rate.validOn,
    }));
  }

  @Post('rates')
  @RequirePermissions('finance.write')
  @ApiOperation({
    summary: 'Record a rate for a day. There is no rate feed here — the source is the clinic\'s',
  })
  @ApiCreatedResponse({ type: ExchangeRateDto })
  @ApiStandardErrors()
  async putRate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PutRateDto,
  ): Promise<ExchangeRateDto> {
    const rate = await this.finance.putRate(user, dto.base, dto.quote, dto.rate, dto.validOn);

    return {
      base: rate.base,
      quote: rate.quote,
      rate: rate.rate.toString(),
      validOn: rate.validOn,
    };
  }

  @Get('agencies')
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Agencies, for picking one on a bill' })
  @ApiOkResponse({ type: [AgencyDto] })
  @ApiStandardErrors()
  async listAgencies(): Promise<AgencyView[]> {
    return this.finance.listAgencies();
  }

  @Post('agencies')
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Add an agency' })
  @ApiCreatedResponse({ type: AgencyDto })
  @ApiStandardErrors()
  async createAgency(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAgencyDto,
  ): Promise<AgencyView> {
    return this.finance.createAgency(user, dto);
  }

  @Patch('agencies/:id')
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Edit an agency' })
  @ApiOkResponse({ type: AgencyDto })
  @ApiStandardErrors()
  async updateAgency(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateAgencyDto> & { isActive?: boolean },
  ): Promise<AgencyView> {
    return this.finance.updateAgency(user, id, dto);
  }
}

/** A patient's bills, from the patient's file. */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('patients/:id/finance')
export class PatientFinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get()
  @RequirePermissions('finance.read')
  @Audit({ entityType: 'finance_records', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: "This patient's bills" })
  @ApiOkResponse({ type: [FinanceRecordResponseDto] })
  @ApiStandardErrors()
  async forPatient(
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<FinanceRecordView[]> {
    return this.finance.forPatient(patientId);
  }

  @Post()
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Raise a bill' })
  @ApiCreatedResponse({ type: FinanceRecordResponseDto })
  @ApiStandardErrors()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Body() dto: CreateFinanceRecordDto,
  ): Promise<FinanceRecordView> {
    return this.finance.create(user, patientId, dto);
  }
}
