import { randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Env } from '../config/env.schema';
import { generateToken, hashToken } from '../crypto/hashing';
import { PrismaService } from '../infra/prisma.service';

export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  role: Role;
  /** Session family, so a revoked device invalidates its access tokens too. */
  fid: string;
  /**
   * Scope. Absent on a normal session token. 'mfa_setup' marks a token that may
   * do nothing except enrol a second factor.
   */
  scp?: 'mfa_setup';
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface DeviceContext {
  deviceName?: string;
  platform?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * A token that can only reach the 2FA enrolment endpoints. Five minutes,
   * no session family, and useless for anything else.
   */
  async issueMfaSetupToken(userId: string, role: Role): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, role, fid: 'mfa-setup', scp: 'mfa_setup' } satisfies AccessTokenPayload,
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: 300,
      },
    );
  }

  /** Starts a new session family — one per device login. */
  async issueForNewSession(
    userId: string,
    role: Role,
    device: DeviceContext,
  ): Promise<IssuedTokens> {
    return this.issue(userId, role, randomUUID(), device);
  }

  /**
   * Rotates a refresh token.
   *
   * Refresh tokens are single-use. Presenting one that has already been
   * consumed means either the token was stolen and replayed, or the legitimate
   * client is replaying — and we cannot tell which. The safe response is to
   * revoke the entire family, forcing a fresh login on that device. Anything
   * less leaves a thief with a working session.
   */
  async rotate(refreshToken: string, device: DeviceContext): Promise<IssuedTokens> {
    const session = await this.prisma.deviceSession.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
      include: { user: { select: { role: true, status: true } } },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.revokedAt) {
      await this.revokeFamily(session.familyId);
      this.logger.warn(
        `Refresh token reuse detected for family ${session.familyId}; session revoked`,
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (session.user.status !== 'ACTIVE') {
      await this.revokeFamily(session.familyId);
      throw new UnauthorizedException('Account is not active');
    }

    // Consume the old token before issuing the new one.
    await this.prisma.deviceSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issue(session.userId, session.user.role, session.familyId, {
      deviceName: device.deviceName ?? session.deviceName ?? undefined,
      platform: device.platform ?? session.platform ?? undefined,
      ipAddress: device.ipAddress,
      userAgent: device.userAgent,
    });
  }

  /** Signs out one device (spec section 2). */
  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.deviceSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Signs out everywhere — used after a password change or a lockout. */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.deviceSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return result.count;
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  /**
   * An access token stays valid until it expires, so a revoked device must be
   * checked against the session table rather than trusted from the JWT alone.
   */
  async isFamilyActive(familyId: string): Promise<boolean> {
    const active = await this.prisma.deviceSession.count({
      where: { familyId, revokedAt: null, expiresAt: { gt: new Date() } },
    });

    return active > 0;
  }

  private async issue(
    userId: string,
    role: Role,
    familyId: string,
    device: DeviceContext,
  ): Promise<IssuedTokens> {
    const refreshToken = generateToken();
    const refreshTtlDays = this.parseDays(this.config.get('JWT_REFRESH_TTL', { infer: true }));

    await this.prisma.deviceSession.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: hashToken(refreshToken),
        deviceName: device.deviceName,
        platform: device.platform,
        ipAddress: device.ipAddress,
        userAgent: device.userAgent,
        expiresAt: new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000),
      },
    });

    // Seconds rather than the "15m" string: unambiguous, and it is the same
    // number we hand back to the client so the two cannot drift apart.
    const accessTtlSeconds = this.parseSeconds(this.config.get('JWT_ACCESS_TTL', { infer: true }));

    const accessToken = await this.jwt.signAsync(
      { sub: userId, role, fid: familyId } satisfies AccessTokenPayload,
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: accessTtlSeconds,
      },
    );

    return { accessToken, refreshToken, expiresIn: accessTtlSeconds };
  }

  private parseDays(ttl: string): number {
    const match = /^(\d+)d$/.exec(ttl);
    return match ? Number(match[1]) : 30;
  }

  private parseSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) {
      return 900;
    }

    const value = Number(match[1]);
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

    return value * (multipliers[match[2]!] ?? 60);
  }
}
