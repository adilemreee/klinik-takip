import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { Env } from '../config/env.schema';
import { buildLoggerParams } from './logging.config';
import { MetricsInterceptor } from './metrics.interceptor';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildLoggerParams({
          APP_ENV: config.get('APP_ENV', { infer: true }),
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
          SERVICE_NAME: config.get('SERVICE_NAME', { infer: true }),
          LOKI_URL: config.get('LOKI_URL', { infer: true }),
        }),
    }),
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class ObservabilityModule {}
