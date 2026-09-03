import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuditAction, MedicationLog } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { MeasurementsService } from '../measurements/measurements.service';
import {
  CheckInDto,
  MedicationLogDto,
  MedicationViewDto,
  MyMedicationsDto,
  PrescribeDto,
} from './dto/medication.dto';
import {
  MedicationsService,
  type MedicationView,
  type MyMedications,
} from './medications.service';

@ApiTags('medications')
@ApiBearerAuth()
@Controller('patients/:id/medications')
export class PatientMedicationsController {
  constructor(private readonly medications: MedicationsService) {}

  @Get()
  @RequirePermissions('medications.read')
  @Audit({ entityType: 'medications', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: "A patient's medication, with adherence" })
  @ApiOkResponse({ type: [MedicationViewDto] })
  @ApiStandardErrors()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<MedicationView[]> {
    return this.medications.forPatient(user, patientId);
  }

  /**
   * Writing a prescription (spec M9).
   *
   * The schedule is generated here and stored, so the patient sees the same
   * times tomorrow that the app showed them today.
   */
  @Post()
  @RequirePermissions('medications.prescribe')
  @ApiOperation({ summary: 'Prescribe, and generate the dose calendar from the rule' })
  @ApiCreatedResponse({ type: MedicationViewDto })
  @ApiStandardErrors()
  async prescribe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Body() dto: PrescribeDto,
  ): Promise<MedicationView> {
    return this.medications.prescribe(user, patientId, dto);
  }
}

@ApiTags('medications')
@ApiBearerAuth()
@Controller('medications')
export class MedicationsController {
  constructor(private readonly medications: MedicationsService) {}

  /** A clinician approving something the patient added; the schedule starts here. */
  @Patch(':medicationId/approve')
  @RequirePermissions('medications.approve')
  @ApiOperation({ summary: 'Approve a patient-reported medication' })
  @ApiOkResponse({ type: MedicationViewDto })
  @ApiStandardErrors()
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('medicationId', ParseUUIDPipe) medicationId: string,
  ): Promise<MedicationView> {
    return this.medications.approve(user, medicationId);
  }

  /** Doses ahead are dropped; doses past are kept, because they are the record. */
  @Patch(':medicationId/stop')
  @RequirePermissions('medications.prescribe')
  @ApiOperation({ summary: 'Stop a course' })
  @ApiOkResponse({ type: MedicationViewDto })
  @ApiStandardErrors()
  async stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('medicationId', ParseUUIDPipe) medicationId: string,
  ): Promise<MedicationView> {
    return this.medications.stop(user, medicationId);
  }
}

@ApiTags('medications')
@ApiBearerAuth()
@Controller('me/medications')
export class MyMedicationsController {
  constructor(
    private readonly medications: MedicationsService,
    private readonly measurements: MeasurementsService,
  ) {}

  @Get()
  @RequirePermissions('self.read')
  @ApiOperation({ summary: "Your medication, today's doses and how it is going" })
  @ApiOkResponse({ type: MyMedicationsDto })
  @ApiStandardErrors()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<MyMedications> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.medications.mine(user, patientId);
  }

  /**
   * Something the patient is already taking (spec M9).
   *
   * Recorded but inert until a clinician approves it: no schedule, no
   * reminders, nothing counted against them.
   */
  @Post()
  @RequirePermissions('self.write')
  @ApiOperation({ summary: 'Add a medication you are taking; a clinician approves it' })
  @ApiCreatedResponse({ type: MedicationViewDto })
  @ApiStandardErrors()
  async report(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PrescribeDto,
  ): Promise<MedicationView> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.medications.report(user, patientId, dto);
  }

  /** "İçtim" / "Atladım" / "Ertele", from the notification or the list. */
  @Patch('doses/:logId')
  @RequirePermissions('self.write')
  @ApiOperation({ summary: 'Mark a dose taken, skipped, or snoozed' })
  @ApiOkResponse({ type: MedicationLogDto })
  @ApiStandardErrors()
  async checkIn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('logId', ParseUUIDPipe) logId: string,
    @Body() dto: CheckInDto,
  ): Promise<MedicationLog> {
    return this.medications.checkIn(user, logId, dto.action, dto.snoozeMinutes ?? 60);
  }
}
