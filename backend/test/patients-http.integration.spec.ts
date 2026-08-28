import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuditAction, PrismaClient, Role, Sex, UserStatus } from '@prisma/client';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { isStaffRole } from '../src/auth/auth.errors';
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

describe('patient endpoints', () => {
  const prisma = new PrismaClient();
  const created: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let doctor: Actor;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<Actor> => {
    const email = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    created.push(user.id);

    let staffId: string | undefined;

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'HTTP', lastName: role },
      });
      staffProfiles.push(profile.id);
      staffId = profile.id;

      const setup = await auth.beginTotpEnrolment(user.id);
      await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));
      const login = await auth.login(email, PASSWORD, generateSync({ secret: setup.secret }), {});
      return { token: login.tokens!.accessToken, userId: user.id, staffId };
    }

    const login = await auth.login(email, PASSWORD, undefined, {});
    return { token: login.tokens!.accessToken, userId: user.id, staffId };
  };

  const newPatient = {
    firstName: 'Test',
    lastName: 'Patient',
    birthDate: '1985-03-12',
    sex: Sex.FEMALE,
    country: 'DE',
  };

  const createPatient = async (): Promise<string> => {
    const response = await request(server)
      .post('/patients')
      .set('Authorization', `Bearer ${doctor.token}`)
      .send(newPatient)
      .expect(201);

    const id = (response.body as { id: string }).id;
    patientIds.push(id);
    return id;
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

    doctor = await actorFor(Role.DOCTOR);
  });

  afterAll(async () => {
    await prisma.patientAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.medicalProfile.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: created } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('creating requires patients.write', () => {
    it.each([Role.NURSE, Role.FINANCE, Role.PATIENT, Role.CAREGIVER])(
      'refuses %s',
      async (role) => {
        const actor = await actorFor(role);

        await request(server)
          .post('/patients')
          .set('Authorization', `Bearer ${actor.token}`)
          .send(newPatient)
          .expect(403);
      },
    );

    it.each([Role.DOCTOR, Role.COORDINATOR])('allows %s', async (role) => {
      const actor = await actorFor(role);

      const response = await request(server)
        .post('/patients')
        .set('Authorization', `Bearer ${actor.token}`)
        .send(newPatient)
        .expect(201);

      patientIds.push((response.body as { id: string }).id);
    });
  });

  describe('assignment requires patients.assign', () => {
    it.each([Role.NURSE, Role.COORDINATOR])('refuses %s', async (role) => {
      const actor = await actorFor(role);
      const patientId = await createPatient();

      await request(server)
        .post(`/patients/${patientId}/assignments`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ staffId: actor.staffId, role })
        .expect(403);
    });

    it('allows a doctor', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patientId = await createPatient();

      await request(server)
        .post(`/patients/${patientId}/assignments`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ staffId: nurse.staffId, role: Role.NURSE })
        .expect(204);
    });
  });

  describe('deletion requires patients.delete', () => {
    it('refuses a coordinator', async () => {
      const coordinator = await actorFor(Role.COORDINATOR);
      const patientId = await createPatient();

      await request(server)
        .delete(`/patients/${patientId}`)
        .set('Authorization', `Bearer ${coordinator.token}`)
        .expect(403);
    });

    it('allows a doctor', async () => {
      const patientId = await createPatient();

      await request(server)
        .delete(`/patients/${patientId}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(204);
    });
  });

  describe('the medical profile requires medical.write', () => {
    it('refuses a coordinator, who handles logistics rather than clinical data', async () => {
      const coordinator = await actorFor(Role.COORDINATOR);
      const patientId = await createPatient();

      await request(server)
        .put(`/patients/${patientId}/medical-profile`)
        .set('Authorization', `Bearer ${coordinator.token}`)
        .send({ bloodType: 'A Rh+' })
        .expect(403);
    });

    it('allows a nurse once she is assigned', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patientId = await createPatient();

      await request(server)
        .post(`/patients/${patientId}/assignments`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ staffId: nurse.staffId, role: Role.NURSE })
        .expect(204);

      await request(server)
        .put(`/patients/${patientId}/medical-profile`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .send({ bloodType: 'A Rh+', smoking: false })
        .expect(204);
    });
  });

  describe('reading', () => {
    it('refuses finance entirely', async () => {
      const finance = await actorFor(Role.FINANCE);

      await request(server)
        .get('/patients')
        .set('Authorization', `Bearer ${finance.token}`)
        .expect(403);
    });

    /**
     * Permission and scope are different questions: the nurse holds
     * patients.read, so she gets a 200 with an empty page, not a 403.
     */
    it('gives an unassigned nurse an empty page rather than a refusal', async () => {
      const nurse = await actorFor(Role.NURSE);
      await createPatient();

      const response = await request(server)
        .get('/patients')
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(200);

      expect((response.body as { items: unknown[] }).items).toEqual([]);
    });

    /** Out of scope and non-existent must be indistinguishable over HTTP too. */
    it('answers 404 for a patient outside the caller’s scope', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patientId = await createPatient();

      await request(server)
        .get(`/patients/${patientId}`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(404);

      await request(server)
        .get('/patients/01a00000-0000-7000-8000-000000000000')
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(404);
    });

    it('records the read in the audit trail', async () => {
      const patientId = await createPatient();

      await request(server)
        .get(`/patients/${patientId}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { entityId: patientId, action: AuditAction.READ, entityType: 'patients' },
      });

      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]?.actorId).toBe(doctor.userId);
    });

    it('does not record a read that was refused', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patientId = await createPatient();

      await request(server)
        .get(`/patients/${patientId}`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(404);

      const entries = await prisma.auditLog.findMany({
        where: { actorId: nurse.userId, action: AuditAction.READ, entityId: patientId },
      });

      // Logging a refused request as a read would make the trail claim someone
      // saw a file they never received.
      expect(entries).toEqual([]);
    });
  });

  describe('input validation', () => {
    it('rejects an unknown field', async () => {
      await request(server)
        .post('/patients')
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ ...newPatient, isVip: true })
        .expect(400);
    });

    it('rejects a malformed country code', async () => {
      await request(server)
        .post('/patients')
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ ...newPatient, country: 'Germany' })
        .expect(400);
    });

    it('rejects a non-uuid patient id', async () => {
      await request(server)
        .get('/patients/not-a-uuid')
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(400);
    });

    it('caps the page size', async () => {
      await request(server)
        .get('/patients')
        .query({ limit: 5000 })
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(400);
    });
  });
});
