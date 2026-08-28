import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { generateSync } from 'otplib';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { InvitationService } from '../src/auth/invitation.service';
import { TokenService } from '../src/auth/token.service';
import { TotpService } from '../src/auth/totp.service';
import { EncryptionService } from '../src/crypto/encryption.service';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';

/**
 * Authentication behaviour against a real database.
 *
 * Weighted towards the negative cases: what the system must *refuse* is the
 * part that matters, and it is the part a mocked test quietly gets wrong.
 */
describe('authentication', () => {
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
    INVITATION_TTL_HOURS: 72,
    INVITATION_MAX_ATTEMPTS: 5,
  };

  let auth: AuthService;
  let tokens: TokenService;
  let invitations: InvitationService;

  const device = { deviceName: 'Test', platform: 'ios', ipAddress: '127.0.0.1' };
  const PASSWORD = 'correct-horse-battery-9';
  const created: string[] = [];

  const makeUser = async (role: Role, overrides = {}): Promise<{ id: string; email: string }> => {
    const email = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: {
        role,
        email,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
        ...overrides,
      },
    });
    created.push(user.id);
    return { id: user.id, email };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        AuditService,
        TokenService,
        TotpService,
        InvitationService,
        EncryptionService,
        JwtService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => settings[key] },
        },
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(TokenService);
    invitations = moduleRef.get(InvitationService);
  });

  afterAll(async () => {
    await prisma.deviceSession.deleteMany({ where: { userId: { in: created } } });
    await prisma.invitation.deleteMany({ where: { invitedById: { in: created } } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  describe('login', () => {
    it('issues tokens for a patient with a correct password', async () => {
      const user = await makeUser(Role.PATIENT);

      const result = await auth.login(user.email, PASSWORD, undefined, device);

      expect(result.tokens?.accessToken).toBeDefined();
      expect(result.tokens?.refreshToken).toBeDefined();
    });

    it('rejects a wrong password', async () => {
      const user = await makeUser(Role.PATIENT);

      await expect(auth.login(user.email, 'wrong-password-x', undefined, device)).rejects.toThrow(
        'INVALID_CREDENTIALS',
      );
    });

    /**
     * An unknown account and a wrong password must be indistinguishable. For a
     * clinic, telling them apart confirms that a named person is a patient here.
     */
    it('gives the same answer for an unknown account as for a wrong password', async () => {
      const user = await makeUser(Role.PATIENT);

      const unknown = await auth
        .login('nobody-here@test.local', PASSWORD, undefined, device)
        .catch((e: Error) => e.message);
      const wrong = await auth
        .login(user.email, 'wrong-password-x', undefined, device)
        .catch((e: Error) => e.message);

      expect(unknown).toBe(wrong);
    });

    it('locks the account after the configured number of failures', async () => {
      const user = await makeUser(Role.PATIENT);

      for (let i = 0; i < 5; i += 1) {
        await auth.login(user.email, 'wrong-password-x', undefined, device).catch(() => undefined);
      }

      // Even the correct password is refused while the lock holds.
      await expect(auth.login(user.email, PASSWORD, undefined, device)).rejects.toThrow(
        'ACCOUNT_LOCKED',
      );
    });

    it('clears the failure counter after a successful login', async () => {
      const user = await makeUser(Role.PATIENT);

      await auth.login(user.email, 'wrong-password-x', undefined, device).catch(() => undefined);
      await auth.login(user.email, PASSWORD, undefined, device);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginAttempts).toBe(0);
    });

    it('refuses a suspended account that has the right password', async () => {
      const user = await makeUser(Role.PATIENT, { status: UserStatus.SUSPENDED });

      await expect(auth.login(user.email, PASSWORD, undefined, device)).rejects.toThrow(
        'ACCOUNT_INACTIVE',
      );
    });

    /** Spec section 2: staff accounts must carry a second factor. */
    it.each([Role.DOCTOR, Role.NURSE, Role.COORDINATOR, Role.FINANCE, Role.SUPER_ADMIN])(
      'issues no tokens to %s until 2FA is enrolled',
      async (role) => {
        const user = await makeUser(role);

        const result = await auth.login(user.email, PASSWORD, undefined, device);

        expect(result.pending).toBe('MFA_SETUP_REQUIRED');
        expect(result.tokens).toBeUndefined();
      },
    );

    it('lets a patient in without 2FA, which is optional for them', async () => {
      const user = await makeUser(Role.PATIENT);

      const result = await auth.login(user.email, PASSWORD, undefined, device);

      expect(result.pending).toBeUndefined();
      expect(result.tokens).toBeDefined();
    });
  });

  describe('two-factor authentication', () => {
    const enrol = async (userId: string): Promise<string> => {
      const setup = await auth.beginTotpEnrolment(userId);
      await auth.confirmTotpEnrolment(userId, generateSync({ secret: setup.secret }));
      return setup.secret;
    };

    it('stores the secret encrypted, not in the clear', async () => {
      const user = await makeUser(Role.DOCTOR);
      const secret = await enrol(user.id);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.totpSecret).not.toContain(secret);
      expect(row.totpSecret).toMatch(/^v1:/);
    });

    it('asks for a code once enrolled, and issues nothing without one', async () => {
      const user = await makeUser(Role.DOCTOR);
      await enrol(user.id);

      const result = await auth.login(user.email, PASSWORD, undefined, device);

      expect(result.pending).toBe('MFA_REQUIRED');
      expect(result.tokens).toBeUndefined();
    });

    it('rejects a wrong code', async () => {
      const user = await makeUser(Role.DOCTOR);
      await enrol(user.id);

      await expect(auth.login(user.email, PASSWORD, '000000', device)).rejects.toThrow(
        'MFA_INVALID',
      );
    });

    it('accepts a valid code and issues tokens', async () => {
      const user = await makeUser(Role.DOCTOR);
      const secret = await enrol(user.id);

      const result = await auth.login(user.email, PASSWORD, generateSync({ secret }), device);

      expect(result.tokens?.accessToken).toBeDefined();
    });

    /** A code seen over a shoulder must not still work seconds later. */
    it('refuses the same code a second time', async () => {
      const user = await makeUser(Role.DOCTOR);
      const secret = await enrol(user.id);
      const code = generateSync({ secret });

      await auth.login(user.email, PASSWORD, code, device);

      await expect(auth.login(user.email, PASSWORD, code, device)).rejects.toThrow('MFA_INVALID');
    });

    it('will not let staff turn 2FA off', async () => {
      const user = await makeUser(Role.NURSE);
      const secret = await enrol(user.id);

      await expect(auth.disableTotp(user.id, generateSync({ secret }))).rejects.toThrow(
        /mandatory for staff/,
      );
    });

    it('lets a patient turn it off, since it is optional for them', async () => {
      const user = await makeUser(Role.PATIENT);
      const secret = await enrol(user.id);

      await auth.disableTotp(user.id, generateSync({ secret }));

      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.totpEnabledAt).toBeNull();
      expect(row.totpSecret).toBeNull();
    });
  });

  describe('refresh token rotation', () => {
    it('returns a different refresh token each time', async () => {
      const user = await makeUser(Role.PATIENT);
      const first = await auth.login(user.email, PASSWORD, undefined, device);

      const second = await tokens.rotate(first.tokens!.refreshToken, device);

      expect(second.refreshToken).not.toBe(first.tokens!.refreshToken);
    });

    it('refuses a token that has already been used', async () => {
      const user = await makeUser(Role.PATIENT);
      const first = await auth.login(user.email, PASSWORD, undefined, device);

      await tokens.rotate(first.tokens!.refreshToken, device);

      await expect(tokens.rotate(first.tokens!.refreshToken, device)).rejects.toThrow();
    });

    /**
     * The core defence against a stolen refresh token. Replaying a consumed
     * token means either the token was stolen or the client is misbehaving, and
     * we cannot tell which — so the whole device session dies.
     */
    it('kills the entire session family when a consumed token is replayed', async () => {
      const user = await makeUser(Role.PATIENT);
      const first = await auth.login(user.email, PASSWORD, undefined, device);
      const second = await tokens.rotate(first.tokens!.refreshToken, device);

      // The thief replays the old token.
      await expect(tokens.rotate(first.tokens!.refreshToken, device)).rejects.toThrow();

      // The legitimate client's current token is now dead too.
      await expect(tokens.rotate(second.refreshToken, device)).rejects.toThrow();
    });

    it('refuses an entirely made-up token', async () => {
      await expect(tokens.rotate('not-a-real-token', device)).rejects.toThrow();
    });

    it('stores only the hash, never the token itself', async () => {
      const user = await makeUser(Role.PATIENT);
      const result = await auth.login(user.email, PASSWORD, undefined, device);

      const rows = await prisma.deviceSession.findMany({ where: { userId: user.id } });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.refreshTokenHash).not.toBe(result.tokens!.refreshToken);
      expect(rows[0]!.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('stops working after the device is signed out', async () => {
      const user = await makeUser(Role.PATIENT);
      const result = await auth.login(user.email, PASSWORD, undefined, device);
      const session = await prisma.deviceSession.findFirstOrThrow({ where: { userId: user.id } });

      await tokens.revokeFamily(session.familyId);

      await expect(tokens.rotate(result.tokens!.refreshToken, device)).rejects.toThrow();
    });
  });

  describe('device sessions', () => {
    it('lists one entry per device and marks the current one', async () => {
      const user = await makeUser(Role.PATIENT);
      const first = await auth.login(user.email, PASSWORD, undefined, {
        ...device,
        deviceName: 'iPhone',
      });
      await auth.login(user.email, PASSWORD, undefined, { ...device, deviceName: 'iPad' });

      const payload = await tokens.verifyAccessToken(first.tokens!.accessToken);
      const sessions = await auth.listSessions(user.id, payload.fid);

      expect(sessions).toHaveLength(2);
      expect(sessions.filter((s) => s.current)).toHaveLength(1);
      expect(sessions.map((s) => s.deviceName).sort()).toEqual(['iPad', 'iPhone']);
    });

    it('signs out every device when the password changes', async () => {
      const user = await makeUser(Role.PATIENT);
      await auth.login(user.email, PASSWORD, undefined, device);
      await auth.login(user.email, PASSWORD, undefined, device);

      await auth.changePassword(user.id, PASSWORD, 'a-brand-new-passphrase-77');

      const active = await prisma.deviceSession.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(active).toBe(0);
    });

    it('rejects a weak new password', async () => {
      const user = await makeUser(Role.PATIENT);

      await expect(auth.changePassword(user.id, PASSWORD, 'short1')).rejects.toThrow();
    });
  });

  describe('invitations', () => {
    it('creates an account from a valid code', async () => {
      const inviter = await makeUser(Role.DOCTOR);
      const email = `inv-${Date.now()}@test.local`;

      const invite = await invitations.create(inviter.id, { email, role: Role.NURSE });
      const { userId } = await invitations.accept(email, invite.code, 'invited-user-pass-1');
      created.push(userId);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.role).toBe(Role.NURSE);
      expect(user.status).toBe(UserStatus.ACTIVE);
    });

    it('stores only the hash of the code', async () => {
      const inviter = await makeUser(Role.DOCTOR);
      const email = `inv-${Date.now()}-h@test.local`;

      const invite = await invitations.create(inviter.id, { email, role: Role.NURSE });
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invite.id } });

      expect(row.codeHash).not.toBe(invite.code);
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    });

    /** Possession of a six-digit code alone must not be enough. */
    it('refuses a valid code presented with the wrong identifier', async () => {
      const inviter = await makeUser(Role.DOCTOR);
      const email = `inv-${Date.now()}-w@test.local`;

      const invite = await invitations.create(inviter.id, { email, role: Role.NURSE });

      await expect(
        invitations.accept('someone-else@test.local', invite.code, 'invited-user-pass-1'),
      ).rejects.toThrow('INVITATION_INVALID');
    });

    it('refuses a wrong code', async () => {
      const inviter = await makeUser(Role.DOCTOR);
      const email = `inv-${Date.now()}-c@test.local`;

      await invitations.create(inviter.id, { email, role: Role.NURSE });

      await expect(invitations.accept(email, '000000', 'invited-user-pass-1')).rejects.toThrow(
        'INVITATION_INVALID',
      );
    });

    it('refuses an expired invitation', async () => {
      const inviter = await makeUser(Role.DOCTOR);
      const email = `inv-${Date.now()}-e@test.local`;

      const invite = await invitations.create(inviter.id, { email, role: Role.NURSE });
      await prisma.invitation.update({
        where: { id: invite.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(invitations.accept(email, invite.code, 'invited-user-pass-1')).rejects.toThrow(
        'INVITATION_EXPIRED',
      );
    });

    it('cannot be redeemed twice', async () => {
      const inviter = await makeUser(Role.DOCTOR);
      const email = `inv-${Date.now()}-t@test.local`;

      const invite = await invitations.create(inviter.id, { email, role: Role.NURSE });
      const { userId } = await invitations.accept(email, invite.code, 'invited-user-pass-1');
      created.push(userId);

      await expect(invitations.accept(email, invite.code, 'another-pass-value-2')).rejects.toThrow(
        'INVITATION_INVALID',
      );
    });

    it('refuses a weak password at signup', async () => {
      const inviter = await makeUser(Role.DOCTOR);
      const email = `inv-${Date.now()}-p@test.local`;

      const invite = await invitations.create(inviter.id, { email, role: Role.NURSE });

      await expect(invitations.accept(email, invite.code, 'password')).rejects.toThrow();
    });

    it('refuses an invitation with neither e-mail nor phone', async () => {
      const inviter = await makeUser(Role.DOCTOR);

      await expect(invitations.create(inviter.id, { role: Role.NURSE })).rejects.toThrow();
    });
  });
});
