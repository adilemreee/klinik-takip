import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { Env } from '../config/env.schema';
import { generateNumericCode, hashPassword, hashToken } from '../crypto/hashing';
import { PrismaService } from '../infra/prisma.service';
import { AuthError } from './auth.errors';
import { checkPassword } from './password.policy';

export interface CreateInvitationInput {
  email?: string;
  phone?: string;
  role: Role;
  patientId?: string;
}

export interface CreatedInvitation {
  id: string;
  /**
   * Returned exactly once, for the notification worker to deliver. Only its
   * hash is stored, so it cannot be recovered from the database afterwards.
   */
  code: string;
  expiresAt: Date;
}

/**
 * There is no self-signup anywhere in this system (spec section 2): staff are
 * invited by the doctor, patients by a coordinator or nurse.
 */
@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(invitedById: string, input: CreateInvitationInput): Promise<CreatedInvitation> {
    if (!input.email && !input.phone) {
      throw new BadRequestException('An invitation needs an e-mail address or a phone number');
    }

    const code = generateNumericCode(6);
    const ttlHours = this.config.get('INVITATION_TTL_HOURS', { infer: true });

    const invitation = await this.prisma.invitation.create({
      data: {
        email: input.email?.trim().toLowerCase(),
        phone: input.phone?.trim(),
        role: input.role,
        patientId: input.patientId,
        invitedById,
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      },
    });

    this.logger.log(`Invitation ${invitation.id} created for role ${input.role}`);

    return { id: invitation.id, code, expiresAt: invitation.expiresAt };
  }

  /**
   * Redeems an invitation and creates the account.
   *
   * The code is looked up by hash together with the identifier it was issued
   * to: a six-digit code alone is guessable, so possession of the code is not
   * sufficient — the invitee must also know which address it was sent to.
   */
  async accept(identifier: string, code: string, password: string): Promise<{ userId: string }> {
    const normalised = identifier.trim().toLowerCase();

    const invitation = await this.prisma.invitation.findFirst({
      where: {
        codeHash: hashToken(code),
        acceptedAt: null,
        revokedAt: null,
        OR: [{ email: normalised }, { phone: identifier.trim() }],
      },
    });

    if (!invitation) {
      await this.registerFailedAttempt(normalised, identifier.trim());
      throw new UnauthorizedException(AuthError.INVITATION_INVALID);
    }

    if (invitation.expiresAt <= new Date()) {
      throw new UnauthorizedException(AuthError.INVITATION_EXPIRED);
    }

    const maxAttempts = this.config.get('INVITATION_MAX_ATTEMPTS', { infer: true });
    if (invitation.attempts >= maxAttempts) {
      throw new UnauthorizedException(AuthError.INVITATION_ATTEMPTS_EXCEEDED);
    }

    const check = checkPassword(password, [normalised]);
    if (!check.valid) {
      throw new BadRequestException({ code: AuthError.PASSWORD_TOO_WEAK, reasons: check.reasons });
    }

    // One transaction: an account created without its invitation being consumed
    // would leave the code reusable.
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          role: invitation.role,
          email: invitation.email,
          phone: invitation.phone,
          passwordHash: await hashPassword(password),
          status: UserStatus.ACTIVE,
        },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      if (invitation.patientId) {
        await tx.patient.update({
          where: { id: invitation.patientId },
          data: { userId: user.id },
        });
      }

      return { userId: user.id };
    });
  }

  async revoke(invitationId: string): Promise<void> {
    await this.prisma.invitation.updateMany({
      where: { id: invitationId, acceptedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Counts a wrong code against every open invitation for that identifier, so
   * the attempt limit cannot be sidestepped by guessing against a fresh one.
   */
  private async registerFailedAttempt(email: string, phone: string): Promise<void> {
    const where: Prisma.InvitationWhereInput = {
      acceptedAt: null,
      revokedAt: null,
      OR: [{ email }, { phone }],
    };

    await this.prisma.invitation.updateMany({ where, data: { attempts: { increment: 1 } } });
  }
}
