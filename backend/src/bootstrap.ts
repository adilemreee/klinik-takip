import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Env } from './config/env.schema';

/**
 * Everything main.ts does to an app instance beyond creating it.
 *
 * This lives apart from main.ts so the smoke test can apply the exact same
 * wiring. A missing ValidationPipe peer dependency once crash-looped the
 * container while build, lint and unit tests all stayed green — the pipe was
 * only ever constructed in main.ts, which nothing exercised.
 */
export function configureApp(app: INestApplication, config: ConfigService<Env, true>): void {
  app.use(helmet());
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // OpenAPI is served only outside production (spec section 3.2).
  if (config.get('APP_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Klinik Takip API')
        .setDescription('Doctor–patient follow-up platform')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
}
