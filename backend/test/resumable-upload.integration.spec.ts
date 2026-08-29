import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  PrismaClient,
  ProcessingStatus,
  Role,
  Sex,
  UploadStatus,
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
import { ResumableUploadService } from '../src/documents/resumable-upload.service';
import { FileService } from '../src/files/file.service';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

interface Session {
  id: string;
  receivedBytes: number;
  status: UploadStatus;
  mime: string | null;
  documentId: string | null;
}

interface Uploaded {
  id: string;
  size: number;
  mime: string;
  jobId: string;
}

/**
 * Resumable upload (spec section 9).
 *
 * The case this exists for is a patient abroad on mobile data sending a scan
 * that fails at 18 of 20 MB. Every test here is about the file that survives
 * that, and about the ways a partial upload could quietly become a corrupt
 * document instead of a refused one.
 */
describe('resumable upload', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];
  const storedKeys: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let files: FileService;
  let storage: StorageService;
  let uploads: ResumableUploadService;
  let doctor: { token: string; userId: string };

  const PASSWORD = 'correct-horse-battery-9';

  const pdf = (size: number): Buffer =>
    Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size - 9, 0x41)]);

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `ru-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Res', lastName: role },
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
        mrn: `MRN-RU-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const begin = async (patientId: string, token = doctor.token): Promise<Session> => {
    const response = await request(server)
      .post(`/patients/${patientId}/documents/uploads`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'LAB', originalName: 'result.pdf' })
      .expect(201);

    return response.body as Session;
  };

  const sendChunk = (
    sessionId: string,
    offset: number,
    chunk: Buffer,
    token = doctor.token,
  ): request.Test =>
    request(server)
      .patch(`/documents/uploads/${sessionId}`)
      .query({ offset })
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(chunk);

  const complete = (
    sessionId: string,
    body: Record<string, unknown> = {},
    token = doctor.token,
  ): request.Test =>
    request(server)
      .post(`/documents/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const remember = async (documentId: string): Promise<void> => {
    const row = await prisma.document.findUnique({
      where: { id: documentId },
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
    storage = app.get(StorageService);
    uploads = app.get(ResumableUploadService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();

    doctor = await actorFor(Role.DOCTOR);
  });

  afterAll(async () => {
    for (const key of storedKeys) {
      await files.remove('documents', key).catch(() => undefined);
    }

    await prisma.job.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.uploadSession.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.document.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  /** The whole point: the bytes that arrive in pieces are the bytes stored. */
  it('assembles chunks into exactly the original file', async () => {
    const patientId = await makePatient();
    const content = pdf(30_000);
    const session = await begin(patientId);

    for (let offset = 0; offset < content.length; offset += 8_192) {
      await sendChunk(session.id, offset, content.subarray(offset, offset + 8_192)).expect(200);
    }

    const response = await complete(session.id).expect(201);
    const body = response.body as Uploaded;
    await remember(body.id);

    expect(body.size).toBe(content.length);
    expect(body.mime).toBe('application/pdf');

    const stored = await prisma.document.findUniqueOrThrow({ where: { id: body.id } });
    expect(stored.checksum).toBe(createHash('sha256').update(content).digest('hex'));

    const url = await files.createDownloadUrl('documents', stored.fileKey);
    const fetched = await fetch(url.url);

    expect(Buffer.from(await fetched.arrayBuffer())).toEqual(content);
  });

  /**
   * The scenario the feature exists for: the connection dies mid-upload, the
   * client asks where the server got to, and carries on from there.
   */
  it('resumes from where the server actually is', async () => {
    const patientId = await makePatient();
    const content = pdf(20_000);
    const session = await begin(patientId);

    await sendChunk(session.id, 0, content.subarray(0, 8_192)).expect(200);

    // The client restarts and has no idea how much arrived.
    const resumed = await request(server)
      .get(`/documents/uploads/${session.id}`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .expect(200);

    const offset = (resumed.body as Session).receivedBytes;
    expect(offset).toBe(8_192);

    await sendChunk(session.id, offset, content.subarray(offset)).expect(200);

    const body = (await complete(session.id).expect(201)).body as Uploaded;
    await remember(body.id);

    expect(body.size).toBe(content.length);
  });

  /**
   * A client that resumed from the wrong place would leave a hole in the file,
   * and nothing downstream would notice until a doctor opened a corrupt PDF.
   * The server refuses and says where it actually is.
   */
  it('refuses a chunk at the wrong offset and reports the right one', async () => {
    const patientId = await makePatient();
    const content = pdf(20_000);
    const session = await begin(patientId);

    await sendChunk(session.id, 0, content.subarray(0, 8_192)).expect(200);

    const response = await sendChunk(session.id, 12_000, content.subarray(12_000)).expect(409);

    expect((response.body as { message: string; expectedOffset: number }).expectedOffset).toBe(
      8_192,
    );

    const session2 = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(session2.receivedBytes).toBe(8_192);
  });

  /** A retried chunk whose response was lost must not be appended twice. */
  it('treats a repeated chunk as a mismatch rather than appending it', async () => {
    const patientId = await makePatient();
    const content = pdf(20_000);
    const session = await begin(patientId);

    await sendChunk(session.id, 0, content.subarray(0, 8_192)).expect(200);
    const retry = await sendChunk(session.id, 0, content.subarray(0, 8_192)).expect(409);

    expect((retry.body as { expectedOffset: number }).expectedOffset).toBe(8_192);

    const row = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.receivedBytes).toBe(8_192);
  });

  /**
   * Sniffing the first chunk rather than the finished file means an executable
   * is refused after a few kilobytes instead of after the patient has spent
   * twenty megabytes of mobile data on it.
   */
  it('refuses a disallowed type on the first chunk', async () => {
    const patientId = await makePatient();
    const session = await begin(patientId);

    await sendChunk(session.id, 0, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4_096)])).expect(
      400,
    );

    const row = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(UploadStatus.ABORTED);
  });

  it('refuses content it cannot identify', async () => {
    const patientId = await makePatient();
    const session = await begin(patientId);

    await sendChunk(session.id, 0, Buffer.alloc(4_096, 0x7f)).expect(400);
  });

  /** The limit is cumulative: chunking must not be a way around it. */
  it('refuses an upload that exceeds the size limit across chunks', async () => {
    const patientId = await makePatient();
    const session = await begin(patientId);
    const limit = 20 * 1024 * 1024;
    const chunk = pdf(4 * 1024 * 1024);

    let offset = 0;
    let refused = false;

    for (let i = 0; i < 6; i += 1) {
      const response = await sendChunk(session.id, offset, chunk);

      if (response.status === 400) {
        refused = true;
        break;
      }

      expect(response.status).toBe(200);
      offset = (response.body as Session).receivedBytes;
      expect(offset).toBeLessThanOrEqual(limit);
    }

    expect(refused).toBe(true);
  }, 60_000);

  /**
   * The client hashed what it read from disk; we hashed what arrived. A
   * mismatch means the assembled file is not the file the patient chose.
   */
  it('refuses a completed upload whose checksum does not match', async () => {
    const patientId = await makePatient();
    const content = pdf(10_000);
    const session = await begin(patientId);

    await sendChunk(session.id, 0, content).expect(200);

    const response = await complete(session.id, { checksum: 'a'.repeat(64) }).expect(400);

    expect(JSON.stringify(response.body)).toContain('CHECKSUM_MISMATCH');
    expect(await prisma.document.count({ where: { patientId } })).toBe(0);
  });

  it('accepts a completed upload whose checksum matches', async () => {
    const patientId = await makePatient();
    const content = pdf(10_000);
    const session = await begin(patientId);

    await sendChunk(session.id, 0, content).expect(200);

    const checksum = createHash('sha256').update(content).digest('hex');
    const body = (await complete(session.id, { checksum }).expect(201)).body as Uploaded;
    await remember(body.id);

    expect(body.size).toBe(content.length);
  });

  /** A completion whose response was lost must not file the document twice. */
  it('returns the same document when complete is called again', async () => {
    const patientId = await makePatient();
    const content = pdf(10_000);
    const session = await begin(patientId);

    await sendChunk(session.id, 0, content).expect(200);

    const first = (await complete(session.id).expect(201)).body as Uploaded;
    await remember(first.id);
    const second = (await complete(session.id).expect(201)).body as Uploaded;

    expect(second.id).toBe(first.id);
    expect(await prisma.document.count({ where: { patientId } })).toBe(1);
  });

  it('refuses to complete an upload with no content', async () => {
    const patientId = await makePatient();
    const session = await begin(patientId);

    await complete(session.id).expect(400);
  });

  it('queues the intake job like a single-shot upload does', async () => {
    const patientId = await makePatient();
    const session = await begin(patientId);

    await sendChunk(session.id, 0, pdf(10_000)).expect(200);

    const body = (await complete(session.id).expect(201)).body as Uploaded;
    await remember(body.id);

    const job = await prisma.job.findUniqueOrThrow({ where: { id: body.jobId } });

    expect(job.entityId).toBe(body.id);
    expect(job.status).toBe(ProcessingStatus.QUEUED);

    const stored = await prisma.document.findUniqueOrThrow({ where: { id: body.id } });
    expect(stored.ocrStatus).toBe(ProcessingStatus.QUEUED);
  });

  describe('who may upload', () => {
    it('refuses a role without documents.write', async () => {
      const patientId = await makePatient();
      const finance = await actorFor(Role.FINANCE);

      await request(server)
        .post(`/patients/${patientId}/documents/uploads`)
        .set('Authorization', `Bearer ${finance.token}`)
        .send({ type: 'LAB' })
        .expect(403);
    });

    /** Out of scope reads as absent, never as forbidden. */
    it('reports not found for a patient outside the caller scope', async () => {
      const patientId = await makePatient();
      const nurse = await actorFor(Role.NURSE);

      await request(server)
        .post(`/patients/${patientId}/documents/uploads`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .send({ type: 'LAB' })
        .expect(404);
    });

    /** A session is not a capability: another caller cannot push bytes into it. */
    it('refuses a chunk from someone outside the patient scope', async () => {
      const patientId = await makePatient();
      const session = await begin(patientId);
      const nurse = await actorFor(Role.NURSE);

      await sendChunk(session.id, 0, pdf(4_096), nurse.token).expect(404);
    });
  });

  describe('abandoned uploads', () => {
    it('releases the parts of an aborted upload', async () => {
      const patientId = await makePatient();
      const session = await begin(patientId);
      await sendChunk(session.id, 0, pdf(4_096)).expect(200);

      await request(server)
        .delete(`/documents/uploads/${session.id}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(204);

      const row = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(row.status).toBe(UploadStatus.ABORTED);

      await expect(
        storage.client.statObject(
          process.env.S3_BUCKET_DOCUMENTS!,
          `uploads/${session.id}/000000`,
        ),
      ).rejects.toThrow();
    });

    /**
     * On the connection this feature exists for, most attempts are abandoned.
     * Without the sweep the bucket grows by every one of them.
     */
    it('sweeps sessions nobody came back to', async () => {
      const patientId = await makePatient();
      const session = await begin(patientId);
      await sendChunk(session.id, 0, pdf(4_096)).expect(200);

      await prisma.uploadSession.update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const swept = await uploads.sweepExpired();
      expect(swept).toBeGreaterThanOrEqual(1);

      const row = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(row.status).toBe(UploadStatus.ABORTED);
    });

    /** A finished upload is not abandoned and must survive the sweep. */
    it('leaves a completed upload alone', async () => {
      const patientId = await makePatient();
      const session = await begin(patientId);
      await sendChunk(session.id, 0, pdf(10_000)).expect(200);
      const body = (await complete(session.id).expect(201)).body as Uploaded;
      await remember(body.id);

      await prisma.uploadSession.update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      await uploads.sweepExpired();

      const row = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(row.status).toBe(UploadStatus.COMPLETED);

      const stored = await prisma.document.findUniqueOrThrow({ where: { id: body.id } });
      await expect(files.stat('documents', stored.fileKey)).resolves.toBeTruthy();
    });
  });
});
