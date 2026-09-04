import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

const prisma = new PrismaClient();

interface LegalBody {
  id: string;
  version: number;
  body: string;
}

/**
 * The privacy notice, served rather than compiled into the clients.
 *
 * The version is the load-bearing part: a consent record names the wording it
 * agreed to, and "they agreed" means nothing without saying to what.
 */
describe('legal texts', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(StorageService)
      .useValue({ ping: jest.fn().mockResolvedValue(undefined) })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();

    server = app.getHttpServer() as Server;

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('serves the privacy notice without signing in', async () => {
    // A notice that can only be read after signing in is one somebody cannot
    // read before deciding whether to sign up.
    const response = await request(server).get('/legal/privacy-notice').expect(200);
    const body = response.body as LegalBody;

    expect(body.id).toBe('privacy-notice');
    expect(body.version).toBeGreaterThanOrEqual(1);
    expect(body.body.length).toBeGreaterThan(500);
  });

  it('serves the actual notice, not a placeholder', async () => {
    // The failure this catches is a deployment that lost the file and served
    // something empty — which reads as a clinic with nothing to declare.
    const response = await request(server).get('/legal/privacy-notice').expect(200);
    const body = response.body as LegalBody;

    expect(body.body).toContain('Aydınlatma Metni');
    expect(body.body).toContain('KVKK');
  });
});
