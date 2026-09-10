import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AuditAction,
  DocumentType,
  LabFlag,
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
import { LabService, normalise } from '../src/lab/lab.service';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

interface TrendRow {
  analyteName: string;
  unit: string;
  points: { measuredAt: string; value: number; refLow: number | null }[];
  reference: { low: number | null; high: number | null } | null;
  latestFlag: string | null;
}

interface ReviewRow {
  result: { id: string; analyteName: string; analyteCode: string | null; flag: string | null };
  needsAttention: boolean;
  awaitingMapping: boolean;
}

/**
 * Reviewing what OCR read.
 *
 * The rule this module exists to enforce is one line of the spec: OCR output is
 * never approved automatically. Everything here is about a value staying out of
 * the clinical record until a person has looked at it.
 */
describe('lab result review', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];
  const mappedNames: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let lab: LabService;
  let doctor: { token: string; userId: string };

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Lab', lastName: role },
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
        mrn: `MRN-LAB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  /// A document row to hang results off. The bytes never matter here — what
  /// is under test is the grouping, and the panel carries the id so a reader
  /// can open the original.
  const makeDocument = async (patientId: string): Promise<string> => {
    const document = await prisma.document.create({
      data: {
        patientId,
        type: DocumentType.LAB,
        fileKey: `2026/03/${Math.random().toString(36).slice(2)}.pdf`,
        mime: 'application/pdf',
        size: 2048,
        originalName: 'tahlil.pdf',
      },
    });

    return document.id;
  };

  const fileCandidates = async (
    patientId: string,
    candidates: Parameters<LabService['recordCandidates']>[2],
  ): Promise<void> => {
    await lab.recordCandidates(patientId, null as unknown as string, candidates, new Date());
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
    lab = app.get(LabService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();

    doctor = await actorFor(Role.DOCTOR);
  });

  afterAll(async () => {
    await prisma.labResult.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.analyteMapping.deleteMany({ where: { rawName: { in: mappedNames } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  const candidate = (
    rawName: string,
    value: number,
    confidence = 0.95,
    reference?: { low?: number; high?: number },
  ): Parameters<LabService['recordCandidates']>[2][number] => ({
    rawName,
    value,
    unit: 'g/dL',
    reference,
    confidence,
    sourceLine: `${rawName} ${value}`,
  });

  const pending = async (patientId: string, token = doctor.token): Promise<ReviewRow[]> => {
    const response = await request(server)
      .get(`/patients/${patientId}/lab-results/pending`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return response.body as ReviewRow[];
  };

  describe('what OCR files', () => {
    /** The single rule this module exists for. */
    it('files everything unverified', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Hemoglobin', 13.5, 0.95, { low: 12, high: 16 })]);

      const rows = await prisma.labResult.findMany({ where: { patientId } });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.verifiedAt).toBeNull();
      expect(rows[0]!.verifiedById).toBeNull();
    });

    /** An unverified value must not reach the chart a doctor reads. */
    it('keeps unverified results out of the confirmed list', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Hemoglobin', 13.5)]);

      const response = await request(server)
        .get(`/patients/${patientId}/lab-results`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('computes the flag from the reference range', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [
        candidate('Hemoglobin', 13.5, 0.95, { low: 12, high: 16 }),
        candidate('Hemoglobin', 17.2, 0.95, { low: 12, high: 16 }),
        candidate('Hemoglobin', 5, 0.95, { low: 12, high: 16 }),
      ]);

      const rows = await prisma.labResult.findMany({
        where: { patientId },
        orderBy: { value: 'asc' },
      });

      expect(rows.map((row) => row.flag)).toEqual([
        LabFlag.CRITICAL,
        LabFlag.NORMAL,
        LabFlag.HIGH,
      ]);
    });

    /** A value with nothing to compare against is unclassified, not normal. */
    it('leaves the flag unset when the report gave no range', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Ferritin', 40)]);

      const rows = await prisma.labResult.findMany({ where: { patientId } });

      expect(rows[0]!.flag).toBeNull();
    });
  });

  describe('the review queue', () => {
    /**
     * Doubtful first. Burying the fields a human has to look at under the ones
     * the engine was sure about is how a reviewer starts clicking through
     * without reading.
     */
    it('puts the least certain results first', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [
        candidate('Sure', 10, 0.99),
        candidate('Doubtful', 20, 0.35),
        candidate('Middling', 30, 0.7),
      ]);

      const rows = await pending(patientId);

      expect(rows.map((row) => row.result.analyteName)).toEqual([
        'Doubtful',
        'Middling',
        'Sure',
      ]);
    });

    it('marks the low-confidence ones for attention', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Doubtful', 20, 0.35), candidate('Sure', 10, 0.99)]);

      const rows = await pending(patientId);

      expect(rows[0]!.needsAttention).toBe(true);
      expect(rows[1]!.needsAttention).toBe(false);
    });

    it('marks an unmapped analyte as awaiting mapping', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Bilinmeyen Analit', 5)]);

      const rows = await pending(patientId);

      expect(rows[0]!.awaitingMapping).toBe(true);
      expect(rows[0]!.result.analyteCode).toBeNull();
    });

    /** Reviewing is where a value becomes clinical, so it needs medical.write. */
    it('refuses a role that may read but not write', async () => {
      const patientId = await makePatient();
      const coordinator = await actorFor(Role.COORDINATOR);

      await request(server)
        .get(`/patients/${patientId}/lab-results/pending`)
        .set('Authorization', `Bearer ${coordinator.token}`)
        .expect(403);
    });

    it('reports not found for a patient outside the caller scope', async () => {
      const patientId = await makePatient();
      const nurse = await actorFor(Role.NURSE);

      await request(server)
        .get(`/patients/${patientId}/lab-results/pending`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(404);
    });
  });

  describe('confirming a result', () => {
    it('records who confirmed it and when', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Hemoglobin', 13.5, 0.9, { low: 12, high: 16 })]);
      const [row] = await pending(patientId);

      await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({})
        .expect(200);

      const stored = await prisma.labResult.findUniqueOrThrow({ where: { id: row!.result.id } });

      expect(stored.verifiedById).toBe(doctor.userId);
      expect(stored.verifiedAt).not.toBeNull();
    });

    it('lets the confirmed result into the clinical list', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Hemoglobin', 13.5)]);
      const [row] = await pending(patientId);

      await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({})
        .expect(200);

      const response = await request(server)
        .get(`/patients/${patientId}/lab-results`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
    });

    /**
     * A doctor who fixes a misread reference range has changed what normal
     * means for that row. Keeping the old flag would leave a corrected value
     * showing red.
     */
    it('recomputes the flag from the corrected values', async () => {
      const patientId = await makePatient();
      // OCR read the range as 12-16 when the report said 4-11.
      await fileCandidates(patientId, [candidate('Lökosit', 7.4, 0.6, { low: 12, high: 16 })]);
      const [row] = await pending(patientId);

      expect(row!.result.flag).toBe(LabFlag.LOW);

      const response = await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ refLow: 4, refHigh: 11 })
        .expect(200);

      expect((response.body as { flag: string }).flag).toBe(LabFlag.NORMAL);
    });

    /** The system learns the mapping once and stops asking (spec M16). */
    it('remembers an analyte mapping for the next report', async () => {
      const patientId = await makePatient();
      const rawName = `Hgb Test ${Date.now()}`;
      mappedNames.push(normalise(rawName));

      await fileCandidates(patientId, [candidate(rawName, 13.5)]);
      const [row] = await pending(patientId);

      await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ analyteCode: '718-7', analyteName: 'Hemoglobin' })
        .expect(200);

      // The same printed name arrives on a later report.
      const second = await makePatient();
      await fileCandidates(second, [candidate(rawName, 14.1)]);

      const rows = await pending(second);

      expect(rows[0]!.result.analyteCode).toBe('718-7');
      expect(rows[0]!.result.analyteName).toBe('Hemoglobin');
      expect(rows[0]!.awaitingMapping).toBe(false);
    });

    /** Spacing and case vary between laboratories printing the same analyte. */
    it('matches a learned mapping regardless of case and spacing', async () => {
      const patientId = await makePatient();
      const rawName = `Vit  D ${Date.now()}`;
      mappedNames.push(normalise(rawName));

      await fileCandidates(patientId, [candidate(rawName, 30)]);
      const [row] = await pending(patientId);

      await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ analyteCode: '14635-7', analyteName: 'Vitamin D' })
        .expect(200);

      const second = await makePatient();
      await fileCandidates(second, [candidate(rawName.toUpperCase().replace(/\s+/g, '  '), 28)]);

      const rows = await pending(second);

      expect(rows[0]!.result.analyteCode).toBe('14635-7');
    });

    /**
     * Turkish casing maps I to ı and İ to i, so a laboratory printing
     * "HEMOGLOBİN" and one printing "Hemoglobin" produced two different keys
     * and the doctor was asked to map the same analyte twice.
     */
    it('matches a learned mapping across the dotted and dotless i', async () => {
      const patientId = await makePatient();
      const rawName = `Bilirubin ${Date.now()}`;
      mappedNames.push(normalise(rawName));

      await fileCandidates(patientId, [candidate(rawName, 0.8)]);
      const [row] = await pending(patientId);

      await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ analyteCode: '1975-2', analyteName: 'Bilirubin' })
        .expect(200);

      const second = await makePatient();
      await fileCandidates(second, [candidate(rawName.toUpperCase(), 0.9)]);

      const rows = await pending(second);

      expect(rows[0]!.result.analyteCode).toBe('1975-2');
    });

    it('refuses to confirm the same result twice', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Hemoglobin', 13.5)]);
      const [row] = await pending(patientId);

      await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({})
        .expect(200);

      await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ value: 99 })
        .expect(400);
    });

    it('audits the confirmation', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Hemoglobin', 13.5)]);
      const [row] = await pending(patientId);

      await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({})
        .expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { entityType: 'lab_results', entityId: row!.result.id, action: AuditAction.UPDATE },
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]!.actorId).toBe(doctor.userId);
    });

    it('refuses a role without medical.write', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Hemoglobin', 13.5)]);
      const [row] = await pending(patientId);
      const coordinator = await actorFor(Role.COORDINATOR);

      await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${coordinator.token}`)
        .send({})
        .expect(403);
    });
  });

  describe('trends', () => {
    const confirm = async (resultId: string, body: Record<string, unknown> = {}): Promise<void> => {
      await request(server)
        .patch(`/lab-results/${resultId}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send(body)
        .expect(200);
    };

    const trends = async (patientId: string): Promise<TrendRow[]> => {
      const response = await request(server)
        .get(`/patients/${patientId}/lab-results/trends`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      return response.body as TrendRow[];
    };

    it('groups confirmed results into one series per analyte', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [
        candidate('Hemoglobin', 13.5, 0.9, { low: 12, high: 16 }),
        candidate('Hemoglobin', 14.1, 0.9, { low: 12, high: 16 }),
        candidate('Kreatinin', 0.9, 0.9, { low: 0.6, high: 1.2 }),
      ]);

      for (const row of await pending(patientId)) {
        await confirm(row.result.id);
      }

      const series = await trends(patientId);

      expect(series.map((s) => s.analyteName)).toEqual(['Hemoglobin', 'Kreatinin']);
      expect(series[0]!.points).toHaveLength(2);
    });

    /** Unconfirmed values are not clinical and must not reach a chart. */
    it('leaves unconfirmed results out', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Hemoglobin', 13.5)]);

      expect(await trends(patientId)).toEqual([]);
    });

    it('carries the band when every point shares one range', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [
        candidate('Hemoglobin', 13.5, 0.9, { low: 12, high: 16 }),
        candidate('Hemoglobin', 14.1, 0.9, { low: 12, high: 16 }),
      ]);

      for (const row of await pending(patientId)) {
        await confirm(row.result.id);
      }

      const [series] = await trends(patientId);

      expect(series!.reference).toEqual({ low: 12, high: 16 });
    });

    /**
     * Two laboratories rarely agree on a reference interval. Drawing one band
     * across points measured against different ones would put results on the
     * wrong side of a line they were never compared to.
     */
    it('draws no band when the points disagree about the range', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [
        candidate('Hemoglobin', 13.5, 0.9, { low: 12, high: 16 }),
        candidate('Hemoglobin', 14.1, 0.9, { low: 11.5, high: 15.5 }),
      ]);

      for (const row of await pending(patientId)) {
        await confirm(row.result.id);
      }

      const [series] = await trends(patientId);

      expect(series!.reference).toBeNull();
      // The per-point ranges are still there, so a client can show each one.
      expect(series!.points.map((p) => p.refLow)).toEqual([12, 11.5]);
    });

    /**
     * A glucose in mg/dL and a glucose in mmol/L are the same analyte and an
     * eighteen-fold difference on the same axis.
     */
    it('splits a series when the unit changes', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [
        { ...candidate('Glukoz', 92), unit: 'mg/dL' },
        { ...candidate('Glukoz', 5.1), unit: 'mmol/L' },
      ]);

      for (const row of await pending(patientId)) {
        await confirm(row.result.id);
      }

      const series = await trends(patientId);

      expect(series).toHaveLength(2);
      expect(series.map((s) => s.unit).sort()).toEqual(['mg/dL', 'mmol/L']);
    });

    it('reports the most recent flag for the series', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [
        candidate('Hemoglobin', 13.5, 0.9, { low: 12, high: 16 }),
        candidate('Hemoglobin', 17.5, 0.9, { low: 12, high: 16 }),
      ]);

      for (const row of await pending(patientId)) {
        await confirm(row.result.id);
      }

      const [series] = await trends(patientId);

      expect(series!.latestFlag).toBe(LabFlag.HIGH);
    });

    it('refuses a role without medical.read', async () => {
      const patientId = await makePatient();
      const finance = await actorFor(Role.FINANCE);

      await request(server)
        .get(`/patients/${patientId}/lab-results/trends`)
        .set('Authorization', `Bearer ${finance.token}`)
        .expect(403);
    });
  });

  describe('critical values', () => {
    /**
     * A critical value must not be something a doctor finds by scrolling, or by
     * opening the right chart.
     */
    it('lists confirmed critical results, newest first', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [
        candidate('Hemoglobin', 13.5, 0.9, { low: 12, high: 16 }),
        candidate('Hemoglobin', 4, 0.9, { low: 12, high: 16 }),
      ]);

      for (const row of await pending(patientId)) {
        await request(server)
          .patch(`/lab-results/${row.result.id}/verify`)
          .set('Authorization', `Bearer ${doctor.token}`)
          .send({})
          .expect(200);
      }

      const response = await request(server)
        .get(`/patients/${patientId}/lab-results/critical`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const rows = response.body as { value: string; flag: string }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.flag).toBe(LabFlag.CRITICAL);
    });

    /** An unconfirmed critical value is not yet a fact about the patient. */
    it('does not list a critical result nobody has confirmed', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Hemoglobin', 4, 0.9, { low: 12, high: 16 })]);

      const response = await request(server)
        .get(`/patients/${patientId}/lab-results/critical`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('discarding', () => {
    /**
     * OCR reads table headers as values often enough that a reviewer needs a
     * way to say "this is not a result" — otherwise the queue only grows and
     * stops being read.
     */
    it('removes something that is not a result', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Sayfa 2', 2, 0.4)]);
      const [row] = await pending(patientId);

      await request(server)
        .delete(`/lab-results/${row!.result.id}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(204);

      expect(await prisma.labResult.count({ where: { patientId } })).toBe(0);
    });

    it('refuses to discard a confirmed result', async () => {
      const patientId = await makePatient();
      await fileCandidates(patientId, [candidate('Hemoglobin', 13.5)]);
      const [row] = await pending(patientId);

      await request(server)
        .patch(`/lab-results/${row!.result.id}/verify`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({})
        .expect(200);

      await request(server)
        .delete(`/lab-results/${row!.result.id}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(400);
    });
  });

  /**
   * The report, as it was printed (spec M16).
   *
   * A trend answers "is this getting better"; a panel answers "what did the
   * blood test say". The rules worth holding are that a patient never sees an
   * unconfirmed number, and that two reports taken at the same moment stay
   * apart.
   */
  describe('panels', () => {
    it('groups confirmed results by the report they came from', async () => {
      const patientId = await makePatient();
      const documentId = await makeDocument(patientId);
      const measuredAt = new Date('2026-03-26T11:29:00.000Z');

      for (const [name, value] of [
        ['ALT', 106],
        ['ALP', 107],
        ['AST', 48],
      ] as const) {
        await prisma.labResult.create({
          data: {
            patientId,
            documentId,
            analyteName: name,
            value,
            unit: 'U/L',
            refLow: 10,
            refHigh: 49,
            flag: value > 49 ? LabFlag.HIGH : LabFlag.NORMAL,
            measuredAt,
            verifiedAt: new Date(),
            verifiedById: doctor.userId,
          },
        });
      }

      const body = (
        await request(server)
          .get(`/patients/${patientId}/lab-results/panels`)
          .set('Authorization', `Bearer ${doctor.token}`)
          .expect(200)
      ).body as { documentId: string | null; results: { analyteName: string }[] }[];

      expect(body).toHaveLength(1);
      expect(body[0]?.documentId).toBe(documentId);
      // Alphabetical, so the same report reads the same way twice.
      expect(body[0]?.results.map((r) => r.analyteName)).toEqual(['ALP', 'ALT', 'AST']);
    });

    /// What OCR read is not clinical until a human has said so, and a number
    /// shown to the person it is about is as clinical as it gets.
    it('leaves out a result nobody has confirmed', async () => {
      const patientId = await makePatient();

      await prisma.labResult.create({
        data: {
          patientId,
          analyteName: 'CRP',
          value: 78.8,
          unit: 'mg/L',
          measuredAt: new Date('2026-03-26T11:29:00.000Z'),
        },
      });

      const body = (
        await request(server)
          .get(`/patients/${patientId}/lab-results/panels`)
          .set('Authorization', `Bearer ${doctor.token}`)
          .expect(200)
      ).body as unknown[];

      expect(body).toHaveLength(0);
    });

    /// Two draws on one morning are two reports, and a reader looking for the
    /// one they were handed needs them apart.
    it('keeps two reports from the same moment apart', async () => {
      const patientId = await makePatient();
      const measuredAt = new Date('2026-03-26T11:29:00.000Z');

      for (const name of ['ALT', 'CRP']) {
        await prisma.labResult.create({
          data: {
            patientId,
            documentId: await makeDocument(patientId),
            analyteName: name,
            value: 10,
            unit: 'U/L',
            measuredAt,
            verifiedAt: new Date(),
            verifiedById: doctor.userId,
          },
        });
      }

      const body = (
        await request(server)
          .get(`/patients/${patientId}/lab-results/panels`)
          .set('Authorization', `Bearer ${doctor.token}`)
          .expect(200)
      ).body as unknown[];

      expect(body).toHaveLength(2);
    });
  });
});
