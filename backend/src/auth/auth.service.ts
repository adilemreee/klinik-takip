import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Role, User, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Env } from '../config/env.schema';
import { hashPassword, verifyPassword } from '../crypto/hashing';
import { PrismaService } from '../infra/prisma.service';
import { AuthError, isStaffRole } from './auth.errors';
import { checkPassword } from './password.policy';
import { DeviceContext, IssuedTokens, TokenService } from './token.service';
import { TotpService } from './totp.service';

export interface LoginResult {
  tokens?: IssuedTokens;
  /** Set when the account must complete a step before tokens are issued. */
  pending?: 'MFA_REQUIRED' | 'MFA_SETUP_REQUIRED';
  /**
   * Short-lived, narrowly scoped token accepted only by the 2FA enrolment
   * endpoints. Without it a staff member who has no second factor yet could
   * never enrol one: login withholds tokens until 2FA exists, and the enrolment
   * endpoints require a token — a closed loop.
   */
  setupToken?: string;
}

export interface SessionSummary {
  familyId: string;
  deviceName: string | null;
  platform: string | null;
  ipAddress: string | null;
  lastSeenAt: Date;
  current: boolean;
}

/**
 * A pre-computed Argon2 digest of a value nobody knows.
 *
 * When the e-mail is unknown we still run a verification against this, so a
 * failed login costs the same whether or not the account exists. Without it,
 * response time alone tells an attacker who is registered here — which for a
 * clinic means confirming that a named person is a patient.
 */
