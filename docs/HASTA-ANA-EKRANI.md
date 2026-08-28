# Hasta Ana Ekranı

Şartname §7, M8, T2.5. Kod: [`backend/src/me/`](../backend/src/me/) ·
[`ios/Sources/KlinikHomeFeature/`](../ios/Sources/KlinikHomeFeature/) ·
[`android/feature/home/`](../android/feature/home/)

## Hasta Kendi Dosyasını Okuyamıyordu

Hastalarda `self.read` izni var, ama hasta uçları `patients.read` istiyor. O izni hastalara
vermek **her hastayı her dosyaya yaklaştırırdı** — T1.3'ün tam olarak engellemek için var
olduğu şey.

Bu yüzden ayrı bir uç: `GET /me/summary`. Kapsam aynı `PatientAccessService`'ten geliyor,
dolayısıyla onamı olan bir refakatçi de bağlı olduğu dosyaya ulaşıyor — ve **onam geri
alındığı anda ulaşamıyor**.

### Testlerin yakaladığı gerçek hata

Okunmamış mesaj sayımı yanlıştı. Klinikten gelen bir mesajın **göndereni yok** ve SQL'de
`sender_id != ben` karşılaştırması NULL bir gönderen için NULL döner — SQL bunu
"eşleşmedi" sayar.

Sonuç: sistem ve bot mesajları hiçbir zaman okunmamış olarak sayılmıyordu. Yani hastanın
**en çok görmesi gereken** mesajlar.

Sorgu artık NULL durumunu açıkça ele alıyor.

## Beş Eylem — Sınır Bir Kısıt Değil, Karar

§7 hasta ana ekranını en fazla 5 birincil eylemle sınırlıyor: **Mesaj, Belge Yükle,
İlaçlarım, Fotoğraf Ekle, Acil Durum.**

Altıncısını eklemek, ekranı **onu en az soğurabilecek insanlar için zorlaştırma** kararı
olurdu. Bu yüzden liste sabit ve tüketici; test sayıyı koruyor.

Rozetler yalnız sıfırdan büyük sayılarda görünüyor. "0" yazan bir kutucuk okuyucuya hiçbir
şey söylemez ve önemli olanlarla dikkat için yarışır.

## Acil Durum: Ters Yönde İki Hata

| Hata | Bedeli |
|---|---|
| Cepteki yanlış dokunuş | Bir başkasının ihtiyacı olabilecek klinik dikkati harcar |
| Gönderilemeyen bildirim | Gerçek bir acilde **çok daha kötü** |

İkisi ters yönde çektiği için akış her ikisini de ayrı ayrı ele alıyor:

- **İlk dokunuş göndermez**, yalnız kurar. Birkaç saniye sonra kendiliğinden iner —
  sürekli kurulu kalan bir buton, cebin er geç bastığı butondur.
- **Başarı yalnız sunucu onayladıktan sonra** bildirilir.
- **Başarısızlıkta "klinik haberdar edilmedi" açıkça yazılır** ve bulunduğu ülkenin acil
  numarası önerilir.

> Gönderilmemiş bir bildirimi "klinik haberdar edildi" diye göstermek, birini **gelmeyecek
> bir yardımı beklerken** bırakır. Test bunu koruyor: hiçbir hata durumu `sent` olamıyor.

Bildirim ucu acil durum modülüyle birlikte T4.5'te geliyor; onay davranışı bir **port**
arkasında ve şimdiden test edilmiş durumda.

## Erişilebilirlik

- Kutucuklar tek parça seslendiriliyor, **rozet sayısı dahil** ("Mesaj, 3")
- Acil kutucuğu her zaman görünür ve son sırada — sıkıntıdaki bir hasta kaydırmak zorunda
  kalmamalı
- Her dokunulabilir öğe en az 44pt/dp
- Bağlanmamış hesap durumunda **tekrar dene butonu yok**: hastanın yapması gereken
  kliniği aramak, tekrar dokunmak değil

## Test Kapsamı

| Yer | Adet | Odak |
|---|---|---|
| `backend/test/me.integration.spec.ts` | 12 | Kim çağırabilir, refakatçi onamı, ne özetlenir |
| iOS `HomeModelTests` + `EmergencyModelTests` | 16 | Rozet mantığı, beş eylem, iki adımlı onay |
| Android `HomeModelTest` + `EmergencyModelTest` | 16 | Aynı senaryolar, sanal saatle geri sayım |
