# Hasta Özet PDF'i ve Dışa Aktarım

Şartname §M12, T6.5. Kod: [`backend/src/exports/`](../backend/src/exports/) ·
[`summary.ts`](../backend/src/exports/summary.ts) ·
[`pdf/render.ts`](../backend/src/exports/pdf/render.ts)

## Hiçbir Şey Sessizce Çıkarılmıyor

Bu modülün tek kuralı bu. Bir rapordan bir şey çıkarıldığında **sayısı ve
nedeni yazılıyor** — hem PDF'in içinde, hem `exports.contents` alanında, hem de
denetim kaydında.

> Fotoğraf bölümü olmayan bir özet, **fotoğrafı olmayan bir hasta** gibi okunur.
> Doğrulanmamış sonuçların çıkarıldığı bir lab tablosu, **tam bir sonuç seti**
> gibi okunur. İkisi de yanlış, ve kliniğin dışına yanlış bir izlenim taşıyan
> bir belge, daha az şey taşıyandan kötüdür.

| Çıkarılan | Neden |
|---|---|
| Doğrulanmamış lab sonuçları | OCR çıktısı bir insan onaylamadan sonuç değildir (§M16) |
| Onaylanmamış AI metinleri | Hekim imzalamadan kalıcı bir belgeye girmez (§14.3) |
| Onamı olmayan fotoğraflar | Bağlı ve iptal edilmemiş fotoğraf onamı şart (§M7) |
| İstenmeyen fotoğraflar | Varsayılan **kapalı** |

## Fotoğraflar Varsayılan Kapalı

Bir exportun taşıyabileceği en hassas şey. Bu dosya kliniğin dışına çıkıyor ve
**bir yüz, imzalı bir URL'in geri alabileceği bir şey değil.**

İstendiğinde bile yalnız `consentId` bağlı **ve** `revokedAt` boş olanlar
giriyor. İptal edilmiş onam ile hiç onam, ikisi de "hayır".

Sayı ve bayt sınırı var: iki yüz fotoğraflı bir hasta, kimsenin açamayacağı bir
belge üretirdi — ve hepsini belleğinde tutan bir worker.

## Türkçe Harfler

PDF'in yerleşik yazı tipleri WinAnsi kodlu; **ş, ğ, İ, ı yok.** Helvetica ile
basılan bir Türkçe isim hata vermez — harfleri sessizce düşürür, ve "Ayşe
Yılmaz" hastanın kendi adı olarak tanıyamayacağı bir şeye dönüşür.

Bu yüzden Unicode bir TTF gömülü (DejaVu Sans, serbest lisans) ve **Türk
alfabesinin tamamı testte**: her harf için glyph var mı diye bakılıyor.

Yazı tipi dosyası yerinde değilse **hiçbir şey çizilmiyor** — pdfkit eksik TTF
için durmaz, geri düşer; boş kutularla basılmış bir klinik özet, hiç özet
olmamasından kötüdür çünkü birisi onu yazdırır.

## Grafikler

Vektör olarak çiziliyor, tarayıcıdan geçirilmeden: bir düzine kilo ölçümü,
worker'da headless Chrome çalıştırmayı hak etmiyor.

Önemli olan **bozuk durumlar**, ve nadir değiller:

- **Tek ölçüm** — nokta olarak, ve **ortada**. Sol kenara koymak, olmayan bir
  eğilimin başlangıcı gibi okunur.
- **Düz seri** (üç aynı kilo) — sıfır aralık her noktayı NaN yapar ve hiçbir şey
  çizilmez. Aralık, değerle orantılı olarak genişletiliyor: 80 kg için de 36.6
  °C için de çalışsın.
- **Aynı anda iki ölçüm** — sıfıra bölme.
- **Skalanın dışındaki değer** — kırpılıyor, yoksa üstündeki yazının üzerine
  çizilir.

Tansiyonun ikinci sayısı grafiğe **girmiyor**: sistolik ve diyastolik tek çizgide
tek ve çılgınca oynayan bir ölçüm gibi görünür. Son değer yanında tam yazılıyor.

## Export Bir İstek, İndirme Değil

Şartname §M12 dört şey istiyor, dördü de burada:

1. **Kuyrukta üretiliyor** — grafikli, fotoğraflı bir özet saniyeler sürer.
2. **Bildirimle haber veriliyor** (`export.ready`).
3. **Link kısa ömürlü ve imzalı** — 5 dakika.
4. **Her export denetim günlüğünde.**

Denetim kaydı **iki kez** yazılıyor:

- Dosya bittiğinde, **manifestiyle** — yarıda kalmış bir istek ifşa değildir, ve
  "bir özet dışa aktarıldı" cümlesi fotoğraf içerip içermediğini söylemeyince
  bir soruşturmanın soracağı hiçbir soruyu cevaplamaz.
- **Link verildiğinde** — verinin çıkabileceği an odur, dosyanın yapıldığı an
  değil.

## Dosya Yedi Gün Sonra Siliniyor

Nesne siliniyor, **satır kalıyor**.

> Nesne depolamada sonsuza kadar duran tam bir hasta özeti, kimsenin almayı
> seçmediği bir sorumluluktur. Dosya birinin bir kez istediği bir anlık
> görüntü, arşiv değil.

