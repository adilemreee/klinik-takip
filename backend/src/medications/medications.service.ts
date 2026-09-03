import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  Medication,
  MedicationLog,
  MedicationLogStatus,
  MedicationSource,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { localDate } from '../common/local-calendar';
import { PrismaService } from '../infra/prisma.service';
import {
  badgesFor,
  summarise,
  type Adherence,
  type BadgeId,
  type DoseLog,
} from './adherence';
import {
  MAX_OCCURRENCES,
  RecurrenceError,
  describe as describeRule,
  expand,
  parseRule,
} from './recurrence';

export interface PrescribeInput {
  drugName: string;
  dose: string;
  form?: string;
  frequencyRule: string;
  startDate: Date;
  endDate?: Date | null;
  instructions?: string;
  /** Wall-clock time of the first dose, in the patient's zone. */
  startTime?: string;
  timezone?: string;
}

export interface MedicationView {
  medication: Medication;
  /** The rule in a sentence, so a clinician can check what they wrote. */
  schedule: string;
  adherence: Adherence;
  /** Never shown while a course is doing badly — see `MyMedications`. */
  badges: BadgeId[];
  /** The next dose still ahead, if there is one. */
  nextDose: Date | null;
}

export interface MyMedications {
  medications: MedicationView[];
  /** Today's doses, in order, for the check-in screen. */
  today: MedicationLog[];
  overall: Adherence;
  badges: BadgeId[];
}

/** How far from its scheduled time a dose may be marked and still count as on time. */
const ON_TIME_MINUTES = 60;

@Injectable()
export class MedicationsService {
  private readonly logger = new Logger(MedicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * A clinician writing a prescription (spec M9).
   *
   * The schedule is generated here rather than computed on every read: a
   * patient needs to see the same times tomorrow that the app showed them
   * today, and a dose has to be a row before it can be marked, reminded about
   * or counted.
   */
  async prescribe(
    user: AuthenticatedUser,
    patientId: string,
    input: PrescribeInput,
  ): Promise<MedicationView> {
    await this.access.assertCanAccess(user, patientId);

    const staff = await this.prisma.staffProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });

    const medication = await this.create(user, patientId, input, {
      source: MedicationSource.PRESCRIBED,
      prescriberId: staff?.id ?? null,
      approvedById: user.id,
      approvedAt: new Date(),
    });

