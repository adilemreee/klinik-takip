import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MessageType, PrismaClient, Role, Sex, TriageLevel, UserStatus } from '@prisma/client';
import { generateSync } from 'otplib';
import type { AiSettingsService } from '../src/ai/ai-settings.service';
import { AIService } from '../src/ai/ai.service';
import type { FetchLike } from '../src/ai/ai-provider';
import { AppModule } from '../src/app.module';
import { AssistantService } from '../src/assistant/assistant.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { isStaffRole } from '../src/auth/auth.errors';
import { CareTeamService } from '../src/authz/care-team.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';
import { MessagingGateway } from '../src/messaging/messaging.gateway';
import { NotificationsService } from '../src/notifications/notifications.service';
import { ProtocolsService } from '../src/protocols/protocols.service';
import { TriageService } from '../src/triage/triage.service';

const prisma = new PrismaClient();

const modelSaying = (text: string): FetchLike => () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () =>
      Promise.resolve(
        JSON.stringify({
          model: 'test-model-2026',
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 400, output_tokens: 120 },
        }),
      ),
  });

const AI_ON = {
  AI_PROVIDER: 'anthropic',
  AI_API_KEY: 'sk-test',
  AI_MODEL: 'test-model',
  AI_PRICE_INPUT_PER_MTOK: 3,
  AI_PRICE_OUTPUT_PER_MTOK: 15,
  AI_ZERO_RETENTION: true,
  AI_TIMEOUT_MS: 5_000,
  AI_MAX_OUTPUT_TOKENS: 800,
  AI_MONTHLY_BUDGET_USD: undefined,
  AI_AUTO_RELEASE_LOW_RISK: false,
  // No embedding provider: retrieval is lexical only, which is how this ships.
  AI_EMBEDDING_PROVIDER: undefined,
  AI_EMBEDDING_API_KEY: undefined,
  AI_EMBEDDING_MODEL: undefined,
  AI_EMBEDDING_PRICE_PER_MTOK: undefined,
};

const WOUND_CARE = [
  'Yara bakımı ve duş',
  '',
  'Ameliyattan sonraki ilk 48 saat boyunca yarayı ıslatmayın ve duş almayın.',
  'İkinci günün sonunda su geçirmez bant ile kısa süreli duş alabilirsiniz.',
  'Yara bölgesine sabun sürmeyin ve keseleme yapmayın.',
  '',
  'Pansuman değişimi',
  '',
  'Pansumanınızı günde bir kez, elleriniz yıkanmış hâlde değiştirin.',
  'Pansuman ıslanırsa beklemeden değiştirin ve bölgeyi kurulayın.',
].join('\n');

/**
 * The FAQ assistant (spec M4).
 *
 * The rule is that it answers only from the clinic's own documents. Most of
 * these tests are about the ways it must decline: nothing retrieved, the model
 * declining, an answer citing nothing. Declining is the expected outcome for
 * anything the corpus does not cover, and the clinic would rather answer a
 * hundred questions itself than have one answered from a model's memory.
 */
