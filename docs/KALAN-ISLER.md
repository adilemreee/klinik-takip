# Kalan İşler

2026-09-11'de koddan çıkarıldı. "Şu an ne eksik" sorusunun cevabı; tahmin değil,
her madde bir dosya ya da bir uç noktayla eşleşiyor.

Üç ayrı liste: **kod yazarak biter**, **klinikten bir şey gelmeden bitmez**, ve
**bilerek yapılmadı**. Karıştırmamak önemli — birincisi benim işim, ikincisi
sizin, üçüncüsü ikimizin de dokunmaması gereken.

> Bu tarama sırasında bulunan bir hata **aynı gün düzeltildi**: reçete
> ekranındaki "Onayla" ve "Kes" düğmeleri sunucuda karşılığı olmayan bir yola
> istek atıyordu (404). Artık `check-api-paths.mjs` her yolu sözleşmeyle
> karşılaştırıyor ve CI'da koşuyor.

---

## A — Kod yazarak biter

### [ ] A1. Hasta uygulamadan hesap açamıyor

**Nerede:** [AuthFlow.swift](ios/Sources/KlinikAuthFeature/AuthFlow.swift:11) ·
sunucu: `POST /auth/invitations/accept`

Sunucuda davet kodunu kullanıp parola belirleyen uç **var**. iOS'ta onu çağıran
hiçbir şey **yok**: giriş akışı `credentials → twoFactorCode → signedIn`, arada
davet adımı yok. Klinik davet üretebiliyor (personel tarafında `InviteView`),
hasta o kodu girecek bir ekran bulamıyor.

Kanıt: hata sözlüğü bu ekran için **zaten hazır** —
`INVITATION_INVALID`, `INVITATION_EXPIRED`, `INVITATION_ATTEMPTS_EXCEEDED`,
`PASSWORD_TOO_WEAK` dördü de `APIError`'da tanımlı ve iki dile çevrilmiş.
Testi bile var (`testEveryAuthErrorCodeMapsToAMessage`). Boru döşenmiş, musluk
takılmamış.

**Neden önemli:** gerçek hastayla kullanımın önündeki maddelerden biri. Staging'deki
tek hasta hesabı elle, veritabanından açıldı.

### [ ] A2. Parola değiştirilemiyor

**Nerede:** [AccountScreen.swift](ios/Sources/KlinikAuthFeature/AccountScreen.swift) ·
sunucu: `POST /auth/password`

Hesap ekranında biyometrik kilit, bu cihaz, diğer cihazlar ve "her yerden çık"
var. Parola değiştirme yok. Sunucuda uç duruyor.

### [ ] A3. İki faktör kapatılamıyor

**Nerede:** sunucu `POST /auth/2fa/disable`, iOS'ta çağıran yok.

Personel bir kez TOTP kurduktan sonra uygulamadan kapatamıyor. Telefonunu
değiştiren bir hemşirenin tek çıkışı veritabanı.

### [ ] A4. Hasta kendi verisini indiremiyor (KVKK erişim hakkı)

**Nerede:** sunucu
[me.controller.ts:32](backend/src/me/me.controller.ts:32) `GET /me/data-export`,
iOS'ta çağıran yok.

Uç noktanın kendi açıklaması "kanunun kastettiği anlamda taşınabilir" diyor —
yani bilerek PDF değil, yapılandırılmış veri. Ekranı yok. KVKK aydınlatma
metninde hastaya vaat edilen bir hak, uygulamada karşılığı olmayan.

### [ ] A5. Fotoğraf yüklemeleri çevrimdışı kuyruğa girmiyor

**Nerede:** [PhotoGalleryModel.swift:113](ios/Sources/KlinikPhotosFeature/PhotoGalleryModel.swift:113)

Belge yüklemeleri kuyruğa giriyor (`DocumentsModel.hold` → `UploadQueue`).
Fotoğraf yüklemesi girmiyor: bağlantı yoksa `state.error` yazılıp bitiyor.

**Neden önemli:** ameliyat sonrası yara fotoğrafı, otel wifi'sinde çekilen tam
olarak o şey. Belge için kurulan mekanizmanın aynısı, ikinci bir çağrı yeri.

### [ ] A6. Küçükler

- **Yapay zekâ kullanımı/maliyeti** — `GET /ai/usage` var, ekranı yok. AI
  ayarları ekranı sağlayıcıyı ve fiyatı alıyor, harcamayı göstermiyor.
- **Döviz kuru** — `GET /finance/rates` var, çağıran yok.
- **Hazır yanıt düzenleme** — `PATCH /quick-replies/{id}` var, uygulamada
  yalnızca listeleniyor.
- **Demo tahlil PDF'leri boş** — `seed-demo.ts` panel başına Document satırı
  açıyor ama dosya yüklemiyor (`size: 0`), demo hastalarında "raporu aç" 404
  veriyor. Gerçek yüklemelerde sorun yok.

### [ ] A7. Android, hastanın yarısı — personelin hiçbiri

