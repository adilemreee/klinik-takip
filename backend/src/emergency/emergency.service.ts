import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  EmergencyEvent,
  EmergencyStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PermissionsService } from '../authz/permissions.service';
import { PrismaService } from '../infra/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES, type NotificationType } from '../notifications/templates';
import {
  ESCALATION_LADDER,
  dueEscalation,
  escalationChain,
  sanitiseLocation,
  type CareTeam,
} from './escalation';
import { buildGuidance, type EmergencyGuidance } from './guidance';

/** Anyone holding this may open an open emergency, assigned to them or not. */
const RECEIVE = 'emergency.receive';

export interface TriggerInput {
  latitude?: number | null;
  longitude?: number | null;
  note?: string | null;
}

/**
 * What a clinician needs on the screen in the first five seconds.
 *
 * Not a patient file — a card. Blood type and allergies before anything else,
 * because those are the two facts that change what an ambulance crew does.
 */
export interface EmergencySummary {
  patientId: string;
  mrn: string;
  fullName: string;
  age: number | null;
  sex: string;
  country: string;
  city: string | null;
  phone: string | null;
  preferredLanguage: string;
  bloodType: string | null;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  lastSurgery: { procedureName: string; performedAt: Date; daysAgo: number } | null;
  assignedDoctor: string | null;
}

export interface StaffEmergencyView {
  event: EmergencyEvent;
  summary: EmergencySummary;
  /** Minutes from the button to the first answer, or to now while waiting. */
  waitingMinutes: number;
  responseMinutes: number | null;
  /**
   * The ladder ran out and still nobody has answered. Not a state the spec
   * defines an action for, which is exactly why it has to be visible: the
   * alternative is an alarm that quietly stops making noise at five minutes.
   */
  unanswered: boolean;
}

export interface PatientEmergencyView {
  event: EmergencyEvent;
  guidance: EmergencyGuidance;
  /** True when this call was already open and the button was pressed again. */
  alreadyOpen: boolean;
}

const OPEN_STATUSES: EmergencyStatus[] = [
  EmergencyStatus.TRIGGERED,
  EmergencyStatus.ACKNOWLEDGED,
];

