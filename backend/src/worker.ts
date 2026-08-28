import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.schema';
import { initErrorReporting } from './observability/error-reporting';
import { registerDefaultMetrics } from './observability/metrics';
import { startMetricsServer } from './observability/metrics.server';

/**
 * Queue worker process. Runs the same codebase as the API but serves no HTTP.
 * Heavy work — OCR, AI analysis, PDF export, notification fan-out — happens
 * here so it never blocks a request (spec section 4).
 *
 * Queue processors are registered in T3.2.
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

  app.enableShutdownHooks();
  logger.log('Worker started — no queues registered yet (T3.2)');
}

void bootstrap();
