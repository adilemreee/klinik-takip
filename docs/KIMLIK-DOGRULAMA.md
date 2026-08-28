# Kimlik Doğrulama ve Oturum Yönetimi

Şartname §2. Modül: [`backend/src/auth/`](../backend/src/auth/)

## Akış

```
davet (kod)  →  hesap oluştur  →  giriş  →  [2FA]  →  access + refresh token
                                    │
                                    └─ personelse ve 2FA yoksa:
                                       yalnız kurulum tokeni (5 dk, tek iş yapar)
```

Sistemde **self-signup yoktur**. Personeli doktor, hastayı koordinatör/hemşire davet eder.
İlk `SUPER_ADMIN` uygulamanın dışından, elle oluşturulur (aşağıya bakın).

## Alınan Kararlar ve Gerekçeleri

### Parolalar — Argon2id, 46 MiB bellek maliyeti
`@node-rs/argon2` seçildi; `argon2` paketi alpine'de kaynaktan derleme ister
(python3/make/g++), bu ise musl için hazır ikili sunuyor. Bellek maliyeti GPU ile
kırmayı pahalı yapan parametre olduğu için ağırlık orada.

**Minimum 12 karakter.** Kompozisyon kuralları bilinçli olarak hafif: sembol sınıfı
zorlamak insanları tahmin edilebilir ikamelere iter, gerçek entropi eklemez.
Parolanın kullanıcının kendi e-postasını veya adını içermesi reddedilir — bir klinikte
bunu bilen insan sayısı fazladır.

### Hesap sayımı (enumeration) engeli
Bilinmeyen bir hesap ile yanlış parola **aynı yanıtı** verir. Ayrıca hesap bulunamadığında
bile sahte bir Argon2 doğrulaması çalıştırılır, böylece yanıt süresi de aynı kalır.

> Bir klinikte "bu e-posta kayıtlı" bilgisi, adı geçen kişinin burada hasta olduğunu
> doğrular. Bu tek başına sağlık verisi sızıntısıdır.

Test ile korunuyor: `gives the same answer for an unknown account as for a wrong password`.

### Refresh token rotation + yeniden kullanım tespiti
Refresh token'lar **tek kullanımlıktır**. Tüketilmiş bir token tekrar sunulursa, token
çalınmış ve tekrar oynatılıyor da olabilir, meşru istemci hata yapıyor da olabilir —
**ayırt edemeyiz**. Güvenli yanıt, tüm oturum ailesini iptal etmektir. Daha azı hırsıza
çalışan bir oturum bırakır.

Token'ların yalnız SHA-256 karması saklanır. Argon2 gerekmez: bunlar kullanıcının seçtiği
düşük entropili sırlar değil, CSPRNG'den gelen 256 bitlik değerlerdir; yavaş bir KDF
yalnızca her yenilemeye gecikme ekler.

### Cihaz oturumları
Her giriş bir "aile" (family) başlatır. `/auth/sessions` cihazları listeler,
`DELETE /auth/sessions/:familyId` birini uzaktan kapatır — yalnız kendi oturumlarınızı.

**Guard, ailenin hâlâ aktif olduğunu her istekte kontrol eder.** Access token süresi
dolana kadar kriptografik olarak geçerli kalır; bu kontrol olmasaydı "bu cihazı çıkar"
15 dakika boyunca etkisiz olurdu — çalınmış bir telefonda fark eder.

### İki faktör (TOTP)
- **Personel için zorunlu** (§2). 2FA kaydı yapılmadan **hiç oturum tokeni verilmez**.
- Hasta için opsiyonel; hasta kapatabilir, personel kapatamaz.
- Sır, diske yazılmadan önce **AES-256-GCM ile şifrelenir**. Bir veritabanı dökümündeki
  TOTP sırrı, o hesap için kalıcı bir ikinci faktör atlaması demektir.
- **Tekrar koruması:** kabul edilen her kodun zaman adımı kaydedilir; sonraki kod kesin
  olarak daha ileri bir adımdan gelmelidir. Omuz sörfüyle görülen veya phishing proxy ile
  yakalanan bir kod, kalan 30 saniyesinde kullanılamaz.

**Kayıt onayında zaman adımı yakılmaz** — bilinçli. Yakılsaydı, kullanıcı 2FA'yı kurup
5 saniye sonra giriş yapmak istediğinde authenticator hâlâ aynı kodu gösterdiği için
reddedilirdi. Onboarding'in tam ortasında anlamsız bir duvar. Onay zaten kimliği
doğrulanmış bir kanaldan gelir; tekrar koruması ilk gerçek girişte başlar.

