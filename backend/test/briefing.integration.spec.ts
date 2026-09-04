import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  ComplicationStatus,
  EmergencyStatus,
  LabFlag,
  MessageType,
  MilestoneStatus,
  PrismaClient,
  Role,
  Sex,
  TriageLevel,
  UserStatus,
} from '@prisma/client';
import type { AiSettingsService } from '../src/ai/ai-settings.service';
import { AIService } from '../src/ai/ai.service';
import type { FetchLike } from '../src/ai/ai-provider';
import { findLeaks } from '../src/ai/pseudonymise';
import { AppModule } from '../src/app.module';
import { PatientAccessService } from '../src/authz/patient-access.service';
import { BriefingService } from '../src/briefing/briefing.service';
import { dayWindow } from '../src/briefing/briefing';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

const prisma = new PrismaClient();

const NARRATIVE = '{"narrative":"İki mesaj ve bir acil çağrı bekliyor."}';

const capturing = (
  reply: string,
): { fetchImpl: FetchLike; sent: () => string[] } => {
  const bodies: string[] = [];

  const fetchImpl: FetchLike = (_url, init) => {
    bodies.push(init.body);

    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({
            model: 'test-model-2026',
            content: [{ type: 'text', text: reply }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 200, output_tokens: 80 },
          }),
        ),
    });
  };

  return { fetchImpl, sent: () => bodies };
};

const AI_ON = {
  AI_PROVIDER: 'anthropic',
  AI_API_KEY: 'sk-test',
  AI_MODEL: 'test-model',
  AI_PRICE_INPUT_PER_MTOK: 3,
  AI_PRICE_OUTPUT_PER_MTOK: 15,
  AI_ZERO_RETENTION: true,
  AI_TIMEOUT_MS: 5_000,
  AI_MAX_OUTPUT_TOKENS: 400,
  AI_MONTHLY_BUDGET_USD: undefined,
  AI_AUTO_RELEASE_LOW_RISK: false,
  AI_EMBEDDING_PROVIDER: undefined,
  AI_EMBEDDING_API_KEY: undefined,
  AI_EMBEDDING_MODEL: undefined,
  AI_EMBEDDING_PRICE_PER_MTOK: undefined,
};

const AI_OFF = { ...AI_ON, AI_PROVIDER: undefined, AI_API_KEY: undefined };

/**
 * The morning briefing (spec M5).
 *
 * The briefing is data. Most of these tests are about the numbers being right —
 * which day an event lands in, whose patients a clinician sees, and what the
 * paragraph is allowed to know.
 */