const DUMMY_DIGEST =
  '$argon2id$v=19$m=47104,t=3,p=1$c29tZXNhbHR2YWx1ZXg$Rdescudvl0ZOZh5PBQGKUqAZ0N3Rf2NPO0N7VXhFPwo';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  async login(
    identifier: string,
    password: string,
    totpCode: string | undefined,
    device: DeviceContext,
  ): Promise<LoginResult> {
    const user = await this.findByIdentifier(identifier);

    if (!user?.passwordHash) {
      await verifyPassword(DUMMY_DIGEST, password);
      // No entityId: the account does not exist, and recording the attempted
      // address would fill the trail with attacker-chosen strings.
      await this.recordAuth(AuditAction.LOGIN_FAILED, undefined, device, 'unknown_account');
      throw new UnauthorizedException(AuthError.INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordAuth(AuditAction.LOGIN_FAILED, user, device, 'locked');
      throw this.lockedOut(user.lockedUntil);
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      const lockedUntil = await this.registerFailedAttempt(user);
      await this.recordAuth(AuditAction.LOGIN_FAILED, user, device, 'bad_password');

      // The attempt that trips the lock says so, rather than "wrong password"
      // followed by a lock on the next try. Somebody who has just been locked
      // out needs to know that now, not after typing it correctly once more.
      throw lockedUntil
        ? this.lockedOut(lockedUntil)
        : new UnauthorizedException(AuthError.INVALID_CREDENTIALS);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(AuthError.ACCOUNT_INACTIVE);
    }

    // Password was right: clear the counter before the second factor, so a
    // mistyped TOTP code cannot lock an account whose password is fine.
    await this.clearFailedAttempts(user);

    if (user.totpSecret && user.totpEnabledAt) {
      if (!totpCode) {
        return { pending: 'MFA_REQUIRED' };
      }

      const result = this.totp.verifyEncrypted(
        totpCode,
        user.totpSecret,
        user.totpLastStep ?? undefined,
      );

      if (!result.valid) {
        const lockedUntil = await this.registerFailedAttempt(user);
        await this.recordAuth(AuditAction.LOGIN_FAILED, user, device, 'bad_totp');

        // A mistyped code counts the same as a mistyped password: both are
        // guesses at a credential, and six digits is a space worth defending.
        // It does mean somebody enrolling for the first time, copying a secret
        // while the codes rotate, can lock themselves out — so the message has
        // to say for how long.
        throw lockedUntil
          ? this.lockedOut(lockedUntil)
          : new UnauthorizedException(AuthError.MFA_INVALID);
      }

      // Burn this time step so the same code cannot be presented again.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { totpLastStep: result.timeStep ?? null },
      });
    } else if (isStaffRole(user.role)) {
      // Spec section 2: staff accounts must carry a second factor. No session
      // tokens are issued until it is enrolled — only a token that can do
      // nothing except enrol one.
      return {
        pending: 'MFA_SETUP_REQUIRED',
        setupToken: await this.tokens.issueMfaSetupToken(user.id, user.role),
      };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.recordAuth(AuditAction.LOGIN, user, device);

    return { tokens: await this.tokens.issueForNewSession(user.id, user.role, device) };
  }

  /**
   * Enrolment for a staff member who has no second factor yet, or a patient
   * opting in. The secret is only active once a code generated from it has been
   * confirmed — otherwise a failed scan would lock the user out.
   */
  async beginTotpEnrolment(userId: string): Promise<{ secret: string; uri: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.totpEnabledAt) {
      throw new BadRequestException('Two-factor authentication is already enabled');
    }

    const setup = this.totp.generate(user.email ?? user.phone ?? user.id);

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: this.totp.encryptSecret(setup.secret), totpEnabledAt: null },
    });

    return setup;
  }

  async confirmTotpEnrolment(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!user.totpSecret) {
      throw new BadRequestException('Start enrolment first');
    }

    const result = this.totp.verifyEncrypted(code, user.totpSecret);

    if (!result.valid) {
      throw new UnauthorizedException(AuthError.MFA_INVALID);
    }

    // Deliberately does NOT record the time step here. Burning it would reject
    // the very next login if the authenticator still shows the same code —
    // which it does for up to thirty seconds, right at onboarding. The code was
    // presented over an already-authenticated channel; replay protection starts
    // at the first real login.
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date() },
    });
  }

  /** Patients may opt out; staff may not (spec section 2). */
  async disableTotp(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (isStaffRole(user.role)) {
      throw new ForbiddenException('Two-factor authentication is mandatory for staff');
    }

    if (!user.totpSecret || !this.totp.verifyEncrypted(code, user.totpSecret).valid) {
      throw new UnauthorizedException(AuthError.MFA_INVALID);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
    });
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
      throw new UnauthorizedException(AuthError.INVALID_CREDENTIALS);
    }

    const check = checkPassword(next, [user.email ?? '', user.phone ?? ''].filter(Boolean));
    if (!check.valid) {
      throw new BadRequestException({ code: AuthError.PASSWORD_TOO_WEAK, reasons: check.reasons });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(next) },
    });

    // A password change invalidates every device: if the change was prompted by
    // a suspected compromise, leaving other sessions alive defeats the point.
    const revoked = await this.tokens.revokeAllForUser(userId);
    this.logger.log(`Password changed for user ${userId}; revoked ${revoked} sessions`);

    await this.audit.record({
      actorId: userId,
      actorRole: user.role,
      action: AuditAction.UPDATE,
      entityType: 'users',
      entityId: userId,
      after: { passwordChanged: true, sessionsRevoked: revoked },
    });
  }

  async listSessions(userId: string, currentFamilyId: string): Promise<SessionSummary[]> {
    const sessions = await this.prisma.deviceSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });

    return sessions.map((session) => ({
      familyId: session.familyId,
      deviceName: session.deviceName,
      platform: session.platform,
      ipAddress: session.ipAddress,
      lastSeenAt: session.lastSeenAt,
      current: session.familyId === currentFamilyId,
    }));
  }

  /**
   * Authentication events go to the audit trail (spec section 13). Failures are
   * recorded with a reason so a brute-force attempt is distinguishable from a
   * user fumbling their TOTP code.
   */
  private async recordAuth(
    action: AuditAction,
    user: User | undefined,
    device: DeviceContext,
    reason?: string,
  ): Promise<void> {
    await this.audit.record({
      actorId: user?.id,
      actorRole: user?.role,
      action,
      entityType: 'auth',
      entityId: user?.id,
      ipAddress: device.ipAddress,
      userAgent: device.userAgent,
      after: reason ? { reason } : undefined,
    });
  }

  private async findByIdentifier(identifier: string): Promise<User | null> {
    const normalised = identifier.trim().toLowerCase();

    return this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: normalised }, { phone: identifier.trim() }],
      },
    });
  }

  /**
   * The lockout, with the wait in it.
   *
   * "Try again in a little while" leaves somebody guessing, and the server
   * knows the answer exactly. The duration is a fixed policy constant rather
   * than a secret, and this error already only reaches an account that exists —
   * an unknown address gets INVALID_CREDENTIALS — so saying it reveals nothing
   * a lockout has not already revealed.
   */
  private lockedOut(lockedUntil: Date): UnauthorizedException {
    const seconds = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));

    return new UnauthorizedException({
      statusCode: 401,
      message: AuthError.ACCOUNT_LOCKED,
      error: 'Unauthorized',
      retryAfterSeconds: seconds,
    });
  }

  /** Returns when the account became locked, or null if it is not. */
  private async registerFailedAttempt(user: User): Promise<Date | null> {
    const maxAttempts = this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    const lockoutMinutes = this.config.get('LOGIN_LOCKOUT_MINUTES', { infer: true });
    const attempts = user.failedLoginAttempts + 1;
    const lockedUntil =
      attempts >= maxAttempts ? new Date(Date.now() + lockoutMinutes * 60_000) : null;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: lockedUntil ?? undefined,
      },
    });

    if (lockedUntil) {
      this.logger.warn(`Account ${user.id} locked after ${attempts} failed attempts`);
    }

    return lockedUntil;
  }

  private async clearFailedAttempts(user: User): Promise<void> {
    if (user.failedLoginAttempts === 0 && !user.lockedUntil) {
      return;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }
}

export { Role };
