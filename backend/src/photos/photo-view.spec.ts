import { PhotoCategory } from '@prisma/client';
import { photoView } from './photo-view';

/**
 * The row and what a client may see are two different things.
 *
 * Photographs used to go out as whole Prisma rows, so `fileKey` — where a
 * patient's clinical photograph lives in object storage — reached every
 * device, log and proxy, beside the short-lived signed URL that exists so it
 * would not have to.
 */
describe('photoView', () => {
  const row = {
    id: 'ph1',
    patientId: 'p1',
    category: PhotoCategory.WOUND,
    bodyArea: 'karın',
    phaseLabel: null,
    fileKey: 'photos/p1/2026/ph1.jpg',
    thumbnailKey: 'photos/p1/2026/ph1-thumb.jpg',
    mime: 'image/jpeg',
    size: 412_334,
    takenAt: new Date('2026-09-12T08:00:00Z'),
    isFaceBlurred: false,
    exifStripped: true,
    consentId: null,
    complicationId: 'c1',
    uploadedById: 'u1',
    note: null,
    createdAt: new Date('2026-09-12T08:01:00Z'),
    deletedAt: null,
    aiReviewSuggested: true,
    aiFindings: ['redness'],
    aiAssessedAt: new Date('2026-09-12T08:02:00Z'),
    aiModel: 'some-vision-model',
  };

  it('keeps nothing the client has no use for', () => {
    const view = photoView(row);

    for (const secret of [
      'fileKey',
      'thumbnailKey',
      'uploadedById',
      'aiModel',
      'complicationId',
      'deletedAt',
      'createdAt',
      'patientId',
    ]) {
      expect(view).not.toHaveProperty(secret);
    }
  });

  it('keeps everything a screen draws', () => {
    expect(photoView(row)).toEqual({
      id: 'ph1',
      category: PhotoCategory.WOUND,
      bodyArea: 'karın',
      phaseLabel: null,
      mime: 'image/jpeg',
      size: 412_334,
      takenAt: row.takenAt,
      exifStripped: true,
      isFaceBlurred: false,
      consentId: null,
      note: null,
      aiReviewSuggested: true,
      aiFindings: ['redness'],
      aiAssessedAt: row.aiAssessedAt,
    });
  });
});
