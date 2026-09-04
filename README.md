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
| Faz 4 — İletişim ve Bildirim | 3 / 6 | T4.4, T4.5, T4.6 tamam · T4.1, T4.2, T4.3 sunucu tarafı tamam, kalanları cihaza/T5.1'e bağlı |
| Faz 5 — Yapay Zeka Katmanı | **7 / 7** | Tamam · katman sağlayıcı anahtarı olmadan **kapalı**; triyaj taraması, protokol sözcük araması ve günlük brifing AI'sız da çalışıyor · fotoğraf gönderimi **ayrıca** açılmalı |
| Faz 6 — İlaç, Finans, Raporlama | 2 / 7 | T6.1, T6.2 tamam — ilaç planı, uyum skoru, etkileşim uyarıları · ikisi de AI gerektirmiyor, tamamen çalışıyor |
| Faz 7 — Sertleştirme ve Yayın | 0 / 7 | |

Kutucuklu tam liste, her tamamlanan işin doküman bağlantısıyla birlikte:
[docs/SARTNAME.md §15](docs/SARTNAME.md#15-yol-haritası--faz-ve-task-listesi)

### Devredilen borçlar

Bunlar unutulmuş değil, bilinçli olarak ertelenmiştir ve sahibi belli.

> **Klinikten veya sizden veri bekleyenler için doldurulacak doküman:**
> [KLINIKTEN-ISTENENLER](docs/KLINIKTEN-ISTENENLER.md) — her madde için hangi verinin
> hangi formatta beklendiği, ve `docs/klinikten/` altında **mevcut başlangıç verisiyle
> önceden doldurulmuş** beş CSV şablonu.

| Borç | Neden ertelendi | Nereye |
|---|---|---|
| SSH sertleştirmesi | Sunucuda çalışan kritik servislerin erişimini kesme riski | T7.2 |
| Cihaz katmanı: cihaz üstü OCR, belge tarama, fotoğraf overlay çekimi, APNs/FCM bildirim gösterimi, zengin bildirim eylemleri | Gerçek cihaz (ve push için sağlayıcı hesabı) gerektiriyor; sunucu tarafı hepsinde hazır | T3.3 + T3.5 + T4.2 + T4.3 kalanı |
| İlaç etkileşim tablosu | **Klinikte:** başlangıç seti, hiçbir eczacı gözden geçirmedi. Mekanizma hazır; tabloyu klinik sahiplenmeli. Uyarı yokluğu güvenlik anlamına gelmiyor ve arayüz bunu yazıyor | — |
| PROM anketi ve eşikleri | **Klinikte:** sorular şartnamenin listesinden, ifadeler bu depo için yazıldı; hiçbir klinisyen gözden geçirmedi. Alarm eşikleri savunulabilir yer tutucular. **Lisanslı ölçek (SF-36, FACE-Q…) bilerek konmadı** — telifli, ve değiştirilmiş bir ölçek normlarıyla karşılaştırılamaz | — |
| Klinik logosu | **Sizde:** rapor şablonunda yeri var, görsel dosyası klinikten gelmeli. Klinik adı `CLINIC_NAME` ortam değişkeninden okunuyor — depoda sabit değil, burası birinin kliniği | — |
| Kapasite tahmini | §M11 "kapasite tahmini" istiyor; doluluk **ölçülüyor** ama gelecek ayların tahmini bir modeldir ve elde eğilim çıkaracak veri yok. Uydurulmuş bir tahmin, üzerine kadro kararı verilecek bir sayıdır | Veri birikince |
| Döviz kuru kaynağı | **Sizde:** depoda kur beslemesi yok — merkez bankası mı, kliniğin bankası mı, aracıyla anlaşılan kur mu, bu klinik kararıdır. Kurlar elle giriliyor; kuru olmayan tutar **çevrilmiyor ve düşürülmüyor**, rapor eksik olduğunu söylüyor | — |
| Triyaj kırmızı bayrak listesi | **Klinikte:** hangi ifadelerin acil sayılacağı klinik içeriktir, bir klinisyen gözden geçirmeli. Ayrıca tarama yalnız TR+EN; DE/RU/AR yazan hasta yalnız AI geçişini alıyor (o da kapalıyken hiç) — her hâlükârda bir insana ulaşıyor | — |
| Fotoğraf gönderiminin klinik kararı | **Sizde:** `AI_PHOTO_ASSESSMENT` varsayılan kapalı. Bir görüntü metnin küçültülebildiği gibi küçültülemez — yüzü ya da dövmeyi hiçbir tarama çıkarmaz. Açmak ayrı bir karar | — |
| AI sağlayıcı sözleşmesi (sıfır saklama / iş ortaklığı) | **Sizde:** §14.5 gereği; `AI_ZERO_RETENTION` kod tarafından doğrulanamaz, operatörün beyanıdır. Beyan yokken klinik istemler gönderilmiyor | — |
| AI model fiyatları | **Sizde:** milyon token başına giriş/çıkış fiyatı yapılandırmadan geliyor; depoya konan bir tablo bir çeyrekte eskir ve yine de inanılır | — |
| Acil numara tablosunun doğrulanması | **Klinikte:** ülke → acil numara eşlemesi operasyonel veridir, yetkili bir kaynağa karşı doğrulanmadı. Yanlış numara, kazanılmak istenen dakikayı harcar | — |
| Yedek şifreleme parolasının kasaya alınması | **Sizde:** parola sunucu dışında saklanmalı, yoksa off-site yedekler açılamaz | — |
