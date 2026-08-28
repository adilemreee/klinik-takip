import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuditAction, type AuditLog, PrismaClient, Role, UserStatus } from '@prisma/client';
import { AuditAnomalyService } from '../src/audit/audit-anomaly.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { InvitationService } from '../src/auth/invitation.service';
import { TokenService } from '../src/auth/token.service';
import { TotpService } from '../src/auth/totp.service';
import { EncryptionService } from '../src/crypto/encryption.service';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';

describe('audit trail', () => {
  const prisma = new PrismaClient();

  const settings: Record<string, unknown> = {
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    TOTP_ISSUER: 'Klinik Takip',
    ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'),
    LOGIN_MAX_ATTEMPTS: 5,
    LOGIN_LOCKOUT_MINUTES: 15,
  };

  let auth: AuthService;
  let audit: AuditService;
  let anomalies: AuditAnomalyService;

  const userIds: string[] = [];
  const patientIds: string[] = [];
  const PASSWORD = 'correct-horse-battery-9';

  const makeUser = async (role: Role): Promise<{ id: string; email: string }> => {
    const email = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);
    return { id: user.id, email };
  };

  const entriesFor = (actorId: string): Promise<AuditLog[]> =>
    prisma.auditLog.findMany({ where: { actorId }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        AuditService,
        AuditAnomalyService,
        TokenService,
        TotpService,
        InvitationService,
        EncryptionService,
        JwtService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (key: string) => settings[key] } },
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
    audit = moduleRef.get(AuditService);
    anomalies = moduleRef.get(AuditAnomalyService);
  });

  afterAll(async () => {
    // audit_logs rows are deliberately NOT cleaned up — the table refuses
    // deletion by design. Tests scope their assertions by actor instead.
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe('authentication events', () => {
    it('records a successful login', async () => {
      const user = await makeUser(Role.PATIENT);
      await auth.login(user.email, PASSWORD, undefined, { ipAddress: '203.0.113.9' });

      const entries = await entriesFor(user.id);
      const login = entries.find((e) => e.action === AuditAction.LOGIN);

      expect(login).toBeDefined();
      expect(login?.entityType).toBe('auth');
      expect(login?.actorRole).toBe(Role.PATIENT);
      expect(login?.ipAddress).toBe('203.0.113.9');
    });

    it('records a failed login with the reason', async () => {
      const user = await makeUser(Role.PATIENT);
      await auth.login(user.email, 'wrong-password-x', undefined, {}).catch(() => undefined);

      const entries = await entriesFor(user.id);
      const failure = entries.find((e) => e.action === AuditAction.LOGIN_FAILED);

      expect(failure).toBeDefined();
      expect(failure?.after).toMatchObject({ reason: 'bad_password' });
    });

    it('distinguishes a lockout from a wrong password', async () => {
      const user = await makeUser(Role.PATIENT);

      for (let i = 0; i < 5; i += 1) {
        await auth.login(user.email, 'wrong-password-x', undefined, {}).catch(() => undefined);
      }
      await auth.login(user.email, PASSWORD, undefined, {}).catch(() => undefined);

      const reasons = (await entriesFor(user.id))
        .filter((e) => e.action === AuditAction.LOGIN_FAILED)
        .map((e) => (e.after as { reason?: string } | null)?.reason);

      expect(reasons).toContain('bad_password');
      expect(reasons).toContain('locked');
    });

    /**
     * An attempt against an address that is not registered here must not write
     * that address into a table we keep for years.
     */
    it('records an unknown-account attempt without storing the attempted address', async () => {
      const probe = `does-not-exist-${randomUUID()}@test.local`;
      await auth.login(probe, PASSWORD, undefined, {}).catch(() => undefined);

      const recent = await prisma.auditLog.findMany({
        where: { action: AuditAction.LOGIN_FAILED, actorId: null },
        orderBy: { id: 'desc' },
        take: 5,
      });

      expect(recent.some((e) => (e.after as { reason?: string } | null)?.reason === 'unknown_account')).toBe(true);
      expect(JSON.stringify(recent)).not.toContain(probe);
    });

    it('records a password change without recording the password', async () => {
      const user = await makeUser(Role.PATIENT);
      await auth.changePassword(user.id, PASSWORD, 'a-brand-new-passphrase-77');

      const entries = await entriesFor(user.id);
      const change = entries.find((e) => e.action === AuditAction.UPDATE);

      expect(change?.after).toMatchObject({ passwordChanged: true });
      expect(JSON.stringify(entries)).not.toContain('a-brand-new-passphrase-77');
    });
  });

  describe('immutability in practice', () => {
    it('cannot be edited or deleted even by the application itself', async () => {
      const actorId = (await makeUser(Role.DOCTOR)).id;
      await audit.record({ actorId, action: AuditAction.READ, entityType: 'patients' });

      const [entry] = await entriesFor(actorId);

      await expect(
        prisma.auditLog.update({ where: { id: entry!.id }, data: { entityType: 'tampered' } }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.auditLog.delete({ where: { id: entry!.id } }),
      ).rejects.toThrow(/append-only/);

      const after = await prisma.auditLog.findUnique({ where: { id: entry!.id } });
      expect(after?.entityType).toBe('patients');
    });
  });

  describe('anomaly detection', () => {
    const seedReads = async (
      actorId: string,
      role: Role,
      patients: string[],
      at: Date,
    ): Promise<void> => {
      for (const patientId of patients) {
        await prisma.$executeRaw`
          INSERT INTO audit_logs (id, actor_id, actor_role, action, entity_type, patient_id, created_at)
          VALUES (gen_random_uuid(), ${actorId}::uuid, ${role}::"Role", 'READ'::"AuditAction",
                  'patients', ${patientId}::uuid, ${at})
        `;
      }
    };

    it('flags one actor reading an unusual number of distinct files', async () => {
      const actor = await makeUser(Role.NURSE);
      const patients: string[] = [];

      for (let i = 0; i < 12; i += 1) {
        const patient = await prisma.patient.create({
          data: {
            mrn: `MRN-A-${Date.now()}-${i}`,
            firstName: 'A',
            lastName: 'B',
            birthDate: new Date('1980-01-01'),
            sex: 'FEMALE',
            country: 'TR',
          },
        });
        patientIds.push(patient.id);
        patients.push(patient.id);
      }

      const at = new Date(Date.now() - 60_000);
      await seedReads(actor.id, Role.NURSE, patients, at);

      const found = await anomalies.detect(new Date(Date.now() - 3_600_000), new Date(), {
        bulkAccessPatients: 10,
      });
      const mine = found.filter((a) => a.actorId === actor.id && a.kind === 'BULK_ACCESS');

      expect(mine).toHaveLength(1);
      expect(mine[0]?.count).toBe(12);
      expect(mine[0]?.actorRole).toBe(Role.NURSE);
    });

    it('does not flag an actor below the threshold', async () => {
      const actor = await makeUser(Role.NURSE);
      const patient = await prisma.patient.create({
        data: {
          mrn: `MRN-B-${Date.now()}`,
          firstName: 'A',
          lastName: 'B',
          birthDate: new Date('1980-01-01'),
          sex: 'FEMALE',
          country: 'TR',
        },
      });
      patientIds.push(patient.id);

      await seedReads(actor.id, Role.NURSE, [patient.id], new Date(Date.now() - 60_000));

      const found = await anomalies.detect(new Date(Date.now() - 3_600_000), new Date(), {
        bulkAccessPatients: 10,
      });

      expect(found.filter((a) => a.actorId === actor.id && a.kind === 'BULK_ACCESS')).toHaveLength(0);
    });

    it('flags repeated failed logins for one account', async () => {
      const user = await makeUser(Role.PATIENT);

      for (let i = 0; i < 6; i += 1) {
        await auth.login(user.email, 'wrong-password-x', undefined, {}).catch(() => undefined);
      }

      const found = await anomalies.detect(new Date(Date.now() - 3_600_000), new Date(), {
        loginFailures: 5,
      });
      const mine = found.filter(
        (a) => a.kind === 'REPEATED_LOGIN_FAILURE' && a.actorId === user.id,
      );

      expect(mine).toHaveLength(1);
      expect(mine[0]?.count).toBeGreaterThanOrEqual(5);
    });

    it('ignores activity outside the requested window', async () => {
      const actor = await makeUser(Role.NURSE);
      const patients: string[] = [];

      for (let i = 0; i < 12; i += 1) {
        const patient = await prisma.patient.create({
          data: {
            mrn: `MRN-C-${Date.now()}-${i}`,
            firstName: 'A',
            lastName: 'B',
            birthDate: new Date('1980-01-01'),
            sex: 'FEMALE',
            country: 'TR',
          },
        });
        patientIds.push(patient.id);
        patients.push(patient.id);
      }

      // Two days ago, well outside the one-hour window queried below.
      await seedReads(actor.id, Role.NURSE, patients, new Date(Date.now() - 48 * 3_600_000));

      const found = await anomalies.detect(new Date(Date.now() - 3_600_000), new Date(), {
        bulkAccessPatients: 10,
      });

      expect(found.filter((a) => a.actorId === actor.id)).toHaveLength(0);
    });
  });
});
