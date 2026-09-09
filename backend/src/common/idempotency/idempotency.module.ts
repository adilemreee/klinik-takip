import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyService } from './idempotency.service';

/**
 * Registered globally so every write is covered, and imported early in
 * AppModule so it wraps the handlers rather than sitting inside them.
 */
@Module({
  providers: [IdempotencyService, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
