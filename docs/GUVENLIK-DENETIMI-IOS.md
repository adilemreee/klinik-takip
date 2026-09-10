# iOS İstemci Güvenlik Denetimi (T7.2)

**Tarih:** 2026-09-11 · **Kapsam:** yalnız iOS istemcisi. Sunucu tarafı
[SUNUCU-NOTLARI](SUNUCU-NOTLARI.md) ve [YETKILENDIRME](YETKILENDIRME.md)
belgelerinde.

Referans: OWASP MASVS v2 ve Mobile Top 10 (2024). Her başlığın altında **ne
kontrol edildi**, **ne bulundu**, **ne yapıldı** yazıyor. Hiçbir şey bulunmayan
başlıkları da bıraktım: "bakıldı ve temiz" ile "bakılmadı" farklı şeyler, ve
listeden düşen başlık ikincisine benziyor.

---

## M1 — Yetkilendirme ve kimlik doğrulama

| Kontrol | Sonuç |
|---|---|
| Jeton saklama | Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Yedeklere ve başka cihaza geçmiyor |
| Yenileme jetonu tek kullanımlık mı | Evet, sunucu tarafında aile bazlı; istemci 401'de yalnız **bir kez** yeniliyor |
| Oturum kapanınca ne siliniyor | Jetonlar, yanıt önbelleği, yazma kuyruğu ve kuyruktaki dosya kopyaları |
| Soket ayrı yetki taşıyor mu | Hayır — aynı jeton, aynı kapsam kontrolü, oda başına |

**Bulgu yok.**

## M2 — Yetersiz tedarik zinciri güvenliği

İki üçüncü-taraf bağımlılık: GRDB ve socket.io-client-swift (ve onun Starscream
bağımlılığı). İkisi de sabit sürüm aralığıyla, `Package.resolved` depoda.

CI'daki **Security** işi npm tarafını denetliyor; **Swift bağımlılıkları
denetlenmiyor** — Swift için `npm audit` karşılığı bir araç kurulmadı.

> **Kabul edilmiş risk.** Üç paket, ikisi çok yaygın. TestFlight öncesi
> sürümlerin elle gözden geçirilmesi yeterli görüldü.

## M3 — Güvensiz kimlik doğrulama/oturum yönetimi

| Kontrol | Sonuç |
|---|---|
| Jeton URL'de mi | Hayır — soket el sıkışmasında da başlıkta. URL vekil sunucu kayıtlarına düşer |
| Biyometrik kilit atlatılabilir mi | `deviceOwnerAuthentication` (parola yedekli). Cihazda hiç kilit yoksa uygulama kilitlenmiyor — kullanıcıyı tamamen dışarıda bırakmamak için, bilerek |

### 🔴 Bulgu 1 — kilit yalnız soğuk açılışı koruyordu

`isLocked` yalnız uygulama başlarken kuruluyordu. Sabah bir kez açan biri
telefonu gün boyu açık bırakıyordu — ve masada unutulan telefon, kilidin var
olma sebebiydi.

**Yapıldı:** uygulama arka plana geçince zaman kaydediliyor, dönüşte **60
saniyeden uzun** kaldıysa yeniden kilitleniyor. Sıfır değil, çünkü belge
seçici, kamera ve önizleme uygulamayı arka plana atıyor; fotoğraf seçtikten
sonra yüz taraması istemek, insanların kilidi kapatma yoludur.

## M4 — Yetersiz girdi/çıktı doğrulama

| Kontrol | Sonuç |
|---|---|
| Dosya türü istemcinin dediğine mi güveniliyor | Hayır, sunucu baytlara bakıyor |
| Sunucudan gelen HTML/Markdown render'ı | Markdown `AttributedString` ile, script çalıştırmıyor |
| Derin bağlantı | Uygulama hiç `URL scheme` tanımlamıyor — saldırı yüzeyi yok |

**Bulgu yok** (dosya türü seziciyle ilgili ayrı bir hata sesli mesaj işinde
bulundu ve düzeltildi: `ftyp` her ISO dosyasını HEIC sanıyordu).

## M5 — Yetersiz iletişim güvenliği

| Kontrol | Sonuç |
|---|---|
| TLS zorunlu mu | Evet, ATS varsayılanları açık |
| Sertifika sabitleme (pinning) | **Yok** |
| ATS istisnası | Yalnız `NSAllowsLocalNetworking` |

`NSAllowsLocalNetworking`, ATS'in **en dar** istisnası: yalnız `.local`,
link-local ve loopback adreslerine düz metin izni veriyor; gerçek bir sunucuya
giden TLS'i zayıflatmıyor. Geliştirme derlemeleri tüneli localhost'ta arıyor.

> **Kabul edilmiş risk — sabitleme yok.** Sabitleme, klinik sertifikayı
> yenilediğinde uygulamayı çalışmaz hâle getirebilir ve düzeltmesi bir App
> Store sürümü sürer. Cloudflare önünde duran bir servis için kazancı bu riske
> değmedi. Gerçek hasta trafiği öncesi yeniden değerlendirilecek.

