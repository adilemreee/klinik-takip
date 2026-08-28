import { validateEnv } from './env.schema';

const valid = {
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

describe('validateEnv', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const env = validateEnv({ ...valid });

    expect(env.PORT).toBe(3000);
    expect(env.APP_ENV).toBe('local');
    expect(env.S3_SIGNED_URL_TTL_SECONDS).toBe(300);
  });

  it('coerces numeric strings coming from the environment', () => {
    const env = validateEnv({ ...valid, PORT: '8080', REDIS_PORT: '6380' });

    expect(env.PORT).toBe(8080);
    expect(env.REDIS_PORT).toBe(6380);
  });

  it('rejects a missing required variable and names it', () => {
    const incomplete: Record<string, unknown> = { ...valid };
    delete incomplete.DATABASE_URL;

    expect(() => validateEnv(incomplete)).toThrow(/DATABASE_URL/);
  });

  // Health data: a weak signing secret is a real vulnerability, not a warning.
  it('rejects JWT secrets shorter than 32 characters', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  // docker-compose turns `AI_PROVIDER=` in a .env file into an empty string
  // rather than omitting the key. Blank must mean "not configured", not "invalid".
  it('treats a blank optional variable as unset', () => {
    const env = validateEnv({
      ...valid,
      AI_PROVIDER: '',
      AI_API_KEY: '',
      AI_MODEL: '',
      AI_MONTHLY_BUDGET_USD: '',
      SENTRY_DSN: '',
      API_PUBLIC_URL: '',
    });

    expect(env.AI_PROVIDER).toBeUndefined();
    expect(env.AI_MONTHLY_BUDGET_USD).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('still rejects a non-blank invalid optional variable', () => {
    expect(() => validateEnv({ ...valid, AI_PROVIDER: 'gemini' })).toThrow(/AI_PROVIDER/);
  });

  it('rejects a signed URL TTL above one hour', () => {
    expect(() => validateEnv({ ...valid, S3_SIGNED_URL_TTL_SECONDS: '7200' })).toThrow(
      /S3_SIGNED_URL_TTL_SECONDS/,
    );
  });

  it('never leaks secret values in the error message', () => {
    const secret = 'super-secret-database-password';
    let message = '';

    try {
      validateEnv({ ...valid, DATABASE_URL: `not-a-url-${secret}` });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain(secret);
  });
});
