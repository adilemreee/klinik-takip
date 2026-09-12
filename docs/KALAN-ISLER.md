# Kalan İşler

2026-09-11'de koddan çıkarıldı; A bloğunun tamamı 2026-09-11/12'de yapıldı.
"Şu an ne eksik" sorusunun cevabı; tahmin değil, her madde bir dosya ya da bir
uç noktayla eşleşiyor.

Üç ayrı liste: **kod yazarak biter**, **klinikten bir şey gelmeden bitmez**, ve
**bilerek yapılmadı**. Karıştırmamak önemli — birincisi benim işim, ikincisi
sizin, üçüncüsü ikimizin de dokunmaması gereken.

> Bu tarama sırasında bulunan bir hata **aynı gün düzeltildi**: reçete
> ekranındaki "Onayla" ve "Kes" düğmeleri sunucuda karşılığı olmayan bir yola
> istek atıyordu (404). Artık `check-api-paths.mjs` her yolu sözleşmeyle
> karşılaştırıyor ve CI'da koşuyor.

---

## A — Kod yazarak biter · **tamamlandı**

### [x] A1. Hasta uygulamadan hesap açamıyor — **yapıldı**

Giriş ekranına **"Davet kodum var"** eklendi. Kimlik + altı haneli kod + kendi
seçtiği parola; sonra uygulama otomatik giriş yapıyor, çünkü dört saniye önce
belirlediği parolayı tekrar yazdırmak insanları parolayı kâğıda yazmaya iten
şeydir. Personel daveti aynı akışla iki faktör kurulumuna düşüyor — davet adımı
bunu bilmek zorunda değil.

Parola kuralları **yazarken** gösteriliyor, sunucu reddettikten sonra değil.
`PasswordRules` sunucunun `checkPassword`'ünü aynalıyor (uzunluk, harf+rakam,
kendi adresini içermeme); yaygın parola listesi sunucuda kalıyor, çünkü onu
istemciye taşımak listeyi dağıtmak demek.

Reddedilen kodda kullanıcı formda kalıyor — bunu testler yakaladı, model
adımı garanti etmiyordu.

### [x] A2. Parola değiştirilemiyor — **yapıldı**

Hesap ekranında, iki kez yazdırarak (alan maskeli ve buradaki bir yazım hatası
insanı kendi klinik kaydından kilitler). Sunucu her cihazı çıkışa zorladığı
için uygulama da çıkış yapıyor: ekranda kalmak, her isteğin sebepsiz
başarısız olduğu bir ekran demek olurdu.

### [x] A3. İki faktör kapatılamıyor — **yapıldı**

Hastalar için, doğrulayıcıdaki güncel kodla. Personelde düğme yok ve **sebebi
yazıyor** — gizlenmiş bir ayarı arayan klinisyen, yokluk değil gerekçe bulmalı.

### [x] A4. Hasta kendi verisini indiremiyor — **yapıldı**

Hesap ekranında "Kayıtlarım". Sunucunun ürettiği baytlar olduğu gibi, ayrıştırılıp
yeniden kodlanmadan dosyaya yazılıyor ve paylaşım sayfasına veriliyor — taşınabilirlik
ihracının anlamı kaydın kendisi olması, bu uygulamanın ondan anladığı değil.
Nereye gideceği okuyucunun kararı, o yüzden bir yere kaydedilmiyor.

### [x] A5. Fotoğraf yüklemeleri kuyruğa girmiyor — **yapıldı**

Kuyruk artık iki tür taşıyor. Belge, oturum açıp parça parça gidiyor (20 MB'ın
kopan bağlantıdan sağ çıkması için); fotoğraf tek multipart POST — telefon
JPEG'i için baştan başlamak, devam etme defterini tutmaktan ucuz. Kuyruğun
buradaki kazancı devam edebilmek değil, **yarın hâlâ orada olması**.

Kategori ve vücut bölgesi de saklanıyor: bölgesiz bir yara fotoğrafı,
klinisyenin hiçbir şeyle karşılaştıramayacağı bir fotoğraftır. SQLite'a `v5`
migration'ı eklendi — bu kez tablo düşürülmedi, çünkü artık yayımlanmış bir
sürüm oraya satır yazmış olabilir.

Ekran da doğru şeyi söylüyor: tik değil, hata değil — "telefonunuzda kayıtlı,
bağlantı gelince gidecek, tekrar çekmenize gerek yok".

### [x] A6. Küçükler — **yapıldı**

- **Yapay zekâ harcaması** — AI ayarları ekranına bu ayki tutar, üst sınır,
  kullanılan oran, çağrı ve token sayısı eklendi. Ayrı izinle (`analytics.read`)
  korunduğu için ayrıca ve en iyi çabayla çekiliyor: maliyet paneli bu kişinin
  değil diye bütün ekranı düşürmek saçma olurdu.
- **Döviz kuru** — finans ekranında bu ayın kurları. "Bu toplam eksik"
  cümlesinin diğer yarısı: hangi günlerde kur var.
- **Hazır yanıtlar** — kaydetme ve silme eklendi. (Sunucuda **PATCH yok**;
  ilk envanterde "düzenleme" yazmıştım, doğrusu oluşturma ve silme.) Kliniğin
  ortak yanıtları rozetle işaretli ve silinemiyor — sunucu da reddediyor.
- **Demo tahlil PDF'leri** — dosya uydurulmadı. `seed-demo.ts`'deki yorum
  haklıydı: uydurma sonuçlar içeren sahte bir PDF'i kliniğin kovasına koymak
  404'ten kötü. Bunun yerine sunucu artık `documentAvailable` diyor ve baytı
  olmayan rapor için **düğme hiç gösterilmiyor**. Baytları kaybolmuş gerçek
  bir belge için de doğru davranış.

