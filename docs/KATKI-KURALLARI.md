# Katkı Kuralları

## Dallar

| Dal | Amaç |
|---|---|
| `main` | Production. Yalnız `develop`'tan PR ile merge edilir. |
| `develop` | Entegrasyon dalı. Varsayılan çalışma hedefi. |
| `feat/T1.2-auth-refresh` | Task bazlı dal. Şartnamedeki task kodu ile başlar. |
| `fix/...`, `chore/...`, `docs/...` | Diğer işler. |

Doğrudan `main`'e commit edilmez.

## Commit Mesajları — Conventional Commits

```
<tip>(<kapsam>): <özet>

<gövde — neden, ne değişti>

Refs: T1.2
```

Tipler: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`.
Kapsam örnekleri: `auth`, `patients`, `labs`, `ios`, `android`, `infra`.

Örnek:

```
feat(auth): add refresh token rotation with device sessions

Refresh tokens are now single-use and rotated on every refresh.
Reuse of a consumed token revokes the whole device session family.

Refs: T1.2
```

## Dil

- **İletişim, dokümantasyon, commit gövdesi:** Türkçe olabilir.
- **Kod, değişken/fonksiyon isimleri, kod yorumları, commit özeti:** İngilizce (Şartname §0.8).

## Bir Task Ne Zaman "Bitti" Sayılır?

Şartname §12'deki kabul kriterlerinin tamamı karşılandığında. **Testsiz modül bitmiş sayılmaz** (§0.6).

## Sırlar

Hiçbir koşulda repoya girmez: `.env`, API anahtarları, DB şifreleri, SSH anahtarları,
APNs `.p8`, `google-services.json`, `GoogleService-Info.plist`, sunucu IP'si.
`.gitignore` bunları kapsar; yine de commit öncesi `git diff --staged` ile bakılır.


## Araç zinciri farkı — CI daha eskidir

CI (`macos-15`) **Swift 6.1.2** ile derliyor; bir geliştirme Mac'inde büyük
ihtimalle daha yenisi var. İkisi her şeyde aynı fikirde değil ve fark tek
yönlü: **yeni sürüm daha çok şeyi kabul ediyor.** Yerelde derlenen bir kod
CI'da kırılabilir; tersi olmaz.

Üç kez başımıza geldi, ve üçü de aynı şeyin farklı yüzü:

- `Bool?` üzerinde `switch` — 6.3 kapsayıcı sayıyor, 6.1 saymıyor. `if/else`
  ikisinde de çalışıyor.
- Bir `View`'ın `static` üyesi — `View` örtük olarak main actor'a bağlı ve 6.1
  bunu statik üyelere de taşıyor. Testten çağrılan her böyle fonksiyon
  `nonisolated` olmalı; zaten saf fonksiyonlar oldukları için doğru olan da bu.
- **Bir çerçeve nesnesi üzerinde `await`.** `UNUserNotificationCenter`,
  `HKHealthStore`, `LAContext`, `VNDocumentCameraScan`, `UIImage` — hiçbiri her
  SDK'da `Sendable` değil, ve üzerlerinde `await` etmek nesnenin kendisini bir
  aktör sınırından geçirmek demek.

### Kural: çerçeve nesnesi üzerinde `await` etmeyin

Bunun yerine tamamlama bloklu (completion handler) sürümü `withCheckedContinuation`
ile sarın; sınırı yalnız sonuç geçsin:

```swift
// Hayır — merkezin kendisi geçiyor
let granted = try await centre.requestAuthorization(options: [.alert])

