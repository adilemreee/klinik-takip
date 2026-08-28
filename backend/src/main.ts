import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { Env, validateEnv } from './config/env.schema';
import { initErrorReporting } from './observability/error-reporting';
import { registerDefaultMetrics } from './observability/metrics';
import { startMetricsServer } from './observability/metrics.server';

async function bootstrap(): Promise<void> {
  // Before the application exists, so a failure during module init is reported.
  const env = validateEnv(process.env);
  initErrorReporting(env);
  registerDefaultMetrics(env.SERVICE_NAME);

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

  configureApp(app, config);

  // Separate listener, internal network only — never exposed through the tunnel.
  startMetricsServer(config.get('METRICS_PORT', { infer: true }));

  const port = config.get('PORT', { infer: true });

  // Bind to all interfaces INSIDE the container. The container port is only
  // reachable through the 127.0.0.1 host mapping — see docs/PORTS.md.
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on :${port} (${config.get('APP_ENV', { infer: true })})`);
}

void bootstrap();
