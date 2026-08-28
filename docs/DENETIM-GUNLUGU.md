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

§13 en az 2 yıl saklama istiyor; hiç silmediğimiz için bunu fazlasıyla karşılıyoruz. Ama
büyüme sınırsız ve bir planı olmalı. Uygulanmadı, çünkü şu an veri yok ve erken bölümleme
gereksiz karmaşıklık olurdu. Faz 7 öncesinde ele alınacak seçenekler:

1. **Aya göre bölümleme** (`PARTITION BY RANGE (created_at)`) — eski bölümler ayrı
   diskte veya sıkıştırılmış tutulabilir, sorgular yalnız ilgili bölüme dokunur.
2. **Yasal saklama süresi dolan bölümlerin arşivlenmesi** — bölüm ayırma (`DETACH`) silme
   değildir, dolayısıyla append-only garantisini bozmaz.

Disk kullanımı Grafana'da izlenmeli; eşik aşılınca alarm.

## Test Kapsamı

| Dosya | Adet | Odak |
|---|---|---|
| `src/audit/audit.service.spec.ts` | 12 | Redaksiyon, derinlik sınırı, hata toleransı |
| `test/audit.integration.spec.ts` | 10 | Kimlik olayları, değiştirilemezlik, anomali tespiti |
| `test/audit-http.integration.spec.ts` | 13 | Erişim kontrolü, filtreleme, cursor sayfalama |
