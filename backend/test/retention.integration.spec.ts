import { PrismaClient, Sex, UserStatus, Role } from '@prisma/client';
import { hashPassword } from '../src/crypto/hashing';
import { sweepExpired } from '../src/retention/retention';
import type { PrismaService } from '../src/infra/prisma.service';

const prisma = new PrismaClient();

/**
 * The periodic destruction the retention policy promises (KVKK m.7).
 *
 * The tests that matter here are the ones about what the sweep leaves alone. A
 * destruction job that is too eager destroys evidence a clinic is required by
 * law to keep, and that failure is silent until somebody asks for the record.
 */
describe('retention sweep', () => {
  const userIds: string[] = [];
  const patientIds: string[] = [];

  const service = prisma as unknown as PrismaService;
  const NOW = new Date('2026-09-04T12:00:00Z');
  const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

  const makePatient = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        role: Role.PATIENT,
        email: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
        passwordHash: await hashPassword('correct-horse-battery-9'),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    const patient = await prisma.patient.create({
      data: {
        userId: user.id,
        mrn: `RET-${Math.random().toString(36).slice(2, 10)}`,
        firstName: 'Test',
        lastName: 'Hasta',
        birthDate: new Date('1990-05-14'),
        sex: Sex.FEMALE,
        country: 'TR',
      },
    });
    patientIds.push(patient.id);

    return patient.id;
  };

  afterAll(async () => {
    await prisma.uploadSession.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('destroys an upload session nobody ever finished', async () => {
    const patientId = await makePatient();

    const stale = await prisma.uploadSession.create({
      data: {
        patientId,
        originalName: 'scan.pdf',
        documentType: 'LAB',
        expiresAt: daysAgo(6),
        createdAt: daysAgo(30),
      },
    });

    await sweepExpired(service, NOW);

    expect(await prisma.uploadSession.findUnique({ where: { id: stale.id } })).toBeNull();
  });

  it('leaves an upload somebody is still sending', async () => {
    // A patient on hotel wifi resumes over hours, not seconds. Destroying a
    // session mid-upload loses the file and the progress with it.
    const patientId = await makePatient();

    const fresh = await prisma.uploadSession.create({
      data: {
        patientId,
        originalName: 'scan.pdf',
        documentType: 'LAB',
        expiresAt: new Date(NOW.getTime() + 86_400_000),
        createdAt: daysAgo(1),
      },
    });

    await sweepExpired(service, NOW);

    expect(await prisma.uploadSession.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });

  it('never touches a patient file, however old', async () => {
    // Medical records have a statutory minimum retention that outlives any
    // purpose test. A sweep that deleted one because nobody opened it would
    // destroy evidence the clinic is required to keep.
    const patientId = await makePatient();
    await prisma.patient.update({
      where: { id: patientId },
      data: { createdAt: daysAgo(4000) },
    });

    await sweepExpired(service, NOW);

    expect(await prisma.patient.findUnique({ where: { id: patientId } })).not.toBeNull();
  });

  it('never touches an audit log', async () => {
    // Append-only by database trigger; its expiry is a partition drop, not a
    // delete. Row-by-row deletion in an audit log defeats the log.
    const before = await prisma.auditLog.count();

    await sweepExpired(service, NOW);

    expect(await prisma.auditLog.count()).toBe(before);
  });

  it('never touches a consent record', async () => {
    // Proving a consent existed while it was relied on is the controller's
    // burden, and a deleted row proves nothing.
    const patientId = await makePatient();
    const consent = await prisma.consent.create({
      data: {
        patientId,
        type: 'PHOTO_USAGE',
        version: 1,
        signedAt: daysAgo(3000),
        revokedAt: daysAgo(2900),
      },
    });

    await sweepExpired(service, NOW);

    expect(await prisma.consent.findUnique({ where: { id: consent.id } })).not.toBeNull();

    await prisma.consent.delete({ where: { id: consent.id } });
  });

  it('reports what it destroyed rather than only that it ran', async () => {
    // "The sweep ran" is not the same claim as "the sweep destroyed nothing
    // because there was nothing to destroy", and a destruction schedule has to
    // be demonstrable.
    const outcome = await sweepExpired(service, NOW);

    // Every field present and a number. Asserted field by field rather than
    // with expect.any, which the project's type-aware lint reads as `any`.
    expect(typeof outcome.uploadSessions).toBe('number');
    expect(typeof outcome.aiJobs).toBe('number');
    expect(typeof outcome.exports).toBe('number');
    expect(typeof outcome.notifications).toBe('number');
    expect(typeof outcome.deviceSessions).toBe('number');
  });
});
