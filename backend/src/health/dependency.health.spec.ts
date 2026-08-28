import { Test } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { DependencyHealthIndicator } from './dependency.health';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { StorageService } from '../infra/storage.service';

describe('DependencyHealthIndicator', () => {
  let indicator: DependencyHealthIndicator;
  let prisma: { ping: jest.Mock };
  let redis: { ping: jest.Mock };
  let storage: { ping: jest.Mock };

  beforeEach(async () => {
    prisma = { ping: jest.fn().mockResolvedValue(undefined) };
    redis = { ping: jest.fn().mockResolvedValue(undefined) };
    storage = { ping: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DependencyHealthIndicator,
        HealthIndicatorService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    indicator = moduleRef.get(DependencyHealthIndicator);
  });

  it('reports the database as up when the probe succeeds', async () => {
    const result = await indicator.checkDatabase();

    expect(result.database?.status).toBe('up');
    expect(prisma.ping).toHaveBeenCalledTimes(1);
  });

  it('reports down instead of throwing when a dependency is unreachable', async () => {
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await indicator.checkRedis();

    expect(result.redis?.status).toBe('down');
    expect(result.redis?.message).toBe('ECONNREFUSED');
  });

  it('reports storage down when a bucket is missing', async () => {
    storage.ping.mockRejectedValue(new Error('Bucket not found: klinik-photos'));

    const result = await indicator.checkStorage();

    expect(result.storage?.status).toBe('down');
    expect(result.storage?.message).toMatch(/Bucket not found/);
  });

  it('records how long each probe took', async () => {
    const result = await indicator.checkDatabase();

    expect(result.database?.responseTimeMs).toEqual(expect.any(Number));
  });
});
