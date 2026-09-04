# PROM Anketleri

Şartname §M18, T6.7. Kod: [`backend/src/surveys/`](../backend/src/surveys/) ·
[`scoring.ts`](../backend/src/surveys/scoring.ts) ·
[`survey-templates.ts`](../backend/src/surveys/survey-templates.ts)

## Lisans: Neyi Koymadım

Depoya **hiçbir lisanslı ölçek konmadı.** SF-36, RAND-36, FACE-Q, BREAST-Q ve
benzerleri telifli; birçoğu çalışma başına ücretli lisans istiyor. Herkese açık
bir depoya birini koymak ihlal olurdu — "yaklaşık aynısını" yazmak ise daha
kötü: değiştirilmiş bir ölçeğin puanı, benziyor diye karşılaştırılacağı yayınlanmış
normlarla **karşılaştırılabilir değildir**.

Şartnamenin istediği şey zaten bunları gerektirmiyor: ağrı (VAS 0-10), şişlik,
uyku, memnuniyet. VAS bir ölçüm yöntemi, telifli bir enstrüman değil.

**Memnuniyet sorusu** şartnamede "NPS" diye geçiyor. 0-10 tavsiye sorusu ve
hesabı her yerde kullanılıyor, ama **"Net Promoter Score" ve "NPS" tescilli
markalar** — bu yüzden kodda ve arayüzde o adlar hiç geçmiyor, alan ölçtüğü şeyle
anılıyor. Bunun bir testi var.

## Başlangıç Anketi Klinik Gözden Geçirmesi Bekliyor

Sorular şartnamenin kendi listesinden, ifadeler bu depo için yazılmış düz
Türkçe. **Hiçbir klinisyen gözden geçirmedi**, ve alarm eşikleri savunulabilir
olsun diye seçilmiş yer tutuculardır, klinik rehber değil.

Özellikle **yapmadığım** şey: beklenen iyileşme eğrisi. "İkinci gün ağrı 6" ile
"altıncı hafta ağrı 6" farklı klinik olgular ve hangisinin ne olduğu kliniğin
sahip olduğu içeriktir. Bu modül **hastayı kendisiyle** karşılaştırıyor ve
kaçıncı gün olduğunu gösteriyor — bir "normal" uydurmuyor.

## Yön: Tersine Çevrilirse Her Şey Ters Döner

Ağrının artması kötüleşmedir; memnuniyetin artması değildir. İkisini aynı okumak
bu modülün ürettiği **her uyarıyı tersine çevirir** — zor durumdaki hastalar
sessizleşir, rahat olanlar aranır.

Bu yüzden yön **soru başına yazılı**, ifadeden tahmin edilmiyor. Ölçek tipi
olmayan bir soruya yön verilmesi reddediliyor, ve başlangıç anketindeki her
ölçeğin yönü olduğu testte sabit.

Eşik alarmı da yönü izliyor: ağrı için tavan, uyku için taban.

## Neyin "Eğilim" Sayıldığı

Hastanın kendi bildirdiği sayılar gürültülüdür. Bir hafta 4, ertesi hafta 6
diyen hasta mutlaka kötüleşmemiştir; kötü bir sabah geçirmiş olabilir.

> Her dalgalanmada uyarı veren bir sistem, kapatılan bir sistemdir — ve sonra
> gerçek uyarı da kaçırılır.

Kural iki parçalı ve her ikisi de nedeniyle birlikte raporlanıyor:

| Bulgu | Ne zaman |
|---|---|
| `worsened` | Yönlü bir cevap, **aynı hastanın bir önceki cevabına** göre 3+ puan kötüleşti |
| `severe` | Cevap sorunun kendi eşiğini aştı — eğilimden bağımsız |

Üç puan seçildi: iki, sıradan günlük değişimde tetiklenir; dört, üçten altıya
gerçek bir kaymayı kaçırır.

**İlk ankette eğilim yoktur.** Karşılaştıracak bir şey olmadığı için `worsened`
üretilemez — ama `severe` üretilebilir: ağrının dokuz olması, geçen haftanın
dokuz olup olmadığından bağımsız olarak görülmeye değer.

Bilerek **eğri uydurma veya hareketli ortalama yok**: dört-beş noktayla
uydurulan bir eğilim çoğunlukla uydurmanın kendisidir. Klinisyenin sorduğu soru
zaten doğrudan cevaplanıyor — "geçen seferden kötü mü, ve şimdi bakmayı
gerektirecek kadar kötü mü".

