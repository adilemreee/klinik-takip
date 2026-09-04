# Yapay Zeka Katmanı — Sağlayıcı Soyutlaması

Şartname §3.4 ve §14, T5.1. Kod: [`backend/src/ai/`](../backend/src/ai/)

## Tek Kapı

§14'teki kırmızı çizgiler tavsiye değil, **her çağrı için koşul**. Ve her çağrı
noktasında ayrı ayrı uygulanan bir koşul, er geç uygulanmadan yazılacak bir çağrı
noktası demektir.

Bu yüzden tek kapı var: `AIService.complete()`. Sağlayıcıya tek token gitmeden önce
bütün kapılar çalışıyor, ve dönen değer çağıranın **yanıt sanamayacağı** bir tipte:

```ts
type AIResult =
  | { ok: true;  text; model; usage; costUsd; truncated }
  | { ok: false; reason; message }
```

`ok` kontrol edilmeden `text` okunamıyor. Bu, "AI cevabı yoksa boş string" gibi bir
sessiz başarısızlığı derleme hatasına çeviriyor.

## Sağlayıcı Dikişi

Arayüz bilerek dar: **"şu mesajları gönder, metin ve token sayısı al"**. Dar bir
arayüz onu değiştirilebilir kılan şeydir — çağıran taraf yalnız bir sağlayıcıda
olan bir şeye uzandığı anda soyutlama, o sağlayıcının tarifi olur.

Anthropic ile OpenAI arasındaki bütün fark iki dosyada ve kısa: sistem istemi biri
için alan, diğeri için ilk mesaj; anahtar biri için `x-api-key`, diğeri için
`Authorization`; token sayılarının adları farklı. Listenin kısa olması dikişin
doğru yerde olduğunun kanıtı.

`UnconfiguredProvider` varsayılan ve **reddediyor**. Makul metin döndüren bir stub,
doktorun önüne model adı ve zaman damgasıyla **uydurulmuş klinik içerik** koyardı.
Bir cevabın güvenli yer tutucusu yoktur.

## Kapılar

### 1. Sıfır saklama (§14.5)

Şartname "sağlayıcının veri saklamama koşulları sağlanmalı; sağlanamıyorsa sağlık
verisi gönderilmez" diyor. Kod bunu **doğrulayamaz** — tam da bu yüzden açık bir
anahtar (`AI_ZERO_RETENTION`) ve **varsayılanı kapalı**. Kapalıyken hasta
verisinden türetilen istemler gönderilmiyor, reddediliyor.

Varsayılanı "evet say" yapmak şartnamedeki maddeyi dekoratif hâle getirirdi.

### 2. Kimliksizleştirme (§14.4)

İki mekanizma, çünkü biri yetmiyor:

- **`pseudonymise`** bir istemin taşıyabileceği tek hasta şeklini üretiyor: ad yok,
  dosya numarası yok, iletişim yok, **doğum tarihi yerine yaş** — klinik soru
  neredeyse her zaman "kaç yaşında", asla "ne zaman doğdu". Şehir de yok: şehir +
  prosedür + tarih, küçük bir kliniği tek kişiye indirir.
- **`findLeaks`** bitmiş istemi okuyup kimlikleri **yine de** arıyor. Bu fazlalık
  değil: istemler serbest metinden kuruluyor — hastanın kendi mesajı, klinisyen
  notu, OCR'lanmış rapor — ve hastanın adı çoğu zaman onun **içinde** yazıyor.
  Yapısal şekil bunu göremez; giden istek, gören son yer.

Yakalananlar: ad (Türkçe büyük/küçük harf katlamasıyla — `AYŞE` ile `Ayşe` aynı
şeye inmezse başlıkla yazılmış ad kaçar), dosya numarası, e-posta, telefon (aynı
numara `+90 532…`, `0532…` ve `532…` diye üç kişi tarafından üç türlü yazılır) ve
**TC kimlik numarası kendi sağlamasıyla**.

