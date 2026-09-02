import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, FollowUpMilestone } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireAnyPermission, RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { MeasurementsService } from '../measurements/measurements.service';
import {
  FollowUpScheduleDto,
  GenerateScheduleDto,
  MilestoneDto,
  SetMilestoneStatusDto,
} from './dto/followup.dto';
import { FollowUpService, ScheduleWithMilestones } from './followup.service';

@ApiTags('follow-up')
@ApiBearerAuth()
@Controller('patients/:id/follow-up')
export class PatientFollowUpController {
  constructor(private readonly followUp: FollowUpService) {}

  /**
   * Generates the schedule from the operation date.
   *
   * A POST rather than a PUT even though it replaces: what it does is produce a
   * schedule, and calling it again after a postponement is the normal way to
   * move one.
   */
  @Post()
  @RequirePermissions('appointments.write')
  @ApiOperation({ summary: 'Generate the check-up schedule from the operation date' })
  @ApiCreatedResponse({ type: FollowUpScheduleDto })
  @ApiStandardErrors()
  async generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Body() dto: GenerateScheduleDto,
  ): Promise<ScheduleWithMilestones> {
    return this.followUp.generate(user, patientId, dto);
  }

  @Get()
  @RequirePermissions('appointments.read')
  @Audit({ entityType: 'follow_up_schedules', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: "The patient's check-up schedule" })
  @ApiOkResponse({ type: FollowUpScheduleDto, description: 'Null when none has been generated' })
  @ApiStandardErrors()
  async forPatient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<ScheduleWithMilestones | null> {
    return this.followUp.forPatient(user, patientId);
  }
}

@ApiTags('follow-up')
@ApiBearerAuth()
@Controller('follow-up/milestones')
export class MilestonesController {
  constructor(private readonly followUp: FollowUpService) {}

  @Patch(':milestoneId')
  @RequirePermissions('appointments.write')
  @ApiOperation({ summary: 'Mark a check-up attended, skipped or missed' })
  @ApiOkResponse({ type: MilestoneDto })
  @ApiStandardErrors()
  async setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: SetMilestoneStatusDto,
  ): Promise<FollowUpMilestone> {
    return this.followUp.setStatus(user, milestoneId, dto.status);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/follow-up')
export class MyFollowUpController {
  constructor(
    private readonly followUp: FollowUpService,
    private readonly measurements: MeasurementsService,
  ) {}

  /**
   * The patient's own schedule.
   *
   * Its own route because the staff one needs appointments.read, and giving
   * that to patients would put every patient's calendar within reach.
   */
  @Get()
  @RequireAnyPermission('self.read')
  @ApiOperation({ summary: 'Your check-up dates' })
  @ApiOkResponse({ type: FollowUpScheduleDto })
  @ApiStandardErrors()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<ScheduleWithMilestones | null> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.followUp.forPatient(user, patientId);
  }
}
