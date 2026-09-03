# İlaç ve Reçete Uyum Modülü

Şartname §M9, T6.1. Kod: [`backend/src/medications/`](../backend/src/medications/)

## Reçeteden Takvime

Şartname RFC 5545 tekrarlama kuralı istiyor, ve sebebi şu: **"günde 2, 8 gün"**,
"gün aşırı", "pazartesi ve perşembe", "20'sine kadar günde 3" — hepsi sıradan
reçeteler, ve bir `interval` sütunu hiçbirini ifade edemiyor.

Bu cümlelerin ihtiyaç duyduğu alt küme uygulandı; **gerisi tahmin edilmiyor,
reddediliyor.** Okunamayan bir kural, bir klinisyenin bir şeyin olmasını
bekleyerek yazdığı kuraldır — yazıldığı anda hata veriyor, sessizce boş bir
takvim üretmiyor.

| Desteklenen | |
|---|---|
| `FREQ` | `DAILY`, `WEEKLY`, `HOURLY` |
| `INTERVAL`, `COUNT`, `UNTIL` | |
| `BYHOUR`, `BYMINUTE` | günün hangi saatleri |
| `BYDAY` | yalnız `FREQ=WEEKLY` ile |

> Şemadaki eski yorum `FREQ=DAILY;INTERVAL=1;COUNT=16`'yı "günde 2, 8 gün"
> diye tarif ediyordu; bu RRULE anlamıyla yanlış — o kural 16 **gün** eder.
> Doğrusu `FREQ=DAILY;COUNT=16;BYHOUR=9,21`. Yorum düzeltildi ve test bunu
> sabitliyor.

Sınırı olmayan bir kural (COUNT yok, UNTIL yok, bitiş tarihi yok) reçete değil,
döngüdür — reddediliyor. Üretim ayrıca 600 dozda tavanlanıyor.

## Duvar Saati

Dozlar **hastanın kendi saat diliminde** üretiliyor, kliniğinkinde değil.
Almanya'da iyileşen bir hasta dokuzdaki dozunu **orada dokuzda** alır.

Ve genişletme duvar saatinde yapılıyor, UTC'de 24 saat eklenerek değil:

> Saat değişiminden geçen bir kür, dokuzunu korumalı. UTC'de hesaplayıp 24 saat
> eklemek, değişimden sonraki her dozu bir saat kaydırır — günde iki kez alınan
> bir antibiyotikte bu, **sekiz saat arayı yediye indirmek** demektir.

`FREQ=HOURLY` tek istisna: o gerçek zamanda bir adım, takvimde değil, ve orada
saat eklemek doğru olan.

## Uyum Skoru

**Yalnız zamanı gelmiş dozlar üzerinden.** Bu sabah yazılan bir plan öğleden
sonra **%0 okumamalı** — o, kliniğe uyarı gönderen sayı.

- Zamanı gelmemiş doz sayılmıyor (ne alınmış ne kaçırılmış).
- Bir doz, zamanından **6 saat** sonra hâlâ yanıtlanmamışsa sayılmaya başlıyor.
  Sabah hapını öğlen içip sonra işaretleyen kişi cezalandırılmıyor; bir günlük
  sessizlik aynı gün görünüyor.
- **Geç alınan doz alınmıştır.** Sekizdeki dozu on birde alan hasta onu almıştır,
  ve bunu kaçırma saymak ona uygulamaya dürüst olmanın değmediğini öğretir.
  Kayıtta `LATE` duruyor, çünkü bir klinisyenin dozların kaydığını görebilmesi
  gerekiyor.
- **Ertelenen doz hâlâ bekliyor.** Hasta "sonra" dedi, ve sonra henüz gelmedi.

Skor, hiçbir doz zamanı gelmemişse **null** — sıfır değil. Sıfır "bu hasta
hiçbir şey almıyor" diye okunur.

## Seri ve Rozetler

§M9 oyunlaştırma istiyor, ama **"abartısız ve tıbbi ciddiyeti bozmayan tonda"**.
Bu cümle dosyayı şekillendiren şey:

- **Azarlama yok, başarısızlık durumu yok, kaybedilebilecek rozet yok.**
- Her rozet ilaç **alarak** kazanılıyor; hiçbiri kaçırılan bir dozdan söz etmiyor.
- Kür kötü giderken (%50 altı) rozetler **hiç gösterilmiyor**. Kaçırılmış dozlar
  listesinin üstündeki "3 günlük seri" kartı, zor bir hafta geçiren birine karşı
  uygulamanın kendinden memnun olmasıdır.

