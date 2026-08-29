# Belge Yükleme ve İş Kuyruğu

Şartname §M2, §8, T3.2. Kod: [`backend/src/documents/`](../backend/src/documents/) ·
[`backend/src/queue/`](../backend/src/queue/) ·
[`ios/Sources/KlinikDocumentsFeature/`](../ios/Sources/KlinikDocumentsFeature/) ·
[`android/feature/documents/`](../android/feature/documents/)

## İş Kaydı Neden Veritabanında?

BullMQ iş durumunu Redis'te tutuyor ve tamamlanan işleri saklama politikasına göre
düşürüyor. Bir kuyruk için doğru; **"geçen hafta yüklediğim tahlile ne oldu?"** sorusu için
yanlış. Redis burada kayıt makamı da değil: bir flush, kliniğin işlediği her şeyin geçmişini
siler.

Bu yüzden her iş `jobs` tablosuna da yazılıyor. Kuyruk işi yürütüyor, tablo ne olduğunu
hatırlıyor.

### Sıralama bilinçli

İş kaydı belge satırıyla **aynı işlemde** yazılıyor, kuyruğa ekleme ise **commit'ten sonra**
yapılıyor. Tersi olsaydı, işlem geri alındığında worker hiç var olmamış bir satırın peşine
düşerdi.

Bu sıralamanın kendi hata durumu var: commit ile enqueue arasında süreç ölürse, `jobs`
satırı QUEUED'da kalır ve Redis'te karşılığı olmaz. Bu **görülebilir ve düzeltilebilir** bir
durum — worker açılışta `requeueStranded()` ile bunları topluyor. İki kötü durumdan
kurtarılabilir olanı seçildi.

## Yeniden Denenecek İş "Başarısız" Değildir

Bir deneme başarısız olduğunda, hakkı kalmışsa satır **QUEUED**'a dönüyor; FAILED yalnız
haklar tükendiğinde yazılıyor.

İlk tökezlemede FAILED yazmak, personeli iki dakika sonra kendiliğinden işlenecek bir belgenin
peşine düşürür — ve daha kötüsü, alanı **görmezden gelmeyi öğretir**. Kural saf bir
fonksiyona (`statusAfterFailure`) çıkarıldı ve testleri var.

## Intake: Dosya Gerçekten Orada mı?

Yükleme 201 dönüp geriye kullanılabilir hiçbir şey bırakmayabilir — depolama yazmayı kabul
edip kaybedebilir, nesne yarıda kesilebilir, satır ile nesne boyut konusunda anlaşmayabilir.
Bunun belirtisi, doktorun haftalar sonra bir tahlili açıp **boş dosya** bulmasıdır; hastadan
tekrar istemenin çoktan zorlaştığı bir anda.

Intake işi nesnenin varlığını ve boyutunun kayıtla eşleştiğini doğruluyor. Eşleşmiyorsa iş
**başarısız oluyor**: saklanan baytlar checksum'u alınan baytlar değilse, bunu sorunsuz
saymak bozuk bir dosyayı OCR aşamasına sağlammış gibi vermek olurdu.

## Dosya Sunucu Diskine Hiç Değmiyor

İstek gövdesi busboy ile akış hâlinde okunup doğrudan nesne deposuna yazılıyor (§8). Boyut
sınırı **aktarım sırasında** uygulanıyor; Content-Length başlığına güvenmek, istemcinin
1 MB deyip bir gigabayt göndermesine izin verirdi.

Saklanan tür baytlardan tespit ediliyor — dosya adından ya da bildirilen Content-Type'tan
değil. `report.pdf` adındaki bir çalıştırılabilir dosya reddediliyor, testi var.

Baytlar **önce** yazılıyor, satır ve iş sonra tek işlemde. Tersi, var olmayan bir nesneyi
gösteren bir satır bırakırdı — kliniğin sahip olduğunu sandığı bir belge. Bu sırayla başarısız
bir işlem yalnız sahipsiz bir nesne bırakıyor; o da yalan değil çöp, ve siliniyor.

## Silme Yumuşak

Klinik kayıtların yasal saklama süresi var (§8). Bir hastanın silme talebi, kliniğin tutmak
zorunda olduğu kaydı yok etme izni değil. Satır `deleted_at` alıyor, baytlar kalıyor; temizlik
saklama takvimine göre yapılıyor.

## Testlerin Yakaladığı Gerçek Hata

iOS'ta çok parçalı zarf `\r\r\n` üretiyordu. Swift'in çok satırlı metin değişmezinde `\r`
kaçışı bırakıp sonra `\n` → `\r\n` dönüşümü uygulamak, satır sonlarını ikiye katlıyor.
Sunucunun reddettiği, sebebi bulunması berbat bir gövde. Zarf artık satır satır, açıkça
yazılıyor.

## Devam Ettirilebilir Yükleme

