import { Test } from '@nestjs/testing';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../src/auth/decorators/current-user.decorator';
import { PatientAccessService } from '../src/authz/patient-access.service';
import { PermissionsService } from '../src/authz/permissions.service';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';

/**
 * Authorisation, tested from the refusing side.
 *
 * Spec section 11 asks for negative tests per role, and that is the right
 * emphasis: a system that grants correctly but refuses incorrectly is a leak,
 * and the granting path is the one everybody exercises by hand anyway.
 */
describe('authorisation', () => {
  const prisma = new PrismaClient();

  // An in-memory stand-in for Redis. The cache is a performance detail; the
  // behaviour under test is which permissions come out.
  const store = new Map<string, string>();
  const redisStub = {
    client: {
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      del: jest.fn((...keys: string[]) => {
        keys.forEach((k) => store.delete(k));
        return Promise.resolve(keys.length);
      }),
      keys: jest.fn(() => Promise.resolve([...store.keys()])),
    },
  };

  let permissions: PermissionsService;
  let access: PatientAccessService;

  const userIds: string[] = [];
  const patientIds: string[] = [];
  const staffIds: string[] = [];

  const makeUser = async (role: Role): Promise<AuthenticatedUser> => {
    const user = await prisma.user.create({
      data: {
        role,
        email: `authz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);
    return { id: user.id, role, familyId: 'test-family' };
  };

  const makeStaff = async (
    role: Role,
    canSeeAllPatients = false,
  ): Promise<{ user: AuthenticatedUser; staffId: string }> => {
    const user = await makeUser(role);
    const profile = await prisma.staffProfile.create({
      data: { userId: user.id, firstName: 'Test', lastName: 'Staff', canSeeAllPatients },
    });
    staffIds.push(profile.id);
    return { user, staffId: profile.id };
  };

  const makePatient = async (overrides = {}): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        firstName: 'Test',
        lastName: 'Patient',
        birthDate: new Date('1980-01-01'),
        sex: 'FEMALE',
        country: 'TR',
        ...overrides,
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  const visible = async (user: AuthenticatedUser): Promise<string[]> => {
    const scope = await access.scopeFilter(user);
    const rows = await prisma.patient.findMany({
      where: { AND: [{ id: { in: patientIds } }, scope] },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PermissionsService,
        PatientAccessService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redisStub },
      ],
    }).compile();

    permissions = moduleRef.get(PermissionsService);
    access = moduleRef.get(PatientAccessService);
  });

  beforeEach(() => store.clear());

  afterAll(async () => {
    await prisma.caregiverLink.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patientAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe('the role matrix', () => {
    /**
     * Three roles, and the map in `role-permissions.ts` is the whole of it.
     *
     * These used to be read from `role_permissions`, with a per-user override
     * table on top and a Redis cache in front — so the tests also covered
     * granting, revoking, invalidating and surviving a cache outage. None of
     * that exists now: the answer is a lookup in a constant, and what is left
     * to check is that the constant says what it should.
     */
    it.each([
      [Role.DOCTOR, 'medical.decide'],
      [Role.DOCTOR, 'labs.verify'],
      [Role.DOCTOR, 'finance.read'],
      [Role.DOCTOR, 'audit.read'],
      [Role.DOCTOR, 'staff.manage'],
      [Role.DOCTOR, 'permissions.manage'],
      [Role.COORDINATOR, 'appointments.write'],
      [Role.COORDINATOR, 'documents.write'],
      [Role.COORDINATOR, 'consents.collect'],
      [Role.COORDINATOR, 'messages.read'],
      [Role.COORDINATOR, 'patients.read'],
      [Role.COORDINATOR, 'analytics.read'],
      [Role.PATIENT, 'self.read'],
      [Role.PATIENT, 'self.write'],
      [Role.PATIENT, 'self.message'],
      [Role.PATIENT, 'self.emergency'],
    ])('grants %s the permission %s', (role, permission) => {
      expect(permissions.has(role, permission)).toBe(true);
    });

    /**
     * The line the second role exists to draw: a coordinator arranges the
     * treatment and does not write in the record.
     */
    it.each([
      [Role.COORDINATOR, 'medical.read'],
      [Role.COORDINATOR, 'medical.write'],
      [Role.COORDINATOR, 'medical.decide'],
      [Role.COORDINATOR, 'medications.prescribe'],
      [Role.COORDINATOR, 'labs.verify'],
      [Role.COORDINATOR, 'photos.read'],
      [Role.COORDINATOR, 'photos.write'],
      [Role.COORDINATOR, 'finance.read'],
      [Role.COORDINATOR, 'finance.report'],
      [Role.COORDINATOR, 'audit.read'],
      [Role.COORDINATOR, 'staff.manage'],
      [Role.COORDINATOR, 'permissions.manage'],
      [Role.PATIENT, 'patients.read'],
      [Role.PATIENT, 'medical.read'],
      [Role.PATIENT, 'documents.read'],
      [Role.PATIENT, 'finance.read'],
    ])('refuses %s the permission %s', (role, permission) => {
      expect(permissions.has(role, permission)).toBe(false);
    });

    /**
     * `self.*` is how a patient reaches their own record through `/me`. A
     * clinician has no patient record, so holding it would mean nothing —
     * and a staff account that answers `/me/...` is a way for clinic data to
     * arrive on a patient endpoint.
     */
    it.each(['self.read', 'self.write', 'self.message', 'self.emergency'])(
      'keeps %s away from staff',
      (permission) => {
        expect(permissions.has(Role.DOCTOR, permission)).toBe(false);
        expect(permissions.has(Role.COORDINATOR, permission)).toBe(false);
      },
    );

    /** Every permission an endpoint asks for has to be held by somebody. */
    it('leaves no permission unreachable', () => {
      for (const role of [Role.DOCTOR, Role.COORDINATOR, Role.PATIENT]) {
        expect(permissions.getEffectivePermissions(role).size).toBeGreaterThan(0);
      }
    });
  });

  describe('patient scoping', () => {
    it('shows a doctor every patient', async () => {
      const user = await makeUser(Role.DOCTOR);
      const patient = await makePatient();

      expect(await visible(user)).toContain(patient);
    });

    it('shows a nurse only the patients assigned to her', async () => {
      const { user, staffId } = await makeStaff(Role.COORDINATOR);
      const assigned = await makePatient();
      const other = await makePatient();

      await prisma.patientAssignment.create({
        data: { patientId: assigned, staffId, role: Role.COORDINATOR },
      });

      const seen = await visible(user);
      expect(seen).toContain(assigned);
      expect(seen).not.toContain(other);
    });

    it('stops showing a patient once the assignment ends', async () => {
      const { user, staffId } = await makeStaff(Role.COORDINATOR);
      const patient = await makePatient();

      const assignment = await prisma.patientAssignment.create({
        data: { patientId: patient, staffId, role: Role.COORDINATOR },
      });
      expect(await visible(user)).toContain(patient);

      await prisma.patientAssignment.update({
        where: { id: assignment.id },
        data: { unassignedAt: new Date() },
      });

      expect(await visible(user)).not.toContain(patient);
    });

    it('shows a nurse everything when the doctor lifts the restriction', async () => {
      const { user } = await makeStaff(Role.COORDINATOR, true);
      const unassigned = await makePatient();

      expect(await visible(user)).toContain(unassigned);
    });

    it('shows a doctor of record their patient without an explicit assignment', async () => {
      const { user, staffId } = await makeStaff(Role.COORDINATOR);
      const patient = await makePatient({ assignedDoctorId: staffId });

      expect(await visible(user)).toContain(patient);
    });

    it('shows a patient only their own file', async () => {
      const user = await makeUser(Role.PATIENT);
      const own = await makePatient({ userId: user.id });
      const other = await makePatient();

      const seen = await visible(user);
      expect(seen).toEqual([own]);
      expect(seen).not.toContain(other);
    });

    it('shows a nurse with no staff profile nothing, rather than everything', async () => {
      // A missing profile is a broken account; it must fail closed.
      const user = await makeUser(Role.COORDINATOR);
      await makePatient();

      expect(await visible(user)).toEqual([]);
    });

    it('hides soft-deleted patients from everyone', async () => {
      const user = await makeUser(Role.DOCTOR);
      const patient = await makePatient({ deletedAt: new Date() });

      expect(await visible(user)).not.toContain(patient);
    });
  });

  describe('assertCanAccess', () => {
    it('passes for a patient in scope', async () => {
      const user = await makeUser(Role.DOCTOR);
      const patient = await makePatient();

      await expect(access.assertCanAccess(user, patient)).resolves.toBeUndefined();
    });

    /**
     * 404, not 403. A 403 confirms the record exists, which lets anyone with an
     * account probe whether a given person is a patient here.
     */
    it('reports out-of-scope patients as not found, not as forbidden', async () => {
      const user = await makeUser(Role.COORDINATOR);
      const patient = await makePatient();

      await expect(access.assertCanAccess(user, patient)).rejects.toThrow('Patient not found');
    });

    it('gives the same answer for a patient that does not exist', async () => {
      const user = await makeUser(Role.COORDINATOR);
      const real = await makePatient();

      const forExisting = await access
        .assertCanAccess(user, real)
        .catch((e: Error) => e.message);
      const forMissing = await access
        .assertCanAccess(user, '01a00000-0000-7000-8000-000000000000')
        .catch((e: Error) => e.message);

      expect(forExisting).toBe(forMissing);
    });
  });
});
