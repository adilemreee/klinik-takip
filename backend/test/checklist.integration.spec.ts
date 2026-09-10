import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  DocumentType,
  PrismaClient,
  ProcessingStatus,
  Role,
  Sex,
  UserStatus,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

const prisma = new PrismaClient();

interface ChecklistBody {
  items: {
    documentType: DocumentType;
    label: string;
    mandatory: boolean;
    satisfied: boolean;
    documentId: string | null;
  }[];
  missingMandatory: number;
  complete: boolean;
}

/**
 * The pre-operative document checklist (spec M17).
 *
 * The cases that matter are the ones where the list would lie: a document the
 * pipeline could not read counting as received, a requirement for somebody
 * else's procedure appearing on this patient's list, and an optional item
 * holding the file open.
 *
 * **This suite empties `document_requirements`.** The table is global rather
 * than per patient, so rows the clinic has configured would appear in every
 * assertion here. `npm run seed` puts the defaults back; CI starts from an
 * empty database and does not care.
 */
describe('document checklist', () => {
  const userIds: string[] = [];
  const patientIds: string[] = [];
  const requirementIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;

  const PASSWORD = 'correct-horse-battery-9';

  const patientWithFile = async (): Promise<{ token: string; patientId: string }> => {
    const email = `chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: {
        role: Role.PATIENT,
        email,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    const patient = await prisma.patient.create({
      data: {
        userId: user.id,
        mrn: `CHK-${Math.random().toString(36).slice(2, 10)}`,
        firstName: 'Test',
        lastName: 'Hasta',
        birthDate: new Date('1990-05-14'),
        sex: Sex.FEMALE,
        country: 'TR',
      },
    });
    patientIds.push(patient.id);

    const login = await auth.login(email, PASSWORD, undefined, {});

    return { token: login.tokens!.accessToken, patientId: patient.id };
  };

  const requirement = async (options: {
    documentType: DocumentType;
    label: string;
    isMandatory?: boolean;
    procedureType?: string | null;
  }): Promise<void> => {
    const row = await prisma.documentRequirement.create({
      data: {
        documentType: options.documentType,
        label: options.label,
        isMandatory: options.isMandatory ?? true,
        procedureType: options.procedureType ?? null,
        sortOrder: 0,
      },
    });
    requirementIds.push(row.id);
  };

  const document = async (
    patientId: string,
    type: DocumentType,
    ocrStatus: ProcessingStatus = ProcessingStatus.DONE,
  ): Promise<void> => {
    await prisma.document.create({
      data: {
        patientId,
        type,
        fileKey: `2026/01/${Math.random().toString(36).slice(2)}.pdf`,
        mime: 'application/pdf',
        size: 1024,
        ocrStatus,
      },
    });
  };

  const fetch = (token: string): request.Test =>
    request(server).get('/me/documents/checklist').set('Authorization', `Bearer ${token}`);

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

    // The seed's own rows would make every assertion depend on what the
    // clinic happens to have configured, so this suite works against rows it
    // creates and removes itself.
    await prisma.documentRequirement.deleteMany({});
  });

  // The list is global, not per patient: rows left by one test would appear in
  // the next one's checklist and every assertion after the first would be
  // about somebody else's fixture.
  beforeEach(async () => {
    await prisma.documentRequirement.deleteMany({});
    requirementIds.length = 0;
  });

  afterAll(async () => {
    await prisma.documentRequirement.deleteMany({ where: { id: { in: requirementIds } } });
    await prisma.document.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.surgery.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('lists what is required and marks nothing satisfied when nothing was sent', async () => {
    await requirement({ documentType: DocumentType.PASSPORT, label: 'Pasaport' });
    const { token } = await patientWithFile();

    const body = (await fetch(token).expect(200)).body as ChecklistBody;

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.satisfied).toBe(false);
    expect(body.missingMandatory).toBe(1);
    expect(body.complete).toBe(false);
  });

  it('marks a requirement satisfied once a document of that kind is there', async () => {
    await requirement({ documentType: DocumentType.PASSPORT, label: 'Pasaport' });
    const { token, patientId } = await patientWithFile();
    await document(patientId, DocumentType.PASSPORT);

    const body = (await fetch(token).expect(200)).body as ChecklistBody;

    expect(body.items[0]?.satisfied).toBe(true);
    expect(body.items[0]?.documentId).toEqual(expect.any(String));
    expect(body.complete).toBe(true);
  });

  /// Saying "passport received" over an unreadable scan is how somebody
  /// arrives at the airport without one.
  it('does not count a document the pipeline could not read', async () => {
    await requirement({ documentType: DocumentType.PASSPORT, label: 'Pasaport' });
    const { token, patientId } = await patientWithFile();
    await document(patientId, DocumentType.PASSPORT, ProcessingStatus.FAILED);

    const body = (await fetch(token).expect(200)).body as ChecklistBody;

    expect(body.items[0]?.satisfied).toBe(false);
    expect(body.complete).toBe(false);
  });

  /// An optional item left undone is not an incomplete file, and colouring it
  /// red teaches people to ignore the colour.
  it('does not let an optional item hold the file open', async () => {
    await requirement({ documentType: DocumentType.PASSPORT, label: 'Pasaport' });
    await requirement({
      documentType: DocumentType.IMAGING,
      label: 'Görüntüleme',
      isMandatory: false,
    });

    const { token, patientId } = await patientWithFile();
    await document(patientId, DocumentType.PASSPORT);

    const body = (await fetch(token).expect(200)).body as ChecklistBody;

    expect(body.items).toHaveLength(2);
    expect(body.missingMandatory).toBe(0);
    expect(body.complete).toBe(true);
  });

  it('leaves out a requirement that belongs to a different procedure', async () => {
    await requirement({ documentType: DocumentType.PASSPORT, label: 'Pasaport' });
    await requirement({
      documentType: DocumentType.ECG,
      label: 'EKG',
      procedureType: 'RHINOPLASTY',
    });

    const { token } = await patientWithFile();

    const body = (await fetch(token).expect(200)).body as ChecklistBody;

    expect(body.items.map((item) => item.label)).toEqual(['Pasaport']);
  });

  it('includes a requirement for the procedure this patient is having', async () => {
    await requirement({ documentType: DocumentType.PASSPORT, label: 'Pasaport' });
    await requirement({
      documentType: DocumentType.ECG,
      label: 'EKG',
      procedureType: 'RHINOPLASTY',
    });

    const { token, patientId } = await patientWithFile();
    await prisma.surgery.create({
      data: {
        patientId,
        procedureName: 'Rinoplasti',
        procedureCode: 'RHINOPLASTY',
        performedAt: new Date('2026-11-02T09:00:00.000Z'),
      },
    });

    const body = (await fetch(token).expect(200)).body as ChecklistBody;

    expect(body.items.map((item) => item.label).sort()).toEqual(['EKG', 'Pasaport']);
  });

  it('does not let one patient read another patient checklist', async () => {
    await requirement({ documentType: DocumentType.PASSPORT, label: 'Pasaport' });
    const { patientId } = await patientWithFile();
    const other = await patientWithFile();

    await request(server)
      .get(`/patients/${patientId}/documents/checklist`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(403);
  });
});
