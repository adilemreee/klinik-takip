# Doktor Günlük Brifingi

Şartname §M5, T5.6. Kod: [`backend/src/briefing/`](../backend/src/briefing/)

## Brifing Veridir, Metin Değil

Buradaki her sayı bir sorgudan geliyor. Model — varsa — o sayıları alıp
üzerlerine bir paragraf yazıyor, **başka hiçbir şey yapmıyor**.

> Üç hastanın ilgi beklediğini söyleyen üretilmiş bir cümle, sorgunun beşini
> bulduğu bir sabahta hiç brifing olmamasından kötüdür: **sakinlik yönünde
> yanlış** bir brifingdir.

Doktor her hâlükârda gerçekleri görüyor. Paragraf üstüne serilmiş bir kolaylık,
ve ekran ikisini birlikte gösteriyor. AI kapalıyken brifing tam olarak
çalışıyor — tıpkı triyajın kırmızı bayrak taraması gibi.

## Gün Sınırı

"Dün" `şimdi - 24 saat` değil. Öyle olsaydı, sabah sekizde okunan bir brifing
önceki sabah sekizden başlardı: **bugün yedideki bir acil çağrı düne yazılır,
dün yedideki hiç görünmezdi.**

UTC günü de değil: İstanbul üç saat ileride, yani UTC gün sınırı her klinik
akşamının son üç saatini yanlış brifinge koyar.

Sınır **kliniğin yerel gece yarısı**, ve saat değişiminden geçen bir günde gün
23 ya da 25 saat oluyor — sınır kaymıyor. (Türkiye artık saatini değiştirmiyor,
bu yüzden test bunu değiştiren bir saat diliminde yapıyor; aritmetik ortak ve
sabit ofsetli bir uygulama orada düşüyor.)

## Ne Var İçinde

| Dün | Bugün | Bekleyenler |
|---|---|---|
| Triyaj edilen hasta mesajı | Randevu | Yanıtlanmamış acil çağrı |
| Bunlardan acil sınıflandırılan | Kontrol kilometre taşı | Okunmamış acil mesaj |
| Acil durum çağrısı | | Yanıtlanmamış komplikasyon |
| Komplikasyon bildirimi | | Kaçırılmış kontrol |
| Kritik tahlil değeri | | Onay bekleyen AI yorumu |

"Triyaj edilen mesaj" hasta mesajı demek: anahtar kelime taraması yalnız onlarda
çalışıyor ve hepsinde çalışıyor.

Okunmamış acil mesajlar **üç günle** sınırlı. Ötesi brifingin yüzeye çıkardığı
bir şey değil, kliniğin sürecinde bozulmuş bir şeydir — ve onu göstermeye devam
eden bir liste, insanlara brifingin tepesini atlamayı öğretir.

## Sıralama

**Acil önce, sonra en uzun bekleyen.** Yalnız yaşa göre sıralanmış bir liste,
üç günlük onay bekleyen bir raporu yirmi dakika önceki bir acil çağrının üstüne
koyar — ve doktor yukarıdan okur.

## Kapsam

Her klinik okuma gibi kapsamlı: hemşirenin brifingi kendi hastaları hakkında.
Brifing, bütün kliniği görmenin **özellik gibi görüneceği** tek ekran; bu yüzden
kural burada da aynı.

## Modele Ne Gidiyor

Sayılar, ve başka hiçbir şey. **Hasta adı yok, serbest metin yok, klinik ayrıntı
yok.** Kim beklediğinin listesi istemcide yapısal veriden çiziliyor — hiçbir yere
gitmesi gerekmeyen yerde.

Bu, modele küçük bir iş vermek demek, ve küçük olması kasıtlı: altındaki
tabloyla çelişen bir cümle hiç cümle olmamasından kötü olduğu için, modele
çelişebileceği bir şey verilmiyor.

Paragraf **gün boyu önbellekleniyor** (sayıların kendisiyle anahtarlanmış).
Doktor sabah ekranını birkaç kez yeniliyor; değişmemiş sayılar hakkında her
seferinde paragraf üretmek kliniğin bütçesini aynı cümleye harcamak olur.
Sayılar değişince yeni paragraf anında geliyor.

## Sabah Bildirimi

Saatlik süpürme, kliniğin saatiyle sekiz olan saatte ateşleniyor — kontrol
takviminin kullandığı şeklin aynısı. UTC cron'u yılda iki kez bir saat kayar ve
bunu kimse, bir doktor "brifing artık yedide geliyor" diyene kadar fark etmez.

**Boş bir sabah için bildirim gitmiyor.** İçinde bir şey olmayan brifingin
bildirimi, insanlara diğerlerini yok saymayı öğreten bildirimdir.

## Uçlar

| Uç | Yetki | Ne yapar |
|---|---|---|
| `GET /me/briefing` | `medical.read` | Dün / bugün / bekleyenler, kendi hastaları |

İstek üzerine hesaplanıyor, saklanmıyor: içindeki her sayı **şimdi** hakkında bir
olgu, ve sekizde yazılıp on birde okunan bir brifing tam da var olduğu konuda üç
saat eski olurdu.

## Yapmadıklarım

- **İlaç uyum skoru** (§M9: %70 altına düşünce uyarı). İlaç modülü henüz yok;
  eklendiğinde brifingin "bekleyenler" listesine bir satır daha oluyor.
- **Brifingin geçmişi.** Dünkü brifingi okuma ihtiyacı olursa saklanması gerekir;
  şu an her çağrıda taze hesaplanıyor.
