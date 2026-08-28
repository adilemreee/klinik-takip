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
    await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe('the role matrix', () => {
    it.each([
      [Role.NURSE, 'finance.read'],
      [Role.NURSE, 'finance.write'],
      [Role.NURSE, 'finance.report'],
      [Role.NURSE, 'staff.manage'],
      [Role.NURSE, 'permissions.manage'],
      [Role.NURSE, 'audit.read'],
    ])('refuses %s the permission %s', async (role, permission) => {
      const user = await makeUser(role);

      expect(await permissions.has(user.id, role, permission)).toBe(false);
    });

    it.each([
      [Role.FINANCE, 'medical.read'],
      [Role.FINANCE, 'medical.write'],
      [Role.FINANCE, 'patients.read'],
      [Role.FINANCE, 'labs.verify'],
      [Role.FINANCE, 'photos.read'],
      [Role.FINANCE, 'messages.read'],
    ])('refuses %s the permission %s', async (role, permission) => {
      const user = await makeUser(role);

      expect(await permissions.has(user.id, role, permission)).toBe(false);
    });

    it.each([
      [Role.COORDINATOR, 'medical.decide'],
      [Role.COORDINATOR, 'finance.read'],
      [Role.COORDINATOR, 'medications.prescribe'],
      [Role.PATIENT, 'patients.read'],
      [Role.PATIENT, 'medical.read'],
      [Role.PATIENT, 'finance.read'],
      [Role.CAREGIVER, 'medical.read'],
      [Role.CAREGIVER, 'documents.read'],
    ])('refuses %s the permission %s', async (role, permission) => {
      const user = await makeUser(role);

      expect(await permissions.has(user.id, role, permission)).toBe(false);
    });

    it.each([
      [Role.DOCTOR, 'medical.decide'],
      [Role.DOCTOR, 'finance.read'],
      [Role.NURSE, 'medical.write'],
      [Role.COORDINATOR, 'appointments.write'],
      [Role.FINANCE, 'finance.report'],
      [Role.PATIENT, 'self.read'],
    ])('grants %s the permission %s', async (role, permission) => {
      const user = await makeUser(role);

      expect(await permissions.has(user.id, role, permission)).toBe(true);
    });

    it('gives the doctor everything except the permission matrix itself', async () => {
      const user = await makeUser(Role.DOCTOR);

      expect(await permissions.has(user.id, Role.DOCTOR, 'permissions.manage')).toBe(false);
    });
  });

  describe('per-user overrides', () => {
    it('can grant something the role does not carry', async () => {
      const user = await makeUser(Role.NURSE);
      await prisma.userPermission.create({
        data: { userId: user.id, permissionCode: 'finance.read', granted: true },
      });

      expect(await permissions.has(user.id, Role.NURSE, 'finance.read')).toBe(true);
    });

    /** The direction that matters: taking access away has to work. */
    it('can revoke something the role does carry', async () => {
      const user = await makeUser(Role.NURSE);
      await prisma.userPermission.create({
        data: { userId: user.id, permissionCode: 'patients.read', granted: false },
      });

      expect(await permissions.has(user.id, Role.NURSE, 'patients.read')).toBe(false);
    });

    it('takes effect immediately once the cache is invalidated', async () => {
      const user = await makeUser(Role.NURSE);

      expect(await permissions.has(user.id, Role.NURSE, 'patients.read')).toBe(true);

      await prisma.userPermission.create({
        data: { userId: user.id, permissionCode: 'patients.read', granted: false },
      });
      await permissions.invalidate(user.id);

      expect(await permissions.has(user.id, Role.NURSE, 'patients.read')).toBe(false);
    });

    it('falls back to the database when the cache is unavailable', async () => {
      const user = await makeUser(Role.NURSE);
      redisStub.client.get.mockRejectedValueOnce(new Error('redis down'));

      // Redis being down must not lock everyone out.
      expect(await permissions.has(user.id, Role.NURSE, 'patients.read')).toBe(true);
    });
  });

  describe('patient scoping', () => {
    it('shows a doctor every patient', async () => {
      const user = await makeUser(Role.DOCTOR);
      const patient = await makePatient();

      expect(await visible(user)).toContain(patient);
    });

    it('shows a nurse only the patients assigned to her', async () => {
      const { user, staffId } = await makeStaff(Role.NURSE);
      const assigned = await makePatient();
      const other = await makePatient();

      await prisma.patientAssignment.create({
        data: { patientId: assigned, staffId, role: Role.NURSE },
      });

      const seen = await visible(user);
      expect(seen).toContain(assigned);
      expect(seen).not.toContain(other);
    });

    it('stops showing a patient once the assignment ends', async () => {
      const { user, staffId } = await makeStaff(Role.NURSE);
      const patient = await makePatient();

      const assignment = await prisma.patientAssignment.create({
        data: { patientId: patient, staffId, role: Role.NURSE },
      });
      expect(await visible(user)).toContain(patient);

      await prisma.patientAssignment.update({
        where: { id: assignment.id },
        data: { unassignedAt: new Date() },
      });

      expect(await visible(user)).not.toContain(patient);
    });

    it('shows a nurse everything when the doctor lifts the restriction', async () => {
      const { user } = await makeStaff(Role.NURSE, true);
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

    it('shows a caregiver the linked patient while consent stands', async () => {
      const user = await makeUser(Role.CAREGIVER);
      const patient = await makePatient();

      await prisma.caregiverLink.create({
        data: { patientId: patient, caregiverUserId: user.id, consentedAt: new Date() },
      });

      expect(await visible(user)).toContain(patient);
    });

    /** Consent is revocable, and revoking it has to actually close the door. */
    it('stops showing a caregiver the patient once consent is revoked', async () => {
      const user = await makeUser(Role.CAREGIVER);
      const patient = await makePatient();

      const link = await prisma.caregiverLink.create({
        data: { patientId: patient, caregiverUserId: user.id, consentedAt: new Date() },
      });
      expect(await visible(user)).toContain(patient);

      await prisma.caregiverLink.update({
        where: { id: link.id },
        data: { revokedAt: new Date() },
      });

      expect(await visible(user)).not.toContain(patient);
    });

    it('shows finance no patient files at all', async () => {
      const user = await makeUser(Role.FINANCE);
      await makePatient();

      expect(await visible(user)).toEqual([]);
    });

    it('shows a nurse with no staff profile nothing, rather than everything', async () => {
      // A missing profile is a broken account; it must fail closed.
      const user = await makeUser(Role.NURSE);
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
      const user = await makeUser(Role.FINANCE);
      const patient = await makePatient();

      await expect(access.assertCanAccess(user, patient)).rejects.toThrow('Patient not found');
    });

    it('gives the same answer for a patient that does not exist', async () => {
      const user = await makeUser(Role.FINANCE);
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
