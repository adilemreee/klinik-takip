import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AuditAction,
  DocumentType,
  PrismaClient,
  ProcessingStatus,
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
import { documentIntake } from '../src/documents/document-intake.processor';
import { FileService } from '../src/files/file.service';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { runWorker } from '../src/queue/job-runner';
import { JOBS, QUEUES } from '../src/queue/queue.constants';
import { QueueService } from '../src/queue/queue.service';

/** Polls until the condition holds, so the test waits on the worker, not a sleep. */
async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await check();
    if (result !== null) return result;

    if (Date.now() > deadline) {
      throw new Error('The worker did not finish the job in time');
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

interface Actor {
  token: string;
  userId: string;
}

interface Uploaded {
  id: string;
  jobId: string;
  mime: string;
  size: number;
  ocrStatus: ProcessingStatus;
  originalName: string | null;
}

/**
 * Document upload, end to end, against a real MinIO and a real queue.
 *
 * The cases that matter are the ones where a file is accepted but not really
 * there, or reaches someone it should not: a claimed content type that is not
 * what arrived, a document belonging to another clinic's patient, and an upload
 * whose row is written but whose job never runs.
 */
describe('documents', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];
  const storedKeys: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let files: FileService;
  let queues: QueueService;
  let doctor: Actor;

  const PASSWORD = 'correct-horse-battery-9';

  const pdf = (padding = 512): Buffer =>
    Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(padding, 0x20)]);
  const jpeg = (): Buffer =>
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 0x11)]);

  const actorFor = async (role: Role): Promise<Actor> => {
    const email = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Doc', lastName: role },
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
        mrn: `MRN-DOC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const upload = async (
    patientId: string,
    token: string,
    content: Buffer,
    options: { filename?: string; type?: string } = {},
  ): Promise<request.Response> => {
    const call = request(server)
      .post(`/patients/${patientId}/documents`)
      .set('Authorization', `Bearer ${token}`);

    if (options.type) {
      void call.field('type', options.type);
    }

    return call.attach('file', content, options.filename ?? 'result.pdf');
  };

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
    queues = app.get(QueueService);

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
    await prisma.document.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('uploading', () => {
    it('stores the file and records what it actually is', async () => {
      const patientId = await makePatient();

      const response = await upload(patientId, doctor.token, pdf(), { type: 'LAB' });

      expect(response.status).toBe(201);

      const body = response.body as Uploaded;
      await remember(body.id);

      expect(body.mime).toBe('application/pdf');
      expect(body.originalName).toBe('result.pdf');
      expect(body.ocrStatus).toBe(ProcessingStatus.QUEUED);

      const stored = await prisma.document.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.type).toBe(DocumentType.LAB);
      expect(stored.checksum).toHaveLength(64);
      expect(stored.uploadedById).toBe(doctor.userId);
    });

    /**
     * The stored type comes from the bytes, not the filename or the declared
     * Content-Type. A file served back under a type its contents do not match
     * is how an upload turns into script execution.
     */
    it('stores a JPEG as a JPEG however it is named', async () => {
      const patientId = await makePatient();

      const response = await upload(patientId, doctor.token, jpeg(), {
        filename: 'scan.pdf',
        type: 'IMAGING',
      });

      const body = response.body as Uploaded;
      await remember(body.id);

      expect(response.status).toBe(201);
      expect(body.mime).toBe('image/jpeg');
    });

    it('refuses content it cannot identify', async () => {
      const patientId = await makePatient();

      const response = await upload(patientId, doctor.token, Buffer.alloc(64, 0x7f));

      expect(response.status).toBe(400);
      expect(await prisma.document.count({ where: { patientId } })).toBe(0);
    });

    /** Executables must never be storable, whatever they are called. */
    it('refuses an executable presented as a PDF', async () => {
      const patientId = await makePatient();

      const response = await upload(
        patientId,
        doctor.token,
        Buffer.concat([Buffer.from('MZ'), Buffer.alloc(256, 0)]),
        { filename: 'report.pdf' },
      );

      expect(response.status).toBe(400);
    });

    it('refuses a request with no file part', async () => {
      const patientId = await makePatient();

      await request(server)
        .post(`/patients/${patientId}/documents`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .field('type', 'LAB')
        .expect(400);
    });

    /** Filed as OTHER silently would keep a lab report out of the OCR pipeline. */
    it('refuses an unknown document type', async () => {
      const patientId = await makePatient();

      const response = await upload(patientId, doctor.token, pdf(), { type: 'XRAY' });

      expect(response.status).toBe(400);
      expect(await prisma.document.count({ where: { patientId } })).toBe(0);
    });

    it('refuses a role without documents.write', async () => {
      const patientId = await makePatient();
      const finance = await actorFor(Role.FINANCE);

      const response = await upload(patientId, finance.token, pdf());

      expect(response.status).toBe(403);
    });

    /** Out of scope reads as absent, never as forbidden. */
    it('reports not found for a patient outside the caller scope', async () => {
      const patientId = await makePatient();
      const nurse = await actorFor(Role.NURSE);

      const response = await upload(patientId, nurse.token, pdf());

      expect(response.status).toBe(404);
    });

    it('writes an audit entry naming the actor', async () => {
      const patientId = await makePatient();
      const response = await upload(patientId, doctor.token, pdf());
      await remember((response.body as Uploaded).id);

      const entries = await prisma.auditLog.findMany({
        where: { patientId, entityType: 'documents', action: AuditAction.CREATE },
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]!.actorId).toBe(doctor.userId);
    });
  });

  describe('the queued job', () => {
    it('records a job against the document', async () => {
      const patientId = await makePatient();
      const response = await upload(patientId, doctor.token, pdf());
      const body = response.body as Uploaded;
      await remember(body.id);

      const job = await prisma.job.findUniqueOrThrow({ where: { id: body.jobId } });

      expect(job.queue).toBe('documents');
      expect(job.entityId).toBe(body.id);
      expect(job.patientId).toBe(patientId);
      expect(job.status).toBe(ProcessingStatus.QUEUED);
    });

    /**
     * The durable row is the point: BullMQ drops completed jobs on its
     * retention policy, and "what happened to the report I uploaded last week"
     * has to stay answerable.
     */
    it('serves the job history through the document', async () => {
      const patientId = await makePatient();
      const response = await upload(patientId, doctor.token, pdf());
      const body = response.body as Uploaded;
      await remember(body.id);

      const jobs = await request(server)
        .get(`/documents/${body.id}/jobs`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((jobs.body as { id: string }[]).map((job) => job.id)).toEqual([body.jobId]);
    });

    it('actually reaches the queue', async () => {
      const patientId = await makePatient();
      const response = await upload(patientId, doctor.token, pdf());
      const body = response.body as Uploaded;
      await remember(body.id);

      const queued = await queues.queue('documents').getJob(body.jobId);

      expect(queued?.name).toBe('document-intake');
    });

    it('marks the document ready for OCR once intake verifies the bytes', async () => {
      const patientId = await makePatient();
      const response = await upload(patientId, doctor.token, pdf());
      const body = response.body as Uploaded;
      await remember(body.id);

      const handler = documentIntake(prisma as unknown as PrismaService, files);
      await handler({ data: { jobId: body.jobId } } as never);

      const stored = await prisma.document.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.ocrStatus).toBe(ProcessingStatus.PENDING);
    });

    /**
     * A size mismatch means the stored bytes are not the bytes that were
     * checksummed. Passing that on to OCR would treat a corrupted file as sound.
     */
    it('fails intake when the stored object does not match the record', async () => {
      const patientId = await makePatient();
      const response = await upload(patientId, doctor.token, pdf());
      const body = response.body as Uploaded;
      await remember(body.id);

      await prisma.document.update({
        where: { id: body.id },
        data: { size: body.size + 1 },
      });

      const handler = documentIntake(prisma as unknown as PrismaService, files);

      await expect(handler({ data: { jobId: body.jobId } } as never)).rejects.toThrow(/bytes/);
    });

    /** Uploaded then deleted before the worker ran: nothing to do, nothing wrong. */
    it('passes intake over a document that has been removed', async () => {
      const patientId = await makePatient();
      const response = await upload(patientId, doctor.token, pdf());
      const body = response.body as Uploaded;
      await remember(body.id);

      await prisma.document.delete({ where: { id: body.id } });

      const handler = documentIntake(prisma as unknown as PrismaService, files);

      await expect(handler({ data: { jobId: body.jobId } } as never)).resolves.toBeUndefined();
    });

    /**
     * The window between the commit and the enqueue is small but real, and a
     * document nobody ever processes is exactly the failure nobody notices.
     */
    it('requeues a job that was recorded but never dispatched', async () => {
      const patientId = await makePatient();
      const job = await prisma.job.create({
        data: {
          queue: 'documents',
          name: 'document-intake',
          entityType: 'documents',
          patientId,
          status: ProcessingStatus.QUEUED,
          externalId: null,
          createdAt: new Date(Date.now() - 120_000),
        },
      });

      const requeued = await queues.requeueStranded();

      expect(requeued).toBeGreaterThanOrEqual(1);

      const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.externalId).toBe(job.id);
      expect(await queues.queue('documents').getJob(job.id)).toBeTruthy();
    });
  });

  /**
   * The whole thing actually turning.
   *
   * Every other test here exercises a half: the endpoint enqueues, or the
   * handler is called directly. This one starts the real worker and waits for
   * the record to move on its own — which is the only way to catch a queue
   * name typed one way in the producer and another in the consumer, where
   * nothing fails and the work simply never happens.
   */
  describe('the worker end to end', () => {
    it('processes an upload and marks the job done', async () => {
      const patientId = await makePatient();
      const response = await upload(patientId, doctor.token, pdf());
      const body = response.body as Uploaded;
      await remember(body.id);

      const worker = runWorker({
        queue: QUEUES.documents,
        handlers: { [JOBS.documentIntake]: documentIntake(prisma as unknown as PrismaService, files) },
        connection: queues.connection,
        prisma: prisma as unknown as PrismaService,
        concurrency: 1,
      });

      try {
        const finished = await waitFor(async () => {
          const job = await prisma.job.findUniqueOrThrow({ where: { id: body.jobId } });
          return job.status === ProcessingStatus.DONE ? job : null;
        });

        expect(finished.startedAt).not.toBeNull();
        expect(finished.finishedAt).not.toBeNull();
        expect(finished.attempts).toBe(1);

        const document = await prisma.document.findUniqueOrThrow({ where: { id: body.id } });
        expect(document.ocrStatus).toBe(ProcessingStatus.PENDING);
      } finally {
        await worker.close();
      }
    }, 30_000);
  });

  describe('reading', () => {
    it('lists a patient documents newest first', async () => {
      const patientId = await makePatient();
      const first = (await upload(patientId, doctor.token, pdf(), { type: 'LAB' }))
        .body as Uploaded;
      const second = (await upload(patientId, doctor.token, pdf(600), { type: 'REPORT' }))
        .body as Uploaded;
      await remember(first.id);
      await remember(second.id);

      const response = await request(server)
        .get(`/patients/${patientId}/documents`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const items = (response.body as { items: { id: string }[] }).items;
      expect(items.map((item) => item.id)).toEqual([second.id, first.id]);
    });

    it('filters by type', async () => {
      const patientId = await makePatient();
      const lab = (await upload(patientId, doctor.token, pdf(), { type: 'LAB' }))
        .body as Uploaded;
      const invoice = (await upload(patientId, doctor.token, pdf(700), { type: 'INVOICE' }))
        .body as Uploaded;
      await remember(lab.id);
      await remember(invoice.id);

      const response = await request(server)
        .get(`/patients/${patientId}/documents`)
        .query({ type: 'LAB' })
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((response.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([
        lab.id,
      ]);
    });

    it('mints a signed URL that serves the stored bytes', async () => {
      const patientId = await makePatient();
      const content = pdf();
      const body = (await upload(patientId, doctor.token, content)).body as Uploaded;
      await remember(body.id);

      const response = await request(server)
        .get(`/documents/${body.id}/download`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const { url } = response.body as { url: string };
      const fetched = await fetch(url);

      expect(fetched.status).toBe(200);
      expect(Buffer.from(await fetched.arrayBuffer())).toEqual(content);
    });

    /** Opening a patient file is a clinical access event (spec M13). */
    it('audits a download', async () => {
      const patientId = await makePatient();
      const body = (await upload(patientId, doctor.token, pdf())).body as Uploaded;
      await remember(body.id);

      await request(server)
        .get(`/documents/${body.id}/download`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      const reads = await prisma.auditLog.findMany({
        where: { entityType: 'documents', entityId: body.id, action: AuditAction.READ },
      });

      expect(reads.length).toBeGreaterThanOrEqual(1);
    });

    it('reports not found for a document outside the caller scope', async () => {
      const patientId = await makePatient();
      const body = (await upload(patientId, doctor.token, pdf())).body as Uploaded;
      await remember(body.id);

      const nurse = await actorFor(Role.NURSE);

      await request(server)
        .get(`/documents/${body.id}/download`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(404);
    });
  });

  describe('removing', () => {
    /**
     * Soft delete only. Clinical records have a legal retention period, and a
     * deletion request is not permission to destroy what the clinic must keep.
     */
    it('hides the document but keeps the bytes', async () => {
      const patientId = await makePatient();
      const body = (await upload(patientId, doctor.token, pdf())).body as Uploaded;
      await remember(body.id);

      await request(server)
        .delete(`/documents/${body.id}`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(204);

      const stored = await prisma.document.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.deletedAt).not.toBeNull();

      // The object is still there.
      await expect(files.stat('documents', stored.fileKey)).resolves.toBeTruthy();

      const list = await request(server)
        .get(`/patients/${patientId}/documents`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((list.body as { items: unknown[] }).items).toHaveLength(0);
    });

    it('refuses a role without documents.write', async () => {
      const patientId = await makePatient();
      const body = (await upload(patientId, doctor.token, pdf())).body as Uploaded;
      await remember(body.id);

      const finance = await actorFor(Role.FINANCE);

      await request(server)
        .delete(`/documents/${body.id}`)
        .set('Authorization', `Bearer ${finance.token}`)
        .expect(403);
    });
  });
});
