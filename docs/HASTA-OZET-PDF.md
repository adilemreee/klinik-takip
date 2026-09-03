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

## Yapmadıklarım

- **Klinik logosu** — şablonda yeri var, görsel dosyası klinikten gelmeli;
  uydurulmuş bir logo hiç logo olmamasından kötü.
- **Finansal rapor PDF/Excel** (§M12) — finans verisi hazır, ayrı bir şablon
  ve ayrı bir yetki (`finance.report`) işi; T6.6 ile birlikte.
- **Toplu Excel/CSV export** — T6.6. `Export` modeli ve kuyruk onu bekliyor,
  yeni tür eklemek bir `ExportKind` değeri.
- **Fotoğrafların yüz bulanıklaştırması** — `isFaceBlurred` alanı var, uygulaması
  cihaz tarafı işi (T3.x borcu).
