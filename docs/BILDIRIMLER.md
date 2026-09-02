# Bildirim Sistemi

Şartname §M6, T4.2. Kod: [`backend/src/notifications/`](../backend/src/notifications/) ·
[`ios/Sources/KlinikNotificationsFeature/`](../ios/Sources/KlinikNotificationsFeature/) ·
[`android/feature/notifications/`](../android/feature/notifications/)

## Metin Sunucuda, Alıcının Dilinde Üretiliyor

Bildirim metni **saklanmadan önce** hastanın diline göre render ediliyor. Sonradan çevirmek,
saklanan satırla iletilen mesajın farklı olabilmesi demek — ve bir SMS'in metnini yerelleştirecek
bir istemcisi zaten yok.

Bilinmeyen bir dil için Türkçeye düşülüyor; anahtara düşmek kilit ekranına **`lab.critical`**
yazmak olurdu.

## Yedek Zinciri Gerçekten Zincir

Başarısız push, sonraki kanalda **ayrı bir kayıt** oluyor ve yerini aldığı denemeye
bağlanıyor. Tek bir "sonunda iletildi" satırına çökmek, sonradan neyin denendiğini ve her
denemenin neden durduğunu görmeyi imkânsız kılardı.

Zincir bildirim türüne bağlı: kritik tahlil değeri push → SMS → e-posta, yeni mesaj yalnız
push. Her türün "ulaşamazsa ne kadar ısrar edilir" cevabı farklı.

### Kapatılan kanala düşülmüyor

Birinin kapattığı kanal yedek değildir. Ona düşmek, "SMS istemiyorum"u **"SMS, ama yalnız
push başarısız olunca"** hâline getirirdi.

## Sessiz Saatler Erteliyor, İptal Etmiyor

Rahatsız etmemek için düşürülen bir bildirim, hastanın var olduğunu hiç öğrenmediği bildirimdir.
Sessiz saatlerde rutin bildirim **bekletiliyor** ve saat bitince gidiyor.

**Acil olanlar geçiyor.** Yalnız gecikmesi klinik olarak önemli olanlar — kritik tahlil değeri
gibi. Gerisi bekliyor: rutin hatırlatma için hastayı uyandıran bir klinik, ona bildirimleri
kapatmayı öğretir, sonra önemli olan da ulaşmaz.

Yarım aralık (yalnız başlangıç ya da yalnız bitiş) sessiz saat sayılmıyor: yarım doldurulmuş
bir formun gücüyle birinin bildirimlerini susturmak olurdu. Okunamayan aralık da sessiz
sayılmıyor — iki hata eşit değil: gitmemesi gereken bir bildirimi göndermek rahatsızlıktır,
gitmesi gerekeni tutmak sonucunu hiç duymayan bir hastadır.

## Tercih Yoksa Açık

Bu ekranı hiç açmamış bir hasta yine de tahlilinin hazır olduğunu duyuyor. Yalnız `false`
yazan bir satır susturuyor. Aynı kural hem sunucuda hem iki istemcide; ayrışsalar anahtar bir
şey gösterir, klinik başka bir şey yapardı.

## Token Son Kaydedene Ait

Aynı push token'ı ikinci bir kullanıcı kaydederse sahiplik ona geçiyor. Başkasına verilen bir
telefon ya da token'ı yeniden kullanan bir kurulum, **bir kişinin klinik bildirimlerini
başkasına** iletmeye devam etmemeli.

Platform "bu token ölü" derse token pasifleştiriliyor.

## Sağlayıcılar Henüz Yapılandırılmadı — ve Başarı Uydurmuyorlar

APNs, FCM, SMS ağ geçidi ve SMTP için kimlik bilgileri bu kurulumda yok. Yerlerindeki gönderici
**başarısızlık bildiriyor**, sahte başarı değil.

Bu bilinçli: başarı uyduran bir taslak, yedek zincirinin hiç çalışmamasına, kayıtta her şeyin
"gönderildi" görünmesine ve sorunun ilk belirtisinin **"bana kimse haber vermedi" diyen bir
hasta** olmasına yol açardı. Şu hâliyle zincir üretimdeki gibi davranıyor ve her deneme kayda
geçiyor.

Kimlik bilgileri geldiğinde tek yapılacak, `NotificationSender` arayüzünün gerçek
uygulamalarını `NotificationsModule`'da kaydetmek.

## Kalan

- **Cihazda bildirimin görünmesi** — APNs/FCM entegrasyonu, zengin bildirim eylemleri
  (T4.3), iOS Notification Content/Action Extension ve Android RemoteInput. Gerçek cihaz
  ve sağlayıcı hesabı gerektiriyor; sunucu tarafı (token, tercih, gönderim, eylem tanımları)
  hazır.
- **WhatsApp Business API** — şartnamede opsiyonel; kanal enum'da var, sağlayıcısı yok.
