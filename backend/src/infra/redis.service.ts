import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../config/env.schema';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      password: config.get('REDIS_PASSWORD', { infer: true }),
      // BullMQ requires this; keeping it here means one shared connection
      // policy for cache and queues.
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });

    this.client.on('error', (err: Error) => this.logger.error(`Redis error: ${err.message}`));
  }

  async ping(): Promise<void> {
    // ioredis types this as the literal 'PONG'. Widen it deliberately: the
    // readiness probe must react to what the server actually returns, not to
    // what the type definitions promise.
    const reply: string = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error(`Unexpected PING reply: ${reply}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
