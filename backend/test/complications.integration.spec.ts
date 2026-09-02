import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AuditAction,
  ComplicationStatus,
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
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

interface View {
  complication: {
    id: string;
    patientId: string;
    status: string;
    note: string;
    firstResponse: string | null;
    resolution: string | null;
    acknowledgedAt: string | null;
  };
  photos: { id: string }[];
  waitingMinutes: number;
  responseMinutes: number | null;
  overdue: boolean;
}

/**
 * A patient reporting that something looks wrong (spec M7).
 *
 * Not the panic button. What matters here is that the report reaches a
 * clinician, that the patient can see the answer, and that how long it waited
 * is recorded — a response time nobody stores is a response time nobody
 * measures.
 */
describe('complication reports', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let doctor: { token: string; userId: string };

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `cx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Cx', lastName: role },
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
        mrn: `MRN-CX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  /** Straight to the table: photo upload has its own suite. */
  const makePhoto = async (patientId: string): Promise<string> => {
    const photo = await prisma.photo.create({
      data: {
        patientId,
        category: PhotoCategory.COMPLICATION,
        bodyArea: 'abdomen',
        fileKey: `2026/01/${Math.random().toString(36).slice(2)}.jpg`,
        mime: 'image/jpeg',
        size: 1024,
        takenAt: new Date(),
        exifStripped: true,
      },
    });
    return photo.id;
  };

  const report = (
    token: string,
    body: Record<string, unknown>,
  ): request.Test =>
    request(server)
      .post('/me/complications')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

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

    doctor = await actorFor(Role.DOCTOR);
  });

  afterAll(async () => {
    await prisma.photo.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.complication.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('a patient reporting', () => {
    it('records the report with its photos', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      const photoId = await makePhoto(patientId);

      const response = await report(patient.token, {
        note: 'Yara kızardı ve akıntı var',
        bodyArea: 'abdomen',
        photoIds: [photoId],
      }).expect(201);

      const view = response.body as View;

      expect(view.complication.status).toBe(ComplicationStatus.REPORTED);
      expect(view.complication.note).toBe('Yara kızardı ve akıntı var');
      expect(view.photos.map((p) => p.id)).toEqual([photoId]);
      expect(view.responseMinutes).toBeNull();
    });

    /** A photo with no words leaves the clinician guessing what to look at. */
    it('refuses a report with no description', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      await report(patient.token, { note: '   ' }).expect(400);
    });

    /**
     * A report referring to a photo it does not own would show a clinician the
     * wrong body, or nothing. Both are worse than refusing.
     */
    it("refuses a photo belonging to another patient", async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const other = await makePatient();
      const photoId = await makePhoto(other);

      await report(patient.token, { note: 'Yara kızardı', photoIds: [photoId] }).expect(404);
    });

    it('accepts a report with no photos', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const view = (await report(patient.token, { note: 'Ateşim çıktı' }).expect(201))
        .body as View;

      expect(view.photos).toEqual([]);
    });

    it('reports not found when the account has no patient file', async () => {
      const patient = await actorFor(Role.PATIENT);

      await report(patient.token, { note: 'Yara kızardı' }).expect(404);
    });

    it('audits the report', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      await report(patient.token, { note: 'Yara kızardı' }).expect(201);

      const entries = await prisma.auditLog.findMany({
        where: { patientId, entityType: 'complications', action: AuditAction.CREATE },
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]!.actorId).toBe(patient.userId);
    });

    /**
     * A patient who reported something and can see no answer reports it again.
     * Showing the reply is what stops the same worry arriving three times.
     */
    it('shows the patient the clinic reply', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const view = (await report(patient.token, { note: 'Yara kızardı' }).expect(201))
        .body as View;

      await request(server)
        .patch(`/complications/${view.complication.id}/acknowledge`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ message: 'Fotoğrafı gördük, yarın kontrole gelin.' })
        .expect(200);

      const mine = await request(server)
        .get('/me/complications')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      const rows = mine.body as View[];

      expect(rows[0]!.complication.firstResponse).toBe('Fotoğrafı gördük, yarın kontrole gelin.');
      expect(rows[0]!.complication.status).toBe(ComplicationStatus.ACKNOWLEDGED);
    });
  });

  describe('the clinician queue', () => {
    it('lists what is waiting, longest first', async () => {
      const older = await makePatient();
      const newer = await makePatient();

      const first = await prisma.complication.create({
        data: {
          patientId: older,
          note: 'Eski',
          reportedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        },
      });
      const second = await prisma.complication.create({
        data: {
          patientId: newer,
          note: 'Yeni',
          reportedAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      });

      const response = await request(server)
        .get('/complications')
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const ids = (response.body as View[]).map((row) => row.complication.id);

      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    });

    /**
     * Two hours, not two minutes: this is not the emergency button, and
     * treating every wound question as an alarm is how a queue of alarms stops
     * being read.
     */
    it('marks a long-waiting report overdue and a fresh one not', async () => {
      const patientId = await makePatient();

      const stale = await prisma.complication.create({
        data: {
          patientId,
          note: 'Uzun süredir bekliyor',
          reportedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        },
      });
      const fresh = await prisma.complication.create({
        data: {
          patientId,
          note: 'Az önce',
          reportedAt: new Date(Date.now() - 5 * 60 * 1000),
        },
      });

      const response = await request(server)
        .get('/complications')
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const rows = response.body as View[];
      const byId = new Map(rows.map((row) => [row.complication.id, row]));

      expect(byId.get(stale.id)!.overdue).toBe(true);
      expect(byId.get(stale.id)!.waitingMinutes).toBeGreaterThanOrEqual(180);
      expect(byId.get(fresh.id)!.overdue).toBe(false);
    });

    it('leaves resolved reports out unless asked for', async () => {
      const patientId = await makePatient();
      const resolved = await prisma.complication.create({
        data: {
          patientId,
          note: 'Kapandı',
          status: ComplicationStatus.RESOLVED,
          acknowledgedAt: new Date(),
          resolvedAt: new Date(),
        },
      });

      const open = await request(server)
        .get('/complications')
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((open.body as View[]).map((r) => r.complication.id)).not.toContain(resolved.id);

      const all = await request(server)
        .get('/complications')
        .query({ includeResolved: 'true' })
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((all.body as View[]).map((r) => r.complication.id)).toContain(resolved.id);
    });

    /** Scoped like every other clinical read. */
    it('shows a nurse nothing outside their caseload', async () => {
      const patientId = await makePatient();
      await prisma.complication.create({ data: { patientId, note: 'Gizli' } });

      const nurse = await actorFor(Role.NURSE);

      const response = await request(server)
        .get('/complications')
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(200);

      expect((response.body as View[]).map((r) => r.complication.patientId)).not.toContain(
        patientId,
      );
    });

    it('refuses a role without medical.read', async () => {
      const finance = await actorFor(Role.FINANCE);

      await request(server)
        .get('/complications')
        .set('Authorization', `Bearer ${finance.token}`)
        .expect(403);
    });
  });

  describe('answering', () => {
    const openReport = async (): Promise<{ id: string; patientId: string }> => {
      const patientId = await makePatient();
      const row = await prisma.complication.create({
        data: {
          patientId,
          note: 'Yara kızardı',
          reportedAt: new Date(Date.now() - 30 * 60 * 1000),
        },
      });
      return { id: row.id, patientId };
    };

    it('records who answered and how long it took', async () => {
      const { id } = await openReport();

      const response = await request(server)
        .patch(`/complications/${id}/acknowledge`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ message: 'Görüldü' })
        .expect(200);

      const view = response.body as View;

      expect(view.complication.status).toBe(ComplicationStatus.ACKNOWLEDGED);
      expect(view.responseMinutes).toBeGreaterThanOrEqual(29);
      expect(view.overdue).toBe(false);

      const stored = await prisma.complication.findUniqueOrThrow({ where: { id } });
      expect(stored.acknowledgedById).toBe(doctor.userId);
    });

    /**
     * The first answer is what the response time measures. A second clinician
     * adding a note must not make the clinic look faster than it was.
     */
    it('refuses a second answer', async () => {
      const { id } = await openReport();

      await request(server)
        .patch(`/complications/${id}/acknowledge`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ message: 'Görüldü' })
        .expect(200);

      await request(server)
        .patch(`/complications/${id}/acknowledge`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ message: 'Ben de baktım' })
        .expect(400);
    });

    it('refuses a role without medical.write', async () => {
      const { id } = await openReport();
      const coordinator = await actorFor(Role.COORDINATOR);

      await request(server)
        .patch(`/complications/${id}/acknowledge`)
        .set('Authorization', `Bearer ${coordinator.token}`)
        .send({ message: 'Görüldü' })
        .expect(403);
    });

    it('reports not found for a report outside the caller scope', async () => {
      const { id } = await openReport();
      const nurse = await actorFor(Role.NURSE);

      await request(server)
        .patch(`/complications/${id}/acknowledge`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .send({ message: 'Görüldü' })
        .expect(404);
    });
  });

  describe('resolving', () => {
    const openReport = async (): Promise<string> => {
      const patientId = await makePatient();
      const row = await prisma.complication.create({
        data: {
          patientId,
          note: 'Yara kızardı',
          reportedAt: new Date(Date.now() - 45 * 60 * 1000),
        },
      });
      return row.id;
    };

    it('closes an answered report', async () => {
      const id = await openReport();

      await request(server)
        .patch(`/complications/${id}/acknowledge`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ message: 'Görüldü' })
        .expect(200);

      const response = await request(server)
        .patch(`/complications/${id}/resolve`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ message: 'Antibiyotik başlandı, düzeldi' })
        .expect(200);

      const view = response.body as View;

      expect(view.complication.status).toBe(ComplicationStatus.RESOLVED);
      expect(view.complication.resolution).toBe('Antibiyotik başlandı, düzeldi');
    });

    /**
     * A clinician who read it and dealt with it in one step did answer. Leaving
     * the acknowledgement empty would record that report as never responded to
     * and quietly corrupt the only number this feature exists to produce.
     */
    it('counts a straight-to-resolved report as answered', async () => {
      const id = await openReport();

      const response = await request(server)
        .patch(`/complications/${id}/resolve`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ message: 'Hastayı aradım, sorun yok' })
        .expect(200);

      const view = response.body as View;

      expect(view.complication.acknowledgedAt).not.toBeNull();
      expect(view.responseMinutes).toBeGreaterThanOrEqual(44);

      const stored = await prisma.complication.findUniqueOrThrow({ where: { id } });
      expect(stored.acknowledgedById).toBe(doctor.userId);
      expect(stored.firstResponse).toBe('Hastayı aradım, sorun yok');
    });

    it('refuses to resolve twice', async () => {
      const id = await openReport();

      await request(server)
        .patch(`/complications/${id}/resolve`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ message: 'Kapandı' })
        .expect(200);

      await request(server)
        .patch(`/complications/${id}/resolve`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ message: 'Tekrar kapandı' })
        .expect(400);
    });

    it('audits the resolution', async () => {
      const id = await openReport();

      await request(server)
        .patch(`/complications/${id}/resolve`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ message: 'Kapandı' })
        .expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { entityType: 'complications', entityId: id, action: AuditAction.UPDATE },
      });

      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });
});
