# Analitik Panel

Şartname §M11, T6.4. Kod: [`backend/src/analytics/`](../backend/src/analytics/) ·
[`analytics.ts`](../backend/src/analytics/analytics.ts) ·
[`cost-items.ts`](../backend/src/finance/cost-items.ts)

Finans tarafı için [FINANS](FINANS.md).

## Bir Panelin Yalan Söyleme Biçimi

Panelin karakteristik hatası yanlış toplam değil, **paydası gösterilmemiş
kendinden emin bir orandır.**

- Tek başvurudan "dönüşüm %100"
- Üç dosyadan "Almanya hastaların %33'ü"
- Hiç tanımlanmamış bir çalışma haftasına bölünmüş doluluk oranı

Üçü de aritmetik olarak doğru, üçü de olmadıkları bir şey olarak okunacak. Bu
yüzden buradaki her oran geldiği iki sayıyı yanında taşıyor ve **çok az vakadan
oran üretilmiyor** — `null` dönüyor.

> `null` sıfır değildir. "Söylemeye yetmiyor" demektir, ki "hiç yok"tan farklı
> bir cümledir. İki istemcide de bunu sayıya çeviremeyecek tipler var
> (`Proportion`), ve `null` ekrana **"Yeterli veri yok"** diye çıkıyor.

Eşik `MIN_FOR_RATE = 5`. Sayılar her zaman dönüyor, okuyan üçte ikiyi kendi
görebilsin.

## Yetki: Panel ile Kasa Ayrı

| Uç | Yetki |
|---|---|
| `GET /analytics/procedures` | `analytics.read` |
| `GET /analytics/geography` | `analytics.read` |
| `GET /analytics/occupancy` | `analytics.read` |
| `GET /analytics/channels` | `analytics.read` (+ gelir için `finance.report`) |
| `GET /analytics/revenue` | `finance.report` |

`FINANCE` rolü `finance.report` tutuyor, `analytics.read` tutmuyor: kasayı
görür, klinik hacimleri görmez. Tersi de doğru — bunun negatif testi var.

**Kanal raporu ikisinin buluştuğu tek yer**, çünkü "hangi kanala para
harcayalım" tek bir sorudur. `analytics.read` ile açılıyor, gelir sütunları
yalnız `finance.report` da olana geliyor. Gelmediğinde:

> `revenueWithheld: true` — **açıkça söyleniyor.** Boş bir gelir sütunu "bu
> kanal hiç para getirmedi" diye okunur, ki "bunu görme yetkiniz yok"tan çok
> daha kötü bir iddiadır.

## Dönüşüm Neyin Tanımı

`conversionDefinition` yanıtın içinde geliyor:

> Dönüşmüş hasta = **en az bir ameliyat kaydı olan** hasta. Başvurular dosyanın
> açıldığı günden sayılır.

Yanıtta taşınıyor çünkü tanımı belirsiz bir dönüşüm oranını herkes farklı okur.

Ameliyat **pencereyle sınırlı değil**: martta başvurup haziranda ameliyat olan
hasta dönüşmüştür, pencereyi kesmek son ayların bütün kanallarını olduğundan
kötü gösterirdi.

## Serbest Metin Kanallar

`referral_source` dosyayı açan kişinin yazdığı bir metin. "Instagram",
"instagram", "INSTAGRAM " ve "İnstagram" dört kanal olarak gelir ve bir kanalın
sayısını dörde böler — ilaç adlarındaki hatanın aynısı, çözümü de aynı.

Yalnız **büyük/küçük harf, diyakritik ve boşluk** katlanıyor. "Instagram
reklam" kendi kanalı olarak kalıyor: onu "Instagram"a katmak, bu modülün
kliniğin pazarlama kategorilerine karar vermesi olurdu.

Etiket olarak kliniğin **en sık kullandığı yazım** dönüyor; eşitlikte karşılaştırma
`localeCompare` ile değil kod birimiyle yapılıyor — bir grafikteki etiket,
sürecin hangi makinede başladığına göre değişmemeli.

