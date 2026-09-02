import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  MilestoneStatus,
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
import { FollowUpService } from '../src/followup/followup.service';
import { localDate } from '../src/common/local-calendar';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

interface ScheduleBody {
  id: string;
  surgeryDate: string;
  template: string;
  milestones: { id: string; label: string; dueAt: string; status: string }[];
}

/**
 * The check-up calendar (spec M6).
 *
 * The dates are the product here: one that is a day out looks entirely
 * plausible and its only symptom is a patient called on the wrong day. The
 * cases below are the ones where that happens — a postponed operation, a
 * visit the patient already made, and the month-end arithmetic.
 */
describe('follow-up schedules', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let followUp: FollowUpService;
  let doctor: { token: string; userId: string };

  const PASSWORD = 'correct-horse-battery-9';
  const istanbul = 'Europe/Istanbul';

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `fu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Fu', lastName: role },
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

  const makePatient = async (userId?: string): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-FU-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const generate = (
    patientId: string,
    body: Record<string, unknown>,
    token = doctor.token,
  ): request.Test =>
    request(server)
      .post(`/patients/${patientId}/follow-up`)
      .set('Authorization', `Bearer ${token}`)
      .send({ timezone: istanbul, ...body });

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
    followUp = app.get(FollowUpService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();

    doctor = await actorFor(Role.DOCTOR);
  });

  afterAll(async () => {
    await prisma.followUpMilestone.deleteMany({
      where: { schedule: { patientId: { in: patientIds } } },
    });
    await prisma.followUpSchedule.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('generating', () => {
    it('produces the milestones the spec names, soonest first', async () => {
      const patientId = await makePatient();

      const response = await generate(patientId, {
        surgeryDate: '2026-03-02T09:00:00.000Z',
      }).expect(201);

      const schedule = response.body as ScheduleBody;

      expect(schedule.milestones.map((m) => m.label)).toEqual([
        'D1',
        'W1',
        'M1',
        'M2',
        'M3',
        'M6',
        'Y1',
      ]);
      expect(schedule.milestones.every((m) => m.status === MilestoneStatus.PENDING)).toBe(true);
    });

    it('uses the template for the procedure', async () => {
      const patientId = await makePatient();

      const response = await generate(patientId, {
        surgeryDate: '2026-03-02T09:00:00.000Z',
        template: 'hairTransplant',
      }).expect(201);

      expect((response.body as ScheduleBody).milestones.map((m) => m.label)).toContain('D3');
    });

    it('refuses a template nobody defined', async () => {
      const patientId = await makePatient();

      await generate(patientId, {
        surgeryDate: '2026-03-02T09:00:00.000Z',
        template: 'nonsense',
      }).expect(400);
    });

    /** The reminder lands in working hours, not at the hour of the operation. */
    it('puts every milestone at ten in the morning, clinic time', async () => {
      const patientId = await makePatient();

      // 23:30 in Istanbul.
      const response = await generate(patientId, {
        surgeryDate: '2026-03-01T20:30:00.000Z',
      }).expect(201);

      const hours = (response.body as ScheduleBody).milestones.map((m) =>
        new Intl.DateTimeFormat('en-GB', {
          timeZone: istanbul,
          hour: '2-digit',
          hour12: false,
        }).format(new Date(m.dueAt)),
      );

      expect(new Set(hours)).toEqual(new Set(['10']));
    });

    /** The clamp, seen end to end: 31 January plus a month is 28 February. */
    it('keeps a month-end operation inside the month each check belongs to', async () => {
      const patientId = await makePatient();

      const response = await generate(patientId, {
        surgeryDate: '2026-01-31T09:00:00.000Z',
      }).expect(201);

      const on = (label: string): { month: number; day: number } => {
        const found = (response.body as ScheduleBody).milestones.find((m) => m.label === label)!;
        const parts = localDate(new Date(found.dueAt), istanbul);
        return { month: parts.month, day: parts.day };
      };

      expect(on('M1')).toEqual({ month: 2, day: 28 });
      expect(on('M2')).toEqual({ month: 3, day: 31 });
    });

    it('refuses a role without appointments.write', async () => {
      const patientId = await makePatient();
      const finance = await actorFor(Role.FINANCE);

      await generate(patientId, { surgeryDate: '2026-03-02T09:00:00.000Z' }, finance.token)
        .expect(403);
    });

    /**
     * A coordinator, who holds appointments.write but is not on this patient's
     * team. A nurse would be refused by the permission guard first, and that
     * 403 says nothing about the record — it is the same for every id.
     */
    it('reports not found for a patient outside the caller scope', async () => {
      const patientId = await makePatient();
      const coordinator = await actorFor(Role.COORDINATOR);

      await generate(patientId, { surgeryDate: '2026-03-02T09:00:00.000Z' }, coordinator.token)
        .expect(404);
    });
  });

  describe('a postponed operation', () => {
    /**
     * One operation, one schedule. Leaving the old dates beside the new ones
     * would give a clinician two calendars and no way to tell which is real.
     */
    it('moves every check-up rather than adding a second schedule', async () => {
      const patientId = await makePatient();

      const first = (
        await generate(patientId, { surgeryDate: '2026-03-02T09:00:00.000Z' }).expect(201)
      ).body as ScheduleBody;

      const second = (
        await generate(patientId, { surgeryDate: '2026-04-06T09:00:00.000Z' }).expect(201)
      ).body as ScheduleBody;

      expect(second.id).toBe(first.id);
      expect(await prisma.followUpSchedule.count({ where: { patientId } })).toBe(1);

      const d1 = second.milestones.find((m) => m.label === 'D1')!;
      expect(localDate(new Date(d1.dueAt), istanbul)).toMatchObject({ month: 4, day: 7 });
      expect(second.milestones).toHaveLength(7);
    });

    /**
     * Regenerating over a visit the patient already made would ask them to come
     * back for something they have done.
     */
    it('keeps a check-up the patient already attended', async () => {
      const patientId = await makePatient();

      const first = (
        await generate(patientId, { surgeryDate: '2026-03-02T09:00:00.000Z' }).expect(201)
      ).body as ScheduleBody;

      const d1 = first.milestones.find((m) => m.label === 'D1')!;

      await request(server)
        .patch(`/follow-up/milestones/${d1.id}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ status: MilestoneStatus.COMPLETED })
        .expect(200);

      const second = (
        await generate(patientId, { surgeryDate: '2026-04-06T09:00:00.000Z' }).expect(201)
      ).body as ScheduleBody;

      const kept = second.milestones.find((m) => m.id === d1.id);

      expect(kept).toBeDefined();
      expect(kept!.status).toBe(MilestoneStatus.COMPLETED);
      // And it was not duplicated by the regeneration.
      expect(second.milestones.filter((m) => m.label === 'D1')).toHaveLength(1);
    });
  });

  describe('marking a check-up', () => {
    const firstMilestone = async (patientId: string): Promise<string> => {
      const schedule = (
        await generate(patientId, { surgeryDate: '2026-03-02T09:00:00.000Z' }).expect(201)
      ).body as ScheduleBody;

      return schedule.milestones[0]!.id;
    };

    it('records that the patient came', async () => {
      const patientId = await makePatient();
      const milestoneId = await firstMilestone(patientId);

      const response = await request(server)
        .patch(`/follow-up/milestones/${milestoneId}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ status: MilestoneStatus.COMPLETED })
        .expect(200);

      expect((response.body as { completedAt: string | null }).completedAt).not.toBeNull();
    });

    it('records a check-up deliberately skipped', async () => {
      const patientId = await makePatient();
      const milestoneId = await firstMilestone(patientId);

      const response = await request(server)
        .patch(`/follow-up/milestones/${milestoneId}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ status: MilestoneStatus.SKIPPED })
        .expect(200);

      expect((response.body as { status: string }).status).toBe(MilestoneStatus.SKIPPED);
    });

    /**
     * Moving a milestone back to "not yet told" would re-notify the patient
     * about a visit they have already been reminded of.
     */
    it('refuses to put a milestone back to pending', async () => {
      const patientId = await makePatient();
      const milestoneId = await firstMilestone(patientId);

      await request(server)
        .patch(`/follow-up/milestones/${milestoneId}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ status: MilestoneStatus.PENDING })
        .expect(400);
    });

    it('reports not found for a milestone outside the caller scope', async () => {
      const patientId = await makePatient();
      const milestoneId = await firstMilestone(patientId);
      const coordinator = await actorFor(Role.COORDINATOR);

      await request(server)
        .patch(`/follow-up/milestones/${milestoneId}`)
        .set('Authorization', `Bearer ${coordinator.token}`)
        .send({ status: MilestoneStatus.COMPLETED })
        .expect(404);
    });
  });

  describe('the scheduler', () => {
    it('notifies a milestone that has come due', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      // An operation last month, so its D1 is already past.
      const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      await generate(patientId, { surgeryDate: past.toISOString() }).expect(201);

      const result = await followUp.processDue();

      expect(result.notified).toBeGreaterThanOrEqual(1);

      const notifications = await prisma.notification.findMany({
        where: { userId: patient.userId, type: 'appointment.reminder' },
      });
      expect(notifications.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Left PENDING, the sweep would pick the same milestone up every minute for
     * a year.
     */
    it('does not notify the same milestone twice', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      await generate(patientId, { surgeryDate: past.toISOString() }).expect(201);

      await followUp.processDue();
      const before = await prisma.notification.count({ where: { userId: patient.userId } });

      await followUp.processDue();
      const after = await prisma.notification.count({ where: { userId: patient.userId } });

      expect(after).toBe(before);
    });

    /** A milestone still ahead is not due. */
    it('leaves a future milestone alone', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const schedule = (
        await generate(patientId, { surgeryDate: future.toISOString() }).expect(201)
      ).body as ScheduleBody;

      await followUp.processDue();

      const stored = await prisma.followUpMilestone.findMany({
        where: { scheduleId: schedule.id },
      });

      expect(stored.every((m) => m.status === MilestoneStatus.PENDING)).toBe(true);
    });

    /**
     * Three days, not one: a patient who comes in on the Wednesday after a
     * Monday milestone has not missed it, and a list that says they have is a
     * list the clinic stops believing.
     */
    it('marks a milestone missed only after the grace period', async () => {
      const patientId = await makePatient();
      const schedule = (
        await generate(patientId, { surgeryDate: '2026-03-02T09:00:00.000Z' }).expect(201)
      ).body as ScheduleBody;

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [recent, old] = schedule.milestones;

      await prisma.followUpMilestone.update({
        where: { id: recent!.id },
        data: { status: MilestoneStatus.NOTIFIED, dueAt: yesterday },
      });
      await prisma.followUpMilestone.update({
        where: { id: old!.id },
        data: { status: MilestoneStatus.NOTIFIED, dueAt: lastWeek },
      });

      await followUp.processDue();

      expect(
        (await prisma.followUpMilestone.findUniqueOrThrow({ where: { id: recent!.id } })).status,
      ).toBe(MilestoneStatus.NOTIFIED);
      expect(
        (await prisma.followUpMilestone.findUniqueOrThrow({ where: { id: old!.id } })).status,
      ).toBe(MilestoneStatus.MISSED);
    });

    /**
     * A patient without an account still needs their milestone to move on, or
     * the sweep picks it up forever.
     */
    it('advances a milestone for a patient with no account yet', async () => {
      const patientId = await makePatient();
      const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const schedule = (
        await generate(patientId, { surgeryDate: past.toISOString() }).expect(201)
      ).body as ScheduleBody;

      await followUp.processDue();

      const d1 = await prisma.followUpMilestone.findUniqueOrThrow({
        where: { id: schedule.milestones[0]!.id },
      });

      expect(d1.status).not.toBe(MilestoneStatus.PENDING);
    });
  });

  describe('the patient view', () => {
    it('serves a patient their own dates', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await generate(patientId, { surgeryDate: '2026-03-02T09:00:00.000Z' }).expect(201);

      const response = await request(server)
        .get('/me/follow-up')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect((response.body as ScheduleBody).milestones).toHaveLength(7);
    });

    /** The staff route needs appointments.read, which patients do not have. */
    it('refuses a patient reaching for the staff route', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      await request(server)
        .get(`/patients/${patientId}/follow-up`)
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(403);
    });

    it('answers with nothing when no schedule has been generated', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const response = await request(server)
        .get('/me/follow-up')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect(response.body).toEqual({});
    });
  });
});
