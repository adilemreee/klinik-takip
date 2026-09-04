import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Consent, ConsentType } from '@prisma/client';
import { type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';

export interface RecordConsentInput {
  type: ConsentType;
  version: number;
  documentText?: string;
  signatureFileKey?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Consent records (KVKK, spec §8).
 *
 * Two rules here are legal, not technical, and both are easy to get wrong in a
 * way that looks tidy:
 *
 *   1. **`DATA_PROCESSING` is refused.** Treating a patient rests on KVKK
 *      m.6/3 — medical diagnosis and care by staff under a confidentiality
 *      obligation — not on consent. The Board's principle decision 2026/347
 *      (18.02.2026) says plainly that where a non-consent ground applies, a
 *      consent text must *not* be put in front of the person. Asking anyway is
 *      worse than pointless: a consent somebody cannot refuse without losing
 *      their treatment is not freely given, so it is void — and collecting it
 *      creates a record suggesting the clinic relied on something it could not.
 *
 *   2. **Withdrawal is forward-only.** Revoking sets a timestamp; it never
 *      deletes the record. Proving that consent existed while it was relied on
 *      is the controller's burden, and a deleted row proves nothing.
 */
@Injectable()
export class ConsentsService {
  /**
   * Consents this system may record.
   *
   * `TREATMENT` is here because it is *not* a KVKK consent — it is the medical
   * procedure consent required by patient-rights legislation, a different
   * instrument with a different basis. The two are kept in one table because
   * they are both signed records; they are not kept under one rule.
   */
  private static readonly RECORDABLE: ReadonlySet<ConsentType> = new Set([
    ConsentType.TREATMENT,
    ConsentType.PHOTO_USAGE,
    ConsentType.MARKETING,
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

  async list(user: AuthenticatedUser, patientId: string): Promise<Consent[]> {
    await this.access.assertCanAccess(user, patientId);

    return this.prisma.consent.findMany({
      where: { patientId },
      orderBy: { id: 'desc' },
    });
  }

  async record(
    user: AuthenticatedUser,
    patientId: string,
    input: RecordConsentInput,
  ): Promise<Consent> {
    await this.access.assertCanAccess(user, patientId);

    if (!ConsentsService.RECORDABLE.has(input.type)) {
      throw new BadRequestException(
        `${input.type} is not a consent this system collects. ` +
          'Processing for treatment rests on KVKK art. 6/3, and Board decision ' +
          '2026/347 forbids presenting a consent text where a non-consent ground applies.',
      );
    }

    // Giving the same consent again supersedes the previous one rather than
    // stacking: two active photo consents with different texts leaves nobody
    // able to say which one the patient actually agreed to.
    await this.prisma.consent.updateMany({
      where: { patientId, type: input.type, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return this.prisma.consent.create({
      data: {
        patientId,
        type: input.type,
        version: input.version,
        documentText: input.documentText,
        signatureFileKey: input.signatureFileKey,
        signedAt: new Date(),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  /**
   * Withdraws a consent.
   *
   * Forward-only and idempotent: withdrawing twice is not an error, because the
   * person's intent is the same both times and an error would look like a
   * failure to withdraw.
   */
  async revoke(user: AuthenticatedUser, patientId: string, consentId: string): Promise<Consent> {
    await this.access.assertCanAccess(user, patientId);

    const consent = await this.prisma.consent.findFirst({
      where: { id: consentId, patientId },
    });

    if (!consent) {
      throw new NotFoundException('Consent not found');
    }

    if (consent.revokedAt !== null) {
      return consent;
    }

    return this.prisma.consent.update({
      where: { id: consent.id },
      data: { revokedAt: new Date() },
    });
  }

  /** Whether a given consent is in force right now. */
  async isActive(patientId: string, type: ConsentType): Promise<boolean> {
    const count = await this.prisma.consent.count({
      where: { patientId, type, revokedAt: null },
    });

    return count > 0;
  }
}
