import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PhotoCategory, PrismaClient, Role, Sex, UserStatus } from '@prisma/client';
import { generateSync } from 'otplib';
import request from 'supertest';
import { Readable } from 'node:stream';
import type { AiSettingsService } from '../src/ai/ai-settings.service';
import { AIService } from '../src/ai/ai.service';
import type { FetchLike } from '../src/ai/ai-provider';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { isStaffRole } from '../src/auth/auth.errors';
import { PatientAccessService } from '../src/authz/patient-access.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';
import { PhotoAssessmentService } from '../src/photos/assessment.service';

const prisma = new PrismaClient();

/** A one-pixel JPEG is enough: nothing here depends on what is in the picture. */
const PIXEL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const modelSaying = (
  text: string,
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
            model: 'test-vision-2026',
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 900, output_tokens: 30 },
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
  AI_MAX_OUTPUT_TOKENS: 200,
  AI_MONTHLY_BUDGET_USD: undefined,
  AI_PHOTO_ASSESSMENT: true,
  S3_BUCKET_PHOTOS: 'klinik-photos',
};

/**
 * The photo pre-assessment (spec M5).
 *
 * A flag, never a diagnosis — and never shown to the patient. Most of these
 * tests are about the ways it declines: switched off, unreadable, or a model
 * that tried to name a condition.
 */
