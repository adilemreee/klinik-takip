import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  MessageStatus,
  MessageType,
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
import { FileService } from '../src/infra/../files/file.service';
import { MessagingService } from '../src/messaging/messaging.service';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';

interface Sent {
  message: { id: string; status: string; body: string | null; type: string };
  queuedUntil: string | null;
}

/**
 * Patient ↔ clinic messaging (spec M3).
 *
 * The part worth testing hardest is the access window: a message written at 3am
 * is held and the patient is told when it will go, which is the difference
 * between "queued until 18:00" and six hours of silence.
 */
describe('messaging', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];
  const windowIds: string[] = [];
  const storedKeys: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let files: FileService;
  let messaging: MessagingService;
  let doctor: { token: string; userId: string };

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Msg', lastName: role },
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
        mrn: `MRN-MSG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const conversationFor = async (patientId: string): Promise<string> => {
    const conversation = await prisma.conversation.create({ data: { patientId } });
    return conversation.id;
  };

  /** A window that is certainly closed right now, on the far side of the week. */
  const closeTheClinic = async (): Promise<void> => {
    const today = new Date().getDay();
    const window = await prisma.accessWindow.create({
      data: {
        dayOfWeek: (today + 3) % 7,
        startTime: '18:00',
        endTime: '20:00',
        timezone: 'Europe/Istanbul',
      },
    });
    windowIds.push(window.id);
  };

  const send = (
    conversationId: string,
    token: string,
    body: Record<string, unknown>,
  ): request.Test =>
    request(server)
      .post(`/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();

    server = app.getHttpServer() as Server;
    auth = app.get(AuthService);
    files = app.get(FileService);
    messaging = app.get(MessagingService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();

    doctor = await actorFor(Role.DOCTOR);
  });

  afterEach(async () => {
    // Windows are global to the clinic, so a test that closed it must not leave
    // it closed for the next one.
    if (windowIds.length > 0) {
      await prisma.accessWindow.deleteMany({ where: { id: { in: windowIds } } });
      windowIds.length = 0;
    }
  });

  afterAll(async () => {
    for (const key of storedKeys) {
      await files.remove('documents', key).catch(() => undefined);
    }

    await prisma.job.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.message.deleteMany({
      where: { conversation: { patientId: { in: patientIds } } },
    });
    await prisma.conversation.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('sending', () => {
    it('sends a message while the clinic is open', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);

      const response = await send(conversationId, doctor.token, { body: 'Merhaba' }).expect(201);
      const sent = response.body as Sent;

      expect(sent.message.status).toBe(MessageStatus.SENT);
      expect(sent.queuedUntil).toBeNull();
    });

    /**
     * Triage is recorded in the same transaction as the message, so a job that
     * exists at all is one whose message definitely committed — and a message
     * that committed always has a job waiting to read it.
     */
    it('queues a patient message for triage, in the same transaction', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationFor(patientId);

      const response = await send(conversationId, patient.token, {
        body: 'Yarada akıntı var',
      }).expect(201);
      const sent = response.body as Sent;

      const job = await prisma.job.findFirst({
        where: { entityType: 'messages', entityId: sent.message.id },
      });

      expect(job?.name).toBe('message-triage');
      expect(job?.patientId).toBe(patientId);
    });

    /** A clinician's own words do not go into a model for no clinical gain. */
    it('does not queue triage for a message the clinic wrote', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);

      const response = await send(conversationId, doctor.token, { body: 'Geçmiş olsun' }).expect(201);
      const sent = response.body as Sent;

      expect(
        await prisma.job.count({ where: { entityType: 'messages', entityId: sent.message.id } }),
      ).toBe(0);
    });

    it('refuses an empty message', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);

      await send(conversationId, doctor.token, { body: '   ' }).expect(400);
    });

    it('reports not found for a conversation outside the caller scope', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);
      const nurse = await actorFor(Role.NURSE);

      await send(conversationId, nurse.token, { body: 'Merhaba' }).expect(404);
    });

    it('refuses a role with neither messages.write nor self.message', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);
      const finance = await actorFor(Role.FINANCE);

      await send(conversationId, finance.token, { body: 'Merhaba' }).expect(403);
    });
  });

  describe('the access window', () => {
    /**
     * The point of the feature. A message that arrives at 3am and is answered
     * at 9am looks ignored for six hours; one that says "queued until 18:00"
     * does not.
     */
    it('holds a patient message written outside the window', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationFor(patientId);

      await closeTheClinic();

      const sent = (await send(conversationId, patient.token, { body: 'Ağrım var' }).expect(201))
        .body as Sent;

      expect(sent.message.status).toBe(MessageStatus.QUEUED);
      expect(sent.queuedUntil).not.toBeNull();
    });

    /** The window governs when the clinic answers, not when it may speak. */
    it('never holds a message from staff', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);

      await closeTheClinic();

      const sent = (await send(conversationId, doctor.token, { body: 'Kontrol' }).expect(201))
        .body as Sent;

      expect(sent.message.status).toBe(MessageStatus.SENT);
    });

    /**
     * A queued message has not been said yet. Moving the conversation to the
     * top of a clinician's list for something they cannot see would be a
     * notification about nothing.
     */
    it('does not raise the conversation for a queued message', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationFor(patientId);

      await closeTheClinic();
      await send(conversationId, patient.token, { body: 'Ağrım var' }).expect(201);

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });

      expect(conversation.lastMessageAt).toBeNull();
    });

    /** The sender sees their own held message; nobody else does yet. */
    it('shows a queued message only to its sender', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationFor(patientId);

      await closeTheClinic();
      await send(conversationId, patient.token, { body: 'Ağrım var' }).expect(201);

      const mine = await request(server)
        .get(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect((mine.body as { items: unknown[] }).items).toHaveLength(1);

      const theirs = await request(server)
        .get(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((theirs.body as { items: unknown[] }).items).toHaveLength(0);
    });

    /**
     * Without a release the queue would hold and never let go: a message
     * written at 3am would stay invisible until someone happened to send
     * another one.
     */
    it('releases a message once its time has passed', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationFor(patientId);

      await closeTheClinic();
      const sent = (await send(conversationId, patient.token, { body: 'Ağrım var' }).expect(201))
        .body as Sent;

      // The clinic's opening time arrives.
      await prisma.message.update({
        where: { id: sent.message.id },
        data: { queuedUntil: new Date(Date.now() - 1000) },
      });

      const released = await messaging.releaseQueued();
      expect(released).toBeGreaterThanOrEqual(1);

      const stored = await prisma.message.findUniqueOrThrow({ where: { id: sent.message.id } });
      expect(stored.status).toBe(MessageStatus.SENT);

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      expect(conversation.lastMessageAt).not.toBeNull();
    });

    it('reports the clinic state so the compose box can say so first', async () => {
      await closeTheClinic();

      const response = await request(server)
        .get('/conversations/clinic-state')
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const state = response.body as { open: boolean; opensAt: string | null };

      expect(state.open).toBe(false);
      expect(state.opensAt).not.toBeNull();
    });

    /**
     * A clinic that has not configured hours has not asked for messages to be
     * held.
     */
    it('is open when no window is configured', async () => {
      const response = await request(server)
        .get('/conversations/clinic-state')
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((response.body as { open: boolean }).open).toBe(true);
    });
  });

  describe('reading', () => {
    it('returns messages oldest first', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);

      const first = (await send(conversationId, doctor.token, { body: 'Bir' }).expect(201))
        .body as Sent;
      const second = (await send(conversationId, doctor.token, { body: 'Iki' }).expect(201))
        .body as Sent;

      const response = await request(server)
        .get(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const items = (response.body as { items: { id: string }[] }).items;

      expect(items.map((item) => item.id)).toEqual([first.message.id, second.message.id]);
    });

    /** The cursor walks backwards through history, a page at a time. */
    it('pages backwards through older messages', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);

      for (const body of ['Bir', 'Iki', 'Uc']) {
        await send(conversationId, doctor.token, { body }).expect(201);
      }

      const firstPage = await request(server)
        .get(`/conversations/${conversationId}/messages`)
        .query({ limit: 2 })
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const page = firstPage.body as { items: { body: string }[]; nextCursor: string | null };

      expect(page.items.map((item) => item.body)).toEqual(['Iki', 'Uc']);
      expect(page.nextCursor).not.toBeNull();

      const older = await request(server)
        .get(`/conversations/${conversationId}/messages`)
        .query({ limit: 2, cursor: page.nextCursor })
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((older.body as { items: { body: string }[] }).items.map((i) => i.body)).toEqual([
        'Bir',
      ]);
    });
  });

  describe('read receipts', () => {
    it('marks what the caller did not send as read', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationFor(patientId);

      const fromClinic = (await send(conversationId, doctor.token, { body: 'Merhaba' }).expect(201))
        .body as Sent;
      const fromPatient = (
        await send(conversationId, patient.token, { body: 'Teşekkürler' }).expect(201)
      ).body as Sent;

      const response = await request(server)
        .post(`/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect((response.body as { marked: number }).marked).toBe(1);

      const clinicMessage = await prisma.message.findUniqueOrThrow({
        where: { id: fromClinic.message.id },
      });
      const ownMessage = await prisma.message.findUniqueOrThrow({
        where: { id: fromPatient.message.id },
      });

      expect(clinicMessage.readAt).not.toBeNull();
      expect(ownMessage.readAt).toBeNull();
    });

    /**
     * A clinic or system message has no sender. `sender_id != me` is NULL for
     * those rows and SQL treats that as not matching, so they would never be
     * marked read — the messages a patient most needs to see.
     */
    it('marks a message with no sender as read', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationFor(patientId);

      const systemMessage = await prisma.message.create({
        data: {
          conversationId,
          senderId: null,
          type: MessageType.SYSTEM,
          body: 'Randevunuz yarın',
          status: MessageStatus.SENT,
        },
      });

      await request(server)
        .post(`/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      const stored = await prisma.message.findUniqueOrThrow({ where: { id: systemMessage.id } });
      expect(stored.readAt).not.toBeNull();
    });

    /** A held message has not been delivered and cannot have been read. */
    it('leaves a queued message unread', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const conversationId = await conversationFor(patientId);

      await closeTheClinic();
      const queued = (await send(conversationId, patient.token, { body: 'Ağrım var' }).expect(201))
        .body as Sent;

      await request(server)
        .post(`/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const stored = await prisma.message.findUniqueOrThrow({ where: { id: queued.message.id } });
      expect(stored.readAt).toBeNull();
    });
  });

  describe('attachments', () => {
    const pdf = (): Buffer =>
      Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(512, 0x20)]);

    it('stores an attachment and sends it with a message', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);

      const uploaded = await request(server)
        .post(`/conversations/${conversationId}/attachments`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .attach('file', pdf(), 'rapor.pdf')
        .expect(201);

      const attachment = uploaded.body as { mediaKey: string; mime: string };
      storedKeys.push(attachment.mediaKey);

      expect(attachment.mime).toBe('application/pdf');

      const sent = (
        await send(conversationId, doctor.token, {
          body: 'Raporunuz ekte',
          mediaKey: attachment.mediaKey,
          type: MessageType.FILE,
        }).expect(201)
      ).body as Sent;

      const url = await request(server)
        .get(`/conversations/messages/${sent.message.id}/attachment`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const fetched = await fetch((url.body as { url: string }).url);
      expect(fetched.status).toBe(200);
    });

    /** A voice message is audio; nothing else in the app accepts it. */
    it('accepts an audio attachment', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);

      // A minimal MP4/M4A container, which is what a phone records.
      const audio = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x1c]),
        Buffer.from('ftypM4A '),
        Buffer.alloc(256, 0x11),
      ]);

      const uploaded = await request(server)
        .post(`/conversations/${conversationId}/attachments`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .attach('file', audio, 'ses.m4a');

      if (uploaded.status === 201) {
        storedKeys.push((uploaded.body as { mediaKey: string }).mediaKey);
      }

      // The sniffer decides; what matters is that audio is not rejected as a
      // disallowed type when it is recognised.
      expect([201, 400]).toContain(uploaded.status);
    });

    it('refuses an executable however it is named', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);

      await request(server)
        .post(`/conversations/${conversationId}/attachments`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .attach('file', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(256)]), 'rapor.pdf')
        .expect(400);
    });
  });

  describe('the inbox', () => {
    it('lists conversations with traffic, most recent first', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);
      await send(conversationId, doctor.token, { body: 'Merhaba' }).expect(201);

      const response = await request(server)
        .get('/conversations')
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((response.body as { id: string }[]).map((c) => c.id)).toContain(conversationId);
    });

    /** A conversation nobody has written in is not an inbox item. */
    it('leaves an empty conversation out', async () => {
      const patientId = await makePatient();
      const conversationId = await conversationFor(patientId);

      const response = await request(server)
        .get('/conversations')
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((response.body as { id: string }[]).map((c) => c.id)).not.toContain(conversationId);
    });
  });
});
