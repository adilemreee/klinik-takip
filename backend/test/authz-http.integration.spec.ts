import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { isStaffRole } from '../src/auth/auth.errors';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

/**
 * Permission enforcement over real HTTP, per role.
 *
 * Spec section 11 asks for exactly this: for every role, the endpoints it must
 * NOT reach. Testing it at the HTTP boundary rather than against the service
 * also proves the guards are wired in the right order.
 */
describe('permissions over HTTP', () => {
  const prisma = new PrismaClient();
  const created: string[] = [];
  const staffProfiles: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;

  const PASSWORD = 'correct-horse-battery-9';

  /** Signs in as the given role, enrolling 2FA first where it is mandatory. */
  const tokenFor = async (role: Role): Promise<string> => {
    const email = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    created.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Perm', lastName: 'Test' },
      });
      staffProfiles.push(profile.id);

      const setup = await auth.beginTotpEnrolment(user.id);
      await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));

      const login = await auth.login(email, PASSWORD, generateSync({ secret: setup.secret }), {});
      return login.tokens!.accessToken;
    }

    const login = await auth.login(email, PASSWORD, undefined, {});
    return login.tokens!.accessToken;
  };

  beforeAll(async () => {
    const stub = { ping: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(StorageService)
      .useValue(stub)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();

    server = app.getHttpServer() as Server;
    auth = app.get(AuthService);

    // The permission cache is shared with the running Redis; clear anything
    // left by an earlier run so these assertions read the database.
    await app.get(RedisService).client.flushdb();
  });

  afterAll(async () => {
    await prisma.deviceSession.deleteMany({ where: { userId: { in: created } } });
    await prisma.invitation.deleteMany({ where: { invitedById: { in: created } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await app?.close();
    await prisma.$disconnect();
  });

  const invite = (token: string): request.Test =>
    request(server)
      .post('/auth/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: `invitee-${Date.now()}@test.local`, role: Role.NURSE });

  describe('POST /auth/invitations requires staff.manage', () => {
    it.each([Role.NURSE, Role.COORDINATOR, Role.FINANCE, Role.PATIENT, Role.CAREGIVER])(
      'refuses %s',
      async (role) => {
        const token = await tokenFor(role);

        const response = await invite(token).expect(403);

        const body = response.body as { message: string };
        expect(body.message).toContain('staff.manage');
      },
    );

    it.each([Role.DOCTOR, Role.SUPER_ADMIN])('allows %s', async (role) => {
      const token = await tokenFor(role);

      await invite(token).expect(201);
    });
  });

  describe('guard ordering', () => {
    /**
     * If the permission guard ran before authentication it would answer 403
     * here instead of 401 — a wiring mistake that would also mean it never sees
     * a user at all.
     */
    it('answers 401, not 403, when no token is presented', async () => {
      await request(server).post('/auth/invitations').send({ role: Role.NURSE }).expect(401);
    });

    it('answers 401 for a token whose session was revoked', async () => {
      const token = await tokenFor(Role.DOCTOR);
      const userIds = created.slice(-1);
      await prisma.deviceSession.updateMany({
        where: { userId: { in: userIds } },
        data: { revokedAt: new Date() },
      });

      await request(server)
        .post('/auth/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ role: Role.NURSE })
        .expect(401);
    });
  });

  describe('per-user overrides take effect over HTTP', () => {
    it('lets a nurse invite once granted staff.manage', async () => {
      const token = await tokenFor(Role.NURSE);
      const userId = created[created.length - 1]!;

      await invite(token).expect(403);

      await prisma.userPermission.create({
        data: { userId, permissionCode: 'staff.manage', granted: true },
      });
      await app.get(RedisService).client.del(`perms:${userId}`);

      await invite(token).expect(201);

      await prisma.userPermission.deleteMany({ where: { userId } });
    });

    it('stops a doctor inviting once staff.manage is revoked', async () => {
      const token = await tokenFor(Role.DOCTOR);
      const userId = created[created.length - 1]!;

      await invite(token).expect(201);

      await prisma.userPermission.create({
        data: { userId, permissionCode: 'staff.manage', granted: false },
      });
      await app.get(RedisService).client.del(`perms:${userId}`);

      await invite(token).expect(403);

      await prisma.userPermission.deleteMany({ where: { userId } });
    });
  });
});
