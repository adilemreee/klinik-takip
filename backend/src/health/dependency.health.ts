import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { StorageService } from '../infra/storage.service';

/**
 * Readiness checks for the three backing services the API cannot serve
 * without. Failures report the reason but never the connection string.
 */
@Injectable()
export class DependencyHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async checkDatabase(key = 'database'): Promise<HealthIndicatorResult> {
    return this.run(key, () => this.prisma.ping());
  }

  async checkRedis(key = 'redis'): Promise<HealthIndicatorResult> {
    return this.run(key, () => this.redis.ping());
  }

  async checkStorage(key = 'storage'): Promise<HealthIndicatorResult> {
    return this.run(key, () => this.storage.ping());
  }

  private async run(key: string, probe: () => Promise<void>): Promise<HealthIndicatorResult> {
    const indicator = this.health.check(key);
    const startedAt = Date.now();

    try {
      await probe();
      return indicator.up({ responseTimeMs: Date.now() - startedAt });
    } catch (error) {
      return indicator.down({
        responseTimeMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
