import { Logger } from '@nestjs/common';
import { SurveyStatus } from '@prisma/client';
import type { PrismaService } from '../infra/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/templates';
import type { JobHandler } from '../queue/job-runner';
import type { SurveysService } from './surveys.service';

/**
 * Asking, and giving up on asking (spec M18).
 *
 * One sweep does both because they read the same rows, and because the second
 * half is the part that is easy to leave out: a questionnaire that stays open
 * for ever eventually gets answered, months late, and lands on the chart at a
 * milestone it has nothing to do with.
 */
export function surveySweep(
  prisma: PrismaService,
  surveys: SurveysService,
  notifications: NotificationsService,
): JobHandler {
  const logger = new Logger('SurveySweep');

  return async (): Promise<void> => {
    const now = new Date();

    const asked = await askDue(prisma, notifications, now);
    const lapsed = await expireStale(prisma, now);

    if (asked > 0 || lapsed > 0) {
      logger.log(`${asked} questionnaire(s) sent, ${lapsed} expired`);
    }
  };
}

/**
 * Sends the ones that have come due.
 *
 * The row is marked before the notification is dispatched. The failure that
 * matters here is asking twice — a patient who gets the same questionnaire
 * every five minutes stops reading anything this app sends — and a
 * notification that was never delivered is recoverable in a way that a lost
 * patient's attention is not.
 */
async function askDue(
  prisma: PrismaService,
  notifications: NotificationsService,
  now: Date,
): Promise<number> {
  const due = await prisma.surveyAssignment.findMany({
    where: {
      status: SurveyStatus.PENDING,
      scheduledFor: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: { patient: { select: { userId: true } } },
    take: 200,
  });

  let sent = 0;

  for (const assignment of due) {
    await prisma.surveyAssignment.update({
      where: { id: assignment.id },
      data: { status: SurveyStatus.SENT, sentAt: now },
    });

    // A patient with no account yet cannot be asked. The assignment still
    // moves on, so it expires on schedule rather than waiting for ever.
    if (!assignment.patient.userId) continue;

    await notifications.dispatch({
      userId: assignment.patient.userId,
      type: NOTIFICATION_TYPES.surveyDue,
      data: { assignmentId: assignment.id, milestoneDays: assignment.milestoneDays },
    });

    sent += 1;
  }

  return sent;
}

/** Closes the window on the ones nobody answered. */
async function expireStale(prisma: PrismaService, now: Date): Promise<number> {
  const result = await prisma.surveyAssignment.updateMany({
    where: {
      status: { in: [SurveyStatus.PENDING, SurveyStatus.SENT] },
      expiresAt: { lt: now },
    },
    data: { status: SurveyStatus.EXPIRED },
  });

  return result.count;
}

/** Writes the starter questionnaire on worker start, if it is not there. */
export function surveySeed(surveys: SurveysService): JobHandler {
  return async (): Promise<void> => {
    await surveys.ensureStarterTemplates();
  };
}
