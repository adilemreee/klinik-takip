import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  LabFlag,
  NotificationChannel,
  PrismaClient,
  RiskLevel,
  Role,
  Sex,
  UserStatus,
} from '@prisma/client';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AIService } from '../src/ai/ai.service';
import type { FetchLike } from '../src/ai/ai-provider';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { isStaffRole } from '../src/auth/auth.errors';
import { AuditService } from '../src/audit/audit.service';
import { CareTeamService } from '../src/authz/care-team.service';
import { PatientAccessService } from '../src/authz/patient-access.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../src/notifications/templates';
import { AIReportsService } from '../src/reports/ai-reports.service';

const prisma = new PrismaClient();

const modelSaying = (text: string, stopReason = 'end_turn'): FetchLike => () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () =>
      Promise.resolve(
        JSON.stringify({
          model: 'test-model-2026',
          content: [{ type: 'text', text }],
          stop_reason: stopReason,
          usage: { input_tokens: 300, output_tokens: 400 },
        }),
      ),
  });

const interpretation = (riskLevel: string): string =>
  JSON.stringify({
    riskLevel,
    doctorMd: '## Bulgular\nHemoglobin 6.0 g/dL — kritik düşük.',
    patientMd: 'Kan değerlerinizden biri beklenenin oldukça altında. Doktorunuz değerlendirecek.',
  });

/**
 * Lab interpretation, and the rule attached to it (spec M5).
 *
 * The rule is that nothing an AI wrote reaches a patient until a clinician has
 * read it. Most of these tests are about that rule holding when something goes
 * wrong — a truncated answer, an alarming one, a setting switched on.
 */