describe('the FAQ assistant', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];
  const documentIds: string[] = [];

  let app: INestApplication;
  let auth: AuthService;
  let careTeam: CareTeamService;
  let notifications: NotificationsService;
  let gateway: MessagingGateway;
  let audit: AuditService;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ userId: string; staffId?: string }> => {
    const email = `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
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
        data: { userId: user.id, firstName: 'Asst', lastName: role },
      });
      staffProfiles.push(profile.id);

      const setup = await auth.beginTotpEnrolment(user.id);
      await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));

      return { userId: user.id, staffId: profile.id };
    }

    return { userId: user.id };
  };

  const makePatient = async (userId: string, procedure?: string): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-AS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        birthDate: new Date('1981-04-02'),
        sex: Sex.FEMALE,
        country: 'DE',
        userId,
      },
    });
    patientIds.push(patient.id);

    if (procedure) {
      await prisma.surgery.create({
        data: {
          patientId: patient.id,
          procedureName: procedure,
          performedAt: new Date(Date.now() - 3 * 86_400_000),
        },
      });
    }

    return patient.id;
  };

  const services = (
    values: Record<string, unknown>,
    fetchImpl: FetchLike,
  ): { assistant: AssistantService; protocols: ProtocolsService } => {
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
    // The AI layer prefers what the clinic saved. These tests configure it
    // from the environment and never reach onApplicationBootstrap, so the
    // settings are never consulted; the stub is here for the constructor.
    const settings = { resolved: () => Promise.resolve(null) } as unknown as AiSettingsService;

    const ai = new AIService(prisma as unknown as PrismaService, config, settings, fetchImpl);
    ai.onModuleInit();

    const protocols = new ProtocolsService(prisma as unknown as PrismaService, ai, audit);
    const triage = new TriageService(
      prisma as unknown as PrismaService,
      ai,
      careTeam,
      notifications,
      gateway,
    );

    return {
      protocols,
      assistant: new AssistantService(
        prisma as unknown as PrismaService,
        ai,
        protocols,
        triage,
        gateway,
      ),
    };
  };

  const uploadWoundCare = async (procedureType?: string): Promise<void> => {
    const staff = await actorFor(Role.DOCTOR);
    const { protocols } = services(AI_ON, modelSaying('{}'));

    const summary = await protocols.upload(
      { id: staff.userId, role: Role.DOCTOR } as never,
      { title: 'Yara Bakımı', content: WOUND_CARE, procedureType },
    );

    documentIds.push(summary.document.id);
  };

  const patientUser = { id: '', role: Role.PATIENT } as { id: string; role: Role };

  /**
   * Each test starts with an empty corpus.
   *
   * A document uploaded without a procedure type is general, so it answers for
   * every patient — including the one the next test is checking cannot see
   * another procedure's instructions.
   */
  beforeEach(async () => {
    await prisma.protocolDocument.updateMany({ data: { isActive: false } });
    await prisma.aiJob.deleteMany({});
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

    auth = app.get(AuthService);
    careTeam = app.get(CareTeamService);
    notifications = app.get(NotificationsService);
    gateway = app.get(MessagingGateway);
    audit = app.get(AuditService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.aiJob.deleteMany({});
    await prisma.protocolChunk.deleteMany({ where: { documentId: { in: documentIds } } });
    await prisma.protocolDocument.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.message.deleteMany({
      where: { conversation: { patientId: { in: patientIds } } },
    });
    await prisma.conversation.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.surgery.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('the corpus', () => {
    it('chunks a document on the way in', async () => {
      const staff = await actorFor(Role.DOCTOR);
      const { protocols } = services(AI_ON, modelSaying('{}'));

      const summary = await protocols.upload(
        { id: staff.userId, role: Role.DOCTOR } as never,
        { title: 'Yara Bakımı', content: WOUND_CARE },
      );
      documentIds.push(summary.document.id);

      expect(summary.chunks).toBeGreaterThan(0);
      // No embedding provider configured, and that is not a failure.
      expect(summary.embedded).toBe(false);

      const stored = await prisma.protocolChunk.count({
        where: { documentId: summary.document.id },
      });
      expect(stored).toBe(summary.chunks);
    });

    it('refuses a document with nothing in it', async () => {
      const staff = await actorFor(Role.DOCTOR);
      const { protocols } = services(AI_ON, modelSaying('{}'));

      await expect(
        protocols.upload({ id: staff.userId, role: Role.DOCTOR } as never, {
          title: 'Boş',
          content: 'kısa',
        }),
      ).rejects.toThrow();
    });

    /**
     * Retired rather than deleted: an answer given last month cited a passage,
     * and a clinic reviewing what the bot said needs to read what it read.
     */
    it('stops quoting a retired document but keeps it on file', async () => {
      const staff = await actorFor(Role.DOCTOR);
      const { protocols } = services(AI_ON, modelSaying('{}'));
      const actor = { id: staff.userId, role: Role.DOCTOR } as never;

      const summary = await protocols.upload(actor, {
        title: 'Eski Protokol',
        content: WOUND_CARE,
      });
      documentIds.push(summary.document.id);

      await protocols.deactivate(actor, summary.document.id);

      const evidence = await protocols.retrieve('pansuman değişimi', null);
      expect(evidence.chunks.every((c) => c.documentId !== summary.document.id)).toBe(true);

      expect(
        await prisma.protocolChunk.count({ where: { documentId: summary.document.id } }),
      ).toBeGreaterThan(0);
    });
  });

  describe('retrieval without any embeddings', () => {
    it('finds the passage that uses the patient\'s own words', async () => {
      await uploadWoundCare();
      const { protocols } = services(AI_ON, modelSaying('{}'));

      const evidence = await protocols.retrieve('pansuman ne sıklıkla değiştirilmeli', null);

      expect(evidence.sufficient).toBe(true);
      expect(evidence.chunks[0]!.content).toContain('Pansuman');
      expect(evidence.chunks[0]!.via).toBe('lexical');
    });

    it('finds nothing for a question the corpus does not cover', async () => {
      await uploadWoundCare();
      const { protocols } = services(AI_ON, modelSaying('{}'));

      const evidence = await protocols.retrieve('uçak bileti alabilir miyim', null);

      expect(evidence.sufficient).toBe(false);
    });

    /**
     * A sleeve gastrectomy instruction shown to a rhinoplasty patient is not a
     * near miss; it is a different operation's aftercare.
     */
    it('does not quote another procedure\'s instructions', async () => {
      await uploadWoundCare('Sleeve gastrektomi');
      const { protocols } = services(AI_ON, modelSaying('{}'));

      expect((await protocols.retrieve('pansuman değişimi', 'Rinoplasti')).sufficient).toBe(false);
      expect((await protocols.retrieve('pansuman değişimi', 'Sleeve gastrektomi')).sufficient).toBe(
        true,
      );
    });
  });

  describe('answering', () => {
    const answering = modelSaying(
      JSON.stringify({
        answered: true,
        answer: 'Pansumanınızı günde bir kez değiştirin.',
        citations: [1],
      }),
    );

    it('answers from the corpus and says which document it came from', async () => {
      await uploadWoundCare();
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      patientUser.id = patient.userId;

      const { assistant } = services(AI_ON, answering);
      const result = await assistant.ask(patientUser as never, patientId, 'pansuman değişimi nasıl');

      expect(result.answered).toBe(true);
      expect(result.answer).toContain('günde bir kez');
      expect(result.sources).toContain('Yara Bakımı');

      // Stored where the doctor's panel already looks, and attributed to nobody.
      const bot = await prisma.message.findFirstOrThrow({
        where: { conversation: { patientId }, type: MessageType.BOT },
      });
      expect(bot.senderId).toBeNull();
      expect(bot.body).toContain('Kaynak: Yara Bakımı');
    });

    /**
     * The rule made mechanical: an answer citing nothing came from somewhere
     * other than the corpus, whatever the prompt asked for.
     */
    it('throws away an answer that cites nothing', async () => {
      await uploadWoundCare();
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const { assistant } = services(
        AI_ON,
        modelSaying('{"answered":true,"answer":"Günde iki kez değiştirin.","citations":[]}'),
      );

      const result = await assistant.ask(
        { id: patient.userId, role: Role.PATIENT } as never,
        patientId,
        'pansuman değişimi nasıl',
      );

      expect(result.answered).toBe(false);
      expect(result.handoverReason).toBe('no-citations');
      expect(
        await prisma.message.count({ where: { conversation: { patientId }, type: MessageType.BOT } }),
      ).toBe(0);
    });

    it('throws away an answer citing a passage it was never shown', async () => {
      await uploadWoundCare();
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const { assistant } = services(
        AI_ON,
        modelSaying('{"answered":true,"answer":"Bir şey.","citations":[99]}'),
      );

      const result = await assistant.ask(
        { id: patient.userId, role: Role.PATIENT } as never,
        patientId,
        'pansuman değişimi nasıl',
      );

      expect(result.handoverReason).toBe('no-citations');
    });

    it('hands over when the model says the passages do not answer it', async () => {
      await uploadWoundCare();
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const { assistant } = services(
        AI_ON,
        modelSaying('{"answered":false,"answer":"","citations":[],"handoverReason":"Yok."}'),
      );

      const result = await assistant.ask(
        { id: patient.userId, role: Role.PATIENT } as never,
        patientId,
        'pansuman değişimi nasıl',
      );

      expect(result.answered).toBe(false);
      expect(result.handoverReason).toBe('model-declined');
    });

    /** Nothing retrieved means the model is never asked in the first place. */
    it('does not call the model at all when the corpus has nothing', async () => {
      await uploadWoundCare();
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      // Counted by prompt, because a handed-over question is triaged — and
      // triage is an AI call too. What must not happen is the *assistant*
      // asking a model with nothing to quote.
      let assistantCalls = 0;
      const counting: FetchLike = (url, init) => {
        if (init.body.includes('SSS asistanısın')) assistantCalls += 1;
        return answering(url, init);
      };

      const { assistant } = services(AI_ON, counting);
      const result = await assistant.ask(
        { id: patient.userId, role: Role.PATIENT } as never,
        patientId,
        'uçak bileti alabilir miyim',
      );

      expect(result.handoverReason).toBe('no-sources');
      expect(assistantCalls).toBe(0);
    });

    it('hands over when the AI layer is switched off', async () => {
      await uploadWoundCare();
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const { assistant } = services(
        { ...AI_ON, AI_PROVIDER: undefined, AI_API_KEY: undefined },
        answering,
      );

      const result = await assistant.ask(
        { id: patient.userId, role: Role.PATIENT } as never,
        patientId,
        'pansuman değişimi nasıl',
      );

      expect(result.answered).toBe(false);
      expect(result.handoverReason).toBe('ai-unavailable');
    });
  });

  describe('what the clinic sees', () => {
    it('records the question either way, so it is a message to the clinic', async () => {
      await uploadWoundCare();
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const { assistant } = services(AI_ON, modelSaying('{"answered":false,"answer":""}'));
      const result = await assistant.ask(
        { id: patient.userId, role: Role.PATIENT } as never,
        patientId,
        'pansuman değişimi nasıl',
      );

      const question = await prisma.message.findUniqueOrThrow({
        where: { id: result.questionMessageId },
      });

      expect(question.body).toContain('pansuman');
      expect(question.type).toBe(MessageType.TEXT);
      expect(question.senderId).toBe(patient.userId);
    });

    /**
     * A question the bot could not answer because it was about something
     * alarming must not sit in the ordinary queue.
     */
    it('triages a handed-over question, so an urgent one still escalates', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prisma.patientAssignment.create({
        data: { patientId, staffId: nurse.staffId!, role: Role.NURSE },
      });

      const { assistant } = services(AI_ON, modelSaying('{}'));
      const result = await assistant.ask(
        { id: patient.userId, role: Role.PATIENT } as never,
        patientId,
        'nefes alamıyorum ne yapmalıyım',
      );

      expect(result.answered).toBe(false);

      const question = await prisma.message.findUniqueOrThrow({
        where: { id: result.questionMessageId },
      });
      expect(question.triageLevel).toBe(TriageLevel.EMERGENCY);
    });

    it('hands an answered question to a person when the patient asks', async () => {
      await uploadWoundCare();
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prisma.patientAssignment.create({
        data: { patientId, staffId: nurse.staffId!, role: Role.NURSE },
      });

      const { assistant } = services(
        AI_ON,
        modelSaying('{"answered":true,"answer":"Günde bir kez.","citations":[1]}'),
      );

      const actor = { id: patient.userId, role: Role.PATIENT } as never;
      const result = await assistant.ask(actor, patientId, 'pansuman değişimi nasıl');

      expect(result.answered).toBe(true);

      await assistant.escalate(actor, result.questionMessageId);

      const question = await prisma.message.findUniqueOrThrow({
        where: { id: result.questionMessageId },
      });
      expect(question.triageLevel).not.toBeNull();
    });

    it('will not let one patient escalate another\'s question', async () => {
      await uploadWoundCare();
      const owner = await actorFor(Role.PATIENT);
      const stranger = await actorFor(Role.PATIENT);
      const patientId = await makePatient(owner.userId);
      await makePatient(stranger.userId);

      const { assistant } = services(AI_ON, modelSaying('{}'));
      const result = await assistant.ask(
        { id: owner.userId, role: Role.PATIENT } as never,
        patientId,
        'pansuman değişimi nasıl',
      );

      await expect(
        assistant.escalate(
          { id: stranger.userId, role: Role.PATIENT } as never,
          result.questionMessageId,
        ),
      ).rejects.toThrow();
    });
  });
});
