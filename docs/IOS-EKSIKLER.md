# iOS Uygulaması — Eksik Analizi

**Tarih:** 2026-09-09
**Kapsam:** `ios/Sources` altındaki tüm ekranlar, şartname (`docs/SARTNAME.md`) M1–M20 maddeleri ve `backend/src` uç noktaları ile karşılaştırıldı.
**Yazan:** Claude — proje sahibinin "çoğu ekran çok basit duruyor, detaylı değil" geri bildirimi üzerine.

---

## 0. Tek cümlelik teşhis

> Arka uçta **53 tablo / 172 uç nokta** var; uygulamada **21 ekran** var ve bunların çoğu *okuma* ekranı.
> Doktor tarafı bir **dosya görüntüleyici** olmuş; bir **çalışma ortamı** değil.

Geri bildirim haklı. Aşağıdaki listeyi savunma olarak değil, iş listesi olarak yazıyorum.

### Sayılarla

| | Sayı |
|---|---|
| Backend Prisma modeli | 53 |
| Backend HTTP uç noktası | 172 |
| iOS ekranı (kullanıcının gördüğü) | ~21 |
| iOS'ta API istemcisi olup **hiç ekranı olmayan** modül | 8 |
| Backend'de olup iOS'ta **istemcisi bile olmayan** modül | 2 |
| Doktorun hasta kartında gördüğü alan sayısı | **4** (ad, dosya no, ülke, şehir) |

---

## 1. En büyük üç sorun

Bunlar düzelmeden diğer maddelerin bir anlamı yok.

### 1.1 Doktorun açılış ekranı yok

