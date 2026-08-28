import { z } from 'zod';

/**
 * Environment contract. Validated once at boot — a missing or malformed
 * variable crashes the process immediately instead of surfacing as a runtime
 * failure hours later, in production, on a patient request.
 */
/**
 * docker-compose passes a variable that is present-but-blank in .env through as
 * an empty string, not as an absent key. For anything optional that means "not
 * configured yet", so normalise '' to undefined before validating.
 */
// Zod's inferred ZodEffects<ZodOptional<T>> chain is more precise than anything
// worth spelling out by hand here.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const envSchema = z.object({
  // --- Runtime -------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),

  /**
   * Port the process listens on INSIDE the container. Always 3000 in Docker;
   * the host-side port (8120 / 8123) is a compose port mapping and is
   * deliberately not read here. See docs/PORTS.md.
   */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PUBLIC_URL: optional(z.string().url()),

  /**
   * Prometheus scrape port. Served on a SEPARATE listener from the API, which
   * is publicly reachable through the tunnel — see metrics.server.ts.
   */
  METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
  SERVICE_NAME: z.string().default('klinik-api'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- Database ------------------------------------------------------------
  DATABASE_URL: z.string().url(),

  // --- Redis / queue -------------------------------------------------------
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_PASSWORD: z.string().min(1),

  // --- Object storage ------------------------------------------------------
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default('eu-central-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET_DOCUMENTS: z.string().min(1),
  S3_BUCKET_PHOTOS: z.string().min(1),
  S3_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  // --- Auth ----------------------------------------------------------------
  // Health data. Short secrets are not acceptable.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  TOTP_ISSUER: z.string().default('Klinik Takip'),

  // --- Optional integrations (wired up in later phases) --------------------
  AI_PROVIDER: optional(z.enum(['anthropic', 'openai'])),
  AI_API_KEY: optional(z.string().min(1)),
  AI_MODEL: optional(z.string().min(1)),
  AI_MONTHLY_BUDGET_USD: optional(z.coerce.number().positive()),
  // Points at the self-hosted GlitchTip, not sentry.io.
  SENTRY_DSN: optional(z.string().url()),

  /**
   * Loki push endpoint. When unset, logs go to stdout only (docker json-file).
   * The app ships its own logs rather than running a collector agent — an
   * agent would need the docker socket, which is root on the host.
   */
  LOKI_URL: optional(z.string().url()),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Nest's ConfigModule calls this with process.env. Throwing here aborts boot.
 * Secret VALUES are never logged — only the names of the offending keys.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
