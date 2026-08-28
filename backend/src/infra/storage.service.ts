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
  readonly client: MinioClient;

  constructor(private readonly config: ConfigService<Env, true>) {
    const endpoint = new URL(config.get('S3_ENDPOINT', { infer: true }));

    this.client = new MinioClient({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
      useSSL: endpoint.protocol === 'https:',
      accessKey: config.get('S3_ACCESS_KEY', { infer: true }),
      secretKey: config.get('S3_SECRET_KEY', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
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
