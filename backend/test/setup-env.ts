/**
 * Runs before any module is imported. ConfigModule.forRoot() validates the
 * environment at import time, so these must exist before the app module graph
 * is pulled in — setting them inside beforeAll is too late.
 *
 * Values already present in the environment win: integration tests point
 * DATABASE_URL at a real database, and this must not overwrite it.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://user:pw@postgres:5432/klinik?schema=public',
  REDIS_HOST: 'redis',
  REDIS_PASSWORD: 'redis-password',
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret',
  S3_BUCKET_DOCUMENTS: 'klinik-documents',
  S3_BUCKET_PHOTOS: 'klinik-photos',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
