# Offline Katmanı ve Çakışma Çözümü

Şartname §M15, T2.6. Kod: [`backend/src/patients/version-conflict.ts`](../backend/src/patients/version-conflict.ts) ·
[`ios/Sources/KlinikSync/`](../ios/Sources/KlinikSync/) · [`android/core/sync/`](../android/core/sync/)

## Kural Sunucuda Başlar

§M15: *"klinik veride otomatik üzerine yazma yok."*

Bu kural **sunucuda** başlamak zorunda. İstemci ne kadar dikkatli olursa olsun, API bayat
bir yazmayı kabul ediyorsa hiçbir şey değişmez.

Personelin düzenlediği kayıtlar artık bir **versiyon** taşıyor:

```
GET  /patients/:id   →  { ..., "version": 3 }
PATCH /patients/:id  →  { "city": "Berlin", "expectedVersion": 3 }
```

Versiyon eşleşmezse yazma **reddediliyor** ve yanıt sunucudaki güncel kaydı da taşıyor:

```json
{
  "statusCode": 409,
  "message": "VERSION_CONFLICT",
  "expectedVersion": 3,
  "currentVersion": 5,
  "current": { "...sunucudaki hâli..." }
}
```

Güncel kaydın yanıtta olması şart: **çakışma personele gösterilecekse**, personelin iki
tarafı da görmesi gerekir. Kullanıcının inceleyemediği bir çakışma, en son kaydedenin
kazandığı bir çakışmadır.

`expectedVersion` **opsiyonel**. Az önce açtığı ekranda düzenleme yapan bir kullanıcının
buna ihtiyacı yok; versiyonu gönderen, saatler önce yapılmış bir düzenlemeyi tekrar
oynatan **offline kuyruk**.

## İstemcide Outbox

Kuyruk, sunucuya hâlâ borçlu olduğumuz şey.

> **Düzeltme (2026-09-10).** Bu bölüm önce "arayüz yerel durumu okuyor, düzenleme ağ
> olsun olmasın anında görünüyor" diyordu. Doğru değildi: bu uygulama kliniğin
> kayıtlarının yerel bir kopyasını tutmuyor, ekranlar sunucudan okuyor. Uçakta
> girilen bir ölçüm gönderilene kadar **tek bir yerde** var — kuyrukta. Ekranların
> onu göstermesi için kuyruğu ayrıca okuması gerekiyordu; aşağıdaki
> "Kullanıcı kendi işini görür" bölümü bunun nasıl yapıldığını anlatıyor.

Üç kural bunu güvenli kılıyor:

### 1. Reddedilen iş saklanır

Çakışan bir değişiklik insana gösterilecek bir listeye taşınıyor; sunucunun kabul etmediği
bir değişiklik sebebiyle birlikte kuyrukta kalıyor.

**Hiçbir şey yere düşmüyor** — bir test her girişi uygulandı / çakıştı / reddedildi
yollarından biriyle hesaba katıyor.

### 2. Bir kayıtta çakışma varsa, o kayda ait sonraki değişiklikler bekler

En ince kural bu. Sonraki düzenlemeler **aynı bayat resme göre** yazıldı; onları göndermek,
kullanıcının hiç görmediği bir durumun üstüne değişiklik uygulamak olurdu — yani §M15'in
engellemek için var olduğu sessiz üzerine yazma, bir adım ötede.

Bloklama **kayıt bazında**: bir hastadaki çakışma, diğer herkesin işini durdurmuyor.

### 3. Bağlantı hatası turu durdurur

Kuyruğun geri kalanını denemenin anlamı yok — aynı koşul hepsiyle karşılaşacak. Girişler
korunuyor, sonraki turda tekrar deneniyor.

## Durum Göstergesi

§M15 net bir gösterge istiyor:

| Durum | Anlamı |
|---|---|
| `upToDate` | Kuyruk boş |
| `offline(pending: n)` | n değişiklik bekliyor, ortada sorun yok |
| `syncing(remaining: n)` | Gönderim sürüyor |
| `needsAttention(conflicts, rejected)` | **Bir insan gerekiyor** |

Son durum diğerlerinden ayrı, çünkü kullanıcının yapması gereken şey farklı: beklemek
değil, karar vermek.

## Depolama Portları

`OutboxStore` bir arayüz; bellek içi uygulaması testlerde kullanılıyor. Böylece tüm
mantık **veritabanı olmadan** doğrulanıyor.

GRDB (iOS) ve Room (Android) uygulamaları, uygulama hedefi kurulduğunda bağlanacak —
mantık değişmeden.

## Test Kapsamı

