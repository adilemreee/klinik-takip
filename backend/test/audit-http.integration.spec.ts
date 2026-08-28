import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuditAction, PrismaClient, Role, UserStatus } from '@prisma/client';
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

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  actorId: string | null;
}

interface AuditPage {
  items: AuditRow[];
  nextCursor: string | null;
}

describe('audit endpoint', () => {
  const prisma = new PrismaClient();
  const created: string[] = [];
  const staffProfiles: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;

  const PASSWORD = 'correct-horse-battery-9';

  const tokenFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `audit-http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    created.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Audit', lastName: 'Test' },
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

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.deviceSession.deleteMany({ where: { userId: { in: created } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('access control', () => {
    it.each([Role.NURSE, Role.COORDINATOR, Role.FINANCE, Role.PATIENT])(
      'refuses %s',
      async (role) => {
        const { token } = await tokenFor(role);

        await request(server)
          .get('/audit')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      },
    );

    it.each([Role.DOCTOR, Role.SUPER_ADMIN])('allows %s', async (role) => {
      const { token } = await tokenFor(role);

      await request(server).get('/audit').set('Authorization', `Bearer ${token}`).expect(200);
    });

    it('refuses an unauthenticated request', async () => {
      await request(server).get('/audit').expect(401);
    });
  });

  describe('querying', () => {
    it('filters by actor', async () => {
      const reader = await tokenFor(Role.DOCTOR);
      const subject = await tokenFor(Role.PATIENT);

      const response = await request(server)
        .get('/audit')
        .query({ actorId: subject.userId })
        .set('Authorization', `Bearer ${reader.token}`)
        .expect(200);

      const page = response.body as AuditPage;
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((row) => row.actorId === subject.userId)).toBe(true);
    });

    it('filters by action', async () => {
      const reader = await tokenFor(Role.DOCTOR);

      const response = await request(server)
        .get('/audit')
        .query({ action: AuditAction.LOGIN, limit: 10 })
        .set('Authorization', `Bearer ${reader.token}`)
        .expect(200);

      const page = response.body as AuditPage;
      expect(page.items.every((row) => row.action === AuditAction.LOGIN)).toBe(true);
    });

    /**
     * Cursor, not offset (spec section 9): the audit table only grows, and an
     * investigation reads the far end of it.
     */
    it('pages with a cursor and does not repeat rows', async () => {
      const reader = await tokenFor(Role.DOCTOR);

      const first = await request(server)
        .get('/audit')
        .query({ limit: 3 })
        .set('Authorization', `Bearer ${reader.token}`)
        .expect(200);

      const firstPage = first.body as AuditPage;
      expect(firstPage.items).toHaveLength(3);
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      const second = await request(server)
        .get('/audit')
        .query({ limit: 3, cursor: firstPage.nextCursor })
        .set('Authorization', `Bearer ${reader.token}`)
        .expect(200);

      const secondPage = second.body as AuditPage;
      const firstIds = firstPage.items.map((r) => r.id);
      const secondIds = secondPage.items.map((r) => r.id);

      expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    });

    it('rejects a limit above the cap', async () => {
      const reader = await tokenFor(Role.DOCTOR);

      await request(server)
        .get('/audit')
        .query({ limit: 5000 })
        .set('Authorization', `Bearer ${reader.token}`)
        .expect(400);
    });
  });

  /** Reading the trail is itself a sensitive action, so it goes into the trail. */
  it('records the act of reading the audit log', async () => {
    const reader = await tokenFor(Role.DOCTOR);

    await request(server)
      .get('/audit')
      .query({ limit: 5 })
      .set('Authorization', `Bearer ${reader.token}`)
      .expect(200);

    const own = await prisma.auditLog.findMany({
      where: { actorId: reader.userId, entityType: 'audit_logs' },
    });

    expect(own.length).toBeGreaterThan(0);
    expect(own[0]?.action).toBe(AuditAction.READ);
  });

  it('serves anomaly detection to the same audience', async () => {
    const nurse = await tokenFor(Role.NURSE);
    const doctor = await tokenFor(Role.DOCTOR);

    await request(server)
      .get('/audit/anomalies')
      .set('Authorization', `Bearer ${nurse.token}`)
      .expect(403);

    await request(server)
      .get('/audit/anomalies')
      .query({ hours: 1 })
      .set('Authorization', `Bearer ${doctor.token}`)
      .expect(200);
  });
});
