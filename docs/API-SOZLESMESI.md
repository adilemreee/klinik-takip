# API Sözleşmesi

Şartname §3.1, §3.2, §12.

| Dosya | Ne için |
|---|---|
| [`openapi.json`](openapi.json) | Makine tarafından okunabilir sözleşme; mobil istemciler ağ katmanını bundan üretir |
| [`klinik-takip.postman_collection.json`](klinik-takip.postman_collection.json) | Elle deneme için Postman koleksiyonu |

Her ikisi de **üretilir, elle yazılmaz** ve üretim deterministiktir — aynı koddan aynı bayt
çıkar:

```bash
cd backend && npm run api:export
```

## Sözleşme Koddan Sapamaz

CI her çalışmada yeniden üretip commit'lenmiş dosyalarla karşılaştırıyor. Fark varsa
build kırılıyor.

> Sessizce kodla çelişen bir sözleşme, hiç sözleşme olmamasından **kötüdür**: iki taraf da
> hâlâ ona inanır.

Üretim deterministik olduğu için bu kontrol güvenilir — aynı koddan aynı bayt çıkıyor.

Ayrıca 103 test sözleşmenin **üretmeye değer** olduğunu koruyor: her ucun bir başarı
yanıtı, bir özeti, bir etiketi ve (sağlık uçları hariç) 401/403 tanımı var. Kapsamlanmış
hasta uçlarında ayrıca 404 var.

## Neden OpenAPI 3.0.0, 3.1 Değil

Şartname §3.1 OpenAPI **3.1** diyor. Üretilen dosya **3.0.0**.

`@nestjs/swagger` 3.0.0 üretiyor; 3.1'e çıkarmak, üretilen belgeyi sonradan dönüştürmeyi
gerektirirdi (`nullable` → tip dizileri, `exclusiveMinimum` semantiği, `example` →
`examples`). Bu dönüşüm mekanik görünür ama sessizce bozabilir — ve bozulduğunda hatayı
**üretilen istemci kodunda** görürsünüz, şemada değil.

Buna karşılık 3.0.0, kod üreteçleri tarafından **daha geniş** destekleniyor:
openapi-generator, orval, swagger-codegen hepsi 3.0'ı olgun biçimde işliyor; 3.1 desteği
hâlâ dağınık.

Sözleşmenin var olma sebebi istemci üretmek olduğuna göre, 3.0.0 bu amaca **daha iyi**
hizmet ediyor. Bilinçli sapma; 3.1 gerçekten gerekirse dönüşüm ayrı bir adım olarak
eklenebilir ve doğrulanabilir.

## İstemci Üretimi (Faz 2)

```bash
# iOS (Swift)
openapi-generator generate -i docs/openapi.json -g swift6 -o ios/Generated

# Android (Kotlin)
openapi-generator generate -i docs/openapi.json -g kotlin -o android/generated
```

Her iki istemci de **aynı dosyadan** üretilir (§3.2), böylece iki platform arasında
sözleşme farkı oluşamaz.

## Postman Dönüştürücüsü Neden Kendi Kodumuz?

Hazır dönüştürücü (`openapi-to-postmanv2`) iki sebeple çıkarıldı:

1. **Bir doküman çıktısı için 58 paket** getiriyordu — beşi bilinen açıklı
   (js-yaml, yaml, uuid, postman-collection). Kendi CI güvenlik kapımız yakaladı.
2. **Her çalıştırmada her öğeye yeni bir UUID basıyordu.** Bu, çıktının commit'lenip
   sapma kontrolüne sokulmasını imkânsız kılıyordu — ki üretmenin bütün amacı buydu.

Yerine yazılan dönüştürücü tek dosya, sıfır bağımlılık ve deterministik. Test, çıktıda
hiçbir üretilmiş kimlik kalmadığını doğruluyor.

## Postman Koleksiyonu

25 istek, dört klasör (`auth`, `patients`, `audit`, `health`). Koleksiyon seviyesinde
bearer auth tanımlı; iki değişken var:

| Değişken | Varsayılan |
|---|---|
| `baseUrl` | `http://localhost:8123` (staging portu) |
| `accessToken` | boş — bir kez doldurun, tüm istekler kullanır |

Tipik akış: `POST /auth/login` → yanıttaki `accessToken`'ı değişkene yapıştırın →
diğer uçlar çalışır. Personel hesaplarında araya 2FA kurulum adımı girer
(bkz. [KIMLIK-DOGRULAMA.md](KIMLIK-DOGRULAMA.md)).

## Sözleşmenin Anlattığı Davranışlar

Şema yalnız alan listesi değil; sistemin kurallarını da taşıyor:

- **404, kapsam dışı anlamına da gelir.** Açıklamada yazıyor, çünkü istemcinin bu ikisini
  tek durum olarak ele alması gerekiyor — 403 kaydın var olduğunu doğrulardı.
- **`LoginResponseDto.status`** üç durumu anlatıyor: `OK`, `MFA_REQUIRED`,
  `MFA_SETUP_REQUIRED` — sonuncusu personelin ikinci faktörü henüz yokken dönen, kapsamı
  yalnız 2FA uçlarıyla sınırlı `setupToken` ile birlikte.
- **Sayfalama `nextCursor`**, offset değil. Test bunu koruyor: şemada `offset` veya `page`
  alanı belirirse kırılır.
- **Hata gövdesi tek şekilde** (`ErrorResponseDto`), böylece istemci hataları tek yerde
  işler.

## Geliştirme Sırasında Tarayıcıdan

`APP_ENV` production değilken `/docs` altında Swagger UI sunuluyor. Production'da
**kapalı** — sözleşme dosyası zaten repoda, ve API yüzeyini canlıda ilan etmenin bir
faydası yok.
