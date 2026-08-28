# Ölçümler ve VKİ

Şartname §M2, T3.1. Kod: [`backend/src/measurements/`](../backend/src/measurements/) ·
[`ios/Sources/KlinikMeasurementsFeature/`](../ios/Sources/KlinikMeasurementsFeature/) ·
[`android/feature/measurements/`](../android/feature/measurements/)

## VKİ Saklanmıyor, Hesaplanıyor

Boy yanlış girilir. **17 ile 170 arasında tek tuş var.** Boy düzeltildiğinde saklanmış bir
VKİ değeri olduğu yerde kalır ve yanındaki kilo değerleriyle sessizce çelişmeye başlar —
grafiği okuyan doktor iki farklı gerçeği aynı ekranda görür.

Bu yüzden VKİ hiç saklanmıyor; her okumada kilodan ve boydan hesaplanıyor. Boy düzeltilince
**eğrinin tamamı kendiliğinden düzeliyor**. Testi var: 160 cm ile çizilen eğri, boy 170'e
düzeltildiğinde 25.9'dan 22.9'a iniyor.

### Hangi boy?

O kilonun alındığı tarihte geçerli olan boy — en sonuncusu değil. Boyu gerçekten değişen
hastalarda (ergen hastalar, omurga ameliyatı sonrası) geçmişi dürüst tutan tek seçenek bu.

Hiç boy yoksa eğri boş dönüyor. Tahmini bir boy koymak, **kimsenin ölçmediği bir sayıyı
grafiğe yazmak** olurdu.

## Makul Olmayan Değer Kapıda Reddediliyor

Vücut ağırlığı doz hesabına giriyor (§M9). 800 kg'lık bir kilo kaydı, sonradan "herhalde
yanlıştır" diye yorumlanacak bir veri değil; hiç girilmemesi gereken bir veri.

Her ölçüm türünün makul aralığı `bmi.ts` içinde. Tansiyon ayrıca **iki sayının da**
gelmesini ve büyük tansiyonun küçüğünden yüksek olmasını istiyor — 70/120 diye ters girilmiş
bir tansiyon reddediliyor.

Reddedilen değerin mesajı hangi sınırın aşıldığını söylüyor ve iki istemci de **sunucunun
mesajını olduğu gibi** gösteriyor. Kendi genel mesajımızı koymak, hemşireden neyin yanlış
olduğunu saklamak olurdu.

## Kaynak Çağıranın Seçimi Değil

Bir ölçüm hasta tarafından mı, klinikte mi, cihazdan mı geldi — grafiği okuyan klinisyenin
bunu ayırt edebilmesi gerekiyor (§M20). Bu yüzden iki ayrı uç var:

- `POST /patients/:id/measurements` — personel, `medical.write`, kaynağı kendisi belirtir
- `POST /me/measurements` — hasta, `self.write`, kaynak **sunucuda** `PATIENT` yazılır

Hasta ucunda `source` alanı gönderilirse istek 400 ile reddediliyor; sessizce düzeltilmiyor.
Sessiz düzeltme, istemci hatasını görünmez kılar.

## Tek Ekran, Tek İstek

`GET .../chart` kilo eğrisini, VKİ eğrisini ve hedef çizgisini birlikte döndürüyor. Ayrı
çağrılar olsaydı bir istemci, eğrisini bir okumadan, hedef çizgisini başka bir okumadan
çizebilir ve **kendi içinde çelişen bir grafik** gösterebilirdi.

Hedef kilo `medical_profiles.target_weight_kg` alanında; hedef VKİ aynı yanıtta sunucuda
hesaplanıyor, iki istemci çizgiyi iki ayrı yere koyamasın diye.

Hedef yoksa `null` dönüyor — çizgi çizilmiyor. Sıfırda bir çizgi çizmek olmayan bir hedefi
var göstermek olurdu.

## Testlerin Yakaladığı Gerçek Hata

`Decimal` bir denetim kaydına serileşmiyor. Prisma'nın JSON protokolü `Prisma.Decimal`
nesnesini reddediyor ve **işlemin tamamını** düşürüyor — yani denetim satırı değil,
denetlenen değişiklik başarısız oluyordu.

İlk `Decimal` sütunu ölçümlerde çıktı, ama sıradaki finans modülünde de aynısı olacaktı.
`AuditService.redact` artık `Decimal`'i (basamak kaybetmemek için metin olarak), `bigint`'i
ve byte dizilerini (yalnız boyutunu, içeriğini asla) serileştiriyor.

Ayrıca: Prisma migration üretirken el yazısı trigram ve HNSW indekslerini **üçüncü kez**
düşürmeye kalktı. Üretilen SQL okunup düzeltildi; indekslerin ayakta kaldığı doğrulandı.

## İstemci Tarafı

Sayı girişi hem `72,4` hem `72.4` kabul ediyor — hastalar birçok ülkeden geliyor, kliniğin
kendi personeli Türkçe yazıyor. `"72,4".toDoubleOrNull()` null döner; saf bir ayrıştırma
sağlam bir kiloyu boş alana çevirir. `72kg`, `72.4.5`, `72,` gibi girdiler ise **reddediliyor**;
"bir şeye" ayrışan değer, hiç ayrışmayandan tehlikeli.

Kayıttan sonra grafik yerelde büyütülmüyor, sunucudan yeniden çekiliyor: yeni bir kilo,
eklenen noktadan fazlasını değiştirebilir.

Android'de eğri Canvas ile çiziliyor; bir çizgi ve bir kural için grafik kütüphanesi
bağımlılığı eklemek, her bağımlılığın güvenlik danışmasıyla takip edildiği bir klinik
uygulamada karşılığı olmayan bir maliyet. Ölçekleme mantığı (`ChartGeometry`) Compose
modülünde değil, testlerin koştuğu saf Kotlin modülünde — **yanlış ölçeğe çizilmiş bir eğri
de eğri gibi görünür**.