@Injectable()
export class EmergencyService {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The button.
   *
   * Everything about this method is arranged so that it finishes: the location
   * is optional, the note is optional, an invalid coordinate is dropped rather
   * than refused, and a failure to notify anyone still leaves the event on
   * record. The one thing that may stop it is not being allowed to touch the
   * patient at all.
   */
  async trigger(
    user: AuthenticatedUser,
    patientId: string,
    input: TriggerInput,
  ): Promise<PatientEmergencyView> {
    await this.access.assertCanAccess(user, patientId);

    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: { country: true, preferredLanguage: true },
    });

    const guidance = buildGuidance(patient.country, patient.preferredLanguage);

    /**
     * Pressing twice does not start a second alarm.
     *
     * A patient in trouble presses the button again when nothing visibly
     * happens, and a flaky connection retries the request on its own. Two
     * events would mean two escalation ladders, and the second one keeps
     * climbing after somebody has already answered the first.
     */
    const open = await this.prisma.emergencyEvent.findFirst({
      where: { patientId, status: { in: OPEN_STATUSES } },
      orderBy: { triggeredAt: 'desc' },
    });

    if (open) {
      return { event: open, guidance, alreadyOpen: true };
    }

    const location = sanitiseLocation(input.latitude, input.longitude);

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.emergencyEvent.create({
        data: {
          patientId,
          status: EmergencyStatus.TRIGGERED,
          latitude: location ? new Prisma.Decimal(location.latitude) : null,
          longitude: location ? new Prisma.Decimal(location.longitude) : null,
          note: input.note?.trim().slice(0, 1000) || null,
          escalationLevel: 0,
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.CREATE,
        entityType: 'emergency_events',
        entityId: created.id,
        patientId,
        after: created,
      });

      return created;
    });

    // Outside the transaction: the alarm being raised must not depend on the
    // notification fan-out succeeding, and the fan-out must not hold a write
    // lock open while it talks to a push gateway.
    await this.alert(event, 0).catch((error: unknown) => {
      this.logger.error(`Emergency ${event.id} was recorded but not announced: ${String(error)}`);
    });

    return { event, guidance, alreadyOpen: false };
  }

  /** The card, without pressing anything — so it renders instantly when they do. */
  async guidanceFor(user: AuthenticatedUser, patientId: string): Promise<EmergencyGuidance> {
    await this.access.assertCanAccess(user, patientId);

    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: { country: true, preferredLanguage: true },
    });

    return buildGuidance(patient.country, patient.preferredLanguage);
  }

  /** The patient's own open call, if there is one. */
  async activeFor(user: AuthenticatedUser, patientId: string): Promise<PatientEmergencyView | null> {
    await this.access.assertCanAccess(user, patientId);

    const event = await this.prisma.emergencyEvent.findFirst({
      where: { patientId, status: { in: OPEN_STATUSES } },
      orderBy: { triggeredAt: 'desc' },
    });

    if (!event) return null;

    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: { country: true, preferredLanguage: true },
    });

    return {
      event,
      guidance: buildGuidance(patient.country, patient.preferredLanguage),
      alreadyOpen: true,
    };
  }

  /**
   * "I pressed it by accident."
   *
   * Allowed only while nobody has answered yet. Once a clinician has picked it
   * up they may well be on the phone to the patient, and letting the record
   * close underneath them would leave the person who is handling it looking at
   * an event that says it never happened.
   */
  async cancel(user: AuthenticatedUser, eventId: string): Promise<EmergencyEvent> {
    const existing = await this.findForPatient(user, eventId);

    if (existing.status !== EmergencyStatus.TRIGGERED) {
      throw new BadRequestException('Someone is already handling this call');
    }

    return this.close(user, existing, EmergencyStatus.FALSE_ALARM, 'Cancelled by the patient');
  }

  /**
   * The clinician's queue: every open call, longest waiting first.
   *
   * Scoped by `emergency.receive` rather than by assignment — see `detail`.
   */
  async queue(user: AuthenticatedUser, includeClosed = false): Promise<StaffEmergencyView[]> {
    const canReceive = await this.permissions.has(user.id, user.role, RECEIVE);

    if (!canReceive) {
      throw new ForbiddenException('You are not on the emergency rota');
    }

    const events = await this.prisma.emergencyEvent.findMany({
      where: includeClosed ? {} : { status: { in: OPEN_STATUSES } },
      orderBy: { triggeredAt: 'asc' },
      take: 200,
    });

    return Promise.all(events.map((event) => this.staffView(event)));
  }

  /**
   * One call, with the summary a clinician needs to act on it.
   *
   * **This is the break-glass read.** Everywhere else in this system, a nurse
   * who is not assigned to a patient is told the patient does not exist — and
   * that is right, because the alternative leaks the caseload. Here it is
   * wrong: the ladder's last rung is everyone who can receive an alert
   * precisely because the assigned nurse may be off shift, and waking someone
   * who is then shown a 404 is worse than not waking them.
   *
   * So the widening is deliberate, and it is fenced:
   *   - only `emergency.receive`, so no patient and no finance account;
   *   - only while the call is open, so it does not become a standing door;
   *   - a summary, not the file — no documents, no photos, no message history;
   *   - written to the audit log under its own action, so "who opened a file
   *     they were not assigned to" is a query rather than an archaeology dig.
   */
  async detail(user: AuthenticatedUser, eventId: string): Promise<StaffEmergencyView> {
    const canReceive = await this.permissions.has(user.id, user.role, RECEIVE);

    if (!canReceive) {
      throw new ForbiddenException('You are not on the emergency rota');
    }

    const event = await this.prisma.emergencyEvent.findUnique({ where: { id: eventId } });

    if (!event) {
      throw new NotFoundException('Emergency not found');
    }

    const assigned = await this.access.canAccess(user, event.patientId);
    const open = OPEN_STATUSES.includes(event.status);

    if (!assigned && !open) {
      // A closed call is history, and history goes back to ordinary scoping.
      throw new NotFoundException('Emergency not found');
    }

    const view = await this.staffView(event);

    if (!assigned) {
      await this.audit.record({
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.EMERGENCY_ACCESS,
        entityType: 'emergency_events',
        entityId: event.id,
        patientId: event.patientId,
        // What was disclosed, so the entry answers the question it will be read
        // with: not only that someone broke glass, but onto what.
        after: event,
      });
    }

    return view;
  }

  /**
   * Somebody has it.
   *
   * This is the moment the ladder stops climbing, so it is also the moment the
   * patient is told — they have been staring at a screen with no idea whether
   * anyone saw it.
   */
  async acknowledge(user: AuthenticatedUser, eventId: string): Promise<StaffEmergencyView> {
    const canReceive = await this.permissions.has(user.id, user.role, RECEIVE);

    if (!canReceive) {
      throw new ForbiddenException('You are not on the emergency rota');
    }

    const existing = await this.prisma.emergencyEvent.findUnique({ where: { id: eventId } });

    if (!existing) {
      throw new NotFoundException('Emergency not found');
    }

    if (existing.status !== EmergencyStatus.TRIGGERED) {
      throw new BadRequestException('This call has already been picked up');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.emergencyEvent.update({
        where: { id: eventId },
        data: {
          status: EmergencyStatus.ACKNOWLEDGED,
          acknowledgedById: user.id,
          acknowledgedAt: new Date(),
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'emergency_events',
        entityId: eventId,
        patientId: existing.patientId,
        before: existing,
        after: row,
      });

      return row;
    });

    await this.tellPatient(updated).catch((error: unknown) => {
      this.logger.error(`Could not tell the patient about ${eventId}: ${String(error)}`);
    });

    return this.staffView(updated);
  }

  /**
   * Closing it, with the note the spec asks for.
   *
   * Resolving one nobody acknowledged also stamps the acknowledgement, for the
   * same reason it does on complications: a clinician who dealt with it in one
   * step did answer, and leaving the field empty corrupts the only number this
   * feature produces.
   */
  async resolve(
    user: AuthenticatedUser,
    eventId: string,
    resolution: string,
    falseAlarm = false,
  ): Promise<StaffEmergencyView> {
    const canResolve = await this.permissions.has(user.id, user.role, 'emergency.resolve');

    if (!canResolve) {
      throw new ForbiddenException('You may not close emergencies');
    }

    const existing = await this.prisma.emergencyEvent.findUnique({ where: { id: eventId } });

    if (!existing) {
      throw new NotFoundException('Emergency not found');
    }

    if (!OPEN_STATUSES.includes(existing.status)) {
      throw new BadRequestException('This call is already closed');
    }

    const note = resolution.trim();

    if (note.length === 0) {
      // The spec asks for a resolution note, and the reason is the review a
      // month later: "resolved" with no words is a row nobody can learn from.
      throw new BadRequestException('Say how this was resolved');
    }

    const closed = await this.close(
      user,
      existing,
      falseAlarm ? EmergencyStatus.FALSE_ALARM : EmergencyStatus.RESOLVED,
      note,
    );

    return this.staffView(closed);
  }

  /**
   * The ladder's clock.
   *
   * Runs on a sweep rather than a per-event timer: a timer lives in one
   * process's memory, and the process that holds it is exactly the thing that
   * restarts at 3am.
   */
  async escalateDue(now = new Date()): Promise<{ escalated: number }> {
    const waiting = await this.prisma.emergencyEvent.findMany({
      where: { status: EmergencyStatus.TRIGGERED },
      orderBy: { triggeredAt: 'asc' },
      take: 100,
    });

    let escalated = 0;

    for (const event of waiting) {
      const level = dueEscalation(event.triggeredAt, event.escalationLevel, now);

      if (level === null) continue;

      // Recorded whether or not there was anyone on the rung: the level means
      // "this step of the ladder has been taken", and a step onto an empty rung
      // is still a step. Without it the sweep would re-examine the same event
      // every thirty seconds for as long as it stays open.
      await this.prisma.emergencyEvent.update({
        where: { id: event.id },
        data: { escalationLevel: level },
      });

      const alerted = await this.alert(event, level).catch((error: unknown) => {
        this.logger.error(`Escalation ${level} for ${event.id} failed: ${String(error)}`);
        return 0;
      });

      if (alerted > 0) escalated += 1;
    }

    return { escalated };
  }

  /** Notifies one rung of the ladder. Returns how many people it reached. */
  private async alert(event: EmergencyEvent, level: number): Promise<number> {
    const chain = await this.chainFor(event.patientId);

    if (chain.length === 0) {
      // Not a data problem — a configuration one. Nobody in the clinic holds
      // `emergency.receive`, so the button reaches no one at all.
      this.logger.error(
        `Emergency ${event.id}: no account can receive an emergency alert. Nobody was told.`,
      );
      return 0;
    }

    const rung = chain[level];

    if (!rung || rung.length === 0) {
      // A short chain that has run out. The event stays open and the queue
      // still shows it; there is simply nobody further up to wake.
      return 0;
    }

    const type: NotificationType =
      level === 0 ? NOTIFICATION_TYPES.emergencyTriggered : NOTIFICATION_TYPES.emergencyEscalated;

    const patient = await this.prisma.patient.findUnique({
      where: { id: event.patientId },
      select: { firstName: true, lastName: true, mrn: true },
    });

    const created = [];

    for (const userId of rung) {
      const notification = await this.notifications.dispatch({
        userId,
        type,
        data: {
          emergencyId: event.id,
          patientId: event.patientId,
          patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
          mrn: patient?.mrn ?? null,
          triggeredAt: event.triggeredAt,
          escalationLevel: level,
        },
      });

      if (notification) created.push(notification);
    }

    // Sent here rather than left for the delivery sweep: thirty seconds is a
    // quarter of the time the first rung gets.
    await this.notifications.deliverNow(created);

    return created.length;
  }

  /** Tells the patient somebody picked up. */
  private async tellPatient(event: EmergencyEvent): Promise<void> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: event.patientId },
      select: { userId: true },
    });

    if (!patient?.userId) return;

    const notification = await this.notifications.dispatch({
      userId: patient.userId,
      type: NOTIFICATION_TYPES.emergencyAcknowledged,
      data: { emergencyId: event.id },
    });

    if (notification) await this.notifications.deliverNow([notification]);
  }

  /** The care team, resolved to user ids, in ladder order. */
  private async chainFor(patientId: string): Promise<string[][]> {
    const [patient, assignments, receivers] = await Promise.all([
      this.prisma.patient.findUnique({
        where: { id: patientId },
        select: { assignedDoctor: { select: { userId: true } } },
      }),
      this.prisma.patientAssignment.findMany({
        where: { patientId, unassignedAt: null },
        select: { role: true, staff: { select: { userId: true } } },
      }),
      this.permissions.usersWith(RECEIVE),
    ]);

    const team: CareTeam = {
      nurses: assignments.filter((a) => a.role === Role.NURSE).map((a) => a.staff.userId),
      coordinators: assignments
        .filter((a) => a.role === Role.COORDINATOR)
        .map((a) => a.staff.userId),
      doctorUserId: patient?.assignedDoctor?.userId ?? null,
      receivers,
    };

    return escalationChain(team);
  }

  private async close(
    user: AuthenticatedUser,
    existing: EmergencyEvent,
    status: EmergencyStatus,
    resolution: string,
  ): Promise<EmergencyEvent> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.emergencyEvent.update({
        where: { id: existing.id },
        data: {
          status,
          resolvedById: user.id,
          resolvedAt: now,
          resolution: resolution.slice(0, 2000),
          acknowledgedById: existing.acknowledgedById ?? user.id,
          acknowledgedAt: existing.acknowledgedAt ?? now,
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'emergency_events',
        entityId: existing.id,
        patientId: existing.patientId,
        before: existing,
        after: row,
      });

      return row;
    });
  }

  /** A patient touching their own call: ordinary scoping, no break-glass. */
  private async findForPatient(
    user: AuthenticatedUser,
    eventId: string,
  ): Promise<EmergencyEvent> {
    const event = await this.prisma.emergencyEvent.findUnique({ where: { id: eventId } });

    if (!event) {
      throw new NotFoundException('Emergency not found');
    }

    await this.access.assertCanAccess(user, event.patientId);

    return event;
  }

  private async staffView(event: EmergencyEvent): Promise<StaffEmergencyView> {
    const summary = await this.summaryFor(event.patientId);
    const reference = event.acknowledgedAt ?? new Date();
    const waitingMs = reference.getTime() - event.triggeredAt.getTime();
    const ladderMinutes = ESCALATION_LADDER[ESCALATION_LADDER.length - 1]!.afterMinutes;

    return {
      event,
      summary,
      waitingMinutes: Math.max(0, Math.round(waitingMs / 60_000)),
      responseMinutes: event.acknowledgedAt
        ? Math.max(0, Math.round((event.acknowledgedAt.getTime() - event.triggeredAt.getTime()) / 60_000))
        : null,
      unanswered:
        event.status === EmergencyStatus.TRIGGERED &&
        Date.now() - event.triggeredAt.getTime() >= ladderMinutes * 60_000,
    };
  }

  private async summaryFor(patientId: string): Promise<EmergencySummary> {
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: {
        id: true,
        mrn: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        sex: true,
        country: true,
        city: true,
        preferredLanguage: true,
        user: { select: { phone: true } },
        assignedDoctor: { select: { firstName: true, lastName: true, title: true } },
        medicalProfile: {
          select: {
            bloodType: true,
            allergies: true,
            chronicConditions: true,
            currentMedications: true,
          },
        },
        surgeries: { orderBy: { performedAt: 'desc' }, take: 1 },
      },
    });

    const surgery = patient.surgeries[0] ?? null;
    const doctor = patient.assignedDoctor;

    return {
      patientId: patient.id,
      mrn: patient.mrn,
      fullName: `${patient.firstName} ${patient.lastName}`,
      age: this.ageFrom(patient.birthDate),
      sex: patient.sex,
      country: patient.country,
      city: patient.city,
      phone: patient.user?.phone ?? null,
      preferredLanguage: patient.preferredLanguage,
      bloodType: patient.medicalProfile?.bloodType ?? null,
      allergies: patient.medicalProfile?.allergies ?? [],
      chronicConditions: patient.medicalProfile?.chronicConditions ?? [],
      currentMedications: patient.medicalProfile?.currentMedications ?? [],
      lastSurgery: surgery
        ? {
            procedureName: surgery.procedureName,
            performedAt: surgery.performedAt,
            daysAgo: Math.max(
              0,
              Math.floor((Date.now() - surgery.performedAt.getTime()) / 86_400_000),
            ),
          }
        : null,
      assignedDoctor: doctor
        ? [doctor.title, doctor.firstName, doctor.lastName].filter(Boolean).join(' ')
        : null,
    };
  }

  private ageFrom(birthDate: Date): number | null {
    const now = new Date();
    let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
    const monthDelta = now.getUTCMonth() - birthDate.getUTCMonth();

    if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
      age -= 1;
    }

    return age >= 0 && age < 150 ? age : null;
  }
}
