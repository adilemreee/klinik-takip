# Mesajlaşma ve Erişim Penceresi

Şartname §M3, T4.1. Kod: [`backend/src/messaging/`](../backend/src/messaging/) ·
[`ios/Sources/KlinikMessagingFeature/`](../ios/Sources/KlinikMessagingFeature/) ·
[`android/feature/messaging/`](../android/feature/messaging/)

## Erişim Penceresi

Doktor saat aralığı tanımlıyor (ör. Pzt–Cum 18:00–20:00). Pencere dışında hastanın mesajı
**iletilmiyor, sıraya alınıyor** ve ne zaman gideceği söyleniyor.

Amaç hastayı susturmak değil: gece 3'te gelip sabah 9'da yanıtlanan bir mesaj **altı saat
yok sayılmış** görünür; "18:00'de iletilecek" diyen bir mesaj görünmez.

Ekran bunu **hasta yazmadan önce** söylüyor. Gönderdikten sonra söylemek, "sıraya alındı"nın
"kayboldu" gibi hissedilmesinin yoludur.

### Kararlar

- **Personel hiç sıraya alınmıyor.** Pencere, kliniğin ne zaman *yanıtladığını* yönetiyor, ne
  zaman konuşabileceğini değil.
- **Sıradaki mesaj konuşmayı yukarı taşımıyor.** Henüz söylenmemiş bir şey için klinisyenin
  listesini kıpırdatmak, hiçbir şey hakkında bildirim olurdu.
- **Sıradaki mesajı yalnız yazanı görüyor.** Beklediğini görmesi gerekiyor; başkasının değil.
- **Hiç pencere tanımlanmamışsa klinik açık.** Saat tanımlamamış bir klinik mesajların
  tutulmasını istememiştir; kapalı varsaymak, özelliğin yayına girdiği gün her mesajı sessizce
  yutardı. Bütün pencereleri kapatmak da aynı şey: "kapalı" talimatı değil, **kaldırılmış**
  program.
- **Okunamayan bir pencere atlanıyor.** Her şeyi kapsıyor saymak kliniği kazara açar, hiçbir
  şeyi kapsamıyor saymak kapatır; tek bozuk satır bunu tek başına yapmamalı.
- **Gece yarısını aşan pencere** (22:00–02:00) iki güne ait ve öyle ele alınıyor.

Saat hesabı `Intl` üzerinden yapılıyor, sabit bir offset eklenerek değil: offset sabit değil ve
yılda iki kez bir saat kayan bir pencere, kimsenin güvenmediği penceredir.

### Serbest bırakma bir iş

Kuyruk kendiliğinden bırakmaz. Dakikada bir çalışan bir kuyruk işi süresi dolmuş mesajları
salıyor. Olmasaydı gece 3'te yazılan mesaj, biri başka bir mesaj gönderene kadar görünmez
kalırdı. Sıklık dakikalık, çünkü hastaya **saat verildi**: 18:00 denen bir mesajın 18:55'te
gitmesi, sıraya almanın verdiği tek güvenceyi bozar.

## WebSocket Kendi Yetkisini Taşımıyor

Soket teslimatı ve "yazıyor" göstergesini taşıyor. Ama **aynı token, aynı kapsam kontrolü, aynı
sessizlik**: farklı yetkilendiren bir kanal, REST tarafının uyguladığı her kuralın etrafından
dolaşmanın yolu olurdu.

Odaya katılmadan önce kapsam kontrol ediliyor. Olmasaydı bir soket kimlik tahmin ederek herhangi
bir odaya girip **başka bir hastanın mesajlarını canlı** alabilirdi — REST kapsam kontrolünün
engellediği sızıntının sessiz hâli.

Token el sıkışmasından alınıyor, **query string'den değil**: URL vekil sunucu loglarına ve
tarayıcı geçmişine girer, oradaki bir erişim token'ı ihtiyacı olan bağlantıdan uzun yaşar.

### Mesaj REST ile gönderiliyor, soketle duyuruluyor

Gönderim sırasında kopan bir soket, istemciyi mesajın var olup olmadığından emin olamaz hâlde
bırakır. Bir POST ya kimlik döner ya dönmez.

Gönderen kendi mesajını **iki kez** alıyor — POST'tan ve soketten. İki istemci de kimliğe göre
yerine koyuyor; ikisini birden gösteren bir sohbet, kimsenin güvenmediği sohbettir.

"Yazıyor" göstergesi yayınlanıyor ve **saklanmıyor**: birkaç saniye doğru sonra değil, ve kimin
ne zaman yazdığının kaydı bir özellik değil gözetimdir.

## Okundu Bilgisi Toplu

Bir konuşmayı açan kişi ekrandakileri okumuştur. İstemciden tek tek bildirmesini istemek,
gördüğünden sapan bir sayaç davet eder.

`sender_id != ben` karşılaştırması **NULL gönderen için NULL** döner ve SQL bunu eşleşmedi
sayar; klinik ve sistem mesajları hiçbir zaman okundu işaretlenmezdi — yani hastanın en çok
görmesi gereken mesajlar. Sorgu NULL durumunu açıkça ele alıyor.

## Kalan (Faz 5'e bağlı)

M3 iki şey daha istiyor ve ikisi de AI katmanına bağlı (T5.1 `AIProvider` soyutlaması):

- **Sesli mesaj transkripti.** Ses eki yükleniyor ve saklanıyor; `transcript` alanı şemada
  hazır ve boş.
- **Otomatik dil algılama ve çift yönlü çeviri.** `original_language`, `translated_text`,
  `translated_to` alanları hazır; orijinal metin her zaman saklanıyor ve görülebiliyor —
  çeviri geldiğinde de öyle kalacak.