### [x] A7. Android — **yapıldı**

2026-09-11/12'de yapıldı. **44 ekran, 55 modül, 600 test** (13 ekrandan çıkıldı;
iOS'ta 46 ekran dosyası var).

**Personel kabuğu** iOS'taki üç sekmeye hizalandı — gündem (brifing), hastalar,
acil kuyruğu — her biri kendi geri yığınıyla. Üstüne klinik geneli taşma menüsü:
gelen kutusu, şikayet kuyruğu, işaretli fotoğraflar, onay bekleyen yapay zekâ
yorumları, takvim, çalışma saatleri, istatistik, finans, aracı kurumlar, dışa
aktarım, AI sağlayıcısı, asistan kaynakları, denetim günlüğü, yeni hasta, hesap,
bekleyen değişiklikler, bildirim tercihleri.

**Hasta dosyası** bölümleri: ölçümler, belgeler, belge kontrol listesi, tahlil
doğrulama, tahlil eğilimi, tahlil panelleri, fotoğraflar, kontrol takvimi,
randevular, sohbet, seyahat, **reçete yazma**, onamlar, anket eğilimi. Dosyadan
hastayı uygulamaya davet edilebiliyor.

**Hasta tarafı:** asistan, anketler, paylaşılan tahlil yorumları, tahlil
panelleri, belge kontrol listesi, seyahat planı, hesap, bekleyen değişiklikler,
**davetle hesap açma** ve **onam metnini okuyup parmakla imzalama**.

**Sunucuda olup Android'de hiç istemcisi olmayan 14 uç nokta yazıldı:** denetim
günlüğü (`/audit`, `/audit/anomalies`), seyahat planı, protokol kitaplığı,
`/auth/password`, `/auth/2fa/disable`, `/auth/sessions`, `/auth/logout-all`,
`/auth/invitations`, `/me/data-export`, `/documents/checklist`,
`/lab-results/panels`, `/me/consents/form`, `/finance/agencies`,
`/appointments/availability`, reçete yazma/onaylama/kesme, `POST /patients`.
Ayrıca `FinanceApi.records` para birimi almıyordu ve `/finance/rates`'in
istemcisi yoktu.

**Bu turda bulunan ve düzeltilen sessiz hatalar:**

| Hata | Sonucu ne olurdu |
| --- | --- |
| Modellerde 25 anahtar Android kaynak adı üretiyordu (`triage_level_urgent`), arama katalog anahtarıyla yapılıyor (`triage.level.URGENT`) | İlk kullanan klinisyene ham anahtar |
| `acceptInvitation` `requiresAuthentication = false` almıyordu | Davet kodunu giren hastaya "oturumunuzun süresi doldu" |
| `MessagingApi.inbox()` yanıtı `Conversation` olarak çözüyordu | Gelen kutusu: hasta adı, son mesaj ve okunmamış sayısı düşüyordu |
| `/photos/flagged` hastayı taşımıyordu (iki istemcide de) | İncelenecek yara fotoğrafı var, kimin olduğu yok |
| `PATCH /finance/agencies/{id}` gövdesi sözleşmede yoktu | `isActive` hiçbir şemada değil; aracı kurum kapatılamaz |
| Her fotoğraf ekranı `imageFor = { null }` geçiyordu | Yara galerisinde hiç görsel yok |

`StringCatalogueTest` artık 32 `stringKey`'in hepsini, modellerdeki her
`…Key`/`…Keys` sabitini (özellik ve fonksiyon) ve feature modüllerini tarıyor.
`StaffDestinationTest` mühürlü hiyerarşiyi yürüyor: kapısı olmayan klinik geneli
bir ekran dizüstünde düşüyor.

**Hâlâ yok:** takvim aboneliği (`calendar.ics`) ve fotoğraf bindirmesi
(`photos/overlay`) — ikisi de istemci düzeyinde var, ekranı yok. Bildirimler
burada değil; **B1**'de ve sizin kararınızı bekliyor.

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

0. **Sunucudaki `quick-replies` PATCH'i.** İlk envanterde "düzenleme eksik"
   yazmıştım; öyle bir uç yok. Oluşturma ve silme yeterli — bir hazır yanıtı
   düzenlemek, silip yeniden yazmaktır.
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

A bloğu kapandı. Geriye kalan sıralama **B**'nin kendisi.

---

## 2026-09-12 notu

**A bloğunun tamamı kapandı.** Android 13 ekrandan 44'e çıktı; iOS'ta 46 ekran
dosyası var ve aradaki fark takvim aboneliği ile fotoğraf bindirmesi.

Sunucuda hazır olup hiçbir istemcisi olmayan 14 uç nokta bu turda bağlandı ve
altı sessiz hata çıktı — hepsi de "uç nokta cevap veriyor, test yeşil, kimse
açmamış" türünden. En pahalısı davet kabulüydü: kodu giren hastaya
"oturumunuzun süresi doldu" diyordu, çünkü istemci hiç var olmamış bir oturumu
yenilemeye çalışıyordu.

Bu turda ayrıca CI'da bir kararsızlık giderildi: backend işi MinIO
imajını Docker Hub'dan anonim çekiyordu ve koşucunun paylaşılan IP
kotası dolduğunda daemon bunu "pull access denied … repository does not
exist" diye bildiriyor — imaj silinmiş gibi okunuyor. Yalnızca Android'e
dokunan bir commit bu yüzden düştü. Artık quay.io'dan ve sürüm sabitli.

`design/scripts` altındaki altı denetleyici yerelde saniyeler sürüyor ve
CI'daki "Design tokens" işinin tamamı; ekran ekleyen her commit'ten önce
koşturulmalı. Bu turda `touch-target-unchecked` bir kez CI'da yakalandı.
