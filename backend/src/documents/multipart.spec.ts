import { Readable } from 'node:stream';
import type { Request } from 'express';
import { firstFilePart } from './multipart';

/** A multipart body, assembled the way a browser would send one. */
function multipartRequest(
  parts: { name: string; value?: string; filename?: string; content?: Buffer }[],
): Request {
  const boundary = '----klinikTestBoundary';
  const chunks: Buffer[] = [];

  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;

    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: ${disposition}\r\n` +
          (part.filename ? 'Content-Type: application/octet-stream\r\n' : '') +
          '\r\n',
      ),
    );
    chunks.push(part.content ?? Buffer.from(part.value ?? ''));
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  const stream = Readable.from([Buffer.concat(chunks)]) as unknown as Request;
  stream.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };

  return stream;
}

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

describe('reading a multipart upload', () => {
  it('hands back the file part as a stream', async () => {
    const request = multipartRequest([
      { name: 'type', value: 'LAB' },
      { name: 'file', filename: 'result.pdf', content: Buffer.from('%PDF-1.4 body') },
    ]);

    const part = await firstFilePart(request, 1024);

    expect(part.filename).toBe('result.pdf');
    expect(part.fields.type).toBe('LAB');
    expect((await drain(part.stream)).toString()).toBe('%PDF-1.4 body');
  });

  /**
   * The promise resolves when the file part *starts*, not when it ends —
   * otherwise the whole body would have to be buffered first, which is the one
   * thing this function exists to avoid.
   */
  it('resolves before the file has finished arriving', async () => {
    const request = multipartRequest([
      { name: 'file', filename: 'big.pdf', content: Buffer.alloc(64 * 1024, 0x41) },
    ]);

    const part = await firstFilePart(request, 1024 * 1024);

    expect(part.stream.readableEnded).toBe(false);
  });

  it('refuses a request that is not multipart', async () => {
    const request = Readable.from([Buffer.from('{}')]) as unknown as Request;
    request.headers = { 'content-type': 'application/json' };

    await expect(firstFilePart(request, 1024)).rejects.toThrow(/multipart/i);
  });

  /** A form submitted with no file selected must not look like an empty file. */
  it('refuses a multipart body with no file part', async () => {
    const request = multipartRequest([{ name: 'type', value: 'LAB' }]);

    await expect(firstFilePart(request, 1024)).rejects.toThrow(/No file/i);
  });

  it('reports the type the client declared without trusting it', async () => {
    const request = multipartRequest([
      { name: 'file', filename: 'x.pdf', content: Buffer.from('MZ not a pdf') },
    ]);

    const part = await firstFilePart(request, 1024);

    // Recorded as a claim; the stored type comes from sniffing the bytes.
    expect(part.declaredMime).toBe('application/octet-stream');
  });
})
