import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { PrismaService } from '../infra/prisma.service';
import type { JobHandler } from '../queue/job-runner';
import type { TriageService } from './triage.service';

/**
 * Triage, off the request path (spec M4).
 *
 * A queued job rather than work inside `send`: the keyword screen is instant
 * but the model is not, and a patient watching a spinner while a provider
 * thinks about their message is a patient who presses send again. The message
 * is already stored and already delivered by the time this runs; what this adds
 * is the summary, the level, and — when it matters — waking somebody.
 */
export function messageTriage(prisma: PrismaService, triage: TriageService): JobHandler {
  const logger = new Logger('MessageTriage');

  return async (job: Job): Promise<void> => {
    const data = job.data as { jobId?: string };

    // The message id comes from the durable `jobs` row rather than the payload,
    // the same way the document pipeline reads its subject: the row is written
    // inside the transaction that created the message, so a job that exists at
    // all is one whose message definitely committed.
    const record = data.jobId
      ? await prisma.job.findUnique({ where: { id: data.jobId }, select: { entityId: true } })
      : null;

    const messageId = record?.entityId;

    if (!messageId) {
      logger.error('Triage job carries no message id');
      return;
    }

    await triage.triage(messageId);
  };
}
