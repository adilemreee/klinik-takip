import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Queue worker process. Runs the same codebase as the API but serves no HTTP.
 * Heavy work — OCR, AI analysis, PDF export, notification fan-out — happens
 * here so it never blocks a request (spec section 4).
 *
 * Queue processors are registered in T3.2.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const logger = new Logger('Worker');

  app.enableShutdownHooks();
  logger.log('Worker started — no queues registered yet (T3.2)');
}

void bootstrap();
