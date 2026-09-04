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

interface ExportBody {
  format: string;
  patient: { id: string; mrn: string };
  labResults: { analyteCode: string }[];
  notIncluded: string[];
}

/**
 * Taking your own data elsewhere (KVKK m.11).
 *
 * The tests that matter are the boundaries: what the export must contain to be
 * useful, and what it must not contain because it is somebody else's.
 */
describe('data portability', () => {
  const userIds: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;

  const PASSWORD = 'correct-horse-battery-9';

  const patientWithFile = async (): Promise<{ token: string; patientId: string }> => {
    const email = `port-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
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
        mrn: `PORT-${Math.random().toString(36).slice(2, 10)}`,
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
    await prisma.labResult.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('gives a patient their own file, named and dated', async () => {
    const patient = await patientWithFile();

    const response = await request(server)
      .get('/me/data-export')
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(200);

    const body = response.body as ExportBody;

    // A file with no provenance is hard to use and impossible to check.
    expect(body.format).toBe('klinik-portability-1');
    expect(body.patient.id).toBe(patient.patientId);
  });

  it('says in the file what the file leaves out', async () => {
    // Said in the export rather than only in a covering note, because the file
    // is what outlives the conversation.
    const patient = await patientWithFile();

    const response = await request(server)
      .get('/me/data-export')
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(200);

    expect((response.body as ExportBody).notIncluded.length).toBeGreaterThan(0);
  });

  it('includes a confirmed lab result and withholds an unreviewed one', async () => {
    // An unreviewed OCR reading is not a lab result. Handing one over as if it
    // were is the failure the review step exists to prevent — and an export is
    // the worst place for it, because it leaves with the patient.
    const patient = await patientWithFile();

    await prisma.labResult.createMany({
      data: [
        {
          patientId: patient.patientId,
          analyteCode: 'HGB',
          analyteName: 'Hemoglobin',
          value: 13.2,
          unit: 'g/dL',
          measuredAt: new Date('2026-08-01T09:00:00Z'),
          verifiedAt: new Date('2026-08-02T09:00:00Z'),
        },
        {
          patientId: patient.patientId,
          analyteCode: 'WBC',
          analyteName: 'Lökosit',
          value: 7.1,
          unit: '10^3/uL',
          measuredAt: new Date('2026-08-01T09:00:00Z'),
          verifiedAt: null,
        },
      ],
    });

    const response = await request(server)
      .get('/me/data-export')
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(200);

    const codes = (response.body as ExportBody).labResults.map((row) => row.analyteCode);

    expect(codes).toContain('HGB');
    expect(codes).not.toContain('WBC');
  });

  it('never returns another patient\'s file', async () => {
    // The file is resolved from the token, so there is no id to tamper with —
    // this asserts that property rather than assuming it.
    const first = await patientWithFile();
    const second = await patientWithFile();

    const response = await request(server)
      .get('/me/data-export')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200);

    expect((response.body as ExportBody).patient.id).toBe(first.patientId);
    expect((response.body as ExportBody).patient.id).not.toBe(second.patientId);
  });

  it('refuses an account with no patient file rather than inventing one', async () => {
    const email = `port-nofile-${Date.now()}@test.local`;
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
      .get('/me/data-export')
      .set('Authorization', `Bearer ${login.tokens!.accessToken}`)
      .expect(404);
  });
});
