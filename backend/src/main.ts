import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

  configureApp(app, config);

  const port = config.get('PORT', { infer: true });

  // Bind to all interfaces INSIDE the container. The container port is only
  // reachable through the 127.0.0.1 host mapping — see docs/PORTS.md.
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on :${port} (${config.get('APP_ENV', { infer: true })})`);
}

void bootstrap();
