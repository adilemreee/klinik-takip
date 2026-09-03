# İlaç Etkileşim Uyarıları

Şartname §M5, §M9, T6.2. Kod: [`backend/src/medications/interactions.ts`](../backend/src/medications/interactions.ts) ·
[`interaction-reference.ts`](../backend/src/medications/interaction-reference.ts)

## AI Bu İşe Karışmıyor

Şartname net: **"referans veritabanı ile, LLM tek başına kaynak değildir"**. Bu
yüzden AI katmanı bu dosyalara ve yakınına hiç uğramıyor.

> İki ilacın etkileşip etkileşmediği sorulan bir model, **her iki yönde de
> kendinden emin** yanıt verir. Bir ilaç etkileşimi hakkında kendinden emin
> yanlış bir yanıt, bu sistemin üretebileceği en kötü çıktıdır.

Etkileşimler bir insanın okuyabileceği bir tablodan geliyor.

## İki Şey Belirliyor, Biri Tablo Değil

### 1. Yazılan adı tanımak

Reçete "Amoklavin" diyor, hasta "augmentin" yazıyor, epikriz "amoksisilin
klavulanat" diyor. Dizeye bakan bir kontrol bunların **aynı ilaç olduğunu
görmez** — hiçbir etkileşim bulmaz ve çalışıyormuş gibi görünür.

Bu yüzden isim sözlüğü var: jenerik, Türkçe, İngilizce ve **hastanın yazacağı
marka adları**. Marka adları orada, çünkü kendi ilacını ekleyen hasta
"Augmentin" yazar, "amoksisilin/klavulanik asit" değil.

Ayrıca:

- **Türkçe büyük/küçük harf** katlanıyor ("İBUPROFEN" = "ibuprofen").
- **Diyakritikler** düşüyor (Türkçe klavyesi olmayan hasta için).
- **Doz ve form temizleniyor**: "Amoklavin BID 1000 mg film tablet" ile
  "amoklavin" aynı şeye iniyor.
- **Uzun isim önce eşleşiyor.** Amoksisilin+klavulanat, amoksisilin değildir —
  farklı ürün, farklı etkileşim profili. Kısa olanı önce eşleştirmek her
  ko-amoksiklavı düz amoksisilin diye dosyalardı.

> Son maddeyi bir **mutasyon testi** yakaladı: ilk testim tam eşleşme yolundan
> geçtiği için sıralamayı hiç sınamıyordu. Bir cümlenin içine yazılmış ilaç adı
> (`"oral amoksisilin klavulanat başlandı"`) alt dize yolundan geçiyor ve orada
> sıra belirleyici. Test eklendi.

### 2. Sessizliğin ne demek olduğu

Tablo küçük. **"Etkileşim yok" yazısını "güvenli" diye okuyan bir klinisyen,
yazılım tarafından yanıltılmıştır.**

Bu yüzden her yanıt şunları taşıyor:

| Alan | Neden |
|---|---|
| `unrecognised` | Referansın **tanımadığı** ilaçlar. Dört ilacın üçü tanınmadıysa boş uyarı listesi hiçbir şey söylemiyordur |
| `comparedPairs` | Kaç çift gerçekten karşılaştırıldı. **Sıfır, hiçbir şeyin kontrol edilmediği** demek |

İstemci tarafında `checkedAnything` bu ayrımı taşıyor, ve ekranda değişmez bir
uyarı var: *"Uyarı olmaması güvenli olduğu anlamına gelmez."*

## Uyarı Engellemiyor

Klinisyen bilerek etkileşimli bir çift yazabilir — **ikili antiagregan tedavi
bir tedavidir, hata değil** — ve bunu engelleyen bir yazılım, göremediği
gerekçelerle verilmiş bir kararı geçersiz kılardı.

Yapması gereken şey **söylemek**: şiddet sırasına göre, kaçırılamayacak yerde.

`CONTRAINDICATED` ve `MAJOR` kesintiye uğratıyor; `MODERATE` ve `MINOR` yalnız
gösteriliyor. Hafif bir etkileşimde kesintiye uğratmak, kliniğe diyaloğu okumadan
kapatmayı öğretmenin yoludur.

## Nerede Gösteriliyor

- **Reçete yazarken ve hastanın eklediğini onaylarken** yanıta ekleniyor — birinin
  ilaç eklediği an, önemli olduğu an.
- **Ayrı bir uçta** (`GET /patients/{id}/medications/interactions`) istendiğinde.

Sıradan listelemede **yok**: her okumaya iliştirilen bir uyarı, okunmayan
uyarıdır.

Durdurulmuş kürler hesaba katılmıyor — hasta artık onu almıyor.

## Aynı İlaç İki Adla

`duplicates` marka ve jeneriğin birlikte yazıldığını yakalıyor (Coumadin +
Varfarin). Bu bir etkileşim değil, farklı bir bulgu — ve ilacın kendisiyle
etkileşimi diye raporlanmıyor.

## Tablo Hakkında

> **Bu bir başlangıç setidir ve hiçbir eczacı gözden geçirmedi.** Etrafındaki
> mekanizmanın — isim normalizasyonu, çift eşleştirme, uyarının nasıl
> gösterildiği ve sessizliğin ne anlama geldiği — gerçek, test edilmiş ve düzgün
> bir kaynağa hazır olması için var. **Kliniğin bunu değiştirmesi gerekiyor.**

Testler tablonun **şeklini** doğruluyor (her kuralın bileşeni tanımlı mı, çift
iki kez yazılmış mı, her isim tanınıyor mu) — **doğruluğunu değil**. Bir test
bir etkileşimin gerçek olup olmadığını bilemez.

Veritabanı tablosuna taşımak bariz sonraki adım ve **bilerek atılmadı**: içine
koyacak gerçek veri yokken boş bir tablonun üstündeki CRUD ekranı, başında
uyarısı olan bir dosyadan daha büyük bir yalandır.

## Yapmadıklarım

- **Üçlü ve üstü kombinasyon etkileşimleri** — gerçekler var, başlangıç
  tablosunun ötesinde; tablonun tam olduğunu ima etmektense söylemek daha iyi.
- **İlaç–besin, ilaç–hastalık etkileşimleri.**
- **Doza bağlı etkileşimler** — tablo çift bazında, doz bazında değil.
