<!-- Kaynak: klinik-takip-uygulamasi-prompt.md. Sunucu IP ve SSH anahtar yolu
     Bolum 10 geregi bilincli olarak cikarildi; bkz. docs/SUNUCU-NOTLARI.md -->

# Doktor–Hasta Takip Platformu — Geliştirme Şartnamesi ve Ajan Prompt'u

> Bu doküman, bir yazılım geliştirme ajanına (veya ekibe) verilecek **tek kaynak şartname**dir.
> Amaç: iOS native + Android native istemciler ve kendi sunucumuzda çalışan, ölçeklenebilir,
> güvenli bir backend ile uçtan uca bir klinik takip platformu geliştirmek.

---

## 0. Ajan Çalışma Protokolü (ÖNCE BUNU OKU)

1. **Task task ilerle.** Aşağıdaki Bölüm 15'teki faz/task listesini sırayla uygula. Bir task bitmeden diğerine geçme.
2. Her task başında: **ne yapacağını 3-5 maddede özetle**, onay bekle.
3. Her task sonunda: **ne yaptığını, hangi dosyaları oluşturduğunu/değiştirdiğini, nasıl test edileceğini** raporla.
4. Kod yazmadan önce **veri modelini ve API sözleşmesini** (OpenAPI) netleştir.
5. Varsayım yapman gerekirse **varsayımı açıkça yaz**, sessizce ilerleme.
6. Her modül için: kod + migration + test + kısa README. Testsiz modül "bitti" sayılmaz.
7. Sırlar (API key, DB şifresi, SSH) **asla repoya girmez** — `.env` + secret manager kullanılır.
8. Türkçe iletişim kur, kod ve kod yorumları İngilizce olsun.

---

## 1. Ürün Özeti

Tek bir **operatör doktor**, birden fazla **hemşire/asistan/sekreter** ve **binlerce hasta** için tasarlanmış,
ameliyat öncesi–sonrası süreci uçtan uca yöneten klinik takip platformu.
Özellikle **sağlık turizmi** senaryosuna uygundur: hastalar farklı ülkelerden gelir, farklı diller konuşur,
ameliyat sonrası kendi ülkelerine döner ve takip uzaktan devam eder.

**Temel değer önerisi:** Doktorun zamanını korumak. Hasta ile doktor arasındaki her etkileşim önce
otomasyon ve yapay zeka katmanından geçer; doktora yalnızca gerçekten doktor gerektiren şey ulaşır.

---

## 2. Roller ve Yetkilendirme (RBAC)

| Rol | Yetki Özeti |
|---|---|
| `SUPER_ADMIN` | Sistem sahibi (doktor). Her şeye erişir, rol atar, denetim günlüğünü görür, finansal panele erişir. |
| `DOCTOR` | Tüm hasta dosyaları, tıbbi karar, reçete, onay, mesajlaşma, analitik. |
| `NURSE` | Atanmış hastaların dosyaları, vital/ölçüm girişi, mesaj yanıtlama (klinik olmayan), fotoğraf inceleme. Finansal veriye erişemez. |
| `COORDINATOR` (sekreter/hasta koordinatörü) | Randevu, iletişim, konaklama/transfer, belge toplama. Tıbbi detaya kısıtlı erişim. |
| `FINANCE` | Yalnız finansal modül. Tıbbi veriye erişemez. |
| `PATIENT` | Yalnız kendi dosyası. |
| `CAREGIVER` (refakatçi/vekil) | Hastanın açık onayıyla, hastanın dosyasına sınırlı erişim (yaşlı/yabancı dil konuşan hastalar için). |

**Kurallar**
- Yetkiler **rol + izin (permission) matrisi** ile yönetilir, koda gömülmez (`patients.read`, `finance.read`, `patient.assign` vb.).
- Hemşireler yalnızca **kendilerine atanmış** hastaları görür (opsiyon: doktor "tüm hastaları gör" izni verebilir).
- Personel hesapları **doktor tarafından davet linki ile** oluşturulur, self-signup yoktur.
- Hasta kaydı: koordinatör/hemşire hastayı oluşturur → hastaya SMS/e-posta ile **davet + tek kullanımlık kod** gider → hasta uygulamadan hesabını aktive eder.
- Personel için **zorunlu 2FA (TOTP)**. Hasta için opsiyonel.
- Oturum: JWT access (15 dk) + refresh token rotation, cihaz bazlı oturum listesi ve uzaktan çıkış.

---

## 3. Teknoloji Yığını

### 3.1 Backend
- **Dil/Framework:** TypeScript + **NestJS** (modüler monolit + ayrı worker servisleri).
  *Alternatif:* Go (Fiber/Echo) — yüksek eşzamanlılık gerekirse OCR/AI worker'ları Go ile yazılabilir.
- **Veritabanı:** PostgreSQL 16 (+ `pgcrypto`, `pg_trgm`, opsiyonel TimescaleDB ile lab değerleri zaman serisi)
- **ORM:** Prisma veya TypeORM (migration zorunlu, elle SQL değişikliği yasak)
- **Cache / Pub-Sub:** Redis 7
- **Kuyruk:** BullMQ (Redis tabanlı) — AI, OCR, PDF üretimi, bildirim gönderimi ayrı kuyruklarda
- **Dosya depolama:** MinIO (S3 uyumlu, self-hosted) — sunucu diskine doğrudan dosya yazılmaz
- **Arama:** PostgreSQL full-text (başlangıç) → Meilisearch (gerekirse)
- **API:** REST (OpenAPI 3.1 ile dokümante) + WebSocket (mesajlaşma, canlı bildirim)
- **Realtime:** Socket.IO veya native WS + Redis adapter

### 3.2 Mobil
- **iOS:** Swift 5.10+, SwiftUI, Swift Concurrency, MVVM, `URLSession`, offline için **GRDB/SQLite**, APNs, Keychain, Vision framework (OCR), HealthKit
- **Android:** Kotlin, Jetpack Compose, Coroutines/Flow, MVVM, Retrofit + OkHttp, **Room**, FCM, EncryptedSharedPreferences, ML Kit (OCR), Health Connect
- **Ortak:** Aynı OpenAPI şemasından client kod üretimi, aynı tasarım tokenları (renk/tipografi/spacing JSON olarak paylaşılır)