// Evet — yalnız Bool geçiyor
let granted: Bool = await withCheckedContinuation { continuation in
    centre.requestAuthorization(options: [.alert]) { granted, _ in
        continuation.resume(returning: granted)
    }
}
```

Bu biçim her iki araç zincirinde de doğru derleniyor ve zaten daha dürüst: ne
geçtiğini okuyan görüyor. Aynı sebeple bir delege, elindeki çerçeve nesnesini
değil, ondan çıkardığı veriyi (`[Data]`, `Bool`) geri vermeli.

### Kural: UIKit'e dokunan her şeye izolasyonu **açıkça** yazın

`UIApplication.shared`, `UIDevice.current`, `VNDocumentCameraViewController.isSupported`
gibi üyeler SDK'da main actor'a bağlı. Bir `enum`'un izolasyonu yoktur, ve bir
`@MainActor` tipin `static` üyesinin izolasyonu miras alıp almadığı iki araç
zincirinin anlaşamadığı şeylerden biri. O yüzden çıkarıma bırakmayın:

```swift
@MainActor
static var isAvailable: Bool { VNDocumentCameraViewController.isSupported }
```

### Kural: testin çağırdığı `View` static'i `nonisolated` olmalı

Bir `View` main actor'a bağlıdır ve CI'daki derleyici bu izolasyonu tipin
`static` üyelerine de taşır; buradaki yeni derleyici taşımaz. Sonuç: ekranın
yanında duran saf bir yardımcı fonksiyon **yerelde derlenir, CI'da patlar**:

```
error: call to main actor-isolated static method 'isSigned'
       in a synchronous nonisolated context
```

Kural her static için değil — çoğu yalnız view'ın kendi gövdesinden okunuyor ve
orada izolasyon zaten doğru. **Testin çağırdığı** static'ler `nonisolated`
olmalı, çünkü test metodu izolasyonsuzdur. (Testin kendisi `@MainActor` ise
sorun yok; sınır geçilmiyor.)

`design/scripts/check-isolation.mjs` bunu tarıyor ve CI çalıştırıyor. Üç tur bu
hataya gitti; bir saniyelik kontrol bir derlemeden ucuz.

### Kural: aktör metoduna `Sendable` olmayan varsayılan parametre koymayın

```swift
// Yanlış: `.default` çağıranın tarafında üretilir ve aktör sınırından geçer
public actor UploadQueue {
    public func discard(id: String, fileManager: FileManager = .default) async { … }
}

// Doğru: aktörün kendi içinde
public actor UploadQueue {
    private let files = FileManager.default
}
```

`FileManager`, `UserDefaults`, `NotificationCenter` — hiçbiri `Sendable` değil.
Varsayılan değer **çağırma yerinde** hesaplanıyor, yani nesne aktöre gönderiliyor.
Yereldeki 6.3 buna ses çıkarmadı, CI'daki 6.1 `sending value of non-Sendable type`
diye reddetti.

**Muaf olanlar:** aktörün `static` üyeleri (izolasyonsuzdur) ve `@MainActor` bir
tipin `@MainActor` bir yerden çağrılan init'i — ikisinde de sınır geçilmiyor.
`SQLiteStore.defaultURL(fileManager:)` bu yüzden duruyor.

### Kural: `guard` ile bayrağı kaldırmak arasına `await` koymayın

Bir aktörde (veya `@MainActor` bir tipte) yeniden girişi engelleyen bayrak, kontrolle
**aynı senkron adımda** kaldırılmalı:

```swift
// Yanlış: ikinci çağıran, birincisi askıdayken guard'dan geçer
guard !isSyncing else { return }
let count = await engine.pending().count
isSyncing = true

// Doğru
guard !isSyncing else { return }
isSyncing = true
defer { isSyncing = false }
let count = await engine.pending().count
```

Bu kuyruğu iki kez göndertti ve testte yakalandı. Aktör yeniden girişlidir; `await`
sırayı bırakır.

**Push etmeden önce:** `swift build && swift test` yetmez — ikisi de macOS için
derler ve `#if os(iOS)` dalları hiç derlenmez. Uygulamanın kendisi derlenmeli:

```bash
cd ios && xcodegen generate && xcodebuild -project Klinik.xcodeproj \
  -scheme Klinik -destination 'generic/platform=iOS Simulator' build
```

CI artık bunu yapıyor, ama yerelde yakalamak bir turu geri kazandırır.

> **Not:** burada bir zamanlar `swift build -Xswiftc -sdk …` komutu da yazıyordu.
> **Çalışmıyor** — sysroot macOS'ta kalıyor ve `cannot load underlying module for
> 'UIKit'` veriyor. Denendi, doğrulandı, kaldırıldı. Paketi iOS SDK'sına karşı
> derlemenin yolu `xcodebuild`.
