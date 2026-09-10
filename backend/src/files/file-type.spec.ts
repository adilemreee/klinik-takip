import { DOCUMENT_MIME_TYPES, PHOTO_MIME_TYPES, SNIFF_LENGTH, detectType } from './file-type';
import { buildObjectKey, isSafeObjectKey } from './object-key';

const withHeader = (bytes: number[], offset = 0): Buffer => {
  const buffer = Buffer.alloc(SNIFF_LENGTH);
  bytes.forEach((byte, index) => {
    buffer[offset + index] = byte;
  });
  return buffer;
};

/**
 * An ISO base media header: `....ftyp` and then the brand.
 *
 * The brand is the whole point. Every MP4, M4A, MOV and HEIC begins the same
 * way, and only what follows says which one it is.
 */
const isoHeader = (brand: string): Buffer => {
  const buffer = Buffer.alloc(SNIFF_LENGTH);
  buffer.write('ftyp', 4, 'latin1');
  buffer.write(brand, 8, 'latin1');
  return buffer;
};

describe('content type detection', () => {
  it.each([
    ['PDF', [0x25, 0x50, 0x44, 0x46], 0, 'application/pdf'],
    ['JPEG', [0xff, 0xd8, 0xff], 0, 'image/jpeg'],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0, 'image/png'],
    ['DICOM', [0x44, 0x49, 0x43, 0x4d], 128, 'application/dicom'],
    ['MP3', [0x49, 0x44, 0x33], 0, 'audio/mpeg'],
  ])('recognises %s', (_label, bytes, offset, mime) => {
    expect(detectType(withHeader(bytes, offset))?.mime).toBe(mime);
  });

  it.each([
    ['HEIC', 'heic', 'image/heic'],
    ['HEIF', 'mif1', 'image/heic'],
    ['M4A', 'M4A ', 'audio/mp4'],
  ])('reads the brand of an ISO base media file: %s', (_label, brand, mime) => {
    expect(detectType(isoHeader(brand))?.mime).toBe(mime);
  });

  /**
   * The bug this replaced.
   *
   * "`ftyp` at offset 4" is every MP4, M4A and MOV ever made, so a patient's
   * voice message was detected as `image/heic` and filed as a photograph. The
   * sniffer exists precisely so a file is what its bytes say.
   */
  it('does not read a voice message as a photograph', () => {
    expect(detectType(isoHeader('M4A '))?.mime).toBe('audio/mp4');
    expect(detectType(isoHeader('M4A '))?.extension).toBe('m4a');
  });

  /// A brand nobody recognises is refused rather than filed as a guess — the
  /// same conservative half of every other decision in this file.
  it('refuses an ISO file whose brand it does not know', () => {
    expect(detectType(isoHeader('qt  '))).toBeNull();
    expect(detectType(isoHeader('avc1'))).toBeNull();
  });

  it('refuses a truncated ISO header', () => {
    const truncated = Buffer.alloc(10);
    truncated.write('ftyp', 4, 'latin1');

    expect(detectType(truncated)).toBeNull();
  });

  it('returns null for content it does not recognise', () => {
    expect(detectType(Buffer.from('this is just some text'))).toBeNull();
  });

  /**
   * The whole reason sniffing exists: a client can claim any Content-Type, so
   * an executable renamed to .pdf must not be stored as a PDF.
   */
  it('does not recognise an executable, whatever it is called', () => {
    // ELF header.
    expect(detectType(withHeader([0x7f, 0x45, 0x4c, 0x46]))).toBeNull();
  });

  it('does not recognise HTML, which a viewer would happily execute', () => {
    expect(detectType(Buffer.from('<!DOCTYPE html><script>alert(1)</script>'))).toBeNull();
  });

  it('handles a buffer shorter than the longest signature offset', () => {
    expect(() => detectType(Buffer.from([0x25, 0x50]))).not.toThrow();
  });

  it('allows PDFs as documents but not as clinical photos', () => {
    expect(DOCUMENT_MIME_TYPES.has('application/pdf')).toBe(true);
    expect(PHOTO_MIME_TYPES.has('application/pdf')).toBe(false);
  });
});

describe('object keys', () => {
  /**
   * A key like patients/<mrn>/passport.pdf would leak the file number and the
   * document's nature to anything that ever sees the key.
   */
  it('carries no patient information', () => {
    const key = buildObjectKey('pdf');

    expect(key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
  });

  it('is unique across calls', () => {
    const keys = new Set(Array.from({ length: 200 }, () => buildObjectKey('jpg')));

    expect(keys.size).toBe(200);
  });

  it('normalises the extension', () => {
    expect(buildObjectKey('.PDF')).toMatch(/\.pdf$/);
  });

  it('works without an extension', () => {
    expect(buildObjectKey()).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
  });

  it.each([
    ['../../etc/passwd', 'path traversal'],
    ['/absolute/path', 'absolute path'],
    ['a//b', 'empty segment'],
    ['key with spaces', 'unexpected characters'],
    ['', 'empty'],
    [`${'a'.repeat(600)}`, 'absurdly long'],
  ])('rejects %s (%s)', (key) => {
    expect(isSafeObjectKey(key)).toBe(false);
  });

  it('accepts the keys it generates', () => {
    expect(isSafeObjectKey(buildObjectKey('pdf'))).toBe(true);
  });
});