### Kurulum tokeni — kapalı döngüyü açan şey
Personel 2FA kurmadan token alamaz, ama 2FA kurulum ucu token ister. Kapalı döngü.
Çözüm: giriş, `MFA_SETUP_REQUIRED` ile birlikte **5 dakikalık, kapsamı `mfa_setup` olan**
bir token döner. Bu token yalnız `/auth/2fa/setup` ve `/auth/2fa/confirm` uçlarında kabul
edilir; başka her yerde reddedilir (test ile korunuyor).

### Varsayılan-reddet yetkilendirme
`JwtAuthGuard` **globaldir**. Yeni eklenen bir uç, biri bilinçli olarak `@Public()`
koymadıkça korumalıdır. Sağlık verisi tutan bir sistemde güvenli yön budur.

### Hesap kilitleme
5 başarısız denemeden sonra 15 dakika kilit. Doğru parola girildiğinde sayaç **ikinci
faktörden önce** sıfırlanır — yanlış yazılan bir TOTP kodu, parolası doğru olan bir hesabı
kilitlememelidir.

Giriş ucu ayrıca dakikada 10 istekle sınırlıdır: yalnız kilitleme olsaydı, saldırgan
gerçek kullanıcıları kilitleyerek hizmet engelleyebilirdi.

### Davetler
Altı haneli kod, yalnız karması saklanır. Kod **tek başına yeterli değildir** — hangi
adrese gönderildiği de bilinmelidir. Deneme sayısı, o adrese ait tüm açık davetlerde
birlikte artar, böylece yeni bir davete karşı deneyerek limit aşılamaz.

Hesap oluşturma ve davetin tüketilmesi **tek işlemde** olur; aksi halde kod yeniden
kullanılabilir kalırdı.

## İlk Yönetici

```bash
cd /opt/klinik/<ortam>/infra/compose
docker compose -f docker-compose.base.yml -f docker-compose.staging.yml run --rm \
  -e BOOTSTRAP_ADMIN_EMAIL=... -e BOOTSTRAP_ADMIN_PASSWORD=... \
  migrate npm run bootstrap:admin
```

Zaten bir `SUPER_ADMIN` varsa çalışmayı reddeder — sonradan sessizce ikinci bir yönetici
eklemek için kullanılamaz.

## Uçlar

| Uç | Erişim | Not |
|---|---|---|
| `POST /auth/login` | public | 10 istek/dk |
| `POST /auth/refresh` | public | 30 istek/dk, token döndürür |
| `POST /auth/invitations/accept` | public | 10 istek/dk |
| `POST /auth/logout` | oturum | bu cihaz |
| `POST /auth/logout-all` | oturum | tüm cihazlar |
| `GET /auth/sessions` | oturum | cihaz listesi |
| `DELETE /auth/sessions/:familyId` | oturum | yalnız kendi oturumun |
| `POST /auth/2fa/setup` | oturum **veya** kurulum tokeni | |
| `POST /auth/2fa/confirm` | oturum **veya** kurulum tokeni | |
| `POST /auth/2fa/disable` | oturum | personel için yasak |
| `POST /auth/password` | oturum | tüm cihazları çıkarır |
| `POST /auth/invitations` | oturum | izin kontrolü T1.3'te |

## Sırlar

`ENCRYPTION_KEY` (AES-256, base64, tam 32 bayt) TOTP sırlarını şifreler.

> 🔑 **Bu anahtar kaybolursa şifreli kolonlar geri getirilemez.** Yedek parolası gibi,
> bunun da bir kopyası sunucu dışında saklanmalıdır.

## Test Kapsamı

| Dosya | Adet | Odak |
|---|---|---|
| `src/auth/totp.service.spec.ts` | 7 | TOTP, tekrar koruması, şifreleme |
| `test/auth.integration.spec.ts` | 36 | Giriş, kilitleme, 2FA, rotation, davetler |
| `test/auth-http.integration.spec.ts` | 17 | HTTP seviyesinde yetkilendirme sınırı |

Ağırlık **negatif testlerde**: sistemin ne yapması gerektiği değil, neyi **reddetmesi**
gerektiği — mock'lu bir testin sessizce yanlış yaptığı kısım orasıdır.
