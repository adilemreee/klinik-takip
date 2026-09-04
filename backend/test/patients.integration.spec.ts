import { Test } from '@nestjs/testing';
import {
  AuditAction,
  type Patient,
  PatientStatus,
  PrismaClient,
  Role,
  Sex,
  UserStatus,
} from '@prisma/client';
import type { CreatePatientDto } from '../src/patients/dto/patient.dto';
import { AuditService } from '../src/audit/audit.service';
import type { AuthenticatedUser } from '../src/auth/decorators/current-user.decorator';
import { PatientAccessService } from '../src/authz/patient-access.service';
import { PrismaService } from '../src/infra/prisma.service';
import { PatientsService } from '../src/patients/patients.service';

describe('patient records', () => {
  const prisma = new PrismaClient();

  let patients: PatientsService;

  const userIds: string[] = [];
  const staffIds: string[] = [];
  const patientIds: string[] = [];

  const makeUser = async (role: Role): Promise<AuthenticatedUser> => {
    const user = await prisma.user.create({
      data: {
        role,
        email: `pat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);
    return { id: user.id, role, familyId: 'test' };
  };

  const makeStaff = async (
    role: Role,
    canSeeAllPatients = false,
  ): Promise<{ user: AuthenticatedUser; staffId: string }> => {
    const user = await makeUser(role);
    const profile = await prisma.staffProfile.create({
      data: { userId: user.id, firstName: 'T', lastName: 'S', canSeeAllPatients },
    });
    staffIds.push(profile.id);
    return { user, staffId: profile.id };
  };

  const basePatient = {
    firstName: 'Ayşe',
    lastName: 'Yılmaz',
    birthDate: new Date('1985-03-12'),
    sex: Sex.FEMALE,
    country: 'de',
  };

  const create = async (
    actor: AuthenticatedUser,
    overrides: Partial<CreatePatientDto> = {},
  ): Promise<Patient> => {
    const patient = await patients.create(actor, { ...basePatient, ...overrides });
    patientIds.push(patient.id);
    return patient;
  };

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
    await prisma.patientAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.medicalProfile.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.surgery.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe('creating', () => {
    it('allocates a file number and normalises the country code', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor);

      expect(patient.mrn).toMatch(/^\d{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
      expect(patient.country).toBe('DE');
      expect(patient.status).toBe(PatientStatus.LEAD);
    });

    it('gives every patient a distinct file number', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const created = await Promise.all([create(doctor), create(doctor), create(doctor)]);

      expect(new Set(created.map((p) => p.mrn)).size).toBe(3);
    });

    /** Spec section 13: the record and the change are written together. */
    it('writes the audit entry in the same transaction', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor);

      const entries = await prisma.auditLog.findMany({
        where: { entityId: patient.id, action: AuditAction.CREATE },
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]?.actorId).toBe(doctor.id);
      expect(entries[0]?.patientId).toBe(patient.id);
    });

    it('leaves no patient behind when the transaction fails', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const before = await prisma.patient.count();

      await expect(
        // A non-existent agency violates the foreign key, failing the whole
        // transaction — including the audit insert.
        patients.create(doctor, {
          ...basePatient,
          agencyId: '01a00000-0000-7000-8000-000000000000',
        }),
      ).rejects.toThrow();

      expect(await prisma.patient.count()).toBe(before);
    });
  });

  describe('search', () => {
    it('finds a Turkish name typed without its diacritics', async () => {
      // The failure this replaces: a coordinator on a keyboard without a
      // Turkish layout searched "Yilmaz", got nothing, and had every reason to
      // conclude the patient was not in the system.
      const doctor = await makeUser(Role.DOCTOR);
      await create(doctor, { firstName: 'Ayşe', lastName: 'Yılmaz' });

      const plain = await patients.search(doctor, { q: 'yilmaz' });
      const accented = await patients.search(doctor, { q: 'yılmaz' });

      expect(plain.items.map((p) => p.lastName)).toContain('Yılmaz');
      expect(accented.items.map((p) => p.lastName)).toContain('Yılmaz');
    });

    it('finds a diacritic name typed with its diacritics too', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      await create(doctor, { firstName: 'Çağlar', lastName: 'Öztürk' });

      for (const term of ['ozturk', 'öztürk', 'caglar', 'çağlar', 'OZTURK']) {
        const found = await patients.search(doctor, { q: term });

        expect(found.items.map((p) => p.lastName)).toContain('Öztürk');
      }
    });

    it('still finds by file number', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor);

      const found = await patients.search(doctor, { q: patient.mrn });

      expect(found.items.map((p) => p.id)).toContain(patient.id);
    });

    it('follows a corrected spelling', async () => {
      // A name fixed after a typo must be findable by the correction, not only
      // by the mistake.
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor, { firstName: 'Aysse', lastName: 'Yilmaz' });

      await patients.update(doctor, patient.id, { firstName: 'Ayşe' });

      const found = await patients.search(doctor, { q: 'ayse' });

      expect(found.items.map((p) => p.id)).toContain(patient.id);
    });

    it('does not match somebody else', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      await create(doctor, { firstName: 'Ayşe', lastName: 'Yılmaz' });

      const found = await patients.search(doctor, { q: 'zzzznobody' });

      expect(found.items).toHaveLength(0);
    });
  });

  describe('scoped reads', () => {
    it('lets a doctor open any file', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor);

      expect((await patients.findOne(doctor, patient.id)).id).toBe(patient.id);
    });

    it('hides an unassigned patient from a nurse', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const { user: nurse } = await makeStaff(Role.NURSE);
      const patient = await create(doctor);

      await expect(patients.findOne(nurse, patient.id)).rejects.toThrow('Patient not found');
    });

    it('opens the file to a nurse once she is assigned', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const { user: nurse, staffId } = await makeStaff(Role.NURSE);
      const patient = await create(doctor);

      await patients.assignStaff(doctor, patient.id, { staffId, role: Role.NURSE });

      expect((await patients.findOne(nurse, patient.id)).id).toBe(patient.id);
    });

    it('closes it again when the assignment ends', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const { user: nurse, staffId } = await makeStaff(Role.NURSE);
      const patient = await create(doctor);

      await patients.assignStaff(doctor, patient.id, { staffId, role: Role.NURSE });
      await patients.unassignStaff(doctor, patient.id, staffId);

      await expect(patients.findOne(nurse, patient.id)).rejects.toThrow('Patient not found');
    });

    it('shows finance nothing', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const finance = await makeUser(Role.FINANCE);
      const patient = await create(doctor);

      await expect(patients.findOne(finance, patient.id)).rejects.toThrow('Patient not found');
    });

    /**
     * Out of scope and non-existent must be indistinguishable, or an account
     * can probe whether a given person is a patient here.
     */
    it('answers identically for a hidden patient and a missing one', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const { user: nurse } = await makeStaff(Role.NURSE);
      const patient = await create(doctor);

      const hidden = await patients.findOne(nurse, patient.id).catch((e: Error) => e.message);
      const missing = await patients
        .findOne(nurse, '01a00000-0000-7000-8000-000000000000')
        .catch((e: Error) => e.message);

      expect(hidden).toBe(missing);
    });
  });

  describe('search', () => {
    it('finds a patient by partial surname', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor, { lastName: `Zimmermann${Date.now()}` });

      const page = await patients.search(doctor, { q: 'immermann' });

      expect(page.items.map((p) => p.id)).toContain(patient.id);
    });

    it('finds a patient by file number', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor);

      const page = await patients.search(doctor, { q: patient.mrn });

      expect(page.items.map((p) => p.id)).toEqual([patient.id]);
    });

    it('ignores case', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const unique = `Kowalski${Date.now()}`;
      const patient = await create(doctor, { lastName: unique });

      const page = await patients.search(doctor, { q: unique.toLowerCase() });

      expect(page.items.map((p) => p.id)).toContain(patient.id);
    });

    it('filters by country', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const german = await create(doctor, { country: 'de' });
      const british = await create(doctor, { country: 'gb' });

      const page = await patients.search(doctor, { country: 'DE', limit: 100 });
      const ids = page.items.map((p) => p.id);

      expect(ids).toContain(german.id);
      expect(ids).not.toContain(british.id);
    });

    it('filters by procedure and surgery date', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor);
      const other = await create(doctor);

      await prisma.surgery.create({
        data: {
          patientId: patient.id,
          procedureName: 'Rhinoplasty',
          performedAt: new Date('2026-05-10T09:00:00Z'),
        },
      });

      const page = await patients.search(doctor, {
        procedure: 'rhino',
        surgeryFrom: new Date('2026-05-01T00:00:00Z'),
        surgeryTo: new Date('2026-05-31T00:00:00Z'),
        limit: 100,
      });
      const ids = page.items.map((p) => p.id);

      expect(ids).toContain(patient.id);
      expect(ids).not.toContain(other.id);
    });

    /** A nurse searching must not reach outside her assignments. */
    it('confines a nurse to her own patients', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const { user: nurse, staffId } = await makeStaff(Role.NURSE);
      const unique = `Scoped${Date.now()}`;

      const mine = await create(doctor, { lastName: unique });
      const theirs = await create(doctor, { lastName: unique });
      await patients.assignStaff(doctor, mine.id, { staffId, role: Role.NURSE });

      const page = await patients.search(nurse, { q: unique, limit: 100 });
      const ids = page.items.map((p) => p.id);

      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);
    });

    it('pages with a cursor and does not repeat rows', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const unique = `Paged${Date.now()}`;
      for (let i = 0; i < 5; i += 1) {
        await create(doctor, { lastName: unique });
      }

      const first = await patients.search(doctor, { q: unique, limit: 2 });
      const second = await patients.search(doctor, {
        q: unique,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });

      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toEqual(expect.any(String));
      const firstIds = first.items.map((p) => p.id);
      expect(second.items.every((p) => !firstIds.includes(p.id))).toBe(true);
    });

    it('stops returning a cursor on the last page', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const unique = `Last${Date.now()}`;
      await create(doctor, { lastName: unique });

      const page = await patients.search(doctor, { q: unique, limit: 10 });

      expect(page.nextCursor).toBeNull();
    });
  });

  describe('updating', () => {
    it('records what changed', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor);

      await patients.update(doctor, patient.id, { status: PatientStatus.POST_OP, city: 'Berlin' });

      const entry = await prisma.auditLog.findFirst({
        where: { entityId: patient.id, action: AuditAction.UPDATE },
        orderBy: { id: 'desc' },
      });

      expect((entry?.before as { status?: string })?.status).toBe(PatientStatus.LEAD);
      expect((entry?.after as { status?: string })?.status).toBe(PatientStatus.POST_OP);
    });

    it('refuses to update a patient the caller cannot see', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const { user: nurse } = await makeStaff(Role.NURSE);
      const patient = await create(doctor);

      await expect(
        patients.update(nurse, patient.id, { city: 'Hamburg' }),
      ).rejects.toThrow('Patient not found');
    });

    it('stores a medical profile and records it', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor);

      await patients.upsertMedicalProfile(doctor, patient.id, {
        bloodType: '0 Rh+',
        allergies: ['penisilin'],
        chronicConditions: ['hipertansiyon'],
        smoking: false,
      });

      const profile = await prisma.medicalProfile.findUnique({ where: { patientId: patient.id } });
      expect(profile?.allergies).toEqual(['penisilin']);

      const entry = await prisma.auditLog.findFirst({
        where: { patientId: patient.id, entityType: 'medical_profiles' },
      });
      expect(entry).toBeDefined();
    });
  });

  describe('assignment', () => {
    /** Assignment decides who can see the file, so it is a permission change. */
    it('records an assignment as a permission change', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const { staffId } = await makeStaff(Role.NURSE);
      const patient = await create(doctor);

      await patients.assignStaff(doctor, patient.id, { staffId, role: Role.NURSE });

      const entry = await prisma.auditLog.findFirst({
        where: { patientId: patient.id, action: AuditAction.PERMISSION_CHANGE },
      });

      expect(entry?.entityType).toBe('patient_assignments');
    });

    it('is idempotent', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const { staffId } = await makeStaff(Role.NURSE);
      const patient = await create(doctor);

      await patients.assignStaff(doctor, patient.id, { staffId, role: Role.NURSE });
      await patients.assignStaff(doctor, patient.id, { staffId, role: Role.NURSE });

      const active = await prisma.patientAssignment.count({
        where: { patientId: patient.id, staffId, unassignedAt: null },
      });
      expect(active).toBe(1);
    });

    it('reports an unassignment that has nothing to end', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const { staffId } = await makeStaff(Role.NURSE);
      const patient = await create(doctor);

      await expect(patients.unassignStaff(doctor, patient.id, staffId)).rejects.toThrow(
        'Assignment not found',
      );
    });
  });

  describe('deletion', () => {
    /**
     * Clinical records have legal retention periods, so a removal request
     * deactivates the file rather than destroying it (spec section 8).
     */
    it('is a soft delete that keeps the row', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const patient = await create(doctor);

      await patients.softDelete(doctor, patient.id);

      const row = await prisma.patient.findUnique({ where: { id: patient.id } });
      expect(row).not.toBeNull();
      expect(row?.deletedAt).toBeInstanceOf(Date);
    });

    it('hides the patient from reads and searches afterwards', async () => {
      const doctor = await makeUser(Role.DOCTOR);
      const unique = `Deleted${Date.now()}`;
      const patient = await create(doctor, { lastName: unique });

      await patients.softDelete(doctor, patient.id);

      await expect(patients.findOne(doctor, patient.id)).rejects.toThrow('Patient not found');
      const page = await patients.search(doctor, { q: unique });
      expect(page.items).toEqual([]);
    });
  });
});
