# Uygulama Kabuğu

Şartname §2, §7, §8, T2.3–T2.5. Kod: [`ios/App/`](../ios/App/) ·
[`ios/Sources/KlinikApp/`](../ios/Sources/KlinikApp/) ·
[`android/app/`](../android/app/) · [`android/core/shell/`](../android/core/shell/) ·
[`backend/src/me/`](../backend/src/me/)

T2.3–T2.5 ekranları vardı ama **kurulup açılabilen bir uygulama yoktu**: iOS'ta bir Swift
paketi, Android'de Gradle modülleri. Bu belge onları bir araya getiren kabuğu anlatıyor.

## Tek Bir Dallanma Noktası

Kabuğun tüm karar verme işi iki şeyin saf bir fonksiyonu: **oturum var mı, kimin?**

| | iOS | Android |
|---|---|---|
| Karar | `RootRoute.route(for:)` | `Root.route()` (`core:shell`) |
| Test | 11 test | 12 test |
| UI çerçevesi | yok | yok |

Ayrı ve saf tutulmasının sebebi: yanlış olduğunda **yanlış kişiye yanlış şeyi gösterir**.
Bir hasta asla personel hasta listesine düşmemeli; oturumu olmayan biri giriş ekranından
başka hiçbir yere gitmemeli. İkisi de yanlışlıkla doğru olmaya bir `if` uzaklıkta.

Elle mutasyon testi: **10/10 mutant öldü** (rol adı sabitlenmesi, `isStaff` ters çevrilmesi,
hasta dosya kimliğinin düşürülmesi, kontrol sırasının değiştirilmesi dahil).

### Üç kararı ayrıca söylemek gerekiyor

**Kimlik çağrısı havadayken rota `nil`.** Giriş ekranı *değil*. Tahmin etmek, zaten girmiş
birine **her açılışta** giriş ekranını çaktırır.

**Süresi dolmuş oturumun kendi ekranı var.** "Bir süredir yoktunuz" ile "hesabınız gitti"
aynı görünür ve yalnız biri doğrudur.

**Refakatçiye ekran olmadığı söyleniyor.** §2 refakatçiye *başkasının* dosyasına sınırlı
erişim veriyor ve bu uygulamada henüz o ekran yok. Onu kendisinin olmayan bir hasta ana
ekranına yönlendirmek, durumu söylemekten kötü olurdu — token'da bir hasta kimliği taşısa
bile, çünkü o kimlik yardım ettiği dosya, sahip olduğu dosya değil.

## Rol Sunucudan Geliyor, Token'dan Değil

`GET /me/identity` — kim giriş yapmış, adı ne, dosyası var mı, personel mi.

Access token'ı istemcide çözüp rolü oradan okumak daha az çağrı olurdu. Ama **rol bir
kişinin ne göreceğine karar veriyor**, ve o kararı JWT'den okumak onu *doğrulanamayan* ve
*geri alınamayan* bir yere koyar. Sunucu ayrıca `isStaff`'ı ayrıca döndürüyor: rol adıyla
çelişirse sunucu kazanır, çünkü API'nin neye izin vereceğine zaten o karar veriyor.

Test: 6 entegrasyon testi.

## Android'in Hiç Ağ Katmanı Yokmuş

`HttpTransport` bir arayüzdü ve **tek gerçeklemesi yoktu** — üstündeki her katman sahtelere
karşı test edilmişti ve istemci bugüne dek hiçbir istek yapmamıştı.

