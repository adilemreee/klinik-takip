import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { TokenService } from '../src/auth/token.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

/**
 * The authorisation boundary over real HTTP.
 *
 * The guard is global and denies by default, so these tests are the check that
 * a route is protected unless someone deliberately opened it — the property
 * that keeps a newly added endpoint from silently exposing patient data.
 */
describe('auth over HTTP', () => {
  const prisma = new PrismaClient();
  const created: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let tokens: TokenService;

  const PASSWORD = 'correct-horse-battery-9';

  const makeUser = async (role: Role): Promise<{ id: string; email: string }> => {
    const email = `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    created.push(user.id);
    return { id: user.id, email };
  };

  beforeAll(async () => {
    const stub = { ping: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(RedisService)
      .useValue(stub)
      .overrideProvider(StorageService)
      .useValue(stub)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();

    server = app.getHttpServer() as Server;
    auth = app.get(AuthService);
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    await prisma.deviceSession.deleteMany({ where: { userId: { in: created } } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('deny by default', () => {
    it.each([
      ['get', '/auth/sessions'],
      ['post', '/auth/logout'],
      ['post', '/auth/logout-all'],
      ['post', '/auth/invitations'],
    ])('refuses %s %s without a token', async (method, path) => {
      await request(server)[method as 'get' | 'post'](path).expect(401);
    });

    it('refuses a malformed Authorization header', async () => {
      await request(server)
        .get('/auth/sessions')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('leaves the health probes open, since Docker polls them unauthenticated', async () => {
      await request(server).get('/health/live').expect(200);
    });

    it('leaves login open', async () => {
      // Wrong credentials, but reached the handler rather than the guard.
      await request(server)
        .post('/auth/login')
        .send({ identifier: 'nobody@test.local', password: 'whatever-value-1' })
        .expect(401)
        .expect((res: { body: { message?: string } }) => {
          expect(res.body.message).toBe('INVALID_CREDENTIALS');
        });
    });
  });

  describe('session tokens', () => {
    it('accepts a valid token and lists the caller sessions', async () => {
      const user = await makeUser(Role.PATIENT);
      const login = await auth.login(user.email, PASSWORD, undefined, { deviceName: 'Test' });

      const response = await request(server)
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${login.tokens!.accessToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
    });

    /**
     * An access token stays cryptographically valid until it expires, so
     * "sign out this device" only works if the guard also checks the session.
     */
    it('stops accepting an access token once the device is signed out', async () => {
      const user = await makeUser(Role.PATIENT);
      const login = await auth.login(user.email, PASSWORD, undefined, { deviceName: 'Test' });
      const payload = await tokens.verifyAccessToken(login.tokens!.accessToken);

      await tokens.revokeFamily(payload.fid);

      await request(server)
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${login.tokens!.accessToken}`)
        .expect(401);
    });

    it('will not let one user revoke another user session', async () => {
      const victim = await makeUser(Role.PATIENT);
      const attacker = await makeUser(Role.PATIENT);

      const victimLogin = await auth.login(victim.email, PASSWORD, undefined, {});
      const attackerLogin = await auth.login(attacker.email, PASSWORD, undefined, {});
      const victimPayload = await tokens.verifyAccessToken(victimLogin.tokens!.accessToken);

      await request(server)
        .delete(`/auth/sessions/${victimPayload.fid}`)
        .set('Authorization', `Bearer ${attackerLogin.tokens!.accessToken}`)
        .expect(401);

      // The victim's session is untouched.
      await request(server)
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${victimLogin.tokens!.accessToken}`)
        .expect(200);
    });
  });

  describe('the scoped enrolment token', () => {
    it('is issued to staff who have no second factor yet', async () => {
      const user = await makeUser(Role.DOCTOR);

      const response = await request(server)
        .post('/auth/login')
        .send({ identifier: user.email, password: PASSWORD })
        .expect(200);

      const body = response.body as { status: string; setupToken?: string; accessToken?: string };

      expect(body.status).toBe('MFA_SETUP_REQUIRED');
      expect(body.setupToken).toEqual(expect.any(String));
      // No session tokens: the account is not usable until 2FA exists.
      expect(body.accessToken).toBeUndefined();
    });

    it('opens the enrolment endpoint', async () => {
      const user = await makeUser(Role.DOCTOR);
      const login = await auth.login(user.email, PASSWORD, undefined, {});

      const response = await request(server)
        .post('/auth/2fa/setup')
        .set('Authorization', `Bearer ${login.setupToken!}`)
        .expect(201);

      expect((response.body as { uri: string }).uri).toContain('otpauth://');
    });

    /** The whole point of scoping it. */
    it.each([
      ['get', '/auth/sessions'],
      ['post', '/auth/logout-all'],
      ['post', '/auth/invitations'],
    ])('is refused on %s %s', async (method, path) => {
      const user = await makeUser(Role.DOCTOR);
      const login = await auth.login(user.email, PASSWORD, undefined, {});

      await request(server)
        [method as 'get' | 'post'](path)
        .set('Authorization', `Bearer ${login.setupToken!}`)
        .expect(401);
    });
  });

  describe('input validation', () => {
    it('rejects a login body with unknown fields', async () => {
      await request(server)
        .post('/auth/login')
        .send({ identifier: 'a@b.co', password: 'x'.repeat(20), isAdmin: true })
        .expect(400);
    });

    it('rejects a missing password', async () => {
      await request(server).post('/auth/login').send({ identifier: 'a@b.co' }).expect(400);
    });
  });
});
