# Fotoğraf Modülü

Şartname §M7, T3.5. Kod: [`backend/src/photos/`](../backend/src/photos/) ·
[`ios/Sources/KlinikPhotosFeature/`](../ios/Sources/KlinikPhotosFeature/) ·
[`android/feature/photos/`](../android/feature/photos/)

## Konum Bilgisi Depolamadan Önce Siliniyor

Telefonla çekilen bir fotoğraf **nerede çekildiğini** taşır. İçinde GPS koordinatı olan bir
yara fotoğrafı, klinik bir kovada duran bir **ev adresidir** — ve bunun akıllıca olup olmadığı
tartışmasından uzun yaşar.

Silme işlemi kabı yeniden yazarak yapılıyor, görüntüyü yeniden kodlayarak değil. Yeniden
kodlama yerel bir görüntü kütüphanesi ister, her geçişte kalite kaybettirir ve yine de hangi
metaverinin kalacağını söylemeyi gerektirir. Segmentleri silmek kesin, bağımlılıksız ve test
edilebilir.

- **JPEG:** APP1 (EXIF/XMP), APP13 (IPTC — kendi konum alanı var), COM ve diğer APPn
  segmentleri düşürülüyor. `SOS`'tan sonrası entropi kodlu veri; olduğu gibi kopyalanıyor
  çünkü orada her bayt çifti bir işaretçiye benzeyebilir ve ayrıştırmaya devam etmek görüntüyü
  bozardı.
- **PNG:** `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME` parçaları çıkarılıyor.

ICC renk profili de (APP2) düşüyor. Geniş gamlı bir ekranda renk doğruluğu kaybı — yara
fotoğrafı için küçük ama gerçek bir bedel. Kabul edildi, çünkü APP2 aynı zamanda FlashPix
taşıyabiliyor: kendi EXIF'iyle birlikte **görüntünün ikinci bir kopyası**. İkisini güvenilir
biçimde ayırmak, rengin değerinden fazla makine gerektiriyor.

### HEIC reddediliyor

iPhone varsayılan olarak HEIC çekiyor ve HEIC'in metaverisi bu kodun ayrıştırmadığı bir kutu
yapısının içinde. Kabul edip "temizlenemedi" diye işaretlemek yerine **reddediliyor**: konumunu
silemediğimiz bir dosyayı, birinin vücudunun fotoğrafını tutması en muhtemel kovaya koymak
yapılacak bir takas değil.

İstemciler yüklemeden önce JPEG'e çeviriyor. Elle yüklemede sunucu sebebi açıkça söylüyor;
istemci bu mesajı olduğu gibi gösteriyor, yoksa kişi düzgün bir fotoğrafın neden reddedildiğini
tahmin etmek zorunda kalırdı.

## Onam Fotoğrafın Üstünde Yazıyor

Fotoğraf kullanım onamı ayrı ve **geri alınabilir** bir onam (§M7). Yüklemede verilen
`consentId` doğrulanıyor: hastaya ait mi, türü `PHOTO_USAGE` mı, geri alınmış mı. Doğrulamasaydık
tedavi onamını gösteren bir kimlik, sonraki her ekranda **hiç verilmemiş bir izin** gibi
okunurdu.

Onamı olmayan fotoğraf geçerli bir durum — yalnızca klinik kullanım demek. Ekran bunu ayarlar
sayfasında değil **fotoğrafın üstünde** yazıyor: bir görüntünün klinik dışında kullanılıp
kullanılamayacağı o görüntüye ait bir olgu ve ona bakan kişi, kullanabilecek kişidir.

## Galeri ve Karşılaştırma

Vücut bölgesine göre gruplanıyor, grup içinde **eskiden yeniye**. Bir gelişim ileri doğru
okunur; galerinin amacı neyin değiştiği ve bu yalnızca olduğu yönde doğru okunur.

Karşılaştırma seçili bölgenin en eskisi ile en yenisini açıyor. Tek fotoğraf varsa
karşılaştırma **sunulmuyor**: tek görüntü üzerinde bir kaydırıcı hiçbir şey yapmaz ve
görülecek bir değişiklik varmış izlenimi verir.

Kaydırmalı görünümde "öncesi" görüntüsü, daralan bir kutunun içinde **tam genişlikte** çizilip
kırpılıyor. Kutuya ölçeklemek, kaydırıcı hareket ettikçe resmi ezerdi — ki bu, bir
öncesi/sonrası karşılaştırmasının asla sokmaması gereken bozulmadır.

Kaydırma bir sürükleme hareketi ve ekran okuyucu bunu yapamıyor; aynı karşılaştırma
ayarlanabilir bir değer olarak da sunuluyor.

## Overlay Rehberi

Yeni çekimin hizalanacağı fotoğraf, **aynı bölgenin en son** fotoğrafı. Serinin ilki değil:
rehber açı ve mesafe tutarlılığı için var, kayma da komşular arasında birikir — bir yıl önceki
kareye göre değil.

**Eksik:** kameranın yarı saydam overlay ile çekim yapması. Sunucu referansı veriyor, istemci
modeli onu getiriyor; kamera katmanı gerçek cihaz gerektirdiği ve buradan doğrulanamadığı için
yapılmadı. T3.3'teki cihaz üstü OCR ile aynı kategoride.

## Fotoğraf Bellekte Tutuluyor, Akıtılmıyor

Metaveri silme kabın tamamını gerektiriyor, dolayısıyla fotoğraf belleğe alınıyor. Sınır
**okuma sırasında** uygulanıyor: Content-Length güvenilmeyen bir istemcinin iddiası ve "hepsini
oku, sonra bak" bir isteğin belleği yemesinin yolu. Bu yüzden fotoğraf sınırı belge sınırından
düşük (15 MB / 20 MB).