Şartname §9 parçalı ve devam ettirilebilir yükleme istiyor. Sebebi soyut değil: bu ürünün
hastası çoğunlukla **yurt dışında ve mobil bağlantıda**. 20 MB'lık taramanın 18. MB'ında
kopan bir bağlantı, baştan başlamak demekse, o belge çoğu zaman **hiç gönderilmiyor**.

Protokol üç çağrı ve tek sayı üzerine kurulu:

```
POST   /patients/:id/documents/uploads      → oturum aç
PATCH  /documents/uploads/:id?offset=N      → bir parça gönder
GET    /documents/uploads/:id               → sunucu nerede kalmış?
POST   /documents/uploads/:id/complete      → birleştir ve dosyala
```

Dönen `receivedBytes`, istemcinin devam edeceği offset. Her şey buna bakıyor.

### Yanlış offset düzeltilmiyor, reddediliyor

Gelen `offset` sunucunun elindekiyle birebir eşleşmiyorsa istek **409** alıyor ve doğru offset
söyleniyor. Sunucunun "herhalde şunu kastetti" diye yamaması gerekiyordu: yanlış yerden devam
eden bir istemci dosyada **delik** bırakır ve bunu aşağıdaki hiçbir aşama fark etmez — ta ki
doktor bozuk bir PDF açana kadar.

Aynı kural, cevabı kaybolmuş bir parçayı da güvenli kılıyor. İstemci aynı offset'i tekrar
gönderir, geride kaldığını öğrenir, ileri atlar. İki istemcinin yarışması ise `receivedBytes`
üzerinde **karşılaştır-ve-yaz** ile ele alınıyor; yoksa ikisi de eski değeri okur ve biri
sessizce kaybolurdu.

### İlk parçada tür tespiti

Dosya türü **ilk parçadan** anlaşılıyor. Sonda bakmak, hastanın 20 MB mobil veriyi harcadıktan
sonra "bu tür kabul edilmiyor" demek olurdu.

### Birleştirme neden akışla?

S3'ün `composeObject`'i son parça hariç her parçanın **en az 5 MB** olmasını istiyor. Bu taban,
devam ettirmeyi tam da onun var olduğu bağlantıda işe yaramaz hâle getirirdi. Parçalar
sunucuda akıtılarak birleştiriliyor; böylece parça boyutu serbest ve checksum birleştirme
sırasında hesaplanabiliyor.

### Checksum iki taraflı

İstemci diskten okuduğunu, sunucu eline geçeni hash'liyor. Tutmazsa belge **dosyalanmıyor** —
klinik kayda bozuk bir dosya girmesindense reddedilmesi doğru.

`complete` ikinci kez çağrılırsa aynı belge dönüyor. Cevabı kaybolmuş bir tamamlama isteği,
aksi hâlde ikinci bir belge yaratırdı.

### Terk edilenler süpürülüyor

Kötü bağlantıda — yani bu özelliğin var olduğu bağlantıda — denemelerin çoğu yarım kalıyor.
Saatlik bir kuyruk işi süresi dolmuş oturumların parçalarını siliyor; olmasaydı kovada her
başarısız deneme kalıcı olarak birikirdi.

### İstemcide eşik

1 MB'ın altındaki dosyalar tek seferde gidiyor. Altında başarısız bir deneme küçük bir istek
kaybı, üç çağrılık dans ise saf ek yük olurdu; üstünde ise kopan bağlantı hastanın tüm
aktarımına mal oluyor.

**Kalan eksik:** oturum kimliği uygulama yeniden başlatıldığında kayboluyor, çünkü kalıcı yerel
depo T2.6'nın borcu. Aynı oturum içinde kopma ve devam çalışıyor; uygulama kapanıp açılırsa
yükleme baştan başlıyor.

## İstemci Tarafı

Klinik belgesi 20 MB olabiliyor. Zarfı telefonun belleğinde kurmak — kameranın ya da dosya
seçicinin zaten tuttuğunun üstüne — yükleme ekranının, hasta istenen taramayı nihayet
gönderirken sistem tarafından öldürülmesi demek. iOS'ta zarf geçici bir dosyaya yazılıp
`URLSession`'a veriliyor; Android'de istek dosyanın **yolunu** taşıyor, taşıma katmanı
akıtıyor. Hiçbir katmanda 20 MB bellekte durmuyor.

Yüklemeden sonra liste sunucudan yeniden okunuyor: belgenin gerçek türüne **baytlara bakan
sunucu** karar veriyor, istemcinin tahmini yanındaki satırla çelişirdi.

Durum takibi şimdilik yoklama ile (canlı güncelleme T4.1'deki sokete bağlı). Yoklama sınırlı:
bekleyen iş yoksa hiç istek atılmıyor, varsa da birkaç dakika sonra duruyor — cebe girmiş bir
ekranın sonsuza kadar yoklaması pil şikâyetidir.
