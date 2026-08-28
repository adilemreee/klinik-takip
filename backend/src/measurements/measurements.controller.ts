import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, Measurement, MeasurementSource, MeasurementType } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { BodyChartDto, MeasurementDto, SeriesPointDto } from './dto/measurement-response.dto';
import { RecordMeasurementDto, SeriesQueryDto, StaffRecordMeasurementDto } from './dto/measurement.dto';
import { BodyChart, MeasurementsService, SeriesPoint } from './measurements.service';

@ApiTags('measurements')
@ApiBearerAuth()
@Controller('patients/:id/measurements')
export class MeasurementsController {
  constructor(private readonly measurements: MeasurementsService) {}

  @Post()
  @RequirePermissions('medical.write')
  @ApiOperation({ summary: 'Record a reading; implausible values are refused' })
  @ApiCreatedResponse({ type: MeasurementDto })
  @ApiStandardErrors()
  async record(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Body() dto: StaffRecordMeasurementDto,
  ): Promise<Measurement> {
    return this.measurements.record(user, patientId, dto);
  }

  @Get('latest')
  @RequirePermissions('medical.read')
  @Audit({ entityType: 'measurements', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: 'The most recent reading of each type' })
  @ApiOkResponse({ type: SeriesPointDto, isArray: false })
  @ApiStandardErrors()
  async latest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<Partial<Record<MeasurementType, SeriesPoint>>> {
    return this.measurements.latest(user, patientId);
  }

  /**
   * The BMI half is computed from the weights and the height in effect at each
   * one, rather than stored — see MeasurementsService.
   */
  @Get('chart')
  @RequirePermissions('medical.read')
  @Audit({ entityType: 'measurements', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: 'Weight curve, BMI curve and goal line in one read' })
  @ApiOkResponse({ type: BodyChartDto })
  @ApiStandardErrors()
  async chart(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<BodyChart> {
    return this.measurements.bodyChart(user, patientId);
  }

  @Get(':type')
  @RequirePermissions('medical.read')
  @Audit({ entityType: 'measurements', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: 'One reading type over time, oldest first' })
  @ApiOkResponse({ type: [SeriesPointDto] })
  @ApiStandardErrors()
  async series(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Param('type', new ParseEnumPipe(MeasurementType)) type: MeasurementType,
    @Query() query: SeriesQueryDto,
  ): Promise<SeriesPoint[]> {
    return this.measurements.series(user, patientId, type, query.from, query.to);
  }
}

/**
 * Patients recording their own readings (spec M2, M20).
 *
 * Separate from the staff route because the source is not the caller's to
 * choose: a reading entered by a patient is marked as such, so a clinician
 * reading the chart knows where each point came from.
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/measurements')
export class MyMeasurementsController {
  constructor(private readonly measurements: MeasurementsService) {}

  @Post()
  @RequirePermissions('self.write')
  @ApiOperation({ summary: 'Record one of your own readings' })
  @ApiCreatedResponse({ type: MeasurementDto })
  @ApiStandardErrors()
  async record(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordMeasurementDto,
  ): Promise<Measurement> {
    const patient = await this.measurements.ownPatientId(user);

    return this.measurements.record(user, patient, {
      ...dto,
      // Not taken from the request: a patient cannot label their entry as a
      // nurse's or a device's.
      source: MeasurementSource.PATIENT,
    });
  }

  @Get('latest')
  @RequirePermissions('self.read')
  @ApiOperation({ summary: 'Your most recent reading of each type' })
  @ApiOkResponse({ type: SeriesPointDto, isArray: false })
  @ApiStandardErrors()
  async latest(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Partial<Record<MeasurementType, SeriesPoint>>> {
    return this.measurements.latest(user, await this.measurements.ownPatientId(user));
  }

  @Get('chart')
  @RequirePermissions('self.read')
  @ApiOperation({ summary: 'Your weight curve, BMI curve and goal line' })
  @ApiOkResponse({ type: BodyChartDto })
  @ApiStandardErrors()
  async chart(@CurrentUser() user: AuthenticatedUser): Promise<BodyChart> {
    return this.measurements.bodyChart(user, await this.measurements.ownPatientId(user));
  }

  @Get(':type')
  @RequirePermissions('self.read')
  @ApiOperation({ summary: 'One of your reading types over time' })
  @ApiOkResponse({ type: [SeriesPointDto] })
  @ApiStandardErrors()
  async series(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type', new ParseEnumPipe(MeasurementType)) type: MeasurementType,
    @Query() query: SeriesQueryDto,
  ): Promise<SeriesPoint[]> {
    const patient = await this.measurements.ownPatientId(user);

    return this.measurements.series(user, patient, type, query.from, query.to);
  }
}
