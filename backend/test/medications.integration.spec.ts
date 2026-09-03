import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  MedicationLogStatus,
  MedicationSource,
  NotificationChannel,
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
import { CareTeamService } from '../src/authz/care-team.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';
import { medicationSweep } from '../src/medications/medications.processor';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../src/notifications/templates';

const prisma = new PrismaClient();

interface View {
  medication: {
    id: string;
    drugName: string;
    source: string;
    approvedAt: string | null;
    stoppedAt: string | null;
    timezone: string;
  };
  schedule: string;
  adherence: { score: number | null; taken: number; missed: number; due: number; streak: number };
  badges: string[];
  nextDose: string | null;
}

/**
 * Medication plans, reminders, check-in and adherence (spec M9, T6.1).
 *
 * The things that go wrong here are quiet: a schedule an hour out for half the
 * year, a new patient reading as nought per cent, or an app cheerfully awarding
 * a badge over a list of missed doses.
 */
describe('medication and adherence', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let careTeam: CareTeamService;
  let notifications: NotificationsService;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (
    role: Role,
  ): Promise<{ token: string; userId: string; staffId?: string }> => {
    const email = `med-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: {
        role,
        email,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Med', lastName: role },
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
        mrn: `MRN-MED-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        birthDate: new Date('1981-04-02'),
        sex: Sex.FEMALE,
        country: 'DE',
        userId,
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  const prescribe = (
    patientId: string,
    token: string,
    body: Record<string, unknown> = {},
  ): request.Test =>
    request(server)
      .post(`/patients/${patientId}/medications`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        drugName: 'Amoksisilin',
        dose: '500 mg',
        frequencyRule: 'FREQ=DAILY;COUNT=16;BYHOUR=9,21',
        startDate: '2026-03-02T00:00:00.000Z',
        startTime: '09:00',
        ...body,
      });

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
    careTeam = app.get(CareTeamService);
    notifications = app.get(NotificationsService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.medicationLog.deleteMany({
      where: { medication: { patientId: { in: patientIds } } },
    });
    await prisma.medication.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patientAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('writing a prescription', () => {
    /** "Twice a day for eight days" is sixteen doses over eight days. */
    it('generates the whole course from the rule', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      const view = (await prescribe(patientId, doctor.token).expect(201)).body as View;

      const logs = await prisma.medicationLog.findMany({
        where: { medicationId: view.medication.id },
        orderBy: { scheduledAt: 'asc' },
      });

      expect(logs).toHaveLength(16);
      expect(view.schedule).toContain('günde 2');
      expect(view.medication.source).toBe(MedicationSource.PRESCRIBED);
      // Prescribed by a clinician, so it is live immediately.
      expect(view.medication.approvedAt).not.toBeNull();
    });

    it('generates the doses in the patient\'s own timezone', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      const view = (
        await prescribe(patientId, doctor.token, {
          timezone: 'Europe/Berlin',
          frequencyRule: 'FREQ=DAILY;COUNT=2;BYHOUR=9',
        }).expect(201)
      ).body as View;

      const logs = await prisma.medicationLog.findMany({
        where: { medicationId: view.medication.id },
        orderBy: { scheduledAt: 'asc' },
      });

      const berlin = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        hour12: false,
      });

      expect(view.medication.timezone).toBe('Europe/Berlin');
      expect(logs.map((log) => berlin.format(log.scheduledAt))).toEqual(['09', '09']);
    });

    /**
     * A rule this system cannot read is one a clinician wrote expecting
     * something to happen. It is refused at the point of writing.
     */
    it('refuses a rule it cannot read, and says why', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      const response = await prescribe(patientId, doctor.token, {
        frequencyRule: 'FREQ=MONTHLY;COUNT=3',
      }).expect(400);

      expect(JSON.stringify(response.body)).toContain('MONTHLY');
    });

    /** A rule bounded by nothing is not a prescription, it is a loop. */
    it('refuses a course with no end at all', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prescribe(patientId, doctor.token, { frequencyRule: 'FREQ=DAILY' }).expect(400);
    });

    it('does not let a nurse prescribe', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patientId = await makePatient();

      await prescribe(patientId, nurse.token).expect(403);
    });
  });

  describe('what the patient adds themselves', () => {
    /**
     * Recorded but inert. A calendar generated from an unapproved entry would
     * have the app reminding somebody to take a drug no clinician has seen —
     * and counting them down for missing it.
     */
    it('is stored with no schedule until a clinician approves it', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const view = (
        await request(server)
          .post('/me/medications')
          .set('Authorization', `Bearer ${patient.token}`)
          .send({
            drugName: 'D vitamini',
            dose: '1000 IU',
            frequencyRule: 'FREQ=DAILY;COUNT=30',
            startDate: '2026-03-02T00:00:00.000Z',
          })
          .expect(201)
      ).body as View;

      expect(view.medication.source).toBe(MedicationSource.PATIENT_REPORTED);
      expect(view.medication.approvedAt).toBeNull();
      expect(
        await prisma.medicationLog.count({ where: { medicationId: view.medication.id } }),
      ).toBe(0);
    });

    it('starts its schedule when a clinician approves it', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const created = (
        await request(server)
          .post('/me/medications')
          .set('Authorization', `Bearer ${patient.token}`)
          .send({
            drugName: 'D vitamini',
            dose: '1000 IU',
            frequencyRule: 'FREQ=DAILY;COUNT=5',
            startDate: '2026-03-02T00:00:00.000Z',
          })
          .expect(201)
      ).body as View;

      await request(server)
        .patch(`/medications/${created.medication.id}/approve`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(
        await prisma.medicationLog.count({ where: { medicationId: created.medication.id } }),
      ).toBe(5);
    });

    it('refuses a second approval', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();
      const view = (await prescribe(patientId, doctor.token).expect(201)).body as View;

      // A prescribed course is already approved.
      await request(server)
        .patch(`/medications/${view.medication.id}/approve`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(400);
    });
  });

  describe('checking in', () => {
    const doseFor = async (patientId: string, at: Date): Promise<string> => {
      const log = await prisma.medicationLog.findFirstOrThrow({
        where: { medication: { patientId } },
        orderBy: { scheduledAt: 'asc' },
      });

      await prisma.medicationLog.update({ where: { id: log.id }, data: { scheduledAt: at } });

      return log.id;
    };

    it('marks a dose taken', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prescribe(patientId, doctor.token).expect(201);

      const logId = await doseFor(patientId, new Date());

      const response = await request(server)
        .patch(`/me/medications/doses/${logId}`)
        .set('Authorization', `Bearer ${patient.token}`)
        .send({ action: 'taken' })
        .expect(200);

      expect((response.body as { status: string }).status).toBe(MedicationLogStatus.TAKEN);
    });

    /**
     * Late is recorded as late and still counts. A patient who took the eight
     * o'clock dose at eleven took it, and scoring that as a miss teaches them
     * the app is not worth being honest with.
     */
    it('records a dose taken hours later as late, not missed', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prescribe(patientId, doctor.token).expect(201);

      const logId = await doseFor(patientId, new Date(Date.now() - 5 * 60 * 60 * 1000));

      const response = await request(server)
        .patch(`/me/medications/doses/${logId}`)
        .set('Authorization', `Bearer ${patient.token}`)
        .send({ action: 'taken' })
        .expect(200);

      expect((response.body as { status: string }).status).toBe(MedicationLogStatus.LATE);
    });

    it('snoozes a dose and lets the reminder come back', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prescribe(patientId, doctor.token).expect(201);

      const logId = await doseFor(patientId, new Date());
      await prisma.medicationLog.update({ where: { id: logId }, data: { notifiedAt: new Date() } });

      await request(server)
        .patch(`/me/medications/doses/${logId}`)
        .set('Authorization', `Bearer ${patient.token}`)
        .send({ action: 'snooze', snoozeMinutes: 30 })
        .expect(200);

      const log = await prisma.medicationLog.findUniqueOrThrow({ where: { id: logId } });
      expect(log.status).toBe(MedicationLogStatus.SNOOZED);
      expect(log.snoozedUntil).not.toBeNull();
      // Cleared, so the reminder goes again when the snooze runs out.
      expect(log.notifiedAt).toBeNull();
    });

    it('refuses to mark a dose twice', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prescribe(patientId, doctor.token).expect(201);

      const logId = await doseFor(patientId, new Date());

      await request(server)
        .patch(`/me/medications/doses/${logId}`)
        .set('Authorization', `Bearer ${patient.token}`)
        .send({ action: 'taken' })
        .expect(200);

      await request(server)
        .patch(`/me/medications/doses/${logId}`)
        .set('Authorization', `Bearer ${patient.token}`)
        .send({ action: 'skipped' })
        .expect(400);
    });

    it('does not let one patient mark another\'s dose', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const owner = await actorFor(Role.PATIENT);
      const stranger = await actorFor(Role.PATIENT);
      const patientId = await makePatient(owner.userId);
      await makePatient(stranger.userId);
      await prescribe(patientId, doctor.token).expect(201);

      const logId = await doseFor(patientId, new Date());

      await request(server)
        .patch(`/me/medications/doses/${logId}`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .send({ action: 'taken' })
        .expect(404);
    });
  });

  describe("the patient's own screen", () => {
    /**
     * A plan written this morning must not read as nought per cent this
     * afternoon — that is the number the clinic warning fires on.
     */
    it('has no score at all before any dose has come due', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      await prescribe(patientId, doctor.token, {
        startDate: new Date(Date.now() + 86_400_000).toISOString(),
      }).expect(201);

      const response = await request(server)
        .get('/me/medications')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      const body = response.body as { overall: { score: number | null }; badges: string[] };
      expect(body.overall.score).toBeNull();
      expect(body.badges).toEqual([]);
    });

    /**
     * M9 asks for restraint. A "three day streak" card over a list of missed
     * doses is the app being pleased with itself at somebody having a hard week.
     */
    it('withholds the badges while a course is going badly', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const view = (await prescribe(patientId, doctor.token).expect(201)).body as View;

      const logs = await prisma.medicationLog.findMany({
        where: { medicationId: view.medication.id },
        orderBy: { scheduledAt: 'asc' },
        take: 8,
      });

      // One taken, seven missed, all well past their grace period.
      for (const [index, log] of logs.entries()) {
        await prisma.medicationLog.update({
          where: { id: log.id },
          data: {
            scheduledAt: new Date(Date.now() - (index + 1) * 24 * 60 * 60 * 1000),
            status: index === 0 ? MedicationLogStatus.TAKEN : MedicationLogStatus.SKIPPED,
          },
        });
      }

      const response = await request(server)
        .get('/me/medications')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      const body = response.body as { overall: { score: number }; badges: string[] };
      expect(body.overall.score).toBeLessThan(0.5);
      expect(body.badges).toEqual([]);
    });
  });

  describe('stopping a course', () => {
    /**
     * The past is the record of what the patient actually did, and deleting it
     * would rewrite an adherence score a clinical decision may rest on.
     */
    it('drops the doses ahead and keeps the ones already past', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();
      const view = (await prescribe(patientId, doctor.token).expect(201)).body as View;

      const logs = await prisma.medicationLog.findMany({
        where: { medicationId: view.medication.id },
        orderBy: { scheduledAt: 'asc' },
      });

      await prisma.medicationLog.update({
        where: { id: logs[0]!.id },
        data: {
          scheduledAt: new Date(Date.now() - 86_400_000),
          status: MedicationLogStatus.TAKEN,
        },
      });
      // Distinct times: (medication, scheduledAt) is unique, which is the
      // constraint that stops a course generating the same dose twice.
      for (const [index, log] of logs.slice(1).entries()) {
        await prisma.medicationLog.update({
          where: { id: log.id },
          data: { scheduledAt: new Date(Date.now() + (index + 1) * 3_600_000) },
        });
      }

      await request(server)
        .patch(`/medications/${view.medication.id}/stop`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const remaining = await prisma.medicationLog.findMany({
        where: { medicationId: view.medication.id },
      });

      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.status).toBe(MedicationLogStatus.TAKEN);
    });
  });

  describe('the sweep', () => {
    it('reminds a patient once per dose', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const view = (await prescribe(patientId, doctor.token).expect(201)).body as View;

      const log = await prisma.medicationLog.findFirstOrThrow({
        where: { medicationId: view.medication.id },
      });
      await prisma.medicationLog.update({
        where: { id: log.id },
        data: { scheduledAt: new Date(Date.now() - 60_000) },
      });

      const sweep = medicationSweep(
        prisma as unknown as PrismaService,
        careTeam,
        notifications,
      );

      await sweep({ data: {} } as never);
      await sweep({ data: {} } as never);

      // Twice through the sweep, one reminder.
      expect(
        await prisma.notification.count({
          where: {
            userId: patient.userId,
            type: NOTIFICATION_TYPES.medicationDue,
            channel: NotificationChannel.PUSH,
          },
        }),
      ).toBe(1);
    });

    /**
     * The pattern is what matters. One missed dose out of two is thirty-three
     * per cent and means nothing.
     */
    it('tells the care team when a course is genuinely not being taken', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prisma.patientAssignment.create({
        data: { patientId, staffId: nurse.staffId!, role: Role.NURSE },
      });

      const view = (await prescribe(patientId, doctor.token).expect(201)).body as View;
      const logs = await prisma.medicationLog.findMany({
        where: { medicationId: view.medication.id },
        orderBy: { scheduledAt: 'asc' },
        take: 10,
      });

      for (const [index, log] of logs.entries()) {
        await prisma.medicationLog.update({
          where: { id: log.id },
          data: {
            scheduledAt: new Date(Date.now() - (index + 1) * 12 * 60 * 60 * 1000),
            status: index < 6 ? MedicationLogStatus.SKIPPED : MedicationLogStatus.TAKEN,
            notifiedAt: new Date(),
          },
        });
      }

      await medicationSweep(prisma as unknown as PrismaService, careTeam, notifications)({
        data: {},
      } as never);

      expect(
        await prisma.notification.count({
          where: {
            userId: nurse.userId,
            type: NOTIFICATION_TYPES.medicationAdherenceLow,
            channel: NotificationChannel.PUSH,
          },
        }),
      ).toBe(1);
    });

    /**
     * The design the test above caught: an adherence warning is a pattern over
     * days, not an emergency, so an unassigned patient does not page the whole
     * clinic. The answer to a patient with nobody is to assign somebody.
     */
    it('does not tell the whole clinic about a patient nobody is assigned to', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const onRota = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const view = (await prescribe(patientId, doctor.token).expect(201)).body as View;
      const logs = await prisma.medicationLog.findMany({
        where: { medicationId: view.medication.id },
        orderBy: { scheduledAt: 'asc' },
        take: 10,
      });

      for (const [index, log] of logs.entries()) {
        await prisma.medicationLog.update({
          where: { id: log.id },
          data: {
            scheduledAt: new Date(Date.now() - (index + 1) * 12 * 60 * 60 * 1000),
            status: MedicationLogStatus.SKIPPED,
            notifiedAt: new Date(),
          },
        });
      }

      await medicationSweep(prisma as unknown as PrismaService, careTeam, notifications)({
        data: {},
      } as never);

      expect(
        await prisma.notification.count({
          where: {
            userId: onRota.userId,
            type: NOTIFICATION_TYPES.medicationAdherenceLow,
            data: { path: ['medicationId'], equals: view.medication.id },
          },
        }),
      ).toBe(0);
    });

    it('tells the patient when the medicine is about to run out', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const view = (
        await prescribe(patientId, doctor.token, {
          frequencyRule: 'FREQ=DAILY;COUNT=2;BYHOUR=9',
        }).expect(201)
      ).body as View;

      const logs = await prisma.medicationLog.findMany({
        where: { medicationId: view.medication.id },
        orderBy: { scheduledAt: 'asc' },
      });

      await prisma.medicationLog.update({
        where: { id: logs[0]!.id },
        data: {
          scheduledAt: new Date(Date.now() - 86_400_000),
          status: MedicationLogStatus.TAKEN,
        },
      });
      await prisma.medicationLog.update({
        where: { id: logs[1]!.id },
        data: { scheduledAt: new Date(Date.now() + 60 * 60 * 1000), notifiedAt: new Date() },
      });

      await medicationSweep(prisma as unknown as PrismaService, careTeam, notifications)({
        data: {},
      } as never);

      expect(
        await prisma.notification.count({
          where: { userId: patient.userId, type: NOTIFICATION_TYPES.medicationRenewal },
        }),
      ).toBeGreaterThan(0);
    });
  });
});
