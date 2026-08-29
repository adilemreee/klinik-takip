import { Logger } from '@nestjs/common';
import { ProcessingStatus } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { PrismaService } from '../infra/prisma.service';
import { JobName, QueueName } from './queue.constants';

export type JobHandler = (job: Job) => Promise<void>;

/**
 * What a failed attempt means for the durable record.
 *
 * While retries remain the row goes back to QUEUED, because that is what is
 * true: the work is still going to happen. Reporting FAILED on the first
 * stumble would have staff chasing a document that processes itself two
 * minutes later — and, worse, teach them to ignore the status.
 */
export function statusAfterFailure(
  attemptsMade: number,
  attemptsAllowed: number,
): ProcessingStatus {
  return attemptsMade >= attemptsAllowed ? ProcessingStatus.FAILED : ProcessingStatus.QUEUED;
}

export interface RunWorkerOptions {
  queue: QueueName;
  handlers: Partial<Record<JobName, JobHandler>>;
  connection: Redis;
  prisma: PrismaService;
  /** How many jobs this process runs at once. */
  concurrency?: number;
}

/**
 * The durable half of the job's life.
 *
 * Every processor is wrapped so the `jobs` row follows what actually happened,
 * rather than each handler remembering to update it — a handler that forgets
 * leaves a job stuck at QUEUED forever, and the symptom is a document that is
 * never processed and never reported as failed either.
 */
export function runWorker(options: RunWorkerOptions): Worker {
  const logger = new Logger(`Worker:${options.queue}`);
  const { prisma } = options;

  const worker = new Worker(
    options.queue,
    async (job: Job) => {
      const handler = options.handlers[job.name as JobName];

      if (!handler) {
        // A job nobody handles must not sit in the queue being retried: this is
        // a deployment mismatch, not a transient failure.
        logger.error(`No handler for ${options.queue}/${job.name} — marking it skipped`);
        await markStatus(prisma, job, ProcessingStatus.SKIPPED, 'No handler registered');
        return;
      }

      await touchStarted(prisma, job);
      await handler(job);
      await markStatus(prisma, job, ProcessingStatus.DONE);
    },
    {
      connection: options.connection,
      concurrency: options.concurrency ?? 4,
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) {
      logger.error(`Job failed before it could be read: ${error.message}`);
      return;
    }

    const attemptsAllowed = job.opts.attempts ?? 1;

    logger.error(
      `${options.queue}/${job.name} attempt ${job.attemptsMade}/${attemptsAllowed} failed: ${error.message}`,
    );

    void markStatus(
      prisma,
      job,
      statusAfterFailure(job.attemptsMade, attemptsAllowed),
      error.message,
    );
  });

  worker.on('error', (error) => logger.error(`Worker error: ${error.message}`));

  return worker;
}

/** The row id travels in the payload; without it there is nothing to update. */
function rowIdOf(job: Job): string | undefined {
  const data = job.data as { jobId?: unknown };
  return typeof data.jobId === 'string' ? data.jobId : undefined;
}

async function touchStarted(prisma: PrismaService, job: Job): Promise<void> {
  const id = rowIdOf(job);
  if (!id) return;

  await prisma.job.update({
    where: { id },
    data: {
      status: ProcessingStatus.PROCESSING,
      startedAt: new Date(),
      // attemptsMade counts completed attempts, so the one now running is the
      // next one.
      attempts: job.attemptsMade + 1,
      error: null,
    },
  });
}

async function markStatus(
  prisma: PrismaService,
  job: Job,
  status: ProcessingStatus,
  error?: string,
): Promise<void> {
  const id = rowIdOf(job);
  if (!id) return;

  const finished = status === ProcessingStatus.DONE ||
    status === ProcessingStatus.FAILED ||
    status === ProcessingStatus.SKIPPED;

  await prisma.job
    .update({
      where: { id },
      data: {
        status,
        // Truncated: a driver error can carry a whole query, and this column is
        // shown to staff.
        error: error?.slice(0, 500) ?? null,
        finishedAt: finished ? new Date() : null,
      },
    })
    .catch(() => undefined);
}
