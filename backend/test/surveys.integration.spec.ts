import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  PrismaClient,
  Role,
  Sex,
  SurveyStatus,
  UserStatus,
} from '@prisma/client';
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
import { NOTIFICATION_TYPES } from '../src/notifications/templates';
import { surveySweep } from '../src/surveys/surveys.processor';
import { SurveysService } from '../src/surveys/surveys.service';
import { NotificationsService } from '../src/notifications/notifications.service';

const prisma = new PrismaClient();

interface PendingSurvey {
  id: string;
  title: string;
  milestoneDays: number;
  expiresAt: string | null;
  questions: { id: string; type: string; direction?: string }[];
}

interface SurveyView {
  series: {
    milestoneDays: number;
    values: Record<string, number>;
    answeredCount: number;
    questionCount: number;
    partial: boolean;
  }[];
  latestFindings: { kind: string; questionId: string; value: number; previous?: number }[];
  hasTrend: boolean;
  pending: { id: string; status: SurveyStatus }[];
}

/**
 * Patient-reported outcome questionnaires (spec M18, T6.7).
 *
 * The properties under test: an answer that does not fit is refused rather
 * than coerced, a worsening trend reaches the assigned team and nobody else,
 * and the patient is never handed a clinical reading of their own answers.
 */
describe('surveys', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let surveys: SurveysService;
  let sweep: () => Promise<void>;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (
    role: Role,
  ): Promise<{ token: string; userId: string; staffId?: string }> => {
    const email = `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
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
        data: { userId: user.id, firstName: 'Ayşe', lastName: role },
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

  /** A patient with an account, so they can answer. */
  const makePatient = async (userId?: string): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-SRV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  /** One questionnaire, due now. */
  const assign = async (patientId: string, milestoneDays = 7): Promise<string> => {
    const template = await surveys.currentTemplate('postop');
    const assignment = await prisma.surveyAssignment.create({
      data: {
        patientId,
        templateId: template.id,
        milestoneDays,
        scheduledFor: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return assignment.id;
  };

  const submit = (token: string, id: string, answers: Record<string, unknown>): request.Test =>
    request(server)
      .post(`/me/surveys/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers });

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
    surveys = app.get(SurveysService);
    sweep = surveySweep(
      app.get(PrismaService),
      surveys,
      app.get(NotificationsService),
    ) as () => Promise<void>;

    await surveys.ensureStarterTemplates();

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.surveyResponse.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.surveyAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.followUpMilestone.deleteMany({
      where: { schedule: { patientId: { in: patientIds } } },
    });
    await prisma.followUpSchedule.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patientAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('the starter questionnaire', () => {
    it('is written once and never edited under a stored answer', async () => {
      // A template version is frozen the moment anybody answers it: editing
      // the questions in place would move a trend line because somebody fixed
      // a typo.
      const again = await surveys.ensureStarterTemplates();

      expect(again).toBe(0);

      const versions = await prisma.surveyTemplate.findMany({ where: { code: 'postop' } });
      expect(versions).toHaveLength(1);
    });
  });

  describe('answering', () => {
    it('shows the patient what they have been asked', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId);

      const pending = (
        await request(server)
          .get('/me/surveys')
          .set('Authorization', `Bearer ${patient.token}`)
          .expect(200)
      ).body as PendingSurvey[];

      expect(pending).toHaveLength(1);
      expect(pending[0]!.questions.map((question) => question.id)).toEqual(
        expect.arrayContaining(['pain', 'swelling', 'sleep', 'satisfaction']),
      );
      expect(pending[0]!.expiresAt).not.toBeNull();
    });

    it('records an answer and says nothing clinical back to the patient', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const id = await assign(patientId);

      const response = await submit(patient.token, id, {
        pain: 3,
        swelling: 2,
        sleep: 8,
        satisfaction: 10,
      }).expect(201);

      // "Your reported pain has worsened" is a clinical reading, and this is
      // not the thing that should deliver one.
      expect(Object.keys(response.body as object)).toEqual(['invited']);

      const stored = await prisma.surveyResponse.findFirstOrThrow({ where: { patientId } });
      expect(stored.answeredCount).toBe(4);
      expect(stored.templateVersion).toBe(1);
    });

    it('refuses an answer that does not fit rather than coercing it', async () => {
      // Coercion is how a blank becomes a nought, and nought out of ten pain
      // is a clinical claim nobody made.
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const id = await assign(patientId);

      await submit(patient.token, id, { pain: 47 }).expect(400);
      await submit(patient.token, id, { pain: 'çok' }).expect(400);
      await submit(patient.token, id, { pain: 4, mood: 3 }).expect(400);

      // And nothing was written by any of them.
      expect(await prisma.surveyResponse.count({ where: { patientId } })).toBe(0);
    });

    it('insists on the required question', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const id = await assign(patientId);

      await submit(patient.token, id, { sleep: 8 }).expect(400);
    });

    it('refuses a second answer to the same questionnaire', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const id = await assign(patientId);

      await submit(patient.token, id, { pain: 3 }).expect(201);
      await submit(patient.token, id, { pain: 9 }).expect(409);
    });

    it('refuses one whose window has closed', async () => {
      // A pain score given three weeks after the week it was about is a
      // memory, and filing it at that milestone would record something that
      // did not happen.
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const id = await assign(patientId);

      await prisma.surveyAssignment.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await submit(patient.token, id, { pain: 3 }).expect(400);
    });

    it('is not somebody else\'s questionnaire to answer', async () => {
      const mine = await actorFor(Role.PATIENT);
      const theirs = await actorFor(Role.PATIENT);
      await makePatient(mine.userId);
      const otherPatientId = await makePatient(theirs.userId);
      const id = await assign(otherPatientId);

      await submit(mine.token, id, { pain: 3 }).expect(404);
    });
  });

  describe('what the clinic is told', () => {
    /** A patient with a doctor assigned to them. */
    const patientWithTeam = async (): Promise<{
      patientToken: string;
      patientId: string;
      doctorUserId: string;
    }> => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      // The doctor of record is a column on the patient; a PatientAssignment
      // with role DOCTOR is not how the care team is expressed.
      await prisma.patient.update({
        where: { id: patientId },
        data: { assignedDoctorId: doctor.staffId },
      });

      return { patientToken: patient.token, patientId, doctorUserId: doctor.userId };
    };

    const warningsFor = async (userId: string): Promise<number> =>
      prisma.notification.count({
        where: { userId, type: NOTIFICATION_TYPES.surveyWorsening },
      });

    it('says nothing on a first, unremarkable response', async () => {
      const { patientToken, patientId, doctorUserId } = await patientWithTeam();
      const id = await assign(patientId, 7);

      await submit(patientToken, id, { pain: 3, sleep: 8 }).expect(201);

      expect(await warningsFor(doctorUserId)).toBe(0);
    });

    it('tells the assigned team when a score slides', async () => {
      const { patientToken, patientId, doctorUserId } = await patientWithTeam();

      await submit(patientToken, await assign(patientId, 7), { pain: 2 }).expect(201);
      await submit(patientToken, await assign(patientId, 30), { pain: 7 }).expect(201);

      expect(await warningsFor(doctorUserId)).toBe(1);
    });

    it('ignores ordinary week-to-week variation', async () => {
      const { patientToken, patientId, doctorUserId } = await patientWithTeam();

      await submit(patientToken, await assign(patientId, 7), { pain: 4 }).expect(201);
      await submit(patientToken, await assign(patientId, 30), { pain: 6 }).expect(201);

      expect(await warningsFor(doctorUserId)).toBe(0);
    });

    it('speaks up on a first response that is severe on its own', async () => {
      const { patientToken, patientId, doctorUserId } = await patientWithTeam();

      await submit(patientToken, await assign(patientId, 7), { pain: 9 }).expect(201);

      expect(await warningsFor(doctorUserId)).toBe(1);
    });

    it('pages nobody when the patient has no assigned team', async () => {
      // The lesson from the medication warning: an alert that goes to
      // everybody belongs to nobody.
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const bystander = await actorFor(Role.DOCTOR);

      await submit(patient.token, await assign(patientId, 7), { pain: 10 }).expect(201);

      expect(await warningsFor(bystander.userId)).toBe(0);
    });

    it('invites a review only from a very satisfied patient', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const happy = (
        await submit(patient.token, await assign(patientId, 7), {
          pain: 1,
          satisfaction: 10,
        }).expect(201)
      ).body as { invited: boolean };

      expect(happy.invited).toBe(true);

      const unhappy = await actorFor(Role.PATIENT);
      const unhappyId = await makePatient(unhappy.userId);

      const result = (
        await submit(unhappy.token, await assign(unhappyId, 7), {
          pain: 8,
          satisfaction: 2,
        }).expect(201)
      ).body as { invited: boolean };

      // Turning a complaint into an automated message is how a clinic makes
      // an unhappy patient angry.
      expect(result.invited).toBe(false);
      expect(
        await prisma.notification.count({
          where: { userId: unhappy.userId, type: NOTIFICATION_TYPES.surveyReviewInvite },
        }),
      ).toBe(0);
    });
  });

  describe('the clinician view', () => {
    it('draws no trend through a single point', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      await submit(patient.token, await assign(patientId, 7), { pain: 5 }).expect(201);

      const view = (
        await request(server)
          .get(`/patients/${patientId}/surveys`)
          .set('Authorization', `Bearer ${doctor.token}`)
          .expect(200)
      ).body as SurveyView;

      expect(view.series).toHaveLength(1);
      expect(view.hasTrend).toBe(false);
    });

    it('shows the series in time order with the partial ones marked', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      // One question of five: still recorded, but not the same kind of point
      // as a full response beside it.
      await submit(patient.token, await assign(patientId, 7), { pain: 2 }).expect(201);
      await submit(patient.token, await assign(patientId, 30), {
        pain: 3,
        swelling: 2,
        sleep: 8,
        satisfaction: 9,
      }).expect(201);

      const view = (
        await request(server)
          .get(`/patients/${patientId}/surveys`)
          .set('Authorization', `Bearer ${doctor.token}`)
          .expect(200)
      ).body as SurveyView;

      expect(view.series.map((point) => point.milestoneDays)).toEqual([7, 30]);
      expect(view.series[0]!.partial).toBe(true);
      expect(view.series[1]!.partial).toBe(false);
      expect(view.hasTrend).toBe(true);
    });

    it('is refused to somebody with no clinical access', async () => {
      const finance = await actorFor(Role.FINANCE);
      const patientId = await makePatient();

      const response = await request(server)
        .get(`/patients/${patientId}/surveys`)
        .set('Authorization', `Bearer ${finance.token}`);

      expect([403, 404]).toContain(response.status);
    });
  });

  describe('scheduling from the operation date', () => {
    it('puts the milestones in the diary when the follow-up is generated', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await request(server)
        .post(`/patients/${patientId}/follow-up`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ surgeryDate: '2026-03-02T09:00:00.000Z' })
        .expect(201);

      const assignments = await prisma.surveyAssignment.findMany({ where: { patientId } });

      expect(assignments.length).toBeGreaterThan(0);
      expect(assignments.map((a) => a.milestoneDays).sort((a, b) => a - b)).toEqual([
        7, 30, 90, 180,
      ]);
    });

    it('moves an unanswered questionnaire when the operation is postponed', async () => {
      // A questionnaire still asking about "one week after" from the old date
      // would arrive before the surgery.
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      const generate = (date: string): request.Test =>
        request(server)
          .post(`/patients/${patientId}/follow-up`)
          .set('Authorization', `Bearer ${doctor.token}`)
          .send({ surgeryDate: date });

      await generate('2026-03-02T09:00:00.000Z').expect(201);
      const before = await prisma.surveyAssignment.findFirstOrThrow({
        where: { patientId, milestoneDays: 7 },
      });

      await generate('2026-04-02T09:00:00.000Z').expect(201);
      const after = await prisma.surveyAssignment.findFirstOrThrow({
        where: { patientId, milestoneDays: 7 },
      });

      expect(after.id).toBe(before.id);
      expect(after.scheduledFor.getTime()).toBeGreaterThan(before.scheduledFor.getTime());
    });

    it('leaves an answered questionnaire exactly where it is', async () => {
      // It is the patient's record of that week; regenerating over it would
      // throw away what they said.
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      await request(server)
        .post(`/patients/${patientId}/follow-up`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ surgeryDate: '2026-03-02T09:00:00.000Z' })
        .expect(201);

      const first = await prisma.surveyAssignment.findFirstOrThrow({
        where: { patientId, milestoneDays: 7 },
      });
      await prisma.surveyAssignment.update({
        where: { id: first.id },
        data: {
          scheduledFor: new Date(Date.now() - 60_000),
          // The operation date used here is in the past, so this milestone's
          // window has genuinely closed. Reopen it to test the postponement.
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await submit(patient.token, first.id, { pain: 4 }).expect(201);

      await request(server)
        .post(`/patients/${patientId}/follow-up`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ surgeryDate: '2026-05-02T09:00:00.000Z' })
        .expect(201);

      const after = await prisma.surveyAssignment.findUniqueOrThrow({ where: { id: first.id } });

      expect(after.status).toBe(SurveyStatus.COMPLETED);
      expect(await prisma.surveyResponse.count({ where: { assignmentId: first.id } })).toBe(1);
    });
  });

  describe('the sweep', () => {
    it('asks a questionnaire once, not every time it runs', async () => {
      // A patient who gets the same questionnaire every hour stops reading
      // anything this app sends.
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId);

      await sweep();
      await sweep();

      expect(
        await prisma.notification.count({
          where: { userId: patient.userId, type: NOTIFICATION_TYPES.surveyDue },
        }),
      ).toBe(1);
    });

    it('closes the window on one nobody answered', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const id = await assign(patientId);

      await prisma.surveyAssignment.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await sweep();

      const after = await prisma.surveyAssignment.findUniqueOrThrow({ where: { id } });
      expect(after.status).toBe(SurveyStatus.EXPIRED);
    });

    it('does not ask a patient who has no account yet', async () => {
      // The file exists before the login does; the assignment still expires on
      // schedule rather than waiting for ever.
      const patientId = await makePatient();
      const id = await assign(patientId);

      await sweep();

      const after = await prisma.surveyAssignment.findUniqueOrThrow({ where: { id } });
      expect(after.status).toBe(SurveyStatus.SENT);
    });
  });
});
