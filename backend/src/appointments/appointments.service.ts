import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  AuditAction,
  AvailabilityWindow,
  Role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/templates';
import { dueReminders, overlaps, withinAvailability } from './booking';
import { buildCalendar } from './ics';

export interface BookInput {
  staffId?: string;
  type: AppointmentType;
  scheduledAt: Date;
  durationMinutes?: number;
  location?: string;
  note?: string;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Books an appointment.
   *
   * A patient's booking arrives as a request; staff booking on a patient's
   * behalf is already confirmed. The clinic has agreed to its own calendar and
   * the patient has not been agreed to yet — spec M10 calls this the approval
   * flow, and collapsing it would put strangers straight into a doctor's day.
   */
  async book(
    user: AuthenticatedUser,
    patientId: string,
    input: BookInput,
  ): Promise<Appointment> {
    await this.access.assertCanAccess(user, patientId);

    if (Number.isNaN(input.scheduledAt.getTime())) {
      throw new BadRequestException('A valid date is required');
    }

    if (input.scheduledAt.getTime() < Date.now()) {
      // Booking into the past is always a mistake, and one that shows up later
      // as an appointment nobody can attend.
      throw new BadRequestException('An appointment cannot be booked in the past');
    }

    const duration = input.durationMinutes ?? 30;
    const slot = { startsAt: input.scheduledAt, durationMinutes: duration };

    if (input.staffId) {
      await this.assertBookable(input.staffId, slot);
    }

    const requesting = user.role === Role.PATIENT || user.role === Role.CAREGIVER;

    const appointment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          patientId,
          staffId: input.staffId,
          type: input.type,
          scheduledAt: input.scheduledAt,
          durationMinutes: duration,
          location: input.location?.slice(0, 200),
          note: input.note?.slice(0, 1000),
          status: requesting ? AppointmentStatus.REQUESTED : AppointmentStatus.CONFIRMED,
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.CREATE,
        entityType: 'appointments',
        entityId: created.id,
        patientId,
        after: created,
      });

      return created;
    });

    return appointment;
  }

  /** A clinician accepting a patient's request. */
  async confirm(user: AuthenticatedUser, appointmentId: string): Promise<Appointment> {
    const existing = await this.findInScope(user, appointmentId);

    if (existing.status !== AppointmentStatus.REQUESTED) {
      throw new BadRequestException(`This appointment is already ${existing.status.toLowerCase()}`);
    }

    // Re-checked at confirmation, not only at request: the doctor's calendar
    // may have filled in between, and confirming into a clash is how two
    // patients arrive for the same slot.
    if (existing.staffId) {
      await this.assertBookable(
        existing.staffId,
        { startsAt: existing.scheduledAt, durationMinutes: existing.durationMinutes },
        existing.id,
      );
    }

    return this.update(user, existing, { status: AppointmentStatus.CONFIRMED });
  }

  /**
   * Moves an appointment.
   *
   * The reminders already sent are cleared, because they described a time that
   * is no longer the time: a patient told "tomorrow" for an appointment that
   * has moved needs telling again.
   */
  async reschedule(
    user: AuthenticatedUser,
    appointmentId: string,
    scheduledAt: Date,
  ): Promise<Appointment> {
    const existing = await this.findInScope(user, appointmentId);

    if (existing.status === AppointmentStatus.CANCELLED) {
      throw new BadRequestException('A cancelled appointment cannot be moved');
    }

    if (scheduledAt.getTime() < Date.now()) {
      throw new BadRequestException('An appointment cannot be moved into the past');
    }

    if (existing.staffId) {
      await this.assertBookable(
        existing.staffId,
        { startsAt: scheduledAt, durationMinutes: existing.durationMinutes },
        existing.id,
      );
    }

    return this.update(user, existing, { scheduledAt, remindersSent: [] });
  }

  async cancel(
    user: AuthenticatedUser,
    appointmentId: string,
    reason?: string,
  ): Promise<Appointment> {
    const existing = await this.findInScope(user, appointmentId);

    if (existing.status === AppointmentStatus.CANCELLED) {
      throw new BadRequestException('This appointment is already cancelled');
    }

    return this.update(user, existing, {
      status: AppointmentStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledReason: reason?.slice(0, 500),
    });
  }

  /** A patient's appointments, soonest first. */
  async forPatient(user: AuthenticatedUser, patientId: string): Promise<Appointment[]> {
    await this.access.assertCanAccess(user, patientId);

    return this.prisma.appointment.findMany({
      where: { patientId },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  /** A clinician's own calendar for a window of days. */
  async calendar(
    user: AuthenticatedUser,
    from: Date,
    to: Date,
  ): Promise<Appointment[]> {
    const scope = await this.access.scopeFilter(user);

    return this.prisma.appointment.findMany({
      where: {
        patient: scope,
        scheduledAt: { gte: from, lte: to },
        status: { not: AppointmentStatus.CANCELLED },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  /**
   * The patient's appointments as an iCalendar file (spec M10).
   *
   * Generated on request rather than stored: an appointment that moves must not
   * leave a stale file behind, and the patient's calendar app re-reads this by
   * the appointment's own id.
   */
  async calendarFile(user: AuthenticatedUser, patientId: string): Promise<string> {
    const appointments = await this.forPatient(user, patientId);

    return buildCalendar(
      appointments.map((appointment) => ({
        appointment,
        summary: this.summaryFor(appointment.type),
      })),
    );
  }

  async availabilityFor(staffId: string): Promise<AvailabilityWindow[]> {
    return this.prisma.availabilityWindow.findMany({ where: { staffId } });
  }

  /**
   * Sends the reminders that have come due (spec M10: T-7d, T-1d, T-2h).
   *
   * Which ones have gone is recorded on the appointment rather than inferred
   * from the clock: a worker that restarts would otherwise send them again, and
   * one that was down over the moment would skip them.
   */
  async sendDueReminders(now = new Date()): Promise<number> {
    const upcoming = await this.prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.CONFIRMED,
        scheduledAt: { gt: now, lte: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000) },
      },
      include: { patient: { select: { userId: true } } },
      take: 500,
    });

    let sent = 0;

    for (const appointment of upcoming) {
      const due = dueReminders(appointment.scheduledAt, appointment.remindersSent, now);
      if (due.length === 0) continue;

      if (appointment.patient.userId) {
        await this.notifications.dispatch({
          userId: appointment.patient.userId,
          type: NOTIFICATION_TYPES.appointmentReminder,
          data: { appointmentId: appointment.id, scheduledAt: appointment.scheduledAt },
        });
      }

      // Recorded whether or not the patient has an account: otherwise the sweep
      // reconsiders the same appointment every run until it happens.
      await this.prisma.appointment.update({
        where: { id: appointment.id },
        data: { remindersSent: { push: due } },
      });

      sent += 1;
    }

    if (sent > 0) {
      this.logger.log(`Sent reminders for ${sent} appointment(s)`);
    }

    return sent;
  }

  /**
   * Refuses a slot the clinic has not offered, or has already filled.
   *
   * Availability first: telling someone the slot is taken when the doctor does
   * not work then sends them looking for another time on a day that has none.
   */
  private async assertBookable(
    staffId: string,
    slot: { startsAt: Date; durationMinutes: number },
    ignoreId?: string,
  ): Promise<void> {
    const windows = await this.prisma.availabilityWindow.findMany({ where: { staffId } });

    if (!withinAvailability(slot, windows)) {
      throw new ConflictException({
        message: 'OUTSIDE_AVAILABILITY',
        detail: 'That time is outside the published hours',
      });
    }

    // A day either side, so an appointment that starts before the slot and runs
    // into it is still considered.
    const sameDay = await this.prisma.appointment.findMany({
      where: {
        staffId,
        id: ignoreId ? { not: ignoreId } : undefined,
        status: { in: [AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED] },
        scheduledAt: {
          gte: new Date(slot.startsAt.getTime() - 24 * 60 * 60 * 1000),
          lte: new Date(slot.startsAt.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });

    const clash = sameDay.find((existing) =>
      overlaps(slot, {
        startsAt: existing.scheduledAt,
        durationMinutes: existing.durationMinutes,
      }),
    );

    if (clash) {
      throw new ConflictException({
        message: 'SLOT_TAKEN',
        detail: 'That time is already booked',
        conflictsWith: clash.id,
      });
    }
  }

  private async update(
    user: AuthenticatedUser,
    existing: Appointment,
    data: Parameters<PrismaService['appointment']['update']>[0]['data'],
  ): Promise<Appointment> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({ where: { id: existing.id }, data });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'appointments',
        entityId: existing.id,
        patientId: existing.patientId,
        before: existing,
        after: updated,
      });

      return updated;
    });
  }

  private summaryFor(type: AppointmentType): string {
    const names: Record<AppointmentType, string> = {
      CONSULTATION: 'Muayene',
      SURGERY: 'Ameliyat',
      CONTROL: 'Kontrol',
      VIDEO_CALL: 'Video görüşme',
    };

    return names[type];
  }

  /** Out of scope reads as absent, never as forbidden. */
  private async findInScope(
    user: AuthenticatedUser,
    appointmentId: string,
  ): Promise<Appointment> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    await this.access.assertCanAccess(user, appointment.patientId);

    return appointment;
  }
}
