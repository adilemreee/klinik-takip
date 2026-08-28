# Giriş ve Onboarding Akışı

Şartname §2, §7, T2.3. Kod: [`ios/Sources/KlinikAuthFeature/`](../ios/Sources/KlinikAuthFeature/) ·
[`android/feature/auth/`](../android/feature/auth/)

## Karmaşıklık Ekranlarda Değil, Dallanmada

```
parola gir
   ├─ OK ────────────────────────────────► giriş yapıldı
   ├─ MFA_REQUIRED ──► kod gir ──────────► giriş yapıldı
   ├─ MFA_SETUP_REQUIRED ──► sır göster ──► kodu onayla ──► kod gir ──► giriş yapıldı
   ├─ ACCOUNT_LOCKED ─────────────────────► "bir süre sonra tekrar deneyin"
   └─ INVALID_CREDENTIALS ────────────────► "e-posta veya parola hatalı"
```

Bu yüzden akış her iki platformda da **görünümsüz test edilebilen bir durum makinesi**
olarak yazıldı — personelin ikinci faktörü olmadığında girdiği dal dahil.

## Adım Tek Bir Değer

`isLoading`, `needsCode`, `needsSetup` gibi ayrı bayraklar **olamayacak kombinasyonlara**
izin verir ve her ekran bunlara karşı savunma yapmak zorunda kalır. Adım tek bir değer
(`AuthStep`), dolayısıyla her durum için tam olarak bir ekran var.

## Kolayca Yanlış Yapılan İki Şey

### Kayıt onayı giriş yapmaz

Backend bir TOTP kodunu **iki kez kabul etmiyor** (T1.2'deki tekrar koruması). Kayıt
onayında kullanılan kod, hemen ardından gelen girişte çalışmaz.

Akış bu yüzden onaydan sonra doğrudan oturuma değil, **kod adımına** geçiyor. Aksini
varsayan bir uygulama onboarding'in son adımında kırılırdı — ve bu, kullanıcının en çok
vazgeçtiği noktadır.

### Kimlik bilgileri iki adım arasında saklanıyor

İkinci faktör için parolayı yeniden yazdırmak küçük bir eziyet ve destek çağrısı üretir.
Model bunları adımlar arasında tutuyor; test doğruluyor.

## Kapsamlı Kurulum Token'ı

2FA kaydı, oturum token'ıyla değil, girişten dönen **kapsamı `mfa_setup` olan** token'la
yapılıyor (T1.2). Bunun için istemciye açık bearer geçersiz kılma eklendi.

Önemli sonuç: **bu token'da 401 nihaidir.** Yenilenecek bir oturum yok — 401, beş
dakikanın dolduğu anlamına gelir. İstemci bu durumda yenileme denemiyor.

## Kilitlenme Yazım Hatası Değildir

`ACCOUNT_LOCKED` ayrı bir bayrak taşıyor, çünkü ekranın söyleyeceği şey farklı: "parola
hatalı" değil, "bir süre sonra tekrar deneyin". Aynı mesajı tekrarlamak, kullanıcıyı
denemeye devam etmeye ve kilidi uzatmaya iter.

Buton yalnız **boş alan** için pasif. Kilitli bir hesapta bile gönderim yapılıyor, ki
kullanıcı sebebi görebilsin — sebepsiz ölü bir buton daha kötüdür.

## Erişilebilirlik (§7)

- Her dokunulabilir öğe en az **44pt/dp**
- Etiketler alanın **üstünde**, içinde değil — placeholder, yazmaya başlandığı anda kaybolur
  ve geri dönen kullanıcı tam o an ne doldurduğunu kontrol etmek ister
- Ekran başına tek başlık (VoiceOver/TalkBack rotor navigasyonu için)
- Hata bandı renk **ve** ikon taşıyor
- 2FA sırrı hem taranabilir hem **metin olarak** gösteriliyor: tarama yeterince sık
  başarısız olur (çatlak ekran, ödünç telefon) ve tek yol bırakmak insanları onboarding'de
  mahsur bırakır

## Test Kapsamı

Her iki platformda **aynı 13 senaryo**:

| Senaryo |
|---|
| 2FA gerekmediğinde giriş |
| 2FA varsa kod isteme |
| Kimlik bilgilerinin adımlar arası korunması |
| Personel için kayıt akışının başlaması, oturum verilmemesi |
| Kaydın kapsamlı token ile yapılması |
| Onaydan sonra kod adımına geçiş (doğrudan girişe değil) |
| Tam onboarding dizisi uçtan uca |
| Yanlış parola, adım korunarak |
| Kilitli hesabın ayrı işaretlenmesi |
| Yanlış kod, kod adımı korunarak |
| Çevrimdışı mesajı |
| Sonraki denemede eski hatanın temizlenmesi |
| Kimlik bilgisi olmadan gelen kodun başa döndürmesi |

## Doğrulama

| Katman | Nerede |
|---|---|
| Akış modeli (iOS) | `swift test` — yerelde ve CI'da |
| Akış modeli (Android) | `./gradlew test` — yerelde ve CI'da |
| SwiftUI ekranları | macOS'ta derleniyor, yerelde ve CI'da |
| Compose ekranları | **Yalnız CI** — Android SDK gerektiriyor |
