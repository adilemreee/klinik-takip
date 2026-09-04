import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.schema';
import { documentIntake, uploadSweep } from './documents/document-intake.processor';
import { ResumableUploadService } from './documents/resumable-upload.service';
import { appointmentReminders } from './appointments/appointments.processor';
import { AppointmentsService } from './appointments/appointments.service';
import { briefingSweep } from './briefing/briefing.processor';
import { medicationSweep } from './medications/medications.processor';
import { BriefingService } from './briefing/briefing.service';
import { emergencyEscalation } from './emergency/emergency.processor';
import { exportRender, exportSweep } from './exports/exports.processor';
import { ExportsService } from './exports/exports.service';
import { PatientListBuilder } from './exports/patient-list.builder';
import { PatientSummaryBuilder } from './exports/patient-summary.builder';
import { surveySeed, surveySweep } from './surveys/surveys.processor';
import { SurveysService } from './surveys/surveys.service';
import { EmergencyService } from './emergency/emergency.service';
import { followUpSweep } from './followup/followup.processor';
import { FollowUpService } from './followup/followup.service';
import { LabService } from './lab/lab.service';
import { messageRelease } from './messaging/messaging.processor';
import { messageTriage } from './triage/triage.processor';
import { TriageService } from './triage/triage.service';
import { notificationDelivery } from './notifications/notifications.processor';
import { NotificationsService } from './notifications/notifications.service';
import { MessagingService } from './messaging/messaging.service';
import { documentOcr } from './ocr/ocr.processor';
import { TesseractEngine } from './ocr/tesseract.engine';
import { FileService } from './files/file.service';
import { CareTeamService } from './authz/care-team.service';
import { PermissionsService } from './authz/permissions.service';
import { PrismaService } from './infra/prisma.service';
import { StorageService } from './infra/storage.service';
import { initErrorReporting } from './observability/error-reporting';
import { queueDepth, registerDefaultMetrics } from './observability/metrics';
import { startMetricsServer } from './observability/metrics.server';
import { runWorker } from './queue/job-runner';
import { JOBS, QUEUES } from './queue/queue.constants';
import { QueueService } from './queue/queue.service';
import { auditPartitionSweep } from './audit/audit-partitions';
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
  const emergency = app.get(EmergencyService);
  const triage = app.get(TriageService);
  const briefing = app.get(BriefingService);
  const permissions = app.get(PermissionsService);
  const careTeam = app.get(CareTeamService);
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
      [JOBS.emergencyEscalation]: emergencyEscalation(emergency),
      [JOBS.briefingSweep]: briefingSweep(prisma, permissions, briefing, notifications),
      [JOBS.medicationSweep]: medicationSweep(prisma, careTeam, notifications),
      [JOBS.surveySweep]: surveySweep(prisma, app.get(SurveysService), notifications),
      [JOBS.auditPartitionSweep]: auditPartitionSweep(prisma),
    },
    connection: queues.connection,
    prisma,
    concurrency: 1,
  });

  const exportsWorker = runWorker({
    queue: QUEUES.exports,
    handlers: {
      [JOBS.exportRender]: exportRender({
        prisma,
        exports: app.get(ExportsService),
        summaries: app.get(PatientSummaryBuilder),
        lists: app.get(PatientListBuilder),
        files,
        notifications,
        permissions,
        clinicName: config.get<string>('CLINIC_NAME') ?? 'Klinik Takip',
      }),
      [JOBS.exportSweep]: exportSweep(app.get(ExportsService)),
    },
    connection: queues.connection,
    prisma,
    // One at a time: rendering holds a whole PDF and its photographs in memory,
    // and nobody is waiting on the second one any sooner.
    concurrency: 1,
  });

  const triageWorker = runWorker({
    queue: QUEUES.triage,
    handlers: { [JOBS.messageTriage]: messageTriage(prisma, triage) },
    connection: queues.connection,
    prisma,
    // Two at a time: these wait on a provider rather than on this process, and
    // a queue of patient messages waiting to be read is the thing to avoid.
    concurrency: 2,
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
  // Every thirty seconds. The first rung of the escalation ladder is two
  // minutes away, and a sweep on a one-minute cadence would spend half of that
  // window deciding whether to look.
  await queues.schedule(QUEUES.notifications, JOBS.emergencyEscalation, 30 * 1000);
  // Hourly, and it fires on the one hour that is eight o'clock in the clinic. A
  // UTC cron would drift by an hour twice a year.
  await queues.schedule(QUEUES.notifications, JOBS.briefingSweep, 60 * 60 * 1000);
  // Every five minutes: a dose reminder that arrives twenty minutes late is a
  // patient taking their antibiotic twenty minutes late, and the sweep looks
  // back far enough that a restart does not swallow one.
  await queues.schedule(QUEUES.notifications, JOBS.medicationSweep, 5 * 60 * 1000);
  // Daily. Expiry is measured in days, and a file that outlives its week by a
  // few hours is not the risk — one that outlives it by a month is.
  await queues.schedule(QUEUES.exports, JOBS.exportSweep, 24 * 60 * 60 * 1000);
  // Hourly. A questionnaire is a date, not a moment: an hour late asking about
  // last week costs nothing, and asking twice costs the patient's attention.
  await queues.schedule(QUEUES.notifications, JOBS.surveySweep, 60 * 60 * 1000);
  // Daily rather than monthly: a worker that happened to be restarting at
  // midnight on the 1st must not be the reason a year of audit history ends up
  // in one heap.
  await queues.schedule(QUEUES.notifications, JOBS.auditPartitionSweep, 24 * 60 * 60 * 1000);

  // The starter questionnaire, if it is not already there. Never an update:
  // a template version is frozen once anybody has answered it.
  await surveySeed(app.get(SurveysService))({} as never);

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
    await triageWorker.close();
    await exportsWorker.close();
    await notificationWorker.close();
    await app.close();
  };

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  logger.log(
    `Worker started — consuming ${QUEUES.documents}, ${QUEUES.messaging}, ` +
      `${QUEUES.triage} and ${QUEUES.notifications}`,
  );
}

void bootstrap();
