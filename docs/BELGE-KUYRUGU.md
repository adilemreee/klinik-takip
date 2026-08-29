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
