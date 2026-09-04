# Android İstemcisi

Şartname §3.2, §7. Kod: [`android/`](../android/)

## Mantık Android'e Bağlı Değil

| Modül | Tür | Nerede doğrulanıyor |
|---|---|---|
| `core:network` | Saf Kotlin/JVM | Yerelde ve CI'da — SDK gerektirmiyor |
| `core:shell` | Saf Kotlin/JVM | Yerelde ve CI'da — kim nereye gider kararı |
| `core:design` | Android kütüphanesi (Compose) | Yalnız CI'da |
| `:app` | Android uygulaması | Yalnız CI'da — [UYGULAMA-KABUGU](UYGULAMA-KABUGU.md) |

Oturum, ağ ve hata yönetimi hiçbir Android bağımlılığı taşımıyor; iOS istemcisinin
Xcode projesi yerine Swift paketi olmasının sebebiyle aynı sebep — **komut satırından
doğrulanabilir olmaları**.

`settings.gradle.kts`, Compose modüllerini yalnız Android SDK varken dahil ediyor.
SDK'sı olmayan bir makinede build tamamen kullanılamaz hâle gelmesin diye; CI'da SDK her
zaman var, dolayısıyla orada hiçbir şey sessizce atlanmıyor.

## Tek Kullanımlık Token, İki İstemci, Aynı Tuzak

Backend refresh token'ları tek kullanımlık tutuyor ve tüketilmiş bir token tekrar
sunulursa **tüm cihaz oturumunu iptal ediyor**. Paralel iki yenileme, sunucuda hiçbir şey
bozuk değilken kullanıcıyı sistemden atar.

Kotlin tarafında çözüm bir `Mutex` ve kilidin **içinde tekrar kontrol**: kuyrukta bekleyen
bir çağıran kilidi aldığında token'ı taze bulup onu döndürüyor, kendi yenilemesini
başlatmıyor. Test 20 eşzamanlı çağıranla doğruluyor — tam olarak bir yenileme.

### Bu task sırasında bulunan ikinci durum

401 sonrası yenilemede ilk yazdığım kod **zorlamalıydı**: uçuşta olan birkaç istek aynı
bayat token'la 401 alır ve her biri sırayla yenileme yapardı — ilki zaten sorunu çözmüş
olmasına rağmen. Her biri bir tek kullanımlık token daha harcar.

Artık başarısız isteğin **kullandığı token** geri veriliyor; saklanan token ondan
farklıysa, başkası çoktan düzeltmiş demektir ve yeni yenileme yapılmıyor.

Aynı düzeltme iOS'a da uygulandı — iki istemci aynı davranmalı.

## Metinler Tek Kaynaktan

Android string kaynakları iOS kataloglarından **üretiliyor**. İki katalogu ayrı ayrı
sürdürmek, bir tarafa eklenip diğerinde unutulan bir metin demek — ki bu, Türkçe bir
ekranda beliren İngilizce metin ya da hastaya gösterilen ham bir anahtar olarak çıkar.

Anahtar biçimi platforma göre farklı, çünkü Android kaynak adları nokta içeremez:
`auth.signIn` → `auth_sign_in`. Dönüşüm mekanik olduğu için iki küme özdeş olmasa da
**denk** kalıyor.

`design/scripts/check-strings.mjs` dört katalogu birden karşılaştırıyor ve CI'da çalışıyor.

## Sürüm Seçimleri

Başlangıçta 2024 sürümlerini (Kotlin 2.1, AGP 8.7) yazmıştım; Kotlin 2.1 makinedeki
JDK 26'yı tanımadığı için derleme `IllegalArgumentException: 26` ile düştü. Güncel
sürümlere geçildi:

| Bileşen | Sürüm |
|---|---|
| Kotlin | 2.4.10 |
| AGP | 9.3.2 |
| Coroutines | 1.11.0 |
| Gradle | 9.7.1 |

JDK, foojay çözümleyicisiyle **indiriliyor**; makinede hangi Java'nın kurulu olduğuna
bağlı kalınmıyor (burada 26, CI'da 17).

`allWarningsAsErrors` açık — Swift 6'nın eşzamanlılık katılığının Kotlin'deki karşılığı.

## Test Kapsamı

| Dosya | Adet | Odak |
|---|---|---|
| `SessionManagerTest` | 9 | Eşzamanlı yenileme, 401 yarışı, süresi dolan oturum |
| `ApiClientTest` | 11 | 401 → tek yenileme → tek deneme, hata eşleme, sıralı sorgu |

`./gradlew test` ile çalışır.
