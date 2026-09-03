import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, Currency } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { PermissionsService } from '../authz/permissions.service';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { MAX_MONTHS } from './analytics';
import {
  AnalyticsService,
  type ChannelReport,
  type GeographyReport,
  type OccupancyReport,
  type ProcedureReport,
  type RevenueReport,
} from './analytics.service';
import {
  ChannelReportDto,
  GeographyReportDto,
  MoneyRangeQueryDto,
  OccupancyReportDto,
  ProcedureReportDto,
  RangeQueryDto,
  RevenueReportDto,
} from './dto/analytics.dto';

/**
 * The clinic dashboard (spec M11, T6.4).
 *
 * Two permissions divide it, along the same line as everything else here:
 * volumes and geography are `analytics.read`, money is `finance.report`. The
 * finance role holds the second and not the first, and a clinician the first
 * and — unless the doctor grants it — not the second.
 *
 * The channel report is the one place they meet, because "which channel is
 * worth the spend" is one question. It is served under `analytics.read` and the
 * revenue columns appear only for a caller who also holds `finance.report`,
 * with `revenueWithheld` saying so.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('procedures')
  @RequirePermissions('analytics.read')
  @Audit({ entityType: 'analytics', action: AuditAction.READ })
  @ApiOperation({ summary: 'Operations by month and by type' })
  @ApiOkResponse({ type: ProcedureReportDto })
  @ApiStandardErrors()
  async procedures(@Query() query: RangeQueryDto): Promise<ProcedureReport> {
    this.assertRange(query.from, query.to);

    return this.analytics.procedures(query.from, query.to);
  }

  @Get('geography')
  @RequirePermissions('analytics.read')
  @Audit({ entityType: 'analytics', action: AuditAction.READ })
  @ApiOperation({ summary: 'Where patients come from, by country and city' })
  @ApiOkResponse({ type: GeographyReportDto })
  @ApiStandardErrors()
  async geography(@Query() query: RangeQueryDto): Promise<GeographyReport> {
    this.assertRange(query.from, query.to);

    return this.analytics.geography(query.from, query.to);
  }

  @Get('channels')
  @RequirePermissions('analytics.read')
  @Audit({ entityType: 'analytics', action: AuditAction.READ })
  @ApiOperation({ summary: 'Channels, conversion, and — with finance.report — revenue' })
  @ApiOkResponse({ type: ChannelReportDto })
  @ApiStandardErrors()
  async channels(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MoneyRangeQueryDto,
  ): Promise<ChannelReport> {
    this.assertRange(query.from, query.to);

    const maySeeMoney = await this.permissions.has(user.id, user.role, 'finance.report');

    return this.analytics.channels(
      query.from,
      query.to,
      maySeeMoney,
      query.currency ?? Currency.TRY,
    );
  }

  @Get('revenue')
  @RequirePermissions('finance.report')
  @Audit({ entityType: 'analytics', action: AuditAction.READ })
  @ApiOperation({ summary: 'Billed revenue, costs and margin. Collected money is a different report' })
  @ApiOkResponse({ type: RevenueReportDto })
  @ApiStandardErrors()
  async revenue(@Query() query: MoneyRangeQueryDto): Promise<RevenueReport> {
    this.assertRange(query.from, query.to);

    return this.analytics.revenue(query.from, query.to, query.currency ?? Currency.TRY);
  }

  @Get('occupancy')
  @RequirePermissions('analytics.read')
  @Audit({ entityType: 'analytics', action: AuditAction.READ })
  @ApiOperation({ summary: 'How full the diary is, against configured working hours' })
  @ApiOkResponse({ type: OccupancyReportDto })
  @ApiStandardErrors()
  async occupancy(@Query() query: RangeQueryDto): Promise<OccupancyReport> {
    this.assertRange(query.from, query.to);

    return this.analytics.occupancy(query.from, query.to);
  }

  /**
   * A range that makes sense and is not unbounded.
   *
   * Refused rather than clamped: a report that silently answers a different
   * question than the one asked is worse than an error, because the caller
   * writes the heading themselves.
   */
  private assertRange(from: Date, to: Date): void {
    if (to < from) {
      throw new BadRequestException('`to` is before `from`');
    }

    const months =
      (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
      (to.getUTCMonth() - from.getUTCMonth()) +
      1;

    if (months > MAX_MONTHS) {
      throw new BadRequestException(`A range may span at most ${MAX_MONTHS} months`);
    }
  }
}
