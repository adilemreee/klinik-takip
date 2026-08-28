# Klinik Takip Platformu

[![CI](https://github.com/adilemreee/klinik-takip/actions/workflows/ci.yml/badge.svg)](https://github.com/adilemreee/klinik-takip/actions/workflows/ci.yml)

Ameliyat öncesi–sonrası süreci uçtan uca yöneten, sağlık turizmi senaryosuna uygun
doktor–hasta takip platformu. Native iOS + native Android istemciler ve kendi
sunucumuzda çalışan bir backend.

Tam şartname: [docs/SARTNAME.md](docs/SARTNAME.md)

## Depo Yapısı

```
backend/    NestJS + Prisma + PostgreSQL + Redis + BullMQ  (API + worker)
ios/        Swift paketi: KlinikCore, KlinikAPI, KlinikDesign
android/    Kotlin / Jetpack Compose / Room                 (hasta + personel)
design/     tokens.json — iki platformun ortak tasarım kaynağı
infra/      docker-compose, nginx server blokları
docs/       şartname, sunucu notları, port tahsisi, katkı kuralları
```

## Teknoloji Özeti

| Katman | Seçim |
|---|---|
| Backend | TypeScript, NestJS (modüler monolit + ayrı worker) |
| Veritabanı | PostgreSQL 16 (`pgcrypto`, `pg_trgm`, `pgvector`) |
| Cache / Kuyruk | Redis 7 + BullMQ |
| Dosya | MinIO (S3 uyumlu), kısa ömürlü imzalı URL |
| API | REST (OpenAPI 3.1) + WebSocket |
| iOS | Swift, SwiftUI, Swift Concurrency, GRDB, APNs, Vision, HealthKit |
| Android | Kotlin, Compose, Coroutines/Flow, Room, FCM, ML Kit, Health Connect |
| Gözlemlenebilirlik | Prometheus, Grafana, Loki, **GlitchTip** (self-hosted, Sentry protokolü) |
| Public giriş | **Mevcut cloudflared tunnel** (Caddy değil — bkz. SUNUCU-NOTLARI) |
| Dahili uçlar | Mevcut nginx, VPN'e kapalı |

## Önemli: Dağıtım Ortamı

Hedef sunucu **boş bir VPS değildir** — üzerinde 21 aktif konteyner ve kritik servisler
çalışır. Şartnamenin bazı altyapı adımları (UFW, Caddy, SSH sertleştirme) bu sunucuda
bilinçli olarak uygulanmamıştır.

**Sunucuya dokunmadan önce mutlaka okuyun:** [docs/SUNUCU-NOTLARI.md](docs/SUNUCU-NOTLARI.md)

Port ve ağ tahsisi: [docs/PORTS.md](docs/PORTS.md)

## Geliştirmeye Başlarken

```bash
cp .env.example .env
```

Backend hazır — bkz. [backend/README.md](backend/README.md).
iOS ve Android iskeletleri T2.1 ve T2.2'de kurulacaktır.

Veri modeli: [docs/VERI-MODELI.md](docs/VERI-MODELI.md) · Kimlik doğrulama: [docs/KIMLIK-DOGRULAMA.md](docs/KIMLIK-DOGRULAMA.md) · Yetkilendirme: [docs/YETKILENDIRME.md](docs/YETKILENDIRME.md) · Denetim: [docs/DENETIM-GUNLUGU.md](docs/DENETIM-GUNLUGU.md) · Dosyalar: [docs/DOSYA-SERVISI.md](docs/DOSYA-SERVISI.md) · Hasta kayıtları: [docs/HASTA-KAYITLARI.md](docs/HASTA-KAYITLARI.md) · API sözleşmesi: [docs/API-SOZLESMESI.md](docs/API-SOZLESMESI.md) · iOS: [docs/IOS-ISKELETI.md](docs/IOS-ISKELETI.md) · Dağıtım: [docs/DAGITIM.md](docs/DAGITIM.md) · Yedekleme: [docs/YEDEKLEME.md](docs/YEDEKLEME.md)

> ⚠️ **Bu depo herkese açıktır.** Sunucu adresleri, gerçek hostname'ler, servis
> envanteri ve bilinen açıklar bilinçli olarak buraya **yazılmaz**; bunlar yerel
> `docs/OPERASYON-LOCAL.md` dosyasındadır (`.gitignore`'da). Dokümanlardaki
> `<production-hostname>` gibi yer tutucular bu yüzdendir.

## Kurallar

- Sırlar asla repoya girmez (§8). Bkz. [docs/KATKI-KURALLARI.md](docs/KATKI-KURALLARI.md)
- Kod ve kod yorumları İngilizce, iletişim Türkçe (§0.8)
- Testsiz modül "bitti" sayılmaz (§0.6)
- Hastaya giden her AI çıktısı doktor onayına açıktır ve "yapay zeka üretimi" uyarısı taşır (§14)

## Yol Haritası

Fazlar ve task listesi: [docs/SARTNAME.md](docs/SARTNAME.md) §15

| Faz | Durum |
|---|---|
| Faz 0 — Temel Kurulum | ✅ **tamamlandı** (T0.1–T0.7) |
| Faz 1 — Kimlik ve Çekirdek Veri | ✅ **tamamlandı** (T1.1–T1.7) |
| Faz 2 — Mobil İskeletler | 🔄 devam ediyor (T2.1 ✅) |
| Faz 3 — Klinik Modüller | ⬜ |
| Faz 4 — İletişim ve Bildirim | ⬜ |
| Faz 5 — Yapay Zeka Katmanı | ⬜ |
| Faz 6 — İlaç, Finans, Raporlama | ⬜ |
| Faz 7 — Sertleştirme ve Yayın | ⬜ |