`JdkHttpTransport` o eksik parça. OkHttp veya Ktor yerine JDK'nın kendi istemcisi:
hastalara giden bir uygulamaya bağımlılık eklemiyor ve — daha faydalısı — **Android SDK'sı
olmayan bir modülde kalıyor**, yani dizüstünde derleniyor ve gerçek bir sokete karşı gerçek
bir sunucuyla test ediliyor (`com.sun.net.httpserver`, JDK'nın içinde).

Neyi garanti ettiği:

- **4xx/5xx gövdesi korunuyor.** `inputStream` bir 4xx'te fırlatır; sunucunun "telefon
  geçersiz" açıklaması genel bir hataya dönüşürdü.
- **Yönlendirme izlenmiyor, döndürülüyor.** Bu API'den gelen bir 30x yanlış yapılandırmadır;
  sessizce izlemek `Authorization` başlığını hiç göndermek istemediğimiz bir sunucuya
  tekrar oynatır.
- **Multipart akıtılıyor ve kapatılıyor.** 20 MB'lık bir belge tek tampona alınmıyor
  (`Transfer-Encoding: chunked` bunun gözlemlenebilir sonucu ve test onu doğruluyor), ve
  gövde kapanış sınırıyla bitiyor — bitmeyen bir multipart'ı katı sunucu reddeder, hoşgörülü
  sunucu gelmeyecek bir parçayı bekler.
- **Dosya adı kaçırılıyor.** Adı hasta koydu: tırnak veya satır sonu içeren bir ad,
  kaçırılmazsa başlığı erken kapatır ve gerisi başlık olarak okunur.
- **Çevrimdışı ile zaman aşımı ayrı.** Arayüz biri için çevrimdışı göstergesi (M15), diğeri
  için "tekrar dene" sunuyor; karıştırmak sinyali olmayan birine kliniğin çöktüğünü söyler.

`HttpTokenRefresher` doğrudan taşımaya gidiyor: istemci her isteğe geçerli bir token
takıyor, ve **geçerli bir token elde etmek** bu çağrının işi — istemciden geçirmek bir döngü.

Elle mutasyon testi: **15/15**. Dördü ilk turda hayatta kaldı (tekrar eden başlık, kapanış
sınırı, akıtmanın kaybı, başarı aralığının genişlemesi) ve dördü de gerçek test boşluğuydu,
eşdeğer mutant değil.

### Başlıklar tel sırasında okunuyor

`headerFields` haritası **sırasız** olarak belgelenmiş, ve JDK tekrar eden değerleri
en-yeni-önce döndürüyor — Android'inki (OkHttp) böyle yapmak zorunda değil. İndeksli
erişimciler başlıkları geldikleri sırayla yürüyor, dolayısıyla "tekrar eden başlıkta son
değer kazanır" **bu kodun bir özelliği**, altındaki HTTP yığınının değil.

## Token'lar Diskte Şifreli

Bir refresh token, klinik bir hesap için canlı bir oturum. Android'de anahtar keystore'da
(cihaz destekliyorsa donanımda) tutuluyor; diske yazılan şifreli metin. Anahtar
keystore'dan **okunamıyor**, yani bir yedek, bir `adb pull` veya tercihleri okuyan başka bir
uygulama kullanamayacağı baytları alıyor.

`EncryptedSharedPreferences` aynı işi yapıyor ama kullanımdan kaldırıldı ve yerine geleni
kararlı değil; bu, geri çekilmekte olan bir şeye bağımlı olmaktansa sahiplenilecek kadar
küçük bir yüzey.

**Kilit ekranı bilerek istenmiyor.** Arka plan senkronizasyonu (M15) telefon cepteyken bir
token yenilemek zorunda; kullanıcı gerektiren bir anahtar, kuyruğu bir sonraki kilit açmaya
kadar takılı bırakırdı — kayıtlar zaten cihazdayken.

Kullanılamaz hâle gelmiş bir anahtar (cihaz geri yükleme, güvenli donanımın sıfırlanması)
oturumu **temizleyip yeniden giriş istiyor**; saklanan baytlar bir daha asla okunamaz ve
her açılışta çökmekten çok daha iyisi budur.

## Hostname'ler Bu Depoda Yok

Depo herkese açık. İki istemci de temel adresi **izlenmeyen** bir yerel dosyadan okuyor:

| | Dosya | Örnek |
|---|---|---|
| Android | `android/local.properties` | `local.properties.example` |
| iOS | `ios/Config/Local.xcconfig` | `Local.xcconfig.example` |

Dosya yoksa yapılandırma `https://api.invalid` — RFC 2606 ile ayrılmış, **hiç çözülmeyen**
bir ad. Yapılandırılmamış bir yapı, cevap veren her neyse ona gitmek yerine görünür şekilde
başarısız oluyor; iOS bunu açılışta yakalayıp ne yapılacağını söyleyerek duruyor.

Gerçek adresler `docs/OPERASYON-LOCAL.md` içinde (o da izlenmiyor).

## Dizeler Üretilen Bir Eşlemeden Çözülüyor

Modeller noktalı anahtarlar üretiyor (`error.timedOut`), çünkü katalog iOS ile paylaşılıyor.
Android'de bunu bir dizeye çevirmenin bariz yolu `Resources.getIdentifier` — ve **yanlış
olanı**: paket adı istiyor, `applicationIdSuffix` taşıyan bir yapının uygulama kimliği ise
kaynak paketi değil. Yani her anahtar sessizce hiçbir şeye çözülür ve **tam da test eden
kişiler** ham anahtarları okur. Kaynak küçültme de onu bozar; Android zaten "önerilmez"
diye işaretlemiş.

`design/scripts/generate-strings.mjs` artık XML'in yanında `klinikStringIds`'i de üretiyor:
aynı katalog, noktalı anahtardan gerçek kaynak kimliğine **derlenmiş** bir eşleme. Arkasında
dize olmayan bir anahtar artık bir derleme hatası, bir hastanın okuduğu bir şey değil.

`UserRole.stringKey` de Android kaynak adlandırmasını değil kataloğu izliyor — `role.DOCTOR`,
iOS'un zaten okuduğu anahtar.

## Doğrulama

| | Nerede |
|---|---|
| Yönlendirme (iOS 11 + Android 12 test) | Yerelde ve CI'da |
| Taşıma katmanı, yenileyici, dize kataloğu | Yerelde ve CI'da (SDK gerekmiyor) |
| APK derlemesi (debug + release), `:app` testleri | Yalnız CI'da — bu makinede Android SDK yok |
| iOS uygulaması simülatörde açılıyor, Türkçe | Elle, iPhone 17 Pro |
| Giriş → token → `/me/identity` → rota | `LiveSmokeTests`, opt-in, gerçek sunucuya karşı |

## Henüz Burada Olmayanlar

- **Uygulama simgesi.** Kliniğin kendi markası olmalı; `KLINIKTEN-ISTENENLER.md`'de bekleyen
  maddelerden biri. Yer tutucu bir logo göndermek hiç göndermemekten kötü.
- **Ekranlar arası gezinme.** Kabuk beş birincil eylemi ve hasta listesini bağlıyor; tek tek
  özellik ekranlarına geçiş T2.6 sonrası işi.
- **Sürüm imzalama.** Depoda bir release keystore, klonlayabilen herkese yayımlanmış bir
  imzalama anahtarıdır.