| Yer | Adet | Odak |
|---|---|---|
| `backend/test/optimistic-locking.integration.spec.ts` | 9 | Versiyon artışı, bayat yazma reddi, eşzamanlı düzenleme |
| iOS `SyncEngineTests` | 15 | Sıra, çakışma, kayıt bazlı bloklama, hiçbir şeyin kaybolmaması |
| Android `SyncEngineTest` | 15 | Aynı kurallar |

En anlamlı üçü:

- *"lets the first of two concurrent edits through and refuses the second"*
- *"a conflict holds back later edits to the same record"*
- *"nothing is ever silently lost"*

## Kuyruk Artık Diskte (T2.6 kalanı)

Senkronizasyon motorunun tuttuğu her şey **kullanıcının zaten yaptığı iştir**:
sinyalsiz bir viziteden yazılmış bir düzenleme, birinin karar vermesini bekleyen
bir çakışma, yarım kalmış bir yükleme.

> Bellekte tutulduğunda hepsi, telefon uygulamayı geri aldığında ölür — ki bu
> tam olarak kuyruğun dolu olmasına sebep olan bağlantının kötü olduğu andır.

İki istemcide de tek bir SQLite dosyası, iki port (`OutboxStore`, `UploadStore`)
ve sürümlenmiş şema var.

### Kütüphane seçimi tutarlı bir ilkeye dayanıyor

| | Seçim | Neden |
|---|---|---|
| iOS | **GRDB** | Swift'ten SQLite'a C köprüsü, her hata yolunda elle `finalize` ve işaretçi ömrü demek. Sağlık uygulamasında elle yazılmaya değmeyecek hata sınıfı |
| Android | **`androidx.sqlite` sürücüsü doğrudan** (Room yok) | Kotlin'in SQLite API'si zaten güvenli — elle bellek yönetimi yok. Room'un ekleyeceği tek şey kod üretimi olurdu, ve port zaten tanımlı |

İlke: **ham API güvensizse kütüphane, güvenliyse kütüphane değil.**

### Test edilen kod, gönderilen koddur

Android tarafında sürücü **dışarıdan veriliyor**. Testlerde `BundledSQLiteDriver`
(JVM), cihazda aynı sürücünün Android varyantı — yani aynı SQL ifadeleri, aynı
sınıf, yalnız sürücü farklı. Emülatör gerekmiyor, ve "testte çalışan başka bir
şeydi" durumu yok.

iOS tarafında testler macOS'ta gerçek SQLite dosyasına karşı çalışıyor.

**Yeniden başlatma testi her iki tarafta da gerçek:** dosyaya yaz, mağazayı
kapat, aynı dosyayla yenisini aç. Uygulamanın öldürülmesi budur.

### Şema sürümlü

"Varsa oluşturma" değil, kayıtlı sürüm (`user_version` / GRDB `DatabaseMigrator`).
Yoksa sonradan eklenen bir kolon, temiz kurulumla güncelleme arasında sessizce
farklı davranan bir tablo olurdu — ve ikinci açılışta kuyruğu baştan başlatan bir
`CREATE TABLE` fark edilmez.

### Yarım Kalan Yüklemeler

Yükleme sunucuya karşı zaten devam ettirilebilir — sunucu kaç bayt aldığını
söylüyor. Eksik olan **hangi oturumun hangi yerel dosyaya ait olduğu**: bellekte
tutulduğunda süreçle birlikte ölüyor, ve 20 MB'lık bir tahlili yüklerken
uygulaması kapanan hasta sıfırdan başlıyor — hem de zaten zorlanan bir bağlantıda.

Artık aynı dosyada bir tabloda.

---

# Yazma Kuyruğu (2026-09-10)

Buraya kadarki her şey **motorun** hikâyesiydi: kuyruk vardı, diskte duruyordu,
testleri geçiyordu. Bir tek şey eksikti — **hiçbir şey ona bir kayıt koymuyordu.**
Bağlantı yokken yapılan yazma doğrudan gidiyor, hata veriyor, kayboluyordu.

Bu bölüm o boşluğun nasıl kapatıldığını anlatıyor.

## Hangi yazmalar kuyruğa giriyor

Bu **klinik bir karar**, teknik bir kural değil. Bütün yazmaları kapsayan bir kural
yazmak yerine uç nokta uç nokta seçildi:

