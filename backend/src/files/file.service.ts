import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { StorageService } from '../infra/storage.service';
import { DetectedType, SNIFF_LENGTH, detectType } from './file-type';
import { buildObjectKey, isSafeObjectKey } from './object-key';
import { peekStream } from './stream-head';

export type FileBucket = 'documents' | 'photos';

/** Used when the configured lifetime is missing or unusable. */
const DEFAULT_TTL_SECONDS = 300;

export interface UploadOptions {
  bucket: FileBucket;
  /** Types the caller is willing to accept, checked against the sniffed type. */
  allowedMimeTypes: Set<string>;
  maxBytes: number;
  originalName?: string;
}

export interface StoredFile {
  key: string;
  mime: string;
  size: number;
  /** SHA-256 of the stored bytes, for integrity checks and de-duplication. */
  checksum: string;
}

export interface DownloadOptions {
  /** Filename offered to the user; defaults to the object key's basename. */
  filename?: string;
  /** Seconds; capped by S3_SIGNED_URL_TTL_SECONDS. */
  expiresIn?: number;
}

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Streams an upload straight into object storage.
   *
   * Nothing is written to the server filesystem (spec section 8) and the body
   * is never held in memory in full — only the first bytes, to determine what
   * it actually is.
   */
  async upload(source: Readable, options: UploadOptions): Promise<StoredFile> {
    const { head, stream } = await peekStream(source, SNIFF_LENGTH);

    const detected = detectType(head);
    if (!detected) {
      throw new BadRequestException('Unrecognised file type');
    }

    if (!options.allowedMimeTypes.has(detected.mime)) {
      // The sniffed type decides, not the Content-Type header: a header is a
      // claim by an untrusted client.
      throw new BadRequestException(`File type not allowed here: ${detected.mime}`);
    }

    const key = buildObjectKey(detected.extension);
    const { size, checksum } = await this.putWithLimit(
      this.bucketName(options.bucket),
      key,
      stream,
      detected,
      options.maxBytes,
    );

    this.logger.log(`Stored ${size} bytes as ${options.bucket}/${key} (${detected.mime})`);

    return { key, mime: detected.mime, size, checksum };
  }

  /**
   * A short-lived signed URL. There is no other way to read a stored file:
   * both buckets are private and no object is ever publicly readable
   * (spec section 8).
   */
  async createDownloadUrl(
    bucket: FileBucket,
    key: string,
    options: DownloadOptions = {},
  ): Promise<{ url: string; expiresAt: Date }> {
    if (!isSafeObjectKey(key)) {
      throw new BadRequestException('Invalid object key');
    }

    const ttl = this.resolveTtl(options.expiresIn);
    const filename = options.filename ?? key.split('/').pop() ?? 'file';

    const stat = await this.stat(bucket, key);

    const url = await this.storage.client.presignedGetObject(
      this.bucketName(bucket),
      key,
      ttl,
      {
        // Forced download with the type we detected at upload time. Serving a
        // stored file inline under a client-chosen type is how an uploaded
        // document turns into script execution.
        'response-content-disposition': `attachment; filename="${this.sanitiseFilename(filename)}"`,
        'response-content-type': stat.mime,
      },
    );

    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async stat(bucket: FileBucket, key: string): Promise<{ size: number; mime: string }> {
    if (!isSafeObjectKey(key)) {
      throw new BadRequestException('Invalid object key');
    }

    try {
      const info = await this.storage.client.statObject(this.bucketName(bucket), key);

      // MinIO types object metadata with an `any` index signature; narrow it
      // rather than letting an untyped value out of this method.
      const contentType = (info.metaData as Record<string, string | undefined>)['content-type'];

      return { size: info.size, mime: contentType ?? 'application/octet-stream' };
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  /**
   * Removes an object. Clinical files are soft-deleted in the database and
   * their bytes are only removed once the legal retention period expires
   * (spec section 8), so this is not called on a user "delete" action.
   */
  async remove(bucket: FileBucket, key: string): Promise<void> {
    if (!isSafeObjectKey(key)) {
      throw new BadRequestException('Invalid object key');
    }

    await this.storage.client.removeObject(this.bucketName(bucket), key);
    this.logger.warn(`Permanently removed ${bucket}/${key}`);
  }

  /**
   * Resolves the signed-URL lifetime, defensively.
   *
   * The validated config always supplies a number, but a misconfiguration must
   * not be able to widen this: an unparsable value would make Math.min return
   * NaN, and a NaN expiry produces a URL that lives for days rather than
   * minutes — the exact opposite of the property this setting exists to
   * guarantee. Anything unusable falls back to the safe default.
   */
  private resolveTtl(requested?: number): number {
    const configured = Number(this.config.get('S3_SIGNED_URL_TTL_SECONDS', { infer: true }));
    const cap = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_SECONDS;

    if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
      return cap;
    }

    return Math.min(requested, cap);
  }

  private bucketName(bucket: FileBucket): string {
    return bucket === 'documents'
      ? this.config.get('S3_BUCKET_DOCUMENTS', { infer: true })
      : this.config.get('S3_BUCKET_PHOTOS', { infer: true });
  }

  /**
   * Enforces the size limit while streaming.
   *
   * The check has to happen during the transfer, not after: trusting a
   * Content-Length header would let a client declare 1 MB and send a gigabyte.
   */
  private async putWithLimit(
    bucket: string,
    key: string,
    stream: Readable,
    detected: DetectedType,
    maxBytes: number,
  ): Promise<{ size: number; checksum: string }> {
    const hash = createHash('sha256');
    let size = 0;

    // A Transform, not a 'data' listener plus pipe(): attaching a listener puts
    // the stream into flowing mode, and the piped consumer then races it for
    // the chunks. Measuring inside the pipeline is the only way to see every
    // byte exactly once.
    const measured = new Transform({
      transform(chunk: Buffer, _encoding, callback): void {
        size += chunk.length;

        if (size > maxBytes) {
          callback(new BadRequestException(`File exceeds the ${maxBytes} byte limit`));
          return;
        }

        hash.update(chunk);
        callback(null, chunk);
      },
    });

    stream.pipe(measured);

    // putObject does not reject when the stream it is reading errors — it just
    // stops receiving data and waits. Racing the two means a rejected upload
    // surfaces as a rejected request instead of a hang, and it also gives the
    // stream error a listener, which Node otherwise reports as unhandled.
    const failed = new Promise<never>((_resolve, reject) => {
      measured.once('error', reject);
    });

    const upload = this.storage.client.putObject(bucket, key, measured, undefined, {
      'Content-Type': detected.mime,
    });

    try {
      await Promise.race([upload, failed]);
    } catch (error) {
      // Stop the source so an aborted upload does not keep pulling bytes.
      stream.destroy();
      measured.destroy();
      // The orphaned putObject may still settle later; swallow it so it cannot
      // surface as an unhandled rejection after the request has already failed.
      void upload.catch(() => undefined);
      throw error;
    }

    return { size, checksum: hash.digest('hex') };
  }

  /** Keeps a user-supplied name from breaking out of the header. */
  private sanitiseFilename(name: string): string {
    return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  }
}
