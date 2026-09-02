# Klinik Takip Platformu

[![CI](https://github.com/adilemreee/klinik-takip/actions/workflows/ci.yml/badge.svg)](https://github.com/adilemreee/klinik-takip/actions/workflows/ci.yml)

Ameliyat öncesi–sonrası süreci uçtan uca yöneten, sağlık turizmi senaryosuna uygun
doktor–hasta takip platformu. Native iOS + native Android istemciler ve kendi
sunucumuzda çalışan bir backend.

Tam şartname: [docs/SARTNAME.md](docs/SARTNAME.md)

## Depo Yapısı

```
backend/    NestJS + Prisma + PostgreSQL + Redis + BullMQ  (API + worker)
ios/        Swift paketi: KlinikCore, KlinikAPI, KlinikDesign + özellik modülleri
            (Auth, Patients, Home, Measurements, Documents, Sync)
android/    Gradle: core:network / core:sync / core:charts (saf JVM), core:design (Compose),
            feature:* (mantık, saf JVM) + feature:*-ui (Compose)
design/     tokens.json — iki platformun ortak tasarım kaynağı
infra/      docker-compose, nginx server blokları
docs/       şartname + yol haritası, modül dokümanları, sunucu notları, port tahsisi
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

```bash
cd ios && swift test          # iOS paketi ve testleri
cd android && ./gradlew test  # Android JVM modülleri
```

Compose modülleri yalnız Android SDK bulunan makinelerde derlenir; CI'da her zaman derlenir.

Veri modeli: [docs/VERI-MODELI.md](docs/VERI-MODELI.md) · Kimlik doğrulama: [docs/KIMLIK-DOGRULAMA.md](docs/KIMLIK-DOGRULAMA.md) · Yetkilendirme: [docs/YETKILENDIRME.md](docs/YETKILENDIRME.md) · Denetim: [docs/DENETIM-GUNLUGU.md](docs/DENETIM-GUNLUGU.md) · Dosyalar: [docs/DOSYA-SERVISI.md](docs/DOSYA-SERVISI.md) · Hasta kayıtları: [docs/HASTA-KAYITLARI.md](docs/HASTA-KAYITLARI.md) · API sözleşmesi: [docs/API-SOZLESMESI.md](docs/API-SOZLESMESI.md) · iOS: [docs/IOS-ISKELETI.md](docs/IOS-ISKELETI.md) · Android: [docs/ANDROID-ISKELETI.md](docs/ANDROID-ISKELETI.md) · Giriş akışı: [docs/GIRIS-AKISI.md](docs/GIRIS-AKISI.md) · Hasta ekranları: [docs/HASTA-EKRANLARI.md](docs/HASTA-EKRANLARI.md) · Hasta ana ekranı: [docs/HASTA-ANA-EKRANI.md](docs/HASTA-ANA-EKRANI.md) · Offline ve çakışma: [docs/OFFLINE-VE-CAKISMA.md](docs/OFFLINE-VE-CAKISMA.md) · Dağıtım: [docs/DAGITIM.md](docs/DAGITIM.md) · Yedekleme: [docs/YEDEKLEME.md](docs/YEDEKLEME.md)

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

| Faz | Durum | Not |
|---|---|---|
| Faz 0 — Temel Kurulum | 6 / 7 | T0.1 kısmi: UFW ve SSH sertleştirmesi bilinçli olarak uygulanmadı |
| Faz 1 — Kimlik ve Çekirdek Veri | 7 / 7 | ✅ |
| Faz 2 — Mobil İskeletler | 5 / 7 | T2.6 kısmi (kalıcı yerel DB yok) · T2.7 dil seti (AR/DE/RU) açıldı |
| Faz 3 — Klinik Modüller | 4 / 6 | T3.1, T3.2, T3.4, T3.6 tamam · T3.3 ve T3.5'te eksik olan tek şey **kamera katmanı** |
| Faz 4 — İletişim ve Bildirim | 0 / 6 | T4.1 kısmi: mesajlaşma ve erişim penceresi tamam, transkript/çeviri T5.1'e bağlı |
| Faz 5 — Yapay Zeka Katmanı | 0 / 7 | |
| Faz 6 — İlaç, Finans, Raporlama | 0 / 7 | |
| Faz 7 — Sertleştirme ve Yayın | 0 / 7 | |

Kutucuklu tam liste, her tamamlanan işin doküman bağlantısıyla birlikte:
[docs/SARTNAME.md §15](docs/SARTNAME.md#15-yol-haritası--faz-ve-task-listesi)

### Devredilen borçlar

Bunlar unutulmuş değil, bilinçli olarak ertelenmiştir ve sahibi belli:

| Borç | Neden ertelendi | Nereye |
|---|---|---|
| SSH sertleştirmesi | Sunucuda çalışan kritik servislerin erişimini kesme riski | T7.2 |
| Kalıcı yerel depo (GRDB / Room) | Senkronizasyon mantığı depodan bağımsız tasarlandı; kalıcılık ayrı bir iş. Yükleme oturumunun uygulama yeniden başlatılınca yaşaması da buna bağlı | T2.6 kalanı |
| Kamera katmanı: cihaz üstü OCR (Vision / ML Kit), belge tarama, fotoğraf overlay çekimi | Gerçek cihaz gerektiriyor ve buradan doğrulanamıyor; sunucu tarafı üçünde de hazır | T3.3 + T3.5 kalanı |
| AR (RTL), DE, RU çevirileri | §7 başlangıç setinde istiyor; altyapı hazır, çeviriler ve RTL yerleşimi yapılmadı | T2.7 |
| `audit_logs` partition'lama | Tablo büyümeden önce gerekmiyor | Faz 7 öncesi |
| Yedek şifreleme parolasının kasaya alınması | **Sizde:** parola sunucu dışında saklanmalı, yoksa off-site yedekler açılamaz | — |