## M6 — Yetersiz gizlilik kontrolleri

### 🔴 Bulgu 2 — uygulama değiştirici ekran görüntüsü

iOS, uygulama öne çıkmayı bıraktığı anda ekranın fotoğrafını çekiyor ve çoklu
görev kartında gösteriyor. O kart hasta dosyası, tahlil değeri ya da yara
fotoğrafı olabiliyordu — telefonu eline alan herkese açık, hiçbir açık
kullanmadan.

**Yapıldı:** uygulama öne çıkmadığında ve oturum açıkken ekranın üstüne opak
bir kapak geliyor. Cihaz kilidi açık olsun olmasın: ikisi farklı şeyleri
koruyor, ve kendi telefonundaki hastanın da sonuçlarının uygulama
değiştiricide durmama hakkı var.

| Diğer kontroller | Sonuç |
|---|---|
| Panoya kopyalanan hassas alan | Yok |
| Kayıt (log) | İstemcide `print`/`NSLog` hiç yok |
| Analitik/üçüncü taraf SDK | Yok |

## M7 — Yetersiz ikili korumalar

Jailbreak tespiti, kod karartma ve anti-debug **yok**.

> **Kabul edilmiş risk.** Bunlar kararlı bir saldırganı yavaşlatır,
> durdurmaz; ve klinik veri sunucuda, istemcide değil. Uygulamada gömülü sır
> yok: API adresi bile derleme yapılandırmasından geliyor.

## M8 — Hatalı güvenlik yapılandırması

| Kontrol | Sonuç |
|---|---|
| Gömülü sır | Yok. `KLINIK_API_BASE_URL` xcconfig'den, depoda değil |
| Hata ayıklama artıkları | Yok |
| İzin metinleri | Her biri gerçekten ne için istendiğini yazıyor |
| HealthKit | Yalnız okuma, yalnız kilo ve nabız |

**Bulgu yok.**

## M9 — Güvensiz veri saklama

### 🟡 Bulgu 3 — Data Protection sınıfı varsayılana bırakılmıştı

`sync.sqlite` uygulamanın yaptığı her okumanın son yanıtını tutuyor — tahlil
değerleri, ilaç planı, hasta dosyası — ve gönderilmemiş yazmaları. Yükleme
kuyruğunun dizini pasaport taraması ve yara fotoğrafı tutuyor. İkisi de
sınıfını varsayılandan alıyordu.

**Yapıldı:** ikisine de `completeUntilFirstUserAuthentication` **açıkça**
yazıldı.

**Neden `complete` değil:** daha güçlü sınıf, ekran kilitliyken dosyayı
okunamaz yapıyor — ve bu uygulama kilitliyken bilerek yazıyor: bildirimden
yanıtlanan ilaç check-in'i, ve telefon sinyal bulunca boşalan kuyruk. Sessizce
başarısız olan bir yazma, kuyruğun korumak için var olduğu işin ta kendisini
kaybederdi.

Dizine uygulandı, çünkü SQLite yanına `-wal` ve `-shm` dosyaları yazıyor;
yalnız kodda adı geçen dosyayı korumak, satırların hiçbirini korumamak demek.

| Diğer kontroller | Sonuç |
|---|---|
| Klinik veri `UserDefaults`'ta mı | Hayır — orada yalnız kilit tercihi ve HealthKit filigranı |
| Geçici dosyalar | Ses kaydı gönderildikten ve iptal edildikten sonra siliniyor; yükleme kopyası klinik aldıktan sonra siliniyor |
| Yedeklere giden klinik veri | Application Support yedekleniyor — **kasıtlı**: kuyruk cihaz değiştirmeyi atlatmalı. Keychain jetonları `ThisDeviceOnly` ile geçmiyor |

## M10 — Yetersiz kriptografi

İstemci kendi başına şifreleme yapmıyor: TLS taşıma için, Keychain ve Data
Protection saklama için. Elle yazılmış kripto yok — ki en iyi durum bu.

Yüklemede SHA-256 sağlama var; bu bir güvenlik önlemi değil, bütünlük kontrolü
ve öyle de anlatılıyor.

---

## Özet

| | Adet |
|---|---|
| Bulunup düzeltilen | **3** (kilit yeniden devreye girmiyordu · ekran görüntüsü kapağı yoktu · Data Protection açık değildi) |
| Kabul edilmiş risk | **3** (sabitleme yok · ikili koruma yok · Swift bağımlılık denetimi yok) |
| Test edilmiş | Kilit için 6 test; diğer ikisi davranışsal, insan gözü gerekiyor |

## Bir script'in göremediği

Bu belge kodu okuyarak yazıldı. Görmediği şeyler:

- **Sızma testi yapılmadı.** Çalışan bir sisteme karşı kimse saldırmadı.
- **Ekran görüntüsü kapağı** gerçek cihazda göz kontrolü istiyor: simülatörde
  çoklu görev kartı aynı davranmıyor.
- **Kilit yeniden devreye girmesi** gerçek arka plan/ön plan döngüsüyle
  denenmeli; testler saati elle ilerletiyor.
