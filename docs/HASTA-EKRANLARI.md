# Hasta Listesi ve Dosyası (Personel)

Şartname §6 M2, §7, §9, T2.4. Kod: [`ios/Sources/KlinikPatientsFeature/`](../ios/Sources/KlinikPatientsFeature/) ·
[`android/feature/patients/`](../android/feature/patients/)

## Aranabilir Bir Listenin Zor Kısmı Yerleşim Değil

Ağ, yanıtların **gönderim sırasıyla döneceğini garanti etmez.**

"Zim" yazıp ardından "Zimm" yazmak iki istek gönderir. Koruma olmadan kısa sorgunun daha
yavaş gelen yanıtı en son yerleşir ve kullanıcı, artık sormadığı bir sorunun sonuçlarına
bakar — üstelik bunu fark etmesi zordur, çünkü ekranda makul görünen isimler vardır.

Her iki modelde de her arama bir **nesil (generation)** numarasıyla damgalanıyor; eskimiş
bir nesle ait yanıt uygulanmıyor. Aynı koruma, kullanıcı yeni bir aramaya başladıktan
sonra gelen **sayfayı** da düşürüyor — o sayfa artık var olmayan bir listeye ait.

Test bunu kurgulayarak doğruluyor: erken gönderilen istek bilerek en son bitiriliyor.

## Boş, Hatalı ve Çevrimdışı Ayrı Durumlar

§7 üçünün de tasarlanmasını istiyor, çünkü ekranın söyleyeceği şey farklı:

| Durum | Ne der | Ne önerir |
|---|---|---|
| `empty` | "Henüz hasta yok" | Aramayı değiştir |
| `failed` (çevrimdışı) | "İnternet bağlantısı yok" | Bekle, tekrar dene |
| `failed` (sunucu) | "Bir sorun oluştu" | Tekrar dene |

Boş sonucu hata olarak göstermek, kullanıcıyı çalışan bir sistemde arıza aramaya iter.

**Sonraki sayfa başarısız olursa ekrandakiler silinmiyor.** Üçüncü sayfa gelmedi diye ilk
ikisini kaybetmek, elimizdekini göstermekten kötüdür.

## Testler Sırasında Çıkan Gerçek Hata

Oturum düştüğünde kullanıcıya **"E-posta veya parola hatalı"** deniyordu: çıplak bir 401,
yanlış kimlik bilgisiyle aynı mesaja eşleniyordu.

Bu, vardiyanın ortasındaki bir hemşireyi **sorunsuz olan parolasını değiştirmeye** yönlendirir.

Giriş ekranı dışında 401 artık "oturumunuz sona erdi" anlamına geliyor; yanlış parola zaten
backend'den kendi koduyla (`INVALID_CREDENTIALS`) geliyor, dolayısıyla giriş ekranı doğru
mesajı göstermeye devam ediyor.

Android tarafında eşleme **tek bir paylaşılan yere** taşındı (`ErrorMessages.kt`), böylece
iki ekran aynı hatayı farklı anlatamıyor.

## Kapsam Dışı = Bulunamadı

Backend, kapsam dışı bir hastaya da var olmayan bir hastaya da 404 döndürüyor — hesabı olan
birinin "şu kişi burada hasta mı" sorusunu deneyerek yanıtlamasını engellemek için.

İstemci bunu **bozmuyor**: "erişiminiz yok" demek kaydın var olduğunu doğrulardı. Ekran
her iki durumda da aynı mesajı gösteriyor.

## Sayfalama

Cursor tabanlı (§9). Sonraki sayfa, footer görünür olduğunda çekiliyor — kullanıcıya buton
aratmadan. `loadMore` bir kaydırma dinleyicisinden tekrar tekrar çağrılabilir: yükleme
sürerken veya son sayfaya gelindiğinde hiçbir şey yapmıyor.

## Erişilebilirlik

- Satırlar tek parça olarak seslendiriliyor (üç ayrı parça yerine)
- Her dokunulabilir öğe en az 44pt/dp
- Detay ekranında ekran başına tek başlık
- Boş ve hata durumları ikon + metin

## Test Kapsamı

Her iki platformda **aynı 13 senaryo**, artı oturum sonlanması:

| Senaryo |
|---|
| İlk sayfanın yüklenmesi |
| Boş sonucun hata değil "boş" sayılması |
| Sonraki sayfanın tekrarsız eklenmesi |
| Son sayfada `loadMore`'un hiçbir şey yapmaması |
| **Eski sorgunun geç gelen yanıtının yeniyi ezmemesi** |
| **Yeni aramadan sonra gelen sayfanın düşürülmesi** |
| Çevrimdışı mesajı |
| Sayfa hatasında yüklenmişlerin korunması |
| Oturum sonlanmasının yanlış parola gibi gösterilmemesi |
| Tekrar denemenin mevcut aramayı yinelemesi |
| Detayın yüklenmesi |
| Kapsam dışının varlığı ele vermeden "bulunamadı" olması |
| Diğer hataların mesajla bildirilmesi |
