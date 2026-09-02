import type { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';

/**
 * Reads a stream into memory, refusing to exceed a limit.
 *
 * Photos are buffered rather than streamed because metadata is stripped by
 * rewriting the container, which needs the whole file. The limit is enforced
 * while reading, not after: a Content-Length header is a claim by an untrusted
 * client, and "read it all, then check" is how one request eats the heap.
 */
export async function readBounded(source: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of source) {
    const buffer = chunk as Buffer;
    size += buffer.length;

    if (size > maxBytes) {
      source.destroy();
      throw new BadRequestException(`Photo exceeds the ${maxBytes} byte limit`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}
