import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [
    AppConfigModule,
    InfraModule,
    // Application-level rate limiting. Cloudflare handles edge WAF and volumetric
    // limits; this protects specific endpoints (login, OTP) from abuse that gets
    // past the edge. See docs/SUNUCU-NOTLARI.md.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
