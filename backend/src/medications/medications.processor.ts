import { Logger } from '@nestjs/common';
import { MedicationLogStatus, MedicationSource } from '@prisma/client';
import type { PrismaService } from '../infra/prisma.service';
import type { CareTeamService } from '../authz/care-team.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/templates';
import type { JobHandler } from '../queue/job-runner';
import { needsAttention, needsRenewal, summarise } from './adherence';

/**
 * How far back the sweep looks for doses it has not reminded about.
 *
 * Wider than the sweep interval on purpose: a worker that was restarting when a
 * dose came due would otherwise skip that reminder entirely, and the patient
 * would never learn that the app had simply been down for a minute.
 */
const LOOKBACK_MINUTES = 30;

/**
 * Dose reminders, renewal reminders and the low-adherence warning (spec M9).
 *
 * One sweep for all three because they read the same rows, and because three
 * separate jobs waking on their own schedules would triple the queries to say
 * the same things.
 */
export function medicationSweep(
  prisma: PrismaService,
  careTeam: CareTeamService,
  notifications: NotificationsService,
): JobHandler {
  const logger = new Logger('MedicationSweep');

  return async (): Promise<void> => {
    const now = new Date();

    const reminded = await remindDueDoses(prisma, notifications, now);
    const warned = await warnAboutCourses(prisma, careTeam, notifications, now);

    if (reminded > 0 || warned > 0) {
      logger.log(`${reminded} dose reminder(s), ${warned} clinic warning(s)`);
    }
  };
}

/** "İlaç saatiniz" — one per dose, once. */
async function remindDueDoses(
  prisma: PrismaService,
  notifications: NotificationsService,
  now: Date,
): Promise<number> {
  const due = await prisma.medicationLog.findMany({
    where: {
      notifiedAt: null,
      status: { in: [MedicationLogStatus.PENDING, MedicationLogStatus.SNOOZED] },
      scheduledAt: {
        lte: now,
        gte: new Date(now.getTime() - LOOKBACK_MINUTES * 60_000),
      },
      // A snoozed dose waits until the patient said it should.
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      medication: { stoppedAt: null, approvedAt: { not: null } },
    },
    take: 200,
    include: {
      medication: {
        select: {
          drugName: true,
          dose: true,
          patient: { select: { userId: true } },
        },
      },
    },
  });

  const created = [];

  for (const log of due) {
    const userId = log.medication.patient.userId;

    // A patient with no account yet has nowhere to be reminded; the dose still
    // counts, and the clinic still sees it.
    if (!userId) continue;

    const notification = await notifications.dispatch({
      userId,
      type: NOTIFICATION_TYPES.medicationDue,
      data: {
        medicationLogId: log.id,
        drugName: log.medication.drugName,
        dose: log.medication.dose,
      },
    });

    if (notification) created.push(notification);

    // Stamped whether or not a notification was created: a patient who switched
    // this reminder off should not have the sweep reconsider it every minute.
    await prisma.medicationLog.update({
      where: { id: log.id },
      data: { notifiedAt: new Date() },
    });
  }

  await notifications.deliverNow(created);

  return created.length;
}

/**
 * The two things the clinic is told about (spec M9): a course running out, and
 * a course the patient is not keeping to.
 */
async function warnAboutCourses(
  prisma: PrismaService,
  careTeam: CareTeamService,
  notifications: NotificationsService,
  now: Date,
): Promise<number> {
  const medications = await prisma.medication.findMany({
    where: { stoppedAt: null, approvedAt: { not: null } },
    take: 500,
    include: {
      logs: { orderBy: { scheduledAt: 'asc' } },
      patient: { select: { id: true, userId: true } },
    },
  });

  let warnings = 0;

  for (const medication of medications) {
    const logs = medication.logs.map((log) => ({
      scheduledAt: log.scheduledAt,
      status: log.status,
      takenAt: log.takenAt,
    }));

    // The patient is told their prescription is running out; the clinic is told
    // the patient is not taking it. Two different problems, two audiences.
    if (needsRenewal(logs, now) && medication.patient.userId) {
      if (await notYetSaid(prisma, medication.patient.userId, NOTIFICATION_TYPES.medicationRenewal, medication.id)) {
        const notification = await notifications.dispatch({
          userId: medication.patient.userId,
          type: NOTIFICATION_TYPES.medicationRenewal,
          data: { medicationId: medication.id, drugName: medication.drugName },
        });

        if (notification) {
          await notifications.deliverNow([notification]);
          warnings += 1;
        }
      }
    }

    const adherence = summarise(logs, now, medication.timezone);

    if (!needsAttention(adherence)) continue;
    // Patient-reported drugs are not something the clinic prescribed, and a
    // warning about somebody not taking their own vitamins is noise.
    if (medication.source !== MedicationSource.PRESCRIBED) continue;

    /**
     * The people actually responsible, with no fallback to the whole rota.
     *
     * This is a pattern over days, not an emergency. A patient with nobody
     * assigned produces no warning here, and the answer to that is to assign
     * somebody — not to send the entire clinic a daily message about a patient
     * none of them are looking after.
     */
    for (const userId of await careTeam.assigned(medication.patient.id)) {
      if (!(await notYetSaid(prisma, userId, NOTIFICATION_TYPES.medicationAdherenceLow, medication.id))) {
        continue;
      }

      const notification = await notifications.dispatch({
        userId,
        type: NOTIFICATION_TYPES.medicationAdherenceLow,
        data: {
          medicationId: medication.id,
          patientId: medication.patient.id,
          drugName: medication.drugName,
          score: Math.round((adherence.score ?? 0) * 100),
        },
      });

      if (notification) {
        await notifications.deliverNow([notification]);
        warnings += 1;
      }
    }
  }

  return warnings;
}

/**
 * Once a day per medication, not once a sweep.
 *
 * A warning that arrives every five minutes is a warning somebody mutes, and
 * then the next one is muted too.
 */
async function notYetSaid(
  prisma: PrismaService,
  userId: string,
  type: string,
  medicationId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const existing = await prisma.notification.count({
    where: {
      userId,
      type,
      createdAt: { gte: since },
      data: { path: ['medicationId'], equals: medicationId },
    },
  });

  return existing === 0;
}