TCKN'nin kendi kuralı var çünkü serbest metne en çok yazılan kimlik o, modele
ulaşmak için hiçbir meşru sebebi yok, ve addan farklı olarak **kime ait olduğunu
bilmeden tanınabiliyor**. Sağlama toplamı, kuralın herhangi bir 11 haneli sayıda
ateşlenmesini engelliyor.

> **Bilinen delik:** üç harften kısa adlar aranmıyor. "Su" ve "Ali" sıradan Türkçe
> kelimelerin içinde geçer; onları aramak neredeyse her istemi reddederdi ve her
> şeyi reddeden bir kontrol kapatılır. İki harfli bir ad bu geçişte yakalanmıyor,
> `pseudonymise`'ın onu en baştan dışarıda tutmuş olmasına güveniyor.

**Red mesajı türü söylüyor, değeri asla.** Red loglanıyor; kimliği adıyla yazan bir
log satırı, az önce engellediği sızıntının ta kendisi olurdu — üstelik haftalarca
saklanan bir yere.

### 3. Bütçe (§3.4)

Klinik bütçesinde sınırsız AI harcaması gerçek bir arıza modu. Her çağrıdan önce
ayın harcaması toplanıyor; sınır aşıldıysa çağrı yapılmıyor.

Kontrol **çağrıdan önce ve zaten kaydedilmiş harcamaya karşı** — yapılacak çağrının
maliyeti dönene kadar bilinmiyor. Tek bir çağrı sınırı aşabilir; kabul edilen bir
durum, alternatifi istemden maliyet tahmin edip **tahmine göre reddetmek**.

Ay sınırı kliniğin saat diliminde: sunucu diliminde hesaplanan bir ay, ayın ilk
günü saat 03:00'e kadarki harcamayı yanlış aya yazardı — bunu kimse, bir sınır
gerçekten ısırana kadar fark etmez.

### 4. Fiyat tablosu yok — ve tasarım bu

Depoda model fiyat tablosu **yok**. Fiyatlar değişir, hesaba göre farklılaşır ve
operatörün faturadan okuyabildiği, bizim okuyamadığımız tek sayıdır. Depoya konan
bir tablo bir çeyrek içinde eskir ve yine de inanılır — ki bu hiç sayı olmamasından
kötüdür: eski fiyatlarla uygulanan bir bütçe, rahatsız edici bir faturayı rahat
gösterir.

Bu yüzden iki fiyat **yapılandırma**, AI açıkken **zorunlu**, ve muhasebe kurgu
gereği kesin. Fiyatı olmayan bir modelde AI katmanı **açılmıyor** — açılmamak,
null kaydetmekten gürültülü, boot'u reddetmekten sessiz: klinik çalışmaya devam
ediyor, sebep gelecek ayın faturasında değil logda duruyor.

## Retry Politikası

Bu çağrılar yavaş ve paralı. Sağlayıcının reddedeceği bir isteği üç kez denemek
aynı cevaba üç kat gecikme harcar; hatalı bir API anahtarında ise **anında ve
apaçık bir yapılandırma hatasını**, yavaş model gibi görünen otuz saniyelik bir
zaman aşımına çevirir.

| Durum | Karar |
|---|---|
| 408, 429 | tekrar — sağlayıcı "sonra" diyor |
| 5xx | tekrar — sağlayıcı bozuk |
| statüsüz (ağ) | tekrar |
| 400, 401, 403, 404, 413, 422 | **bırak** — ikinci denemede aynı şekilde başarısız olur |

Bekleme **tam jitter**'lı: 429 genelde aynı anda her işe döner, ve sabit bir
program bütün yığını aynı ana geri gönderir — ki 429'a sebep olan şey odur.
`Retry-After` taban olarak dikkate alınıyor (sağlayıcı kendi limitini bilir) ama
sınırlanıyor; bir saatlik bekleme kararı kuyruğun, bu fonksiyonun değil.