13 ekran, 16 modül, ~22 000 satır Kotlin. Ana ekran, sohbet, ilaçlar, ölçümler,
belgeler, tahlil, kontrol takvimi, randevu, onamlar, bildirim ayarları var.

**Yok:** personel tarafının tamamı (hasta listesi, reçete yazma, finans,
istatistik, denetim, dışa aktarım, brifing, AI ayarları) ve son üç oturumda
iOS'a eklenen her şey (tahlil tablosu, parmakla imza, belge kontrol listesi,
çalışma saatleri, bekleyen değişiklikler, anketler, seyahat, asistan).

iOS'ta 46 ekran dosyası var; Android'de 13.

---

## B — Klinikten bir şey gelmeden bitmez

### [ ] B1. Hiçbir bildirim kimseye ulaşmıyor

**Nerede:** [notifications.module.ts:34](backend/src/notifications/notifications.module.ts:34)

Bu, listedeki en büyük madde ve bugüne kadar "APNs anahtarı yok" diye yazılmıştı.
Gerçek daha geniş: **üç kanalın üçü de** `UnconfiguredSender` olarak kayıtlı —
`PUSH`, `SMS`, `EMAIL`. Hiçbiri yapılandırılmamış.

Yani şu an: ilaç hatırlatması, kritik tahlil değeri uyarısı, randevu
hatırlatması, acil çağrı tırmandırma merdiveni — hiçbiri kimseye ulaşmıyor.
Deneme yapılıyor, başarısız kaydediliyor, kayıt dürüst; ama kimse haber almıyor.

Gereken:
- **PUSH** → Apple'dan `.p8` + Key ID + Team ID (KLINIKTEN 12)
- **EMAIL** → bir SMTP hesabı. **Apple anahtarı beklemeye gerek yok**; e-posta
  kanalı tek başına açılabilir ve merdivenin en azından bir basamağı çalışır.
- **SMS** → bir sağlayıcı (isteğe bağlı, e-postadan sonra)

`UnconfiguredSender`'ın yorumu neden sahte başarı döndürmediğini anlatıyor ve
doğru: uydurulmuş bir "gönderildi", kimsenin haberi olmadığını ilk kez bir
hastanın söylemesiyle öğrenmek demek olurdu.

### [ ] B2. Onaylanmamış klinik tablolar

İlaç etkileşim tablosu (eczacı), triyaj kırmızı bayrak ifadeleri (klinisyen),
PROM anketi alarm eşikleri (klinisyen). Tablolar dolu, **onaylanmadı**.
KLINIKTEN 1–3.

### [ ] B3. Onam metninin hukuki okuması

`docs/TEDAVI-ONAM-METNI.md` yazıldı ve mekanizması çalışıyor. Bir hekim ve bir
avukatın okuması, `[KLİNİK ADI]` / `[ACİL TELEFON]` gibi alanların doldurulması
gerekiyor. KLINIKTEN 13.

### [ ] B4. VoiceOver / TalkBack ile insan denetimi

Mekanik denetleyici temiz. Okuma sırası ve etiket ifadeleri bir insanın ekran
okuyucuyla gezmesini gerektiriyor.

### [ ] B5. TestFlight / Play Internal

Sizin Apple ve Google hesaplarınız gerekiyor.

---

## C — Bilerek yapılmadı

1. **Sesli mesaj transkripsiyonu.** Hastanın sesini üçüncü bir tarafa göndermek
   yeni bir veri kategorisi ve yeni bir KVKK kararı. `transcript` alanı boş
   duruyor; klinik sağlayıcıya karar verince dolar.
2. **Video görüşme (M10).** Şartnamede opsiyonel, hiç başlanmadı.
3. **WhatsApp kanalı (M6).** Şartnamede opsiyonel.
4. **Şikayet zaman damgası.** Doz bildirimi hastanın saatini taşıyor;
   şikayet taşımıyor, çünkü `reportedAt` yanıt süresi hedefinin ölçüldüğü saat.
   Gerekçe [ComplicationsAPI.swift:49](ios/Sources/KlinikAPI/ComplicationsAPI.swift:49).
5. **Çakışma çözme mekanizması.** Yazıldı ve test edildi ama tetikleyecek bir
   *düzenleme* ucu kuyruğa alınmadığı için çalışmıyor. Gerekçe
   [PendingWrite.swift:32](ios/Sources/KlinikAPI/PendingWrite.swift:32).
6. **SSH sertleştirmesi.** Talep edilmedi; risk kaydedildi.

---

## Sıralama önerisi

Gerçek hastaya açmadan önce sırayla:

1. **B1'in e-posta yarısı** — Apple'ı beklemeden yapılabilir, ve hiçbir
   bildirimin gitmemesi şu anki en büyük açık.
2. **A1** — hasta hesap açamıyorsa geri kalanının önemi yok.
3. **A4** — KVKK erişim hakkı, metinde vaat edilmiş.
4. **A2, A3** — parola ve iki faktör, temel hesap işlemleri.
5. **A5** — yara fotoğrafının kaybolmaması.
6. **B2, B3, B4** — klinik onayları; paralel yürüyebilir.

A6 ve A7 bundan sonra.
