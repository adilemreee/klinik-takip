import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Env } from '../src/config/env.schema';
import { DOCUMENT_MIME_TYPES, PHOTO_MIME_TYPES } from '../src/files/file-type';
import { FileService } from '../src/files/file.service';
import { StorageService } from '../src/infra/storage.service';

/**
 * File storage against a real MinIO.
 *
 * The guarantees here are the ones spec section 8 states outright: nothing is
 * publicly readable, access is only ever through a short-lived signed URL, and
 * what a client claims a file is does not decide how it is stored.
 */
describe('file storage', () => {
  let files: FileService;
  let storage: StorageService;
  const stored: { bucket: 'documents' | 'photos'; key: string }[] = [];

  const pdf = (padding = 1024): Buffer =>
    Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(padding, 0x20)]);
  const jpeg = (padding = 512): Buffer =>
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(padding, 0x11)]);

  const documentOptions = {
    bucket: 'documents' as const,
    allowedMimeTypes: DOCUMENT_MIME_TYPES,
    maxBytes: 20 * 1024 * 1024,
  };
  const photoOptions = {
    bucket: 'photos' as const,
    allowedMimeTypes: PHOTO_MIME_TYPES,
    maxBytes: 20 * 1024 * 1024,
  };

  const upload = async (
    content: Buffer,
    options: typeof documentOptions | typeof photoOptions,
  ): Promise<{ key: string; mime: string; size: number; checksum: string }> => {
    const result = await files.upload(Readable.from(content), options);
    stored.push({ bucket: options.bucket, key: result.key });
    return result;
  };

  beforeAll(async () => {
    const config = {
      get: (key: string) => process.env[key] ?? undefined,
    } as unknown as ConfigService<Env, true>;

    const moduleRef = await Test.createTestingModule({
      providers: [FileService, StorageService, { provide: ConfigService, useValue: config }],
    }).compile();

    files = moduleRef.get(FileService);
    storage = moduleRef.get(StorageService);
  });

  afterAll(async () => {
    for (const item of stored) {
      await files.remove(item.bucket, item.key).catch(() => undefined);
    }
  });

  describe('uploading', () => {
    it('stores a PDF and reports what it actually is', async () => {
      const content = pdf();
      const result = await upload(content, documentOptions);

      expect(result.mime).toBe('application/pdf');
      expect(result.size).toBe(content.length);
      expect(result.key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    });

    it('computes a checksum of the stored bytes', async () => {
      const content = pdf(2048);
      const result = await upload(content, documentOptions);

      expect(result.checksum).toBe(createHash('sha256').update(content).digest('hex'));
    });

    it('stores a JPEG in the photo bucket', async () => {
      const result = await upload(jpeg(), photoOptions);

      expect(result.mime).toBe('image/jpeg');
    });

    /**
     * The bucket a file lands in decides what may be there. A PDF is a valid
     * document and not a valid clinical photo.
     */
    it('refuses a PDF in the photo bucket', async () => {
      await expect(files.upload(Readable.from(pdf()), photoOptions)).rejects.toThrow(
        /not allowed here/,
      );
    });

    it('refuses content it cannot identify', async () => {
      await expect(
        files.upload(Readable.from(Buffer.from('plain text, not a document')), documentOptions),
      ).rejects.toThrow(/Unrecognised/);
    });

    /** The point of sniffing: the extension and the header are both claims. */
    it('refuses an executable however it is presented', async () => {
      const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(512)]);

      await expect(files.upload(Readable.from(elf), documentOptions)).rejects.toThrow();
    });

    it('refuses HTML, which a viewer would execute', async () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>');

      await expect(files.upload(Readable.from(html), documentOptions)).rejects.toThrow();
    });

    /**
     * Enforced while streaming, not from Content-Length: a client can declare
     * one megabyte and send a gigabyte.
     */
    it('refuses a file over the size limit', async () => {
      const big = pdf(200 * 1024);

      await expect(
        files.upload(Readable.from(big), { ...documentOptions, maxBytes: 50 * 1024 }),
      ).rejects.toThrow(/exceeds/);
    });

    it('accepts a file exactly at the limit', async () => {
      const content = pdf(1024);
      const result = await upload(content, { ...documentOptions, maxBytes: content.length });

      expect(result.size).toBe(content.length);
    });
  });

  describe('signed download URLs', () => {
    it('serves the stored bytes', async () => {
      const content = pdf();
      const { key } = await upload(content, documentOptions);

      const { url } = await files.createDownloadUrl('documents', key);
      const response = await fetch(url);

      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
    });

    /**
     * Forced download under the type detected at upload. Serving a stored file
     * inline under a client-chosen type is how an uploaded document becomes
     * script execution in someone's browser.
     */
    it('forces a download rather than inline rendering', async () => {
      const { key } = await upload(pdf(), documentOptions);

      const { url } = await files.createDownloadUrl('documents', key, { filename: 'report.pdf' });
      const response = await fetch(url);

      expect(response.headers.get('content-disposition')).toContain('attachment');
      expect(response.headers.get('content-disposition')).toContain('report.pdf');
      expect(response.headers.get('content-type')).toBe('application/pdf');
    });

    it('strips characters that would break out of the filename header', async () => {
      const { key } = await upload(pdf(), documentOptions);

      const { url } = await files.createDownloadUrl('documents', key, {
        filename: 'evil"; attachment; x="a.pdf',
      });
      const response = await fetch(url);
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]*)"/.exec(disposition)?.[1] ?? '';

      // The injection characters are what matter: with quotes and semicolons
      // gone, the payload cannot open a second header parameter. The word
      // 'attachment' surviving inside the filename text is harmless.
      expect(filename).not.toContain('"');
      expect(filename).not.toContain(';');
      expect(disposition).toMatch(/^attachment; filename="[^";]*"$/);
    });

    it('caps the lifetime at the configured maximum', async () => {
      const { key } = await upload(pdf(), documentOptions);
      const max = Number(process.env.S3_SIGNED_URL_TTL_SECONDS ?? 300);

      const { expiresAt } = await files.createDownloadUrl('documents', key, {
        expiresIn: 999_999,
      });

      expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(max * 1000 + 2000);
    });

    it('rejects a signature that has expired', async () => {
      const { key } = await upload(pdf(), documentOptions);

      const { url } = await files.createDownloadUrl('documents', key, { expiresIn: 1 });
      await new Promise((resolve) => setTimeout(resolve, 2500));

      expect((await fetch(url)).status).toBe(403);
    });

    it('rejects a tampered signature', async () => {
      const { key } = await upload(pdf(), documentOptions);

      const { url } = await files.createDownloadUrl('documents', key);
      const tampered = url.replace(/X-Amz-Signature=([0-9a-f]{4})/, 'X-Amz-Signature=0000');

      expect((await fetch(tampered)).status).toBe(403);
    });
  });

  /** Spec section 8: no object is ever readable without a signature. */
  describe('bucket privacy', () => {
    it('refuses an unsigned request for a stored object', async () => {
      const { key } = await upload(pdf(), documentOptions);
      const endpoint = process.env.S3_ENDPOINT;
      const bucket = process.env.S3_BUCKET_DOCUMENTS;

      const response = await fetch(`${endpoint}/${bucket}/${key}`);

      expect(response.status).toBe(403);
    });

    it('refuses to list the bucket anonymously', async () => {
      const response = await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_DOCUMENTS}`);

      expect(response.status).toBe(403);
    });
  });

  describe('key handling', () => {
    it.each(['../../etc/passwd', '/absolute', 'a//b', 'has spaces'])(
      'refuses the unsafe key %s',
      async (key) => {
        await expect(files.createDownloadUrl('documents', key)).rejects.toThrow(/Invalid object key/);
      },
    );

    it('reports a missing object as not found', async () => {
      await expect(
        files.stat('documents', '2020/01/00000000-0000-7000-8000-000000000000.pdf'),
      ).rejects.toThrow(/not found/i);
    });

    it('reports size and type for a stored object', async () => {
      const content = pdf(4096);
      const { key } = await upload(content, documentOptions);

      const info = await files.stat('documents', key);

      expect(info.size).toBe(content.length);
      expect(info.mime).toBe('application/pdf');
    });
  });

  it('keeps buckets separate', async () => {
    const { key } = await upload(jpeg(), photoOptions);

    // The same key in the other bucket must not resolve.
    await expect(files.stat('documents', key)).rejects.toThrow(/not found/i);
    expect((await files.stat('photos', key)).mime).toBe('image/jpeg');
    expect(storage).toBeDefined();
  });
});
