# Lab Yorumlama ve Doktor Onayı

Şartname §M5, §14.1–14.2, T5.4. Kod: [`backend/src/reports/`](../backend/src/reports/)

## İki Okuyucu, Tek Gerçek

Aynı panel iki kez yazılıyor: doktor için klinik, hasta için sade. **Tek çağrıda**
isteniyor, iki ayrı çağrıda değil — iki çağrı eninde sonunda doktorun özetinde
geçen ama hastanınkinde olmayan bir değer üretir, ve hasta farkı sorar.

Tehlikeli olan hasta yarısı: endişeli biri tarafından, başka bir ülkede,
muhtemelen gece okunuyor ve **hüküm** olarak alınmaya en yatkın yarı. Bu yüzden
onunla ilgili kurallar prompt'ta ayrı ve önce yazılı.

## Hiçbir Şey Okunmadan Hastaya Gitmiyor

§M5'in zorunlu kuralı. Yapısal olarak uygulanıyor:

- `GET /me/reports` yalnız `releasedToPatientAt` dolu olanları döndürüyor —
  **ayrı bir metot**, paylaşılan metoda geçirilen bir bayrak değil. Yanlış yöne
  varsayılan bir bayrak ya da onu geçirmeyi unutan bir çağrı, hakkında yazıldığı
  hastanın önüne incelenmemiş bir AI yorumu koyardı. Unutmak için başka bir
  metot çağırmak gerekiyor.
- Hastaya giden **farklı bir belge**: klinik metin yok, risk etiketi yok. Hasta
  ekranında, arkasında bir klinisyen olmadan duran "KRİTİK" bir hükümdür.
- İnceleme ve gönderme **tek eylem**, çünkü tek karar: raporu okumuş doktor
  gönderilip gönderilmeyeceğini bilir. İkiye bölmek, okunmamışlardan ayırt
  edilemeyen bir "incelendi ama gönderilmedi" yığını bırakırdı.

### Otomatik gönderme ayarı

§M5 inceleme zorunluluğunun kapatılabilmesine izin veriyor. `AI_AUTO_RELEASE_LOW_RISK`
**varsayılan kapalı**; açıldığında yalnız LOW ve MEDIUM yorumlar okunmadan
gidiyor.

> **HIGH ve CRITICAL için böyle bir ayar bilerek yok.** Bir AI'nin, başka bir
> ülkedeki ameliyat sonrası hastaya ciddi bir şeyin ters gittiğini klinikten
> kimse görmeden söylemesi, bu sistemin geri kalanının affetmeyeceği tek sonuç.
> Bunu isteyen bir klinik yazılı olarak istemeli, bir boolean'ın arkasında
> bulmamalı. **Şartnameden bilinçli sapma.**

## Kesilmiş Yanıt Saklanmıyor

Klinik çekinceler bir özetin **sonunda** durur, yani yarısı bütününden daha
kesin okunur. Modelin `max_tokens`'a takıldığı yanıt kaydedilmiyor — kaydedilen
bir yarım, bir klinisyenin **gönderebileceği** bir yarımdır.

## Parser'ın Varsayılanı Yok

Triyajdaki kuralın aynısı: risk seviyesi okunamayan yanıt `null` dönüyor ve
rapor **üretilmiyor**. Varsayılanı olan bir parser, sessizce bir sonucun ne
kadar alarm verici olduğuna karar veren şey hâline gelir.

Ayrıca **iki metin ya da hiçbiri**: yalnız klinik yarısı olan bir rapor hastaya
boş sayfa olarak gider; yalnız sade yarısı olanı doktor klinik özet sanarak
okur.

## Panelin Yazımı

Sütun ayracı boşluk ya da tire değil, **dikey çizgi**. Kimlik taraması boşluk ve
tireyi bir sayı dizisinin parçası sayıyor; onlarla yazılmış bir panel iki masum
değeri telefon numarasına benzeyen bir şeye ekleyip **bütün raporu
reddettirebilir**. Dikey çizgi her diziyi sütun sınırında bitiriyor.

(Aynı sebeple `pseudonymise`'ın sayı taraması artık satır sonunu geçmiyor: bir
telefon numarası hiç iki satıra yazılmaz, ve OCR'lanmış bir tablo çıplak
sayılardan oluşan bir sütundur.)

Panel **kırpılırsa normal değerler düşüyor**, kritikler değil — tersi, alarm
veren bir panelin rahatlatıcı özetini üretirdi.

## Yalnız Doğrulanmış Sonuçlar

OCR çıktısı bir insan onaylayana kadar klinik değil (§M16). Kimsenin
bakmadığı sayıların yorumu, yanlış okunmuş bir ondalık noktanın kendinden emin
özetidir.

## Uyarı Sunucudan Geliyor

§M5'in her AI çıktısının altında istediği uyarı, istemcinin ekleyeceği bir metin
değil, yanıtın bir alanı. SMS'in ya da bir dışa aktarmanın onu yerelleştirecek
istemcisi yok, ve istemcinin eklemeyi unuttuğu uyarı **eksik** uyarıdır.

## İzlenebilirlik

`ai_reports` satırında **cevabı gerçekten veren model** yazıyor (istenen takma
ad değil, §14.6), oluşturulma zamanı, risk seviyesi, onaylayan ve gönderilme
zamanı. HIGH/CRITICAL bir yorum bakım ekibine `lab.critical` bildirimi
düşürüyor.

## Uçlar

| Uç | Yetki | Ne yapar |
|---|---|---|
| `POST /patients/{id}/reports/lab` | `ai.review` | Doğrulanmış paneli yorumlar |
| `GET /patients/{id}/reports` | `medical.read` | Hastanın raporları (denetlenir) |
| `GET /reports/pending` | `ai.review` | Onay bekleyenler, en eski önce |
| `PATCH /reports/{id}/review` | `ai.review` | Onaylar; aynı eylemde gönderir ya da göndermez |
| `GET /me/reports` | `self.read` | **Yalnız gönderilmiş** olanlar, sade metin |

Yorumlama **klinisyen isteyince** çalışıyor, her yüklemede değil: bu karar
desteği, ve kimsenin istemediği destek kimsenin planlamadığı harcamadır.

## Yapmadıklarım

- **Doğrulama tamamlanınca otomatik yorumlama.** §M5 "yüklenen tahlil → özet"
  diyor; bunu bir belgenin bütün sonuçları onaylandığında tetiklenecek bir kuyruk
  işi olarak kurmak mümkün, ama açık uç ile aynı işi yapıyor ve harcamayı
  klinisyenin kararına bırakıyor. Kuyruk işini istenirse eklerim.
- **Hasta metninde tanı olmadığının otomatik doğrulanması.** Çıktıya regex atmak
  tiyatro olurdu. Tutan şey, metnin bir klinisyen okumadan hastaya gitmemesi.
