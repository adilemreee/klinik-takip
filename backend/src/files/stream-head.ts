import { PassThrough, Readable } from 'node:stream';

export interface PeekedStream {
  /** The first bytes, for content sniffing. */
  head: Buffer;
  /** The complete stream, including the bytes already read. */
  stream: Readable;
}

/**
 * Reads the first `length` bytes of a stream and returns a stream that still
 * yields them.
 *
 * Needed because the content type has to be determined from the bytes before
 * the object is stored, and buffering a 20 MB upload to do it would put every
 * concurrent upload in memory at once.
 */
export async function peekStream(source: Readable, length: number): Promise<PeekedStream> {
  const chunks: Buffer[] = [];
  let collected = 0;

  // destroyOnReturn: false is essential. Breaking out of a plain `for await`
  // destroys the source stream, so the remaining bytes would never arrive and
  // the upload would hang waiting for an end that never comes.
  for await (const chunk of source.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    chunks.push(buffer);
    collected += buffer.length;

    if (collected >= length) {
      break;
    }
  }

  const head = Buffer.concat(chunks).subarray(0, length);
  const replay = Buffer.concat(chunks);

  const output = new PassThrough();
  output.write(replay);

  // The source may still hold data if the loop broke early; pipe the rest.
  if (!source.readableEnded) {
    source.pipe(output);
  } else {
    output.end();
  }

  source.on('error', (error) => output.destroy(error));

  return { head, stream: output };
}
