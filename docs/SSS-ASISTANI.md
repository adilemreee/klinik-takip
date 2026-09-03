# SSS Asistanı ve Protokol Getirimi (RAG)

Şartname §M4, T5.3. Kod: [`backend/src/protocols/`](../backend/src/protocols/) ·
[`backend/src/assistant/`](../backend/src/assistant/)

## Kural

> Model **yalnızca** kliniğin yüklediği dokümanlardan yanıt verir.

Bu kural modele rica ederek tutulmuyor. Üç yerde, kodun içinde tutuluyor:

1. **Getirim zayıfsa model hiç çağrılmıyor.** Alıntılayacak bir şeyi olmayan ve
   yardımcı olması söylenmiş bir bot, eğitim verisinden yardımcı olur — ve klinik
   bunu bir hasta cümleyi geri tekrarladığında öğrenir.
2. **Kaynak göstermeyen yanıt atılıyor.** Hiçbir şey alıntılamayan ya da önüne
   konmamış bir parçayı alıntılayan yanıt, korpustan başka bir yerden gelmiştir.
3. **Kesilmiş yanıt atılıyor.** Hastaya giden yarım cevap, cevapsızlıktan kötü:
   çekince genelde son cümledir.

Devretmek **beklenen sonuç**, hata değil. Klinik yüz soruyu kendi yanıtlamayı,
birinin modelin hafızasından yanıtlanmasına tercih eder.

## Hibrit Getirim

İki arama, çünkü farklı şekillerde başarısız oluyorlar:

- **Vektör araması** aynı şeyi farklı kelimelerle anlatan parçayı buluyor
  (pgvector, HNSW kosinüs indeksi).
- **Sözcük araması** hastanın kendi kelimelerini kullanan parçayı buluyor
  (PostgreSQL FTS).

İkisinin de bulduğu parça, buradaki en yakın **ikinci görüş**; birleştirmede
küçük bir puan alıyor.

**Gömme sağlayıcısı ayrı yapılandırılıyor** — Anthropic'in embeddings API'si yok,
yani klinik bir sağlayıcıyla yanıtlayıp başkasıyla gömebilir, ya da hiç
gömmeyebilir. **Şu an gönderilen hâl bu**: gömme kapalı, getirim yalnız sözcük
araması. Sessizce modelin hafızasına düşen bir yol yok.

### Türkçe

Sözcük aramasının iki sıradan sorunu var, ve ikisi de tek başına her sorunun
hiçbir şey bulmamasına yeter:

- **Türkçe eklemeli.** Doküman "pansumanınızı değiştirin" diyor, hasta
  "pansuman ne sıklıkla değiştirilmeli" diye soruyor. Tam kelime eşleşmesi yok
  ve PostgreSQL'de Türkçe kök bulucu yok. Sorgu tarafı kelimeleri **altı
  karaktere kırpıyor** — sözlüksüz bir dil için gerçekten işe yarayan teknik bu.
- **Herkesin yarısı diyakritiksiz yazıyor.** "degistirme" ile "değiştirme" aynı
  parçaya ulaşmalı, bu yüzden **iki taraf da** aynı `translate` ile
  diyakritiklerini kaybediyor — indeks de öyle kurulu.

Terimler **VEYA** ile bağlanıyor. VE olsaydı sorunun her kelimesinin tek bir
parçada geçmesi gerekirdi, ki bu neredeyse hiç olmaz ve asistan her şeyi
devrederdi. Gürültüyü tutan şey puan tabanı ve modelin kendi "bu parçalar soruyu
yanıtlıyor mu" kontrolü.

### Puan tabanı

Kosinüs benzerliği ile `ts_rank` aynı ölçekte değil: ilki ilgili bir parça için
0.4–0.8, ikincisi aynı parça için birkaç yüzde birlik. Doyuran bir eşleme ikisini
aynı ölçeğe getiriyor — sonuç kümesinin maksimumuna bölmek yerine, çünkü en iyi
sonucu 1.0 yapmak tam da tabanın yakalamak için var olduğu durumdur.

Taban **kasten düşük değil**. Altındaki her puan, soruyla *bir şekilde* ilgili
bir parça, ve bir avuç öyle parça kendinden emin yanlış cevabı üreten girdinin
ta kendisi.

## Ameliyat Tipi Filtresi

Getirim, hastanın kendi prosedürüne ait ya da genel dokümanlarla sınırlı. Bir
sleeve gastrektomi talimatının rinoplasti hastasına gösterilmesi ıskalama değil;
**başka bir ameliyatın bakımı**.

## Parçalama

Belge parçalanırken kendi dikişleri izleniyor: önce boş satırlar, sonra cümle
sonları. Bir talimatın ortasından kesilen parça **yarım talimat** olarak
getiriliyor, ve yalnız kaynaklarından yanıt verebilen bir bot da yarımıyla
yanıt verir.

Her parça bir öncekinin kuyruğunu taşıyor: "yarayı sabunla yıkayın" ile "ilk 48
saat ıslatmayın" iki ayrı parçaya düşerse, bot birine protokolün tersini söyler.

## Konuşma Nerede Duruyor

Soru **her hâlükârda** konuşmaya yazılıyor — bot yanıtlasa da yanıtlamasa da.
Şartname bütün bot konuşmalarının doktor panelinde görülebilmesini istiyor, ve
botun yanıtlayamadığı soru zaten **kliniğe gelmiş bir mesaj**.

Bot yanıtı `MessageType.BOT` ve **göndereni yok**: bir insana atfetmek, hastanın
bunu bir klinisyen söyledi sanmasının yolu.

Devredilen soru **triyajdan geçiyor** (T5.2), yani botun yanıtlayamadığı soru
alarm verici bir şeyle ilgiliyse sıradan kuyrukta beklemiyor.

"Bu cevap yeterli değil, doktora ilet" düğmesi soruyu, bot hiç yanıtlamamış gibi
triyaj ediyor: hastanın düğmeye basması ne kadar acil olduğuna dair klinik bir
yargı değil.

## Dokümanlar Silinmiyor

Emekliye ayrılıyor. Geçen ay verilen bir yanıt bir parçayı alıntıladı; dokümanı
silmek o alıntıyı hiçbir şeye işaret eder hâle getirir, ve botun hastaya ne
söylediğini inceleyen bir kliniğin **onun okuduğunu** okuyabilmesi gerekiyor.

## Uçlar

| Uç | Yetki | Ne yapar |
|---|---|---|
| `POST /protocols` | `ai.protocols.manage` | Doküman ekler, parçalar, (varsa) gömer |
| `GET /protocols` | `ai.protocols.manage` | Korpus |
| `DELETE /protocols/{id}` | `ai.protocols.manage` | Emekliye ayırır |
| `POST /me/assistant/ask` | `self.message` | Sorar; yanıtlar ya da insana devreder |
| `POST /me/assistant/{messageId}/escalate` | `self.message` | "Yeterli değil, doktora ilet" |

## Yapmadıklarım

- **Doküman dosyasından yükleme (PDF/DOCX).** Uç şu an metin alıyor; OCR
  hattı (T3.3) zaten PDF'i metne çeviriyor ve ikisini bağlamak ayrı bir iş.
- **Gömme sağlayıcısı olmadan vektör araması** — mümkün değil, ve sessizce
  bozulmuyor: sözcük araması tek başına çalışıyor.
- **Yanıtın hasta diline çevrilmesi.** Prompt Türkçe yanıt istiyor; §M3'ün çift
  yönlü çevirisi ayrı iş.
