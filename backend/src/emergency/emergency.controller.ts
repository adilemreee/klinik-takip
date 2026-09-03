import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { MeasurementsService } from '../measurements/measurements.service';
import {
  EmergencyQueueQueryDto,
  EmergencyEventDto,
  EmergencyGuidanceDto,
  PatientEmergencyViewDto,
  ResolveEmergencyDto,
  StaffEmergencyViewDto,
  TriggerEmergencyDto,
} from './dto/emergency.dto';
import {
  EmergencyService,
  type PatientEmergencyView,
  type StaffEmergencyView,
} from './emergency.service';
import type { EmergencyGuidance } from './guidance';
import type { EmergencyEvent } from '@prisma/client';

/**
 * The patient's side of the button (spec M8).
 *
 * The two-step confirmation the spec asks for is in the apps, not here: a
 * server-side confirmation step would mean a second request, and a second
 * request is a second chance for the connection to drop between the patient
 * deciding and anyone finding out.
 */
@ApiTags('emergency')
@ApiBearerAuth()
@Controller('me/emergency')
export class MyEmergencyController {
  constructor(
    private readonly emergency: EmergencyService,
    private readonly measurements: MeasurementsService,
  ) {}

  @Post()
  @RequirePermissions('self.emergency')
  @ApiOperation({ summary: 'Raise the alarm; pressing again returns the call already open' })
  @ApiCreatedResponse({ type: PatientEmergencyViewDto })
  @ApiStandardErrors()
  async trigger(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TriggerEmergencyDto,
  ): Promise<PatientEmergencyView> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.emergency.trigger(user, patientId, dto);
  }

  /**
   * Fetched before anything is wrong, so the card is already on the device.
   *
   * The moment it is needed is the moment the connection is least likely to
   * cooperate — a patient in an ambulance, on a foreign network, on one bar.
   */
  @Get('guidance')
  @RequirePermissions('self.read')
  @ApiOperation({ summary: 'What to do until we reach you, and the local number to dial' })
  @ApiOkResponse({ type: EmergencyGuidanceDto })
  @ApiStandardErrors()
  async guidance(@CurrentUser() user: AuthenticatedUser): Promise<EmergencyGuidance> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.emergency.guidanceFor(user, patientId);
  }

  @Get('active')
  @RequirePermissions('self.read')
  @ApiOperation({ summary: 'Your open call, if you have one' })
  @ApiOkResponse({ type: PatientEmergencyViewDto })
  @ApiStandardErrors()
  async active(@CurrentUser() user: AuthenticatedUser): Promise<PatientEmergencyView | null> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.emergency.activeFor(user, patientId);
  }

  @Patch(':emergencyId/cancel')
  @RequirePermissions('self.emergency')
  @ApiOperation({ summary: 'I pressed it by accident — only until someone picks it up' })
  @ApiOkResponse({ type: EmergencyEventDto })
  @ApiStandardErrors()
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('emergencyId', ParseUUIDPipe) emergencyId: string,
  ): Promise<EmergencyEvent> {
    return this.emergency.cancel(user, emergencyId);
  }
}

@ApiTags('emergency')
@ApiBearerAuth()
@Controller('emergency')
export class EmergencyController {
  constructor(private readonly emergency: EmergencyService) {}

  @Get()
  @RequirePermissions('emergency.receive')
  @ApiOperation({ summary: 'Open calls, longest waiting first' })
  @ApiOkResponse({ type: [StaffEmergencyViewDto] })
  @ApiStandardErrors()
  async queue(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmergencyQueueQueryDto,
  ): Promise<StaffEmergencyView[]> {
    return this.emergency.queue(user, query.includeClosed ?? false);
  }

  /**
   * The break-glass read. While the call is open this answers for any patient,
   * assigned or not, and writes an `EMERGENCY_ACCESS` line saying who looked.
   */
  @Get(':emergencyId')
  @RequirePermissions('emergency.receive')
  @ApiOperation({ summary: 'One call, with the clinical summary needed to act on it' })
  @ApiOkResponse({ type: StaffEmergencyViewDto })
  @ApiStandardErrors()
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('emergencyId', ParseUUIDPipe) emergencyId: string,
  ): Promise<StaffEmergencyView> {
    return this.emergency.detail(user, emergencyId);
  }

  @Patch(':emergencyId/acknowledge')
  @RequirePermissions('emergency.receive')
  @ApiOperation({ summary: 'I have this — stops the escalation and tells the patient' })
  @ApiOkResponse({ type: StaffEmergencyViewDto })
  @ApiStandardErrors()
  async acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('emergencyId', ParseUUIDPipe) emergencyId: string,
  ): Promise<StaffEmergencyView> {
    return this.emergency.acknowledge(user, emergencyId);
  }

  @Patch(':emergencyId/resolve')
  @RequirePermissions('emergency.resolve')
  @ApiOperation({ summary: 'Close the call with a resolution note' })
  @ApiOkResponse({ type: StaffEmergencyViewDto })
  @ApiStandardErrors()
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('emergencyId', ParseUUIDPipe) emergencyId: string,
    @Body() dto: ResolveEmergencyDto,
  ): Promise<StaffEmergencyView> {
    return this.emergency.resolve(user, emergencyId, dto.resolution, dto.falseAlarm ?? false);
  }
}