### 3.3 Altyapı
- Docker + Docker Compose (tek sunucu, Faz 1) → gerekirse Docker Swarm/K8s
- Caddy veya Nginx (TLS, Let's Encrypt, HTTP/2)
- CI/CD: GitHub Actions → sunucuya deploy (staging + production ortamları ayrı)
- **Gözlemlenebilirlik:** Prometheus + Grafana (metrik), Loki (log), Sentry (hata), Uptime Kuma (uptime)
- **Yedekleme:** Günlük şifreli PostgreSQL dump + MinIO bucket replikasyonu, **off-site** (farklı sağlayıcı) kopya, haftalık restore testi

### 3.4 Yapay Zeka
- LLM sağlayıcısı: Anthropic Claude API veya OpenAI (soyutlanmış `AIProvider` arayüzü — sağlayıcı değiştirilebilir olmalı)
- Embedding + pgvector: klinik protokol dokümanlarında RAG (SSS chatbot için)
- OCR: cihaz üstü (Vision/ML Kit) birincil, sunucuda PaddleOCR/Tesseract fallback
- Tüm AI çağrıları **kuyruk üzerinden asenkron**, timeout ve retry politikalı, maliyet/token loglamalı

---

## 4. Mimari

```
[iOS App]  [Android App]  [Doktor Web Paneli (opsiyonel, Faz 3)]
      \         |            /
       \        |           /
        [ Caddy / Nginx — TLS, rate limit, WAF ]
                 |
        [ API Gateway (NestJS) ]
        ├── Auth & RBAC Modülü
        ├── Patient / Medical Records Modülü
        ├── Messaging Modülü (WS)
        ├── Appointment Modülü
        ├── Medication Modülü
        ├── Finance Modülü
        ├── Notification Modülü
        ├── Audit Log Modülü
        └── Reporting/Export Modülü
                 |
        [ Redis + BullMQ Kuyrukları ]
        ├── ai-analysis-worker      (lab yorumlama, mesaj özetleme, triyaj)
        ├── ocr-worker              (belge tarama → yapılandırılmış veri)
        ├── document-worker         (PDF/Excel üretimi)
        ├── notification-worker     (APNs/FCM/SMS/e-posta)
        └── scheduler               (kontrol hatırlatmaları, ilaç saatleri — cron)
                 |
   [ PostgreSQL ]   [ MinIO (S3) ]   [ LLM API ]
```

**İlke:** Ağır iş asla HTTP isteği içinde yapılmaz. İstek kuyruğa atılır, istemciye `jobId` döner,
sonuç WebSocket/push ile bildirilir.

---

## 5. Veri Modeli (ana varlıklar)

- `users` — id, role, email, phone, password_hash, totp_secret, locale, status, last_login_at
- `staff_profiles` — user_id, title, specialty, permissions[]
- `patients` — user_id, mrn (dosya no), first/last name, birth_date, sex, **country**, city, nationality, preferred_language, referral_source, assigned_doctor_id, status
- `patient_assignments` — patient_id, staff_id, role, assigned_at
- `medical_profiles` — patient_id, blood_type, allergies[], chronic_conditions[], smoking, alcohol, current_medications[]
- `measurements` — patient_id, type (weight/height/bmi/bp/pulse/temp/spo2/glucose/waist), value, unit, measured_at, source (patient/nurse/device)
- `documents` — patient_id, uploaded_by, type (lab/imaging/report/consent/invoice), file_key, mime, size, ocr_status, ai_status, page_count
- `lab_results` — document_id, patient_id, analyte_code (LOINC), analyte_name, value, unit, ref_low, ref_high, flag (low/normal/high/critical), measured_at
- `photos` — patient_id, category (before/after/complication/wound), body_area, taken_at, phase_label (pre-op / post-op D1 / W2 / M1 / M3 / M6 / Y1), file_key, is_face_blurred, consent_id
- `conversations` / `messages` — participants, message (text/image/audio/file), ai_summary, ai_triage_level, read_at, delivered_at, translated_text
- `appointments` — patient_id, staff_id, type (consultation / surgery / control), scheduled_at, duration, status, location, meeting_url
- `follow_up_schedules` — patient_id, surgery_date, milestones (D1, W1, M1, M2, M3, M6, Y1), status per milestone
- `medications` — patient_id, drug_name, dose, form, frequency_rule (RRULE), start_date, end_date, prescriber_id, instructions
- `medication_logs` — medication_id, scheduled_at, taken_at, status (taken/skipped/late), note
- `notifications` — user_id, type, title, body, data(json), actions[], channel, status, sent_at, read_at
- `ai_jobs` — type, input_ref, status, model, tokens_in/out, cost, result_ref, error
- `ai_reports` — patient_id, source (lab/message/photo/summary), content_md, risk_level, model, generated_at, reviewed_by, reviewed_at
- `finance_records` — patient_id, procedure_name, currency, gross_amount, discount, net_amount, cost_items[], payment_status, paid_at, agency_id
- `consents` — patient_id, type (treatment / data_processing / photo_usage), version, signed_at, signature_file_key, ip
- `audit_logs` — actor_id, actor_role, action, entity_type, entity_id, before(json), after(json), ip, user_agent, created_at
- `emergency_events` — patient_id, triggered_at, location, note, acknowledged_by, acknowledged_at, resolution

---

## 6. Fonksiyonel Gereksinimler

### M1 — Kimlik, Roller, Onboarding
- Doktor tarafından davet ile personel ekleme, rol/izin atama, pasife alma.
- Hasta davet akışı (SMS/e-posta + tek kullanımlık kod), zorunlu **KVKK/GDPR aydınlatma metni onayı**.
- Şifre politikası, hesap kilitleme, cihaz oturum yönetimi, biyometrik giriş (Face ID / BiometricPrompt).

### M2 — Hasta Dosyası (Core)
- Detaylı hasta kartı: demografi, ülke/dil, iletişim, ameliyat bilgisi, kronik hastalık, alerji, sigara/alkol.
- **Vücut ölçümleri ve VKİ:** kilo/boy girişi → otomatik VKİ hesaplama, kategori etiketi, **zaman serisi grafiği** (kilo eğrisi, VKİ eğrisi, hedef çizgisi).
- Hasta PDF/görsel yükler → kuyruk → OCR → yapılandırılmış lab verisi → doktor onayına düşer.
- Lab değerleri **analit bazlı trend grafiği** (ör. Hb son 6 ölçüm), referans aralığı bandı, **kritik değer kırmızı işaret**.
- Doktor için tek ekranda "hasta özeti": son ölçümler, açık uyarılar, son mesaj, yaklaşan kontrol, ilaç uyumu yüzdesi.
- Doktor notu (özel/paylaşılabilir ayrımı ile), etiketleme, hasta arama (isim, dosya no, ülke, ameliyat tipi, tarih aralığı).

### M3 — Mesajlaşma ve Erişim Pencereleri
- Hasta ↔ klinik mesajlaşma: metin, fotoğraf, dosya, **sesli mesaj + otomatik transkript**.
- **Erişim penceresi:** doktorun tanımladığı saat aralıkları (ör. Pzt–Cum 18:00–20:00). Pencere dışında mesaj kutusu "sıraya alındı" durumunda; acil buton hariç.
- Otomatik dil algılama ve **çift yönlü çeviri** (hasta kendi dilinde yazar, doktor Türkçe okur; yanıt hastanın diline çevrilir — orijinal metin her zaman saklanır ve görülebilir).
- Hızlı yanıt şablonları, kişiselleştirilebilir.
- Okundu/iletildi durumu, yazıyor göstergesi.

### M4 — AI Triyaj + SSS Asistanı (Chatbot)
- Hasta mesaj göndermeden önce chatbot devreye girer.
- **RAG kaynağı:** doktorun yüklediği klinik protokol/SSS dokümanları + ameliyat tipine özel talimatlar. Model **yalnızca bu kaynaklardan** yanıt verir.
- Triyaj seviyeleri: `INFO` (bot cevaplar) / `ROUTINE` (hemşireye düşer) / `URGENT` (doktora anında bildirim) / `EMERGENCY` (acil protokolü tetiklenir).
- Bot **tanı koymaz, ilaç dozu değiştirmez, tedavi önermez.** Emin olmadığında insana devreder — bu kural sistem prompt'unda sabittir ve testlerle doğrulanır.
- Her bot yanıtının altında "Bu cevap yeterli değil, doktora ilet" butonu.
- Tüm bot konuşmaları doktor panelinde görüntülenebilir.

### M5 — AI Klinik Analiz Katmanı
- **Lab yorumlama:** yüklenen tahlil → referans dışı değerler tespiti → hasta için **sade dilde** özet + doktor için klinik özet. Hastaya giden metin bilgilendiricidir, tanı içermez.
- **Mesaj özetleme:** uzun hasta mesajı → doktor için 3 maddelik klinik özet (Şikayet / Ölçülen değerler / Süre) + triyaj seviyesi.
- **Fotoğraf ön değerlendirme:** yara fotoğrafında kızarıklık/akıntı/şişlik şüphesi → **flag** (tanı değil, "doktor incelemesi önerilir" uyarısı).
- **Günlük doktor brifingi:** her sabah "dün ne oldu, bugün ne var, kim risk altında" özeti.
- **İlaç etkileşim uyarısı:** hastanın kullandığı ilaç listesi üzerinden bilinen etkileşimlerde uyarı (referans veritabanı ile, LLM tek başına kaynak değildir).
- **Zorunlu kural:** Hastaya giden her AI çıktısı `ai_reports.reviewed_by` alanı ile doktor onayına açıktır; kritik seviyeli çıktılar **doktor onayı olmadan hastaya gönderilmez** (ayar ile açılıp kapatılabilir).
- Her AI çıktısında görünür uyarı: *"Bu içerik yapay zeka tarafından üretilmiştir, tıbbi tanı yerine geçmez."*

### M6 — Bildirim Sistemi
- Kanallar: **Push (APNs/FCM)** birincil, **SMS** ve **e-posta** yedek, opsiyonel **WhatsApp Business API** (Türkiye ve yurtdışı hastalar için yüksek okunma oranı).
- Otomatik kontrol takvimi: ameliyat tarihinden itibaren D1, H1, **1. ay, 2. ay, 3. ay**, 6. ay, 1. yıl hatırlatmaları — ameliyat tipine göre şablon.
- Lab sonucu hazır / kritik değer / yeni mesaj / ilaç saati / randevu hatırlatma / eksik belge bildirimleri.
- **Aksiyon odaklı zengin bildirimler:**
  - Hastaya: "Tahlil sonucun hazır" → `[PDF'i İncele]` `[Doktora Soru Sor]`
  - Hastaya: "İlaç saatin geldi" → `[İçtim]` `[1 saat ertele]`
  - Doktora: "Kritik değer: Hb 7.2" → `[Hastayı Ara]` `[Dosyayı Aç]`
  - iOS: Notification Content/Action Extensions. Android: Notification Actions + RemoteInput.
- Sessiz saatler, kanal bazlı tercih, bildirim tercihleri ekranı.
- **Teslim garantisi:** başarısız push → SMS'e düşme (fallback zinciri), tüm gönderimler loglanır.
- Yerelleştirilmiş bildirim metinleri (hastanın diline göre).

### M7 — Fotoğraf ve Kronolojik Gelişim Takibi
- **Öncesi/Sonrası galerisi:** faz etiketli (pre-op, post-op D1, H2, M1, M3, M6, Y1), vücut bölgesi bazlı gruplama.
- Çekim rehberi: önceki fotoğrafın yarı saydam **overlay**'i ile aynı açı/mesafeden çekim (tutarlı karşılaştırma için).
- Yan yana ve **kaydırmalı (slider) karşılaştırma** görünümü.
- **Komplikasyon fotoğrafı** ayrı akış: hasta çeker → not ekler → doğrudan doktor/hemşireye düşer → yanıt süresi ölçülür.
- Gizlilik: fotoğraflar ayrı şifreli bucket'ta, **imzalı kısa ömürlü URL** ile erişim, opsiyonel otomatik yüz bulanıklaştırma, ekran görüntüsü uyarısı, EXIF konum bilgisi temizleme.
- Ayrı **fotoğraf kullanım onamı** (pazarlama/eğitim amaçlı kullanım için ayrı ve geri alınabilir onay).

### M8 — Acil Durum
- Ana ekranda sabit **Acil Durum** butonu (iki adımlı onay ile yanlış tetikleme engeli).
- Tetiklendiğinde: nöbetçi personele anında push + SMS + (opsiyonel) otomatik arama, hastanın konumu ve son klinik özeti ekranda.
- **Eskalasyon:** 2 dk yanıt yoksa → ikinci kişi, 5 dk → doktorun kendisi.
- Hastaya "Ulaşana kadar ne yapmalısın" talimat kartı + hastanın bulunduğu ülkenin acil numarası (112/911/999) tek dokunuşla arama.
- Tüm acil olaylar `emergency_events` tablosunda, çözüm notu ile kapatılır.

### M9 — İlaç ve Reçete Uyum Modülü
- Doktor/hemşire ilaç planı tanımlar (RRULE ile: "günde 2, 8 gün"), hastaya otomatik takvim üretilir.
- Hasta bildirimden tek dokunuşla **"İçtim" / "Atladım" / "Ertele"** işaretler.
- **Oyunlaştırma:** uyum yüzdesi, seri (streak) sayacı, rozetler, haftalık özet — ancak abartısız ve tıbbi ciddiyeti bozmayan tonda.
- Doktor panelinde **uyum skoru** (%) ve atlanan dozlar; uyum %70'in altına düşerse otomatik uyarı.
- Hasta kendi kullandığı ek ilaçları da ekleyebilir (doktor onayına düşer).
- İlaç bitimine 2 gün kala "reçete yenileme" hatırlatması.

### M10 — Randevu ve Takvim
- Doktor müsaitlik tanımı, randevu tipleri, süre, çakışma kontrolü.
- Hasta randevu talebi → onay akışı; iptal/erteleme politikası.
- Takvim senkronizasyonu (ICS export), hatırlatma bildirimleri (T-7g, T-1g, T-2sa).
- Opsiyonel **video görüşme** (WebRTC / harici sağlayıcı) — uzaktaki hastalar için kritik.

### M11 — Finans ve İstatistik Paneli
- Aylık/yıllık ameliyat sayıları, ameliyat tipi kırılımı.
- **Ülke bazlı hasta dağılımı** (harita + tablo), şehir kırılımı.
- Gelir–gider, ortalama ameliyat ücreti, para birimi bazlı (TRY/EUR/USD/GBP) + kur çevrimi.
- Kaynak analizi: hasta nereden geldi (Instagram, Google, aracı kurum, referans) → **kanal başına dönüşüm ve gelir**.
- Önümüzdeki ayların **randevu doluluk oranı**, kapasite tahmini.
- Ödeme durumu takibi (peşin/taksit/bekleyen), tahsilat raporu.
- Grafikler: sütun, çizgi, donut, ısı haritası. Tarih aralığı ve filtre seçimi.

### M12 — Raporlama ve Dışa Aktarım
- **Hasta özet PDF'i:** demografi, ameliyat bilgisi, ölçüm grafikleri, lab tabloları, öncesi/sonrası fotoğraflar (onaylıysa), ilaç uyumu, AI özetleri. Klinik logolu şablon.
- **Toplu Excel/CSV export:** filtre bazlı (tarih, ülke, ameliyat tipi, doktor), seçilebilir kolonlar.
- Finansal rapor PDF/Excel.
- Export'lar kuyrukta üretilir, hazır olunca bildirimle indirme linki gelir (link kısa ömürlü, imzalı).
- **Her export `audit_logs`'a yazılır** — kim, ne zaman, hangi veriyi dışarı aldı.

### M13 — Denetim Günlüğü (Audit Log)
- Kaydedilen: kim, hangi rol, hangi hastanın hangi kaydına, hangi işlemi (görüntüleme dahil), ne zaman, hangi IP/cihazdan, öncesi/sonrası değer.
- **Değiştirilemez (append-only)** tablo; silme/güncelleme DB seviyesinde engellenir.
- Doktor için filtrelenebilir görünüm + "şüpheli davranış" uyarıları (ör. bir hemşirenin bir gecede 200 dosya açması, mesai dışı toplu erişim).
- Saklama süresi: en az 2 yıl (yerel mevzuata göre ayarlanabilir).

### M14 — Asenkron İşlem Kuyruğu
- Kuyruklar: `ocr`, `ai-analysis`, `document-export`, `notification`, `scheduler`.
- Öncelik seviyeleri (acil mesaj > rutin lab), retry + exponential backoff, **dead-letter queue**, idempotency key.
- Kuyruk sağlığı Grafana'da izlenir; bekleyen iş sayısı eşiği aşınca alarm.
- İstemciye job durumu: `queued → processing → done/failed`, WebSocket ile canlı ilerleme.

### M15 — Offline-First
- Mobil tarafta yerel DB (Room / GRDB) **kaynak doğruluk** olarak çalışır; UI her zaman yerelden okur.
- Değişiklikler `outbox` tablosuna yazılır, bağlantı gelince sıradan senkronize edilir.
- **Çakışma çözümü:** sunucu `updated_at` + versiyon numarası; klinik veride otomatik üzerine yazma yok, çakışma personele gösterilir.
- Offline'da fotoğraf/dosya sıraya alınır, bağlantıda arka planda yüklenir (iOS: `URLSession` background; Android: `WorkManager`).
- Kullanıcıya net "çevrimdışı / senkronize ediliyor / güncel" durum göstergesi.

### M16 — Akıllı Belge Tarayıcı ve OCR
- Kamera ile belge tarama: kenar tespiti, perspektif düzeltme, çok sayfa, otomatik kontrast.
- Cihaz üstü OCR (Vision / ML Kit) ile ön okuma → sunucuda doğrulama ve **yapılandırma** (analit adı, değer, birim, referans aralığı).
- Analit isimleri **LOINC** koduna eşlenir; tanınmayanlar "eşleştirme bekliyor" kuyruğuna düşer, doktor bir kez eşleştirir → sistem öğrenir.
- Düşük güven skorlu alanlar sarı vurgu ile insan onayına sunulur. **OCR çıktısı asla otomatik onaylanmaz.**

### M17 — Onam ve Belge Yönetimi
- Dijital onam formları (tedavi, veri işleme, fotoğraf kullanımı), versiyonlu, parmakla imzalanabilir.
- Ameliyat öncesi **belge kontrol listesi** (pasaport, tahlil, EKG, onam) → eksik belge varsa hastaya otomatik hatırlatma, koordinatör panelinde eksik listesi.

### M18 — Hasta Bildirimli Sonuç Anketleri (PROM)
- Ameliyat sonrası dönemsel kısa anketler: ağrı skoru (VAS 0-10), şişlik, uyku, memnuniyet (NPS).
- Sonuçlar zaman serisi grafiğine dönüşür; kötüleşen trend doktora uyarı üretir.
- Memnun hastalara (yüksek NPS) opsiyonel değerlendirme/yorum yönlendirmesi.

### M19 — Sağlık Turizmi Modülü (opsiyonel ama önerilir)
- Uçuş/otel/transfer bilgileri, karşılama planı, tercüman ataması.
- Ülkeye özel taburculuk talimatı (uçuş öncesi bekleme süresi, kompresyon önerileri vb.).
- Aracı kurum (agency) tanımı, komisyon takibi, kurum bazlı hasta raporu.

### M20 — Sağlık Verisi Entegrasyonu
- HealthKit (iOS) / Health Connect (Android) ile kilo, adım, uyku, nabız senkronizasyonu — **hastanın açık izniyle**.
- Manuel giriş her zaman mümkün; cihaz verisi "kaynak: cihaz" etiketiyle ayrı tutulur.

---

## 7. UI/UX İlkeleri

- **Sadelik zorunlu.** Her yaştan ve her eğitim seviyesinden hasta kullanacak. Bir ekran = bir asıl iş.
- Hasta ana ekranı en fazla **5 birincil eylem**: Mesaj, Belge Yükle, İlaçlarım, Fotoğraf Ekle, Acil.
- **Tıbbi jargon yok.** "Hemoglobin düşük" yerine "Kan değerlerinden biri normalin altında — doktorun inceleyecek."
- Yaşlı kullanıcılar için: Dynamic Type / font ölçekleme desteği, minimum 44×44pt dokunma alanı, yüksek kontrast, koyu mod.
- Erişilebilirlik: VoiceOver / TalkBack tam desteği, renk körlüğü güvenli palet (kritik bilgi yalnız renkle anlatılmaz — ikon + metin de olur).
- **Çok dil:** TR, EN, AR (RTL desteği!), DE, RU başlangıç seti. Tüm metinler dış kaynak dosyalarında, koda gömülü metin yok.
- Boş durumlar, yükleniyor iskeletleri (skeleton), hata durumları ve **çevrimdışı durumu** her ekranda tasarlanır.
- Doktor paneli yoğun bilgi içerebilir ama **hiyerarşi net** olmalı: kritik olan üstte ve kırmızı, rutin altta ve nötr.
- Native hissiyat: iOS'ta iOS kalıpları (SF Symbols, sheet, swipe), Android'de Material 3. **Tek tasarımı iki platforma zorla giydirme.**

---

## 8. Güvenlik ve Uyumluluk

> Bu uygulama **özel nitelikli kişisel veri** (sağlık verisi) işler. Güvenlik opsiyonel değil, temel gerekliliktir.

- **KVKK** (TR) ve **GDPR** (AB hastaları için) uyumu; ABD hastası hedefleniyorsa HIPAA gereksinimleri ayrıca değerlendirilmeli.
- Aktarımda TLS 1.3; **beklemede şifreleme**: disk şifrelemesi + hassas alanlarda kolon bazlı şifreleme.
- Dosyalar özel bucket'ta, yalnız **kısa ömürlü imzalı URL** ile erişim; doğrudan public URL yok.
- Rate limiting, brute-force koruması, IP bazlı anomali tespiti, WAF.
- Mobil: sertifika pinning, jailbreak/root tespiti (uyarı seviyesinde), hassas ekranlarda ekran görüntüsü engeli, arka planda ekran bulanıklaştırma, verinin Keychain/EncryptedSharedPrefs'te tutulması.
- **Veri saklama ve silme:** hasta "verilerimi sil" talep edebilir; yasal saklama süresi biten kayıtlar için otomatik anonimleştirme.
- **Veri sızıntısı müdahale planı** ve yedekten dönüş prosedürü yazılı olarak dokümante edilir.
- Bağımlılık taraması (Dependabot/Snyk), sızma testi (Faz 5 öncesi), OWASP Mobile Top 10 kontrol listesi.
- **Sır yönetimi:** SSH anahtarları, API key'leri, DB şifreleri repoda tutulmaz; sunucuda `.env` + dosya izinleri (600) veya Doppler/Vault.

---

## 9. Performans ve Ölçek Hedefleri

| Metrik | Hedef |
|---|---|
| Eşzamanlı aktif kullanıcı | 500+ |
| Toplam hasta kaydı | 50.000+ (binlerce aktif) |
| API p95 yanıt süresi | < 300 ms (okuma), < 800 ms (yazma) |
| Uygulama soğuk açılış | < 2 sn |
| Dosya yükleme | 20 MB'a kadar PDF, parçalı (chunked) yükleme, devam ettirilebilir |
| Uptime hedefi | %99.5 |
| AI işi tamamlanma | Lab analizi < 60 sn, mesaj özeti < 15 sn |

**Uygulama:** DB indeksleme (patient_id, created_at, composite), N+1 sorgu yasağı, cursor tabanlı sayfalama (offset değil), Redis cache, görsellerde thumbnail üretimi, liste ekranlarında lazy loading.

⚠️ **Not:** Tek sunucu = tek arıza noktası. Faz 5'te en azından yönetilen bir yedek DB + off-site yedek ve yük artınca yatay ölçekleme planı (uygulama sunucusunu stateless tutarak) hazır olmalı.

---

## 10. Sunucu ve Dağıtım

- Hedef sunucu: kendi VPS'imiz (IP ve SSH anahtarı **ayrıca ve güvenli kanaldan** iletilecek — prompt/repo içine yazılmaz).
- İlk kurulum: sistem güncellemesi, non-root deploy kullanıcısı, SSH key-only giriş (şifre girişi kapalı), UFW (yalnız 22/80/443), fail2ban, otomatik güvenlik güncellemeleri.
- Docker Compose ile: `api`, `worker`, `postgres`, `redis`, `minio`, `caddy`, `prometheus`, `grafana`, `loki`.
- Ortamlar: `staging` ve `production` ayrı compose dosyaları / ayrı veritabanları.
- Deploy: GitHub Actions → build → test → image push → sunucuda rolling restart. Migration deploy adımında otomatik çalışır, geri alma (rollback) planı hazır.
- Health check endpoint'leri (`/health/live`, `/health/ready`) ve otomatik restart politikası.

---

## 11. Test Stratejisi

- Backend: unit (servis katmanı), integration (DB + kuyruk, testcontainers), e2e (kritik akışlar).
- **Kritik akışlar zorunlu e2e kapsamda:** kayıt→giriş, hasta oluşturma, PDF yükleme→OCR→lab kaydı, mesaj→AI triyaj→bildirim, ilaç check-in, acil durum eskalasyonu, export.
- RBAC testleri: her rol için "erişememesi gereken" endpoint'ler negatif test edilir.
- Mobil: ViewModel unit testleri + kritik ekranlar için UI testi (XCUITest / Compose UI Test).
- **AI güvenlik testleri:** botun tanı koymaya/doz değiştirmeye zorlandığı prompt setleri; hepsinde reddetmeli ve insana devretmeli.
- Yük testi (k6): 500 eşzamanlı kullanıcı senaryosu.
- Hedef backend kapsam: %70+ (kritik modüllerde %85+).

---

## 12. Kabul Kriterleri (özet)

Bir modül şu şartları sağlamadan "tamamlandı" sayılmaz:
- [ ] API OpenAPI'de dokümante
- [ ] Migration yazılmış ve geri alınabilir
- [ ] Unit + integration test geçiyor
- [ ] RBAC kontrolü uygulanmış ve test edilmiş
- [ ] Audit log yazıyor (veri değiştiren işlemler için)
- [ ] Hata durumları ve boş durumlar UI'da tasarlanmış
- [ ] Çevrimdışı davranışı tanımlanmış
- [ ] i18n anahtarları eklenmiş (TR + EN minimum)
- [ ] Loglama ve metrik eklenmiş

---

## 13. Kapsam Dışı (Faz 1)

Netlik için: ödeme altyapısı entegrasyonu (sanal POS), e-Nabız/MHRS entegrasyonu, çoklu klinik (multi-tenant) desteği, web hasta portalı, giyilebilir cihaz canlı takibi. Bunlar Faz 6+ olarak değerlendirilecek.

---

## 14. AI Kullanımına Dair Kırmızı Çizgiler

1. AI **tanı koymaz**, tedavi değiştirmez, ilaç dozu önermez.
2. AI çıktıları **karar destek**tir; nihai sorumluluk doktordadır ve arayüzde bu açıkça yazar.
3. Kritik/acil sınıflandırılan hiçbir durum yalnızca AI'ya bırakılmaz — insana eskale edilir.
4. AI'ya gönderilen hasta verisi minimize edilir (gerekmedikçe kimlik bilgisi gönderilmez, pseudonimize edilir).
5. Kullanılan LLM sağlayıcısının **veri saklamama (zero-retention) / iş ortaklığı** koşulları sağlanmalı; sağlanamıyorsa sağlık verisi gönderilmez.
6. Her AI çıktısı model adı, versiyonu ve zaman damgası ile loglanır (izlenebilirlik).

---

## 15. Yol Haritası — Faz ve Task Listesi

### FAZ 0 — Temel Kurulum
- [ ] T0.1 Sunucu hazırlığı: kullanıcı, SSH sertleştirme, firewall, fail2ban, Docker kurulumu — **kısmen.** Docker ve fail2ban zaten kuruluydu. UFW kurulmadı ve SSH sertleştirmesi ertelendi: ikisi de mevcut VPN/konteyner erişimini keserdi. SSH **açık güvenlik borcu**, T7.2'ye taşındı. Gerekçeler: [SUNUCU-NOTLARI](SUNUCU-NOTLARI.md)
- [x] T0.2 Repo yapısı (monorepo: `/backend`, `/ios`, `/android`, `/docs`), commit ve branch kuralları
- [x] T0.3 Docker Compose iskeleti (postgres, redis, minio, ~~caddy~~ → **mevcut cloudflared tunnel**) + staging/production ayrımı ([DAGITIM](DAGITIM.md) · [PORTS](PORTS.md))
- [x] T0.4 NestJS proje iskeleti, config/env yönetimi, health check
- [x] T0.5 CI pipeline: lint + test + build
- [x] T0.6 Gözlemlenebilirlik: ~~Sentry~~ → **GlitchTip** (self-hosted, Sentry protokolü), Prometheus, Grafana, Loki
- [x] T0.7 Otomatik yedekleme scripti + restore testi ([YEDEKLEME](YEDEKLEME.md))

### FAZ 1 — Kimlik ve Çekirdek Veri
- [x] T1.1 Veri modeli ve ilk migration'lar ([VERI-MODELI](VERI-MODELI.md))
- [x] T1.2 Auth: kayıt/davet, giriş, refresh rotation, 2FA, cihaz oturumları ([KIMLIK-DOGRULAMA](KIMLIK-DOGRULAMA.md))
- [x] T1.3 RBAC izin sistemi + guard'lar + negatif testler ([YETKILENDIRME](YETKILENDIRME.md))
- [x] T1.4 Audit log altyapısı (interceptor ile otomatik) ([DENETIM-GUNLUGU](DENETIM-GUNLUGU.md))
- [x] T1.5 Dosya servisi (MinIO, imzalı URL) — virüs taraması şartnamede opsiyonel; ClamAV 1 GB+ kalıcı bellek istediği ve sunucu 21 servis barındırdığı için kurulmadı ([DOSYA-SERVISI](DOSYA-SERVISI.md))
- [x] T1.6 Hasta CRUD, arama, filtreleme, atama ([HASTA-KAYITLARI](HASTA-KAYITLARI.md))
- [x] T1.7 OpenAPI dokümanı + Postman koleksiyonu ([API-SOZLESMESI](API-SOZLESMESI.md) · [openapi.json](openapi.json))

### FAZ 2 — Mobil İskeletler
- [x] T2.1 iOS proje kurulumu: mimari, ağ katmanı, tasarım sistemi, i18n ([IOS-ISKELETI](IOS-ISKELETI.md)) — i18n altyapısı tamam, **diller eksik**: aşağıdaki T2.7'ye bakın
- [x] T2.2 Android proje kurulumu: aynı kapsam ([ANDROID-ISKELETI](ANDROID-ISKELETI.md)) — aynı not
- [x] T2.3 Giriş/onboarding akışları (her iki platform) ([GIRIS-AKISI](GIRIS-AKISI.md))
- [x] T2.4 Hasta listesi + hasta detay ekranı (personel tarafı) ([HASTA-EKRANLARI](HASTA-EKRANLARI.md))
- [x] T2.5 Hasta ana ekranı (hasta tarafı) ([HASTA-ANA-EKRANI](HASTA-ANA-EKRANI.md))
- [ ] T2.6 Offline katmanı: outbox + senkronizasyon + çakışma çözümü **tamam ve testli**; kalıcı yerel DB (GRDB / Room) **eksik** — depolar şu an bellekte, yani uygulama kapanınca kuyruk kayboluyor. Tasarım: [OFFLINE-VE-CAKISMA](OFFLINE-VE-CAKISMA.md)
- [ ] T2.7 **Dil seti: AR (RTL), DE, RU** — §7 bunları başlangıç setinde istiyor; şu an yalnız TR ve EN var. Metinlerin tamamı zaten dış kaynak dosyalarında ve tek katalogdan üretiliyor, dolayısıyla eksik olan çeviriler ve **Arapça için RTL yerleşimi**. *(Şartnamenin task listesinde yoktu; §7 ile liste arasındaki boşluğu kapatmak için eklendi.)*

### FAZ 3 — Klinik Modüller
- [x] T3.1 Ölçümler ve VKİ + grafikler ([OLCUMLER](OLCUMLER.md))
- [x] T3.2 Belge yükleme + kuyruk altyapısı (BullMQ) + job durum takibi ([BELGE-KUYRUGU](BELGE-KUYRUGU.md)) — parçalı ve devam ettirilebilir yükleme dahil. Oturum kimliğinin uygulama yeniden başlatıldığında da yaşaması T2.6'nın kalıcı deposuna bağlı
- [ ] T3.3 OCR worker + lab sonucu yapılandırma + doktor onay ekranı ([OCR-VE-TAHLIL](OCR-VE-TAHLIL.md)) — sunucu tarafı OCR, yapılandırma, LOINC eşleştirme ve onay ekranı **tamam**; §3.2'nin birincil saydığı **cihaz üstü ön okuma (Vision / ML Kit) ve kamera ile belge tarama eksik**
- [x] T3.4 Lab trend grafikleri, referans aralığı, kritik değer uyarısı ([OCR-VE-TAHLIL](OCR-VE-TAHLIL.md#trend-grafikleri-t34)) — bildirim gönderimi T4.2'de
- [ ] T3.5 Fotoğraf modülü ([FOTOGRAF-MODULU](FOTOGRAF-MODULU.md)) — yükleme (EXIF temizleme, onam doğrulama), faz etiketleme, galeri ve kaydırmalı karşılaştırma **tamam**; **overlay ile kamera çekimi eksik** (sunucu referansı veriyor, kamera katmanı gerçek cihaz gerektiriyor)
- [x] T3.6 Komplikasyon bildirimi akışı ([KOMPLIKASYON-BILDIRIMI](KOMPLIKASYON-BILDIRIMI.md)) — bildirim, klinisyen kuyruğu, yanıt süresi ölçümü; push bildirimi T4.2'de

### FAZ 4 — İletişim ve Bildirim
- [ ] T4.1 Mesajlaşma (WS) + medya + sesli mesaj + erişim penceresi ([MESAJLASMA](MESAJLASMA.md)) — mesajlaşma, WebSocket, medya/ses eki, erişim penceresi, okundu bilgisi, hazır yanıtlar **tamam**; §M3'ün istediği **sesli mesaj transkripti ve çift yönlü çeviri** AI katmanına (T5.1) bağlı, alanlar hazır ve boş
- [ ] T4.2 Push altyapısı + SMS/e-posta fallback + tercih ekranı ([BILDIRIMLER](BILDIRIMLER.md)) — token kaydı, tercihler, sessiz saatler, yedek zinciri ve gönderim kuyruğu **tamam**; **APNs/FCM sağlayıcı entegrasyonu eksik** (kimlik bilgisi ve gerçek cihaz gerektiriyor, göndericiler arayüz arkasında ve başarı uydurmuyor)
- [ ] T4.3 Zengin/aksiyonlu bildirimler (iOS + Android) — sunucu eylem tanımlarını (`[İçtim]`, `[Ertele]`, `[Hastayı Ara]`) üretiyor ve bildirimle gönderiyor; **kalan tamamen cihaz işi**: iOS Notification Content/Action Extension, Android Notification Actions + RemoteInput
- [x] T4.4 Zamanlayıcı: kontrol takvimi (D1/H1/M1/M2/M3/M6/Y1) otomatik üretimi ([KONTROL-TAKVIMI](KONTROL-TAKVIMI.md)) — ameliyat tipine göre şablon, erteleme, kaçırma eşiği ve hatırlatma kuyruğu dahil
- [x] T4.5 Acil durum butonu + eskalasyon zinciri ([ACIL-DURUM](ACIL-DURUM.md)) — iki adımlı onay, konumu bekletmeyen tetikleme, 0/2dk/5dk eskalasyon merdiveni (boş basamak çökertme + `emergency.receive` tabanı), susturulamayan bildirim, klinik özet, denetlenen cam kırma (`EMERGENCY_ACCESS`), ülkeye göre acil numara ve "biz ulaşana kadar" kartı. **Otomatik arama** (§M8 opsiyonel) yapılmadı; acil numara tablosu **operasyonel doğrulama bekliyor**
- [x] T4.6 Randevu ve takvim modülü ([RANDEVULAR](RANDEVULAR.md)) — müsaitlik, çakışma kontrolü, talep/onay akışı, iptal/erteleme, ICS export ve T-7g/T-1g/T-2sa hatırlatmaları. **Video görüşme** (§M10 opsiyonel) yapılmadı

### FAZ 5 — Yapay Zeka Katmanı
- [x] T5.1 `AIProvider` soyutlaması, maliyet/token loglama, retry politikası ([AI-KATMANI](AI-KATMANI.md)) — Anthropic + OpenAI sağlayıcıları, tek kapı (`AIService`), §14.5 sıfır saklama kapısı (varsayılan **kapalı**), kimliksizleştirme + giden istemde kimlik taraması (ad/dosya no/telefon/e-posta/TCKN sağlaması), aylık bütçe, retry sınıflandırması + jitter, zaman aşımı ve `ai_jobs`'ta token/maliyet/model kaydı. **Fiyat tablosu bilerek depoda değil** — operatör yapılandırması
- [x] T5.2 Mesaj özetleme + triyaj sınıflandırma ([TRIYAJ](TRIYAJ.md)) — deterministik kırmızı bayrak taraması (AI kapalıyken de çalışır), üç satırlık klinik özet, **§14.3 taban kuralı** (model yükseltir, asla düşürmez), erişim penceresini delen acil mesaj, susturulamayan bildirim ve `triage_level` / `ai_triage_level` ayrı kaydı. **Kırmızı bayrak listesi klinik gözden geçirme bekliyor**; tarama yalnız TR+EN
- [x] T5.3 SSS chatbot + RAG (protokol dokümanı yükleme, pgvector) ([SSS-ASISTANI](SSS-ASISTANI.md)) — protokol yükleme + parçalama, **hibrit getirim** (pgvector + PostgreSQL FTS; Türkçe için önek kökleme ve iki taraflı diyakritik katlama), yalnız korpustan yanıt (zayıf getirimde model **hiç çağrılmıyor**, kaynak göstermeyen yanıt atılıyor), devretme akışı ve konuşmanın doktor panelinde durması. **Gömme sağlayıcısı yokken sözcük araması tek başına çalışıyor**
- [x] T5.4 Lab yorumlama (hasta dili + doktor dili çift çıktı) ([LAB-YORUMLAMA](LAB-YORUMLAMA.md)) — tek çağrıda iki metin, `ai_reports` doktor onayı akışı, hastaya **ayrı belge** (klinik metin ve risk etiketi yok), kesilmiş yanıtın atılması, otomatik gönderme yalnız LOW/MEDIUM ve varsayılan kapalı. **HIGH/CRITICAL için otomatik gönderme ayarı bilerek yok** — şartnameden bilinçli sapma
- [x] T5.5 Fotoğraf ön değerlendirme flag'i ([FOTOGRAF-DEGERLENDIRME](FOTOGRAF-DEGERLENDIRME.md)) — **kapalı sözlükten** bulgu (kızarıklık/akıntı/şişlik/yara ayrık), bayrak cevaptan **hesaplanıyor**, sözlük dışı kelime düşüyor, eşik yok, hastaya asla gitmiyor (yapısal), sağlayıcı dikişine görüntü bloğu eklendi. **Kendi anahtarıyla ve varsayılan kapalı** — bir görüntü metnin küçültülebildiği gibi küçültülemiyor
- [x] T5.6 Doktor günlük brifingi ([GUNLUK-BRIFING](GUNLUK-BRIFING.md)) — dün/bugün/bekleyenler, **veri olarak** (AI kapalıyken tam çalışıyor), kliniğin yerel gün sınırı, acil önce sıralama, kapsamlı okuma, modele yalnız sayılar (ad yok) ve gün boyu önbelleklenen paragraf. Sabah sekizde bildirim, boş sabahta gönderilmiyor
- [x] T5.7 AI güvenlik test seti (kırmızı çizgiler doğrulaması) ([AI-KIRMIZI-CIZGILER](AI-KIRMIZI-CIZGILER.md)) — §14'ün dört cümlesi tek kaynakta, kaynak ağacı taraması (her prompt kuralları içeriyor mu, her klinik çağrı `identifiers` veriyor mu, `src/ai/` dışında sağlayıcıya erişen var mı), tüketici doğrulama (`raiseTo` hiçbir bileşimde düşürmüyor), prompt enjeksiyonu ve **gerçek istek gövdesi üzerinde** sızıntı kontrolü

### FAZ 6 — İlaç, Finans, Raporlama
- [x] T6.1 İlaç planı, hatırlatma, check-in, uyum skoru, oyunlaştırma ([ILAC-UYUM](ILAC-UYUM.md)) — RRULE alt kümesi (okunamayan kural **reddediliyor**), hastanın kendi saat diliminde ve DST'yi koruyan takvim üretimi, İçtim/Atladım/Ertele, zamanı gelmemiş dozu saymayan uyum skoru, ölçülü rozetler (kür kötü giderken gizleniyor), %70 uyarısı **yalnız atanmış ekibe**, doz sayısına göre yenileme hatırlatması
- [x] T6.2 İlaç etkileşim uyarıları ([ILAC-ETKILESIM](ILAC-ETKILESIM.md)) — referans tablosundan, **AI hiç karışmıyor** (§M5); marka/jenerik/Türkçe isim normalizasyonu, doz ve form temizleme, uzun bileşen önce; uyarı **engellemiyor**; yanıt tanınmayan ilaçları ve karşılaştırılan çift sayısını taşıyor — **uyarı yokluğu güvenlik değildir**. **Tablo başlangıç seti, eczacı gözden geçirmesi bekliyor**
- [x] T6.3 Finans kayıtları + para birimi + ödeme durumu ([FINANS](FINANS.md)) — para her yerde `Decimal` ve tele **metin** olarak çıkıyor; ödeme durumu **yazılmıyor, defterden hesaplanıyor** (hiçbir uç `paymentStatus` kabul etmiyor); ödemeler **append-only defter**, yanlış giriş silinmiyor **ters kayıtla** düzeltiliyor; başka para biriminde ödeme faturanın ne kadarını kapattığını **söylemek zorunda** (kuru yazılım tahmin etmiyor); her tutar **kendi gününün** kuruyla çevriliyor ve **çevrilemeyen düşürülmüyor** — toplam eksikse eksik olduğunu söylüyor; §2'nin iki yönü de negatif testli (hemşire↛finans, finans↛klinik). **Sanal POS bilerek yok** (şartname kapsam dışı bırakıyor); **kur beslemesi klinik kararı**
- [ ] T6.4 Analitik dashboard (ameliyat sayısı, ülke dağılımı, doluluk, gelir)
- [ ] T6.5 PDF hasta özet raporu (şablonlu)
- [ ] T6.6 Excel/CSV toplu export + kuyruk + indirme linki
- [ ] T6.7 PROM anketleri

### FAZ 7 — Sertleştirme ve Yayın
- [ ] T7.1 Yük testi (k6, 500 eşzamanlı) ve darboğaz optimizasyonu
- [ ] T7.2 Güvenlik denetimi + OWASP Mobile kontrol listesi + sızma testi
- [ ] T7.3 KVKK/GDPR dokümantasyonu, aydınlatma metni, onam akışları
- [ ] T7.4 Erişilebilirlik denetimi (VoiceOver/TalkBack)
- [ ] T7.5 Beta dağıtımı (TestFlight + Play Internal Testing), pilot hasta grubu
- [ ] T7.6 App Store / Play Store yayın hazırlığı (gizlilik etiketleri, sağlık uygulaması gereksinimleri, ekran görüntüleri)
- [ ] T7.7 Kullanıcı el kitabı (hasta + personel) ve eğitim videoları

---

## 16. Başlangıç Talimatı

Faz 0'dan başla. Önce **T0.1**'i planla ve onaya sun. Ardından her task için:
plan → onay → uygulama → test → rapor döngüsünü uygula.

Herhangi bir noktada gereksinim belirsizse, tahmin etme — **soru sor**.
