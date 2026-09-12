import type { Photo } from '@prisma/client';

/**
 * A photograph as a client is allowed to see it.
 *
 * Prisma rows were going out whole. That put `fileKey` — the object-storage
 * key of a patient's clinical photograph — on the wire to every device, and
 * into every log and proxy between here and there. Downloads go through a
 * short-lived signed URL precisely so that the key never leaves this process;
 * sending the key beside the URL undoes the reason for the URL.
 *
 * Also gone: `thumbnailKey`, `uploadedById`, `aiModel` (the audit trail's, not
 * the client's — spec section 14.6), and the row's soft-delete bookkeeping.
 *
 * Written as an explicit list rather than an `Omit`, so a column added to the
 * table has to be added here on purpose before it can reach anybody.
 */
export interface PhotoView {
  id: string;
  category: Photo['category'];
  bodyArea: string | null;
  phaseLabel: string | null;
  mime: string;
  size: number;
  takenAt: Date;
  exifStripped: boolean;
  isFaceBlurred: boolean;
  consentId: string | null;
  note: string | null;
  aiReviewSuggested: boolean | null;
  aiFindings: string[];
  aiAssessedAt: Date | null;
}

export function photoView(photo: Photo): PhotoView {
  return {
    id: photo.id,
    category: photo.category,
    bodyArea: photo.bodyArea,
    phaseLabel: photo.phaseLabel,
    mime: photo.mime,
    size: photo.size,
    takenAt: photo.takenAt,
    exifStripped: photo.exifStripped,
    isFaceBlurred: photo.isFaceBlurred,
    consentId: photo.consentId,
    note: photo.note,
    aiReviewSuggested: photo.aiReviewSuggested,
    aiFindings: photo.aiFindings,
    aiAssessedAt: photo.aiAssessedAt,
  };
}
