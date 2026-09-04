# Denetim Günlüğü

Şartname §13. Modül: [`backend/src/audit/`](../backend/src/audit/)

## Değiştirilemezlik

`audit_logs` üzerinde `UPDATE`, `DELETE` ve `TRUNCATE` **veritabanı seviyesinde** trigger
ile reddedilir (T1.1'de kuruldu).

**Neden `REVOKE` değil trigger?** Uygulama veritabanı sahibi olarak bağlanır ve bir
sahibin yetkileri ondan anlamlı şekilde geri alınamaz. Trigger yazma işleminin kendisini
durdurur — ne ORM'deki bir hata ne de ele geçirilmiş bir uygulama hesabı geçmişi yeniden
yazabilir. Testlerde **veritabanı sahibi kimliğiyle** doğrulanıyor.

`TRUNCATE` için ayrı bir statement-level trigger var: satır seviyesindekiler `TRUNCATE`'te
tetiklenmez ve tabloyu tek komutta boşaltırdı.

## Okumalar da Kaydedilir

§13 "görüntüleme dahil" diyor. Sağlık verisinde kötüye kullanımın **daha yaygın** biçimi
budur: işi olmayan bir dosyayı merakla açan bir personel başka hiçbir iz bırakmaz.

## Yazma Yolları — İkisi Bilinçli Olarak Farklı

| Yol | Kullanım | Hata olursa |
|---|---|---|
| `recordInTransaction(tx, entry)` | **Değişiklikler** | İşlem geri alınır — değişiklik de olmaz |
| `record(entry)` | Okumalar, kimlik doğrulama olayları | Gürültülü loglanır, istek devam eder |

Bir değişikliği kendi işleminin dışında denetlemek, aralarındaki bir hatada ya kaydı
olmayan bir değişiklik ya da olmamış bir değişikliğin kaydını bırakır. İkisi de isteği
başarısız kılmaktan kötüdür.

Okumada tersi geçerli: denetim tablosu geçici olarak erişilemez diye bir hemşirenin hasta
dosyasını açamaması, bir klinikte yanlış takas olurdu.

## Redaksiyon

Denetim kaydına asla girmeyen alanlar: `passwordHash`, `totpSecret`, `refreshTokenHash`,
`codeHash`, `token`, `secret`, `signature` (büyük/küçük harf duyarsız, iç içe nesneler ve
diziler dahil).

> Denetim günlüğü yıllarca saklanır ve personel tarafından okunur. Bir anlık görüntüde
> yakalanan kimlik bilgisi, koruduğu şeyin her rotasyonundan daha uzun yaşar.

Döngüsel yapılar için derinlik sınırı var — patolojik bir yük isteği askıda bırakmamalı.

Bilinmeyen bir hesaba yapılan giriş denemesi, **denenen adresi kaydetmez**: saldırganın
seçtiği rastgele dizeleri yıllarca sakladığımız bir tabloya yazmanın anlamı yok.

## Şüpheli Davranış Tespiti

`AuditAnomalyService`, §13'ün saydığı desenleri arar:

| Tür | Varsayılan eşik |
|---|---|
| `BULK_ACCESS` | Bir aktörün pencerede 50+ farklı hasta dosyası okuması |
| `OFF_HOURS_ACCESS` | Mesai dışı (07:00–21:00 dışı, klinik saat dilimiyle) 20+ okuma |
| `REPEATED_LOGIN_FAILURE` | Bir hesap için 10+ başarısız giriş |

Bu bir sorgu, gerçek zamanlı bir kontrol değil — **denetim izi olanın kaydıdır**; uyarıyı
başka bir yerden türetmek, uyarı ile kanıtın çelişebileceği anlamına gelirdi.

**Eşikler tavsiyedir, yaptırım değil.** Hiçbiri isteği engellemez: meşru bir acil durum
tam olarak veri sızdırmaya benzeyebilir ve bir hemşireyi vardiya ortasında sezgisel bir
kurala dayanarak kilitleyen sistem, bayrak kaldırıp insana bırakandan daha tehlikelidir.

Mesai dışı kontrolü saati **klinik saat diliminde** değerlendirir; sunucu UTC çalışır ve
"mesai dışı" yerel saat hakkında bir ifadedir.

## Uçlar

| Uç | İzin | Not |
|---|---|---|
| `GET /audit` | `audit.read` | Filtre: aktör, rol, eylem, hasta, tip, tarih aralığı |
| `GET /audit/anomalies` | `audit.read` | Pencere saat cinsinden (varsayılan 24, en fazla 30 gün) |

**Denetim günlüğünü okumak da denetlenir.** O da hassas bir işlemdir.

Sayfalama **cursor** iledir, offset değil (§9). Offset her sayfada atlanan satırları
yeniden tarar; yalnızca büyüyen bir tabloda bu, geriye doğru gittikçe yavaşlar — ki bir
soruşturmanın yaptığı tam olarak budur. Kimlikler UUIDv7 olduğu için `id`'ye göre sıralama
zamana göre sıralamadır: tek indeks, ikincil sıralama anahtarı yok, aynı zaman damgasını
paylaşan satırlarda bile kararlı bir imleç.

## ⚠️ Bilinen Operasyonel Konu: Sınırsız Büyüme

Tablo append-only ve okumalar da kaydediliyor. İkisi birlikte, **hiç küçülmeyen** bir tablo
demek. Kaba tahmin: günde 100 bin okuma → yılda ~36 milyon satır → satır başına ~500 bayt
ile **yılda ~18 GB**.

§13 en az 2 yıl saklama istiyor; hiç silmediğimiz için bunu fazlasıyla karşılıyoruz.

**Tablo aya göre bölümlenmiş durumda** (`PARTITION BY RANGE (created_at)`). Tablo onlarca
satırlıkken yapıldı, çünkü alternatifi sonra yapmaktı: yıllarca denetim geçmişi biriktikten
sonra dönüştürmek ya kesinti ya da tek satırını bile kaybetmemesi gereken bir tabloda
çevrimiçi kopyalama demek.

Aralık `created_at` üzerinde, çünkü tablo böyle okunuyor (bir inceleme bir dönemi sorar) ve
böyle emekliye ayrılıyor: saklama süresi dolan bir ay `DETACH` ile ayrılır — `DELETE`
zaten append-only tetikleyicisi tarafından reddedilirdi.

### Üç ayrıntı, üçü de sessizce bozulabilirdi

**Varsayılan bölüm (`audit_logs_default`) var**, böylece bir `INSERT` bölüm yok diye asla
başarısız olamaz. Kaçınılan hata çok belirli: hata veren bir denetim yazımı, ya kaydettiği
işlemi geri alır ya da kaydını kaybeder. İkisi de bu tabloda kabul edilemez.

**Aylar önceden üretiliyor** (`audit-partition-sweep`, günlük). Varsayılan bölüm bir emniyet
ağı, plan değil: **bir satır oraya düştüğü anda, ait olduğu ayın bölümü artık
oluşturulamaz** — PostgreSQL reddeder. Süpürge ayda bir değil günde bir çalışıyor, çünkü
ayın 1'inde gece yarısı yeniden başlayan bir worker bir yıllık geçmişin tek yığına
düşmesinin sebebi olmamalı. Varsayılan bölümde satır görülürse **hata seviyesinde**
loglanıyor.

**Her bölümün kendi TRUNCATE tetikleyicisi var.** Satır seviyesindeki UPDATE/DELETE
tetikleyicileri ebeveynden miras alınıyor, ama TRUNCATE tetikleyicileri **alınmıyor** —
`TRUNCATE audit_logs_2027_03` tek başına bir ayı boşaltırdı. Bölüm oluşturan fonksiyon
tetikleyiciyi de ekliyor, ve bunun testi var.

### Birincil anahtar değişti

Bölümlenmiş bir tablonun birincil anahtarı bölüm anahtarını içermek zorunda, o yüzden
`(id, created_at)`. `id` hâlâ UUIDv7 ve pratikte tek başına benzersiz; bu bölümlemenin
gereği, anlamın değişmesi değil.

Denetim listesinin sayfalaması bu yüzden Prisma'nın `cursor`'ı yerine **anahtar filtresine**
(`id < cursor`) geçti: UUIDv7 zaten zaman sıralı, ve çağıranın sayfa çevirmek için geri bir
zaman damgası göndermesi gerekmemeli.

Disk kullanımı Grafana'da izlenmeli; eşik aşılınca alarm.

## Test Kapsamı

| Dosya | Adet | Odak |
|---|---|---|
| `src/audit/audit.service.spec.ts` | 12 | Redaksiyon, derinlik sınırı, hata toleransı |
| `test/audit.integration.spec.ts` | 10 | Kimlik olayları, değiştirilemezlik, anomali tespiti |
| `test/audit-http.integration.spec.ts` | 13 | Erişim kontrolü, filtreleme, cursor sayfalama |
