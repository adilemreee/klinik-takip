# Finans Kayıtları ve Tahsilat

Şartname §M11, §2, T6.3. Kod: [`backend/src/finance/`](../backend/src/finance/) ·
[`money.ts`](../backend/src/finance/money.ts) ·
[`settlement.ts`](../backend/src/finance/settlement.ts) ·
[`exchange.ts`](../backend/src/finance/exchange.ts)

## Para `Decimal`, Asla `Float`

Kayan noktalı sayıda `0.1 + 0.2` üç değildir. Dört para biriminde fatura kesen
ve banka ekstresiyle mutabakat yapan bir klinik bu farkı **bulur** — ve
bulamadığı kuruş, kapatamadığı gündür.

Bu yüzden:

- Kolonlar `Decimal(14,2)`, kod `Prisma.Decimal`, hiçbir yerde `number` yok.
- Tutarlar tele **metin olarak** çıkıyor (`"4000.00"`), çünkü JSON sayısı
  istemciye vardığında `double` olmuştur.
- iOS `Decimal`, Android `BigDecimal` okuyor.
- Yuvarlama **hesabın sonunda bir kez**, ve yarıyı yukarı — kaynakta açıkça
  yazılı, kütüphane varsayılanına bırakılmadı.

Kurlar para değil: sekiz basamağını koruyorlar. Bir kuru iki haneye yuvarlamak,
her havalede birkaç lira kayan mutabakatın yoludur.

## Ödeme Durumu Yazılmıyor, Hesaplanıyor

`paymentStatus`, `paidAmount` ve `paidAt` **hiçbir uçtan yazılamıyor**. Ödeme
defterinden, ödemeyi kaydeden işlemin içinde yeniden hesaplanıyorlar.

> İnsanın yazabildiği bir durum, paranın söylediğiyle **çelişebilen** bir
> durumdur. Hiç tahsilat yokken "ödendi" işaretlenmiş bir fatura alacak
> raporundan düşer ve bir daha kimse peşine düşmez — ve sistemde hiçbir yerde
> bir şeyin yanlış gittiği görünmez.

Tutarların ima **edemediği** tek durum iptaldir: tedavi olmadı, ya da alacak
silindi. O yüzden iptali insan giriyor — ve bir durum değil, bir **tarih**
olarak, ki kayıt ne zaman olduğunu söylesin.

Durum şu sırayla çıkıyor:

| Koşul | Durum |
|---|---|
| `cancelledAt` dolu | `CANCELLED` |
| Tahsilat ≤ 0 ve iade var | `REFUNDED` |
| Tahsilat ≤ 0, net > 0 | `PENDING` |
| Tahsilat ≤ 0, net = 0 | `PAID` (ücretsiz işlem borç değildir) |
| 0 < tahsilat < net | `PARTIAL` |
| tahsilat ≥ net | `PAID` |

`REFUNDED` ile `PENDING` ayrımı önemli: para gelip geri gitmişse, hiç gelmemiş
gibi raporlamak birini **zaten iadesi yapılmış hastanın peşine** yollar.

## Ödemeler Bir Defter

Faturanın üstünde koşan tek bir toplam değil, **hareket başına bir satır**.

Tek toplam iki şeyi yapamaz: "mart ayında ne kadar tahsil ettik" sorusunu
cevaplayamaz — ki tahsilat raporunun tamamı odur — ve yanlış girilmiş bir
ödemeyi, ne girildiğinin tarihçesini yok etmeden düzeltemez.

- **Hiçbir satır silinmiyor, düzenlenmiyor.** Yanlış giriş `reversedAt` ile
  işaretleniyor, kendi tutarıyla yerinde kalıyor ve saymayı bırakıyor.
- "Bu girildi ve düzeltildi" ile "bu hiç olmadı" farklı olgular, ve yalnız
  biri banka ekstresiyle karşılaştırılabilir.
- Faturanın `paidAmount`'ı kalanlardan yeniden hesaplanıyor.

Taksit bu modelde ayrı bir kavram değil: birden çok satır.

### Başka Para Biriminde Ödeme

Sağlık turizminde olağan: fatura EUR, kasaya TRY giriyor. Bu durumda ödeme
**faturanın ne kadarını kapattığını söylemek zorunda** (`appliedAmount`).

> Bir faturayı kapatan kur, o gün **bankanın kullandığı** kurdur. Buradan bir
> tabloya bakıp tahmin etmek, yazılımın — doğrulayamadığı bir veriden — hastanın
> hâlâ borcu olup olmadığına karar vermesi demektir.

Oran denetim izi için saklanıyor, ama kararı veren insan.

## Kur Çevrimi ve Sessizlik

Tutarlar **faturalandıkları para biriminde** duruyor; çevirme yalnız rapor tek
bir toplam istediğinde oluyor. Tersi — her şeyi girildiği günün kuruyla tek para
birimine yazmak — bir kaydın değerini *ne zaman girildiğine* bağlar, ve iki kez
çalıştırılan rapor iki cevap verir.

Her tutar **kendi gününün** kuruyla çevriliyor: ödeme tahsil edildiği gün,
fatura kesildiği gün.

İlginç durum eksik kur, ve bu §M5'teki tanınmayan ilaçla aynı problem:

> **Çevrilemeyen bir tutar sessizce düşürülemez.** Düşürmek, geliri tam olarak
> kimsenin bakmadığı kadar eksik gösterir; geçen çeyrek için bugünün kurunu
> kullanmak ise tarihi yeniden yazar.

