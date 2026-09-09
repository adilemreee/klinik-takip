import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, type TravelPlan } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ClearToFlyDto, TravelPlanViewDto, UpsertTravelPlanDto } from './dto/travel.dto';
import { TravelService, type TravelPlanView } from './travel.service';

/**
 * The travel around an operation (spec M19).
 *
 * Guarded by `patients.*` rather than `medical.*` on purpose: a coordinator
 * books the hotel and meets the flight, and does not hold `medical.read`. The
 * one exception is the clearance to fly, which is a clinical judgement and
 * needs `medical.decide`.
 */
@ApiTags('travel')
@ApiBearerAuth()
@Controller('patients/:id/travel')
export class TravelController {
  constructor(private readonly travel: TravelService) {}

  @Get()
  @RequirePermissions('patients.read')
  @Audit({ entityType: 'travel_plans', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: "A patient's flights, hotel, transfer and interpreter" })
  @ApiOkResponse({ type: TravelPlanViewDto })
  @ApiStandardErrors()
  async forPatient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TravelPlanView> {
    return this.travel.forPatient(user, id);
  }

  @Put()
  @RequirePermissions('patients.write')
  @ApiOperation({ summary: 'Create or update the travel plan' })
  @ApiOkResponse({ type: TravelPlanViewDto })
  @ApiStandardErrors()
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertTravelPlanDto,
  ): Promise<TravelPlan> {
    const { expectedVersion, ...plan } = dto;

    return this.travel.upsert(user, id, plan, expectedVersion);
  }

  /**
   * Whether the patient may fly.
   *
   * `medical.decide`, not `patients.write`: a coordinator may move a hotel
   * booking and may not decide somebody is fit to sit on an aeroplane for four
   * hours after an abdominal operation.
   */
  @Patch('cleared-to-fly')
  @RequirePermissions('medical.decide')
  @ApiOperation({ summary: 'Record, or withdraw, a clinician’s clearance to fly' })
  @ApiOkResponse({ type: TravelPlanViewDto })
  @ApiStandardErrors()
  async clearToFly(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClearToFlyDto,
  ): Promise<TravelPlan> {
    return this.travel.setClearedToFly(user, id, dto.cleared);
  }
}

/// What the patient sees about their own trip.
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/travel')
export class MyTravelController {
  constructor(private readonly travel: TravelService) {}

  @Get()
  @RequirePermissions('self.read')
  @ApiOperation({ summary: 'Your flights, hotel, transfer and interpreter' })
  @ApiOkResponse({ type: TravelPlanViewDto })
  @ApiStandardErrors()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<TravelPlanView> {
    return this.travel.mine(user);
  }
}