    return this.view(medication);
  }

  /**
   * A patient adding something they are already taking (spec M9).
   *
   * Recorded but inert: no schedule, no reminders, no adherence. Generating a
   * calendar from an unapproved entry would have the app reminding somebody to
   * take a drug no clinician has seen — and counting them down for missing it.
   */
  async report(
    user: AuthenticatedUser,
    patientId: string,
    input: PrescribeInput,
  ): Promise<MedicationView> {
    await this.access.assertCanAccess(user, patientId);

    const medication = await this.create(user, patientId, input, {
      source: MedicationSource.PATIENT_REPORTED,
      prescriberId: null,
      approvedById: null,
      approvedAt: null,
      skipSchedule: true,
    });

    return this.view(medication);
  }

  /** A clinician approving a patient-reported drug; the schedule starts here. */
  async approve(user: AuthenticatedUser, medicationId: string): Promise<MedicationView> {
    const existing = await this.findInScope(user, medicationId);

    if (existing.approvedAt) {
      throw new BadRequestException('This medication has already been approved');
    }

    const doses = this.schedule(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.medication.update({
        where: { id: medicationId },
        data: { approvedById: user.id, approvedAt: new Date() },
      });

      await tx.medicationLog.createMany({
        data: doses.map((scheduledAt) => ({ medicationId, scheduledAt })),
        skipDuplicates: true,
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'medications',
        entityId: medicationId,
        patientId: existing.patientId,
        before: { approvedAt: existing.approvedAt },
        after: { approvedAt: row.approvedAt, doses: doses.length },
      });

      return row;
    });

    return this.view(updated);
  }

  /**
   * Stopping a course.
   *
   * Doses still ahead are removed, doses already past are kept. The past is the
   * record of what the patient actually did, and deleting it would rewrite an
   * adherence score that a clinical decision may have been made on.
   */
  async stop(user: AuthenticatedUser, medicationId: string): Promise<MedicationView> {
    const existing = await this.findInScope(user, medicationId);

    if (existing.stoppedAt) {
      throw new BadRequestException('This medication is already stopped');
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.medication.update({
        where: { id: medicationId },
        data: { stoppedAt: now },
      });

      await tx.medicationLog.deleteMany({
        where: {
          medicationId,
          scheduledAt: { gt: now },
          status: MedicationLogStatus.PENDING,
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'medications',
        entityId: medicationId,
        patientId: existing.patientId,
        after: { stoppedAt: now },
      });

      return row;
    });

    return this.view(updated);
  }

  /** A patient marking a dose: taken, skipped, or later (spec M9). */
  async checkIn(
    user: AuthenticatedUser,
    logId: string,
    action: 'taken' | 'skipped' | 'snooze',
    snoozeMinutes = 60,
  ): Promise<MedicationLog> {
    const log = await this.prisma.medicationLog.findUnique({
      where: { id: logId },
      include: { medication: { select: { patientId: true } } },
    });

    if (!log) {
      throw new NotFoundException('Dose not found');
    }

    await this.access.assertCanAccess(user, log.medication.patientId);

    if (log.status === MedicationLogStatus.TAKEN || log.status === MedicationLogStatus.LATE) {
      throw new BadRequestException('This dose is already marked as taken');
    }

    const now = new Date();

    if (action === 'snooze') {
      return this.prisma.medicationLog.update({
        where: { id: logId },
        data: {
          status: MedicationLogStatus.SNOOZED,
          snoozedUntil: new Date(now.getTime() + snoozeMinutes * 60_000),
          // Cleared so the reminder goes again when the snooze runs out.
          notifiedAt: null,
        },
      });
    }

    if (action === 'skipped') {
      return this.prisma.medicationLog.update({
        where: { id: logId },
        data: { status: MedicationLogStatus.SKIPPED, snoozedUntil: null },
      });
    }

    /**
     * Late is recorded as late rather than as taken.
     *
     * It still counts for adherence — a patient who took the eight o'clock dose
     * at eleven took it — but a clinician looking at an antibiotic course needs
     * to be able to see that the doses drifted.
     */
    const late =
      Math.abs(now.getTime() - log.scheduledAt.getTime()) > ON_TIME_MINUTES * 60_000;

    return this.prisma.medicationLog.update({
      where: { id: logId },
      data: {
        status: late ? MedicationLogStatus.LATE : MedicationLogStatus.TAKEN,
        takenAt: now,
        snoozedUntil: null,
      },
    });
  }

  /** The clinician's view of one patient's medication and how it is going. */
  async forPatient(user: AuthenticatedUser, patientId: string): Promise<MedicationView[]> {
    await this.access.assertCanAccess(user, patientId);

    const medications = await this.prisma.medication.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(medications.map((medication) => this.view(medication)));
  }

  /**
   * The patient's own screen.
   *
   * Badges are withheld while a course is going badly. M9 asks for restraint,
   * and a "three day streak" card over a list of missed doses is the app being
   * pleased with itself at somebody having a hard week.
   */
  async mine(user: AuthenticatedUser, patientId: string, now = new Date()): Promise<MyMedications> {
    await this.access.assertCanAccess(user, patientId);

    const medications = await this.prisma.medication.findMany({
      where: { patientId, stoppedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const views = await Promise.all(medications.map((medication) => this.view(medication)));

    const logs = await this.prisma.medicationLog.findMany({
      where: { medication: { patientId } },
      orderBy: { scheduledAt: 'asc' },
    });

    const timezone = medications[0]?.timezone ?? 'Europe/Istanbul';
    const overall = summarise(logs.map(toDoseLog), now, timezone);
    const today = localDate(now, timezone);

    return {
      medications: views,
      today: logs.filter((log) => sameDay(log.scheduledAt, today, timezone)),
      overall,
      badges: overall.score !== null && overall.score < 0.5 ? [] : badgesFor(overall),
    };
  }

  private async create(
    user: AuthenticatedUser,
    patientId: string,
    input: PrescribeInput,
    options: {
      source: MedicationSource;
      prescriberId: string | null;
      approvedById: string | null;
      approvedAt: Date | null;
      skipSchedule?: boolean;
    },
  ): Promise<Medication> {
    const [hour, minute] = parseTime(input.startTime ?? '09:00');
    const timezone = input.timezone ?? 'Europe/Istanbul';

    // Parsed before anything is written: a rule this system cannot read is one
    // the clinician has to fix now, not one that silently produces no doses.
    let rule;

    try {
      rule = parseRule(input.frequencyRule);
    } catch (error) {
      if (error instanceof RecurrenceError) throw new BadRequestException(error.message);
      throw error;
    }

    if (rule.count === null && rule.until === null && !input.endDate) {
      throw new BadRequestException(
        'A course needs an end: give the rule a COUNT or UNTIL, or set an end date',
      );
    }

    const doses = options.skipSchedule
      ? []
      : expand(rule, {
          start: localDate(input.startDate, timezone),
          startHour: hour,
          startMinute: minute,
          timezone,
          endsAt: input.endDate ?? null,
        });

    if (!options.skipSchedule && doses.length === 0) {
      throw new BadRequestException('That rule and those dates produce no doses');
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.medication.create({
        data: {
          patientId,
          drugName: input.drugName.trim().slice(0, 200),
          dose: input.dose.trim().slice(0, 100),
          form: input.form?.trim().slice(0, 100),
          frequencyRule: input.frequencyRule.trim(),
          timezone,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          instructions: input.instructions?.trim().slice(0, 1000),
          source: options.source,
          prescriberId: options.prescriberId,
          approvedById: options.approvedById,
          approvedAt: options.approvedAt,
        },
      });

      if (doses.length > 0) {
        await tx.medicationLog.createMany({
          data: doses.map((scheduledAt) => ({ medicationId: created.id, scheduledAt })),
          skipDuplicates: true,
        });
      }

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.CREATE,
        entityType: 'medications',
        entityId: created.id,
        patientId,
        after: {
          id: created.id,
          drugName: created.drugName,
          source: created.source,
          doses: doses.length,
        },
      });

      return created;
    });
  }

  /** Re-expands a medication's rule, for a course approved after the fact. */
  private schedule(medication: Medication): Date[] {
    const rule = parseRule(medication.frequencyRule);

    return expand(rule, {
      start: localDate(medication.startDate, medication.timezone),
      startHour: 9,
      startMinute: 0,
      timezone: medication.timezone,
      endsAt: medication.endDate,
    }).slice(0, MAX_OCCURRENCES);
  }

  private async view(medication: Medication): Promise<MedicationView> {
    const logs = await this.prisma.medicationLog.findMany({
      where: { medicationId: medication.id },
      orderBy: { scheduledAt: 'asc' },
    });

    const now = new Date();
    const adherence = summarise(logs.map(toDoseLog), now, medication.timezone);
    const next = logs.find(
      (log) => log.scheduledAt > now && log.status === MedicationLogStatus.PENDING,
    );

    let schedule = medication.frequencyRule;

    try {
      schedule = describeRule(parseRule(medication.frequencyRule));
    } catch {
      // A rule that no longer parses is still shown, as itself. Hiding it would
      // leave a clinician unable to see what is wrong with it.
    }

    return {
      medication,
      schedule,
      adherence,
      badges: badgesFor(adherence),
      nextDose: next?.scheduledAt ?? null,
    };
  }

  private async findInScope(user: AuthenticatedUser, medicationId: string): Promise<Medication> {
    const medication = await this.prisma.medication.findUnique({ where: { id: medicationId } });

    if (!medication) {
      throw new NotFoundException('Medication not found');
    }

    await this.access.assertCanAccess(user, medication.patientId);

    return medication;
  }
}

function toDoseLog(log: MedicationLog): DoseLog {
  return { scheduledAt: log.scheduledAt, status: log.status, takenAt: log.takenAt };
}

function sameDay(
  at: Date,
  day: { year: number; month: number; day: number },
  timezone: string,
): boolean {
  const other = localDate(at, timezone);

  return other.year === day.year && other.month === day.month && other.day === day.day;
}

function parseTime(value: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());

  if (!match) {
    throw new BadRequestException('The start time must look like 09:00');
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) {
    throw new BadRequestException('The start time must be a real time of day');
  }

  return [hour, minute];
}
