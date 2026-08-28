import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Writes the API contract to docs/openapi.json.
 *
 * The mobile clients generate their networking layer from this file
 * (spec section 3.2), so it is committed and checked in CI: a contract that
 * silently drifts from the code is worse than none, because both sides still
 * believe it.
 *
 * Placeholders stand in for secrets. Building the document needs only the
 * module graph and its decorators — nothing connects to a database, to Redis
 * or to object storage — and requiring real credentials would mean the
 * contract could not be regenerated on a fresh checkout or in CI.
 */
const PLACEHOLDERS: Record<string, string> = {
  NODE_ENV: 'development',
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public',
  REDIS_HOST: 'localhost',
  REDIS_PASSWORD: 'placeholder',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'placeholder',
  S3_SECRET_KEY: 'placeholder',
  S3_BUCKET_DOCUMENTS: 'placeholder',
  S3_BUCKET_PHOTOS: 'placeholder',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  JWT_REFRESH_SECRET: 'y'.repeat(48),
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

for (const [key, value] of Object.entries(PLACEHOLDERS)) {
  process.env[key] ??= value;
}

async function main(): Promise<void> {
  // Imported after the environment is in place: the config module validates at
  // import time, so a static import would run before these are set.
  const { NestFactory } = await import('@nestjs/core');
  const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
  const { AppModule } = await import('../src/app.module');

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });

  const config = new DocumentBuilder()
    .setTitle('Klinik Takip API')
    .setDescription(
      'Doctor–patient follow-up platform. Every endpoint requires a bearer token ' +
        'unless documented otherwise; permissions are checked per route and patient ' +
        'access is scoped per role.',
    )
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addTag('auth', 'Sign-in, sessions, two-factor enrolment and invitations')
    .addTag('patients', 'Patient files, search and staff assignment')
    .addTag('audit', 'Append-only access trail and anomaly detection')
    .addTag('health', 'Liveness and readiness probes')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const target = resolve(__dirname, '../../docs/openapi.json');

  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);

  const paths = Object.keys(document.paths ?? {}).length;
  const schemas = Object.keys(document.components?.schemas ?? {}).length;

  console.log(`OpenAPI ${document.openapi}: ${paths} paths, ${schemas} schemas -> ${target}`);

  await app.close();
}

void main();