## Uyarı İnsana Gidiyor, Atanmış Ekibe

Kötüleşme bildirimi **hiçbir şeyi kendi başına yapmıyor**; bakacak kişiyi
çağırıyor. Ve **atanmış ekibe** gidiyor, kliniğin tamamına değil — ilaç uyum
uyarısında bir testin yakaladığı ders.

Atanmış kimse yoksa kimse aranmıyor ve bu **loglanıyor**: sessizce herkese
yayılmasındansa görünür bir boşluk olması iyidir.

Bildirim acil değil ve susturulabilir. Bu bir anket cevabı; acil durum için acil
durum butonu var.

## Hastaya Klinik Yorum Dönmüyor

Hasta yanıtını gönderdiğinde geriye **yalnız kaydedildiği** bilgisi dönüyor.
Bulgular kliniğe gidiyor, hastaya değil.

> "Bildirdiğiniz ağrı kötüleşti" klinik bir okumadır ve bunu teslim edecek şey
> bu modül değildir.

Bunun testi var: yanıtın gövdesinde `invited` dışında alan olmaması.

## Eksik ve Geçersiz Cevaplar

**Uymayan cevap reddediliyor, uydurulmuyor.** 47 puanlık bir ağrı, ondalıklı bir
ölçek cevabı, bu sürümde olmayan bir soruya verilmiş cevap — hepsi 400.

> Uydurmak (coercion), boşluğun sıfıra dönüşme yoludur. Ve on üzerinden sıfır
> ağrı, kimsenin öne sürmediği klinik bir iddiadır.

Boş bırakılan soru **serbest**: uykusunu söylemek istemeyen hasta ağrısını
bildirmekten alıkonmamalı. Ama boş bırakılan soru değerlere **hiç girmiyor** —
sıfır olarak değil, yok olarak. Grafik boşluk çizebilsin diye.

Yarım doldurulmuş bir form da kaydediliyor ama **kısmi olarak işaretleniyor**
(`partial`): beş sorudan biri cevaplanmış bir yanıt, yanındaki tam yanıtla aynı
türden bir nokta değildir.

## Geç Cevap Cevap Değildir

Her anketin bir penceresi var (14 gün). Kapandıktan sonra gönderim reddediliyor.

> Hakkında olduğu haftadan üç hafta sonra verilen bir ağrı puanı bir hatıradır;
> onu o kilometre taşına yazmak, olmamış bir şeyi kaydetmektir.

Süpürge cevaplanmayanları `EXPIRED` yapıyor, ve bir anket **bir kez** soruluyor:
aynı formu saat başı alan hasta bu uygulamanın gönderdiği hiçbir şeyi okumaz.

## Sürüm Dondurulmuş

Bir anket sürümü, birisi cevapladığı anda dondurulur. Sorular yerinde
düzenlenseydi, **birisi bir yazım hatasını düzelttiği için eğilim çizgisi
kayardı**. Yanıt hangi sürüme verildiyse onunla birlikte saklanıyor.

## Ameliyat Tarihi Değişirse

Anketler takip planıyla aynı tarihten türüyor. Tarih ertelenirse:

- **Cevaplanmamış** kilometre taşları yeni tarihe **taşınıyor** — yoksa "ameliyattan
  bir hafta sonra" anketi ameliyattan önce gelirdi.
- **Cevaplanmış** olanlar olduğu yerde kalıyor: onlar hastanın o haftaya dair
  kaydı, ve üstüne yazmak söylediklerini çöpe atmak olurdu.

## Yüksek Memnuniyet Daveti

Yalnız 9-10 verenlere, **isteğe bağlı** ve tek yönlü. Düşük puan hastaya yönelik
hiçbir şey tetiklemiyor:

> Bir şikâyeti otomatik mesaja çevirmek, kliniğin memnuniyetsiz bir hastayı
> öfkelendirme yoludur.

## Yapmadıklarım

- **Lisanslı ölçekler** — yukarıda.
- **Beklenen iyileşme eğrisi** — klinik içerik, klinikte.
- **Anket düzenleme arayüzü** — şablonlar kodda tanımlı ve sürümlü. Klinik kendi
  sorularını isterse bir sonraki sürüm bir kayıt olarak eklenebilir; boş bir
  form tasarımcısı, içine koyacak gözden geçirilmiş içerik yokken erken olurdu.
- **Yorum yönlendirmesinin hedefi** (Google/Trustpilot bağlantısı) — kliniğin
  kendi kanalı, uydurulacak bir şey değil.
