import { stripJpeg, stripMetadata, stripPng } from './strip-metadata';

/** A JPEG segment: marker, length, payload. */
const segment = (marker: number, payload: Buffer): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, marker]),
    (() => {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(payload.length + 2);
      return length;
    })(),
    payload,
  ]);

const jpeg = (segments: Buffer[], scan = Buffer.from([0x11, 0x22, 0x33])): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...segments,
    Buffer.from([0xff, 0xda, 0x00, 0x02]),
    scan,
    Buffer.from([0xff, 0xd9]),
  ]);

const pngChunk = (type: string, payload: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  // The CRC is not checked here and is not recomputed: chunks are copied or
  // dropped whole, so every surviving chunk keeps the CRC it arrived with.
  return Buffer.concat([length, Buffer.from(type, 'ascii'), payload, Buffer.alloc(4)]);
};

const png = (chunks: Buffer[]): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunks,
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

/**
 * A wound photo with GPS in it is a patient's home address sitting in a
 * clinical bucket. Every test here is about that not happening.
 */
describe('stripping metadata from an image', () => {
  describe('JPEG', () => {
    it('removes the EXIF segment', () => {
      const exif = segment(0xe1, Buffer.from('Exif\0\0GPS 41.0 29.0'));
      const output = stripJpeg(jpeg([exif]));

      expect(output.includes(Buffer.from('GPS 41.0 29.0'))).toBe(false);
      expect(output.includes(Buffer.from('Exif'))).toBe(false);
    });

    it('removes an IPTC segment, which carries a location of its own', () => {
      const output = stripJpeg(jpeg([segment(0xed, Buffer.from('Photoshop 3.0 Istanbul'))]));

      expect(output.includes(Buffer.from('Istanbul'))).toBe(false);
    });

    it('removes a free-text comment', () => {
      const output = stripJpeg(jpeg([segment(0xfe, Buffer.from('taken at home'))]));

      expect(output.includes(Buffer.from('taken at home'))).toBe(false);
    });

    /** The image has to survive: a stripped file that will not open is no use. */
    it('keeps the JFIF header and the image data', () => {
      const jfif = segment(0xe0, Buffer.from('JFIF\0'));
      const quantisation = segment(0xdb, Buffer.alloc(64, 0x10));
      const scan = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);

      const output = stripJpeg(jpeg([jfif, segment(0xe1, Buffer.from('Exif\0\0x')), quantisation], scan));

      expect(output.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(output.includes(Buffer.from('JFIF'))).toBe(true);
      expect(output.includes(quantisation)).toBe(true);
      expect(output.includes(scan)).toBe(true);
      expect(output.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    });

    /**
     * Entropy-coded data after the start of scan can contain any byte pair,
     * including ones that look like markers. Parsing past it would corrupt the
     * image; it is copied verbatim instead.
     */
    it('copies scan data that looks like markers', () => {
      const scan = Buffer.from([0xff, 0x00, 0xff, 0xe1, 0x00, 0x08, 0x01, 0x02]);
      const output = stripJpeg(jpeg([segment(0xe1, Buffer.from('Exif\0\0'))], scan));

      expect(output.includes(scan)).toBe(true);
    });

    it('leaves a file that is not a JPEG alone', () => {
      const notJpeg = Buffer.from('not an image at all');

      expect(stripJpeg(notJpeg)).toEqual(notJpeg);
    });

    /** A malformed file must not send the parser into a loop. */
    it('stops on a segment whose length runs past the end', () => {
      const broken = Buffer.concat([
        Buffer.from([0xff, 0xd8]),
        Buffer.from([0xff, 0xe1, 0xff, 0xff]),
        Buffer.from([0x01, 0x02]),
      ]);

      expect(() => stripJpeg(broken)).not.toThrow();
    });
  });

  describe('PNG', () => {
    it('removes the eXIf chunk', () => {
      const output = stripPng(
        png([
          pngChunk('IHDR', Buffer.alloc(13)),
          pngChunk('eXIf', Buffer.from('GPS 41.0 29.0')),
          pngChunk('IDAT', Buffer.from('pixels')),
        ]),
      );

      expect(output.includes(Buffer.from('GPS 41.0 29.0'))).toBe(false);
      expect(output.includes(Buffer.from('pixels'))).toBe(true);
    });

    it.each(['tEXt', 'zTXt', 'iTXt'])('removes a %s chunk', (type) => {
      const output = stripPng(
        png([pngChunk('IHDR', Buffer.alloc(13)), pngChunk(type, Buffer.from('Comment home'))]),
      );

      expect(output.includes(Buffer.from('Comment home'))).toBe(false);
    });

    it('keeps the header, the pixels and the terminator', () => {
      const output = stripPng(
        png([pngChunk('IHDR', Buffer.alloc(13, 7)), pngChunk('IDAT', Buffer.from('pixels'))]),
      );

      expect(output.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(output.includes(Buffer.from('IHDR'))).toBe(true);
      expect(output.includes(Buffer.from('pixels'))).toBe(true);
      expect(output.includes(Buffer.from('IEND'))).toBe(true);
    });

    it('leaves a file that is not a PNG alone', () => {
      const notPng = Buffer.from('still not an image');

      expect(stripPng(notPng)).toEqual(notPng);
    });
  });

  describe('formats it cannot guarantee', () => {
    /**
     * HEIC is what an iPhone produces by default and its metadata sits inside a
     * box structure this does not parse. Saying so is the point: a record that
     * claimed the location had been removed would be worse than one that admits
     * it has not.
     */
    it('reports a format it cannot strip rather than claiming it did', () => {
      const heic = Buffer.from('ftypheic and some metadata');
      const result = stripMetadata(heic, 'image/heic');

      expect(result.stripped).toBe(false);
      expect(result.data).toEqual(heic);
    });

    it('reports success for the formats it does strip', () => {
      expect(stripMetadata(jpeg([]), 'image/jpeg').stripped).toBe(true);
      expect(stripMetadata(png([pngChunk('IHDR', Buffer.alloc(13))]), 'image/png').stripped).toBe(
        true,
      );
    });
  });
});
