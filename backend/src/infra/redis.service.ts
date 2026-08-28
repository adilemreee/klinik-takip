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

      // With retries unbounded, an unreachable Redis would leave every command
      // pending forever — and the permission cache sits on the request path,
      // so that means hanging requests rather than a degraded service.
      //
      // enableOfflineQueue: false is the part that actually prevents it.
      // commandTimeout alone does not help, because while disconnected ioredis
      // parks commands in an offline queue that the timeout does not govern.
      // For a cache, failing immediately is right: PermissionsService falls
      // back to the database.
      //
      // The BullMQ connection added in T3.2 needs its own client with the
      // offline queue enabled — a worker should wait for Redis to come back
      // rather than drop jobs.
      connectTimeout: 5_000,
      commandTimeout: 3_000,
      enableOfflineQueue: false,
    });

    this.client.on('error', (err: Error) => this.logger.error(`Redis error: ${err.message}`));
  }

  /**
   * Resolves once the connection is usable.
   *
   * With the offline queue disabled, a command issued before the socket is
   * ready fails immediately. Application code is fine with that — it falls back
   * to the database — but anything that genuinely needs Redis (a maintenance
   * task, a test fixture) should wait rather than race the connection.
   */
  async waitUntilReady(timeoutMs = 5_000): Promise<void> {
    if (this.client.status === 'ready') {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        this.client.off('ready', onReady);
      };
      const onReady = (): void => {
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Redis was not ready within ${timeoutMs}ms`));
      }, timeoutMs);

      this.client.once('ready', onReady);
    });
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
    // quit() sends a command, which rejects if the client never connected — and
    // an unhandled rejection during shutdown turns a clean stop into a crash.
    // Tear the socket down directly in that case.
    if (this.client.status !== 'ready') {
      this.client.disconnect();
      return;
    }

    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn(`Redis did not close cleanly: ${String(error)}`);
      this.client.disconnect();
    }
  }
}