Üç deneme **tek kuyruk işinin içinde**: onu tüketen bir iş kuyruk tarafından da
yeniden denenir — bir arızaya karşı üç hızlı deneme, bir kesintiye karşı çok
sonra bir yavaş deneme.

**Zaman aşımı önce kontrol ediliyor.** İptal edilen bir fetch sağlayıcının içinde
taşıma hatası olarak yüzeye çıkar, yani buraya ulaşan hata "sağlayıcıya
ulaşılamadı" der — hata ayıklayan kişiyi DNS ve güvenlik duvarına bakmaya
gönderir, oysa olan şey **beklemeyi bırakmamızdır**.

## İzlenebilirlik (§14.6)

Her çağrı `ai_jobs`'a yazılıyor: tip, durum, **cevabı gerçekten veren model**,
token sayıları, USD maliyet, deneme sayısı, süre.

Model kaydı istenen değil **dönen**: bir takma ad tarihli bir sürüme çözüldüğünde
ikisi farklıdır ve §14.6'nın istediği tarihli olandır.

Sebebi olan her **red** de kaydediliyor — triyajı durduran bir bütçe ya da ad
taşıyan bir istem, ikisi de sonradan bulunabilmesi gereken şeyler. Tek istisna
"yapılandırılmamış": bu bir olay değil, süregelen bir durum; çağrı başına
kaydetmek tabloyu aynı satırla doldurup anlamlı redleri gömerdi.

`GET /ai/usage` (`analytics.read`) ayın harcamasını, token sayılarını ve red
sayısını veriyor — bakılamayan bir sayı, fatura gelene kadar bakılmayan sayıdır.

## Yapılandırma

| Değişken | Zorunlu | Not |
|---|---|---|
| `AI_PROVIDER` | AI için | `anthropic` \| `openai` |
| `AI_API_KEY` | AI için | |
| `AI_MODEL` | AI için | |
| `AI_PRICE_INPUT_PER_MTOK` | AI için | milyon token başına USD |
| `AI_PRICE_OUTPUT_PER_MTOK` | AI için | milyon token başına USD |
| `AI_ZERO_RETENTION` | hayır | varsayılan **false**; false iken klinik istemler reddedilir |
| `AI_MONTHLY_BUDGET_USD` | hayır | yoksa sınır yok |
| `AI_TIMEOUT_MS` | hayır | varsayılan 60000 |
| `AI_MAX_OUTPUT_TOKENS` | hayır | varsayılan 1024 |

Hiçbiri ayarlı değilken katman **kapalı** ve her çağrıyı reddediyor. Staging'de
durum budur.

## Bu Katmanın Yapmadığı

§14'ün 1., 2. ve 3. maddeleri — AI tanı koymaz, çıktı karar desteğidir, kritik
durum insana eskale edilir — **buraya yazılamaz**. Çıktı metnine regex atmak
tiyatro olurdu. Onlar yapısal olarak uygulanıyor ve yerleri sonraki görevler:

- hastaya giden her çıktı `ai_reports.reviewed_by` üzerinden doktor onayına açık (T5.4),
- triyajda EMERGENCY/URGENT sınıfı **koda değil insana** düşüyor (T5.2),
- her AI çıktısının altındaki görünür uyarı istemci işi (T5.2–T5.6).

Bu görev bunların üstünde duracağı zemini kuruyor: tek kapı, kesin muhasebe,
denetlenebilir kayıt ve çağıranın yanıt sanamayacağı bir red.


## Sağlayıcı Seçimi (dört servis, çalışma zamanında)

Doktor hangi servisi kullanacağını **uygulamadan seçiyor** ve anahtarı orada
giriyor. Dört seçenek var: Anthropic (Claude), OpenAI (GPT), Google (Gemini),
DeepSeek.

