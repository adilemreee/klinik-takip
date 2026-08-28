import { DOCUMENT_MIME_TYPES, PHOTO_MIME_TYPES, SNIFF_LENGTH, detectType } from './file-type';
import { buildObjectKey, isSafeObjectKey } from './object-key';

const withHeader = (bytes: number[], offset = 0): Buffer => {
  const buffer = Buffer.alloc(SNIFF_LENGTH);
  bytes.forEach((byte, index) => {
    buffer[offset + index] = byte;
  });
  return buffer;
};

describe('content type detection', () => {
  it.each([
    ['PDF', [0x25, 0x50, 0x44, 0x46], 0, 'application/pdf'],
    ['JPEG', [0xff, 0xd8, 0xff], 0, 'image/jpeg'],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0, 'image/png'],
    ['HEIC', [0x66, 0x74, 0x79, 0x70], 4, 'image/heic'],
    ['DICOM', [0x44, 0x49, 0x43, 0x4d], 128, 'application/dicom'],
  ])('recognises %s', (_label, bytes, offset, mime) => {
    expect(detectType(withHeader(bytes, offset))?.mime).toBe(mime);
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
