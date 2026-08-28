# Dosya Servisi

Şartname §8, M2, M7. Modül: [`backend/src/files/`](../backend/src/files/)

## Üç Kural

1. **Sunucu diskine dosya yazılmaz.** Yükleme doğrudan nesne depolamaya akar.
2. **Hiçbir nesne herkese açık değildir.** Erişim yalnız kısa ömürlü imzalı URL ile.
3. **İstemcinin ne dediği değil, baytların ne olduğu belirler.**

Üçü de staging'de ölçüldü, varsayılmadı.

## İçerik Tipi Bayttan Tespit Edilir

Tarayıcının gönderdiği `Content-Type` güvenilmeyen bir kaynaktan gelen bir iddiadır.
Dosya, uzantısına veya başlığına değil **imzasına** göre saklanır: PDF, JPEG, PNG, HEIC
(telefon kameralarının varsayılanı), WebP, DICOM.

Tanınmayan içerik reddedilir. Bu, yeniden adlandırılmış bir çalıştırılabilir dosyanın
veya bir HTML parçasının PDF olarak saklanmasını engeller — ki bu, saklanan bir dosyanın
birinin tarayıcısında betik çalıştırmasına dönüştüğü yoldur.

**Bucket, ne olabileceğini belirler:** PDF geçerli bir belgedir, geçerli bir klinik
fotoğraf değildir.

## Nesne Anahtarları Anlam Taşımaz

```
2026/08/779abf76-446c-4ac3-a7fc-1083157ce8ea.pdf
```

`patients/<dosya-no>/pasaport.pdf` gibi bir anahtar, dosya numarasını ve belgenin
niteliğini anahtarı gören her şeye sızdırırdı: bir proxy logu, bir tarayıcı geçmişi, bir
imzalı URL'in ekran görüntüsü. Anahtarı hastaya veritabanı bağlar; anahtarın kendisi
yalnızca ne zaman saklandığını söyler.

Tarih öneki arama için değil, operasyon için: bucket listelemesini ve yaşam döngüsü
kurallarını yönetilebilir kılar, hiçbir şey açık etmeden.

## İmzalı URL'ler

- Ömür `S3_SIGNED_URL_TTL_SECONDS` ile sınırlı (varsayılan 300 sn, şema tavanı 1 saat).
  Çağıran daha uzun isterse **tavana kırpılır**.
- `Content-Disposition: attachment` **zorunlu**, ve tip yükleme anında tespit edilen tip.
  Saklanan bir dosyayı istemcinin seçtiği bir tiple satır içi sunmak, yüklenen bir belgenin
  betik çalıştırmasına dönüştüğü yoldur.
- Dosya adı sterilize edilir; tırnak ve noktalı virgül kaldırılır, böylece ikinci bir
  başlık parametresi açılamaz.

## Boyut Sınırı Akış Sırasında Uygulanır

`Content-Length` başlığına güvenilmez: istemci 1 MB beyan edip bir gigabayt gönderebilir.
Sınır, baytlar geçerken bir `Transform` içinde sayılarak uygulanır ve aşıldığında yükleme
iptal edilir.

## Uygulama Sırasında Çıkan İki Gerçek Hata

Bu ikisi kayda değer çünkü ikisi de testler olmadan sessizce üretime giderdi:

### 1. `for await` + `break` kaynak akışı yok ediyor

İçerik tipini tespit etmek için akışın ilk baytları okunuyor. `for await` döngüsünden
`break` ile çıkmak Node'da kaynağı **yok eder** — kalan baytlar hiç gelmez ve yükleme
hiç gelmeyecek bir "son" için sonsuza kadar bekler.

Testler 422 saniye sürüp zaman aşımına uğradı. Çözüm: `source.iterator({ destroyOnReturn: false })`.
Sonrasında aynı testler **4.7 saniyede** geçti.

### 2. `putObject` akış hatasını yutuyor

Boyut sınırı aşıldığında `Transform` hata veriyordu, ama MinIO istemcisi okuduğu akış
hata verdiğinde reddetmiyor — sadece veri almayı bırakıp bekliyor. Sonuç: sınır
uygulanıyor ama istek asılı kalıyordu.

Çözüm: yükleme sözü ile akış hatası **yarıştırılıyor**. Bu aynı zamanda hataya bir
dinleyici verdiği için Node'un "unhandled error" uyarısını da ortadan kaldırıyor.

## Virüs Taraması — Uygulanmadı

Şartname §T1.5 bunu "opsiyonel" diyor ve **eklemedim**. Gerekçe:

- ClamAV kalıcı olarak 1 GB'ın üzerinde bellek ister; sunucu zaten 21 servisi barındırıyor.
- Dosyalar özel bucket'larda duruyor, yalnız kendi istemcilerimizin aldığı kısa ömürlü
  imzalı URL'lerle erişiliyor ve sunucuda hiç çalıştırılmıyor.

**Ne zaman gerekli hale gelir:** dosyalar dışarıya paylaşılmaya başlandığında veya personel
onları kendi makinesinde açtığında. O noktada `FileService.upload` içine, tip tespitinden
sonra ve depolamadan önce bir tarama adımı girer.

## Test Kapsamı

| Dosya | Adet | Odak |
|---|---|---|
| `src/files/file-type.spec.ts` | 21 | İmza tespiti, anahtar üretimi ve güvenliği |
| `test/files.integration.spec.ts` | 24 | Gerçek MinIO: yükleme, imzalı URL, bucket gizliliği |

Ayrıca staging'de 8 kontrol: imzasız erişim 403, PDF foto bucket'ına reddediliyor,
boyut sınırı uygulanıyor.
