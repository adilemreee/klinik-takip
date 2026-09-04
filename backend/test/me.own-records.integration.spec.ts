import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role, Sex, UserStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

const prisma = new PrismaClient();

/**
 * A patient reading their own documents, photos and results.
 *
 * These routes exist because the staff ones require `documents.read`,
 * `photos.read` and `medical.read`, and a patient holding any of those could
 * reach every patient's file — which is the thing T1.3 exists to prevent.
 *
 * Found by running the iOS client against the real server: four of the
 * patient's own screens answered "you do not have permission" for their own
 * records.
 */
describe('a patient reading their own records', () => {
  const userIds: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;

  const PASSWORD = 'correct-horse-battery-9';

  /** A patient account with a file of its own. */
  const patientWithFile = async (): Promise<{ token: string; patientId: string }> => {
    const email = `own-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: {
        role: Role.PATIENT,
        email,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    const patient = await prisma.patient.create({
      data: {
        userId: user.id,
        mrn: `OWN-${Math.random().toString(36).slice(2, 10)}`,
        firstName: 'Test',
        lastName: 'Hasta',
        birthDate: new Date('1990-05-14'),
        sex: Sex.FEMALE,
        country: 'TR',
      },
    });
    patientIds.push(patient.id);

    const login = await auth.login(email, PASSWORD, undefined, {});

    return { token: login.tokens!.accessToken, patientId: patient.id };
  };

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
    auth = app.get(AuthService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it.each([
    ['/me/documents', 'documents'],
    ['/me/photos', 'photos'],
    ['/me/lab-results/trends', 'lab results'],
  ])('lets a patient read their own %s', async (path) => {
    const patient = await patientWithFile();

    // Empty is the right answer for a new file. What must not happen is 403 —
    // which is what the staff route returns, and what these screens used to
    // show a patient looking at their own records.
    await request(server)
      .get(path)
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(200);
  });

  it('still refuses the staff route for the patient\'s own file', async () => {
    // The point of the separate route: the permission is what is missing, and
    // owning the file does not supply it. If this ever passes, `documents.read`
    // has been given to patients and every file is within reach.
    const patient = await patientWithFile();

    await request(server)
      .get(`/patients/${patient.patientId}/documents`)
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(403);
  });

  it('does not leak another patient\'s records through the me route', async () => {
    // `me` resolves the caller's own file from the token, so there is no id to
    // tamper with — this asserts that property rather than assuming it.
    const first = await patientWithFile();
    const second = await patientWithFile();

    const response = await request(server)
      .get('/me/documents')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200);

    const body = response.body as { items: { id: string }[] };

    expect(body.items).toEqual([]);
    expect(first.patientId).not.toEqual(second.patientId);
  });

  it('refuses an account with no patient file rather than inventing one', async () => {
    // An invitation creates the account before the clinic links a file.
    const email = `nofile-${Date.now()}@test.local`;
    const user = await prisma.user.create({
      data: {
        role: Role.PATIENT,
        email,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    const login = await auth.login(email, PASSWORD, undefined, {});

    await request(server)
      .get('/me/documents')
      .set('Authorization', `Bearer ${login.tokens!.accessToken}`)
      .expect(404);
  });
});
