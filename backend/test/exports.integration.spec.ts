import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AuditAction,
  ConsentType,
  ExportKind,
  PhotoCategory,
  PrismaClient,
  ProcessingStatus,
  Role,
  Sex,
  UserStatus,
} from '@prisma/client';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isStaffRole } from '../src/auth/auth.errors';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { exportRender } from '../src/exports/exports.processor';
import { ExportsService } from '../src/exports/exports.service';
import { PatientSummaryBuilder } from '../src/exports/patient-summary.builder';
import { FileService } from '../src/files/file.service';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../src/notifications/templates';

const prisma = new PrismaClient();

interface ExportView {
  id: string;
  kind: ExportKind;
  status: ProcessingStatus;
  patientId: string | null;
  size: number | null;
  contents: {
    labs: number;
    photos: number;
    aiReports: number;
    omissions: { section: string; reason: string; count: number }[];
  } | null;
  error: string | null;
  expiresAt: string | null;
}

/**
 * Patient summary exports (spec M12, T6.5).
 *
 * The properties under test are the ones that make an export safe to hand out:
 * it is produced on a queue, the link is short-lived, what is in the file is
 * recorded, and **the audit log says who took what data out**.
 */
describe('exports', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];
  const objectKeys: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let exports: ExportsService;
  let files: FileService;
  let render: () => Promise<void>;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
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
        data: { userId: user.id, firstName: 'Ayşe', lastName: 'Şahin' },
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
        mrn: `MRN-EXP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayşe',
        lastName: 'Yıldırım',
        birthDate: new Date('1981-04-02'),
        sex: Sex.FEMALE,
        country: 'DE',
        city: 'Berlin',
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  const requestSummary = (
    token: string,
    patientId: string,
    body: Record<string, unknown> = {},
  ): request.Test =>
    request(server)
      .post(`/patients/${patientId}/exports/summary`)
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
    exports = app.get(ExportsService);
    files = app.get(FileService);

    // The worker's handler, driven directly: this suite is about what the job
    // produces, not about BullMQ's scheduling.
    render = exportRender(
      app.get(PrismaService),
      exports,
      app.get(PatientSummaryBuilder),
      files,
      app.get(NotificationsService),
      'Klinik Takip',
    ) as () => Promise<void>;

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    for (const key of objectKeys) {
      await files.remove('documents', key).catch(() => undefined);
    }
    await prisma.export.deleteMany({ where: { requestedById: { in: userIds } } });
    await prisma.photo.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.consent.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.labResult.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.aiReport.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.surgery.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.job.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('asking for a summary', () => {
    it('answers immediately with something to poll', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      const view = (await requestSummary(doctor.token, patientId).expect(201))
        .body as ExportView;

      expect(view.status).toBe(ProcessingStatus.QUEUED);
      expect(view.kind).toBe(ExportKind.PATIENT_SUMMARY);
      expect(view.size).toBeNull();
    });

    it('refuses a patient the caller cannot see', async () => {
      // The finance desk holds export.create and no patient scope at all, so
      // it gets the same 404 as for a patient who does not exist.
      const finance = await actorFor(Role.FINANCE);
      const patientId = await makePatient();

      await requestSummary(finance.token, patientId).expect(404);
    });

    it('refuses a caller without the export permission', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient();

      await requestSummary(patient.token, patientId).expect(403);
    });
  });

  describe('rendering', () => {
    it('produces a PDF and records what went into it', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prisma.surgery.create({
        data: {
          patientId,
          procedureName: 'Rinoplasti',
          performedAt: new Date('2026-03-02T09:00:00Z'),
        },
      });
      await prisma.labResult.createMany({
        data: [
          {
            patientId,
            analyteName: 'Hemoglobin',
            value: '13.2',
            unit: 'g/dL',
            measuredAt: new Date('2026-03-03T09:00:00Z'),
            verifiedAt: new Date('2026-03-04T09:00:00Z'),
          },
          // Not confirmed by a human, so not a result yet (spec M16).
          {
            patientId,
            analyteName: 'Kreatinin',
            value: '0.9',
            unit: 'mg/dL',
            measuredAt: new Date('2026-03-03T09:00:00Z'),
          },
        ],
      });

      const requested = (await requestSummary(doctor.token, patientId).expect(201))
        .body as ExportView;

      await render();

      const done = (
        await request(server)
          .get(`/exports/${requested.id}`)
          .set('Authorization', `Bearer ${doctor.token}`)
          .expect(200)
      ).body as ExportView;

      expect(done.status).toBe(ProcessingStatus.DONE);
      expect(done.size).toBeGreaterThan(1000);
      expect(done.contents?.labs).toBe(1);
      // The unverified one is not silently absent — it is counted and said.
      expect(done.contents?.omissions).toContainEqual({
        section: 'labs',
        reason: 'lab-unverified',
        count: 1,
      });
      expect(done.expiresAt).not.toBeNull();

      const stored = await prisma.export.findUniqueOrThrow({ where: { id: requested.id } });
      if (stored.fileKey) objectKeys.push(stored.fileKey);

      // What was actually stored is a PDF, sniffed rather than declared.
      const bytes = await files.read('documents', stored.fileKey!);
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('leaves photographs out unless they are asked for', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prisma.photo.create({
        data: {
          patientId,
          category: PhotoCategory.BEFORE,
          fileKey: '2026/03/nonexistent.jpg',
          mime: 'image/jpeg',
          size: 100,
          takenAt: new Date('2026-03-01T09:00:00Z'),
        },
      });

      const requested = (await requestSummary(doctor.token, patientId).expect(201))
        .body as ExportView;
      await render();

      const done = (await prisma.export.findUniqueOrThrow({
        where: { id: requested.id },
      })) as unknown as ExportView;
      if (done.contents === null) throw new Error('no manifest');

      expect(done.contents.photos).toBe(0);
      expect(done.contents.omissions).toContainEqual({
        section: 'photos',
        reason: 'photo-not-requested',
        count: 1,
      });

      const stored = await prisma.export.findUniqueOrThrow({ where: { id: requested.id } });
      if (stored.fileKey) objectKeys.push(stored.fileKey);
    });

    it('leaves out a photograph with no live consent even when they are asked for', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      const revoked = await prisma.consent.create({
        data: {
          patientId,
          type: ConsentType.PHOTO_USAGE,
          version: 1,
          signedAt: new Date('2026-01-01T09:00:00Z'),
          revokedAt: new Date('2026-02-01T09:00:00Z'),
        },
      });

      await prisma.photo.createMany({
        data: [
          {
            patientId,
            category: PhotoCategory.BEFORE,
            fileKey: '2026/03/revoked.jpg',
            mime: 'image/jpeg',
            size: 100,
            takenAt: new Date('2026-03-01T09:00:00Z'),
            consentId: revoked.id,
          },
          {
            patientId,
            category: PhotoCategory.AFTER,
            fileKey: '2026/03/none.jpg',
            mime: 'image/jpeg',
            size: 100,
            takenAt: new Date('2026-03-05T09:00:00Z'),
          },
        ],
      });

      const requested = (
        await requestSummary(doctor.token, patientId, { includePhotos: true }).expect(201)
      ).body as ExportView;
      await render();

      const done = await prisma.export.findUniqueOrThrow({ where: { id: requested.id } });
      const contents = done.contents as unknown as ExportView['contents'];
      if (done.fileKey) objectKeys.push(done.fileKey);

      // A revoked consent and no consent are both "no".
      expect(contents?.photos).toBe(0);
      expect(contents?.omissions).toContainEqual({
        section: 'photos',
        reason: 'photo-no-consent',
        count: 2,
      });
    });

    it('leaves out AI text nobody has signed off', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prisma.aiReport.createMany({
        data: [
          {
            patientId,
            source: 'lab',
            contentMd: 'onaylı metin',
            model: 'test',
            reviewedById: doctor.userId,
            reviewedAt: new Date('2026-03-05T09:00:00Z'),
          },
          {
            patientId,
            source: 'lab',
            contentMd: 'onaysız metin',
            model: 'test',
          },
        ],
      });

      const requested = (await requestSummary(doctor.token, patientId).expect(201))
        .body as ExportView;
      await render();

      const done = await prisma.export.findUniqueOrThrow({ where: { id: requested.id } });
      const contents = done.contents as unknown as ExportView['contents'];
      if (done.fileKey) objectKeys.push(done.fileKey);

      expect(contents?.aiReports).toBe(1);
      expect(contents?.omissions).toContainEqual({
        section: 'ai',
        reason: 'ai-unreviewed',
        count: 1,
      });
    });

    it('tells the person who asked when it fails', async () => {
      // A request that sits at QUEUED forever is the worst of both.
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      const requested = (await requestSummary(doctor.token, patientId).expect(201))
        .body as ExportView;

      // The patient goes away between the request and the render.
      await prisma.export.update({
        where: { id: requested.id },
        data: { patientId: null },
      });

      await render();

      const failed = (
        await request(server)
          .get(`/exports/${requested.id}`)
          .set('Authorization', `Bearer ${doctor.token}`)
          .expect(200)
      ).body as ExportView;

      expect(failed.status).toBe(ProcessingStatus.FAILED);
      expect(failed.error).not.toBeNull();
    });
  });

  describe('the download link', () => {
    const readyExport = async (): Promise<{ token: string; id: string; patientId: string }> => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();
      const requested = (await requestSummary(doctor.token, patientId).expect(201))
        .body as ExportView;

      await render();

      const stored = await prisma.export.findUniqueOrThrow({ where: { id: requested.id } });
      if (stored.fileKey) objectKeys.push(stored.fileKey);

      return { token: doctor.token, id: requested.id, patientId };
    };

    it('is short-lived and signed', async () => {
      const ready = await readyExport();

      const link = (
        await request(server)
          .post(`/exports/${ready.id}/download`)
          .set('Authorization', `Bearer ${ready.token}`)
          .expect(201)
      ).body as { url: string; expiresAt: string; filename: string };

      expect(link.url).toContain('X-Amz-Signature');
      expect(link.filename).toMatch(/\.pdf$/);

      const lifetime = new Date(link.expiresAt).getTime() - Date.now();
      expect(lifetime).toBeLessThanOrEqual(10 * 60 * 1000);
      expect(lifetime).toBeGreaterThan(0);
    });

    it('is audited, because this is the moment the data can leave', async () => {
      const ready = await readyExport();

      await request(server)
        .post(`/exports/${ready.id}/download`)
        .set('Authorization', `Bearer ${ready.token}`)
        .expect(201);

      const entries = await prisma.auditLog.findMany({
        where: { entityType: 'exports', entityId: ready.id },
      });

      // One for finishing the file, one for handing out the link.
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries.every((entry) => entry.action === AuditAction.EXPORT)).toBe(true);
      expect(entries.some((entry) => entry.patientId === ready.patientId)).toBe(true);
    });

    it('is not somebody else\'s to download', async () => {
      const ready = await readyExport();
      const other = await actorFor(Role.DOCTOR);

      // "Not yours" and "no such export" are the same answer, for the same
      // reason they are everywhere else.
      await request(server)
        .post(`/exports/${ready.id}/download`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(404);
    });

    it('refuses once the file has expired', async () => {
      const ready = await readyExport();

      await prisma.export.update({
        where: { id: ready.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(server)
        .post(`/exports/${ready.id}/download`)
        .set('Authorization', `Bearer ${ready.token}`)
        .expect(404);
    });
  });

  describe('the sweep', () => {
    it('deletes the bytes and keeps the record', async () => {
      // The audit trail of what was exported has to outlive the file.
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();
      const requested = (await requestSummary(doctor.token, patientId).expect(201))
        .body as ExportView;

      await render();

      const stored = await prisma.export.findUniqueOrThrow({ where: { id: requested.id } });
      const key = stored.fileKey!;

      await prisma.export.update({
        where: { id: requested.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const removed = await exports.sweepExpired();
      expect(removed).toBeGreaterThanOrEqual(1);

      const after = await prisma.export.findUniqueOrThrow({ where: { id: requested.id } });
      expect(after.fileKey).toBeNull();
      expect(after.contents).not.toBeNull();

      await expect(files.stat('documents', key)).rejects.toThrow();
    });
  });

  describe('the notification', () => {
    it('tells the person who asked that the file is ready', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await requestSummary(doctor.token, patientId).expect(201);
      await render();

      const notifications = await prisma.notification.findMany({
        where: { userId: doctor.userId, type: NOTIFICATION_TYPES.exportReady },
      });

      expect(notifications.length).toBeGreaterThanOrEqual(1);

      const stored = await prisma.export.findFirst({ where: { requestedById: doctor.userId } });
      if (stored?.fileKey) objectKeys.push(stored.fileKey);
    });
  });
});
