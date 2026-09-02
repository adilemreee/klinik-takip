import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AuditAction,
  ConsentType,
  PhotoCategory,
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
import { FileService } from '../src/files/file.service';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';

interface PhotoBody {
  id: string;
  category: string;
  bodyArea: string | null;
  phaseLabel: string | null;
  exifStripped: boolean;
  consentId: string | null;
}

/**
 * Clinical photographs.
 *
 * The most sensitive thing in the record. The tests that matter are the ones
 * about what leaves the phone with the picture: location metadata, and whether
 * anyone consented to the photo being used at all.
 */
describe('photos', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];
  const storedKeys: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let files: FileService;
  let doctor: { token: string; userId: string };

  const PASSWORD = 'correct-horse-battery-9';

  /** A JPEG with an EXIF segment carrying coordinates. */
  const jpegWithLocation = (): Buffer => {
    const exifPayload = Buffer.from('Exif\0\0GPS 41.0082 28.9784');
    const length = Buffer.alloc(2);
    length.writeUInt16BE(exifPayload.length + 2);

    return Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe1]),
      length,
      exifPayload,
      Buffer.from([0xff, 0xda, 0x00, 0x02]),
      Buffer.alloc(512, 0x7a),
      Buffer.from([0xff, 0xd9]),
    ]);
  };

  const heic = (): Buffer =>
    Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(256, 0x11)]);

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Photo', lastName: role },
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

  const makePatient = async (): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-PH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayse',
        lastName: 'Yilmaz',
        birthDate: new Date('1985-03-12'),
        sex: Sex.FEMALE,
        country: 'DE',
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  const upload = (
    patientId: string,
    content: Buffer,
    fields: Record<string, string> = {},
    token = doctor.token,
  ): request.Test => {
    const call = request(server)
      .post(`/patients/${patientId}/photos`)
      .set('Authorization', `Bearer ${token}`);

    for (const [key, value] of Object.entries({ category: 'BEFORE', ...fields })) {
      void call.field(key, value);
    }

    return call.attach('file', content, 'photo.jpg');
  };

  const remember = async (photoId: string): Promise<void> => {
    const row = await prisma.photo.findUnique({
      where: { id: photoId },
      select: { fileKey: true },
    });
    if (row) storedKeys.push(row.fileKey);
  };

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

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();

    doctor = await actorFor(Role.DOCTOR);
  });

  afterAll(async () => {
    for (const key of storedKeys) {
      await files.remove('photos', key).catch(() => undefined);
    }

    await prisma.photo.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.consent.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('uploading', () => {
    /**
     * The one that matters most. A wound photo with GPS in it is a patient's
     * home address sitting in a clinical bucket.
     */
    it('stores the image without its location metadata', async () => {
      const patientId = await makePatient();
      const original = jpegWithLocation();

      expect(original.includes(Buffer.from('GPS 41.0082 28.9784'))).toBe(true);

      const response = await upload(patientId, original, {
        category: 'WOUND',
        bodyArea: 'abdomen',
        phaseLabel: 'post-op D1',
      }).expect(201);

      const body = response.body as PhotoBody;
      await remember(body.id);

      expect(body.exifStripped).toBe(true);

      // Fetched back from storage: the bytes that were stored, not what the
      // endpoint reported about them.
      const stored = await prisma.photo.findUniqueOrThrow({ where: { id: body.id } });
      const url = await files.createDownloadUrl('photos', stored.fileKey);
      const fetched = Buffer.from(await (await fetch(url.url)).arrayBuffer());

      expect(fetched.includes(Buffer.from('GPS 41.0082 28.9784'))).toBe(false);
      expect(fetched.includes(Buffer.from('Exif'))).toBe(false);
      // Still a JPEG, and still the picture.
      expect(fetched.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(fetched.includes(Buffer.alloc(512, 0x7a))).toBe(true);
    });

    it('records the phase and body area', async () => {
      const patientId = await makePatient();

      const response = await upload(patientId, jpegWithLocation(), {
        category: 'AFTER',
        bodyArea: 'burun',
        phaseLabel: 'post-op M1',
      }).expect(201);

      const body = response.body as PhotoBody;
      await remember(body.id);

      expect(body.category).toBe(PhotoCategory.AFTER);
      expect(body.bodyArea).toBe('burun');
      expect(body.phaseLabel).toBe('post-op M1');
    });

    /**
     * HEIC is what an iPhone shoots by default and its metadata cannot be
     * removed here. Refusing is the honest answer: storing it would put a photo
     * whose location we cannot strip into the one bucket most likely to hold a
     * picture of someone's body.
     */
    it('refuses a format whose location data it cannot remove', async () => {
      const patientId = await makePatient();

      const response = await upload(patientId, heic());

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('location data');
      expect(await prisma.photo.count({ where: { patientId } })).toBe(0);
    });

    it('refuses content it cannot identify', async () => {
      const patientId = await makePatient();

      await upload(patientId, Buffer.alloc(64, 0x7f)).expect(400);
    });

    /** A wound photo filed under an unknown category is one nobody looks for. */
    it('refuses an unknown category', async () => {
      const patientId = await makePatient();

      await upload(patientId, jpegWithLocation(), { category: 'XRAY' }).expect(400);
    });

    it('refuses a role without photos.write', async () => {
      const patientId = await makePatient();
      const coordinator = await actorFor(Role.COORDINATOR);

      await upload(patientId, jpegWithLocation(), {}, coordinator.token).expect(403);
    });

    it('reports not found for a patient outside the caller scope', async () => {
      const patientId = await makePatient();
      const nurse = await actorFor(Role.NURSE);

      await upload(patientId, jpegWithLocation(), {}, nurse.token).expect(404);
    });

    it('audits the upload', async () => {
      const patientId = await makePatient();
      const body = (await upload(patientId, jpegWithLocation()).expect(201)).body as PhotoBody;
      await remember(body.id);

      const entries = await prisma.auditLog.findMany({
        where: { patientId, entityType: 'photos', action: AuditAction.CREATE },
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]!.actorId).toBe(doctor.userId);
    });
  });

  describe('photo-usage consent', () => {
    const makeConsent = async (
      patientId: string,
      type: ConsentType,
      revoked = false,
    ): Promise<string> => {
      const consent = await prisma.consent.create({
        data: {
          patientId,
          type,
          version: 1,
          signedAt: new Date(),
          revokedAt: revoked ? new Date() : null,
        },
      });
      return consent.id;
    };

    it('attaches an active photo-usage consent', async () => {
      const patientId = await makePatient();
      const consentId = await makeConsent(patientId, ConsentType.PHOTO_USAGE);

      const body = (
        await upload(patientId, jpegWithLocation(), { consentId }).expect(201)
      ).body as PhotoBody;
      await remember(body.id);

      expect(body.consentId).toBe(consentId);
    });

    /**
     * A photo carrying a consent id that points at a treatment consent would
     * read on every later screen as permission that was never given.
     */
    it('refuses a consent of the wrong type', async () => {
      const patientId = await makePatient();
      const consentId = await makeConsent(patientId, ConsentType.TREATMENT);

      await upload(patientId, jpegWithLocation(), { consentId }).expect(400);
    });

    /** Photo-usage consent is revocable and revoking it has to mean something. */
    it('refuses a revoked consent', async () => {
      const patientId = await makePatient();
      const consentId = await makeConsent(patientId, ConsentType.PHOTO_USAGE, true);

      await upload(patientId, jpegWithLocation(), { consentId }).expect(400);
    });

    it("refuses another patient's consent", async () => {
      const patientId = await makePatient();
      const other = await makePatient();
      const consentId = await makeConsent(other, ConsentType.PHOTO_USAGE);

      await upload(patientId, jpegWithLocation(), { consentId }).expect(400);
    });

    /** No consent is a valid state: the photo is then clinical-use only. */
    it('stores a photo with no consent at all', async () => {
      const patientId = await makePatient();

      const body = (await upload(patientId, jpegWithLocation()).expect(201)).body as PhotoBody;
      await remember(body.id);

      expect(body.consentId).toBeNull();
    });
  });

  describe('the gallery', () => {
    it('groups by body area, oldest first inside each group', async () => {
      const patientId = await makePatient();

      const first = (
        await upload(patientId, jpegWithLocation(), {
          category: 'BEFORE',
          bodyArea: 'burun',
          phaseLabel: 'pre-op',
          takenAt: '2026-01-01T08:00:00.000Z',
        }).expect(201)
      ).body as PhotoBody;

      const second = (
        await upload(patientId, jpegWithLocation(), {
          category: 'AFTER',
          bodyArea: 'burun',
          phaseLabel: 'post-op M1',
          takenAt: '2026-02-01T08:00:00.000Z',
        }).expect(201)
      ).body as PhotoBody;

      const other = (
        await upload(patientId, jpegWithLocation(), {
          category: 'WOUND',
          bodyArea: 'abdomen',
          takenAt: '2026-01-15T08:00:00.000Z',
        }).expect(201)
      ).body as PhotoBody;

      for (const id of [first.id, second.id, other.id]) await remember(id);

      const response = await request(server)
        .get(`/patients/${patientId}/photos`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const groups = response.body as { bodyArea: string; photos: { id: string }[] }[];

      expect(groups.map((g) => g.bodyArea)).toEqual(['abdomen', 'burun']);
      expect(groups[1]!.photos.map((p) => p.id)).toEqual([first.id, second.id]);
    });

    it('filters by category', async () => {
      const patientId = await makePatient();
      const before = (
        await upload(patientId, jpegWithLocation(), { category: 'BEFORE', bodyArea: 'burun' })
          .expect(201)
      ).body as PhotoBody;
      const wound = (
        await upload(patientId, jpegWithLocation(), { category: 'WOUND', bodyArea: 'burun' })
          .expect(201)
      ).body as PhotoBody;

      for (const id of [before.id, wound.id]) await remember(id);

      const response = await request(server)
        .get(`/patients/${patientId}/photos`)
        .query({ category: 'WOUND' })
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const groups = response.body as { photos: { id: string }[] }[];

      expect(groups).toHaveLength(1);
      expect(groups[0]!.photos.map((p) => p.id)).toEqual([wound.id]);
    });

    it('hides a deleted photo', async () => {
      const patientId = await makePatient();
      const body = (await upload(patientId, jpegWithLocation()).expect(201)).body as PhotoBody;
      await remember(body.id);

      await request(server)
        .delete(`/photos/${body.id}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(204);

      const response = await request(server)
        .get(`/patients/${patientId}/photos`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(response.body).toEqual([]);

      // Soft delete: the bytes stay for the retention period.
      const stored = await prisma.photo.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.deletedAt).not.toBeNull();
      await expect(files.stat('photos', stored.fileKey)).resolves.toBeTruthy();
    });
  });

  describe('the overlay guide', () => {
    /**
     * The guide exists to keep angle and distance consistent, so the shot worth
     * matching is the last one in the series — drift accumulates between
     * neighbours, not against a photo from a year ago.
     */
    it('offers the most recent photo of the same body area', async () => {
      const patientId = await makePatient();

      const older = (
        await upload(patientId, jpegWithLocation(), {
          bodyArea: 'burun',
          takenAt: '2026-01-01T08:00:00.000Z',
        }).expect(201)
      ).body as PhotoBody;

      const newer = (
        await upload(patientId, jpegWithLocation(), {
          bodyArea: 'burun',
          takenAt: '2026-03-01T08:00:00.000Z',
        }).expect(201)
      ).body as PhotoBody;

      for (const id of [older.id, newer.id]) await remember(id);

      const response = await request(server)
        .get(`/patients/${patientId}/photos/overlay`)
        .query({ bodyArea: 'burun' })
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((response.body as PhotoBody).id).toBe(newer.id);
    });

    it('offers nothing for a body area with no photos yet', async () => {
      const patientId = await makePatient();

      const response = await request(server)
        .get(`/patients/${patientId}/photos/overlay`)
        .query({ bodyArea: 'kol' })
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(response.body).toEqual({});
    });

    it('does not offer a photo of a different body area', async () => {
      const patientId = await makePatient();
      const body = (
        await upload(patientId, jpegWithLocation(), { bodyArea: 'burun' }).expect(201)
      ).body as PhotoBody;
      await remember(body.id);

      const response = await request(server)
        .get(`/patients/${patientId}/photos/overlay`)
        .query({ bodyArea: 'abdomen' })
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(response.body).toEqual({});
    });
  });

  describe('viewing', () => {
    it('mints a signed URL that serves the image', async () => {
      const patientId = await makePatient();
      const body = (await upload(patientId, jpegWithLocation()).expect(201)).body as PhotoBody;
      await remember(body.id);

      const response = await request(server)
        .get(`/photos/${body.id}/url`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const fetched = await fetch((response.body as { url: string }).url);

      expect(fetched.status).toBe(200);
    });

    /** Who looked at a photograph of a patient's body, and when. */
    it('audits the view', async () => {
      const patientId = await makePatient();
      const body = (await upload(patientId, jpegWithLocation()).expect(201)).body as PhotoBody;
      await remember(body.id);

      await request(server)
        .get(`/photos/${body.id}/url`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const reads = await prisma.auditLog.findMany({
        where: { entityType: 'photos', entityId: body.id, action: AuditAction.READ },
      });

      expect(reads.length).toBeGreaterThanOrEqual(1);
    });

    it('reports not found for a photo outside the caller scope', async () => {
      const patientId = await makePatient();
      const body = (await upload(patientId, jpegWithLocation()).expect(201)).body as PhotoBody;
      await remember(body.id);

      const nurse = await actorFor(Role.NURSE);

      await request(server)
        .get(`/photos/${body.id}/url`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(404);
    });
  });
});
