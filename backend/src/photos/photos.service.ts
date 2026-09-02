import { Readable } from 'node:stream';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  ConsentType,
  Photo,
  PhotoCategory,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { Env } from '../config/env.schema';
import { detectType, SNIFF_LENGTH } from '../files/file-type';
import { FileService } from '../files/file.service';
import { PrismaService } from '../infra/prisma.service';
import { readBounded } from './read-bounded';
import { stripMetadata } from './strip-metadata';

/**
 * What a clinical photo may be.
 *
 * Narrower than the photo bucket allows, and deliberately so: metadata is
 * stripped by rewriting the container, which this can do for JPEG and PNG and
 * cannot do for HEIC or WebP. Storing a format whose location data we cannot
 * remove — in the one bucket most likely to hold a picture of someone's body —
 * is not a trade worth making. Phones shoot HEIC by default, so the clients
 * convert before uploading; see PHOTO-MODULU.md.
 */
export const UPLOADABLE_PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);

export interface PhotoUpload {
  stream: Readable;
  filename?: string;
}

export interface PhotoDetails {
  category: PhotoCategory;
  bodyArea?: string;
  phaseLabel?: string;
  takenAt?: Date;
  note?: string;
  consentId?: string;
}

export interface GalleryGroup {
  bodyArea: string | null;
  photos: Photo[];
}

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async upload(
    user: AuthenticatedUser,
    patientId: string,
    upload: PhotoUpload,
    details: PhotoDetails,
  ): Promise<Photo> {
    await this.access.assertCanAccess(user, patientId);

    const maxBytes = this.config.get('PHOTO_MAX_BYTES', { infer: true });
    const raw = await readBounded(upload.stream, maxBytes);

    const detected = detectType(raw.subarray(0, SNIFF_LENGTH));

    if (!detected) {
      throw new BadRequestException('Unrecognised file type');
    }

    if (!UPLOADABLE_PHOTO_TYPES.has(detected.mime)) {
      throw new BadRequestException(
        `Photos must be JPEG or PNG; ${detected.mime} cannot have its location data removed`,
      );
    }

    const { data, stripped } = stripMetadata(raw, detected.mime);

    if (!stripped) {
      // Unreachable given the check above, and kept because the day someone
      // widens that set, this is what stops an unstripped photo being stored
      // as though it had been cleaned.
      throw new BadRequestException('Could not remove metadata from this photo');
    }

    if (details.consentId) {
      await this.assertPhotoConsent(patientId, details.consentId);
    }

    const stored = await this.files.upload(Readable.from(data), {
      bucket: 'photos',
      allowedMimeTypes: UPLOADABLE_PHOTO_TYPES,
      maxBytes,
      originalName: upload.filename,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const photo = await tx.photo.create({
          data: {
            patientId,
            category: details.category,
            bodyArea: details.bodyArea?.slice(0, 100),
            phaseLabel: details.phaseLabel?.slice(0, 50),
            fileKey: stored.key,
            mime: stored.mime,
            size: stored.size,
            takenAt: details.takenAt ?? new Date(),
            exifStripped: true,
            consentId: details.consentId,
            uploadedById: user.id,
            note: details.note?.slice(0, 1000),
          },
        });

        await this.audit.recordInTransaction(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.CREATE,
          entityType: 'photos',
          entityId: photo.id,
          patientId,
          after: photo,
        });

        return photo;
      });
    } catch (error) {
      await this.files
        .remove('photos', stored.key)
        .catch(() => this.logger.error(`Orphaned photo left behind: photos/${stored.key}`));

      throw error;
    }
  }

  /**
   * The before/after gallery: grouped by body area, oldest first inside each
   * group (spec M7).
   *
   * Ordered oldest first because a progression is read forwards — the point of
   * the gallery is what changed, and that only reads correctly in the direction
   * it happened.
   */
  async gallery(
    user: AuthenticatedUser,
    patientId: string,
    filter: { category?: PhotoCategory; bodyArea?: string } = {},
  ): Promise<GalleryGroup[]> {
    await this.access.assertCanAccess(user, patientId);

    const photos = await this.prisma.photo.findMany({
      where: {
        patientId,
        deletedAt: null,
        category: filter.category,
        bodyArea: filter.bodyArea,
      },
      orderBy: { takenAt: 'asc' },
    });

    const groups = new Map<string, GalleryGroup>();

    for (const photo of photos) {
      const key = photo.bodyArea ?? '';
      const group = groups.get(key) ?? { bodyArea: photo.bodyArea, photos: [] };
      group.photos.push(photo);
      groups.set(key, group);
    }

    return [...groups.values()].sort((a, b) =>
      (a.bodyArea ?? '').localeCompare(b.bodyArea ?? '', 'tr'),
    );
  }

  /**
   * The photo a new capture should be lined up against (spec M7).
   *
   * The most recent one of the same body area, because the guide exists to keep
   * angle and distance consistent, and the thing worth matching is the last
   * shot in the series rather than the first — drift accumulates between
   * neighbours, not against a photo from a year ago.
   */
  async overlayReference(
    user: AuthenticatedUser,
    patientId: string,
    bodyArea: string,
  ): Promise<Photo | null> {
    await this.access.assertCanAccess(user, patientId);

    return this.prisma.photo.findFirst({
      where: { patientId, bodyArea, deletedAt: null },
      orderBy: { takenAt: 'desc' },
    });
  }

  /**
   * A short-lived signed URL, and an audit entry.
   *
   * Photographs of a patient's body are the most sensitive thing in the record;
   * who looked at one and when is not optional (spec M7, M13).
   */
  async viewUrl(
    user: AuthenticatedUser,
    photoId: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const photo = await this.findInScope(user, photoId);

    const { url, expiresAt } = await this.files.createDownloadUrl('photos', photo.fileKey, {
      filename: `photo-${photo.id}`,
    });

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.READ,
      entityType: 'photos',
      entityId: photo.id,
      patientId: photo.patientId,
    });

    return { url, expiresAt };
  }

  /** Soft delete; the bytes go on the retention schedule, not here. */
  async remove(user: AuthenticatedUser, photoId: string): Promise<void> {
    const photo = await this.findInScope(user, photoId);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.photo.update({
        where: { id: photo.id },
        data: { deletedAt: new Date() },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.DELETE,
        entityType: 'photos',
        entityId: photo.id,
        patientId: photo.patientId,
        before: photo,
        after: updated,
      });
    });
  }

  /**
   * Photo-usage consent is its own consent and is revocable (spec M7).
   *
   * Checked when it is attached rather than trusted from the request: a photo
   * carrying a consent id that points at a treatment consent, or at a revoked
   * one, would read on every later screen as permission that was never given.
   */
  private async assertPhotoConsent(patientId: string, consentId: string): Promise<void> {
    const consent = await this.prisma.consent.findFirst({
      where: {
        id: consentId,
        patientId,
        type: ConsentType.PHOTO_USAGE,
        revokedAt: null,
      },
    });

    if (!consent) {
      throw new BadRequestException('No active photo-usage consent with that id for this patient');
    }
  }

  /** Out of scope reads as absent, never as forbidden. */
  private async findInScope(user: AuthenticatedUser, photoId: string): Promise<Photo> {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, deletedAt: null },
    });

    if (!photo) {
      throw new NotFoundException('Photo not found');
    }

    await this.access.assertCanAccess(user, photo.patientId);

    return photo;
  }
}
