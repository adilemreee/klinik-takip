import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { MeasurementsService } from '../measurements/measurements.service';
import {
  AIReportsService,
  type PatientReportView,
  type ReportView,
} from './ai-reports.service';
import {
  InterpretLabsDto,
  PatientReportDto,
  ReportViewDto,
  ReviewReportDto,
} from './dto/report.dto';

@ApiTags('ai-reports')
@ApiBearerAuth()
@Controller('reports')
export class AIReportsController {
  constructor(private readonly reports: AIReportsService) {}

  /** Reports nobody has signed off yet, oldest first. */
  @Get('pending')
  @RequirePermissions('ai.review')
  @ApiOperation({ summary: 'AI reports waiting for a clinician' })
  @ApiOkResponse({ type: [ReportViewDto] })
  @ApiStandardErrors()
  async pending(@CurrentUser() user: AuthenticatedUser): Promise<ReportView[]> {
    return this.reports.pending(user);
  }

  /**
   * Signing off, and deciding whether the patient sees the plain-language half.
   *
   * One action, because it is one decision: a doctor who has read the report
   * knows whether it should go, and splitting it would leave a pile of
   * reviewed-but-unreleased reports nobody can tell from unread ones.
   */
  @Patch(':reportId/review')
  @RequirePermissions('ai.review')
  @ApiOperation({ summary: 'Review a report and release it to the patient, or not' })
  @ApiOkResponse({ type: ReportViewDto })
  @ApiStandardErrors()
  async review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: ReviewReportDto,
  ): Promise<ReportView> {
    return this.reports.review(user, reportId, dto.release);
  }
}

@ApiTags('ai-reports')
@ApiBearerAuth()
@Controller('patients/:id/reports')
export class PatientReportsController {
  constructor(private readonly reports: AIReportsService) {}

  @Get()
  @RequirePermissions('medical.read')
  @Audit({ entityType: 'ai_reports', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: "A patient's AI reports, newest first" })
  @ApiOkResponse({ type: [ReportViewDto] })
  @ApiStandardErrors()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<ReportView[]> {
    return this.reports.forPatient(user, patientId);
  }

  /**
   * Asks for an interpretation of the patient's verified lab results.
   *
   * Requested by a clinician rather than produced on every upload: this is
   * decision support, and support nobody asked for is spend nobody planned.
   */
  @Post('lab')
  @RequirePermissions('ai.review')
  @ApiOperation({ summary: 'Interpret the verified lab panel, for doctor and patient' })
  @ApiCreatedResponse({ type: ReportViewDto })
  @ApiStandardErrors()
  async interpretLabs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Query() query: InterpretLabsDto,
  ): Promise<ReportView> {
    return this.reports.interpretLabs(user, patientId, query);
  }
}

@ApiTags('ai-reports')
@ApiBearerAuth()
@Controller('me/reports')
export class MyReportsController {
  constructor(
    private readonly reports: AIReportsService,
    private readonly measurements: MeasurementsService,
  ) {}

  /**
   * Only what a clinician released.
   *
   * Its own method rather than a filter passed into the shared one: a flag
   * defaulting the wrong way, or a caller forgetting to pass it, would put an
   * unreviewed AI interpretation in front of the patient it was written about.
   */
  @Get()
  @RequirePermissions('self.read')
  @ApiOperation({ summary: 'Reports your clinic has released to you' })
  @ApiOkResponse({ type: [PatientReportDto] })
  @ApiStandardErrors()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<PatientReportView[]> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.reports.releasedTo(user, patientId);
  }
}
