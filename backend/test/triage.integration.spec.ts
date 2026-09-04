import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  MessageStatus,
  MessageType,
  NotificationChannel,
  PrismaClient,
  Role,
  Sex,
  TriageLevel,
  UserStatus,
} from '@prisma/client';
import { generateSync } from 'otplib';
import type { AiSettingsService } from '../src/ai/ai-settings.service';
import { AIService } from '../src/ai/ai.service';
import type { FetchLike } from '../src/ai/ai-provider';
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
import { MessagingGateway } from '../src/messaging/messaging.gateway';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../src/notifications/templates';
import { TriageService } from '../src/triage/triage.service';

const prisma = new PrismaClient();

/** Replies with whatever the model is supposed to have said. */
const modelSaying = (text: string): FetchLike => () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () =>
      Promise.resolve(
        JSON.stringify({
          model: 'test-model',
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      ),
  });

/**
 * Triage as the clinic actually gets it (spec M4, M5).
 *
 * The tests that matter here are the ones where the model is wrong, absent or
 * unreadable, because that is the state the system ships in and the state it
 * falls back to every time a provider has a bad afternoon.
 */
describe('message triage', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let auth: AuthService;
  let careTeam: CareTeamService;
  let notifications: NotificationsService;
  let gateway: MessagingGateway;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ userId: string; staffId?: string }> => {
    const email = `tri-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
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
        data: { userId: user.id, firstName: 'Tri', lastName: role },
      });
      staffProfiles.push(profile.id);

      const setup = await auth.beginTotpEnrolment(user.id);
      await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));

      return { userId: user.id, staffId: profile.id };
    }

    return { userId: user.id };
  };

  const makePatient = async (userId: string): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-TRI-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const conversationWith = async (patientId: string): Promise<string> => {
    const conversation = await prisma.conversation.create({ data: { patientId } });
    return conversation.id;
  };

  const messageFrom = async (
    conversationId: string,
    senderId: string,
    body: string,
    status: MessageStatus = MessageStatus.SENT,
  ): Promise<string> => {
    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId,
        type: MessageType.TEXT,
        body,
        status,
        queuedUntil: status === MessageStatus.QUEUED ? new Date(Date.now() + 3_600_000) : null,
      },
    });

    return message.id;
  };

  /** A triage service wired to a model that says exactly what a test wants. */
  const triageWith = (
    values: Record<string, unknown>,
    fetchImpl: FetchLike = modelSaying('{}'),
  ): TriageService => {
    const config = {
      get: (key: string) => values[key],
    } as unknown as ConfigService<Env, true>;

    // The AI layer prefers what the clinic saved. These tests configure it
    // from the environment and never reach onApplicationBootstrap, so the
    // settings are never consulted; the stub is here for the constructor.
    const settings = { resolved: () => Promise.resolve(null) } as unknown as AiSettingsService;

    const ai = new AIService(prisma as unknown as PrismaService, config, settings, fetchImpl);
    ai.onModuleInit();

    return new TriageService(
      prisma as unknown as PrismaService,
      ai,
      careTeam,
      notifications,
      gateway,
    );
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
  };

  const AI_OFF = { ...AI_ON, AI_PROVIDER: undefined, AI_API_KEY: undefined };

  const urgentPushes = async (userId: string): Promise<number> =>
    prisma.notification.count({
      where: {
        userId,
        type: NOTIFICATION_TYPES.messageUrgent,
        channel: NotificationChannel.PUSH,
      },
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

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.aiJob.deleteMany({});
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.message.deleteMany({
      where: { conversation: { patientId: { in: patientIds } } },
    });
    await prisma.conversation.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patientAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('with no AI at all', () => {
    it('still catches a message that cannot wait', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prisma.patientAssignment.create({
        data: { patientId, staffId: nurse.staffId!, role: Role.NURSE },
      });

      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(conversationId, patient.userId, 'nefes alamıyorum');

      const outcome = await triageWith(AI_OFF).triage(messageId);

      expect(outcome?.level).toBe(TriageLevel.EMERGENCY);
      expect(outcome?.aiLevel).toBeNull();
      expect(outcome?.flags).toEqual(['breathing']);
      expect(await urgentPushes(nurse.userId)).toBe(1);
    });

    it('leaves an ordinary question to the normal queue', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prisma.patientAssignment.create({
        data: { patientId, staffId: nurse.staffId!, role: Role.NURSE },
      });

      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(conversationId, patient.userId, 'Yarın duş alabilir miyim?');

      const outcome = await triageWith(AI_OFF).triage(messageId);

      expect(outcome?.level).toBe(TriageLevel.ROUTINE);
      expect(outcome?.notified).toBe(0);
      expect(await urgentPushes(nurse.userId)).toBe(0);
    });

    /**
     * The case the whole feature exists for. The access window is there so a
     * doctor is not on call all night for routine questions; it was never meant
     * to hold this one for fifteen hours.
     */
    it('takes an urgent message out of the access-window queue', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(
        conversationId,
        patient.userId,
        'kanama durmuyor',
        MessageStatus.QUEUED,
      );

      const outcome = await triageWith(AI_OFF).triage(messageId);

      expect(outcome?.released).toBe(true);

      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.status).toBe(MessageStatus.SENT);
      expect(message.queuedUntil).toBeNull();
    });

    it('leaves a routine message where the window put it', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(
        conversationId,
        patient.userId,
        'İyi akşamlar, bir sorum olacak',
        MessageStatus.QUEUED,
      );

      await triageWith(AI_OFF).triage(messageId);

      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.status).toBe(MessageStatus.QUEUED);
    });

    it('does not triage what a clinician wrote', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(
        conversationId,
        nurse.userId,
        'Nefes alamıyorsanız 112 arayın',
      );

      expect(await triageWith(AI_OFF).triage(messageId)).toBeNull();

      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.triageLevel).toBeNull();
    });
  });

  describe('with the model answering', () => {
    it('lets the model raise a message the keywords did not catch', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prisma.patientAssignment.create({
        data: { patientId, staffId: nurse.staffId!, role: Role.NURSE },
      });

      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(
        conversationId,
        patient.userId,
        'Dün geceden beri kendimi çok kötü hissediyorum, hiç gücüm yok',
      );

      const outcome = await triageWith(
        AI_ON,
        modelSaying(
          '{"triage":"URGENT","complaint":"halsizlik","measurements":"","duration":"1 gün"}',
        ),
      ).triage(messageId);

      expect(outcome?.level).toBe(TriageLevel.URGENT);
      expect(outcome?.aiLevel).toBe(TriageLevel.URGENT);
      expect(await urgentPushes(nurse.userId)).toBe(1);

      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.aiSummary).toContain('Şikayet: halsizlik');
      expect(message.aiSummary).toContain('Süre: 1 gün');
      // The summary is stored beside the message, never instead of it.
      expect(message.body).toContain('kendimi çok kötü hissediyorum');
    });

    /**
     * The failure this design exists to survive: the model reads "göğsüm
     * ağrıyor" and answers INFO.
     */
    it('ignores a model that tries to talk an emergency down', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prisma.patientAssignment.create({
        data: { patientId, staffId: nurse.staffId!, role: Role.NURSE },
      });

      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(conversationId, patient.userId, 'göğsüm ağrıyor');

      const outcome = await triageWith(
        AI_ON,
        modelSaying('{"triage":"INFO","complaint":"kas ağrısı olabilir"}'),
      ).triage(messageId);

      expect(outcome?.level).toBe(TriageLevel.EMERGENCY);
      // What the model said is kept, because it is the record of a disagreement
      // somebody may want to look at.
      expect(outcome?.aiLevel).toBe(TriageLevel.INFO);
      expect(await urgentPushes(nurse.userId)).toBe(1);
    });

    it('keeps the floor when the model answers nonsense', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(conversationId, patient.userId, 'ateşim 38.5 çıktı');

      const outcome = await triageWith(AI_ON, modelSaying('Bunu değerlendiremiyorum.')).triage(
        messageId,
      );

      expect(outcome?.level).toBe(TriageLevel.URGENT);
      expect(outcome?.aiLevel).toBeNull();

      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.aiSummary).toBeNull();
    });

    /**
     * People sign their messages. Refusing every one that says "Ben Ayşe" would
     * leave exactly those without a summary, so the text is scrubbed and the
     * call goes through.
     */
    it('summarises a message the patient signed with their own name', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(
        conversationId,
        patient.userId,
        'Merhaba, ben Ayşe Yılmaz. Ateşim 38.5 ve yarada akıntı var.',
      );

      const outcome = await triageWith(
        AI_ON,
        modelSaying('{"triage":"URGENT","complaint":"yarada akıntı","measurements":"ateş 38.5"}'),
      ).triage(messageId);

      expect(outcome?.aiLevel).toBe(TriageLevel.URGENT);

      // The AI job exists, so the call was made rather than refused.
      const job = await prisma.aiJob.findFirst({ orderBy: { createdAt: 'desc' } });
      expect(job?.status).toBe('DONE');
    });

    it('records what the keywords caught alongside the level acted on', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(
        conversationId,
        patient.userId,
        'Ateşim 38 ve yarada akıntı var',
      );

      await triageWith(AI_ON, modelSaying('{"triage":"ROUTINE"}')).triage(messageId);

      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.triageLevel).toBe(TriageLevel.URGENT);
      expect(message.aiTriageLevel).toBe(TriageLevel.ROUTINE);
      expect(message.triageFlags.sort()).toEqual(['fever', 'wound-infection']);
    });
  });

  describe('who is told', () => {
    /** A patient with no care team is the patient nobody is watching. */
    it('falls through to the rota when nobody is assigned', async () => {
      const onRota = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(conversationId, patient.userId, 'bayıldım');

      await triageWith(AI_OFF).triage(messageId);

      expect(await urgentPushes(onRota.userId)).toBe(1);
    });

    it('tells the whole care team at once rather than in rungs', async () => {
      const nurse = await actorFor(Role.NURSE);
      const coordinator = await actorFor(Role.COORDINATOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await prisma.patientAssignment.create({
        data: { patientId, staffId: nurse.staffId!, role: Role.NURSE },
      });
      await prisma.patientAssignment.create({
        data: { patientId, staffId: coordinator.staffId!, role: Role.COORDINATOR },
      });

      const conversationId = await conversationWith(patientId);
      const messageId = await messageFrom(conversationId, patient.userId, 'nefes alamıyorum');

      const outcome = await triageWith(AI_OFF).triage(messageId);

      expect(outcome?.notified).toBe(2);
      expect(await urgentPushes(nurse.userId)).toBe(1);
      expect(await urgentPushes(coordinator.userId)).toBe(1);
    });
  });
});
