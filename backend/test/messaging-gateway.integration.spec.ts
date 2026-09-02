import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role, Sex, UserStatus } from '@prisma/client';
import { generateSync } from 'otplib';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { isStaffRole } from '../src/auth/auth.errors';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { MessagingService } from '../src/messaging/messaging.service';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

/**
 * The live channel.
 *
 * The socket carries no authority of its own: the same token, the same scope
 * check and the same silence apply here as on the REST side. A channel that
 * authorised differently would be the way around every rule the REST side
 * enforces, which is what most of these tests are about.
 */
describe('messaging over the socket', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];
  const sockets: Socket[] = [];

  let app: INestApplication;
  let url: string;
  let auth: AuthService;
  let messaging: MessagingService;
  let doctor: { token: string; userId: string };

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Ws', lastName: role },
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
        mrn: `MRN-WS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const connect = async (token?: string): Promise<Socket> => {
    const socket = io(`${url}/messaging`, {
      transports: ['websocket'],
      auth: token ? { token } : {},
      reconnection: false,
    });
    sockets.push(socket);

    await new Promise<void>((resolve) => {
      socket.on('connect', () => resolve());
      socket.on('disconnect', () => resolve());
      socket.on('connect_error', () => resolve());
    });

    return socket;
  };

  /** emitWithAck is typed `any`; the gateway answers with this shape. */
  const ack = async (
    socket: Socket,
    event: string,
    payload: unknown,
  ): Promise<Record<string, boolean>> =>
    (await socket.emitWithAck(event, payload)) as Record<string, boolean>;

  /** Waits for one event, or gives up — a test must not hang on silence. */
  const nextEvent = <T>(socket: Socket, event: string, timeoutMs = 3000): Promise<T | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
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
    await app.listen(0);

    const address = (app.getHttpServer() as Server).address();
    const port = typeof address === 'object' && address ? address.port : 0;
    url = `http://127.0.0.1:${port}`;

    auth = app.get(AuthService);
    messaging = app.get(MessagingService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();

    doctor = await actorFor(Role.DOCTOR);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();

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

  it('refuses a connection with no token', async () => {
    const socket = await connect();

    expect(socket.connected).toBe(false);
  }, 15_000);

  it('refuses a connection with a token it cannot verify', async () => {
    const socket = await connect('not.a.token');

    expect(socket.connected).toBe(false);
  }, 15_000);

  it('accepts a connection with a valid token', async () => {
    const socket = await connect(doctor.token);

    expect(socket.connected).toBe(true);
  }, 15_000);

  /**
   * The check that matters. Without it a socket could join any room by guessing
   * an id and receive another patient's messages in real time — a quieter
   * version of the leak the REST scope check exists to prevent.
   */
  it('refuses to join a conversation outside the caller scope', async () => {
    const patientId = await makePatient();
    const conversation = await prisma.conversation.create({ data: { patientId } });
    const nurse = await actorFor(Role.NURSE);

    const socket = await connect(nurse.token);
    const result = await ack(socket, 'join', { conversationId: conversation.id });

    expect(result).toEqual({ joined: false });
  }, 15_000);

  it('refuses to join a conversation that does not exist', async () => {
    const socket = await connect(doctor.token);
    const result = await ack(socket, 'join', {
      conversationId: '00000000-0000-0000-0000-000000000000',
    });

    expect(result).toEqual({ joined: false });
  }, 15_000);

  it('delivers a message to the room', async () => {
    const patientId = await makePatient();
    const conversation = await prisma.conversation.create({ data: { patientId } });

    const socket = await connect(doctor.token);
    await ack(socket, 'join', { conversationId: conversation.id });

    const delivered = nextEvent<{ body: string }>(socket, 'message');

    await messaging.send(
      { id: doctor.userId, role: Role.DOCTOR, familyId: 'f' },
      conversation.id,
      { body: 'Merhaba' },
    );

    expect((await delivered)?.body).toBe('Merhaba');
  }, 15_000);

  /** Nobody outside the room hears anything. */
  it('does not deliver to a socket that never joined', async () => {
    const patientId = await makePatient();
    const conversation = await prisma.conversation.create({ data: { patientId } });

    const socket = await connect(doctor.token);
    const delivered = nextEvent(socket, 'message', 1500);

    await messaging.send(
      { id: doctor.userId, role: Role.DOCTOR, familyId: 'f' },
      conversation.id,
      { body: 'Merhaba' },
    );

    expect(await delivered).toBeNull();
  }, 15_000);

  /**
   * A held message must not reach a clinician's screen the instant the patient
   * wrote it — that is the one thing the access window exists to prevent.
   */
  it('does not announce a queued message', async () => {
    const patient = await actorFor(Role.PATIENT);
    const patientId = await makePatient(patient.userId);
    const conversation = await prisma.conversation.create({ data: { patientId } });

    const today = new Date().getDay();
    const window = await prisma.accessWindow.create({
      data: {
        dayOfWeek: (today + 3) % 7,
        startTime: '18:00',
        endTime: '20:00',
        timezone: 'Europe/Istanbul',
      },
    });

    try {
      const socket = await connect(doctor.token);
      await ack(socket, 'join', { conversationId: conversation.id });

      const delivered = nextEvent(socket, 'message', 1500);

      await messaging.send(
        { id: patient.userId, role: Role.PATIENT, familyId: 'f' },
        conversation.id,
        { body: 'Ağrım var' },
      );

      expect(await delivered).toBeNull();
    } finally {
      await prisma.accessWindow.delete({ where: { id: window.id } });
    }
  }, 15_000);

  /**
   * Broadcast and never stored: it is true for a few seconds and then it is
   * not, and a record of who was typing when is surveillance rather than a
   * feature.
   */
  it('passes the typing indicator to the other side only', async () => {
    const patient = await actorFor(Role.PATIENT);
    const patientId = await makePatient(patient.userId);
    const conversation = await prisma.conversation.create({ data: { patientId } });

    const clinician = await connect(doctor.token);
    const theirs = await connect(patient.token);

    await ack(clinician, 'join', { conversationId: conversation.id });
    await ack(theirs, 'join', { conversationId: conversation.id });

    const heard = nextEvent<{ userId: string }>(clinician, 'typing');
    const echo = nextEvent(theirs, 'typing', 1500);

    theirs.emit('typing', { conversationId: conversation.id });

    expect((await heard)?.userId).toBe(patient.userId);
    // The sender does not hear their own typing.
    expect(await echo).toBeNull();
  }, 15_000);

  /** Typing into a room you never joined reaches nobody. */
  it('ignores typing from a socket that never joined', async () => {
    const patientId = await makePatient();
    const conversation = await prisma.conversation.create({ data: { patientId } });

    const listener = await connect(doctor.token);
    await ack(listener, 'join', { conversationId: conversation.id });

    const outsider = await connect(doctor.token);
    const heard = nextEvent(listener, 'typing', 1500);

    outsider.emit('typing', { conversationId: conversation.id });

    expect(await heard).toBeNull();
  }, 15_000);
});
