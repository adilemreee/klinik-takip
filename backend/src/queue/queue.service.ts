import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ProcessingStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Env } from '../config/env.schema';
import { PrismaService } from '../infra/prisma.service';
import { DEFAULT_JOB_OPTIONS, JobName, QueueName } from './queue.constants';

export interface JobSpec {
  queue: QueueName;
  name: JobName;
  /** Payload handed to the worker. Never carries file contents or secrets. */
  data: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  patientId?: string;
}

export interface EnqueueResult<T> {
  result: T;
  jobId: string;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();

  /**
   * A connection of its own, separate from the cache client.
   *
   * The cache client runs with `enableOfflineQueue: false` so a request never
   * hangs waiting for Redis. A queue wants the opposite: a worker should wait
   * for Redis to come back rather than drop the job it is holding.
   */
  readonly connection: Redis;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.connection = new Redis({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      password: config.get('REDIS_PASSWORD', { infer: true }),
      // Required by BullMQ: it blocks on commands that must not time out.
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });

    this.connection.on('error', (error: Error) =>
      this.logger.error(`Queue Redis error: ${error.message}`),
    );
  }

  /** Lazily created, so a process only opens the queues it actually uses. */
  queue(name: QueueName): Queue {
    const existing = this.queues.get(name);
    if (existing) {
      return existing;
    }

    const queue = new Queue(name, {
      connection: this.connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });

    this.queues.set(name, queue);
    return queue;
  }

  /**
   * Runs `work` in a transaction that also records the job, then dispatches it.
   *
   * The ordering is the whole point. Adding to the queue inside the transaction
   * would let a worker pick up a job for a document whose INSERT was rolled
   * back — it would chase a row that never existed. Dispatching after the
   * commit means the failure mode is instead a `jobs` row left at QUEUED with
   * nothing in Redis, which is visible, diagnosable and recoverable
   * (`requeueStranded`). Between the two, the recoverable one wins.
   */
  async enqueue<T>(
    spec: JobSpec,
    work: (tx: Prisma.TransactionClient, jobId: string) => Promise<T>,
  ): Promise<EnqueueResult<T>> {
    const { result, jobId } = await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          queue: spec.queue,
          name: spec.name,
          entityType: spec.entityType,
          entityId: spec.entityId,
          patientId: spec.patientId,
          status: ProcessingStatus.QUEUED,
        },
        select: { id: true },
      });

      return { result: await work(tx, job.id), jobId: job.id };
    });

    await this.dispatch(spec, jobId);

    return { result, jobId };
  }

  /**
   * Puts a recorded job onto its queue.
   *
   * A failure here is logged rather than thrown: the caller's change is already
   * committed, and turning a successful upload into a 500 because Redis blinked
   * would make the user upload the same file again. The row stays at QUEUED and
   * `requeueStranded` picks it up.
   */
  private async dispatch(spec: JobSpec, jobId: string): Promise<void> {
    try {
      await this.queue(spec.queue).add(spec.name, { ...spec.data, jobId }, { jobId });
      await this.prisma.job.update({ where: { id: jobId }, data: { externalId: jobId } });
    } catch (error) {
      this.logger.error(
        `Job ${jobId} (${spec.queue}/${spec.name}) was recorded but not dispatched: ${String(error)}`,
      );
    }
  }

  /**
   * Re-dispatches jobs that were recorded but never reached the queue.
   *
   * The window is small — between the commit and the `add` — but it is real,
   * and a document that silently never gets processed is exactly the kind of
   * failure nobody notices until a doctor asks for a result that is not there.
   * Run on worker start.
   */
  async requeueStranded(olderThanMs = 60_000): Promise<number> {
    const stranded = await this.prisma.job.findMany({
      where: {
        status: ProcessingStatus.QUEUED,
        externalId: null,
        createdAt: { lt: new Date(Date.now() - olderThanMs) },
      },
      take: 100,
    });

    let requeued = 0;

    for (const job of stranded) {
      try {
        await this.queue(job.queue as QueueName).add(
          job.name,
          { jobId: job.id, entityId: job.entityId, patientId: job.patientId },
          { jobId: job.id },
        );
        await this.prisma.job.update({
          where: { id: job.id },
          data: { externalId: job.id },
        });
        requeued += 1;
      } catch (error) {
        this.logger.error(`Could not requeue stranded job ${job.id}: ${String(error)}`);
      }
    }

    if (requeued > 0) {
      this.logger.warn(`Requeued ${requeued} stranded job(s)`);
    }

    return requeued;
  }

  /** Queue depth, for the metrics endpoint and for operators. */
  async depth(name: QueueName): Promise<{ waiting: number; active: number; failed: number }> {
    const queue = this.queue(name);

    const [waiting, active, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getFailedCount(),
    ]);

    return { waiting, active, failed };
  }

  async onModuleDestroy(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close();
    }

    this.connection.disconnect();
  }
}
