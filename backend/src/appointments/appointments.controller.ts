import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Appointment, AuditAction } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { MeasurementsService } from '../measurements/measurements.service';
import { AppointmentsService } from './appointments.service';
import {
  AppointmentDto,
  BookAppointmentDto,
  CalendarQueryDto,
  CancelDto,
  RescheduleDto,
} from './dto/appointment.dto';

@ApiTags('appointments')
@ApiBearerAuth()
@Controller('patients/:id/appointments')
export class PatientAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post()
  @RequirePermissions('appointments.write')
  @ApiOperation({ summary: 'Book an appointment for a patient' })
  @ApiCreatedResponse({ type: AppointmentDto })
  @ApiStandardErrors()
  async book(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Body() dto: BookAppointmentDto,
  ): Promise<Appointment> {
    return this.appointments.book(user, patientId, dto);
  }

  @Get()
  @RequirePermissions('appointments.read')
  @Audit({ entityType: 'appointments', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: "A patient's appointments, soonest first" })
  @ApiOkResponse({ type: [AppointmentDto] })
  @ApiStandardErrors()
  async forPatient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<Appointment[]> {
    return this.appointments.forPatient(user, patientId);
  }
}

@ApiTags('appointments')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get('calendar')
  @RequirePermissions('appointments.read')
  @ApiOperation({ summary: 'The caller\'s calendar between two moments' })
  @ApiOkResponse({ type: [AppointmentDto] })
  @ApiStandardErrors()
  async calendar(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CalendarQueryDto,
  ): Promise<Appointment[]> {
    return this.appointments.calendar(user, query.from, query.to);
  }

  @Patch(':appointmentId/confirm')
  @RequirePermissions('appointments.write')
  @ApiOperation({ summary: "Accept a patient's request" })
  @ApiOkResponse({ type: AppointmentDto })
  @ApiStandardErrors()
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
  ): Promise<Appointment> {
    return this.appointments.confirm(user, appointmentId);
  }

  @Patch(':appointmentId/reschedule')
  @RequirePermissions('appointments.write')
  @ApiOperation({ summary: 'Move an appointment; its reminders start again' })
  @ApiOkResponse({ type: AppointmentDto })
  @ApiStandardErrors()
  async reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: RescheduleDto,
  ): Promise<Appointment> {
    return this.appointments.reschedule(user, appointmentId, dto.scheduledAt);
  }

  /**
   * Cancelling is open to the patient as well as to staff: someone who cannot
   * come should be able to say so without telephoning, which is the difference
   * between a cancelled slot and a no-show.
   */
  @Patch(':appointmentId/cancel')
  @RequireAnyPermission('appointments.write', 'self.write')
  @ApiOperation({ summary: 'Cancel an appointment' })
  @ApiOkResponse({ type: AppointmentDto })
  @ApiStandardErrors()
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CancelDto,
  ): Promise<Appointment> {
    return this.appointments.cancel(user, appointmentId, dto.reason);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/appointments')
export class MyAppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly measurements: MeasurementsService,
  ) {}

  @Get()
  @RequireAnyPermission('self.read')
  @ApiOperation({ summary: 'Your appointments, soonest first' })
  @ApiOkResponse({ type: [AppointmentDto] })
  @ApiStandardErrors()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<Appointment[]> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.appointments.forPatient(user, patientId);
  }

  @Post()
  @RequireAnyPermission('self.write')
  @ApiOperation({ summary: 'Request an appointment; the clinic confirms it' })
  @ApiCreatedResponse({ type: AppointmentDto })
  @ApiStandardErrors()
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BookAppointmentDto,
  ): Promise<Appointment> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.appointments.book(user, patientId, dto);
  }

  /**
   * The calendar file (spec M10).
   *
   * Served as a download rather than a link so it cannot be shared by accident:
   * a patient's appointments name their clinic, their doctor and their dates.
   */
  @Get('calendar.ics')
  @RequireAnyPermission('self.read')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="klinik-randevular.ics"')
  @ApiProduces('text/calendar')
  @ApiOperation({ summary: 'Your appointments as an iCalendar file' })
  @ApiOkResponse({ schema: { type: 'string' } })
  @ApiStandardErrors()
  async calendarFile(@CurrentUser() user: AuthenticatedUser): Promise<string> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.appointments.calendarFile(user, patientId);
  }
}
