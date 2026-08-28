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
  // HEIC/HEIF: phone cameras produce these by default, so clinical photos
  // routinely arrive in this format.
  { mime: 'image/heic', extension: 'heic', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
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

export function detectType(head: Buffer): DetectedType | null {
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

/** What a clinical photo may be. Narrower: no PDFs, no DICOM. */
export const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);
