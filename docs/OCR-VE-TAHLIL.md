# OCR ve Tahlil Sonucu Onayı

Şartname §M2, §M16, T3.3. Kod: [`backend/src/ocr/`](../backend/src/ocr/) ·
[`backend/src/lab/`](../backend/src/lab/) ·
[`ios/Sources/KlinikLabFeature/`](../ios/Sources/KlinikLabFeature/) ·
[`android/feature/lab/`](../android/feature/lab/)

## Tek Kural: OCR Çıktısı Asla Otomatik Onaylanmaz

Şartname §M16 bunu bir cümleyle söylüyor ve bu modülün tamamı o cümlenin etrafında kurulu.
OCR'ın okuduğu her değer `verified_at = null` ile kaydediliyor; **trendlere girmiyor,
uyarı üretmiyor, hasta dosyasında görünmüyor.** Klinik hâle gelmesinin tek yolu bir insanın
onaylaması.

Onay ekranı bunu her açılışta yazıyor. Sonuç gibi görünen bir liste, okunmadan onaylanan bir
listedir.

## Ayrıştırıcı Tahmin Etmiyor, Reddediyor

İki hata biçimi var ve **simetrik değiller**. Okunamayan bir sonuç doktora bir satır yazdırır.
Yanlış okunan bir sonuç ise klinik kayda giren ve doğrusu kadar güvenilir görünen bir sayıdır.

Bu yüzden ayrıştırıcı kararsız kaldığı her yerde satırı **atlıyor**:

- Tanınan bir birim taşımayan satır → atlanır (tarih, başlık, sayfa numarası)
- Analit adı olmayan satır → atlanır
- **`1,234`** → reddedilir. Bir ülkede bin, başka bir ülkede 1.234; raporun kendisi hangisi
  olduğunu söylemiyor. Yanlış seçmek değeri bin kat kaydırır.
- Ters yazılmış referans aralığı (`16 - 12`) → yok sayılır; yoksa aralıktaki her değer anormal
  işaretlenirdi.

Ayrımı yapan şey ondalık ayıracının **konumu**, cihazın dili değil: `1.234,5` içinde virgül
sonda olduğu için ondalıktır. Cihaz diline bakmak, yurt dışında basılmış her raporu — yani
çoğunu — yanlış okurdu.

## Gerçek OCR Çıktısına Göre Ayarlandı

Fikstür bir tahlil raporu görüntüsü ve test **gerçek Tesseract'ı** çalıştırıyor. İlk koşuda
motor `10^3/µL` içindeki şapkayı `*` okudu. Temiz metne göre ayarlanmış bir ayrıştırıcı, tüm
hemogramı sessizce düşürürdü. Şapka artık karakter sınıfı olarak yazılıyor ve iki yazım tek
birime normalize ediliyor — yoksa aynı analitin trend grafiği ikiye bölünürdü.

Bu testin var olma sebebi bu: birim testleri ayrıştırıcıya **asla göremeyeceği** temiz metni
veriyor.

## Kritik Düşük Hiç Tetiklenmiyordu

Bayrak eşiği önce "aralığın iki katı kadar dışarı" diye yazılmıştı. Üst tarafta doğru; alt
tarafta ise sonuç genellikle **negatif bir sayı** çıkıyor, yani bir değer ona asla ulaşamıyor.
Tek yönlü alt sınırı olan her analit için CRITICAL erişilemezdi — düşmenin tehlikeli yön
olduğu analitlerin tamamı.

Testte hemoglobin 5 beklenirken LOW dönmesiyle yakalandı. Alt taraf artık oran: alt sınırın
yarısı.

Referans aralığı olmayan değer **sınıflandırılmıyor** — normal sayılmıyor. Yeşile boyamak,
raporun söylemediği bir şeyi söylemek olurdu.

## Analit Eşleştirmesi Bir Kez Öğreniliyor

Tanınmayan analit adı "eşleştirme bekliyor" olarak işaretleniyor. Doktor bir kez LOINC kodu
verdiğinde eşleştirme kaydediliyor ve sonraki raporlarda tekrar sorulmuyor (§M16).

Anahtar üretilirken **noktalı ve noktasız i birleştiriliyor**, ve bu kozmetik değil: Türkçe
küçük harf kuralı `I`'yı `ı`'ya, `İ`'yi `i`'ye çeviriyor. Önce `tr-TR` ile küçültülerek
yazılmıştı; sonuçta `HEMOGLOBİN` ile `Hemoglobin` iki ayrı anahtar üretiyor ve doktora aynı
analit iki kez sorduruyordu. Hiçbir analit diğerinden yalnızca bir noktayla ayrılmadığı için
burada birleştirme güvenli.

## Sıra: Şüpheli Olan Üstte

Kuyruk düşük güvenden yükseğe sıralı. İnsanın bakması gereken alanları motorun emin olduğu
alanların altına gömmek, gözden geçirenin okumadan tıklamaya başlaması demek.

Güven skoru bir doğruluk olasılığı **değil** — temiz basılmış bir rakam başka bir temiz rakam
olarak okunduğunda skor yüksek çıkar. Bariz şüpheliyi süzen bir filtre; insan kontrolünün
yerine geçen bir şey değil. Otomatik onay bu yüzden hiç yok.

## Kuyruk Zinciri

`intake` (baytlar orada mı?) → `document-ocr` (oku ve aday değerleri kaydet). Ayrı işler,
çünkü OCR'ı başarısız olan bir belgenin sağlam geldiği yine de biliniyor ve OCR tek başına
yeniden denenebiliyor — baytlar yeniden indirilip yeniden doğrulanmadan.

Pasaport ya da fatura okunmuyor: üzerinde tahlil değeri yok. Durumu **SKIPPED**, DONE değil —
DONE bir şey okunduğunu ima ederdi.

Çalışma dizini hasta belgesini açık hâlde tutuyor; iş başarılı da olsa başarısız da olsa
siliniyor.

## Kalan

- **Cihaz üstü OCR** (Vision / ML Kit) — §3.2 birincil okuma olarak onu istiyor, sunucu
  fallback. Şu an yalnız sunucu tarafı var; cihaz üstü ön okuma T3.3'ün kalanı.
- Kamera ile belge tarama (kenar tespiti, perspektif düzeltme) — §M16'nın ilk maddesi.
