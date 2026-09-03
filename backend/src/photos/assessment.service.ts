import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiJobType, AuditAction, Photo } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { Env } from '../config/env.schema';
import { PrismaService } from '../infra/prisma.service';
import { StorageService } from '../infra/storage.service';
import { readBounded } from './read-bounded';
import { isAssessable, parseAssessment, type Finding } from './assessment';
import { SYSTEM_PROMPT, buildUserPrompt } from './assessment.prompt';

/** Matches the provider limit; a larger photo is refused rather than truncated. */
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export interface AssessmentResult {
  photo: Photo;
  findings: Finding[];
  reviewSuggested: boolean;
  /** Null when the layer is off, refused, or the answer could not be read. */
  model: string | null;
  /** Why nothing was assessed, when nothing was. */
  skippedReason: 'disabled' | 'unsupported-image' | 'ai-unavailable' | 'unreadable' | null;
}

@Injectable()
export class PhotoAssessmentService {
  private readonly logger = new Logger(PhotoAssessmentService.name);
  private readonly enabled: boolean;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly ai: AIService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('AI_PHOTO_ASSESSMENT', { infer: true });
    this.bucket = config.get('S3_BUCKET_PHOTOS', { infer: true });
  }

  /**
   * Looks at one photograph and says whether a clinician should look sooner.
   *
   * A flag, never a diagnosis (spec M5). The model reports which of four things
   * it can see from a closed list; the flag is computed from that rather than
   * asked for, and a word outside the vocabulary has nowhere to go.
   */
  async assess(user: AuthenticatedUser, photoId: string): Promise<AssessmentResult> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mrn: true,
            user: { select: { phone: true, email: true } },
            surgeries: { orderBy: { performedAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    if (!photo || photo.deletedAt) {
      throw new NotFoundException('Photo not found');
    }

    await this.access.assertCanAccess(user, photo.patientId);

    /**
     * The clinic has to switch this on deliberately.
     *
     * An image cannot be minimised the way text can: the scrubber takes a name
     * out of a sentence, and nothing takes a face or a tattoo out of a wound
     * photograph. Sending one is a disclosure a clinic should decide on rather
     * than inherit from having enabled the AI layer.
     */
    if (!this.enabled) {
      return this.skipped(photo, 'disabled');
    }

    if (!isAssessable(photo.mime)) {
      throw new BadRequestException('This file is not an image the assessment can read');
    }

    if (photo.size > MAX_PHOTO_BYTES) {
      throw new BadRequestException('This photo is too large to assess');
    }

    if (!this.ai.enabled) {
      return this.skipped(photo, 'ai-unavailable');
    }

    const stream = await this.storage.client.getObject(this.bucket, photo.fileKey);
    const bytes = await readBounded(stream, MAX_PHOTO_BYTES);
    const surgery = photo.patient.surgeries[0] ?? null;

    const result = await this.ai.complete({
      purpose: AiJobType.PHOTO_ASSESSMENT,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', mediaType: photo.mime, base64: bytes.toString('base64') },
            {
              type: 'text',
              text: buildUserPrompt({
                daysSinceSurgery: surgery
                  ? Math.max(
                      0,
                      Math.floor((Date.now() - surgery.performedAt.getTime()) / 86_400_000),
                    )
                  : null,
                bodyArea: photo.bodyArea,
              }),
            },
          ],
        },
      ],
      containsHealthData: true,
      /**
       * There is no patient text in this prompt, so the check has nothing to
       * find — and it is supplied anyway, because the day somebody adds the
       * patient's own note to it is the day it has to be armed already.
       *
       * What it cannot check is the picture. A face or a tattoo in a wound
       * photograph is an identifier no text scan will ever see, which is why
       * sending photographs is its own switch and off by default.
       */
      identifiers: {
        names: [photo.patient.firstName, photo.patient.lastName],
        mrn: photo.patient.mrn,
        phone: photo.patient.user?.phone ?? null,
        email: photo.patient.user?.email ?? null,
      },
      patientId: photo.patientId,
      // Four ids and a pair of brackets.
      maxOutputTokens: 200,
      temperature: 0,
    });

    if (!result.ok) {
      this.logger.log(`No assessment for photo ${photoId} (${result.reason})`);
      return this.skipped(photo, 'ai-unavailable');
    }

    const assessment = parseAssessment(result.text);

    if (assessment === null) {
      this.logger.warn(`Assessment for photo ${photoId} could not be read`);
      return this.skipped(photo, 'unreadable');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.photo.update({
        where: { id: photoId },
        data: {
          aiReviewSuggested: assessment.reviewSuggested,
          aiFindings: assessment.findings,
          aiAssessedAt: new Date(),
          // What answered, not what was asked for (spec section 14.6).
          aiModel: result.model,
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'photos',
        entityId: photoId,
        patientId: photo.patientId,
        after: {
          aiReviewSuggested: row.aiReviewSuggested,
          aiFindings: row.aiFindings,
          aiModel: row.aiModel,
        },
      });

      return row;
    });

    return {
      photo: updated,
      findings: assessment.findings,
      reviewSuggested: assessment.reviewSuggested,
      model: result.model,
      skippedReason: null,
    };
  }

  /**
   * Photos a clinician should look at first.
   *
   * Only the flagged ones, oldest first: this is a worklist, and a worklist
   * ordered newest-first is one where the oldest thing waits forever.
   */
  async flagged(user: AuthenticatedUser): Promise<Photo[]> {
    const scope = await this.access.scopeFilter(user);

    return this.prisma.photo.findMany({
      where: { patient: scope, deletedAt: null, aiReviewSuggested: true },
      orderBy: { takenAt: 'asc' },
      take: 100,
    });
  }

  /**
   * Nothing was assessed, and the photo is left exactly as it was.
   *
   * Not recorded as "assessed, nothing found": a photo nobody looked at and a
   * photo a model found nothing in are different states, and collapsing them
   * would tell a clinician that something had been checked when it had not.
   */
  private skipped(photo: Photo, reason: NonNullable<AssessmentResult['skippedReason']>): AssessmentResult {
    return {
      photo,
      findings: [],
      reviewSuggested: false,
      model: null,
      skippedReason: reason,
    };
  }
}
