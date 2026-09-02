/**
 * Removing metadata from an image before it is stored.
 *
 * A photograph taken on a phone carries where it was taken. A wound photo with
 * GPS coordinates in it is a patient's home address sitting in a clinical
 * bucket, and it will outlive every conversation about whether that was wise
 * (spec M7 asks for EXIF location to be stripped).
 *
 * Done by rewriting the container rather than by re-encoding: re-encoding needs
 * a native image library, loses quality on every pass, and would still have to
 * be told which metadata to keep. Deleting the segments that carry it is exact,
 * dependency-free, and testable.
 */

export interface StripResult {
  data: Buffer;
  /** False when the format is one this cannot guarantee. */
  stripped: boolean;
}

/** JPEG markers whose whole segment is metadata. */
const JPEG_DROP = new Set([
  0xe1, // APP1 — EXIF and XMP, where location lives
  0xe2, // APP2 — mostly ICC, but also FlashPix; see below
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec,
  0xed, // APP13 — IPTC, which carries a location field of its own
  0xee, 0xef,
  0xfe, // COM — free-text comment
]);

/** PNG chunks that carry text or metadata rather than pixels. */
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

export function stripMetadata(data: Buffer, mime: string): StripResult {
  if (mime === 'image/jpeg') return { data: stripJpeg(data), stripped: true };
  if (mime === 'image/png') return { data: stripPng(data), stripped: true };

  // Anything else is stored as it arrived and marked as unstripped, so the
  // record never claims a guarantee that was not made.
  return { data, stripped: false };
}

/**
 * Rewrites a JPEG without its metadata segments.
 *
 * ICC colour profiles live in APP2 and are dropped along with the rest. That
 * costs colour accuracy on a wide-gamut display, which for a wound photograph
 * is a real if small loss — accepted because APP2 also carries FlashPix, which
 * embeds a second copy of the image complete with its own EXIF, and telling
 * them apart reliably is more machinery than the colour is worth.
 */
export function stripJpeg(data: Buffer): Buffer {
  // Not a JPEG after all: hand it back rather than mangling it. The caller has
  // already sniffed the type, so this is a guard, not a code path.
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return data;

  const parts: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;

  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) break;

    const marker = data[offset + 1]!;

    // Start of scan: everything after it is entropy-coded image data with no
    // segment structure, so it is copied verbatim to the end.
    if (marker === 0xda) {
      parts.push(data.subarray(offset));
      return Buffer.concat(parts);
    }

    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(data.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    const length = data.readUInt16BE(offset + 2);
    // A length shorter than its own field means the file is malformed; copying
    // the rest untouched is safer than looping forever on it.
    if (length < 2 || offset + 2 + length > data.length) {
      parts.push(data.subarray(offset));
      break;
    }

    if (!JPEG_DROP.has(marker)) {
      parts.push(data.subarray(offset, offset + 2 + length));
    }

    offset += 2 + length;
  }

  return Buffer.concat(parts);
}

/** Rewrites a PNG without its text and metadata chunks. */
export function stripPng(data: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  if (data.length < 8 || !data.subarray(0, 8).equals(signature)) return data;

  const parts: Buffer[] = [signature];
  let offset = 8;

  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    // 4 length + 4 type + data + 4 CRC.
    const end = offset + 12 + length;

    if (end > data.length) {
      parts.push(data.subarray(offset));
      break;
    }

    if (!PNG_DROP.has(type)) {
      parts.push(data.subarray(offset, end));
    }

    offset = end;

    if (type === 'IEND') break;
  }

  return Buffer.concat(parts);
}
