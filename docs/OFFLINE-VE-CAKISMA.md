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

Arayüz yerel durumu okuyor, dolayısıyla düzenleme **ağ olsun olmasın anında görünüyor**.
Kuyruk, sunucuya hâlâ borçlu olduğumuz şey.

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
