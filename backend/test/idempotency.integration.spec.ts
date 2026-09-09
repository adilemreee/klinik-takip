import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  MeasurementSource,
  MeasurementType,
  PrismaClient,
  Role,
  Sex,
  UserStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

interface Actor {
  token: string;
  userId: string;
  staffId?: string;
}

/**
 * A write sent twice, over HTTP (spec M15).
 *
 * The client keeps writes it could not deliver and sends them when the
 * connection returns. It cannot tell a request that never arrived from one
 * that arrived, committed, and lost its answer on the way back — so the second
 * attempt is not hypothetical, it is the normal case on a bad connection.
 *
 * These run against the real interceptor, the real Redis and the real
 * database, because that is the only arrangement in which "one row, not two"
 * means anything.
 */
describe('idempotent writes', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let doctor: Actor;
  let other: Actor;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<Actor> => {
    const email = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    const profile = await prisma.staffProfile.create({
      data: { userId: user.id, firstName: 'Idem', lastName: role },
    });
    staffProfiles.push(profile.id);

    const setup = await auth.beginTotpEnrolment(user.id);
    await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));
    const login = await auth.login(email, PASSWORD, generateSync({ secret: setup.secret }), {});

    return { token: login.tokens!.accessToken, userId: user.id, staffId: profile.id };
  };

  const makePatient = async (): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-IDEM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayse',
        lastName: 'Yilmaz',
        birthDate: new Date('1985-03-12'),
        sex: Sex.FEMALE,
        country: 'DE',
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  const record = (
    patientId: string,
    token: string,
    key: string | undefined,
    value = 72.4,
  ): request.Test => {
    const call = request(server)
      .post(`/patients/${patientId}/measurements`)
      .set('Authorization', `Bearer ${token}`);

    if (key) call.set('Idempotency-Key', key);

    return call.send({
      type: MeasurementType.WEIGHT,
      value,
      source: MeasurementSource.NURSE,
    });
  };

  const countFor = (patientId: string): Promise<number> =>
    prisma.measurement.count({ where: { patientId } });

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

    doctor = await actorFor(Role.DOCTOR);
    other = await actorFor(Role.DOCTOR);
  });

  afterAll(async () => {
    await prisma.measurement.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('records one reading when the same write arrives twice', async () => {
    const patientId = await makePatient();
    const key = randomUUID();

    const first = await record(patientId, doctor.token, key).expect(201);
    const second = await record(patientId, doctor.token, key).expect(201);

    expect(await countFor(patientId)).toBe(1);
    // The replay is the first answer, not a fresh one: a client parsing it
    // must not have to know this feature exists to read back its own record.
    expect((second.body as { id: string }).id).toBe((first.body as { id: string }).id);
    expect(second.headers['idempotent-replay']).toBe('true');
  });

  it('records two readings when the writes carry different keys', async () => {
    const patientId = await makePatient();

    await record(patientId, doctor.token, randomUUID()).expect(201);
    await record(patientId, doctor.token, randomUUID(), 73.1).expect(201);

    expect(await countFor(patientId)).toBe(2);
  });

  it('leaves a write with no key exactly as it was', async () => {
    const patientId = await makePatient();

    await record(patientId, doctor.token, undefined).expect(201);
    await record(patientId, doctor.token, undefined).expect(201);

    expect(await countFor(patientId)).toBe(2);
  });

  /// Otherwise one account could replay another's key and be handed a record
  /// it never had the right to see.
  it('does not let one account replay another account key', async () => {
    const patientId = await makePatient();
    const key = randomUUID();

    await record(patientId, doctor.token, key).expect(201);
    await record(patientId, other.token, key).expect(201);

    expect(await countFor(patientId)).toBe(2);
  });

  /// Handing back the earlier answer would look exactly like success and
  /// silently drop the second change.
  it('refuses a key reused for a different write', async () => {
    const patientId = await makePatient();
    const key = randomUUID();

    await record(patientId, doctor.token, key, 72.4).expect(201);
    const reused = await record(patientId, doctor.token, key, 80.2).expect(409);

    expect((reused.body as { message: string }).message).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await countFor(patientId)).toBe(1);
  });

  it('refuses a key the server cannot use', async () => {
    const patientId = await makePatient();

    await record(patientId, doctor.token, 'short').expect(400);

    expect(await countFor(patientId)).toBe(0);
  });

  /// A failed write changed nothing worth remembering, and holding the key
  /// would turn one refusal into a change the user cannot correct.
  it('frees the key after the write is refused', async () => {
    const patientId = await makePatient();
    const key = randomUUID();

    // Outside any plausible human range: the server refuses it.
    await record(patientId, doctor.token, key, 500).expect(400);
    await record(patientId, doctor.token, key, 500).expect(400);

    expect(await countFor(patientId)).toBe(0);
  });
});
