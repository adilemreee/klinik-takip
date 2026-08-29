import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.schema';
import { documentIntake } from './documents/document-intake.processor';
import { FileService } from './files/file.service';
import { PrismaService } from './infra/prisma.service';
import { initErrorReporting } from './observability/error-reporting';
import { queueDepth, registerDefaultMetrics } from './observability/metrics';
import { startMetricsServer } from './observability/metrics.server';
import { runWorker } from './queue/job-runner';
import { JOBS, QUEUES } from './queue/queue.constants';
import { QueueService } from './queue/queue.service';

/**
 * Queue worker process. Runs the same codebase as the API but serves no HTTP.
 * Heavy work — OCR, AI analysis, PDF export, notification fan-out — happens
 * here so it never blocks a request (spec section 4).
 */
async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env);
  initErrorReporting(env);
  registerDefaultMetrics(`${env.SERVICE_NAME}-worker`);

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const logger = new Logger('Worker');

  // The worker serves no HTTP, but Prometheus still needs to see queue depth
  // and process health.
  startMetricsServer(env.METRICS_PORT);

  const queues = app.get(QueueService);
  const prisma = app.get(PrismaService);
  const files = app.get(FileService);

  const worker = runWorker({
    queue: QUEUES.documents,
    handlers: { [JOBS.documentIntake]: documentIntake(prisma, files) },
    connection: queues.connection,
    prisma,
  });

  // Jobs recorded but never dispatched — the process died between the commit
  // and the enqueue. Small window, real consequence: a document nobody ever
  // processes and nobody is told about.
  await queues.requeueStranded().catch((error: unknown) => {
    logger.error(`Could not sweep stranded jobs: ${String(error)}`);
  });

  // Sampled rather than updated per job: the numbers come from Redis, and a
  // round trip on every job completion would make the metric itself a cost on
  // the throughput it is measuring.
  const depthTimer = setInterval(() => {
    void queues
      .depth(QUEUES.documents)
      .then(({ waiting, active, failed }) => {
        queueDepth.set({ queue: QUEUES.documents, state: 'waiting' }, waiting);
        queueDepth.set({ queue: QUEUES.documents, state: 'active' }, active);
        queueDepth.set({ queue: QUEUES.documents, state: 'failed' }, failed);
      })
      .catch((error: unknown) => logger.warn(`Could not sample queue depth: ${String(error)}`));
  }, 15_000);
  depthTimer.unref();

  app.enableShutdownHooks();

  // Draining rather than dropping: a job killed mid-flight would be retried
  // from the start, and the row would sit at PROCESSING until it was.
  const shutdown = async (): Promise<void> => {
    logger.log('Draining the queue before exit');
    clearInterval(depthTimer);
    await worker.close();
    await app.close();
  };

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  logger.log(`Worker started — consuming ${QUEUES.documents}`);
}

void bootstrap();
