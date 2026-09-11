import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { StorageService } from './storage.service';

/**
 * Which address a download URL is signed against.
 *
 * `S3_ENDPOINT` is how this process reaches MinIO; in a compose deployment
 * that is a name on the internal Docker network. An AWS v4 signature covers
 * the host, so a URL signed against it cannot be rewritten afterwards — and
 * what shipped was a download link pointing at `http://minio:9000/...`, which
 * every client dutifully opened and no client could resolve. Exports,
 * documents, photos, message attachments and consent signatures, all of them.
 */
const config = (values: Partial<Env>): ConfigService<Env, true> =>
  ({
    get: (key: keyof Env) =>
      ({
        S3_REGION: 'eu-central-1',
        S3_ACCESS_KEY: 'access',
        S3_SECRET_KEY: 'secret-secret-secret',
        ...values,
      })[key],
  }) as unknown as ConfigService<Env, true>;

/** The host a client would be sent to, read off a signed URL. */
const signedHost = async (service: StorageService): Promise<string> => {
  const url = await service.signing.presignedGetObject('klinik-documents', '2026/09/a.pdf', 300);

  return new URL(url).host;
};

describe('where a download URL points', () => {
  it('uses the public endpoint when there is one', async () => {
    const service = new StorageService(
      config({
        S3_ENDPOINT: 'http://minio:9000',
        S3_PUBLIC_ENDPOINT: 'https://klinikapi-staging.example.xyz',
      }),
    );

    expect(await signedHost(service)).toBe('klinikapi-staging.example.xyz');
  });

  /** Local runs, where the two addresses are the same one. */
  it('falls back to the endpoint it reads through', async () => {
    const service = new StorageService(config({ S3_ENDPOINT: 'http://localhost:9000' }));

    expect(await signedHost(service)).toBe('localhost:9000');
  });

  /**
   * Reading and writing still go over the internal network. Routing object
   * traffic through the public hostname would send every upload out to
   * Cloudflare and back.
   */
  it('still reads and writes over the internal address', () => {
    const service = new StorageService(
      config({
        S3_ENDPOINT: 'http://minio:9000',
        S3_PUBLIC_ENDPOINT: 'https://klinikapi-staging.example.xyz',
      }),
    );

    expect(service.client).not.toBe(service.signing);
    expect((service.client as unknown as { host: string }).host).toBe('minio');
  });

  it('shares one client when no public endpoint is set', () => {
    const service = new StorageService(config({ S3_ENDPOINT: 'http://minio:9000' }));

    expect(service.client).toBe(service.signing);
  });
});
