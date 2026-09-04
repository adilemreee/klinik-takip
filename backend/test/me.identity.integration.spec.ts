import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role, Sex, UserStatus } from '@prisma/client';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isStaffRole } from '../src/auth/auth.errors';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

const prisma = new PrismaClient();

interface Identity {
  userId: string;
  role: Role;
  displayName: string;
  patientId: string | null;
  isStaff: boolean;
}

/**
 * Who is signed in (the app shell's first question).
 *
 * The composition root cannot decide what to show until it knows the role, and
 * the alternative — decoding the access token in the client — puts a security
 * decision somewhere with no way to verify it.
 */
describe('identity', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `idt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Ayşe', lastName: 'Şahin' },
      });
      staffProfiles.push(profile.id);

      const setup = await auth.beginTotpEnrolment(user.id);
      await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));
      const login = await auth.login(email, PASSWORD, generateSync({ secret: setup.secret }), {});

      return { token: login.tokens!.accessToken, userId: user.id };
    }

    const login = await auth.login(email, PASSWORD, undefined, {});
    return { token: login.tokens!.accessToken, userId: user.id };
  };

  const identityFor = async (token: string): Promise<Identity> =>
    (
      await request(server)
        .get('/me/identity')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as Identity;

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
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('tells a staff account that it is staff, with a name to greet', async () => {
    const doctor = await actorFor(Role.DOCTOR);
    const identity = await identityFor(doctor.token);

    expect(identity.role).toBe(Role.DOCTOR);
    expect(identity.isStaff).toBe(true);
    expect(identity.displayName).toBe('Ayşe Şahin');
    // Staff are not a patient file.
    expect(identity.patientId).toBeNull();
  });

  it('gives a patient their own file id, which is what their screens need', async () => {
    const patient = await actorFor(Role.PATIENT);
    const file = await prisma.patient.create({
      data: {
        mrn: `MRN-IDT-${Date.now()}`,
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        birthDate: new Date('1981-04-02'),
        sex: Sex.FEMALE,
        country: 'DE',
        userId: patient.userId,
      },
    });
    patientIds.push(file.id);

    const identity = await identityFor(patient.token);

    expect(identity.role).toBe(Role.PATIENT);
    expect(identity.isStaff).toBe(false);
    expect(identity.patientId).toBe(file.id);
    expect(identity.displayName).toBe('Ayşe Yılmaz');
  });

  it('is answerable before a patient file exists', async () => {
    // The account is activated from an invitation before anything is linked;
    // a shell that could not route until then would show a blank screen.
    const patient = await actorFor(Role.PATIENT);
    const identity = await identityFor(patient.token);

    expect(identity.patientId).toBeNull();
    expect(identity.isStaff).toBe(false);
    // Never blank: a greeting with no name looks like a broken screen.
    expect(identity.displayName.length).toBeGreaterThan(0);
  });

  it('treats a caregiver as not staff', async () => {
    const caregiver = await actorFor(Role.CAREGIVER);
    const identity = await identityFor(caregiver.token);

    expect(identity.isStaff).toBe(false);
  });

  it('needs no permission, because it is the question asked before permissions', async () => {
    // A finance account holds nothing clinical and must still be able to learn
    // that it is signed in and who it is.
    const finance = await actorFor(Role.FINANCE);
    const identity = await identityFor(finance.token);

    expect(identity.role).toBe(Role.FINANCE);
    expect(identity.isStaff).toBe(true);
  });

  it('is refused without a token', async () => {
    await request(server).get('/me/identity').expect(401);
  });
});
