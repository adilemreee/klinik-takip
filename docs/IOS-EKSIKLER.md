# iOS Uygulaması — Eksik Analizi ve Kapanış

**İlk yazım:** 2026-09-09 (proje sahibinin "çoğu ekran basit duruyor, detaylı
değil" geri bildirimi üzerine)
**Son güncelleme:** 2026-09-09 — listedeki 22 maddenin tamamı yapıldı, sonra
ikinci bir tarama yapıldı ve onun bulduğu 16 madde de kapatıldı.

Bu dosya iki bölümden oluşuyor: **ne bulunmuştu** ve **şu an ne var, ne yok.**
İlk bölüm silinmedi, çünkü bir eksik listesinin değeri sonradan "zaten yoktu"
denememesinde.

---

## Bölüm 1 — 2026-09-09 sabahı bulunan tablo

> Arka uçta **53 tablo / 172 uç nokta** vardı; uygulamada **~21 ekran** vardı ve
> çoğu sadece *okuyordu*. Doktor tarafı bir dosya görüntüleyiciydi, çalışma
> ortamı değil.

En büyük üç bulgu:

1. **Doktorun açılış ekranı yoktu.** Girince hasta listesi çıkıyordu. Şartname
   M2 "tek ekranda hasta özeti", M5 "günlük doktor brifingi" istiyor; ikisinin
   de uç noktası hazırdı, `BriefingAPI.swift` yazılmıştı, **hiçbir ekran
   çağırmıyordu.**
2. **Hasta kartı 4 satırdı**: ad, dosya no, ülke, şehir. Alerji, kan grubu,
   kronik hastalık, ameliyat bilgisi uygulamada **hiç yoktu**.
3. **Doktor hastaya bir şey yazamıyordu.** İlaç yazamıyor, tıbbi profil
   dolduramıyor, hasta bilgisi düzeltemiyor, personel atayamıyor, hasta davet
   edemiyordu.

Ayrıca **8 modülün API istemcisi vardı, tek ekranı yoktu** (finans, istatistik,
dışa aktarım, anketler, AI asistan, AI rapor onayı, brifing, AI ayarları),
2 modülün istemcisi bile yoktu (denetim günlüğü, protokol yükleme), belge
yüklenip bir daha açılamıyordu, hastanın acil çağrısı doktorda görünmüyordu ve
çevrimdışı altyapı kurulup hiçbir ekran tarafından kullanılmıyordu.

**20 modülün 4'ü tam, 6'sı kısmi, 10'u yoktu.**

---

## Bölüm 2 — Şu anki durum

| | Önce | Şimdi |
|---|---|---|
| iOS modülü | 21 | 31 |
| iOS Swift satırı | ~14 000 | ~28 000 |
| iOS testi | 362 | 426 |
| Backend uç noktası | 172 | 177 |
| **UI'ın çağırmadığı API metodu** | **~45** | **0** |

Son satır ölçütün kendisi: uygulamanın bildiği her uç nokta artık bir ekrandan
ulaşılabiliyor. İki metot ise silindi — acil kuyruğu zaten tam kaydı
döndürüyordu, tahlil trend ekranı zaten onaylı sonuçları gösteriyordu; ekranı
olmayan istemci kodu bırakmak, bu çalışmanın şikâyet ettiği şeyin ta kendisi.

### Şartname M1–M20

| # | Modül | Durum | Not |
|---|---|---|---|
| M1 | Kimlik, roller, onboarding | 🟢 | Davet, cihaz oturumları, TOTP karekodu, biyometrik kilit eklendi |
| M2 | Hasta dosyası | 🟢 | `GET /patients/:id/summary` yazıldı; kart düzenlenebilir, bölümler bekleyeni söylüyor |
| M3 | Mesajlaşma | 🟡 | Ek gönderme/açma ve erişim penceresi var. **Çeviri ve sesli mesaj yok** |
| M4 | AI triyaj + asistan | 🟢 | Asistan ekranı + protokol kaynak yönetimi |
| M5 | AI klinik analiz | 🟢 | Rapor onay kuyruğu, fotoğraf ön değerlendirme, brifing, tahlil yorumu isteme |
| M6 | Bildirim | 🟡 | İzin, jeton kaydı, aksiyon butonları hazır. **Sunucuda APNs anahtarı yok** (bkz. KLINIKTEN 12) |
| M7 | Fotoğraf takibi | 🟢 | Overlay, kaydırmalı karşılaştırma, işaretli fotoğraf kuyruğu |
| M8 | Acil durum | 🟢 | Personel kuyruğu, klinik özet, harita, arama, kapatma |
| M9 | İlaç ve uyum | 🟢 | Reçete yazma (RRULE kurucu), onay, kesme, etkileşim uyarıları, uyum skoru |
| M10 | Randevu ve takvim | 🟡 | Ay görünümü, ICS, personel randevu verme. **Müsaitlik tanımı ve video görüşme yok** |
| M11 | Finans ve istatistik | 🟢 | İki panel: grafikli istatistik, alacak yaşlandırma + tahsilat + ödeme/iade |
| M12 | Raporlama ve dışa aktarım | 🟢 | Kolon seçimli export, geçmiş, indirme, hasta özet PDF isteme |
| M13 | Denetim günlüğü | 🟢 | Filtreli kayıt + sunucunun anomali tespiti |
| M14 | Asenkron kuyruk | 🟡 | Durum rozetleri ve başarısızlık nedeni var; canlı WebSocket ilerlemesi yok |
| M15 | Offline-first | 🟡 | Okumalar son bilinen yanıta düşüyor; **yazmalar kuyruğa giriyor, tekrar gönderiliyor ve ekranda gönderilmedi diye görünüyor**. Fotoğraf/belge yüklemeleri hâlâ kuyruk dışında |
| M16 | Belge tarayıcı + OCR | 🟢 | VisionKit tarama, çok sayfa → PDF, cihaz üstü ön okuma |
| M17 | Onam ve belge yönetimi | 🟢 | Onam verme/geri alma, **parmakla imza** (PNG olarak özel depoda, hekim dosyadan görüyor), **ameliyat öncesi belge kontrol listesi**. Onam metnini klinik yayımlayana kadar imzalama ekranı açılmıyor |
| M18 | PROM anketleri | 🟢 | Hasta formu + doktorda eğilim ve bulgular |
| M19 | Sağlık turizmi | 🟢 | `travel_plans` yazıldı: uçuş, otel, karşılama, tercüman, uçuş onayı + aracı kurumlar |
| M20 | HealthKit | 🟢 | Kilo ve nabız, günde bir okuma, "cihazdan" etiketiyle |

**20 modülün 14'ü tam, 6'sı kısmi, 0'ı boş.** (Önce: 4 / 6 / 10.)

---

## Bölüm 3 — Hâlâ yapılmayanlar

Bunlar unutulmadı; her birinin neden yapılmadığı yazılı.

### Kod yazarak bitmeyecekler

1. **Push gönderimi (M6).** Sunucuda APNs göndericisi yok, çünkü anahtar yok.
   Apple Developer hesabınızdan bir `.p8` + Key ID + Team ID gerekiyor.
   `KLINIKTEN-ISTENENLER.md` madde 12. **Bu gerçek hastayla kullanımın önündeki
   maddedir**: ilaç hatırlatması ve kritik değer uyarısı telefona düşmüyor.
2. **İlaç etkileşim tablosu, triyaj ifadeleri, PROM eşikleri.** Bir eczacı /
   klinisyen onayı gerekiyor. Tablolar büyütüldü, **onaylanmadı**. KLINIKTEN
   1–3.
3. **VoiceOver / TalkBack ile insan denetimi (T7.4).** Otomatik denetleyici dört
   mekanik hatayı görüyor ve temiz; okuma sırası ve etiket ifadeleri bir insanın
   ekran okuyucuyla gezmesini gerektiriyor.

### Kod yazarak bitecek ama yapılmadı

4. **Mesaj çevirisi (M3).** Ne sunucuda ne istemcide var. Hasta kendi dilinde
   yazınca doktorun Türkçe okuması için bir çeviri katmanı gerekiyor — yeni bir
   servis, yeni bir sağlayıcı kararı.
5. **Sesli mesaj + transkript (M3).** `MessageType.audio` ve `transcript` alanı
   var, kayıt arayüzü ve transkripsiyon işi yok.
6. **Müsaitlik tanımı (M10).** `AvailabilityWindow` tablosu var, uç noktası yok.
   Doluluk raporu bu yüzden "kapasite tanımlı değil" diyor.
7. **Video görüşme (M10).** Şartnamede opsiyonel; hiç başlanmadı.
8. **Offline yazma kuyruğu (M15).** ✅ **2026-09-10'da yapıldı.** Ölçüm, doz
   check-in'i, şikâyet, anket ve mesaj bağlantı yokken kuyruğa giriyor; bağlantı
   dönünce kendiliğinden gönderiliyor; ekranlar bunları "Gönderilmedi" diye
   gösteriyor. Sunucuya `Idempotency-Key` eklendi, yani yanıtı yolda kaybolan bir
   yazmanın tekrarı ikinci bir kayıt yaratmıyor. Ayrıntı:
   [OFFLINE-VE-CAKISMA.md](OFFLINE-VE-CAKISMA.md).

   **Kalanı:** fotoğraf ve belge yüklemeleri (multipart) bu kuyruktan geçmiyor.
9. **Parmakla imza + belge kontrol listesi (M17).** ✅ **2026-09-10'da yapıldı.**
   Hasta onam metnini okuyup parmağıyla imzalıyor; imza PNG olarak kliniğin özel
   deposuna yazılıp onam kaydına bağlanıyor, hekim hasta dosyasından açabiliyor.
   Kontrol listesi hangi belgenin ulaştığını/eksik olduğunu gösteriyor ve eksik
   olanı yüklemeye götürüyor.

   **Kliniğe bağlı olan:** onam metninin kendisi (bkz. KLINIKTEN 13) ve belge
   listesinin gözden geçirilmesi (KLINIKTEN 14). Metin gelene kadar imzalama
   ekranı açılmıyor — imzalanabilir boş bir taslak, hiç form olmamasından
   kötüdür.
10. **WhatsApp kanalı (M6).** Şartnamede opsiyonel.
11. **Android.** Bu belgedeki her şey **yalnız iOS**. Android'de temel iskelet
    ve ağ katmanı var; bu 38 ekranın hiçbiri yok.

### Faz 7 borçları

12. T7.2 güvenlik denetimi + OWASP Mobile listesi
13. T7.5 beta (TestFlight / Play Internal)
14. T7.6 mağaza hazırlığı
15. T7.7 kullanım kılavuzları

---

## Bölüm 4 — Nasıl doğrulandı

Her ekran, uygulamanın **kendi modelleri ve çözümleyicisiyle**, gerçek staging
sunucusuna karşı yükleniyor:

```bash
KLINIK_SMOKE_BASE_URL=… KLINIK_STAFF_IDENTIFIER=… \
KLINIK_STAFF_PASSWORD=… KLINIK_STAFF_TOTP=… \
swift test --package-path ios --filter StaffSmokeTests
```

Bu testin kapsamı: gündem, acil kuyruğu, rapor onayı, takvim, istatistik,
finans, aracı kurumlar, dışa aktarım, denetim günlüğü, asistan kaynakları, AI
ayarları, gelen kutusu, işaretli fotoğraflar, hesap/cihazlar, hasta listesi,
hasta dosyası, mesajlaşma, ölçümler, belgeler, tahlil onayı, tahlil trendi,
fotoğraflar, kontrol takvimi, randevular, ilaçlar, anketler, seyahat planı,
şikayet kuyruğu.

**Ama bu düşük bir çıta.** "Hata vermeden yükleniyor", "birinin ihtiyacını
karşılıyor" demek değil — bu belgenin ilk halinin varlık sebebi tam olarak
buydu. Ekranların işe yarayıp yaramadığını söyleyecek olan sizsiniz.
