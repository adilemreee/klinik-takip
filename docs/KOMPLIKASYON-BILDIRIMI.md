# Komplikasyon Bildirimi

Şartname §M7, T3.6. Kod: [`backend/src/complications/`](../backend/src/complications/) ·
[`ios/Sources/KlinikComplicationsFeature/`](../ios/Sources/KlinikComplicationsFeature/) ·
[`android/feature/complications/`](../android/feature/complications/)

Hasta çeker → not ekler → doğrudan klinisyene düşer → **yanıt süresi ölçülür.**

## Acil Durum Butonu Değil

Bu, "yaramda bir şey ters görünüyor" akışı. Panik butonu (§M8, T4.5) ayrı ve farklı bir
eskalasyon zinciri var. İkisini karıştırmak, ya yara sorusunu alarma çevirir ya da gerçek
acili sıradan bir bildirim gibi gösterir.

Gecikme eşiği bu yüzden **iki saat**, iki dakika değil. Her yara sorusunu alarm saymak, bir
alarm listesinin okunmayı bırakmasının yoludur. Bir gün de değil: hastanın fotoğrafını çektiği
şey genellikle dünden beri endişelendiği şeydir.

## Yanıt Süresi Saklanıyor, Hesaplanmıyor

Şartname yanıt süresinin **ölçülmesini** istiyor. Kimsenin saklamadığı bir sayı, kimsenin
ölçmediği sayıdır. `reported_at` ve `acknowledged_at` kayıtta duruyor; aradaki fark yanıt
süresi.

### İlk yanıt bir kez yazılıyor

İkinci bir klinisyenin not eklemesi kliniği olduğundan **hızlı göstermemeli**. Yanıtlanmış bir
bildirimi tekrar yanıtlamak 400 dönüyor.

### Doğrudan kapatma da yanıt sayılıyor

Bir bildirimi okuyup tek adımda halleden klinisyen **yanıt vermiştir**. `resolve`, daha önce
yanıtlanmamış bir bildirimde `acknowledged_at`'i de damgalıyor. Boş bırakmak, o bildirimi
"hiç yanıtlanmadı" olarak kaydeder ve bu özelliğin üretmek için var olduğu **tek sayıyı
sessizce bozardı**.

## Fotoğraf Sahipliği Doğrulanıyor

`photoIds` ile gelen fotoğrafların aynı hastaya ait ve silinmemiş olduğu kontrol ediliyor.
Sahip olmadığı bir fotoğrafa atıfta bulunan bir bildirim, klinisyene ya **yanlış bir vücudu**
gösterir ya da hiçbir şey göstermez; ikisi de reddetmekten kötü.

### Testin yakaladığı gerçek hata

`photoIds` doğrulayıcısı `@IsUUID('4')` yazılmıştı. Bu projede kimlikler **UUIDv7** ve v4
kısıtı gerçek olan her kimliği reddediyor: fotoğraflı her bildirim 400 alıyordu. Depodaki
diğer bütün `@IsUUID()` kullanımları versiyonsuz; bu tek istisnaydı.

## Not Zorunlu

Fotoğraf var ama kelime yoksa, klinisyen **neye bakması istendiğini** tahmin etmek zorunda
kalır. Boş not 400 dönüyor.

## Sıra: En Uzun Bekleyen Üstte

Kuyruk klinik kapsam süzgecinden geçiyor — bir hemşire sorumlu olduğu hastaları görüyor,
kliniğin tüm vaka yükünü değil. Sıralama gelme zamanına göre değil **bekleme süresine** göre;
burada ikisi aynı şey ama sıralamanın ne için olduğunu söylüyor.

Yanıtlanmış bildirim ekrandan **düşmüyor**: kapatmak hâlâ klinisyenin işi ve yanıt verdiği anda
listeden çıkarmak onu tekrar aramaya gönderirdi.

## Hasta Yanıtı Görüyor

Bildirdiği şeye yanıt göremeyen hasta **aynı şeyi tekrar bildirir**. `/me/complications`
kliniğin cevabını düz biçimde gösteriyor; aynı endişenin üç kez gelmesini durduran şey bu.
