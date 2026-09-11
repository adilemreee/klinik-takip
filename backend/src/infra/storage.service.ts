import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { Env } from '../config/env.schema';

/**
 * S3-compatible object storage. Patient documents and photos never touch the
 * server filesystem — they go straight to a private bucket and are handed out
 * only as short-lived signed URLs (spec section 8).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  /** Reading and writing objects. Reached over the internal network. */
  readonly client: MinioClient;

  /**
   * Signing download URLs, which is a different question from reaching the
   * storage.
   *
   * The host is part of an AWS v4 signature, so a URL signed against the
   * internal address stays signed against the internal address — it cannot be
   * rewritten afterwards without invalidating it. What that produced was a
   * download link pointing at `minio:9000`: correct, valid, and unreachable
   * from any browser on earth.
   *
   * The same client when `S3_PUBLIC_ENDPOINT` is unset, which is the local
   * case where the two addresses are one.
   */
  readonly signing: MinioClient;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.client = this.clientFor(config.get('S3_ENDPOINT', { infer: true }));

    const publicEndpoint = config.get('S3_PUBLIC_ENDPOINT', { infer: true });
    this.signing = publicEndpoint ? this.clientFor(publicEndpoint) : this.client;
  }

  private clientFor(endpoint: string): MinioClient {
    const url = new URL(endpoint);

    return new MinioClient({
      endPoint: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      useSSL: url.protocol === 'https:',
      accessKey: this.config.get('S3_ACCESS_KEY', { infer: true }),
      secretKey: this.config.get('S3_SECRET_KEY', { infer: true }),
      region: this.config.get('S3_REGION', { infer: true }),
    });
  }

  /** Readiness probe: storage is only useful if the buckets actually exist. */
  async ping(): Promise<void> {
    const buckets = [
      this.config.get('S3_BUCKET_DOCUMENTS', { infer: true }),
      this.config.get('S3_BUCKET_PHOTOS', { infer: true }),
    ];

    for (const bucket of buckets) {
      if (!(await this.client.bucketExists(bucket))) {
        throw new Error(`Bucket not found: ${bucket}`);
      }
    }
  }
}
