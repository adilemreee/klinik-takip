# Randevu ve Takvim

Şartname §M10, T4.6. Kod: [`backend/src/appointments/`](../backend/src/appointments/) ·
[`ios/Sources/KlinikAppointmentsFeature/`](../ios/Sources/KlinikAppointmentsFeature/) ·
[`android/feature/appointments/`](../android/feature/appointments/)

## İki Hata Önemli

Bir slota **iki hasta** yazmak ve kliniğin **kapalı olduğu saate** randevu vermek. İkisi de
biri kapıya gelene kadar sorunsuz görünür.

### Çakışma

Aynı personel için üst üste binen iki randevu reddediliyor. **Değmek binmek değildir**: 10:00–10:30
ile 10:30–11:00 bir kliniğin sabahı doldurma biçimidir, bunu reddetmek her randevu arasında
boşluk bırakırdı.

Kontrol **onaylarken tekrar** yapılıyor. Talep ile onay arasında doktorun takvimi dolmuş
olabilir ve çakışmanın üstüne onaylamak, aynı saate iki hastanın gelmesidir.

### Müsaitlik

Slot pencereye **tamamen** sığmalı. 18:00'de kapanan bir klinikte 17:45'e verilen yarım saatlik
randevu, on beş dakikası kapanıştan sonraya düşen bir randevudur — ve birini boş binaya sokar.

**Hiç saat yayınlamamış personele randevu verilmiyor.** Bu, mesajlaşma erişim penceresinin
tam tersi varsayım ve sebebi de ters: orada sessizlik "klinik mesajların tutulmasını
istemedi" demek; burada saat yayınlamamış bir doktor **hiç saat teklif etmemiştir**, ve
uydurmak hastaları kimsenin kabul etmediği bir zamana yazmak olurdu.

`availability_windows` bilerek `access_windows`'tan ayrı bir tablo: biri kliniğin ne zaman
mesaj okuduğunu, diğeri ne zaman hasta kabul ettiğini söylüyor. Gece yarısı mesaj yanıtlayan
bir doktor gece yarısı randevu vermiyor.

## Talep → Onay

Hastanın açtığı randevu `REQUESTED`, personelinki `CONFIRMED` doğuyor. Klinik kendi takvimini
kabul etmiştir, talep edeni değil — bunu tek adıma indirmek doktorun gününe yabancıları
doğrudan yazmak olurdu.

**İptal hastaya da açık.** Gelemeyeceğini telefon etmeden söyleyebilmek, iptal edilmiş bir slot
ile gelinmemiş bir randevu arasındaki farktır.

## Erteleme Hatırlatmaları Sıfırlıyor

Ertelenen randevunun `remindersSent` alanı temizleniyor: "yarın" diye haber verilmiş bir hastaya,
randevu taşındıysa **yeniden** haber vermek gerekir.

Hangi hatırlatmaların gittiği satırda tutuluyor, saatten çıkarılmıyor. Yeniden başlayan bir
worker aksi hâlde aynı hatırlatmayı ikinci kez gönderir; anın üstünden geçmiş bir worker da hiç
göndermez.

Geçmiş bir hatırlatma **geç gönderilmiyor**: randevudan sonra gelen bir "iki saat sonra"
mesajı, hiç gelmemesinden kötüdür — hastaya artık doğru olmayan bir şey söyler.

## ICS Dosyası

Elle üretiliyor, kütüphaneyle değil: format bir düzine satır ve önemli olan iki hata —
**kaçış ve satır katlama** — bir kütüphanenin kaldırmak yerine sakladığı hatalar. İkisinin de
testi var.

- **Kaçış:** konumdaki bir virgül ("Kat 3, Oda 12") kaçırılmazsa özelliği erken bitirir; takvim
  uygulaması ya gerisini atar ya dosyayı reddeder.
- **Katlama bayt üzerinden:** Türkçe "ş" iki bayt, ve karakter sayısına göre katlamak bize
  yasal görünen ama katı bir ayrıştırıcı için uzun satırlar üretir. Çok baytlı karakter asla
  bölünmüyor.
- **UID randevunun kendi kimliği:** dosyayı yeniden içe aktarmak etkinliği günceller, ikinci bir
  kopya eklemez.
- **İptal edilen randevu dışarıda bırakılmıyor, `STATUS:CANCELLED` ile yazılıyor:** yeniden içe
  aktarma onu hastanın takviminden **siliyor**, aksi hâlde kliniğin iptal ettiği bir randevu
  hastanın takviminde kalırdı.

## İstemcide

Ret sebebi kendi kelimeleriyle ayrılıyor: **"bu saat dolu"** hastayı başka bir saate,
**"klinik o saatte kapalı"** başka bir güne yönlendirir. Yanlışını söylemek öğleden sonrasını
boşa harcatır.

İptal edilen randevu ekrandan **düşmüyor**: iptal eden hasta onun iptal olduğunu görmeli,
kaybolduğunu görüp kliniğin haberi olup olmadığını merak etmemeli.