describe('AI lab reports', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let access: PatientAccessService;
  let careTeam: CareTeamService;
  let notifications: NotificationsService;
  let audit: AuditService;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ token: string; userId: string; staffId?: string }> => {
    const email = `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: {
        role,
        email,
        phone: `+9055${Math.floor(Math.random() * 100_000_000).toString().padStart(8, '0')}`,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Rep', lastName: role },
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
        mrn: `MRN-REP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const verifiedLab = async (patientId: string, verifiedById: string): Promise<void> => {
    await prisma.labResult.create({
      data: {
        patientId,
        analyteName: 'Hemoglobin',
        value: 6,
        unit: 'g/dL',
        refLow: 12,
        refHigh: 16,
        flag: LabFlag.CRITICAL,
        measuredAt: new Date('2026-03-01T08:00:00.000Z'),
        verifiedById,
        verifiedAt: new Date(),
      },
    });
  };

  const AI_ON = {
    AI_PROVIDER: 'anthropic',
    AI_API_KEY: 'sk-test',
    AI_MODEL: 'test-model',
    AI_PRICE_INPUT_PER_MTOK: 3,
    AI_PRICE_OUTPUT_PER_MTOK: 15,
    AI_ZERO_RETENTION: true,
    AI_TIMEOUT_MS: 5_000,
    AI_MAX_OUTPUT_TOKENS: 2_000,
    AI_MONTHLY_BUDGET_USD: undefined,
    AI_AUTO_RELEASE_LOW_RISK: false,
  };

  const reportsWith = (
    values: Record<string, unknown>,
    fetchImpl: FetchLike,
  ): AIReportsService => {
    const config = {
      get: (key: string) => values[key],
    } as unknown as ConfigService<Env, true>;

    const ai = new AIService(prisma as unknown as PrismaService, config, fetchImpl);
    ai.onModuleInit();

    return new AIReportsService(
      prisma as unknown as PrismaService,
      ai,
      access,
      careTeam,
      notifications,
      audit,
      config,
    );
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
    access = app.get(PatientAccessService);
    careTeam = app.get(CareTeamService);
    notifications = app.get(NotificationsService);
    audit = app.get(AuditService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.aiJob.deleteMany({});
    await prisma.aiReport.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.labResult.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.patientAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('producing an interpretation', () => {
    it('writes both renderings and records the model that answered', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();
      await verifiedLab(patientId, doctor.userId);

      const report = await reportsWith(AI_ON, modelSaying(interpretation('HIGH'))).generate(
        patientId,
        [
          {
            analyteName: 'Hemoglobin',
            value: 6,
            unit: 'g/dL',
            refLow: 12,
            refHigh: 16,
            flag: LabFlag.CRITICAL,
            measuredAt: new Date(),
          },
        ],
        doctor.userId,
      );

      expect(report?.riskLevel).toBe(RiskLevel.HIGH);
      expect(report?.contentMd).toContain('kritik düşük');
      expect(report?.patientFacingMd).toContain('beklenenin oldukça altında');
      // The dated version, not the alias asked for (spec section 14.6).
      expect(report?.model).toBe('test-model-2026');
      // Nothing reaches the patient without a clinician.
      expect(report?.releasedToPatientAt).toBeNull();
    });

    /**
     * The clinical caveats sit at the end of a summary, so half of one reads as
     * more certain than the whole — and a stored half is one a clinician can
     * release.
     */
    it('discards an answer the model was cut off in the middle of', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      const report = await reportsWith(
        AI_ON,
        modelSaying(interpretation('LOW'), 'max_tokens'),
      ).generate(
        patientId,
        [
          {
            analyteName: 'Hemoglobin',
            value: 13,
            unit: 'g/dL',
            refLow: 12,
            refHigh: 16,
            flag: LabFlag.NORMAL,
            measuredAt: new Date(),
          },
        ],
        doctor.userId,
      );

      expect(report).toBeNull();
      expect(await prisma.aiReport.count({ where: { patientId } })).toBe(0);
    });

    it('produces nothing when the model cannot be read', async () => {
      const patientId = await makePatient();

      const report = await reportsWith(AI_ON, modelSaying('Bunu yorumlayamıyorum.')).generate(
        patientId,
        [
          {
            analyteName: 'Üre',
            value: 30,
            unit: 'mg/dL',
            refLow: 15,
            refHigh: 45,
            flag: LabFlag.NORMAL,
            measuredAt: new Date(),
          },
        ],
        null,
      );

      expect(report).toBeNull();
    });

    it('tells the care team about an alarming panel', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patientId = await makePatient();
      await prisma.patientAssignment.create({
        data: { patientId, staffId: nurse.staffId!, role: Role.NURSE },
      });

      await reportsWith(AI_ON, modelSaying(interpretation('CRITICAL'))).generate(
        patientId,
        [
          {
            analyteName: 'Hemoglobin',
            value: 5,
            unit: 'g/dL',
            refLow: 12,
            refHigh: 16,
            flag: LabFlag.CRITICAL,
            measuredAt: new Date(),
          },
        ],
        null,
      );

      expect(
        await prisma.notification.count({
          where: {
            userId: nurse.userId,
            type: NOTIFICATION_TYPES.labCritical,
            channel: NotificationChannel.PUSH,
          },
        }),
      ).toBe(1);
    });

    it('refuses to interpret results nobody has verified', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();
      await prisma.labResult.create({
        data: {
          patientId,
          analyteName: 'Hemoglobin',
          value: 6,
          unit: 'g/dL',
          measuredAt: new Date(),
        },
      });

      await request(server)
        .post(`/patients/${patientId}/reports/lab`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(400);
    });
  });

  describe('what the patient can see', () => {
    it('shows nothing until a clinician releases it', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      await reportsWith(AI_ON, modelSaying(interpretation('MEDIUM'))).generate(
        patientId,
        [
          {
            analyteName: 'Hemoglobin',
            value: 11,
            unit: 'g/dL',
            refLow: 12,
            refHigh: 16,
            flag: LabFlag.LOW,
            measuredAt: new Date(),
          },
        ],
        doctor.userId,
      );

      const before = await request(server)
        .get('/me/reports')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect(before.body).toEqual([]);
    });

    it('shows the plain-language half once it is released, and never the clinical one', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const report = await reportsWith(AI_ON, modelSaying(interpretation('MEDIUM'))).generate(
        patientId,
        [
          {
            analyteName: 'Hemoglobin',
            value: 11,
            unit: 'g/dL',
            refLow: 12,
            refHigh: 16,
            flag: LabFlag.LOW,
            measuredAt: new Date(),
          },
        ],
        doctor.userId,
      );

      await request(server)
        .patch(`/reports/${report!.id}/review`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ release: true })
        .expect(200);

      const response = await request(server)
        .get('/me/reports')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      const items = response.body as {
        contentMd: string;
        disclaimer: string;
      }[];

      expect(items).toHaveLength(1);
      expect(items[0]!.contentMd).toContain('beklenenin oldukça altında');
      // The clinical rendering is a different document, written for someone who
      // reads hedged language as hedged.
      expect(items[0]!.contentMd).not.toContain('kritik düşük');
      expect(JSON.stringify(items[0])).not.toContain('riskLevel');
      // Every AI output carries the warning (spec M5).
      expect(items[0]!.disclaimer).toContain('tanı yerine geçmez');
    });

    it('stays hidden when the clinician reviews it and decides not to release', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const report = await reportsWith(AI_ON, modelSaying(interpretation('HIGH'))).generate(
        patientId,
        [
          {
            analyteName: 'Hemoglobin',
            value: 8,
            unit: 'g/dL',
            refLow: 12,
            refHigh: 16,
            flag: LabFlag.LOW,
            measuredAt: new Date(),
          },
        ],
        doctor.userId,
      );

      await request(server)
        .patch(`/reports/${report!.id}/review`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ release: false })
        .expect(200);

      const response = await request(server)
        .get('/me/reports')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('refuses a second review, so the sign-off stays the first one', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      const report = await reportsWith(AI_ON, modelSaying(interpretation('LOW'))).generate(
        patientId,
        [
          {
            analyteName: 'Üre',
            value: 30,
            unit: 'mg/dL',
            refLow: 15,
            refHigh: 45,
            flag: LabFlag.NORMAL,
            measuredAt: new Date(),
          },
        ],
        doctor.userId,
      );

      await request(server)
        .patch(`/reports/${report!.id}/review`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ release: true })
        .expect(200);

      await request(server)
        .patch(`/reports/${report!.id}/review`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ release: false })
        .expect(400);
    });
  });

  describe('the auto-release setting', () => {
    it('lets a calm report through when a clinic switches it on', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const report = await reportsWith(
        { ...AI_ON, AI_AUTO_RELEASE_LOW_RISK: true },
        modelSaying(interpretation('LOW')),
      ).generate(
        patientId,
        [
          {
            analyteName: 'Üre',
            value: 30,
            unit: 'mg/dL',
            refLow: 15,
            refHigh: 45,
            flag: LabFlag.NORMAL,
            measuredAt: new Date(),
          },
        ],
        null,
      );

      expect(report?.releasedToPatientAt).not.toBeNull();

      const response = await request(server)
        .get('/me/reports')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
    });

    /**
     * There is deliberately no setting for this. An AI telling a
     * post-operative patient abroad that something is seriously wrong, before
     * anyone at the clinic has seen it, is the one outcome the rest of this
     * system would not forgive.
     */
    it('still holds an alarming report, with the setting switched on', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const report = await reportsWith(
        { ...AI_ON, AI_AUTO_RELEASE_LOW_RISK: true },
        modelSaying(interpretation('CRITICAL')),
      ).generate(
        patientId,
        [
          {
            analyteName: 'Hemoglobin',
            value: 5,
            unit: 'g/dL',
            refLow: 12,
            refHigh: 16,
            flag: LabFlag.CRITICAL,
            measuredAt: new Date(),
          },
        ],
        null,
      );

      expect(report?.releasedToPatientAt).toBeNull();

      const response = await request(server)
        .get('/me/reports')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('who may do what', () => {
    it('does not let a patient into the review queue', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      await request(server)
        .get('/reports/pending')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(403);
    });

    it('does not let a nurse ask for an interpretation', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patientId = await makePatient();

      // ai.review is a doctor's permission: releasing AI text to a patient is a
      // clinical sign-off.
      await request(server)
        .post(`/patients/${patientId}/reports/lab`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(403);
    });
  });
});