**Kaynağı yazılmamış hastalar kendi satırında.** Düşürmek, hâlâ parçası
oldukları bir toplamda diğer bütün kanalların payını şişirirdi.

## Gelir–Gider

Dönem içinde **faturalanan** para. Tahsil edilen para ayrı bir soru ve ayrı bir
rapor (`/finance/collections`).

- Her fatura **kesildiği günün** kuruyla çevriliyor — `outstanding` ile aynı
  kural, ki ikisi çelişemesin.
- **İptal edilmiş faturalar dışarıda**, ve kaç tane olduğu (`cancelledExcluded`)
  yazıyor.
- Marj = net − maliyet − aracı komisyonu.
- Çevrilemeyen tutar [FINANS](FINANS.md)'taki gibi düşürülmüyor; ayrıca **ay
  bazında** `converted` bayrağı var, ki grafik hiç yaşanmamış bir düşüş
  çizmesin, o ayı işaretlesin.

### Ortalama Ücret

**Para birimi bazında, tam.** Para birimleri arasında harmanlanmış bir ortalama
uydurmadır: 4000 EUR ile 3000 USD'nin ortalaması 3500 değildir.

### Maliyet Satırları

`costItems` eskiden serbest JSON'du; bir not için yeterli, bir toplam için
işe yaramaz. Artık şekli sabit: `{ label, amount }` listesi, girişte doğrulanıyor.

Okunamayan satır **sayılıyor, atlanmıyor** (`unreadableCostLines`):

> Beş maliyet satırının üçünden hesaplanmış, ikisinin düştüğüne dair hiçbir iz
> taşımayan bir marj, doğru görünen ve olmayan bir sayıdır.

Eksi maliyet de reddediliyor — yanlış sütuna girilmiş bir indirim, marjı sessizce
yükseltirdi.

## Doluluk Oranı

Dolu dakika / tanımlı çalışma dakikası, ayda bir, kliniğin **duvar saatiyle**.

Duvar saati bilinçli: 09:00–17:00 penceresi, yaz saati değişiminin hangi
tarafına düşerse düşsün sekiz saatlik iş günüdür. Geçen süreyi saymak, saatlerin
geri alındığı pazarı dokuz saatlik gün diye raporlardı.

**Hiç müsaitlik penceresi yoksa payda yoktur.** Bu durumda oran `null` ve
`capacityUnconfigured: true`:

> Sıfır yazmak daha kötü olurdu: boş bir ajanda gibi okunur, oysa eksik olan bir
> ayardır.

İptal edilmiş randevular dolu zaman değil; yalnız `CONFIRMED` ve `COMPLETED`
sayılıyor.

## Aylar

Aylar **kliniğin takviminde** okunuyor, UTC'de değil: 31 Mart 22:30 UTC,
İstanbul'da nisandır ve o akşamki ameliyat nisanın rakamlarına aittir.

**Boş aylar listede kalıyor.** Sessiz bir ağustosu atlayan grafik, içinden düz
bir çizgi geçirir.

Aralık en fazla 120 ay; ters aralık ve aşırı uzun aralık **reddediliyor,
kırpılmıyor** — başlığı okuyan kişi kendi yazacak, sessizce başka bir soruya
cevap vermek hatadan kötüdür.

## Yapmadıklarım

- **Kapasite tahmini** (§M11 "kapasite tahmini"). Doluluk *ölçülüyor*; gelecek
  ayların tahmini bir modeldir ve elde eğilim çıkaracak kadar veri yok. Uydurulmuş
  bir tahmin, üzerine kadro kararı verilecek bir sayıdır.
- **Isı haritası verisi** — §M11 grafik türleri arasında sayıyor; gün×saat
  yoğunluğu randevu verisinden türetilebilir, panel ekranlarıyla birlikte
  yapılacak.
- **Panel ekranlarının kendisi** — bu görev veri katmanı ve istemci modelleri.
  Grafik bileşenleri iOS/Android ekran işidir.
- **Hasta bazında kârlılık** — veri var, ama tek hastanın marjını gösteren bir
  ekran klinik kararla karışır.