| Yazma | Kuyruğa girer mi | Neden |
|---|---|---|
| Ölçüm kaydı (M2) | **Evet** | Geçmiş bir ana ait bir olgu. Hastadan yarın hatırlayıp yeniden yazmasını istemek, takip eğrisinde delik açar |
| Doz check-in'i (M9) | **Evet** | Değerinin tamamı zaman damgasında. Dokuzda içilip gece yarısı bildirilen bir doz üç saat yanlıştır |
| Şikâyet bildirimi (M7) | **Evet** | Ama ekranda tek cümleyle birlikte: *acilse beklemeyin, telefon edin* |
| Anket yanıtları (M11) | **Evet** | On dakikalık dikkat. Kaybolduğunda yanıtlar da gider, yeniden yanıtlama isteği de |
| Mesaj (M3) | **Evet** | Konuşma başına sıralı: bir mesaj reddedilirse sonrakiler bekler, yoksa cevap sorudan önce ulaşır |
| **Acil durum butonu (M8)** | **Hayır** | Kuyrukta bekleyen alarm, alarm değildir |
| Giriş / TOTP | Hayır | Kuyruğa alınacak bir şey yok |
| Onam imzası (KVKK) | Hayır | Hukuki kayıt; sunucunun zaman damgası ve denetim izi gerekiyor |
| Ödeme / finans | Hayır | Para |
| Randevu alma | Hayır | Slot dolmuş olabilir; kuyruğa almak var olmayan bir rezervasyonu ima eder |

Kod tarafında bunu `Endpoint.offline` alanı taşıyor. Varsayılan `.fail` — yani
**hiçbir yazma kazara kuyruğa girmiyor**, uç nokta açıkça istemek zorunda.

## Aynı yazmanın iki kez gitmesi

Tehlikeli durum, hiç ulaşmayan istek değil. **Ulaşan, işlenen ve yanıtı dönüş yolunda
kaybolan** istek. Telefon ikisini birbirinden ayıramaz; anahtarsız bir tekrar denemesi
ikinci bir doz kaydı, ikinci bir şikâyet, ikinci bir mesaj yaratır.

Bu yüzden sunucuya `Idempotency-Key` başlığı eklendi:

```
POST /me/measurements
Idempotency-Key: 0f8f9c2e-...      ← ilk denemede üretilir, her denemede aynı kalır
```

Global bir interceptor (`backend/src/common/idempotency/`) anahtarı Redis'te tutuyor:

- **İlk deneme** → anahtar `in_flight` olarak işaretlenir, istek çalışır, yanıt saklanır
- **Tekrar** → saklanan yanıt aynen döner, `Idempotent-Replay: true` başlığıyla
- **Hâlâ işleniyorsa** → `409 IDEMPOTENCY_IN_FLIGHT`; istemci "biraz sonra tekrar dene" olarak okur
- **Aynı anahtar başka bir gövdeyle** → `409 IDEMPOTENCY_KEY_REUSED`; yoksa ikinci değişiklik
  sessizce düşerdi ve başarı gibi görünürdü
- **İstek hata verdiyse** → anahtar serbest bırakılır; bir sunucu hatası, kullanıcının bir
  dakika boyunca düzeltemeyeceği bir değişikliğe dönüşmemeli

Anahtar **kullanıcı bazında** kapsanıyor (`idem:<userId>:<key>`). Aksi hâlde bir hesap
başkasının anahtarını oynatıp görme hakkı olmayan bir kaydı alabilirdi.

**Redis'e ulaşılamazsa istek korumasız devam ediyor.** Yinelenen bir ölçüm kötü;
klinikteki bütün yazmaları reddetmek daha kötü. Bu bir tercih, ve kodda yazıyor.

Başlık **opsiyonel**: taşımayan istek her zamanki gibi davranıyor. Yani bu özellik
kuyruk dışındaki hiçbir çağrının yoluna girmiyor.

## Kullanıcı kendi işini görür

Bu uygulama kliniğin kayıtlarının yerel kopyasını tutmuyor. Uçakta girilen bir ölçüm
gönderilene kadar yalnızca kuyrukta var — ve yalnız sunucudan çizilen bir liste, onu
yazan kişiye **uygulama işimi çöpe attı** gibi görünür.

Çözüm bir yerel veritabanı değil, `PendingWriteReader` portu: ekran kendi türündeki
gönderilmemiş yazmaları okuyup **gönderilmedi diye işaretleyerek** gösteriyor.

| Ekran | Ne gösteriyor |
|---|---|
| İlaçlar | Satır hastanın seçtiğini gösteriyor **ve** "Gönderilmedi" rozetini taşıyor. Butonlar gizleniyor — ikinci dokunuş aynı doz için ikinci bir kayıt olurdu |
| Mesajlar | Gönderilmemiş mesaj, konuşmanın altında ayrı bir kutuda. Teslim edilenlerin arasına karıştırılmıyor |
| Ölçümler | Grafiğin üstünde liste hâlinde — **eğriye çizilmiyor.** Kuyruktaki kilonun VKİ'si yok; o, ölçüm anındaki boya bağlı ve sunucu hesaplıyor. Eğriye kondurmak, kimsenin hesaplamadığı bir noktayı klinisyenin baktığı grafiğe koymak olurdu |
| Şikâyet | "Kaydedildi, gönderilecek" **ve** "Acilse beklemeyin, telefonla arayın" |
| Anket | "Teşekkürler" değil — kliniğin almadığı yanıtlar için teşekkür başkası adına teşekkürdür |

