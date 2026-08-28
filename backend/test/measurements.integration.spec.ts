import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AuditAction,
  MeasurementSource,
  MeasurementType,
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

interface Actor {
  token: string;
  userId: string;
  staffId?: string;
}

interface SeriesPoint {
  measuredAt: string;
  value: number;
  secondaryValue: number | null;
  unit: string;
  source: MeasurementSource;
}

interface BmiPoint {
  measuredAt: string;
  bmi: number;
  category: string;
  weightKg: number;
  heightCm: number;
}

interface BodyChart {
  weight: { value: number }[];
  bmi: BmiPoint[];
  targetWeightKg: number | null;
  targetBmi: number | null;
}

/**
 * Measurements over HTTP.
 *
 * The cases worth having are the ones where a wrong answer reaches a clinician:
 * a reading no human could produce, a BMI computed against the wrong height,
 * and a chart belonging to someone else's patient.
 */
describe('measurements', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let doctor: Actor;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<Actor> => {
    const email = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Meas', lastName: role },
      });
      staffProfiles.push(profile.id);

      const setup = await auth.beginTotpEnrolment(user.id);
      await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));
      const login = await auth.login(email, PASSWORD, generateSync({ secret: setup.secret }), {});
      return { token: login.tokens!.accessToken, userId: user.id, staffId: profile.id };
    }

    const login = await auth.login(email, PASSWORD, undefined, {});
    return { token: login.tokens!.accessToken, userId: user.id };
  };

  const makePatient = async (userId?: string): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-MS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  /** Straight to the table: these tests are about reading, not re-testing POST. */
  const seed = async (
    patientId: string,
    type: MeasurementType,
    value: number,
    measuredAt: string,
  ): Promise<void> => {
    await prisma.measurement.create({
      data: {
        patientId,
        type,
        value,
        unit: type === MeasurementType.WEIGHT ? 'kg' : 'cm',
        measuredAt: new Date(measuredAt),
        source: MeasurementSource.NURSE,
      },
    });
  };

  const post = (
    patientId: string,
    token: string,
    body: Record<string, unknown>,
  ): request.Test =>
    request(server)
      .post(`/patients/${patientId}/measurements`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

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
    await prisma.measurement.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.medicalProfile.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.caregiverLink.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('recording', () => {
    it('stores a reading a nurse enters', async () => {
      const patientId = await makePatient();

      const response = await post(patientId, doctor.token, {
        type: MeasurementType.WEIGHT,
        value: 72.4,
        source: MeasurementSource.NURSE,
      }).expect(201);

      const id = (response.body as { id: string }).id;
      const stored = await prisma.measurement.findUniqueOrThrow({ where: { id } });

      expect(stored.value.toNumber()).toBe(72.4);
      expect(stored.unit).toBe('kg');
      expect(stored.recordedById).toBe(doctor.userId);
    });

    /**
     * Weight drives dosing (spec M9). A value no human has is refused at the
     * door rather than stored and trusted later by whoever reads the chart.
     */
    it.each([
      [MeasurementType.WEIGHT, 0.4],
      [MeasurementType.WEIGHT, 800],
      [MeasurementType.HEIGHT, 17],
      [MeasurementType.PULSE, 0],
      [MeasurementType.SPO2, 140],
      [MeasurementType.TEMPERATURE, 12],
    ])('refuses an implausible %s of %s', async (type, value) => {
      const patientId = await makePatient();

      await post(patientId, doctor.token, { type, value, source: MeasurementSource.NURSE }).expect(
        400,
      );

      expect(await prisma.measurement.count({ where: { patientId } })).toBe(0);
    });

    /**
     * A stored BMI would appear in `latest` next to a curve computed from the
     * weights, and the two would disagree the moment a height was corrected.
     */
    it('refuses a BMI, which is computed rather than recorded', async () => {
      const patientId = await makePatient();

      await post(patientId, doctor.token, {
        type: 'BMI',
        value: 22.9,
        source: MeasurementSource.NURSE,
      }).expect(400);

      expect(await prisma.measurement.count({ where: { patientId } })).toBe(0);
    });

    it('refuses a blood pressure whose numbers are transposed', async () => {
      const patientId = await makePatient();

      await post(patientId, doctor.token, {
        type: MeasurementType.BLOOD_PRESSURE,
        value: 70,
        secondaryValue: 120,
        source: MeasurementSource.NURSE,
      }).expect(400);
    });

    it('accepts a blood pressure with both numbers', async () => {
      const patientId = await makePatient();

      const response = await post(patientId, doctor.token, {
        type: MeasurementType.BLOOD_PRESSURE,
        value: 128,
        secondaryValue: 82,
        source: MeasurementSource.NURSE,
      }).expect(201);

      const stored = await prisma.measurement.findUniqueOrThrow({
        where: { id: (response.body as { id: string }).id },
      });

      expect(stored.secondaryValue?.toNumber()).toBe(82);
    });

    it('writes an audit entry naming the actor', async () => {
      const patientId = await makePatient();

      await post(patientId, doctor.token, {
        type: MeasurementType.PULSE,
        value: 68,
        source: MeasurementSource.DEVICE,
      }).expect(201);

      const entries = await prisma.auditLog.findMany({
        where: { patientId, entityType: 'measurements', action: AuditAction.CREATE },
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]!.actorId).toBe(doctor.userId);
    });

    it('refuses a coordinator, who has no medical.write', async () => {
      const patientId = await makePatient();
      const coordinator = await actorFor(Role.COORDINATOR);

      await post(patientId, coordinator.token, {
        type: MeasurementType.WEIGHT,
        value: 70,
        source: MeasurementSource.NURSE,
      }).expect(403);
    });

    /** Out of scope reads as absent, never as forbidden (spec section 2). */
    it('reports not found for a patient outside the caller scope', async () => {
      const patientId = await makePatient();
      const nurse = await actorFor(Role.NURSE);

      await post(patientId, nurse.token, {
        type: MeasurementType.WEIGHT,
        value: 70,
        source: MeasurementSource.NURSE,
      }).expect(404);
    });
  });

  describe('patients recording their own', () => {
    it('marks the reading as coming from the patient', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const response = await request(server)
        .post('/me/measurements')
        .set('Authorization', `Bearer ${patient.token}`)
        .send({ type: MeasurementType.WEIGHT, value: 68.2 })
        .expect(201);

      const stored = await prisma.measurement.findUniqueOrThrow({
        where: { id: (response.body as { id: string }).id },
      });

      expect(stored.patientId).toBe(patientId);
      expect(stored.source).toBe(MeasurementSource.PATIENT);
    });

    /**
     * Source is the one field the caller does not get to choose: a clinician
     * reading the chart has to be able to tell a home scale from a clinic one.
     * The patient DTO has no such field, so asking for one is refused outright
     * rather than quietly rewritten.
     */
    it('refuses a patient who labels the reading as a nurse\'s', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      await request(server)
        .post('/me/measurements')
        .set('Authorization', `Bearer ${patient.token}`)
        .send({ type: MeasurementType.PULSE, value: 70, source: MeasurementSource.NURSE })
        .expect(400);

      expect(await prisma.measurement.count({ where: { patientId } })).toBe(0);
    });

    it('refuses a caregiver, who may read but not record', async () => {
      const caregiver = await actorFor(Role.CAREGIVER);

      await request(server)
        .post('/me/measurements')
        .set('Authorization', `Bearer ${caregiver.token}`)
        .send({ type: MeasurementType.WEIGHT, value: 70 })
        .expect(403);
    });

    it('reports not found when the account has no patient file', async () => {
      const patient = await actorFor(Role.PATIENT);

      await request(server)
        .post('/me/measurements')
        .set('Authorization', `Bearer ${patient.token}`)
        .send({ type: MeasurementType.WEIGHT, value: 70 })
        .expect(404);
    });
  });

  describe('series', () => {
    it('returns one type oldest first', async () => {
      const patientId = await makePatient();
      await seed(patientId, MeasurementType.WEIGHT, 74, '2026-03-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 72, '2026-01-01T08:00:00Z');
      await seed(patientId, MeasurementType.HEIGHT, 170, '2026-01-01T08:00:00Z');

      const response = await request(server)
        .get(`/patients/${patientId}/measurements/WEIGHT`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const points = response.body as SeriesPoint[];

      expect(points.map((p) => p.value)).toEqual([72, 74]);
    });

    it('honours a date window', async () => {
      const patientId = await makePatient();
      await seed(patientId, MeasurementType.WEIGHT, 72, '2026-01-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 74, '2026-06-01T08:00:00Z');

      const response = await request(server)
        .get(`/patients/${patientId}/measurements/WEIGHT`)
        .query({ from: '2026-05-01T00:00:00Z' })
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(response.body as SeriesPoint[]).toHaveLength(1);
    });

    it('rejects a type that does not exist', async () => {
      const patientId = await makePatient();

      await request(server)
        .get(`/patients/${patientId}/measurements/CHOLESTEROL`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(400);
    });

    it('reports the latest of each type', async () => {
      const patientId = await makePatient();
      await seed(patientId, MeasurementType.WEIGHT, 72, '2026-01-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 74, '2026-06-01T08:00:00Z');
      await seed(patientId, MeasurementType.HEIGHT, 170, '2026-01-01T08:00:00Z');

      const response = await request(server)
        .get(`/patients/${patientId}/measurements/latest`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const latest = response.body as Record<string, SeriesPoint>;

      expect(latest.WEIGHT!.value).toBe(74);
      expect(latest.HEIGHT!.value).toBe(170);
    });

    it('reports not found for a patient outside the caller scope', async () => {
      const patientId = await makePatient();
      const unassigned = await actorFor(Role.NURSE);

      await request(server)
        .get(`/patients/${patientId}/measurements/WEIGHT`)
        .set('Authorization', `Bearer ${unassigned.token}`)
        .expect(404);
    });

    /**
     * A role without medical.read is stopped by the permission guard, before
     * any patient is looked up. That 403 is the same for every id, so it says
     * nothing about whether the record exists.
     */
    it('refuses a patient reaching for the staff route', async () => {
      const patientId = await makePatient();
      const other = await actorFor(Role.PATIENT);

      await request(server)
        .get(`/patients/${patientId}/measurements/WEIGHT`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(403);
    });
  });

  describe('the body chart', () => {
    it('computes a point per weight', async () => {
      const patientId = await makePatient();
      await seed(patientId, MeasurementType.HEIGHT, 170, '2026-01-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 66.2, '2026-01-02T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 72.3, '2026-02-02T08:00:00Z');

      const response = await request(server)
        .get(`/patients/${patientId}/measurements/chart`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const points = (response.body as BodyChart).bmi;

      expect(points.map((p) => p.bmi)).toEqual([22.9, 25]);
      expect(points.map((p) => p.category)).toEqual(['NORMAL', 'OVERWEIGHT']);
    });

    /**
     * The reason BMI is computed and not stored: a height typed as 17 and
     * corrected to 170 must heal every point, not leave a curve that disagrees
     * with the weights printed beside it.
     */
    it('follows a corrected height', async () => {
      const patientId = await makePatient();
      await seed(patientId, MeasurementType.HEIGHT, 160, '2026-01-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 66.2, '2026-01-02T08:00:00Z');

      const before = await request(server)
        .get(`/patients/${patientId}/measurements/chart`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(((before.body as BodyChart).bmi)[0]!.bmi).toBe(25.9);

      await prisma.measurement.updateMany({
        where: { patientId, type: MeasurementType.HEIGHT },
        data: { value: 170 },
      });

      const after = await request(server)
        .get(`/patients/${patientId}/measurements/chart`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(((after.body as BodyChart).bmi)[0]!.bmi).toBe(22.9);
    });

    /** Each weight is measured against the height in effect when it was taken. */
    it('uses the height in effect at each weight', async () => {
      const patientId = await makePatient();
      await seed(patientId, MeasurementType.HEIGHT, 160, '2026-01-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 64, '2026-02-01T08:00:00Z');
      await seed(patientId, MeasurementType.HEIGHT, 170, '2026-03-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 64, '2026-04-01T08:00:00Z');

      const response = await request(server)
        .get(`/patients/${patientId}/measurements/chart`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(((response.body as BodyChart).bmi).map((p) => p.heightCm)).toEqual([160, 170]);
    });

    it('carries the goal line on both axes', async () => {
      const patientId = await makePatient();
      await prisma.medicalProfile.create({ data: { patientId, targetWeightKg: 65 } });
      await seed(patientId, MeasurementType.HEIGHT, 170, '2026-01-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 80, '2026-01-02T08:00:00Z');

      const response = await request(server)
        .get(`/patients/${patientId}/measurements/chart`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const chart = response.body as BodyChart;

      expect(chart.targetWeightKg).toBe(65);
      expect(chart.targetBmi).toBe(22.5);
      expect(chart.weight).toHaveLength(1);
    });

    /** No goal set draws no line, rather than a line at zero. */
    it('reports no goal line when none was set', async () => {
      const patientId = await makePatient();
      await seed(patientId, MeasurementType.HEIGHT, 170, '2026-01-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 80, '2026-01-02T08:00:00Z');

      const response = await request(server)
        .get(`/patients/${patientId}/measurements/chart`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((response.body as BodyChart).targetWeightKg).toBeNull();
      expect((response.body as BodyChart).targetBmi).toBeNull();
    });

    /** Guessing a height would put a number on a chart that nobody measured. */
    it('returns nothing when no height was ever recorded', async () => {
      const patientId = await makePatient();
      await seed(patientId, MeasurementType.WEIGHT, 72, '2026-01-01T08:00:00Z');

      const response = await request(server)
        .get(`/patients/${patientId}/measurements/chart`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((response.body as BodyChart).bmi).toEqual([]);
      expect((response.body as BodyChart).weight).toHaveLength(1);
    });

    /**
     * Patients reach their own chart through /me, not through the staff route:
     * that one is gated on medical.read, and handing that to patients would put
     * every patient within reach of every file.
     */
    it('serves a patient their own curve through /me', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await seed(patientId, MeasurementType.HEIGHT, 170, '2026-01-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 66.2, '2026-01-02T08:00:00Z');

      const response = await request(server)
        .get('/me/measurements/chart')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect((response.body as BodyChart).bmi[0]!.bmi).toBe(22.9);

      await request(server)
        .get(`/patients/${patientId}/measurements/chart`)
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(403);
    });

    it('serves a consented caregiver the same curve', async () => {
      const patient = await actorFor(Role.PATIENT);
      const caregiver = await actorFor(Role.CAREGIVER);
      const patientId = await makePatient(patient.userId);
      await prisma.caregiverLink.create({
        data: {
          patientId,
          caregiverUserId: caregiver.userId,
          relationship: 'SPOUSE',
          consentedAt: new Date(),
        },
      });
      await seed(patientId, MeasurementType.HEIGHT, 170, '2026-01-01T08:00:00Z');
      await seed(patientId, MeasurementType.WEIGHT, 66.2, '2026-01-02T08:00:00Z');

      const response = await request(server)
        .get('/me/measurements/chart')
        .set('Authorization', `Bearer ${caregiver.token}`)
        .expect(200);

      expect((response.body as BodyChart).bmi[0]!.bmi).toBe(22.9);
    });

    /** Withdrawn consent closes the chart too, not only the file (spec 2). */
    it('stops serving a caregiver whose consent was withdrawn', async () => {
      const patient = await actorFor(Role.PATIENT);
      const caregiver = await actorFor(Role.CAREGIVER);
      const patientId = await makePatient(patient.userId);
      await prisma.caregiverLink.create({
        data: {
          patientId,
          caregiverUserId: caregiver.userId,
          relationship: 'SPOUSE',
          consentedAt: new Date('2026-01-01T00:00:00Z'),
          revokedAt: new Date(),
        },
      });
      await seed(patientId, MeasurementType.WEIGHT, 66.2, '2026-01-02T08:00:00Z');

      await request(server)
        .get('/me/measurements/chart')
        .set('Authorization', `Bearer ${caregiver.token}`)
        .expect(404);
    });
  });
});
