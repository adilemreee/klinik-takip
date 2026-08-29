import type { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import Busboy from 'busboy';
import type { Request } from 'express';

export interface MultipartFile {
  stream: Readable;
  filename?: string;
  /** What the client claimed. Kept for the record; never trusted. */
  declaredMime?: string;
  /** Text fields that arrived before the file. */
  fields: Record<string, string>;
}

/**
 * The first file part of a multipart request, as a stream.
 *
 * Streamed rather than buffered because nothing may touch the server
 * filesystem (spec section 8) and a 20 MB body per concurrent upload held in
 * memory is a denial of service waiting to happen. The consumer reads the
 * stream straight into object storage.
 *
 * Resolves as soon as the file part starts, not when it ends: the caller needs
 * the stream while it is still filling.
 */
export function firstFilePart(request: Request, maxBytes: number): Promise<MultipartFile> {
  return new Promise((resolve, reject) => {
    const type = request.headers['content-type'];

    if (!type?.includes('multipart/form-data')) {
      reject(new BadRequestException('Expected a multipart/form-data upload'));
      return;
    }

    const fields: Record<string, string> = {};
    let settled = false;

    const busboy = Busboy({
      headers: request.headers,
      limits: {
        fileSize: maxBytes,
        files: 1,
        // Text fields carry the document type and an optional note; a request
        // with more than a handful of them is not one of ours.
        fields: 10,
        fieldSize: 4 * 1024,
      },
    });

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      request.unpipe(busboy);
      reject(error);
    };

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (_name, stream, info) => {
      if (settled) {
        stream.resume();
        return;
      }

      settled = true;
      resolve({
        stream,
        filename: info.filename,
        declaredMime: info.mimeType,
        fields,
      });
    });

    busboy.on('error', (error) => fail(error as Error));

    // No file part at all: resolving with nothing would make every caller
    // handle an empty case that is really a malformed request.
    busboy.on('close', () => fail(new BadRequestException('No file was uploaded')));

    request.pipe(busboy);
  });
}
