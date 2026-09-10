/**
 * Content type detection from the bytes, not from what the client said.
 *
 * A browser-supplied Content-Type is a hint from an untrusted source. Storing a
 * file as `application/pdf` because the uploader said so means a signed URL can
 * later serve arbitrary content under a type the viewer trusts.
 */

export interface DetectedType {
  mime: string;
  extension: string;
}

interface Signature {
  mime: string;
  extension: string;
  offset: number;
  bytes: number[];
}

const SIGNATURES: Signature[] = [
  { mime: 'application/pdf', extension: 'pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/jpeg', extension: 'jpg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  {
    mime: 'image/png',
    extension: 'png',
    offset: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mime: 'image/gif', extension: 'gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', extension: 'webp', offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  // MP3 with an ID3 tag, which is what most of them have.
  { mime: 'audio/mpeg', extension: 'mp3', offset: 0, bytes: [0x49, 0x44, 0x33] },
  // DICOM carries the magic at offset 128, after the preamble.
  {
    mime: 'application/dicom',
    extension: 'dcm',
    offset: 128,
    bytes: [0x44, 0x49, 0x43, 0x4d],
  },
];

/** Bytes needed before a decision can be made. */
export const SNIFF_LENGTH = 132;

/**
 * ISO base media files all begin `....ftyp`, and the brand that follows is the
 * only thing that says what they are.
 *
 * This mattered: the HEIC rule used to be "`ftyp` at offset 4", which is every
 * MP4, M4A and MOV ever made. A patient's voice message was therefore detected
 * as `image/heic` and filed as a photograph — the sniffer exists precisely so
 * that a file is what its bytes say, and this was it getting that wrong.
 *
 * Brands are matched exactly rather than by prefix, and only the ones we
 * actually accept. A brand nobody recognises is refused, which is the
 * conservative half of every other decision in this file: an unrecognised file
 * is rejected, never filed as a guess.
 */
const ISO_BRANDS: Record<string, DetectedType> = {
  // Apple's audio brands, which is what AVAudioRecorder writes.
  'M4A ': { mime: 'audio/mp4', extension: 'm4a' },
  'M4B ': { mime: 'audio/mp4', extension: 'm4a' },
  // HEIC/HEIF: phone cameras produce these by default, so clinical photos
  // routinely arrive in this format.
  heic: { mime: 'image/heic', extension: 'heic' },
  heix: { mime: 'image/heic', extension: 'heic' },
  hevc: { mime: 'image/heic', extension: 'heic' },
  hevx: { mime: 'image/heic', extension: 'heic' },
  mif1: { mime: 'image/heic', extension: 'heic' },
  msf1: { mime: 'image/heic', extension: 'heic' },
};

/** The brand of an ISO base media file, or nil if it is not one. */
function isoBrand(head: Buffer): DetectedType | null {
  if (head.length < 12) return null;

  const ftyp = head.subarray(4, 8).toString('latin1');

  if (ftyp !== 'ftyp') return null;

  return ISO_BRANDS[head.subarray(8, 12).toString('latin1')] ?? null;
}

export function detectType(head: Buffer): DetectedType | null {
  const iso = isoBrand(head);

  if (iso) return iso;

  for (const signature of SIGNATURES) {
    const end = signature.offset + signature.bytes.length;

    if (head.length < end) {
      continue;
    }

    const matches = signature.bytes.every(
      (byte, index) => head[signature.offset + index] === byte,
    );

    if (matches) {
      return { mime: signature.mime, extension: signature.extension };
    }
  }

  return null;
}

/** What a clinical document may be. */
export const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/dicom',
]);

/** What a voice message may be. */
export const AUDIO_MIME_TYPES = new Set(['audio/mp4', 'audio/mpeg']);

/** What a clinical photo may be. Narrower: no PDFs, no DICOM. */
export const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);
