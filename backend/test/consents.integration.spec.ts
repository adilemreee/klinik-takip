import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ConsentType, PrismaClient, Role, Sex, UserStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';

const prisma = new PrismaClient();

interface ConsentBody {
  id: string;
  type: ConsentType;
  version: number;
  active: boolean;
  revokedAt: string | null;
  hasSignature: boolean;
}

/**
 * The smallest valid PNG: an 8x8 transparent image.
 *
 * A real signature is a few kilobytes of strokes; what matters here is that it
 * is genuinely a PNG, because the server checks the magic bytes rather than
 * trusting the client's word for it.
 */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVQoU2NkYGD4z0AEYBxVSF' +
  'JCAAB1sQIF2f0Q0gAAAABJRU5ErkJggg==';

/**
 * Consent records (KVKK).
 *
 * The rules under test are legal ones, and each of them is a way the system
 * could look correct while being wrong.
 */
describe('consents', () => {
  const userIds: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;

  const PASSWORD = 'correct-horse-battery-9';

  const patientWithFile = async (): Promise<{ token: string; patientId: string }> => {
    const email = `cons-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
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
        mrn: `CONS-${Math.random().toString(36).slice(2, 10)}`,
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      // The real storage, not a stub: a consent can now carry a signature,
      // and "it was stored" is the part worth testing.
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
    await prisma.consent.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('refuses a data-processing consent', async () => {
    // KVKK Board decision 2026/347: where processing rests on a ground other
    // than consent — here art. 6/3, care by staff under a confidentiality
    // obligation — a consent text must not be put in front of the person.
    // Asking anyway produces a consent nobody could refuse without losing
    // their treatment, which is void, and a record implying otherwise.
    const patient = await patientWithFile();

    const response = await request(server)
      .post('/me/consents')
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ type: ConsentType.DATA_PROCESSING, version: 1 })
      .expect(400);

    expect(JSON.stringify(response.body)).toContain('6/3');
  });

  it('records a photo-usage consent with the version that was agreed to', async () => {
    const patient = await patientWithFile();

    const response = await request(server)
      .post('/me/consents')
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ type: ConsentType.PHOTO_USAGE, version: 3, documentText: 'v3 metni' })
      .expect(201);

    expect(response.body).toMatchObject({
      type: ConsentType.PHOTO_USAGE,
      version: 3,
      active: true,
      revokedAt: null,
    });
  });

  it('supersedes the previous consent of the same type rather than stacking', async () => {
    // Two active photo consents with different wording leaves nobody able to
    // say which text the patient actually agreed to.
    const patient = await patientWithFile();

    for (const version of [1, 2]) {
      await request(server)
        .post('/me/consents')
        .set('Authorization', `Bearer ${patient.token}`)
        .send({ type: ConsentType.PHOTO_USAGE, version })
        .expect(201);
    }

    const active = await prisma.consent.count({
      where: { patientId: patient.patientId, type: ConsentType.PHOTO_USAGE, revokedAt: null },
    });

    expect(active).toBe(1);
  });

  it('keeps the record when a consent is withdrawn', async () => {
    // Forward-only. Proving a consent existed while it was relied on is the
    // controller's burden, and a deleted row proves nothing.
    const patient = await patientWithFile();

    const given = await request(server)
      .post('/me/consents')
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ type: ConsentType.MARKETING, version: 1 })
      .expect(201);

    await request(server)
      .delete(`/me/consents/${(given.body as ConsentBody).id}`)
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(200);

    const stored = await prisma.consent.findUnique({ where: { id: (given.body as ConsentBody).id } });

    expect(stored).not.toBeNull();
    expect(stored!.revokedAt).not.toBeNull();
  });

  it('treats withdrawing twice as done, not as an error', async () => {
    // The person's intent is the same both times, and an error would read as a
    // failure to withdraw.
    const patient = await patientWithFile();

    const given = await request(server)
      .post('/me/consents')
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ type: ConsentType.MARKETING, version: 1 })
      .expect(201);

    await request(server)
      .delete(`/me/consents/${(given.body as ConsentBody).id}`)
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(200);

    await request(server)
      .delete(`/me/consents/${(given.body as ConsentBody).id}`)
      .set('Authorization', `Bearer ${patient.token}`)
      .expect(200);
  });

  it('does not let one patient withdraw another patient\'s consent', async () => {
    const first = await patientWithFile();
    const second = await patientWithFile();

    const given = await request(server)
      .post('/me/consents')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ type: ConsentType.PHOTO_USAGE, version: 1 })
      .expect(201);

    // `me` resolves the caller's own file, so the id simply is not theirs.
    await request(server)
      .delete(`/me/consents/${(given.body as ConsentBody).id}`)
      .set('Authorization', `Bearer ${second.token}`)
      .expect(404);
  });

  it('records who agreed and when, not just that somebody did', async () => {
    const patient = await patientWithFile();

    const given = await request(server)
      .post('/me/consents')
      .set('Authorization', `Bearer ${patient.token}`)
      .set('User-Agent', 'Klinik/0.1.0 (iPhone; iOS 17.0)')
      .send({ type: ConsentType.PHOTO_USAGE, version: 1, documentText: 'v1' })
      .expect(201);

    const stored = await prisma.consent.findUnique({ where: { id: (given.body as ConsentBody).id } });

    // The wording, the moment, and where it came from. "They consented" with
    // none of these is a claim, not a record — and proving it is the
    // controller's burden.
    expect(stored!.signedAt).toBeInstanceOf(Date);
    expect(stored!.documentText).toBe('v1');
    expect(stored!.userAgent).toContain('Klinik/0.1.0');
    expect(stored!.ipAddress).not.toBeNull();
  });

  describe('signature (spec M17)', () => {
    it('records a consent with the signature drawn for it', async () => {
      const { token, patientId } = await patientWithFile();

      const response = await request(server)
        .post('/me/consents')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: ConsentType.TREATMENT, version: 1, signature: PNG_BASE64 })
        .expect(201);

      expect((response.body as ConsentBody).hasSignature).toBe(true);

      const stored = await prisma.consent.findFirstOrThrow({ where: { patientId } });
      expect(stored.signatureFileKey).toEqual(expect.stringMatching(/\.png$/));
    });

    it('hands back a short-lived link rather than the bytes', async () => {
      const { token } = await patientWithFile();

      const created = await request(server)
        .post('/me/consents')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: ConsentType.TREATMENT, version: 1, signature: PNG_BASE64 })
        .expect(201);

      const link = await request(server)
        .get(`/me/consents/${(created.body as ConsentBody).id}/signature`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = link.body as { url: string; expiresAt: string };
      expect(body.url).toContain('http');
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    /// A consent recorded with a signature that is not one would be a record
    /// that looks signed and is not.
    it('refuses anything that is not a PNG', async () => {
      const { token, patientId } = await patientWithFile();

      await request(server)
        .post('/me/consents')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: ConsentType.TREATMENT,
          version: 1,
          signature: Buffer.from('this is not an image').toString('base64'),
        })
        .expect(400);

      // And nothing was written: a rejected signature must not leave a consent
      // behind claiming to have one.
      expect(await prisma.consent.count({ where: { patientId } })).toBe(0);
    });

    it('says a consent has no signature when none was drawn', async () => {
      const { token } = await patientWithFile();

      const response = await request(server)
        .post('/me/consents')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: ConsentType.PHOTO_USAGE, version: 1 })
        .expect(201);

      expect((response.body as ConsentBody).hasSignature).toBe(false);
    });

    it('has nothing to link to when no signature was drawn', async () => {
      const { token } = await patientWithFile();

      const created = await request(server)
        .post('/me/consents')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: ConsentType.PHOTO_USAGE, version: 1 })
        .expect(201);

      await request(server)
        .get(`/me/consents/${(created.body as ConsentBody).id}/signature`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('the form itself (spec M17)', () => {
    const form = (token: string): request.Test =>
      request(server).get('/me/consents/form').set('Authorization', `Bearer ${token}`);

    /// A document that does not name the operation is not informed consent, so
    /// the server builds it from the patient's own surgery record.
    it('puts the patient procedure into the form', async () => {
      const { token, patientId } = await patientWithFile();

      await prisma.surgery.create({
        data: {
          patientId,
          procedureName: 'Rinoplasti',
          procedureCode: 'RHINOPLASTY',
          performedAt: new Date('2026-11-02T09:00:00.000Z'),
        },
      });

      const body = (await form(token).expect(200)).body as {
        id: string;
        version: number;
        body: string;
      };

      expect(body.id).toBe('treatment-consent');
      expect(body.version).toBe(1);
      expect(body.body).toContain('Rinoplasti');
      expect(body.body).not.toContain('{{islem}}');
      // The note to whoever maintains the file does not reach the patient
      // about to sign it.
      expect(body.body).not.toContain('avukat incelemesinden');
    });

    /// Its own answer, because "no wording published" and "your operation is
    /// not recorded" are different problems with different people to chase.
    it('refuses when the clinic has not recorded the operation', async () => {
      const { token } = await patientWithFile();

      const response = await form(token).expect(404);

      expect((response.body as { message: string }).message).toBe('PROCEDURE_NOT_RECORDED');
    });

    it('records the version that was on screen when it is signed', async () => {
      const { token, patientId } = await patientWithFile();

      await prisma.surgery.create({
        data: {
          patientId,
          procedureName: 'Rinoplasti',
          performedAt: new Date('2026-11-02T09:00:00.000Z'),
        },
      });

      const shown = (await form(token).expect(200)).body as { version: number; body: string };

      const created = await request(server)
        .post('/me/consents')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: ConsentType.TREATMENT,
          version: shown.version,
          documentText: shown.body,
          signature: PNG_BASE64,
        })
        .expect(201);

      const stored = await prisma.consent.findUniqueOrThrow({
        where: { id: (created.body as ConsentBody).id },
      });

      expect(stored.version).toBe(shown.version);
      expect(stored.documentText).toContain('Rinoplasti');
    });
  });
});
