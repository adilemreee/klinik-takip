import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AppointmentStatus,
  AppointmentType,
  MedicationLogStatus,
  PrismaClient,
  Role,
  Sex,
  UserStatus,
} from '@prisma/client';
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

interface Summary {
  patient: { id: string; mrn: string; firstName: string };
  nextAppointment: { id: string } | null;
  medicationsDueToday: number;
  unreadMessages: number;
  missingDocuments: number;
}

/**
 * The patient-facing summary.
 *
 * The interesting cases are all about who sees whose file: a patient must reach
 * exactly one record — their own — and a caregiver must stop reaching it the
 * moment consent is withdrawn.
 */
describe('patient home summary', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const patientIds: string[] = [];
  const staffProfiles: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;

  const PASSWORD = 'correct-horse-battery-9';

  const makeUser = async (role: Role): Promise<{ id: string; email: string; token: string }> => {
    const email = `me-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Me', lastName: role },
      });
      staffProfiles.push(profile.id);

      const setup = await auth.beginTotpEnrolment(user.id);
      await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));
      const login = await auth.login(email, PASSWORD, generateSync({ secret: setup.secret }), {});
      return { id: user.id, email, token: login.tokens!.accessToken };
    }

    const login = await auth.login(email, PASSWORD, undefined, {});
    return { id: user.id, email, token: login.tokens!.accessToken };
  };

  const makePatient = async (userId?: string): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-ME-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayse',
        lastName: 'Yilmaz',
        birthDate: new Date('1985-03-12'),
        sex: Sex.FEMALE,
        country: 'DE',
        userId,
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  const summaryFor = async (token: string, expected = 200): Promise<Summary> => {
    const response = await request(server)
      .get('/me/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(expected);

    return response.body as Summary;
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
    await prisma.medicationLog.deleteMany({ where: { medication: { patientId: { in: patientIds } } } });
    await prisma.medication.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.message.deleteMany({ where: { conversation: { patientId: { in: patientIds } } } });
    await prisma.conversationParticipant.deleteMany({
      where: { conversation: { patientId: { in: patientIds } } },
    });
    await prisma.conversation.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.appointment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.caregiverLink.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('who may call it', () => {
    it('serves a patient their own file', async () => {
      const user = await makeUser(Role.PATIENT);
      const patientId = await makePatient(user.id);

      const summary = await summaryFor(user.token);

      expect(summary.patient.id).toBe(patientId);
    });

    /**
     * The reason this endpoint exists rather than reusing the staff route:
     * that one requires patients.read, and giving it to patients would put
     * every patient in reach of every file.
     */
    it('refuses a role that has no self.read', async () => {
      const doctor = await makeUser(Role.DOCTOR);

      await request(server)
        .get('/me/summary')
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(403);
    });

    it('refuses an unauthenticated request', async () => {
      await request(server).get('/me/summary').expect(401);
    });

    /** An account created but never linked to a file. */
    it('reports not found when the account has no patient record', async () => {
      const user = await makeUser(Role.PATIENT);

      await request(server)
        .get('/me/summary')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(404);
    });

    it('never returns another patient’s file', async () => {
      const user = await makeUser(Role.PATIENT);
      const own = await makePatient(user.id);
      await makePatient();

      const summary = await summaryFor(user.token);

      expect(summary.patient.id).toBe(own);
    });
  });

  describe('caregivers', () => {
    it('serves the linked patient while consent stands', async () => {
      const caregiver = await makeUser(Role.CAREGIVER);
      const patientId = await makePatient();

      await prisma.caregiverLink.create({
        data: { patientId, caregiverUserId: caregiver.id, consentedAt: new Date() },
      });

      const summary = await summaryFor(caregiver.token);

      expect(summary.patient.id).toBe(patientId);
    });

    /** Consent is revocable, and revoking it has to close the door. */
    it('stops serving it once consent is revoked', async () => {
      const caregiver = await makeUser(Role.CAREGIVER);
      const patientId = await makePatient();

      const link = await prisma.caregiverLink.create({
        data: { patientId, caregiverUserId: caregiver.id, consentedAt: new Date() },
      });
      await summaryFor(caregiver.token);

      await prisma.caregiverLink.update({
        where: { id: link.id },
        data: { revokedAt: new Date() },
      });

      await request(server)
        .get('/me/summary')
        .set('Authorization', `Bearer ${caregiver.token}`)
        .expect(404);
    });
  });

  describe('what it summarises', () => {
    it('reports the next appointment and ignores past ones', async () => {
      const user = await makeUser(Role.PATIENT);
      const patientId = await makePatient(user.id);

      await prisma.appointment.create({
        data: {
          patientId,
          type: AppointmentType.CONTROL,
          status: AppointmentStatus.CONFIRMED,
          scheduledAt: new Date(Date.now() - 86_400_000),
        },
      });
      const upcoming = await prisma.appointment.create({
        data: {
          patientId,
          type: AppointmentType.CONTROL,
          status: AppointmentStatus.CONFIRMED,
          scheduledAt: new Date(Date.now() + 86_400_000),
        },
      });

      const summary = await summaryFor(user.token);

      expect(summary.nextAppointment?.id).toBe(upcoming.id);
    });

    it('counts only doses still waiting today', async () => {
      const user = await makeUser(Role.PATIENT);
      const patientId = await makePatient(user.id);

      const medication = await prisma.medication.create({
        data: {
          patientId,
          drugName: 'Parasetamol',
          dose: '500mg',
          frequencyRule: 'FREQ=DAILY;INTERVAL=1',
          startDate: new Date(),
        },
      });

      const today = new Date();
      today.setHours(9, 0, 0, 0);

      await prisma.medicationLog.createMany({
        data: [
          { medicationId: medication.id, scheduledAt: today, status: MedicationLogStatus.PENDING },
          {
            medicationId: medication.id,
            scheduledAt: new Date(today.getTime() + 3_600_000),
            status: MedicationLogStatus.TAKEN,
          },
          {
            medicationId: medication.id,
            // Tomorrow: not part of today's count.
            scheduledAt: new Date(today.getTime() + 86_400_000),
            status: MedicationLogStatus.PENDING,
          },
        ],
      });

      const summary = await summaryFor(user.token);

      expect(summary.medicationsDueToday).toBe(1);
    });

    /** A patient's own messages are not unread mail for the patient. */
    it('counts unread messages from the clinic but not the patient’s own', async () => {
      const user = await makeUser(Role.PATIENT);
      const patientId = await makePatient(user.id);

      const conversation = await prisma.conversation.create({ data: { patientId } });

      await prisma.message.createMany({
        data: [
          { conversationId: conversation.id, senderId: null, body: 'From the clinic' },
          { conversationId: conversation.id, senderId: user.id, body: 'From the patient' },
        ],
      });

      const summary = await summaryFor(user.token);

      expect(summary.unreadMessages).toBe(1);
    });

    it('returns zeroes for a file with nothing on it yet', async () => {
      const user = await makeUser(Role.PATIENT);
      await makePatient(user.id);

      const summary = await summaryFor(user.token);

      expect(summary.nextAppointment).toBeNull();
      expect(summary.medicationsDueToday).toBe(0);
      expect(summary.unreadMessages).toBe(0);
    });
  });

  it('records the read in the audit trail', async () => {
    const user = await makeUser(Role.PATIENT);
    await makePatient(user.id);

    await summaryFor(user.token);

    const entries = await prisma.auditLog.findMany({
      where: { actorId: user.id, entityType: 'patients' },
    });

    expect(entries.length).toBeGreaterThan(0);
  });
});
