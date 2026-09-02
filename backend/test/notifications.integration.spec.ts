import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  NotificationChannel,
  NotificationStatus,
  PrismaClient,
  Role,
  Sex,
  UserStatus,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { NotificationsService } from '../src/notifications/notifications.service';
import type { Deliverable, DeliveryResult, NotificationSender } from '../src/notifications/senders';
import { NOTIFICATION_TYPES } from '../src/notifications/templates';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

/** A sender a test can make succeed or fail on demand. */
class ScriptedSender implements NotificationSender {
  readonly sent: Deliverable[] = [];

  constructor(
    readonly channel: NotificationChannel,
    private result: DeliveryResult = { delivered: true },
  ) {}

  setResult(result: DeliveryResult): void {
    this.result = result;
  }

  send(message: Deliverable): Promise<DeliveryResult> {
    this.sent.push(message);
    return Promise.resolve(this.result);
  }
}

/**
 * Notifications (spec M6).
 *
 * The two things worth proving: a channel someone switched off stays off, and
 * a failed push actually falls through to the next channel with the whole
 * chain on the record.
 */
describe('notifications', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let notifications: NotificationsService;
  let push: ScriptedSender;
  let sms: ScriptedSender;
  let email: ScriptedSender;

  const PASSWORD = 'correct-horse-battery-9';

  const makePatientUser = async (
    language = 'tr',
    over: { phone?: string; email?: string } = {},
  ): Promise<{ token: string; userId: string }> => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        role: Role.PATIENT,
        email: over.email ?? `nt-${suffix}@test.local`,
        // Random rather than derived from the clock: the leading digits of a
        // timestamp are identical for a whole run, and phone is unique.
        phone: over.phone ?? `+9055${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-NT-${suffix}`,
        firstName: 'Ayse',
        lastName: 'Yilmaz',
        birthDate: new Date('1985-03-12'),
        sex: Sex.FEMALE,
        country: 'DE',
        preferredLanguage: language,
        userId: user.id,
      },
    });
    patientIds.push(patient.id);

    const login = await auth.login(user.email!, PASSWORD, undefined, {});
    return { token: login.tokens!.accessToken, userId: user.id };
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
    notifications = app.get(NotificationsService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  beforeEach(() => {
    // Replaces the unconfigured senders the module attaches at boot, so a test
    // can decide what each channel does.
    push = new ScriptedSender(NotificationChannel.PUSH);
    sms = new ScriptedSender(NotificationChannel.SMS);
    email = new ScriptedSender(NotificationChannel.EMAIL);

    notifications.registerSender(push);
    notifications.registerSender(sms);
    notifications.registerSender(email);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.pushToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  const registerToken = async (token: string, userId: string): Promise<void> => {
    await prisma.pushToken.create({
      data: { userId, token, platform: 'ios', isActive: true, lastUsedAt: new Date() },
    });
  };

  describe('dispatching', () => {
    it('writes the notification before anything is sent', async () => {
      const patient = await makePatientUser();

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.labReady,
      });

      expect(created?.status).toBe(NotificationStatus.PENDING);
      expect(created?.sentAt).toBeNull();
    });

    /** An SMS has no client to localise it, so the server renders the text. */
    it('renders the text in the recipient language', async () => {
      const turkish = await makePatientUser('tr');
      const english = await makePatientUser('en');

      const first = await notifications.dispatch({
        userId: turkish.userId,
        type: NOTIFICATION_TYPES.labReady,
      });
      const second = await notifications.dispatch({
        userId: english.userId,
        type: NOTIFICATION_TYPES.labReady,
      });

      expect(first?.title).toBe('Tahlil sonucunuz hazır');
      expect(second?.title).toBe('Your lab result is ready');
    });

    /** "lab.critical" on a lock screen would be worse than the wrong language. */
    it('falls back to Turkish for a language it has no text for', async () => {
      const patient = await makePatientUser('ru');

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.labReady,
      });

      expect(created?.title).toBe('Tahlil sonucunuz hazır');
    });

    it('refuses a type nobody defined', async () => {
      const patient = await makePatientUser();

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: 'not.a.type' as never,
      });

      expect(created).toBeNull();
    });

    it('carries the rich-notification actions', async () => {
      const patient = await makePatientUser();

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.medicationDue,
      });

      expect(JSON.stringify(created?.actions)).toContain('taken');
      expect(JSON.stringify(created?.actions)).toContain('snooze');
    });
  });

  describe('preferences', () => {
    /**
     * Absent means enabled: a patient who never opened the settings screen is
     * still told their results are ready.
     */
    it('sends when no preference was ever set', async () => {
      const patient = await makePatientUser();

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.labReady,
      });

      expect(created).not.toBeNull();
    });

    it('sends nothing for a type the recipient switched off', async () => {
      const patient = await makePatientUser();

      await prisma.notificationPreference.create({
        data: {
          userId: patient.userId,
          type: NOTIFICATION_TYPES.labReady,
          channel: NotificationChannel.PUSH,
          enabled: false,
        },
      });

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.labReady,
      });

      expect(created).toBeNull();
    });

    /**
     * Quiet hours delay, they do not cancel. A notification dropped for being
     * inconvenient is one the patient never learns existed.
     */
    it('holds a routine notification until quiet hours end', async () => {
      const patient = await makePatientUser();

      // A quiet range covering the whole day, so the test does not depend on
      // when it runs.
      await prisma.notificationPreference.create({
        data: {
          userId: patient.userId,
          type: NOTIFICATION_TYPES.labReady,
          channel: NotificationChannel.PUSH,
          enabled: true,
          quietHoursStart: '00:00',
          quietHoursEnd: '23:59',
          timezone: 'Europe/Istanbul',
        },
      });

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.labReady,
      });

      expect(created?.scheduledFor).not.toBeNull();
    });

    /** A critical value nobody looks at until morning is what this is for. */
    it('sends an urgent notification through quiet hours', async () => {
      const patient = await makePatientUser();

      await prisma.notificationPreference.create({
        data: {
          userId: patient.userId,
          type: NOTIFICATION_TYPES.labCritical,
          channel: NotificationChannel.PUSH,
          enabled: true,
          quietHoursStart: '00:00',
          quietHoursEnd: '23:59',
          timezone: 'Europe/Istanbul',
        },
      });

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.labCritical,
      });

      expect(created?.scheduledFor).toBeNull();
    });
  });

  describe('delivery and the fallback chain', () => {
    it('marks a delivered notification sent', async () => {
      const patient = await makePatientUser();
      await registerToken(`tok-${Date.now()}-a`, patient.userId);

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.labReady,
      });

      await notifications.deliverDue();

      const stored = await prisma.notification.findUniqueOrThrow({ where: { id: created!.id } });

      expect(stored.status).toBe(NotificationStatus.SENT);
      expect(push.sent).toHaveLength(1);
    });

    /**
     * The chain is the point. A failed push has to become a real attempt on the
     * next channel, linked to the one it stands in for, so afterwards anyone can
     * see what was tried and why each stopped.
     */
    it('falls through to SMS and then e-mail when push fails', async () => {
      const patient = await makePatientUser();
      await registerToken(`tok-${Date.now()}-b`, patient.userId);

      push.setResult({ delivered: false, reason: 'device unreachable' });
      sms.setResult({ delivered: false, reason: 'gateway rejected' });

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.labCritical,
      });

      // Each pass sends one link of the chain.
      await notifications.deliverDue();
      await notifications.deliverDue();
      await notifications.deliverDue();

      const chain = await prisma.notification.findMany({
        where: { userId: patient.userId },
        orderBy: { id: 'asc' },
      });

      expect(chain.map((row) => row.channel)).toEqual([
        NotificationChannel.PUSH,
        NotificationChannel.SMS,
        NotificationChannel.EMAIL,
      ]);
      expect(chain[0]!.status).toBe(NotificationStatus.FAILED);
      expect(chain[0]!.failureReason).toContain('refused');
      expect(chain[1]!.fallbackForId).toBe(created!.id);
      expect(chain[2]!.status).toBe(NotificationStatus.SENT);
    });

    /**
     * Falling back onto a channel someone switched off would make "no SMS
     * please" mean "SMS, but only when push fails".
     */
    it('does not fall back onto a channel the recipient switched off', async () => {
      const patient = await makePatientUser();
      await registerToken(`tok-${Date.now()}-c`, patient.userId);

      await prisma.notificationPreference.create({
        data: {
          userId: patient.userId,
          type: NOTIFICATION_TYPES.labCritical,
          channel: NotificationChannel.SMS,
          enabled: false,
        },
      });

      push.setResult({ delivered: false, reason: 'device unreachable' });

      await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.labCritical,
      });
      await notifications.deliverDue();

      const chain = await prisma.notification.findMany({
        where: { userId: patient.userId },
        orderBy: { id: 'asc' },
      });

      expect(chain.map((row) => row.channel)).toEqual([NotificationChannel.PUSH]);
    });

    /** A type with no fallback stops where it failed rather than inventing one. */
    it('does not fall back for a type with no chain', async () => {
      const patient = await makePatientUser();
      await registerToken(`tok-${Date.now()}-d`, patient.userId);

      push.setResult({ delivered: false, reason: 'device unreachable' });

      await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.newMessage,
      });
      await notifications.deliverDue();

      const chain = await prisma.notification.findMany({ where: { userId: patient.userId } });

      expect(chain).toHaveLength(1);
      expect(chain[0]!.status).toBe(NotificationStatus.FAILED);
    });

    /** A token the platform says is dead stops being used. */
    it('retires a token the platform reports as gone', async () => {
      const patient = await makePatientUser();
      const token = `tok-${Date.now()}-e`;
      await registerToken(token, patient.userId);

      push.setResult({ delivered: false, reason: 'unregistered', addressGone: true });

      await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.newMessage,
      });
      await notifications.deliverDue();

      const stored = await prisma.pushToken.findUniqueOrThrow({ where: { token } });
      expect(stored.isActive).toBe(false);
    });

    /** A held notification is not due yet and must not go early. */
    it('leaves a scheduled notification alone until its time', async () => {
      const patient = await makePatientUser();
      await registerToken(`tok-${Date.now()}-f`, patient.userId);

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.labReady,
        scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
      });

      await notifications.deliverDue();

      const stored = await prisma.notification.findUniqueOrThrow({ where: { id: created!.id } });
      expect(stored.status).toBe(NotificationStatus.PENDING);
    });

    it('records a failure when there is no address for the channel', async () => {
      const patient = await makePatientUser();

      const created = await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.newMessage,
      });
      await notifications.deliverDue();

      const stored = await prisma.notification.findUniqueOrThrow({ where: { id: created!.id } });

      expect(stored.status).toBe(NotificationStatus.FAILED);
      expect(stored.failureReason).toContain('address');
    });
  });

  describe('the settings screen', () => {
    it('registers and revokes a device token', async () => {
      const patient = await makePatientUser();
      const token = `tok-${Date.now()}-g`;

      await request(server)
        .post('/me/notifications/tokens')
        .set('Authorization', `Bearer ${patient.token}`)
        .send({ token, platform: 'ios' })
        .expect(201);

      expect((await prisma.pushToken.findUniqueOrThrow({ where: { token } })).isActive).toBe(true);

      await request(server)
        .delete('/me/notifications/tokens')
        .query({ token })
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(204);

      expect((await prisma.pushToken.findUniqueOrThrow({ where: { token } })).isActive).toBe(false);
    });

    /**
     * A phone handed to someone else, or a reinstall reusing a token, must not
     * keep delivering one person's clinical notifications to another.
     */
    it('moves a token to whoever registered it last', async () => {
      const first = await makePatientUser();
      const second = await makePatientUser();
      const token = `tok-${Date.now()}-h`;

      for (const patient of [first, second]) {
        await request(server)
          .post('/me/notifications/tokens')
          .set('Authorization', `Bearer ${patient.token}`)
          .send({ token, platform: 'android' })
          .expect(201);
      }

      const stored = await prisma.pushToken.findUniqueOrThrow({ where: { token } });
      expect(stored.userId).toBe(second.userId);
    });

    it('saves a preference and reads it back', async () => {
      const patient = await makePatientUser();

      await request(server)
        .put('/me/notifications/preferences')
        .set('Authorization', `Bearer ${patient.token}`)
        .send({
          type: NOTIFICATION_TYPES.labReady,
          channel: NotificationChannel.PUSH,
          enabled: false,
          quietHoursStart: '22:00',
          quietHoursEnd: '08:00',
        })
        .expect(200);

      const response = await request(server)
        .get('/me/notifications/preferences')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      const rows = response.body as { enabled: boolean; quietHoursStart: string }[];

      expect(rows[0]!.enabled).toBe(false);
      expect(rows[0]!.quietHoursStart).toBe('22:00');
    });

    it('refuses a quiet-hours value that is not a time', async () => {
      const patient = await makePatientUser();

      await request(server)
        .put('/me/notifications/preferences')
        .set('Authorization', `Bearer ${patient.token}`)
        .send({
          type: NOTIFICATION_TYPES.labReady,
          channel: NotificationChannel.PUSH,
          enabled: true,
          quietHoursStart: 'evening',
        })
        .expect(400);
    });

    /**
     * A patient who was never reached should be able to see the clinic tried,
     * and the clinic should be able to see it too.
     */
    it('lists failed attempts alongside delivered ones', async () => {
      const patient = await makePatientUser();

      push.setResult({ delivered: false, reason: 'device unreachable' });
      await notifications.dispatch({
        userId: patient.userId,
        type: NOTIFICATION_TYPES.newMessage,
      });
      await notifications.deliverDue();

      const response = await request(server)
        .get('/me/notifications')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      const rows = response.body as { status: string; failureReason: string | null }[];

      expect(rows[0]!.status).toBe(NotificationStatus.FAILED);
      expect(rows[0]!.failureReason).not.toBeNull();
    });

    it('refuses an unauthenticated request', async () => {
      await request(server).get('/me/notifications').expect(401);
    });
  });
});