describe('photo pre-assessment', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let access: PatientAccessService;
  let audit: AuditService;

  const PASSWORD = 'correct-horse-battery-9';

  /** Reads back the pixel whatever key it is asked for. */
  const storage = {
    ping: jest.fn().mockResolvedValue(undefined),
    client: { getObject: (): Promise<Readable> => Promise.resolve(Readable.from(PIXEL)) },
  };

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
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
        data: { userId: user.id, firstName: 'Pa', lastName: role },
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

  const makePhoto = async (mime = 'image/jpeg'): Promise<{ photoId: string; patientId: string }> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-PA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        birthDate: new Date('1981-04-02'),
        sex: Sex.FEMALE,
        country: 'DE',
      },
    });
    patientIds.push(patient.id);

    await prisma.surgery.create({
      data: {
        patientId: patient.id,
        procedureName: 'Sleeve gastrektomi',
        performedAt: new Date(Date.now() - 9 * 86_400_000),
      },
    });

    const photo = await prisma.photo.create({
      data: {
        patientId: patient.id,
        category: PhotoCategory.COMPLICATION,
        bodyArea: 'abdomen',
        fileKey: `2026/03/${Math.random().toString(36).slice(2)}.jpg`,
        mime,
        size: PIXEL.length,
        takenAt: new Date(),
        exifStripped: true,
      },
    });

    return { photoId: photo.id, patientId: patient.id };
  };

  const assessmentWith = (
    values: Record<string, unknown>,
    fetchImpl: FetchLike,
  ): PhotoAssessmentService => {
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
    // The AI layer prefers what the clinic saved. These tests configure it
    // from the environment and never reach onApplicationBootstrap, so the
    // settings are never consulted; the stub is here for the constructor.
    const settings = { resolved: () => Promise.resolve(null) } as unknown as AiSettingsService;

    const ai = new AIService(prisma as unknown as PrismaService, config, settings, fetchImpl);
    ai.onModuleInit();

    return new PhotoAssessmentService(
      prisma as unknown as PrismaService,
      access,
      ai,
      storage as unknown as StorageService,
      audit,
      config,
    );
  };

  const doctorActor = (userId: string): never => ({ id: userId, role: Role.DOCTOR }) as never;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();

    server = app.getHttpServer() as Server;
    auth = app.get(AuthService);
    access = app.get(PatientAccessService);
    audit = app.get(AuditService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.aiJob.deleteMany({});
    await prisma.photo.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.surgery.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('flagging a photo', () => {
    it('records the findings, the flag and the model that answered', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const { photoId } = await makePhoto();

      const result = await assessmentWith(
        AI_ON,
        modelSaying('{"findings":["redness","discharge"]}').fetchImpl,
      ).assess(doctorActor(doctor.userId), photoId);

      expect(result.reviewSuggested).toBe(true);
      expect(result.findings).toEqual(['redness', 'discharge']);

      const photo = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
      expect(photo.aiReviewSuggested).toBe(true);
      expect(photo.aiFindings.sort()).toEqual(['discharge', 'redness']);
      // The version that answered, not the alias asked for (spec section 14.6).
      expect(photo.aiModel).toBe('test-vision-2026');
      expect(photo.aiAssessedAt).not.toBeNull();
    });

    it('records a clean photo as assessed and not flagged', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const { photoId } = await makePhoto();

      const result = await assessmentWith(AI_ON, modelSaying('{"findings":[]}').fetchImpl).assess(
        doctorActor(doctor.userId),
        photoId,
      );

      expect(result.reviewSuggested).toBe(false);

      const photo = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
      // False, not null: somebody looked and found nothing, which is different
      // from nobody having looked.
      expect(photo.aiReviewSuggested).toBe(false);
      expect(photo.aiAssessedAt).not.toBeNull();
    });

    /** This is where a diagnosis would have got in. */
    it('drops a condition name and keeps only the vocabulary', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const { photoId } = await makePhoto();

      const result = await assessmentWith(
        AI_ON,
        modelSaying('{"findings":["redness","selülit","enfeksiyon bulgusu"]}').fetchImpl,
      ).assess(doctorActor(doctor.userId), photoId);

      expect(result.findings).toEqual(['redness']);

      const photo = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
      expect(photo.aiFindings).toEqual(['redness']);
      expect(JSON.stringify(photo.aiFindings)).not.toContain('selülit');
    });

    it('sends the image to the model as an image', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const { photoId } = await makePhoto();
      const transport = modelSaying('{"findings":[]}');

      await assessmentWith(AI_ON, transport.fetchImpl).assess(doctorActor(doctor.userId), photoId);

      const [body] = transport.sent();
      expect(body).toBeDefined();

      const parsed = JSON.parse(body!) as {
        messages: { content: { type: string; source?: { media_type: string } }[] }[];
      };
      const blocks = parsed.messages[0]!.content;

      expect(blocks.some((block) => block.type === 'image')).toBe(true);
      expect(blocks.find((block) => block.type === 'image')!.source!.media_type).toBe('image/jpeg');
      expect(blocks.some((block) => block.type === 'text')).toBe(true);
    });
  });

  describe('when it declines', () => {
    /**
     * The clinic has to switch this on. An image cannot be minimised the way
     * text can, so sending one is a decision rather than something inherited
     * from enabling the AI layer.
     */
    it('sends nothing while photo assessment is switched off', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const { photoId } = await makePhoto();
      const transport = modelSaying('{"findings":["redness"]}');

      const result = await assessmentWith(
        { ...AI_ON, AI_PHOTO_ASSESSMENT: false },
        transport.fetchImpl,
      ).assess(doctorActor(doctor.userId), photoId);

      expect(result.skippedReason).toBe('disabled');
      expect(transport.sent()).toEqual([]);

      const photo = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
      expect(photo.aiAssessedAt).toBeNull();
    });

    it('leaves the photo untouched when the answer cannot be read', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const { photoId } = await makePhoto();

      const result = await assessmentWith(
        AI_ON,
        modelSaying('Yara enfekte görünüyor, antibiyotik başlanmalı.').fetchImpl,
      ).assess(doctorActor(doctor.userId), photoId);

      expect(result.skippedReason).toBe('unreadable');

      const photo = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
      // Unassessed, not "assessed and clean" — collapsing the two would tell a
      // clinician something had been checked when it had not.
      expect(photo.aiReviewSuggested).toBeNull();
      expect(photo.aiAssessedAt).toBeNull();
    });

    it('refuses a file that is not an image it can read', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const { photoId } = await makePhoto('application/pdf');

      await expect(
        assessmentWith(AI_ON, modelSaying('{"findings":[]}').fetchImpl).assess(
          doctorActor(doctor.userId),
          photoId,
        ),
      ).rejects.toThrow();
    });

    it('declines when the AI layer itself is off', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const { photoId } = await makePhoto();

      const result = await assessmentWith(
        { ...AI_ON, AI_PROVIDER: undefined, AI_API_KEY: undefined },
        modelSaying('{"findings":["redness"]}').fetchImpl,
      ).assess(doctorActor(doctor.userId), photoId);

      expect(result.skippedReason).toBe('ai-unavailable');
    });
  });

  describe('who may see it', () => {
    it('lists the flagged photos oldest first', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const older = await makePhoto();
      const newer = await makePhoto();

      await prisma.photo.update({
        where: { id: older.photoId },
        data: { aiReviewSuggested: true, takenAt: new Date(Date.now() - 86_400_000) },
      });
      await prisma.photo.update({
        where: { id: newer.photoId },
        data: { aiReviewSuggested: true },
      });

      const flagged = await assessmentWith(AI_ON, modelSaying('{}').fetchImpl).flagged(
        doctorActor(doctor.userId),
      );

      const ids = flagged.map((photo) => photo.id);
      expect(ids.indexOf(older.photoId)).toBeLessThan(ids.indexOf(newer.photoId));
    });

    /**
     * Staff-only by construction: the photo endpoints all require photos.read,
     * which no patient holds. There is no path that shows a patient a machine's
     * opinion of their own wound.
     */
    it('does not let a patient reach the flag', async () => {
      const patient = await actorFor(Role.PATIENT);
      const { photoId } = await makePhoto();

      await request(server)
        .get('/photos/flagged')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(403);

      await request(server)
        .post(`/photos/${photoId}/assess`)
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(403);
    });

    /** Asking for an assessment sends a photograph to a third party. */
    it('does not let a nurse ask for one', async () => {
      const nurse = await actorFor(Role.NURSE);
      const { photoId } = await makePhoto();

      await request(server)
        .post(`/photos/${photoId}/assess`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(403);
    });
  });
});
