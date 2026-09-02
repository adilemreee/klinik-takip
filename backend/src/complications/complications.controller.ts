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
import { ComplicationsService, ComplicationView } from './complications.service';
import {
  ComplicationViewDto,
  QueueQueryDto,
  ReportComplicationDto,
  RespondDto,
} from './dto/complication.dto';

/**
 * The patient's side (spec M7).
 *
 * Its own route rather than the staff one, for the same reason /me exists at
 * all: the staff route needs patients.read, and giving that to patients would
 * put every patient within reach of every file.
 */
@ApiTags('complications')
@ApiBearerAuth()
@Controller('me/complications')
export class MyComplicationsController {
  constructor(
    private readonly complications: ComplicationsService,
    private readonly measurements: MeasurementsService,
  ) {}

  @Post()
  @RequirePermissions('self.write')
  @ApiOperation({ summary: 'Report something wrong, with photos already uploaded' })
  @ApiCreatedResponse({ type: ComplicationViewDto })
  @ApiStandardErrors()
  async report(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReportComplicationDto,
  ): Promise<ComplicationView> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.complications.report(user, patientId, dto);
  }

  /**
   * The patient's own reports, and what the clinic said back.
   *
   * A patient who reported something and can see no answer will report it
   * again; showing them the response is what stops the same worry arriving
   * three times.
   */
  @Get()
  @RequirePermissions('self.read')
  @ApiOperation({ summary: 'Your reports and the clinic\'s replies' })
  @ApiOkResponse({ type: [ComplicationViewDto] })
  @ApiStandardErrors()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<ComplicationView[]> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.complications.forPatient(user, patientId);
  }
}

@ApiTags('complications')
@ApiBearerAuth()
@Controller('complications')
export class ComplicationsController {
  constructor(private readonly complications: ComplicationsService) {}

  @Get()
  @RequirePermissions('medical.read')
  @ApiOperation({ summary: 'Reports still waiting, longest first' })
  @ApiOkResponse({ type: [ComplicationViewDto] })
  @ApiStandardErrors()
  async queue(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueueQueryDto,
  ): Promise<ComplicationView[]> {
    return this.complications.queue(user, query.includeResolved ?? false);
  }

  @Patch(':complicationId/acknowledge')
  @RequirePermissions('medical.write')
  @ApiOperation({ summary: 'Answer a report; this is what the response time measures' })
  @ApiOkResponse({ type: ComplicationViewDto })
  @ApiStandardErrors()
  async acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('complicationId', ParseUUIDPipe) complicationId: string,
    @Body() dto: RespondDto,
  ): Promise<ComplicationView> {
    return this.complications.acknowledge(user, complicationId, dto.message);
  }

  @Patch(':complicationId/resolve')
  @RequirePermissions('medical.write')
  @ApiOperation({ summary: 'Close a report' })
  @ApiOkResponse({ type: ComplicationViewDto })
  @ApiStandardErrors()
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('complicationId', ParseUUIDPipe) complicationId: string,
    @Body() dto: RespondDto,
  ): Promise<ComplicationView> {
    return this.complications.resolve(user, complicationId, dto.message);
  }
}

@ApiTags('complications')
@ApiBearerAuth()
@Controller('patients/:id/complications')
export class PatientComplicationsController {
  constructor(private readonly complications: ComplicationsService) {}

  @Get()
  @RequirePermissions('medical.read')
  @Audit({ entityType: 'complications', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: "A patient's reports, newest first" })
  @ApiOkResponse({ type: [ComplicationViewDto] })
  @ApiStandardErrors()
  async forPatient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<ComplicationView[]> {
    return this.complications.forPatient(user, patientId);
  }
}
