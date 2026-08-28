import { Test } from '@nestjs/testing';
import { type Patient, PatientStatus, PrismaClient, Role, Sex, UserStatus } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import type { AuthenticatedUser } from '../src/auth/decorators/current-user.decorator';
import { PatientAccessService } from '../src/authz/patient-access.service';
import { PrismaService } from '../src/infra/prisma.service';
import { PatientsService } from '../src/patients/patients.service';

interface ConflictBody {
  message: string;
  entityType: string;
  expectedVersion: number;
  currentVersion: number;
  current: { status?: string; city?: string | null };
}

/**
 * Optimistic concurrency (spec M15).
 *
 * The rule the tests exist to hold: clinical data is never silently
 * overwritten. Two people editing the same allergy list is not something an
 * algorithm should settle, so the second write is refused and a human decides.
 */
describe('optimistic locking', () => {
  const prisma = new PrismaClient();

  let patients: PatientsService;
  const userIds: string[] = [];
  const patientIds: string[] = [];

  const doctor = async (): Promise<AuthenticatedUser> => {
    const user = await prisma.user.create({
      data: {
        role: Role.DOCTOR,
        email: `lock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);
    return { id: user.id, role: Role.DOCTOR, familyId: 'test' };
  };

  const makePatient = async (actor: AuthenticatedUser): Promise<Patient> => {
    const patient = await patients.create(actor, {
      firstName: 'Ayse',
      lastName: 'Yilmaz',
      birthDate: new Date('1985-03-12'),
      sex: Sex.FEMALE,
      country: 'DE',
    });
    patientIds.push(patient.id);
    return patient;
  };

  const conflictBodyOf = (error: unknown): ConflictBody =>
    (error as { response: ConflictBody }).response;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PatientsService,
        PatientAccessService,
        AuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    patients = moduleRef.get(PatientsService);
  });

  afterAll(async () => {
    await prisma.medicalProfile.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('starts every record at version 1', async () => {
    const actor = await doctor();
    const patient = await makePatient(actor);

    expect(patient.version).toBe(1);
  });

  it('increments the version on each write', async () => {
    const actor = await doctor();
    const patient = await makePatient(actor);

    const first = await patients.update(actor, patient.id, { city: 'Berlin' }, {}, 1);
    const second = await patients.update(actor, patient.id, { city: 'Hamburg' }, {}, first.version);

    expect(first.version).toBe(2);
    expect(second.version).toBe(3);
  });

  /**
   * An edit made from a screen the user just loaded needs no version — the
   * offline queue is what replays edits old enough to have gone stale.
   */
  it('allows a write that sends no version at all', async () => {
    const actor = await doctor();
    const patient = await makePatient(actor);

    const updated = await patients.update(actor, patient.id, { city: 'Köln' });

    expect(updated.city).toBe('Köln');
    expect(updated.version).toBe(2);
  });

  it('refuses a write carrying a version the server has moved past', async () => {
    const actor = await doctor();
    const patient = await makePatient(actor);

    await patients.update(actor, patient.id, { city: 'Berlin' }, {}, 1);

    await expect(
      patients.update(actor, patient.id, { city: 'München' }, {}, 1),
    ).rejects.toThrow(/Conflict|VERSION_CONFLICT/);
  });

  /**
   * The reason the conflict carries the server's record: staff have to see
   * both sides. A conflict the user cannot inspect is one resolved by whoever
   * happened to save last.
   */
  it('reports the server’s current record with the conflict', async () => {
    const actor = await doctor();
    const patient = await makePatient(actor);

    await patients.update(actor, patient.id, { status: PatientStatus.POST_OP }, {}, 1);

    try {
      await patients.update(actor, patient.id, { status: PatientStatus.DISCHARGED }, {}, 1);
      fail('Expected the stale write to be refused');
    } catch (error) {
      const body = conflictBodyOf(error);

      expect(body.message).toBe('VERSION_CONFLICT');
      expect(body.entityType).toBe('patients');
      expect(body.expectedVersion).toBe(1);
      expect(body.currentVersion).toBe(2);
      expect(body.current.status).toBe(PatientStatus.POST_OP);
    }
  });

  /** The losing write must leave nothing behind. */
  it('does not apply any part of a refused write', async () => {
    const actor = await doctor();
    const patient = await makePatient(actor);

    await patients.update(actor, patient.id, { city: 'Berlin' }, {}, 1);
    await patients
      .update(actor, patient.id, { city: 'Roma', status: PatientStatus.DISCHARGED }, {}, 1)
      .catch(() => undefined);

    const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(row.city).toBe('Berlin');
    expect(row.status).toBe(PatientStatus.LEAD);
    expect(row.version).toBe(2);
  });

  /**
   * Two people editing the same file from different devices: whoever saves
   * first wins, and the second is told rather than overwritten.
   */
  it('lets the first of two concurrent edits through and refuses the second', async () => {
    const actor = await doctor();
    const patient = await makePatient(actor);

    // Both read version 1.
    const readVersion = patient.version;

    const results = await Promise.allSettled([
      patients.update(actor, patient.id, { city: 'Ankara' }, {}, readVersion),
      patients.update(actor, patient.id, { city: 'Izmir' }, {}, readVersion),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  describe('medical profiles', () => {
    it('creates at version 1 and increments from there', async () => {
      const actor = await doctor();
      const patient = await makePatient(actor);

      await patients.upsertMedicalProfile(actor, patient.id, { bloodType: '0 Rh+' });
      const created = await prisma.medicalProfile.findUniqueOrThrow({
        where: { patientId: patient.id },
      });
      expect(created.version).toBe(1);

      await patients.upsertMedicalProfile(actor, patient.id, { bloodType: 'A Rh+' }, {}, 1);
      const updated = await prisma.medicalProfile.findUniqueOrThrow({
        where: { patientId: patient.id },
      });
      expect(updated.version).toBe(2);
    });

    /** An allergy list is exactly the kind of field that must not be merged. */
    it('refuses a stale edit to a medical profile', async () => {
      const actor = await doctor();
      const patient = await makePatient(actor);

      await patients.upsertMedicalProfile(actor, patient.id, { allergies: ['penisilin'] });
      await patients.upsertMedicalProfile(actor, patient.id, { allergies: ['penisilin', 'aspirin'] }, {}, 1);

      await expect(
        patients.upsertMedicalProfile(actor, patient.id, { allergies: [] }, {}, 1),
      ).rejects.toThrow(/Conflict|VERSION_CONFLICT/);

      const row = await prisma.medicalProfile.findUniqueOrThrow({
        where: { patientId: patient.id },
      });
      expect(row.allergies).toEqual(['penisilin', 'aspirin']);
    });
  });
});