Neyin dışa aktarıldığının kaydı dosyadan uzun yaşamalı, o yüzden `contents` ve
denetim satırı duruyor. İki istemcide de **"süresi doldu" ile "başarısız" ayrı**:
zamanında üretilip teslim edilip temizlenmiş bir dosya başarıdır, hata gibi
göstermek birini olmayan bir arıza aramaya yollar.

## Yetki

`export.create`. Ayrıca **hastayı görebilmek gerekiyor** — finans masası
`export.create` tutuyor ama hasta kapsamı boş, o yüzden 404 alıyor. Bir export
başkasının değil: sahibi olmayan için "senin değil" ile "böyle bir export yok"
aynı cevap.

## Klinik Adı

Rapordaki klinik adı `CLINIC_NAME` ortam değişkeninden. **Depoda sabit değil** —
burası birinin kliniği, bu projenin değil.

## Toplu Excel/CSV Export (T6.6)

Aynı yaşam döngüsü: kuyruk, bildirim, kısa ömürlü imzalı link, denetim, yedi
günlük ömür. Yeni olan üç şey var.

### Elektronik Tablo Formülü Enjeksiyonu

Bir hücre `=`, `+`, `-` ya da `@` ile başlıyorsa elektronik tablo onu **formül
sayar ve açarken çalıştırır**.

> Hasta kendi adını kayıtta kendisi yazıyor. Ad alanına yazılmış
> `=HYPERLINK("http://…","Tıkla")`, kliniğin export kopyasında canlı bir bağlantı
> olur — ve daha kötüsü mümkün.

Her değer yazılmadan önce etkisizleştiriliyor (başına apostrof; Excel ve
LibreOffice hücreyi metin okur, apostrofu göstermez). **CSV'de de XLSX'te de** —
dosya biçimi farklı, elektronik tablonun açarken yaptığı şey değil.

Değer olduğu gibi korunuyor: "+90 532…" telefon numarası hâlâ kendisi. Karakteri
silmek yerine kaçırmanın nedeni bu.

### Kolon Seçimi Reddediyor, Düşürmüyor

Kolonlar kapalı bir katalogdan ve her birinin bir yetkisi var: kimlik kolonları
`patients.read`, klinik kolonlar `medical.read`, para kolonları `finance.report`.

> Beş kolon isteyip üçünü alan bir tablo, **tam bir tablo gibi görünür**. Eksik
> kolon boş bir alan değil, hiç yok; sonra açan kimse onun istenmiş olduğunu
> bilemez.

Bu yüzden yetkisi olmayan bir kolon **istendiği anda 400** ile reddediliyor,
hangi kolonlar olduğu söylenerek — kişi ekranın başındayken düzeltebilsin.
Kolonlar worker'da **yeniden** çözülüyor: iş kuyrukta beklerken birinin yetkisi
alınmış olabilir, ve dosya tıklandığı ana değil yazıldığı ana ait olmalı.

`GET /exports/columns` katalogu, hangisini alabildiğiniz işaretli olarak
veriyor. İstemciler alamadıklarını **gizlemiyor, "yetkiniz yok" diye
gösteriyor**: listede hiç olmayan bir kolon, var olmayan bir kolon gibi görünür
ve birisi o veriyi daha az dikkatli bir yerde aramaya gider.

### Dosyanın Kendisi Nereden Geldiğini Söylüyor

Verinin üstünde bir künye bloğu (XLSX'te ayrı bir "Bilgi" sayfası): kim aldı, ne
zaman, hangi filtreyle, kaç satır, ve **"Yalnız bu kullanıcının görebildiği
hastalar"**.

> Ortak klasörde künyesiz duran bir tablo, içinde ne olursa olsun "bütün
> hastalarımız" diye okunur.

Satırlar çağıranın hasta kapsamına göre; kapsam sorgunun içinde, sonradan
filtrelenmiyor. 100.000 satırda kesiliyor ve kesildiyse **hem dosyada hem
manifestte** yazıyor — kısa kesilmiş ama tam görünen bir tablo, kimsenin
yakalamadığıdır.

CSV'nin başında **BOM** var: onsuz Excel dosyayı yerel kod sayfası sanır ve
"Ayşe" "AyÅŸe" olur. Ne kadar doğru UTF-8 yazarsanız yazın değişmez.

## Yapmadıklarım

- **Klinik logosu** — şablonda yeri var, görsel dosyası klinikten gelmeli;
  uydurulmuş bir logo hiç logo olmamasından kötü.
- **Finansal rapor PDF/Excel** (§M12) — finans verisi ve kolonları hazır
  (`billedTotal`, `paidTotal`, `balance` hasta listesinde), ama ayrı bir
  fatura/tahsilat şablonu yapılmadı.
- **Fotoğrafların yüz bulanıklaştırması** — `isFaceBlurred` alanı var, uygulaması
  cihaz tarafı işi (T3.x borcu).
- **Çok para birimli toplam** — bir hastanın faturaları birden fazla para
  biriminde ise tutar hücresi **boş**, para birimi hücresi `KARIŞIK`. Euroyu
  liraya ekleyen bir sayı yazmaktansa boş bırakmak doğru: bir hücrenin kendini
  açıklayacak yeri yok, ve bir tablodaki yanlış toplam toplanan türdendir.
