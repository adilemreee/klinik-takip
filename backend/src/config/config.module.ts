import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Env, validateEnv } from './env.schema';

/** Typed accessor so services never reach for a raw string key. */
export type TypedConfigService = ConfigService<Env, true>;

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // In Docker the environment is injected by compose; .env is a local
      // development convenience only.
      envFilePath: ['.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate: validateEnv,
      cache: true,
    }),
  ],
})
export class AppConfigModule {}
