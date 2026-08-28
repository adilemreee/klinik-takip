# Backend — Klinik Takip API

NestJS 11 + Prisma + PostgreSQL 16 + Redis 7 + MinIO. One codebase, two entry
points: `dist/main.js` (HTTP API) and `dist/worker.js` (BullMQ queue worker).

## Yerelde Çalıştırma

```bash
npm install
cp ../infra/compose/env.staging.example .env   # değerleri doldurun
npx prisma generate
npm run dev
```

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | API, watch modunda |
| `npm run dev:worker` | Worker, watch modunda |
| `npm run build` | `dist/` üretir |
| `npm test` | Unit testler |
| `npm run lint` | ESLint (type-aware) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:dev` | Geliştirme migration'ı üretir |

## Yapı

```
src/config/    Zod ile doğrulanan ortam sözleşmesi — hatalı env açılışta patlar
src/infra/     PrismaService, RedisService, StorageService (global modül)
src/health/    /health/live ve /health/ready
src/main.ts    API giriş noktası
src/worker.ts  Kuyruk işçisi giriş noktası
```

## Sağlık Uçları

| Uç | Ne kontrol eder |
|---|---|
| `GET /health/live` | Yalnızca sürecin ayakta olduğunu. Bağımlılıklara **bakmaz** — DB kesintisi sağlıklı bir konteyneri öldürmemeli. |
| `GET /health/ready` | PostgreSQL, Redis ve MinIO (iki bucket'ın varlığı dahil). Compose healthcheck'i buna bağlıdır. |

## Kararlar

- **Ortam doğrulaması açılışta yapılır.** Eksik `DATABASE_URL` veya 32 karakterden kısa
  bir JWT secret ile uygulama başlamaz. Hata mesajı yalnız anahtar adını yazar, değerini asla.
- **HTTP isteği içinde ağır iş yapılmaz.** OCR, AI, PDF, bildirim → worker (Şartname §4).
- **Konteyner `node` kullanıcısıyla çalışır**, root değil.
- **Rate limit:** `ThrottlerGuard` global; sağlık uçları `@SkipThrottle` ile muaf
  (15 saniyede bir gelen probe'lar yanlış "unhealthy" üretmesin).
- OpenAPI yalnız production dışında `/docs` altında sunulur.
