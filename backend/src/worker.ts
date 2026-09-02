import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.schema';
import { documentIntake, uploadSweep } from './documents/document-intake.processor';
import { ResumableUploadService } from './documents/resumable-upload.service';
import { appointmentReminders } from './appointments/appointments.processor';
import { AppointmentsService } from './appointments/appointments.service';
import { followUpSweep } from './followup/followup.processor';
import { FollowUpService } from './followup/followup.service';
import { LabService } from './lab/lab.service';
import { messageRelease } from './messaging/messaging.processor';
import { notificationDelivery } from './notifications/notifications.processor';
import { NotificationsService } from './notifications/notifications.service';
import { MessagingService } from './messaging/messaging.service';
import { documentOcr } from './ocr/ocr.processor';
import { TesseractEngine } from './ocr/tesseract.engine';
import { FileService } from './files/file.service';
import { PrismaService } from './infra/prisma.service';
import { StorageService } from './infra/storage.service';
import { initErrorReporting } from './observability/error-reporting';
import { queueDepth, registerDefaultMetrics } from './observability/metrics';
import { startMetricsServer } from './observability/metrics.server';
import { runWorker } from './queue/job-runner';
import { JOBS, QUEUES } from './queue/queue.constants';
import { QueueService } from './queue/queue.service';
import { attachWorkerLogging } from './worker-bootstrap';

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
  attachWorkerLogging(app);

  const logger = new Logger('Worker');

  // The worker serves no HTTP, but Prometheus still needs to see queue depth
  // and process health.
  startMetricsServer(env.METRICS_PORT);

  const queues = app.get(QueueService);
  const prisma = app.get(PrismaService);
  const files = app.get(FileService);
  const uploads = app.get(ResumableUploadService);
  const lab = app.get(LabService);
  const messaging = app.get(MessagingService);
  const notifications = app.get(NotificationsService);
  const followUp = app.get(FollowUpService);
  const appointments = app.get(AppointmentsService);
  const engine = app.get(TesseractEngine);
  const storage = app.get(StorageService);
  const config = app.get(ConfigService);

  const worker = runWorker({
    queue: QUEUES.documents,
    handlers: {
      [JOBS.documentIntake]: documentIntake(prisma, files, queues),
      [JOBS.uploadSweep]: uploadSweep(uploads),
      [JOBS.documentOcr]: documentOcr({
        prisma,
        files,
        storage,
        lab,
        engine,
        bucket: config.get<string>('S3_BUCKET_DOCUMENTS')!,
      }),
    },
    connection: queues.connection,
    prisma,
  });

  const messagingWorker = runWorker({
    queue: QUEUES.messaging,
    handlers: { [JOBS.messageRelease]: messageRelease(messaging) },
    connection: queues.connection,
    prisma,
    concurrency: 1,
  });

  const notificationWorker = runWorker({
    queue: QUEUES.notifications,
    handlers: {
      [JOBS.notificationDelivery]: notificationDelivery(notifications),
      [JOBS.followUpSweep]: followUpSweep(followUp),
      [JOBS.appointmentReminders]: appointmentReminders(appointments),
    },
    connection: queues.connection,
    prisma,
    concurrency: 1,
  });

  await queues.schedule(QUEUES.documents, JOBS.uploadSweep, 60 * 60 * 1000);
  // Every minute: the patient was promised a clock time, and 18:55 for a
  // message told it would go at 18:00 breaks the one assurance queueing gives.
  await queues.schedule(QUEUES.messaging, JOBS.messageRelease, 60 * 1000);
  // Every half minute: a critical lab value waiting a minute for its first send
  // is a minute nobody would defend afterwards.
  await queues.schedule(QUEUES.notifications, JOBS.notificationDelivery, 30 * 1000);
  await queues.schedule(QUEUES.notifications, JOBS.followUpSweep, 60 * 60 * 1000);
  await queues.schedule(QUEUES.notifications, JOBS.appointmentReminders, 10 * 60 * 1000);

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
    await messagingWorker.close();
    await notificationWorker.close();
    await app.close();
  };

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  logger.log(`Worker started — consuming ${QUEUES.documents}, ${QUEUES.messaging} and ${QUEUES.notifications}`);
}

void bootstrap();
