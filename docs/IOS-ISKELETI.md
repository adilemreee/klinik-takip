# iOS İstemcisi

Şartname §3.2, §7. Kod: [`ios/`](../ios/)

## Xcode Projesi Değil, Swift Paketi

Modüller bir Swift paketi olarak duruyor; böylece `swift build` ve `swift test` ile
**komut satırından doğrulanabiliyorlar** — CI'da kanıtlanabilir olmalarının sebebi bu.
Bir Xcode projesi aynı şeyleri kanıtlamak için simülatör isterdi.

| Modül | İçerik |
|---|---|
| `KlinikDesign` | `design/tokens.json`'dan üretilen tasarım tokenları |
| `KlinikCore` | Oturum, Keychain, hata modeli, yerelleştirme |
| `KlinikAPI` | Ağ katmanı, kimlik doğrulama çağrıları |

Uygulama hedefi (SwiftUI ekranları) T2.3'te geliyor.

## Tasarım Tokenları İki Platformda Ortak

`design/tokens.json` tek kaynak; Swift ve Kotlin **üretiliyor**.

> Bir dokümanı paylaşıp her platformun onu elle kopyalaması paylaşmak değildir —
> ikisi bir sürüm içinde birbirinden ayrılır.

CI hem yeniden üretip farkı kontrol ediyor, hem de **WCAG kontrast oranlarını hesaplıyor**.
Palet 30 renk çiftinde de hedefi geçiyor (açık ve koyu tema). Erişilebilir *görünen* bir
palet, olağan başarısızlık biçimidir; bu yüzden ölçülüyor.

Her klinik durum bir renk **ve** bir ikon taşıyor — kritik bilgi asla yalnızca renkle
anlatılmıyor (§7).

## Eşzamanlı Yenileme: Sessiz Bir Çıkış Hatası

Backend refresh token'ları **tek kullanımlık** tutuyor ve tüketilmiş bir token tekrar
sunulursa **tüm cihaz oturumunu iptal ediyor** — çalınmaya karşı savunması bu.

Bunun istemci tarafındaki sonucu ince: **paralel iki yenileme kullanıcıyı sistemden atar.**
İkinci çağrı, birincinin harcadığı token'ı tekrar sunar ve sunucu bunu hırsızlıktan ayırt
edemez. Sunucuda hiçbir şey bozuk değilken, yalnızca istemcinin davranışı yüzünden.

`SessionManager` bir `actor` ve süregelen bir yenileme varsa **yeni bir tane başlatmıyor**;
çağıranlar mevcut olana katılıyor. Test bunu 20 eşzamanlı çağıranla doğruluyor: tam olarak
bir yenileme.

Aynı sebeple `APIClient` 401'den sonra **yalnızca bir kez** yeniden deniyor. Döngü, zinciri
yakar.

## Keychain Erişilebilirliği

`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` bilinçli:

- `ThisDeviceOnly` → token şifreli yedeklere ve başka cihaza gitmiyor
- `AfterFirstUnlock` → telefon kilitliyken de okunabiliyor, ki ilaç hatırlatmaları ve
  acil durum akışı bunu gerektiriyor

## Tarih Biçimlendirme

`ISO8601DateFormatter` bir referans tipi ve `Sendable` değil; eşzamanlı isteklerde
paylaşmak Swift 6'nın doğrudan reddettiği bir veri yarışı. Değer tipi olan
`Date.ISO8601FormatStyle` kullanılıyor.

Backend kesirli saniye üretiyor, ama doğrudan bir veritabanı kolonundan gelen tarihler bazen
üretmiyor — **ikisi de kabul ediliyor**, eksik bir `.000` yüzünden tüm yanıt düşmesin.

## Yerelleştirme

Metinler `tr.lproj` ve `en.lproj` altında; kodda gömülü metin yok (§7). Temel dil
**Türkçe** — klinik personeli uygulamayı gün boyu kullanıyor ve farklı dillerdeki hastalar
buna düşüyor.

Testlerin koruduğu değişmez: **iki dilin anahtar kümesi birebir aynı.** Birinde olup
diğerinde olmayan bir anahtar, Türkçe bir ekranın ortasında beliren İngilizce metin ya da
hastaya gösterilen ham bir anahtar demektir.

Çevrilmemiş bir metin, boş yerine **kendi anahtarı** olarak görünüyor — sessizce yanlış dilde
görünmesindense fark edilir olması iyi.

## Hata Modeli

Sunucunun döndürdüğü makine okunur kodlar (`MFA_REQUIRED`, `ACCOUNT_LOCKED`, …) tiplere
çevriliyor; UI metin ayrıştırmıyor. İki durum ayrıca ayrı:

- **`offline`**, sunucu hatasından farklı — UI çevrimdışı durumu gösteriyor ve işi kuyruğa
  alıyor (§M15).
- **`notFound`**, kapsam dışı anlamına da geliyor. Backend ikisini bilinçli olarak
  ayırt edilemez kılıyor, dolayısıyla istemci de kullanıcıya kaydın var olduğunu söylemiyor.

## Test Kapsamı

| Dosya | Adet | Odak |
|---|---|---|
| `SessionManagerTests` | 9 | Eşzamanlı yenileme, süresi dolan oturum, kalıcılık |
| `APIClientTests` | 12 | 401 → tek yenileme → tek deneme, hata eşleme |
| `LocalizationTests` | 6 | İki dilin anahtar eşitliği, çevrilmemiş metin yok |
| `TokensTests` + `TokenParityTests` | 10 | Dokunma alanı, ikon zorunluluğu, JSON ile eşleşme |

`swift test` ile çalışır; CI'da macOS runner üzerinde.