Seri, **bugünün dozları henüz cevaplanmadıysa kırılmıyor** — gece yarısı sıfırlanıp
sabah boyunca yeniden kurulan bir seri, hastaya kahvaltıda iki haftalık serisini
kaybettirirdi.

## Kliniğe Ne Söyleniyor

**%70 altı uyarısı** (§M9), iki korumayla:

- Zamanı gelmiş doz yoksa skor da yok, uyarı da yok.
- **Bir avuç doz bir örüntü değil.** İki dozdan biri kaçırılınca %33 olur ve
  hiçbir şey ifade etmez; aynı oran iki hafta boyunca sürerse bu uyarının var
  olma sebebidir. Eşik: en az 6 doz.

Uyarı **yalnız hastadan sorumlu kişilere** gidiyor — nöbet listesinin tamamına
değil.

> Bunu bir test yakaladı. İlk hâlde acil butonun yedeğini kullanıyordum
> (`careTeam.everyone`), ki o "kimseye ulaşamamak kabul edilemez" durumu için
> doğru. Rutin bir uyum uyarısı için yanlış: ekibi olmayan her hasta için bütün
> kliniğe günlük mesaj gider, ve klinik onu susturmayı öğrenir — bedelini önemli
> olan uyarılar öder. `careTeam.assigned` yedeksiz; kimse atanmamışsa uyarı
> gitmiyor ve çözüm **birini atamak**.

**Reçete yenileme** hatırlatması hastaya gidiyor, kliniğe değil: iki farklı sorun,
iki farklı muhatap. Ve **gün değil doz** sayılıyor — günde üç alınan bir kürün
"iki günü" ile haftada bir alınanınki aynı miktar ilaç değil, ve biten şey ilaç.

Her uyarı **günde bir kez**: beş dakikada bir gelen uyarı susturulan uyarıdır.

## Hastanın Kendi Eklediği İlaç

Kaydediliyor ama **atıl**: takvim yok, hatırlatma yok, uyuma sayılmıyor. Onaysız
bir kayıttan takvim üretmek, uygulamanın hiçbir klinisyenin görmediği bir ilacı
almayı hatırlatması — ve almayınca hastayı düşürmesi — olurdu.

Klinisyen onayladığı anda takvim üretiliyor.

## Kürü Durdurmak

İleri dozlar siliniyor, **geçmiş dozlar kalıyor**. Geçmiş, hastanın gerçekte ne
yaptığının kaydı; silmek, üzerine klinik karar verilmiş olabilecek bir uyum
skorunu yeniden yazmaktır.

## Uçlar

| Uç | Yetki | Ne yapar |
|---|---|---|
| `POST /patients/{id}/medications` | `medications.prescribe` | Reçete yazar, takvimi üretir |
| `GET /patients/{id}/medications` | `medications.read` | Uyumla birlikte liste (denetlenir) |
| `PATCH /medications/{id}/approve` | `medications.approve` | Hastanın eklediğini onaylar |
| `PATCH /medications/{id}/stop` | `medications.prescribe` | Kürü durdurur |
| `GET /me/medications` | `self.read` | Kendi ilaçları, bugünün dozları, rozetler |
| `POST /me/medications` | `self.write` | Kullandığı bir ilacı ekler |
| `PATCH /me/medications/doses/{id}` | `self.write` | İçtim / Atladım / Ertele |

## Süpürme

Beş dakikada bir, üçü birden: doz hatırlatması, yenileme hatırlatması, uyum
uyarısı. Aynı satırları okuyorlar; üç ayrı iş aynı şeyi söylemek için sorguları
üçe katlardı.

Hatırlatma **30 dakika geriye** bakıyor: dozun zamanı geldiğinde yeniden başlayan
bir worker, aksi hâlde o hatırlatmayı tamamen atlar ve hasta uygulamanın bir
dakikalığına kapalı olduğunu hiç öğrenmez.

## Yapmadıklarım

- **T6.2 ilaç etkileşim uyarıları** — ayrı görev; §M5 "referans veritabanı ile,
  LLM tek başına kaynak değildir" diyor, yani bir etkileşim veri kaynağı
  gerekiyor.
- **Haftalık özet** (§M9'un oyunlaştırma satırında geçiyor) — günlük brifingin
  altyapısı var, hastaya haftalık özet ayrı bir bildirim akışı.
- **Brifingdeki "uyum %70 altı" satırı** — T5.6'nın "bekleyenler" listesine bir
  satır daha; şimdi eklenebilir, ayrı ve küçük bir iş.
