import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Consent, ConsentType } from '@prisma/client';
import { type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { FileService } from '../files/file.service';
import { PrismaService } from '../infra/prisma.service';

export interface RecordConsentInput {
  type: ConsentType;
  version: number;
  documentText?: string;
  /** The signature drawn with a finger, as base64 PNG without a data: prefix. */
  signature?: string;
  ipAddress?: string;
  userAgent?: string;
}

/** The first bytes of every PNG. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A stroke drawing, not a photograph.
 *
 * Half a megabyte is far more than a signature needs and far less than a
 * camera produces, which is the line worth drawing: this field must not become
 * a way to put arbitrary images into the consent record.
 */
const MAXIMUM_SIGNATURE_BYTES = 512 * 1024;

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
/**
 * Which wording the treatment consent is.
 *
 * Bumped by hand when the text changes materially, because "materially" is a
 * judgement a file's modification time cannot make. A bump means consents
 * given against the old wording are visibly against the old wording.
 */
export const TREATMENT_CONSENT_VERSION = 1;

export interface ConsentForm {
  id: string;
  version: number;
  /** Markdown, with the patient's own procedure filled in. */
  body: string;
}

@Injectable()
export class ConsentsService {
  private readonly logger = new Logger(ConsentsService.name);

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
    private readonly files: FileService,
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

    // Stored before the row is written. A consent recorded with a signature
    // key pointing at nothing would be a record that looks signed and is not;
    // a stored image with no row is a stray object the sweep will collect.
    const signatureFileKey = input.signature
      ? await this.storeSignature(input.signature)
      : undefined;

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
        signatureFileKey,
        signedAt: new Date(),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  /**
   * Stores the drawn signature and returns its object key.
   *
   * Checked against the PNG magic bytes rather than trusted: the field is a
   * string from a client, and "it said it was a PNG" is not a reason to put
   * arbitrary bytes in the bucket that serves clinical documents.
   */
  private async storeSignature(base64: string): Promise<string> {
    const bytes = Buffer.from(base64, 'base64');

    if (bytes.length === 0) {
      throw new BadRequestException('The signature could not be read');
    }

    if (bytes.length > MAXIMUM_SIGNATURE_BYTES) {
      throw new BadRequestException('The signature is too large');
    }

    if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      throw new BadRequestException('The signature must be a PNG');
    }

    const stored = await this.files.store('documents', Readable.from(bytes), {
      mime: 'image/png',
      extension: 'png',
      maxBytes: MAXIMUM_SIGNATURE_BYTES,
    });

    return stored.key;
  }

  /**
   * The treatment consent form this patient is about to sign (spec M17).
   *
   * Built rather than served flat, for one reason: **a document that does not
   * name the operation is not informed consent.** The procedure, the surgeon
   * and the planned date come from the patient's own surgery record, and if
   * the clinic has not recorded one the form is refused — that is the clinic's
   * missing data, not a missing file, and the app says which.
   *
   * A procedure-specific annex is appended when the clinic has written one.
   * The base text covers what every operation shares; the risks of *this*
   * operation are theirs to state.
   */
  async treatmentForm(user: AuthenticatedUser, patientId: string): Promise<ConsentForm> {
    await this.access.assertCanAccess(user, patientId);

    const base = await this.readLegal('TEDAVI-ONAM-METNI.md');

    if (base === null) {
      throw new NotFoundException('CONSENT_TEXT_UNPUBLISHED');
    }

    const surgery = await this.prisma.surgery.findFirst({
      where: { patientId },
      orderBy: { performedAt: 'desc' },
      select: {
        procedureName: true,
        procedureCode: true,
        performedAt: true,
        surgeonId: true,
      },
    });

    if (!surgery) {
      // Deliberately its own answer. "The clinic has not published a form" and
      // "the clinic has not recorded your operation" are different problems
      // with different people to chase, and one message for both sends the
      // patient to the wrong one.
      throw new NotFoundException('PROCEDURE_NOT_RECORDED');
    }

    const annex = surgery.procedureCode
      ? await this.readLegal(`TEDAVI-ONAM-${surgery.procedureCode}.md`)
      : null;

    // A separate read because `Surgery.surgeonId` carries no relation. Absent
    // is a real state — an operation booked before the surgeon is assigned —
    // and the form says so rather than naming nobody.
    const surgeon = surgery.surgeonId
      ? await this.prisma.staffProfile.findUnique({
          where: { id: surgery.surgeonId },
          select: { firstName: true, lastName: true },
        })
      : null;

    const filled = ConsentsService.fill(base, {
      islem: surgery.procedureName,
      hekim: surgeon
        ? `${surgeon.firstName} ${surgeon.lastName}`
        : 'Klinik tarafından bildirilecek',
      tarih: ConsentsService.day(surgery.performedAt),
    });

    return {
      id: 'treatment-consent',
      version: TREATMENT_CONSENT_VERSION,
      body: annex ? `${filled}\n\n---\n\n${annex}` : filled,
    };
  }

  /**
   * Fills the `{{...}}` fields.
   *
   * Anything the template asks for and this does not have is replaced with a
   * visible marker rather than left as `{{hekim}}`: a patient reading braces
   * in a consent form is reading a bug, and a form that silently dropped the
   * field would be worse still.
   */
  static fill(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const value = values[key]?.trim();

      return value && value.length > 0 ? value : '—';
    });
  }

  /** The day, as somebody reads it rather than as a timestamp. */
  static day(at: Date): string {
    return at.toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Istanbul',
    });
  }

  /** Nil rather than a fallback: a document that is not there is not there. */
  private async readLegal(name: string): Promise<string | null> {
    // dist/consents → dist → backend/legal, which sync-legal.ts fills.
    const path = join(__dirname, '..', '..', 'legal', name);

    try {
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * A short-lived link to the signature.
   *
   * Through the same signed-URL path as every other stored object: the bucket
   * is private, and a consent signature is exactly the kind of thing that must
   * not become a URL somebody can pass around.
   */
  async signatureUrl(
    user: AuthenticatedUser,
    patientId: string,
    consentId: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    await this.access.assertCanAccess(user, patientId);

    const consent = await this.prisma.consent.findFirst({
      where: { id: consentId, patientId },
      select: { signatureFileKey: true },
    });

    if (!consent?.signatureFileKey) {
      throw new NotFoundException('No signature was recorded with this consent');
    }

    return this.files.createDownloadUrl('documents', consent.signatureFileKey, {
      filename: 'imza.png',
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