İki yarım da söyleniyor: hastanın ne seçtiği, ve kliniğin bunu **henüz görmediği**.
Yalnız biri söylenirse kayıt hakkında yalan söylenmiş olur.

## Ne zaman gönderiliyor

Zamanlayıcı yok. Üç şey bir tur başlatıyor:

1. **Uygulama öne geldiğinde** — hastanın sinyale girdiği en olası an
2. **Telefon internete rota bulduğunda** (`NWPathMonitor`)
3. **Bir okuma kliniğe ulaştığında** — bu, herhangi bir erişilebilirlik API'sinden daha
   iyi kanıt: otel wifi'si DNS'e cevap verip gerisini düşürebilir

Bir de kullanıcının kendi eliyle: "Şimdi gönder".

Olmayan bir sunucuyu yoklamak, kuyruğun dolmasına sebep olan otelde hastanın pilini
harcamak demek.

## Bekleyen değişiklikler ekranı

Görünmeyen bir kuyruk, kaybolmuş işten ayırt edilemez. Ekran (`PendingChangesScreen`)
kişiye kendi gönderilmemiş yazmaları hakkında söylenebilecek her şeyi söylüyor: ne
olduğu, ne zaman yapıldığı, kaç kez denendiği, kliniğin son ne dediği.

İki liste, çünkü **çareleri farklı**:

- **Sırada** — bağlantı bekliyor. Kendi kendine çözülecek
- **Gönderilemiyor** — klinik reddetti. Kendi kendine çözülmeyecek; bir insan gerekiyor

Ve bir kural: **hiçbir şey kendi kendine atılmıyor.** On denemeden sonra da, bir hafta
sonra da giriş orada duruyor. Uygulama, elinde tuttuğu şeyin bir kopya mı yoksa salı
günü yaranın kötü göründüğüne dair tek kayıt mı olduğunu bilemez. Kuyruktan
gönderilmeden çıkmanın tek yolu kullanıcının "Vazgeç" demesi.

## Çıkış yaparken

Bir giriş `me/…` yoluna yazılmış bir istek ve **kendi kullanıcısını taşımıyor**.
Çıkışta kalırsa, bir sonraki giriş yapan kim olursa onun adına gönderilir — birinin
tansiyonu başkasının dosyasına.

Bu yüzden çıkışta kuyruk boşaltılıyor. Gerçek bir bedel, o yüzden **önce söyleniyor**:
çıkış butonu bekleyen kayıt varsa kaç tanesinin kaybolacağını söyleyip onay istiyor.

## Test Kapsamı (yazma kuyruğu)

| Yer | Adet | Odak |
|---|---|---|
| `backend/src/common/idempotency/*.spec.ts` | 20 | Anahtar sahiplenme, tekrar oynatma, yeniden kullanım reddi, Redis yokken devam |
| `backend/test/idempotency.integration.spec.ts` | 7 | Gerçek Redis + gerçek veritabanı: iki kez giden yazma **bir** satır yaratıyor |
| iOS `WriteQueueTests` | 13 | Ne kuyruğa girer ne girmez; anahtar ilk denemede ve tekrarda aynı |
| iOS `APIOutboxSenderTests` | 7 | "Sonra dene" ile "bir insan gerekiyor" ayrımı |
| iOS `SyncCoordinatorTests` | 10 | İki turun aynı girişi iki kez göndermemesi, çıkışta boşaltma, vazgeçmenin tek yol olması |
| iOS `OfflineCheckInTests` / `OfflineChatTests` / `OfflineMeasurementTests` | 8 | Ekranın kullanıcıya kendi işini göstermesi |

En anlamlı üçü:

- *"records one reading when the same write arrives twice"*
- *"a queue that could not take it reports the original failure"* — kaydedildi demek,
  hiçbir yerde değilken, verilebilecek en kötü cevaptır
- *"discarding is the only way work leaves the queue unsent"*

## Hâlâ eksik

- **Yarım kalan yüklemeler** (fotoğraf, belge) bu kuyruktan geçmiyor. `UploadStore`
  duruyor ama devam ettirme henüz bağlanmadı — multipart gövde bu kuyruğun taşıdığı
  şey değil.
- **Android'de hiçbiri yok.** Motor ve depolama var; yazmaları kuyruğa sokan taraf yok.