Bu yüzden her toplam üç şey taşıyor:

| Alan | Anlamı |
|---|---|
| `converted` | Kuru bulunabilen kısmın toplamı |
| `byCurrency` | **Her** para birimi, çevrilsin çevrilmesin — tam resim |
| `unconverted` | Kuru olmayan tutarlar, **kendi para biriminde** |
| `complete` | `converted` her şeyi kapsıyor mu |

İki istemcide de `isWholeAnswer` bu ayrımı taşıyor.

### Kur Nereden Geliyor

**Bu depoda kur beslemesi yok.** Merkez bankası, kliniğin kendi bankası, aracı
kurumla anlaşılmış kur — bu kliniğin kararı, ve uydurulmuş bir kaynak hiç
olmamasından kötüdür. Kurlar `POST /finance/rates` ile giriliyor.

Kur arama kuralı:

- İstenen güne ait ya da **ondan önceki en yeni** kayıt (hafta sonu cuma
  kuruyla geçer), sonuç `carriedForward` ile işaretlenir.
- **Yedi günden eski** bir kur kur sayılmaz — o noktadan sonra "kur" tarih
  giymiş bir tahmindir.
- Doğrudan ya da tersi. **Üçgenleme yok**: iki TRY kurundan türetilmiş bir
  EUR→USD, yazılımın uydurduğu bir sayıdır. Rapor para birimi için veri
  içindeki her para birimine karşı bir kur gerekir — günde birkaç satır.

## Hemşire–Finans Duvarı (§2)

Şartnamenin iki cümlesi burada taşıyıcı, ve **ikisinin de negatif testi var**:

- **Hemşirenin hiçbir finans yetkisi yok.** Her finans ucu 403.
- **Finansın hiçbir klinik yetkisi yok.** `FINANCE` rolünün hasta kapsamı
  boştur (`patient-access.service.ts`), yani hasta dosyalarında dolaşamaz.

Finans masası bir faturada **ad, dosya numarası ve ülke** görüyor — kimin
faturası olduğunu bilmeye yetecek kadar. Tanı yok, işlem geçmişi yok, not yok.
Bu alanların sayısı testte sabitlendi.

Erişim **klinik geneli**, çünkü defterin bir bölümünün defteri tutulmaz. Bu bir
istisna değil, kuralın diğer yarısı: finans rolü hasta kapsamı almadığı için
klinik geneli finans erişimi kimseye görmediği bir şey vermiyor.

## Veritabanının Kabul Etmedikleri

Serviste bir hata olsa bile geçemeyecek kısıtlar:

```sql
payments_amounts_positive            -- ödeme her zaman pozitif; yönü `kind` söyler
finance_records_amounts_consistent   -- net = brüt − indirim, indirim ≤ brüt
exchange_rates_rate_positive         -- sıfır kur yoktur, tersi de bölünemez
```

Eksi işaretiyle sessizce ters çevrilmiş bir ödeme bu yüzden mümkün değil.

## Uçlar

| Uç | Yetki |
|---|---|
| `GET /finance/records`, `/records/:id` | `finance.read` |
| `GET /patients/:id/finance` | `finance.read` |
| `POST /patients/:id/finance` | `finance.write` |
| `PATCH /finance/records/:id` | `finance.write` |
| `POST /finance/records/:id/cancel` | `finance.write` |
| `POST /finance/records/:id/payments` | `finance.write` |
| `POST /finance/payments/:id/reverse` | `finance.write` |
| `GET /finance/collections` | `finance.report` |
| `GET /finance/outstanding` | `finance.report` |
| `GET`/`POST /finance/rates` | `finance.read` / `finance.write` |
| `GET`/`POST`/`PATCH /finance/agencies` | `finance.read` / `finance.write` |

Fatura okuma ve para hareketleri **denetim günlüğüne** yazılıyor.

## Alacak Yaşlandırma

`GET /finance/outstanding` bekleyen alacakları 0–29 / 30–59 / 60–89 / 90+ gün
kovalarına ayırıyor. Yaş, **faturanın kesildiği günden** sayılıyor ve her fatura
**kesildiği günün kuruyla** çevriliyor — bugünün kuruyla çevirmek, yaşlandırma
raporunun kendi geçmişini lira her oynadığında değiştirmesi olurdu. Klinik ne
faturaladıysa onu alacaklıdır.

Fazla ödenmiş bir fatura alacak değildir ve başkasının borcunu **kapatmıyor**:
eksi bakiyeler toplamdan düşülse, gerçek borç görünmez olurdu.

## Yapmadıklarım

- **Sanal POS / ödeme altyapısı entegrasyonu** — şartname §"Netlik için" bunu
  açıkça kapsam dışı bırakıyor. Bu modül kliniğin tahsil ettiği parayı
  *kaydeder*, hiç para *taşımaz*.
- **Hastaya fatura ekranı** — şartnamede yok. Hastanın göreceği bir bakiye,
  arkasında bir itiraz akışı olmadan açılacak bir kapıdır.
- **Kur beslemesi** — yukarıda; kaynağı klinik seçer.
- **Fatura üzerinde iyimser kilit** — para hareketleri zaten append-only; fatura
  düzenlemesi denetleniyor. İki kişinin aynı faturayı aynı anda düzenlemesi
  şimdilik son yazanın kazandığı bir durum.
- **Gelir–gider kırılımı, ülke dağılımı, kanal analizi, doluluk** — §M11'in
  kalanı **T6.4 analitik dashboard**'a ait; buradaki `costItems` alanı onu
  bekliyor.