describe('the morning briefing', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let access: PatientAccessService;
  let redis: RedisService;

  const now = new Date();
  const window = dayWindow(now);
  /** Noon yesterday, comfortably inside the window on either side of it. */
  const yesterdayNoon = new Date(window.yesterdayStart.getTime() + 12 * 60 * 60 * 1000);
  const todayNoon = new Date(window.todayStart.getTime() + 12 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(window.yesterdayStart.getTime() - 12 * 60 * 60 * 1000);

  const briefingWith = (values: Record<string, unknown>, fetchImpl: FetchLike): BriefingService => {
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
    // The AI layer prefers what the clinic saved. These tests configure it
    // from the environment and never reach onApplicationBootstrap, so the
    // settings are never consulted; the stub is here for the constructor.
    const settings = { resolved: () => Promise.resolve(null) } as unknown as AiSettingsService;

    const ai = new AIService(prisma as unknown as PrismaService, config, settings, fetchImpl);
    ai.onModuleInit();

    return new BriefingService(prisma as unknown as PrismaService, access, ai, redis);
  };

  const staffFor = async (role: Role): Promise<{ userId: string; staffId: string }> => {
    const user = await prisma.user.create({
      data: {
        role,
        email: `brf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
        passwordHash: await hashPassword('correct-horse-battery-9'),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    const profile = await prisma.staffProfile.create({
      data: { userId: user.id, firstName: 'Brf', lastName: role },
    });
    staffProfiles.push(profile.id);

    return { userId: user.id, staffId: profile.id };
  };

  const makePatient = async (): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-BRF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        birthDate: new Date('1981-04-02'),
        sex: Sex.FEMALE,
        country: 'DE',
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  const messageAt = async (
    patientId: string,
    at: Date,
    level: TriageLevel,
    readAt: Date | null = new Date(),
  ): Promise<void> => {
    const conversation = await prisma.conversation.create({ data: { patientId } });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        type: MessageType.TEXT,
        body: 'soru',
        triageLevel: level,
        createdAt: at,
        readAt,
      },
    });
  };

  /** A doctor is the simplest actor with an unrestricted scope. */
  const doctorActor = (userId: string): never => ({ id: userId, role: Role.DOCTOR }) as never;

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

    access = app.get(PatientAccessService);
    redis = app.get(RedisService);

    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.aiJob.deleteMany({});
    await prisma.aiReport.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.emergencyEvent.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.complication.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.labResult.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.appointment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.followUpMilestone.deleteMany({
      where: { schedule: { patientId: { in: patientIds } } },
    });
    await prisma.followUpSchedule.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.message.deleteMany({
      where: { conversation: { patientId: { in: patientIds } } },
    });
    await prisma.conversation.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patientAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('yesterday', () => {
    it('counts what happened yesterday and not what happened today', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const patientId = await makePatient();

      await messageAt(patientId, yesterdayNoon, TriageLevel.ROUTINE);
      await messageAt(patientId, yesterdayNoon, TriageLevel.URGENT);
      await messageAt(patientId, todayNoon, TriageLevel.ROUTINE);
      await messageAt(patientId, twoDaysAgo, TriageLevel.ROUTINE);

      const briefing = await briefingWith(AI_OFF, capturing(NARRATIVE).fetchImpl).forUser(
        doctorActor(doctor.userId),
      );

      expect(briefing.facts.yesterday.newMessages).toBe(2);
      expect(briefing.facts.yesterday.urgentMessages).toBe(1);
    });

    it('counts yesterday\'s emergencies, complications and critical labs', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prisma.emergencyEvent.create({
        data: { patientId, status: EmergencyStatus.RESOLVED, triggeredAt: yesterdayNoon },
      });
      await prisma.complication.create({
        data: { patientId, note: 'yara', reportedAt: yesterdayNoon },
      });
      await prisma.labResult.create({
        data: {
          patientId,
          analyteName: 'Hemoglobin',
          value: 5,
          unit: 'g/dL',
          flag: LabFlag.CRITICAL,
          measuredAt: yesterdayNoon,
          verifiedAt: yesterdayNoon,
        },
      });

      const briefing = await briefingWith(AI_OFF, capturing(NARRATIVE).fetchImpl).forUser(
        doctorActor(doctor.userId),
      );

      expect(briefing.facts.yesterday.emergencies).toBe(1);
      expect(briefing.facts.yesterday.complications).toBe(1);
      expect(briefing.facts.yesterday.criticalLabs).toBe(1);
    });
  });

  describe('today', () => {
    it('counts today\'s appointments and check-ups', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prisma.appointment.create({
        data: { patientId, type: 'CONTROL', scheduledAt: todayNoon, durationMinutes: 30 },
      });
      await prisma.appointment.create({
        data: { patientId, type: 'CONTROL', scheduledAt: yesterdayNoon, durationMinutes: 30 },
      });

      const schedule = await prisma.followUpSchedule.create({
        data: { patientId, surgeryDate: twoDaysAgo },
      });
      await prisma.followUpMilestone.create({
        data: { scheduleId: schedule.id, label: 'W1', dueAt: todayNoon },
      });

      const briefing = await briefingWith(AI_OFF, capturing(NARRATIVE).fetchImpl).forUser(
        doctorActor(doctor.userId),
      );

      expect(briefing.facts.today.appointments).toBe(1);
      expect(briefing.facts.today.followUps).toBe(1);
    });
  });

  describe('who is waiting', () => {
    it('puts an unanswered emergency at the top, above everything older', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prisma.aiReport.create({
        data: {
          patientId,
          source: 'lab',
          contentMd: 'eski',
          model: 'test',
          generatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        },
      });
      await prisma.emergencyEvent.create({
        data: {
          patientId,
          status: EmergencyStatus.TRIGGERED,
          triggeredAt: new Date(now.getTime() - 20 * 60 * 1000),
        },
      });

      const briefing = await briefingWith(AI_OFF, capturing(NARRATIVE).fetchImpl).forUser(
        doctorActor(doctor.userId),
      );

      expect(briefing.facts.atRisk[0]!.kind).toBe('emergency-unanswered');
      expect(briefing.facts.atRisk.map((item) => item.kind)).toContain('report-unreviewed');
    });

    it('lists an urgent message nobody has opened', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const patientId = await makePatient();

      await messageAt(patientId, new Date(now.getTime() - 60 * 60 * 1000), TriageLevel.URGENT, null);

      const briefing = await briefingWith(AI_OFF, capturing(NARRATIVE).fetchImpl).forUser(
        doctorActor(doctor.userId),
      );

      const item = briefing.facts.atRisk.find((risk) => risk.kind === 'message-urgent');
      expect(item).toBeDefined();
      expect(item!.patientName).toBe('Ayşe Yılmaz');
      // The body is clinical content and stays off a summary screen.
      expect(item!.detail).not.toContain('soru');
    });

    it('leaves out an urgent message somebody has read', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const patientId = await makePatient();

      await messageAt(patientId, new Date(now.getTime() - 60 * 60 * 1000), TriageLevel.URGENT);

      const briefing = await briefingWith(AI_OFF, capturing(NARRATIVE).fetchImpl).forUser(
        doctorActor(doctor.userId),
      );

      expect(
        briefing.facts.atRisk.filter((risk) => risk.patientId === patientId),
      ).toEqual([]);
    });

    it('lists an overdue complication and a missed check-up', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prisma.complication.create({
        data: {
          patientId,
          note: 'yara',
          status: ComplicationStatus.REPORTED,
          reportedAt: new Date(now.getTime() - 5 * 60 * 60 * 1000),
        },
      });

      const schedule = await prisma.followUpSchedule.create({
        data: { patientId, surgeryDate: twoDaysAgo },
      });
      await prisma.followUpMilestone.create({
        data: {
          scheduleId: schedule.id,
          label: 'M1',
          dueAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          status: MilestoneStatus.MISSED,
        },
      });

      const briefing = await briefingWith(AI_OFF, capturing(NARRATIVE).fetchImpl).forUser(
        doctorActor(doctor.userId),
      );

      const kinds = briefing.facts.atRisk
        .filter((risk) => risk.patientId === patientId)
        .map((risk) => risk.kind);

      expect(kinds).toContain('complication-overdue');
      expect(kinds).toContain('follow-up-missed');
    });

    /**
     * A nurse's briefing is about her patients. Scoping is the same rule as
     * every other clinical read, and a briefing is the one screen where seeing
     * the whole clinic would look like a feature.
     */
    it('shows a nurse only the patients she is responsible for', async () => {
      const nurse = await staffFor(Role.NURSE);
      const mine = await makePatient();
      const theirs = await makePatient();

      await prisma.patientAssignment.create({
        data: { patientId: mine, staffId: nurse.staffId, role: Role.NURSE },
      });

      for (const patientId of [mine, theirs]) {
        await prisma.emergencyEvent.create({
          data: { patientId, status: EmergencyStatus.TRIGGERED, triggeredAt: new Date() },
        });
      }

      const briefing = await briefingWith(AI_OFF, capturing(NARRATIVE).fetchImpl).forUser({
        id: nurse.userId,
        role: Role.NURSE,
      } as never);

      const seen = briefing.facts.atRisk.map((risk) => risk.patientId);
      expect(seen).toContain(mine);
      expect(seen).not.toContain(theirs);
    });
  });

  describe('the paragraph over the numbers', () => {
    it('is absent when the AI layer is off, and the facts stand alone', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const briefing = await briefingWith(AI_OFF, capturing(NARRATIVE).fetchImpl).forUser(
        doctorActor(doctor.userId),
      );

      expect(briefing.narrative).toBeNull();
      expect(briefing.facts).toBeDefined();
    });

    it('is written when there is a model to write it', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const briefing = await briefingWith(AI_ON, capturing(NARRATIVE).fetchImpl).forUser(
        doctorActor(doctor.userId),
      );

      expect(briefing.narrative).toBe('İki mesaj ve bir acil çağrı bekliyor.');
    });

    it('keeps the facts when the model answers nonsense', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const briefing = await briefingWith(AI_ON, capturing('bir şeyler').fetchImpl).forUser(
        doctorActor(doctor.userId),
      );

      expect(briefing.narrative).toBeNull();
      expect(briefing.facts.generatedAt).toBeInstanceOf(Date);
    });

    /**
     * A doctor refreshes the morning screen several times. Regenerating a
     * paragraph about unchanged numbers each time spends the clinic's budget on
     * the same sentence.
     */
    it('writes the same paragraph once', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const transport = capturing(NARRATIVE);
      const briefing = briefingWith(AI_ON, transport.fetchImpl);

      await briefing.forUser(doctorActor(doctor.userId));
      await briefing.forUser(doctorActor(doctor.userId));

      expect(transport.sent()).toHaveLength(1);
    });

    /**
     * The model is given counts and nothing else — the list of who is waiting
     * is rendered by the client from structured data, where it does not have to
     * travel anywhere.
     */
    it('sends no patient name to the model', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prisma.emergencyEvent.create({
        data: { patientId, status: EmergencyStatus.TRIGGERED, triggeredAt: new Date() },
      });

      const transport = capturing(NARRATIVE);
      await briefingWith(AI_ON, transport.fetchImpl).forUser(doctorActor(doctor.userId));

      const [sent] = transport.sent();
      expect(sent).toBeDefined();
      expect(findLeaks(sent!, { names: ['Ayşe', 'Yılmaz'] })).toEqual([]);
      expect(sent).toContain('emergency-unanswered');
    });
  });

  describe('the morning nudge', () => {
    /** A notification about an empty briefing teaches people to ignore the rest. */
    it('has nothing to announce on a quiet morning', async () => {
      const doctor = await staffFor(Role.DOCTOR);
      const briefing = briefingWith(AI_OFF, capturing(NARRATIVE).fetchImpl);

      const quiet = await briefing.forUser(doctorActor(doctor.userId));

      // A doctor's scope is the whole clinic, so this only holds for a nurse
      // with nothing assigned — which is the case the sweep actually skips.
      const nurse = await staffFor(Role.NURSE);
      const nurseBriefing = await briefing.forUser({
        id: nurse.userId,
        role: Role.NURSE,
      } as never);

      expect(nurseBriefing.quiet).toBe(true);
      expect(await briefing.recipientsWithBriefings([nurse.userId])).toEqual([]);
      expect(quiet.facts).toBeDefined();
    });
  });
});