`GET /ai/providers` katalogu veriyor — modeller, anahtarın alınacağı sayfa,
fiyat sayfası ve **her sağlayıcı için veri saklama uyarısı**. Ekran bu
katalogdan kuruluyor, kendi listesini taşımıyor; yoksa sunucunun kabul ettiğiyle
ekranın gösterdiği ayrışır.

### Anahtar girer, çıkmaz

Anahtar `EncryptionService` ile şifrelenip saklanıyor ve **hiçbir uç onu geri
döndürmüyor**. Ekran son dört karakteri görüyor — bir ekranın anahtar hakkında
gerçekten sorduğu tek soru budur: *hangisi*.

Denetim günlüğüne de girmiyor. Denetim kaydını ayarlar ekranından daha çok kişi
okur.

Fiyat değiştirmek için anahtarı yeniden yazmak gerekmiyor: gövdede `apiKey` yoksa
kayıtlı anahtara dokunulmuyor.

### Sıfır saklama beyanı sağlayıcıya ait

Bu, tek bir global bayrak olmaktan çıktı. Dört servis **aynı şartları
sunmuyor**:

| Sağlayıcı | Dikkat edilmesi gereken |
|---|---|
| Anthropic | API varsayılan olarak eğitimde kullanmıyor; sağlık verisi için ayrı sözleşme gerekir |
| OpenAI | Varsayılan olarak eğitimde kullanmıyor ama bir süre saklıyor; sıfır saklama ayrıca talep edilmeli |
| Google | **Ücretsiz katman** istemleri ürün geliştirmede kullanır — hasta verisi için uygun değil |
| DeepSeek | **API Çin'de barındırılıyor**, standart şartlar saklama ve eğitimde kullanıma izin veriyor — KVKK/GDPR açısından yurt dışına aktarım kararı |

Bu yüzden **sağlayıcıyı değiştirmek beyanı sıfırlıyor.** Anthropic hakkında
verilmiş bir beyan DeepSeek hakkında hiçbir şey söylemez, ve onu taşımak
kimsenin vermediği bir onayı kaydetmek olurdu. Testi var.

Beyan yokken sistem çalışır, sadece **klinik istem göndermez** — §14'ün baştan
beri yaptığı şey.

### Fiyat: depoda yok, bilerek

Katalogda model kimlikleri ve **fiyat sayfasının bağlantısı** var; fiyatın
kendisi yok. Bütçe koruması verilen sayıya karşı gerçek para harcıyor, ve depoya
yazılmış bir fiyat bir çeyrekte eskirken hâlâ yetkili görünür — dahası
*inanılır*, çünkü ayarlar ekranında durur ve kimsenin ne zaman baktığını
söylemez.

Fiyatsız model **açılmıyor**. Bu kural yumuşatılmadı.

### Bağlantı testi

`POST /ai/settings/test` sağlayıcıya "ping" gönderiyor. Klinik hiçbir şey
içermiyor, dolayısıyla sıfır saklama beyanından **önce** kullanılabilir.
Alternatifi, anahtarın yanlış olduğunu lab özeti başarısız olan klinisyenden
öğrenmek.

### Yetki

Hepsi `permissions.manage` — varsayılan olarak yalnız `SUPER_ADMIN`. Bu ayar
hastaya yakın metnin **nereye gittiğine** ve ne kadara mal olacağına karar
veriyor.

### Önyükleme sırası

Ortam değişkenleri `onModuleInit`'te **eşzamanlı** okunuyor; klinikte kayıtlı
ayar `onApplicationBootstrap`'ta ve **beklenmeden** yükleniyor.

Beklemek, yavaş ya da erişilemez bir veritabanının uygulamanın hiç açılmamasına
— sağlık problarının bile cevap verememesine — sebep olması demekti.
Beklememenin bedeli, açılıştan sonraki kısa bir an için ortamdaki sağlayıcının
(ya da hiçbirinin) kullanılması. Bu sistem tam olarak bunu absorbe etmek üzere
kurulu: AI kapalıyken her şey çalışır.