Doktor uygulamaya girdiğinde karşısına **hasta listesi** çıkıyor. Hepsi bu.
(`ios/Sources/KlinikApp/StaffNavigation.swift` — `NavigationStack`'in kökü `PatientListView`.)

Şartname M2 açıkça istiyor:
> *"Doktor için tek ekranda 'hasta özeti': son ölçümler, açık uyarılar, son mesaj, yaklaşan kontrol, ilaç uyumu yüzdesi."*

M5 ayrıca istiyor:
> *"Günlük doktor brifingi: her sabah 'dün ne oldu, bugün ne var, kim risk altında' özeti."*

Backend'de **ikisi de hazır**: `GET /me/briefing`, `GET /reports/pending`, `GET /lab-results/critical`, `GET /photos/flagged`, `GET /emergency`. `BriefingAPI.swift` iOS'ta yazılmış — **hiçbir ekran çağırmıyor.**

Sonuç: doktor sabah uygulamayı açtığında bugün kimin riskte olduğunu göremiyor. Tek tek dosya açmak zorunda.

### 1.2 Hasta kartı 4 satır

`ios/Sources/KlinikPatientsFeature/PatientScreens.swift:145-155` — ekranın tamamı:

```
Ad Soyad
Dosya No:  2026-K7RMPX
Ülke:      TR
Şehir:     İstanbul
```

Uygulamanın kendi `Patient` tipi (`PatientsAPI.swift:4`) **zaten** şunları çözümlüyor ama ekran göstermiyor:
`birthDate`, `sex`, `preferredLanguage`, `status`, `createdAt`.

Ve iOS'ta **hiç bulunmayan** ama backend'de olan (`MedicalProfile`, `Surgery` tabloları):
kan grubu, alerjiler, kronik hastalıklar, kullandığı ilaçlar, sigara/alkol, hedef kilo, ameliyat tipi, ameliyat tarihi, cerrah, atanmış doktor/hemşire.

Şartname M2:
> *"Detaylı hasta kartı: demografi, ülke/dil, iletişim, ameliyat bilgisi, kronik hastalık, alerji, sigara/alkol."*

Yani hasta kartının **tıbbi kısmı hiç yazılmamış**. Uygulamada bir hastanın neye alerjisi olduğunu göremiyorsunuz.

### 1.3 Doktor hastaya bir şey **yazamıyor**

Doktorun yapabildiği tek yazma işlemleri: yeni hasta açmak, ölçüm girmek, belge yüklemek, fotoğraf yüklemek, tahlil onaylamak, mesaj atmak, randevu onaylamak, kontrol işaretlemek.

Yapamadıkları:

| İş | Backend uç noktası | Ekran |
|---|---|---|
| İlaç/reçete yazmak | `POST /patients/:id/medications` | **yok** |
| Hastanın eklediği ilacı onaylamak | `PATCH .../approve` | **yok** |
| İlacı kesmek | `PATCH .../stop` | **yok** |
| İlaç etkileşimi görmek | `GET .../interactions` | **yok** |
| Tıbbi profil doldurmak (alerji, kan grubu…) | `PUT /patients/:id/medical-profile` | **yok** |
| Hasta bilgisini düzeltmek | `PATCH /patients/:id` | **yok** |
| Hastaya personel atamak | `POST /patients/:id/assignments` | **yok** |
| Hastayı davet etmek | `POST /auth/invitations` | **yok** |
| Onamları görmek | `GET /patients/:id/consents` | **yok** |
| Kontrol takvimi üretmek | `POST /patients/:id/follow-up` | **yok** |

Şartname M9 doğrudan şunu diyor: *"Doktor/hemşire ilaç planı tanımlar."* Tanımlayamıyor.

---

## 2. Ekran ekran durum

Sütunlar: ekranda gerçekten ne yapılabiliyor / şartnameye göre ne eksik.

### Doktor tarafı (13 rota — `StaffNavigation.swift`)

| Ekran | Şu an yapabildiği | Eksik |
|---|---|---|
| **Hasta listesi** | Arama, sonsuz kaydırma | Filtre yok (ülke, durum, ameliyat tipi, tarih aralığı — M2 istiyor, backend destekliyor). Satırda ameliyat tipi/tarihi/risk rozeti yok. Sıralama yok. |
| **Hasta dosyası** | 4 alan + 8 metin bağlantısı | Bkz. §1.2. Ayrıca menü **düz metin listesi** — ikon yok, özet yok, sayı yok. "Mesajlar" yazıyor ama okunmamış kaç mesaj var belli değil. "Tahliller" yazıyor ama bekleyen var mı belli değil. |
| **Ölçümler** | Kilo/VKİ grafiği, hedef çizgisi, ölçüm girme | Tansiyon/nabız/ateş/SpO2/şeker/bel için grafik yok (yalnız kilo ve VKİ çiziliyor). Ölçüm silme/düzeltme yok. |
| **Belgeler** | Liste, yükleme, silme | **Belgeyi açamıyorsunuz.** `DocumentsAPI.downloadLink` yazılmış, hiçbir ekran çağırmıyor. Yani PDF yükleniyor, bir daha bakılamıyor. OCR iş durumu (`jobs`) da gösterilmiyor. |
| **Tahlil onayı** | Bekleyenleri görme, onaylama, reddetme | Onaylanmış tahlil listesi yok. Düşük güvenli alanların sarı vurgusu yok (M16). LOINC eşleştirme kuyruğu yok. |
| **Tahlil trendi** | Analit grafiği, referans bandı, kritik işaret | Analit seçimi dışında etkileşim yok; tarih aralığı seçilemiyor. |
| **Fotoğraflar** | Galeri, kaydırmalı karşılaştırma, yükleme, silme | AI'ın işaretlediği fotoğraflar (`flagged`) görünmüyor; doktor değerlendirmesi (`assess`) girilemiyor. Faz etiketine göre gruplama yok. |
| **Kontroller** | Kilometre taşlarını işaretleme | Takvimi **üretme** yok (`generate`) — yani ameliyat tarihinden D1/H1/M1… planı uygulamadan kurulamıyor. |
| **Mesajlaşma** | Metin, hızlı yanıt şablonları, yazıyor göstergesi, okundu | **Ek gönderilemiyor ve ek görüntülenemiyor.** Gelen fotoğraf "ek" yazısı olarak görünüyor (`ChatScreen.swift:200`). Sesli mesaj yok. Çeviri yok (M3). Erişim penceresi durumu gösterilmiyor. |
| **Randevular** | Talep, onay, iptal, erteleme | Takvim görünümü yok — düz liste. ICS dışa aktarım yok. Müsaitlik tanımlama yok. Çakışma uyarısı görünmüyor. |
| **Komplikasyon kuyruğu** | Liste, sahiplenme, çözme | Fotoğraf eki görüntülenemiyor. Yanıt süresi ölçümü görünmüyor (M7 istiyor). |
| **Bildirim ayarları** | Kanal tercihleri | Sessiz saatler yok. Bildirim geçmişi ekranı yok. |
| **Yeni hasta** | 8 alanlı form | Ameliyat bilgisi, tıbbi profil, aracı kurum girilemiyor — hasta açılıyor ama boş açılıyor. |

### Hasta tarafı (13 rota — `PatientNavigation.swift`)

| Ekran | Şu an yapabildiği | Eksik |
|---|---|---|
| **Ana ekran** | 5 eylem + sıradaki randevu + acil | Şartnameye uygun (M7 §7). Ama ilaç saati, bekleyen anket, eksik belge uyarısı görünmüyor. |
| **Mesajlar** | Metin gönderme | Fotoğraf/dosya/ses gönderme yok. Erişim penceresi dışında "sıraya alındı" durumu gösterilmiyor (M3). |
| **Belgeler** | Yükleme, liste | Yüklediği belgeyi açamıyor. Kamera ile tarama yok (M16: kenar tespiti, perspektif düzeltme, çok sayfa). |
| **İlaçlarım** | Liste, "içtim" işaretleme | "Atladım"/"Ertele" yok. Uyum yüzdesi, seri sayacı, rozet yok (M9). Kendi ilacını ekleyemiyor. Reçete yenileme hatırlatması yok. |
| **Fotoğraflar** | Galeri, karşılaştırma, overlay ile çekim | Faz etiketi seçimi zayıf; komplikasyon fotoğrafı ayrı akışı ana ekranda değil. |
| **Ölçümler** | Giriş | Kendi grafiğini göremiyor (doktordaki `BodyChartView` hastaya bağlanmamış — hasta yalnız `RecordMeasurementView` görüyor). |
| **Kontroller / Tahliller / Komplikasyonlar / Randevular / Onamlar / Bildirim ayarları** | Okuma + temel işlem | Aşağıdaki §3'e bakınız — bu ekranların besleyeceği AI özetleri, anketler ve asistan hiç yok. |

---

## 3. Backend'de tamamen hazır, uygulamada **hiç ekranı olmayan** modüller

Bunlar "eksik özellik" değil, **hiç başlanmamış ekranlar**. API istemcileri iOS'ta yazılmış, tek bir ekran çağırmıyor.

| Modül | Şartname | iOS istemcisi | Ekran |
|---|---|---|---|
| **AI Asistan / triyaj chatbot** | M4 (tam modül) | `AssistantAPI.swift` | **yok** |
| **AI rapor onayı** | M5 | `ReportsAPI.swift` | **yok** |
| **Günlük doktor brifingi** | M5 | `BriefingAPI.swift` | **yok** |
| **Finans paneli** | M11 | `FinanceAPI.swift` (346 satır) | **yok** |
| **İstatistik/analitik** | M11 | `AnalyticsAPI.swift` (251 satır) | **yok** |
| **Dışa aktarım (PDF/Excel)** | M12 | `ExportsAPI.swift` | **yok** |
| **PROM anketleri** | M18 | `SurveysAPI.swift` | **yok** |
| **AI sağlayıcı ayarları** | §3.4 | `AISettingsAPI.swift` | **yok** |
| **Denetim günlüğü** | M13 | **istemci de yok** | **yok** |
| **Klinik protokol yükleme (RAG kaynağı)** | M4 | **istemci de yok** | **yok** |
| **Acil durum kuyruğu (personel)** | M8 | `EmergencyAPI.swift` var | **yok** — hasta acil butonuna basıyor, doktor uygulamadan göremiyor |

**M4 ve M5'in sonucu ciddi:** Şartname M5 diyor ki *"kritik seviyeli AI çıktıları doktor onayı olmadan hastaya gönderilmez."* Backend bunu uyguluyor — çıktı `ai_reports` tablosunda onay bekliyor. Ama **onaylayacak ekran olmadığı için o çıktılar sonsuza kadar orada bekliyor.** Yani AI katmanı çalışıyor ama hastaya hiçbir zaman ulaşmıyor.

---

## 4. Yarım kalmış altyapı

Yazılmış, derleniyor, testi de var — ama uygulamada kullanılmıyor.

### 4.1 Çevrimdışı çalışma (M15) — altyapı var, UI kullanmıyor

`KlinikSync` (outbox) ve `KlinikSyncStore` (SQLite) yazılmış ve `AppEnvironment.swift:92`'de kuruluyor. Ama:

- Hiçbir ekran outbox'a yazmıyor (`grep` sonucu: yalnız kurulum satırı).
- Hiçbir model yerel veritabanından okumuyor — hepsi doğrudan API çağırıyor.
- **"Çevrimdışı / senkronize ediliyor / güncel" göstergesi hiçbir ekranda yok.**

Şartname M15: *"UI her zaman yerelden okur."* Şu an hiçbir ekran yerelden okumuyor. Uçakta veya otelde interneti olmayan bir hasta uygulamayı açtığında boş ekran görüyor.

Tek istisna: dosya/fotoğraf yüklemeleri (`SQLiteUploadStore`) gerçekten kuyruğa alınıyor.

### 4.2 Biyometrik giriş (M1) — hiç yok

`LocalAuthentication` uygulamada hiç geçmiyor. Her açılışta şifre + TOTP giriliyor. M1: *"biyometrik giriş (Face ID / BiometricPrompt)."*

### 4.3 Sağlık verisi entegrasyonu (M20) — hiç yok

HealthKit uygulamada hiç geçmiyor. Kilo/adım/uyku/nabız senkronizasyonu yok.

### 4.4 Oturum yönetimi (M1) — API var, ekran yok

`AuthAPI.sessions`, `revokeSession`, `signOutEverywhere` yazılmış. Kullanıcı hangi cihazlardan girdiğini göremiyor, uzaktan çıkış yapamıyor.

### 4.5 İki adımlı doğrulama kurulumu — API var, ekran yok

`beginTotpEnrolment` / `confirmTotpEnrolment` yazılmış, ekranı yok. Doktor hesabına TOTP **ancak sunucudan elle** eklenebiliyor. Yeni bir doktor kendi başına kuramaz.

---

## 5. Şartname M1–M20 gerçek durum

| # | Modül | Backend | iOS | Not |
|---|---|---|---|---|
| M1 | Kimlik, roller, onboarding | ✅ | 🟡 | Giriş + TOTP doğrulama var. Davet, oturum yönetimi, TOTP kurulumu, biyometri **yok** |
| M2 | Hasta dosyası (core) | ✅ | 🔴 | Kart 4 alan; tıbbi profil, ameliyat, doktor notu, filtreli arama, doktor özeti **yok** |
| M3 | Mesajlaşma + erişim penceresi | ✅ | 🟡 | Metin var. Ek, ses, çeviri, pencere durumu **yok** |
| M4 | AI triyaj + SSS asistanı | ✅ | 🔴 | **Hiç ekran yok** |
| M5 | AI klinik analiz | ✅ | 🔴 | **Hiç ekran yok** — onay kuyruğu tıkalı |
| M6 | Bildirim sistemi | ✅ | 🟡 | Tercih ekranı var. APNs kaydı, aksiyon butonları, sessiz saatler, geçmiş **yok** |
| M7 | Fotoğraf takibi | ✅ | 🟢 | En tam modül. Overlay + kaydırmalı karşılaştırma çalışıyor. Flag/assess eksik |
| M8 | Acil durum | ✅ | 🟡 | Hasta tarafı var. **Personel kuyruğu yok** — çağrı görülmüyor |
| M9 | İlaç ve reçete uyumu | ✅ | 🔴 | Hasta "içtim" diyebiliyor. **Doktor ilaç yazamıyor.** Oyunlaştırma, uyum skoru yok |
| M10 | Randevu ve takvim | ✅ | 🟡 | Liste + onay akışı var. Takvim görünümü, ICS, müsaitlik, video **yok** |
| M11 | Finans ve istatistik | ✅ | 🔴 | **Hiç ekran yok** |
| M12 | Raporlama ve dışa aktarım | ✅ | 🔴 | **Hiç ekran yok** |
| M13 | Denetim günlüğü | ✅ | 🔴 | **İstemci bile yok** |
| M14 | Asenkron kuyruk | ✅ | 🔴 | İş durumu (`queued→processing→done`) hiçbir ekranda gösterilmiyor |
| M15 | Offline-first | ✅ | 🔴 | Altyapı var, **UI hiç kullanmıyor**, gösterge yok |
| M16 | Belge tarayıcı + OCR | ✅ | 🔴 | Kamera tarama, kenar tespiti, cihaz üstü ön okuma **yok**; yalnız dosya seçici |
| M17 | Onam ve belge yönetimi | ✅ | 🟡 | Hasta onam verebiliyor. İmza yok, belge kontrol listesi yok, doktor göremiyor |
| M18 | PROM anketleri | ✅ | 🔴 | **Hiç ekran yok** |
| M19 | Sağlık turizmi | ✅ | 🔴 | Uçuş/otel/transfer/tercüman/aracı kurum **hiç yok** |
| M20 | HealthKit / Health Connect | — | 🔴 | **Hiç yok** |

🟢 tam · 🟡 kısmi · 🔴 yok veya çok eksik

**Özet: 20 modülün 4'ü kullanılabilir, 6'sı kısmi, 10'u yok.**

---

## 6. Neden bu hale geldi

Dürüst olmak gerekirse üç sebep var ve üçü de bende:

1. **Uçtan uca değil, katman katman ilerledim.** Her fazda backend'i tamamlayıp mobil tarafı "iskelet" bırakmışım. İskeletler hiç etlenmedi.
2. **"Ekran açılıyor" ile "iş yapılıyor"u aynı saydım.** Yazdığım testler ekranın hatasız yüklendiğini doğruluyor; ekranda yapılacak bir şey olup olmadığını değil.
3. **Şartnamedeki M-maddelerini backend uç noktası yazınca bitmiş saydım.** M11 finans için 15 uç nokta var, tek ekran yok — ama görev listesinde "tamam" görünüyor.

---

## 7. Sıralı iş listesi

Öncelik ölçütü: **doktorun günlük işini yapabilmesi.** Üstteki üç madde bitmeden uygulama sahada kullanılamaz.

### Öncelik 1 — uygulamayı kullanılabilir yapan (tahmini 5–7 gün)

1. **Doktor ana ekranı**: brifing, kritik tahliller, işaretli fotoğraflar, bekleyen AI raporları, aktif acil çağrılar, bugünkü randevular. (Uç noktalar hazır.)
2. **Hasta kartını gerçek hasta kartı yapmak**: demografi + tıbbi profil + ameliyat bilgisi + atanmış ekip; düzenlenebilir.
3. **Dosya menüsünü özet kartlarına çevirmek**: her bölümde son değer + bekleyen sayısı (metin listesi yerine).
4. **İlaç yazma ekranı** (doktor): plan tanımlama, onay, kesme, etkileşim uyarısı.
5. **Belge açma/önizleme** — şu an yüklenen belge bir daha görülemiyor.
6. **Personel acil kuyruğu** — hastanın acil çağrısı şu an uygulamada hiç görünmüyor.

### Öncelik 2 — şartnamenin sözünü tuttuğu yerler (tahmini 6–8 gün)

7. **AI rapor onay ekranı** (M5) — onay kuyruğunun tıkanıklığını açar.
8. **AI asistan / triyaj sohbeti** (M4) — mesajlaşmanın önüne geçen katman.
9. **Mesajlarda ek gönderme/görüntüleme** + erişim penceresi durumu.
10. **Çevrimdışı gösterge + yerelden okuma** (M15) — altyapı hazır, bağlanacak.
11. **Hasta davet ekranı** + oturum yönetimi + TOTP kurulumu (M1).
12. **Randevu takvim görünümü** + müsaitlik tanımı.

### Öncelik 3 — panel işleri (tahmini 5–7 gün)

13. **Finans + istatistik paneli** (M11) — grafikler, ülke kırılımı, tahsilat.
14. **Dışa aktarım ekranı** (M12) — PDF/Excel, indirme.
15. **PROM anketleri** (M18) — hasta tarafı + trend uyarısı.
16. **Denetim günlüğü görünümü** (M13) — istemci sıfırdan.
17. **Klinik protokol yükleme** (M4 RAG kaynağı).

### Öncelik 4 — cihaz yetenekleri (tahmini 4–5 gün)

18. **Kamera ile belge tarama + cihaz üstü OCR** (M16).
19. **Biyometrik giriş** (M1).
20. **APNs kaydı + aksiyon butonlu bildirimler** (M6).
21. **HealthKit** (M20).
22. **Sağlık turizmi modülü** (M19).

---

## 8. Bir uyarı

Bu listedeki her madde tek tek yazılabilir. Ama asıl mesele sıralamada: **§7 Öncelik 1 bitmeden Android'e geçilmemeli.** Aynı iskeletleri iki platformda birden etlemek, iki kat eksik uygulama demek.

Aynı şekilde: bu belge "yapılacaklar" listesi olarak duruyorsa bir işe yaramaz. Bir sonraki adım Öncelik 1'in ilk maddesini yazmak.
