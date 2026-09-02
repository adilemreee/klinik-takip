# Kontrol Takvimi

Şartname §M6, T4.4. Kod: [`backend/src/followup/`](../backend/src/followup/) ·
[`ios/Sources/KlinikFollowUpFeature/`](../ios/Sources/KlinikFollowUpFeature/) ·
[`android/feature/followup/`](../android/feature/followup/)

Ameliyat tarihinden D1, H1, M1, M2, M3, M6, Y1 kontrolleri üretiliyor; şablon ameliyat tipine
göre değişiyor.

## Tarih Aritmetiği Sessizce Yanlış Olabilir

Bu modülün en kritik yeri tarih üretimi. **Bir gün kayan bir kontrol tarihi ekranda gayet
makul görünür** ve tek belirtisi yanlış gün aranan bir hastadır.

### Ay eklemek takvim ayıdır, otuz gün değil

31 Ocak'ta ameliyat olan hastanın 1. ay kontrolü **28 Şubat**'tır — 3 Mart değil, ki hiç
düşünülmediğinde bir tarihe ay eklemek oraya götürür. Altı ayda bu kayma günlere çıkar.
Kısa ayın sonuna sıkıştırılıyor; testi var.

### Hatırlatma sabah onda, ameliyat saatinde değil

23:30'da ameliyat olan bir hasta, aksi hâlde bir yıl boyunca her kontrol için **gece yarısına
yakın** hatırlatma alırdı. Tarihler kliniğin yerel saatiyle 10:00'a yerleştiriliyor.

### Yaz saati

Kışın üretilen bir takvim, yaz aylarındaki kontrolde bir saat kaymamalı — hem de sessizce ve
yalnız yılın yarısında. Yerel saat sabit bir offset eklenerek değil, hedef yerel saati veren
UTC anı **aranarak** bulunuyor.

## Ertelenen Ameliyat

Bir ameliyatın **tek** takvimi var. Yeni tarihle üretmek eskisini değiştiriyor, yanına
eklemiyor: iki takvim, klinisyene hangisinin gerçek olduğunu söylemeyen iki takvimdir.

**Hastanın gittiği kontroller korunuyor.** Yapılmış bir ziyaretin üstüne yeniden üretmek,
hastadan zaten yaptığı bir şey için tekrar gelmesini istemek olurdu.

## Kaçırıldı Demek İçin Üç Gün

Pazartesi kontrolüne çarşamba gelen hasta onu kaçırmamıştır. Bir günlük eşik, kliniğin
inanmayı bıraktığı bir "kaçıranlar" listesi üretir. Üç gün geçtikten sonra `MISSED`.

## Durum Geçişleri Kimin Elinde

Klinisyen bir kontrolü **yapıldı / atlandı / kaçırıldı** yapabiliyor. `PENDING` ve `NOTIFIED`
zamanlayıcıya ait: bir milestone'u "henüz haber verilmedi"ye geri almak, hastaya zaten
hatırlatılmış bir ziyaret için yeniden bildirim göndermek olurdu.

Hesabı henüz olmayan hastanın milestone'u da ilerletiliyor — `PENDING` bırakılsaydı süpürme
onu bir yıl boyunca her saat yeniden ele alırdı.

## Bildirim Kararı Buranın Değil

Zamanlayıcı bildirimi **dispatch ediyor**; push mu SMS mi olacağı, sessiz saatlerin
bekletip bekletmeyeceği bildirim katmanının kararı ([BILDIRIMLER](BILDIRIMLER.md)). Süpürme
saatlik: milestone bir tarihtir, 10:00'da ya da 10:45'te gelen hatırlatma aynı hatırlatmadır.

## İstemcide

Ekran **sıradaki kontrolü** en üstte ve büyük gösteriyor. Hastanın bu ekranı açma sebebi tek
bir soru ve ortasına kadar okunması gereken bir liste, yanlış okunan listedir.

Bir ziyaret işaretlendiğinde satır yerel olarak çevrilmiyor, **sunucunun döndürdüğüyle**
değiştiriliyor: klinik kaydı başka şey derken "yapıldı" görünen bir kontrol, kimsenin
aranmayana kadar fark etmediği türden bir uyuşmazlıktır.
