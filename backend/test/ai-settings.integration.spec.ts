import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AiSettingsService } from '../src/ai/ai-settings.service';
import { AppModule } from '../src/app.module';
import { isStaffRole } from '../src/auth/auth.errors';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

const prisma = new PrismaClient();

interface SettingsView {
  provider: string | null;
  model: string | null;
  apiKeyLast4: string | null;
  hasApiKey: boolean;
  zeroRetentionConfirmed: boolean;
  zeroRetentionNote: string | null;
  ready: boolean;
  missing: string[];
}

/**
 * Choosing the AI provider and entering the key (spec 3.4, 14.5).
 *
 * Two properties carry this. The key goes in and never comes back out. And the
 * zero-retention declaration belongs to the provider it was made about — the
 * four services do not offer the same terms, so carrying a declaration across
 * a provider change would be recording consent nobody gave.
 */
describe('AI settings', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let settings: AiSettingsService;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `ais-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Ayşe', lastName: role },
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

  const put = (token: string, body: Record<string, unknown>): request.Test =>
    request(server).put('/ai/settings').set('Authorization', `Bearer ${token}`).send(body);

  const get = (token: string): request.Test =>
    request(server).get('/ai/settings').set('Authorization', `Bearer ${token}`);

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
    settings = app.get(AiSettingsService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterEach(async () => {
    await prisma.aiSetting.deleteMany({});
  });

  afterAll(async () => {
    await prisma.aiSetting.deleteMany({});
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('the key', () => {
    it('goes in and never comes back out', async () => {
      const admin = await actorFor(Role.SUPER_ADMIN);

      await put(admin.token, {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'sk-ant-secret-value-1234',
        inputPricePerMTok: '3',
        outputPricePerMTok: '15',
      }).expect(200);

      const view = (await get(admin.token).expect(200)).body as SettingsView;
      const raw = JSON.stringify(view);

      expect(view.hasApiKey).toBe(true);
      // The only question a screen has about a key: which one is it.
      expect(view.apiKeyLast4).toBe('1234');
      expect(raw).not.toContain('sk-ant-secret-value-1234');
      expect(raw).not.toContain('secret-value');
    });

    it('is encrypted in the database, not merely hidden by the endpoint', async () => {
      const admin = await actorFor(Role.SUPER_ADMIN);

      await put(admin.token, {
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'sk-openai-plaintext-9876',
        inputPricePerMTok: '1',
        outputPricePerMTok: '2',
      }).expect(200);

      const row = await prisma.aiSetting.findUniqueOrThrow({ where: { id: 'singleton' } });

      expect(row.apiKeyEncrypted).not.toBeNull();
      expect(row.apiKeyEncrypted).not.toContain('sk-openai-plaintext-9876');
    });

    it('is left alone when a later update does not mention it', async () => {
      // Changing the price must not require re-typing the key.
      const admin = await actorFor(Role.SUPER_ADMIN);

      await put(admin.token, {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'sk-ant-first-key-4321',
        inputPricePerMTok: '3',
        outputPricePerMTok: '15',
      }).expect(200);

      const after = (await put(admin.token, { inputPricePerMTok: '4' }).expect(200))
        .body as SettingsView;

      expect(after.hasApiKey).toBe(true);
      expect(after.apiKeyLast4).toBe('4321');
    });

    it('never reaches the audit log either', async () => {
      // An audit log is read by more people than a settings screen is.
      const admin = await actorFor(Role.SUPER_ADMIN);

      await put(admin.token, {
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        apiKey: 'AIza-audit-should-not-see-this',
        inputPricePerMTok: '1',
        outputPricePerMTok: '2',
      }).expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { entityType: 'ai_settings' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      expect(entries.length).toBeGreaterThan(0);
      expect(JSON.stringify(entries)).not.toContain('audit-should-not-see-this');
    });
  });

  describe('the zero-retention declaration', () => {
    it('is cleared when the provider changes', async () => {
      // The four services do not offer the same terms. A declaration made
      // about Anthropic says nothing about DeepSeek.
      const admin = await actorFor(Role.SUPER_ADMIN);

      await put(admin.token, {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'sk-ant-1111',
        inputPricePerMTok: '3',
        outputPricePerMTok: '15',
        zeroRetentionConfirmed: true,
        zeroRetentionNote: 'BAA imzalandı 2026-09-01',
      }).expect(200);

      const switched = (
        await put(admin.token, { provider: 'deepseek', model: 'deepseek-chat' }).expect(200)
      ).body as SettingsView;

      expect(switched.provider).toBe('deepseek');
      expect(switched.zeroRetentionConfirmed).toBe(false);
      expect(switched.zeroRetentionNote).toBeNull();
    });

    it('survives a change that is not a provider change', async () => {
      const admin = await actorFor(Role.SUPER_ADMIN);

      await put(admin.token, {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'sk-ant-2222',
        inputPricePerMTok: '3',
        outputPricePerMTok: '15',
        zeroRetentionConfirmed: true,
      }).expect(200);

      const after = (await put(admin.token, { model: 'claude-opus-5' }).expect(200))
        .body as SettingsView;

      expect(after.zeroRetentionConfirmed).toBe(true);
    });
  });

  describe('what is missing', () => {
    it('says so rather than half-enabling the AI layer', async () => {
      const admin = await actorFor(Role.SUPER_ADMIN);

      const partial = (
        await put(admin.token, { provider: 'anthropic', model: 'claude-sonnet-5' }).expect(200)
      ).body as SettingsView;

      expect(partial.ready).toBe(false);
      expect(partial.missing).toEqual(
        expect.arrayContaining(['apiKey', 'inputPricePerMTok', 'outputPricePerMTok']),
      );
    });

    it('is ready only when the price is there too', async () => {
      // Cost accounting is mandatory, so an unpriced model is not enabled.
      const admin = await actorFor(Role.SUPER_ADMIN);

      await put(admin.token, {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'sk-ant-3333',
      }).expect(200);

      const unpriced = (await get(admin.token).expect(200)).body as SettingsView;
      expect(unpriced.ready).toBe(false);

      await put(admin.token, { inputPricePerMTok: '3', outputPricePerMTok: '15' }).expect(200);

      const priced = (await get(admin.token).expect(200)).body as SettingsView;
      expect(priced.ready).toBe(true);
    });
  });

  describe('who may touch it', () => {
    it('is refused to a doctor', async () => {
      // This decides where patient-adjacent text is sent and what it costs;
      // only `permissions.manage` holds it, which is SUPER_ADMIN by default.
      const doctor = await actorFor(Role.DOCTOR);

      await get(doctor.token).expect(403);
      await put(doctor.token, { provider: 'openai' }).expect(403);
      await request(server)
        .get('/ai/providers')
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(403);
    });
  });

  describe('the provider catalogue', () => {
    it('offers the four, each with a key page and a retention warning', async () => {
      const admin = await actorFor(Role.SUPER_ADMIN);

      const providers = (
        await request(server)
          .get('/ai/providers')
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(200)
      ).body as { id: string; models: string[]; consoleUrl: string; retentionNote: string }[];

      expect(providers.map((p) => p.id).sort()).toEqual([
        'anthropic',
        'deepseek',
        'gemini',
        'openai',
      ]);

      for (const provider of providers) {
        expect(provider.models.length).toBeGreaterThan(0);
        expect(provider.consoleUrl).toMatch(/^https:\/\//);
        expect(provider.retentionNote.length).toBeGreaterThan(40);
      }
    });
  });

  describe('clearing it', () => {
    it('switches the AI layer off and forgets the key', async () => {
      const admin = await actorFor(Role.SUPER_ADMIN);

      await put(admin.token, {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'sk-ant-4444',
        inputPricePerMTok: '3',
        outputPricePerMTok: '15',
      }).expect(200);

      const cleared = (
        await request(server)
          .delete('/ai/settings')
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(200)
      ).body as SettingsView;

      expect(cleared.provider).toBeNull();
      expect(cleared.hasApiKey).toBe(false);
      expect(cleared.ready).toBe(false);
      expect(await settings.resolved()).toBeNull();
    });
  });
});
