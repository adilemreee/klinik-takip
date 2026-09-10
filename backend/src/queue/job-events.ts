import { Logger } from '@nestjs/common';
import { ProcessingStatus } from '@prisma/client';
import type Redis from 'ioredis';

/**
 * The channel the worker shouts down and the API listens on.
 *
 * They are separate processes — the worker has no socket server and the API
 * runs no jobs — so a status change reaches a screen the only way it can:
 * through the one thing both already talk to.
 */
export const JOB_EVENTS_CHANNEL = 'klinik:job-events';

/**
 * What a screen watching a job needs.
 *
 * Deliberately small. No file names, no patient name, no error detail beyond
 * what is already shown on the jobs list: this travels through Redis and lands
 * in a browser, and a channel that carried more than the screen needs would be
 * a second, quieter copy of the record.
 */
export interface JobEvent {
  jobId: string;
  patientId: string | null;
  entityType: string | null;
  entityId: string | null;
  queue: string;
  name: string;
  status: ProcessingStatus;
  /** Already truncated where it was written; nil unless the job failed. */
  error: string | null;
}

const logger = new Logger('JobEvents');

/**
 * Announces a job's new status.
 *
 * Never throws and never blocks the job: this is how a screen finds out
 * sooner, not how the work gets done. A publish that fails leaves the client
 * exactly where it was before any of this existed — polling, and correct.
 */
export async function publishJobEvent(redis: Redis, event: JobEvent): Promise<void> {
  try {
    await redis.publish(JOB_EVENTS_CHANNEL, JSON.stringify(event));
  } catch (error) {
    logger.warn(`Job event not published: ${String(error)}`);
  }
}

/** Reads one back. Nil for anything that is not a job event. */
export function parseJobEvent(payload: string): JobEvent | null {
  try {
    const parsed = JSON.parse(payload) as Partial<JobEvent>;

    if (
      typeof parsed.jobId !== 'string' ||
      typeof parsed.status !== 'string' ||
      // Checked against the enum, not merely "is a string": an unknown status
      // reaching a screen would colour a row by a state nobody defined.
      !Object.values(ProcessingStatus).includes(parsed.status)
    ) {
      return null;
    }

    return {
      jobId: parsed.jobId,
      patientId: typeof parsed.patientId === 'string' ? parsed.patientId : null,
      entityType: typeof parsed.entityType === 'string' ? parsed.entityType : null,
      entityId: typeof parsed.entityId === 'string' ? parsed.entityId : null,
      queue: typeof parsed.queue === 'string' ? parsed.queue : '',
      name: typeof parsed.name === 'string' ? parsed.name : '',
      status: parsed.status,
      error: typeof parsed.error === 'string' ? parsed.error : null,
    };
  } catch {
    return null;
  }
}
