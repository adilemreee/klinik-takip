import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

/**
 * Boots the real application graph with the real global pipes and guards, only
 * stubbing the three network dependencies. Catches the failures unit tests
 * structurally cannot: missing peer dependencies, broken DI wiring, a global
 * pipe that throws on construction.
 */
interface ProbeBody {
  status?: string;
  uptimeSeconds?: number;
  info?: Record<string, { status: string }>;
  error?: Record<string, { status: string; message?: string }>;
}

describe('Application smoke test', () => {
  let app: INestApplication;

  const probe = async (path: string, expectedStatus: number): Promise<ProbeBody> => {
    const response = await request(app.getHttpServer() as Server)
      .get(path)
      .expect(expectedStatus);

    return response.body as ProbeBody;
  };

  beforeAll(async () => {
    // A separate stub per dependency — sharing one object would make a failure
    // injected into any of them surface as a failure of whichever runs first.
    const healthy = (): { ping: jest.Mock } => ({
      ping: jest.fn().mockResolvedValue(undefined),
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ ...healthy(), $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(RedisService)
      .useValue(healthy())
      .overrideProvider(StorageService)
      .useValue(healthy())
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the liveness probe without touching dependencies', async () => {
    const body = await probe('/health/live', 200);

    expect(body.status).toBe('ok');
    expect(body.uptimeSeconds).toEqual(expect.any(Number));
  });

  it('reports every dependency up on the readiness probe', async () => {
    const body = await probe('/health/ready', 200);

    expect(body.status).toBe('ok');
    expect(body.info).toHaveProperty('database.status', 'up');
    expect(body.info).toHaveProperty('redis.status', 'up');
    expect(body.info).toHaveProperty('storage.status', 'up');
  });

  it('returns 503 when a dependency is down', async () => {
    const redis = app.get(RedisService);
    jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const body = await probe('/health/ready', 503);

    expect(body.error).toHaveProperty('redis.status', 'down');
  });
});
