# Erişilebilirlik

Şartname §7, T7.4. Denetleyici: [`design/scripts/check-accessibility.mjs`](../design/scripts/check-accessibility.mjs)

## Bir betiğin görebildikleri — ve göremedikleri

Otomatik denetim bilerek dar tutuldu. Bir etiketin VoiceOver'da **iyi okunup
okunmadığı** hiçbir betiğin veremeyeceği bir karar, ve verebiliyormuş gibi
yapmak denetimi kimsenin güvenmediği bir yeşil onaya çevirir.

Betiğin yakaladığı dört şey, dördü de ekranı zorlaştıran değil **kullanılamaz
kılan** türden:

| Kural | Neden |
|---|---|
| `icon-without-label` | Erişilebilirlik ağacında bırakılmış dekoratif ikon; okuyucu her iki işe yarar kelime arasında "görsel" der |
| `touch-target-unchecked` | Asgari hedeften küçük dokunulabilir öğe; eli titreyen biri ıskalar |
| `colour-without-words` | Durumun yalnız renkle anlatılması — yazanın göremediği, ayırt edemeyen için ise **tamamen** kaybolan hata (§7) |
| `spinner-without-label` | Duyurulacak hiçbir şeyi olmayan bekleme göstergesi; uygulama çalışırken okuyucu susar |

Menü satırları ve sistem düğme biçimleri kasten muaf: onları sistem boyutluyor
ve işaretlemek insanları denetleyiciyi yok saymaya alıştırır.

## Bu denetimin bulduğu ve düzeltilenler (2026-09-05)

**17 bulgu**, hepsi düzeltildi:

- Metnin zaten söylediğini tekrarlayan **dokuz dekoratif ikon** — hata
  bandındaki uyarı işareti, aramadaki büyeç, boş durum ikonu, ana ekran
  kutucuklarının ikonları, acil durum sonucu ikonları, sohbetteki saat, fotoğraf
  yer tutucusu. Hepsi ağaçtan çıkarıldı.
- **Beş bekleme göstergesi**: yanında metin olan ya da zaten adlandırılmış bir
  düğmenin içinde olanlar gizlendi (bir denetim için iki duyuru, birden kötü);
  tek başına duranlara ad verildi.
- **Üç düğme** asgari dokunma hedefine ulaşmıyordu.

## Renk kontrastı

`design/scripts/check-contrast.mjs` ayrı olarak koşuyor ve tasarım
token'larındaki her metin/zemin çiftini WCAG eşiğine karşı denetliyor. İkisi
ayrı, çünkü kontrast tasarım sistemine ait, geri kalanı ekranlara.

## Betiğin göremedikleri — gerçek bir insan gerekiyor

Bunlar **yapılmadı** ve yapılmış gibi yazılmayacak:

| Ne | Neden bir betik yapamaz |
|---|---|
| Okuma sırası | Görsel düzenle mantıksal sıranın uyup uymadığı bir yargı |
| Etiket ifadesi | "Düğme, gönder, düğme" dilbilgisel olarak geçer, kullanışsızdır |
| Odak davranışı | Ekran değişince odağın nereye gittiği ancak dinlenerek anlaşılır |
| Dinamik yazı tipi | Metin en büyük boyutta kesiliyor mu — ekrana bakmak gerekir |
| Acil durum akışı | İki adımlı onayın ekran okuyucuyla **kullanılabilir** olması, en çok önem taşıyan ve en az otomatikleştirilebilen şey |

Bunlar için gereken: gerçek bir cihazda VoiceOver ve TalkBack açık, beş temel
akışın baştan sona denenmesi. **Gerçek hasta verisi girmeden önce yapılmalı**,
ve tercihen ekran okuyucuyu günlük kullanan biri tarafından.

## Nasıl koşturulur

```bash
node design/scripts/check-accessibility.mjs
```
