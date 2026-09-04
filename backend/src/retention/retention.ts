import { Logger } from '@nestjs/common';
import type { PrismaService } from '../infra/prisma.service';
import type { JobHandler } from '../queue/job-runner';

/**
 * Destroying what has outlived its purpose (KVKK m.7, spec §8).
 *
 * Writing the retention policy turned up that nothing enforced it: soft deletes
 * accumulated, expired upload sessions stayed, and a clinic with a written
 * destruction schedule it does not run is in a worse position than one with no
 * schedule at all — it has a documented undertaking it is breaching.
 *
 * Three things this deliberately does **not** touch, and each omission is the
 * point rather than an oversight:
 *
 *   - **Clinical records.** Medical data has a statutory minimum retention that
 *     outlives any purpose test, and it is far longer than anything here. A
 *     sweep that deleted a patient file because nobody opened it would destroy
 *     evidence a clinic is required to keep.
 *   - **Audit logs.** The table is append-only by database trigger, and its
 *     expiry is a partition drop, not a delete. Row-by-row deletion in an audit
 *     log defeats the log.
 *   - **Consents.** Withdrawal is forward-only; proving a consent existed while
 *     it was relied on is the controller's burden, and a deleted row proves
 *     nothing.
 *
 * What is left is genuine housekeeping: things whose only purpose was
 * short-lived, and which say so in their own schema.
 */

/** Half-finished uploads. The client resumes for a week or it never will. */
const UPLOAD_SESSION_DAYS = 7;

/** AI job records: for debugging and cost, never a clinical decision. */
const AI_JOB_DAYS = 90;

/** Rendered exports. A signed URL outlives its file by design, not the reverse. */
const EXPORT_DAYS = 30;

/** Delivered notifications. The history screen looks back months, not years. */
const NOTIFICATION_DAYS = 365;

/** Device sessions whose refresh token chain ended long ago. */
const DEVICE_SESSION_DAYS = 90;

export interface RetentionOutcome {
  uploadSessions: number;
  aiJobs: number;
  exports: number;
  notifications: number;
  deviceSessions: number;
}

const daysAgo = (days: number, now: Date): Date =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

/**
 * Runs the sweep and reports what it destroyed.
 *
 * Returned rather than only logged so the caller — and the test — can see the
 * counts. "The sweep ran" is not the same claim as "the sweep destroyed
 * nothing because there was nothing to destroy".
 */
export async function sweepExpired(
  prisma: PrismaService,
  now: Date = new Date(),
): Promise<RetentionOutcome> {
  const [uploadSessions, aiJobs, exportRows, notifications, deviceSessions] = await Promise.all([
    prisma.uploadSession.deleteMany({
      where: { createdAt: { lt: daysAgo(UPLOAD_SESSION_DAYS, now) } },
    }),
    prisma.aiJob.deleteMany({
      where: { createdAt: { lt: daysAgo(AI_JOB_DAYS, now) } },
    }),
    prisma.export.deleteMany({
      where: { createdAt: { lt: daysAgo(EXPORT_DAYS, now) } },
    }),
    prisma.notification.deleteMany({
      where: { createdAt: { lt: daysAgo(NOTIFICATION_DAYS, now) } },
    }),
    // Revoked or expired, and old. A live session is never touched by age.
    prisma.deviceSession.deleteMany({
      where: {
        createdAt: { lt: daysAgo(DEVICE_SESSION_DAYS, now) },
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: now } }],
      },
    }),
  ]);

  return {
    uploadSessions: uploadSessions.count,
    aiJobs: aiJobs.count,
    exports: exportRows.count,
    notifications: notifications.count,
    deviceSessions: deviceSessions.count,
  };
}

export function retentionSweep(prisma: PrismaService): JobHandler {
  const logger = new Logger('Retention');

  return async (): Promise<void> => {
    const outcome = await sweepExpired(prisma);
    const total = Object.values(outcome).reduce((sum, count) => sum + count, 0);

    // Logged even when nothing was destroyed. A destruction schedule has to be
    // demonstrable, and "it ran and found nothing" is the evidence for the
    // months where that is the truth.
    logger.log(
      `Retention sweep: ${total} record(s) destroyed ` +
        `(uploads ${outcome.uploadSessions}, ai ${outcome.aiJobs}, ` +
        `exports ${outcome.exports}, notifications ${outcome.notifications}, ` +
        `sessions ${outcome.deviceSessions})`,
    );
  };
}
