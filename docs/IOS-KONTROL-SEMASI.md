# iOS Kontrol Şeması

> **Durum — 2026-09-11:** A, B, C, D ve E bloklarının tamamı uygulandı ve
> doğrulandı. 43 maddenin 41'i koddan düzeltildi, 2'si bilerek düzeltilmedi ve
> gerekçesi aşağıda yazıyor (B6'nın şikayet yarısı, D1). F bloğu simülatör
> gerektirdiği için hâlâ açık.
>
> - `swift test` — **121 test, 0 hata** (18 yeni test eklendi)
> - `xcodebuild -scheme Klinik` — **BUILD SUCCEEDED** (gerçek iOS derleyicisi)
> - `node design/scripts/check-screens.mjs` — yeni, CI'ya eklendi
> - `node design/scripts/check-strings.mjs` — tüm kataloglar uyuşuyor
> - `npx jest src/medications` — 66 test, 0 hata (backend'e 7 yeni test)
>
> Her düzeltmenin arkasında ya yeni bir test ya da mekanik bir kontrol var.
> Kritik olanların dördü (A1, A2, E1, E2, E3, E4) eski davranış geri konularak
> **iki yönlü** kanıtlandı: test önce kırmızı, düzeltmeyle yeşil.
>
> **Güncelleme — 2026-09-12:** F bloğu simülatörde çalıştırıldı; altı maddesi
> kapandı, üçü cihaz ya da insan gerektirdiği için açık. Aynı gezinti sırasında
> koddan görülmemiş sekiz sorun daha bulundu ve düzeltildi — hepsi F bloğunun
> altında.

Baştan sona kaynak kodu okunarak çıkarıldı (2026-09-11). Simülatör çalıştırılmadı;
her madde koddaki satıra dayanıyor. `ios/Sources` altındaki ~28.000 satırın tamamı
tarandı.

**Nasıl okunur:** Her madde bir kutucuk. `Nerede` satırındaki dosya:satır doğrudan
tıklanabilir. `Neden` kısmı "bunu düzeltmezsem ne olur"u anlatır.

| Seviye | Adet | Ne demek |
|---|---|---|
| A — Kritik | 5 | Hasta zarar görebilir ya da veri sessizce kaybolur |
| B — Yüksek | 9 | Özellik vaat ettiğini yapmıyor, kullanıcı fark eder |
| C — Orta | 13 | Yanlış görünüyor, yanlış yazıyor, ya da yarım kalmış |
| D — Düşük | 11 | Ölü kod, tutarsızlık, temizlik |
| E — CI | 5 | Bu hataların tekrar girmesini engelleyecek mekanik kontroller |

Zorlama açma (`!`), `try!`, `fatalError` **hiç yok**. Türkçe/İngilizce anahtar
sayısı birebir eşit (1046/1046), format yer tutucuları (`%@`, `%d`) tam uyumlu.
Mimarî (actor model + saf `Root.route` + port/adapter) sağlam. Aşağıdakiler
o iskeletin üstündeki delikler.

---

## A — Kritik

### [x] A1. Acil durum düğmesi 5 saniye sonra sessizce ölüyor

**Nerede:** [EmergencyModel.swift:118](ios/Sources/KlinikHomeFeature/EmergencyModel.swift:118) · [HomeScreen.swift:44](ios/Sources/KlinikHomeFeature/HomeScreen.swift:44) · [HomeScreen.swift:112](ios/Sources/KlinikHomeFeature/HomeScreen.swift:112)

**Ne oluyor:** `EmergencyModel.tick()` geri sayımı actor içinde işletiyor, ama
ekran modelin durumunu **sadece** `arm/confirm/cancel/acknowledge` çağrıldıktan
sonra okuyor. Arada kimse okumuyor.

Sonuç zinciri:
1. Hasta acil düğmesine basar → sayfada `(5)` yazar ve **hiç azalmaz**.
2. 5 saniye sonra model kendini `.idle`'a çeker; ekran hâlâ `.confirming(5)`
   gösterdiği için sayfa açık kalır ve "Evet, acil durum" düğmesi durur.
3. Hasta o düğmeye basar → `confirm()` `guard case .confirming` ile döner,
   **hiçbir şey gönderilmez**, sayfa kapanır.

**Neden:** Acil çağrı gönderilmediği hâlde gönderilmiş gibi kapanıyor. Ürünün
en tehlikeli davranışı bu.

**Düzeltme:** `EmergencyModel`'i `@Observable` bir `@MainActor` sınıfa çevir, ya
da `arm()` içinden ekrana bir `AsyncStream` ver. Geri sayım ekranda gerçekten
akmalı; süre dolduğunda sayfa kendi kapanmalı ve bunu söylemeli.

### [x] A2. Acil durum "Tekrar dene" düğmesi hiçbir şey yapmıyor

**Nerede:** [HomeScreen.swift:248](ios/Sources/KlinikHomeFeature/HomeScreen.swift:248) · [EmergencyModel.swift:72](ios/Sources/KlinikHomeFeature/EmergencyModel.swift:72)

**Ne oluyor:** Gönderim başarısız olunca durum `.failed`. Ekrandaki "Tekrar dene"
`perform(.confirm)` çağırıyor; `confirm()` ise `guard case .confirming` diyor.
`.failed` durumundayken hiçbir zaman geçemez.

**Neden:** Çağrı kliniğe ulaşmamış, hasta tekrar deniyor, düğme ölü.

**Düzeltme:** `confirm()` guard'ına `.failed` durumunu ekle, ya da ayrı bir
`retry()` fiili yaz. `canRetry` alanı da hiç kullanılmıyor — `false` iken
düğme gizlenmeli.

### [x] A3. Acil ekranı yerel acil numarasını göstermiyor

**Nerede:** [HomeScreen.swift:231](ios/Sources/KlinikHomeFeature/HomeScreen.swift:231)

**Ne oluyor:** Koddaki yorum "ulaşacak numarayı sunar" diyor. Katalogda
`emergency.callLocalNumber` ve `emergency.callNumber` anahtarları da var. Ama
ekranda **numara yok, arama düğmesi yok** — sadece metin.

**Neden:** Çağrı iletilemediğinde hastanın elinde tek seçenek kalıyor ve app onu
vermiyor.

**Düzeltme:** `.failed` durumuna `Link(destination: tel:...)` düğmesi ekle.
Numara bulunduğu ülkeye göre değişmeli (`emergency.callNumber` = "%@ ara" zaten
parametreli yazılmış).

### [x] A4. Bağlantı hatalarının çoğu "çevrimdışı" sayılmıyor — kuyruk devreye girmiyor

**Nerede:** [HTTPTransport.swift:76](ios/Sources/KlinikAPI/HTTPTransport.swift:76) · [APIError.swift:98](ios/Sources/KlinikCore/APIError.swift:98)

**Ne oluyor:** Sadece üç `URLError` kodu `.offline`'a çevriliyor:
`notConnectedToInternet`, `networkConnectionLost`, `dataNotAllowed`. Geri kalan
her şey `.unknown(status:)` oluyor ve `isConnectivity` **false** dönüyor.

Kapsam dışında kalanlar:
- `cannotFindHost`, `dnsLookupFailed` → otel/havalimanı wifi'sinde en sık görülen
- `cannotConnectToHost` → sunucu kapalı, captive portal
- `secureConnectionFailed`, `serverCertificateUntrusted` → captive portal TLS kesmesi
- `internationalRoamingOff` → **yurtdışındaki hasta**, ürünün tam hedef kitlesi

**Neden:** Bu hatalarda çevrimdışı kuyruğu çalışmıyor, önbellek okunmuyor,
üstteki bant çıkmıyor. Hasta "Bir şeyler ters gitti" görüyor ve yazdığı ölçüm
kayboluyor. `notConnectedToInternet` yalnızca uçak modunda tetiklenir — yani
çevrimdışı hikâyesi pratikte en çok ihtiyaç duyulduğu anda kapalı.

**Düzeltme:** `perform`'daki `switch`e yukarıdaki kodları ekle. Bilinmeyen bir
`URLError`'ın varsayılanı da `.offline` olmalı — URLError zaten "istek sunucuya
ulaşamadı" demek.

### [x] A5. Çevrimdışıyken token yenileme başarısız olursa kullanıcı oturumdan atılıyor

**Nerede:** [SessionManager.swift:116](ios/Sources/KlinikCore/SessionManager.swift:116)

**Ne oluyor:** `performRefresh`'in `catch` bloğu **her türlü hatada** token'ları
siliyor, Keychain'i temizliyor ve `state = .expired` yapıyor. Ağ hatası ile
sunucunun "bu token yanmış" cevabı ayırt edilmiyor.

**Neden:** Uçakta / sinyalsiz yerde access token'ın ömrü dolduğu anda oturum
kapanıyor. Oturum kapanınca `clearForSignOut()` çalışırsa kuyruktaki yazılar da
gider — yani tam olarak kuyruğun korumak için var olduğu iş kaybolur.

**Düzeltme:** `catch let error as APIError where error.isConnectivity` dalında
token'lara dokunma, hatayı olduğu gibi fırlat. Sadece 401/403 geldiğinde zinciri
kapat.

---

## B — Yüksek

### [x] B1. Oturumun bittiği ekrana hiç yansımıyor

**Nerede:** [RootView.swift:21](ios/Sources/KlinikApp/RootView.swift:21) · [RootView.swift:155](ios/Sources/KlinikApp/RootView.swift:155)

**Ne oluyor:** `sessionState` yalnızca açılışta, girişten sonra ve çıkışta
okunuyor. `SessionManager` çalışma sırasında `.expired` olursa kimse haber
almıyor. `Root.route` da `.signInAgain`'e hiç ulaşamıyor.

Kilitlenme senaryosu: A5 tetiklenir → `session.state == .expired`, `sessionState`
hâlâ `.signedIn`, `identity == nil` → rota `nil` → `LaunchView` çıkar. O ekranda
sadece "Tekrar dene" var, **çıkış yok, giriş yok**. Kullanıcı uygulamayı silip
kurmadan kurtulamaz.

**Düzeltme:** `SessionManager`'a bir durum akışı ekle (`AsyncStream` ya da
`@Observable` sarmalayıcı) ve `RootView` onu dinlesin. `LaunchView`'a hiç olmazsa
"Çıkış yap" düğmesi koy — bugünkü çıkmaz sokağı o bile açar.

### [x] B2. Onam metni tek satır halinde akıyor (başlıklar, tablo, madde işaretleri kayboluyor)

**Nerede:** [Markdown.swift:28](ios/Sources/KlinikDesign/Markdown.swift:28) · [SignConsentScreen.swift:207](ios/Sources/KlinikConsentsFeature/SignConsentScreen.swift:207)

**Ne oluyor:** `AttributedString(markdown:interpretedSyntax: .full)` blok yapısını
`presentationIntent` olarak işaretler ama satır sonlarını **atar**. `Text()` bu
işaretleri yok sayar. Sonuç: `## Başlık` + paragraf + `- madde` hepsi tek blok.

`docs/TEDAVI-ONAM-METNI.md` başlıklar, numaralı bölümler ve bir **markdown tablosu**
içeriyor — tablo hiç render edilmiyor.

**Neden:** Hukukî olarak en hassas ekranda hasta okunmaz bir metin duvarı
görüyor. Aydınlatılmış onam iddiası bunun üstünde duruyor.

**Düzeltme:** Kaynağı `\n\n`'den bölüp her paragrafı ayrı `Text` olarak bir
`VStack`'te diz; başlık/madde işaretlerini kendin biçimlendir. Tablo için basit
bir satır-çift gösterimi yaz. Mevcut `MarkdownTests` yalnızca harflerin hayatta
kalmasına bakıyor — satır sonlarını test etmiyor, o yüzden yakalayamadı.

### [x] B3. İmza alanı ScrollView içinde — çizmek yerine sayfa kayıyor

**Nerede:** [SignaturePad.swift:100](ios/Sources/KlinikDesign/SignaturePad.swift:100) · [SignConsentScreen.swift:132](ios/Sources/KlinikConsentsFeature/SignConsentScreen.swift:132)

**Ne oluyor:** Ped `.gesture(DragGesture(minimumDistance: 0))` kullanıyor ve
ekranın tamamı bir `ScrollView`. `.gesture` ScrollView'ın kendi pan
tanıyıcısından düşük öncelikli; dikey hareketler çizgi değil kaydırma üretir.

**Neden:** İmza atmaya çalışan hasta sayfayı kaydırır. Yatay çizgiler tutar,
dikeyler tutmaz — yani imza yarım çıkar.

**Düzeltme:** `.highPriorityGesture(...)` kullan ve çizim sürerken
`.scrollDisabled(true)` uygula.

### [x] B4. "Sonuna kadar okunmadan imzalanamaz" kuralı yazılmamış

**Nerede:** [SignConsentScreen.swift:30](ios/Sources/KlinikConsentsFeature/SignConsentScreen.swift:30)

**Ne oluyor:** Sınıfın açıklaması bu kuralı iki kez söylüyor. Kodda kaydırma
konumunu izleyen hiçbir şey yok; imza çizilir çizilmez düğme açılıyor.

**Düzeltme:** `ScrollView` + `onScrollGeometryChange` (ya da metnin sonuna bir
`onAppear` işaretçisi) ile "sona ulaşıldı" bayrağı tut; `isEnabled` ona da
bakmalı.

### [x] B5. Çevrimdışı girilen ölçüm, sunucuya ulaştığı an damgalanıyor

**Nerede:** [RecordMeasurementView.swift:95](ios/Sources/KlinikMeasurementsFeature/RecordMeasurementView.swift:95)

**Ne oluyor:** `NewMeasurement`'ta `measuredAt` alanı **var** ve backend
(`RecordMeasurementDto.measuredAt`) kabul ediyor. Form onu hiç doldurmuyor.
Kuyruğa giren ölçüm 6 saat sonra gönderilince sunucu `measuredAt = now` yazıyor.

**Neden:** `MeasurementsAPI`'nin kendi yorumu "otelde yazılan kilo geçmiş bir anın
kaydıdır" diyor; kod tam tersini yapıyor. Takip eğrisi kayıyor.

**Düzeltme:** Tek satır — `measuredAt: Date()` ekle.

### [x] B6. Çevrimdışı ilaç bildirimi "geç alındı" olarak kaydediliyor

**Nerede:** [MedicationsAPI.swift:233](ios/Sources/KlinikAPI/MedicationsAPI.swift:233) · `backend/src/medications/medications.service.ts:310`

**Ne oluyor:** `CheckInBody`'de zaman alanı **hiç yok**. Sunucu `takenAt: now`
yazıyor ve `|now - scheduledAt| > ON_TIME_MINUTES` ise durumu `LATE` yapıyor.

**Neden:** Antibiyotiğini 09:00'da alıp sinyali 23:00'te bulan hasta, uyum
raporunda 14 saat geciken bir doz olarak görünür. B5'in aksine bunun düzeltmesi
backend'i de ilgilendiriyor.

**Düzeltme:** `CheckInBody`'ye isteğe bağlı `at: Date` eklendi, iOS `Date()`
ile dolduruyor, sunucu `MedicationsService.actedAt` ile pencereliyor: gelecekteki
bir zaman (2 dk saat kaymasından fazlası) ve iki haftadan eski bir iddia kabul
edilmiyor, o durumda varış zamanına düşüyor. 7 yeni backend testi.

**Şikayet tarafı bilerek değiştirilmedi.** `Complication.reportedAt` yanıt süresi
hedefinin ölçüldüğü saat — hastanın telefonundaki saatle ezilirse klinik,
haberi olmadığı saatlerden sorumlu tutulur. Yanına ikinci bir sütun koymak da
hiçbir ekranın göstermediği bir alan yaratırdı. Gerekçe
[ComplicationsAPI.swift](ios/Sources/KlinikAPI/ComplicationsAPI.swift:49)
içine yazıldı ki sonradan "eksik" diye düzeltilmesin.

### [x] B7. Sohbet ekranı en alta kaymıyor

**Nerede:** [ChatScreen.swift:133](ios/Sources/KlinikMessagingFeature/ChatScreen.swift:133)

**Ne oluyor:** `ScrollView` + `LazyVStack`, hiçbir yerde `ScrollViewReader` ya da
`scrollTo` yok. Ekran açıldığında en eski mesajda duruyor; soketten yeni mesaj
gelince de kaymıyor.

**Neden:** Geçmişi olan bir hasta uygulamayı açtığında aylar önceki mesajı
görüyor ve elle aşağı kaydırmak zorunda. Sohbet uygulamalarının en temel
davranışı eksik.

**Düzeltme:** `ScrollViewReader` sar, `state.messages.last?.id`'ye `.task` ve
`onChange` ile `scrollTo(..., anchor: .bottom)` yap.

### [x] B8. 3 dakikalık ses kaydı sessizce siliniyor

**Nerede:** [VoiceRecorder.swift:72](ios/Sources/KlinikApp/VoiceRecorder.swift:72) · [VoiceRecorder.swift:93](ios/Sources/KlinikApp/VoiceRecorder.swift:93)

**Ne oluyor:** `record(forDuration: 180)` kayıt cihazını 180. saniyede kendisi
durduruyor. Ekrandaki sayaç `Task.sleep(1s)` döngüsü olduğu için gerçek zamanın
biraz gerisinde kalır, yani **cihaz önce durur**. `stop()` sonra
`recorder.currentTime` okur — durmuş bir kayıtta bu **0**'dır — ve
`guard duration >= 1` ile dosyayı siler.

**Neden:** Hasta 3 dakika konuşur, mesaj hiç gönderilmez ve neden gönderilmediği
söylenmez.

**Düzeltme:** Süreyi `stop()` anında okumak yerine kayıt başlarken tut; ya da
`AVAudioRecorderDelegate.audioRecorderDidFinishRecording` ile tavana ulaşmayı
yakala.

### [x] B9. Sohbetten çıkarken kayıt durmuyor — mikrofon açık kalıyor

**Nerede:** [ChatScreen.swift:83](ios/Sources/KlinikMessagingFeature/ChatScreen.swift:83)

**Ne oluyor:** `.onDisappear` yalnızca `live.leave` ve `unsubscribe` yapıyor.
`voice.cancel()` çağrılmıyor. `tick` döngüsü de düz bir `Task` içinde döndüğü
için SwiftUI onu iptal etmiyor.

**Neden:** Kayıttayken geri tuşuna basan hastanın mikrofonu açık kalıyor, ses
oturumu (`.playAndRecord`, `.duckOthers`) etkin kalıyor. Gizlilik sorunu.

**Düzeltme:** `.onDisappear` içinde `if recording { voice.cancel() }`.

---

## C — Orta

### [x] C1. Sözlükte 12 anahtar iki kez tanımlı — yanlış metin kazanıyor

**Nerede:** `ios/Sources/KlinikCore/Resources/{tr,en}.lproj/Localizable.strings`

Aynı dosyada iki kez geçen anahtarlarda **sonuncusu** kazanır. On tanesinin
değerleri farklı:

| Anahtar | Ölü (satır) | Kazanan | Sonuç |
|---|---|---|---|
| `medication.empty` | "Henüz ilaç kaydı yok." (55) | "Bu hastaya yazılmış ilaç yok." (735) | Hastaya klinisyen dili gösteriliyor |
| `analytics.title` | "Panel" (533) | "İstatistikler" (800) | |
| `analytics.margin` | "Marj" (544) | "Kâr" (814) | |
| `analytics.revenueWithheld` | uzun açıklama (535) | kısa cümle (824) | Açıklayıcı metin gitti |
| `analytics.cityUnknown` | "Şehri girilmemiş" (545) | "%d hastanın…" (821) | |
| `medication.stopped` | "Durduruldu" (484) | "Kesildi" (741) | |
| `medication.nextDose` | "Sonraki doz" (483) | "Sıradaki doz" (742) | |
| `medication.awaitingApproval` | "Doktor onayı bekliyor" (482) | "Onay bekliyor" (738) | |
| `appointment.addToCalendar` | "Takvime ekle" (353) | "Takvimime ekle" (797) | |
| `emergency.confirmAction` | "Evet, bildir" (132) | "Evet, acil durum" (371) | |

**Düzeltme:** Yinelenenleri temizle, doğru metni seç. E1'deki testi ekle.

### [x] C2. İlaç ekranında ham `%d` görünüyor

**Nerede:** [MedicationsScreen.swift:133](ios/Sources/KlinikMedicationsFeature/MedicationsScreen.swift:133)

`Text("\(L10n.string("medication.streak")): \(adherence.streak)")` —
`medication.streak` = `"%d gündür aksatmadınız"`. Ekranda birebir
**"%d gündür aksatmadınız: 7"** yazıyor.

**Düzeltme:** `String(format: L10n.string("medication.streak"), adherence.streak)`.

### [x] C3. Çalışma saatleri ekranında gün adları İngilizce

**Nerede:** [AvailabilityScreen.swift:268](ios/Sources/KlinikAppointmentsFeature/AvailabilityScreen.swift:268)

`Calendar(identifier: .gregorian).weekdaySymbols` sabit (locale'siz) takvim
kullanıyor ve **"Mon", "Tue"** döndürüyor. `Calendar.current.weekdaySymbols`
"Pazartesi" döndürüyor. Yerel makinede doğrulandı.

Mevcut test (`AvailabilityTests.swift:200`) `dayName`'i aynı yanlış takvimle
karşılaştırdığı için bunu asla yakalayamaz.

**Düzeltme:** `Calendar.current.weekdaySymbols`. Testi de `Locale(identifier: "tr")`
ile sabitle.

### [x] C4. Çalışma saati eklenirken hata mesajı görünmüyor

**Nerede:** [AvailabilityScreen.swift:227](ios/Sources/KlinikAppointmentsFeature/AvailabilityScreen.swift:227)

`state.error` yalnızca `.loaded` dalında çiziliyor. Hiç saat yayınlamamış bir
hekim (`.empty`) pencere eklemeye çalışıp sunucudan reddedilirse: sayfa açık
kalır, kaydet düğmesi hiçbir şey yapmamış gibi görünür, **sebep hiç yazmaz**.

**Düzeltme:** `ErrorBanner`'ı `content`'in başına, `switch` dışına al.

### [x] C5. Kontrol listesi, belge yüklendikten sonra kendini yenilemiyor

**Nerede:** [ChecklistScreen.swift:89](ios/Sources/KlinikDocumentsFeature/ChecklistScreen.swift:89) · [PatientNavigation.swift:377](ios/Sources/KlinikApp/PatientNavigation.swift:377)

"Yükle" düğmesi belge ekranını **üstüne** iter. Geri dönüldüğünde kontrol listesi
görünümü hiç kaldırılmadığı için `.task` tekrar çalışmaz.

**Neden:** Hasta pasaportunu yükler, geri döner, satır hâlâ "Eksik" der. İkinci
kez yükler.

**Düzeltme:** `.onChange(of: path)` ile dönüşte yenile, ya da yükleme akışını bir
`sheet` yap ve kapanışta `reload()` çağır.

### [x] C6. Asistandan sohbete geçince iki sohbet ekranı üst üste biniyor

**Nerede:** [PatientNavigation.swift:226](ios/Sources/KlinikApp/PatientNavigation.swift:226)

```swift
path.removeLast()
path.append(.messages)
```
Asistan **sohbetten** açıldıysa yol `[.messages, .assistant]` olur. Sonuç
`[.messages, .messages]` — aynı ekranın iki kopyası. Geri tuşu kullanıcıyı yine
sohbete götürür.

**Düzeltme:** `if path.last == .assistant { path.removeLast() }` sonrasında
`if path.last != .messages { path.append(.messages) }`.

### [x] C7. Belge işleme durumu takılı kalabiliyor

**Nerede:** [DocumentScreens.swift:282](ios/Sources/KlinikDocumentsFeature/DocumentScreens.swift:282)

`pollWhileProcessing` ilk turda bekleyen iş bulamazsa **döngüden çıkar ve bir
daha çalışmaz** (`.task` yalnızca görünüm kimliği değişince yeniden koşar).
Ondan sonra yüklenen belgenin OCR durumu ancak canlı soket üzerinden güncellenir;
soket ise yalnızca `watching != nil` iken dinlenir. Klinik henüz hasta dosyası
bağlamamışsa `watching == nil` → satır sonsuza kadar "kuyrukta" görünür.

**Düzeltme:** Yükleme bittiğinde yoklamayı yeniden başlat (`@State var pollToken`
artırıp `.task(id: pollToken)` kullan).

### [x] C8. Attach başarısız olursa sonraki mesaj yanlış tiple gidiyor

**Nerede:** [ChatModel.swift:263](ios/Sources/KlinikMessagingFeature/ChatModel.swift:263)

`messageType` `state.pendingMediaKey != nil` ise `.image`/`.audio` döndürüyor.
Yükleme başarılı ama gönderim başarısız olduğunda `pendingMediaKey` duruyor;
kullanıcı düz metin yazıp gönderince istek `type: IMAGE, mediaKey: null` olarak
çıkıyor.

**Düzeltme:** `send()` gövdesinde tipi **parametre olarak gelen** `mediaKey`'e
göre hesapla, `state`'e değil. Ya da gönderimden önce bekleyen anahtarı ekrana
"eklenmiş dosya" olarak göster ve kullanıcıya iliştirme/atma seçeneği ver.

### [x] C9. Her tuş vuruşunda soket "yazıyor" olayı gönderiliyor

**Nerede:** [ChatScreen.swift:279](ios/Sources/KlinikMessagingFeature/ChatScreen.swift:279) · [LiveConnection.swift:230](ios/Sources/KlinikApp/LiveConnection.swift:230)

`.onChange(of: draft)` kısıtlamasız `typing` emit ediyor. 200 karakterlik bir
mesaj 200 soket paketi demek.

**Düzeltme:** 2–3 saniyelik bir throttle koy.

### [x] C10. "Yazıyor" göstergesi takılı kalıyor

**Nerede:** [ChatModel.swift:319](ios/Sources/KlinikMessagingFeature/ChatModel.swift:319)

`setTyping(_:isTyping: true)` ekleniyor; kimse `false` göndermiyor. Yalnızca o
kişiden mesaj gelirse siliniyor. Klinik yazmaya başlayıp vazgeçerse gösterge
ekranda sonsuza kadar kalır.

**Düzeltme:** Her `typing` olayında 5 saniyelik bir zamanlayıcı kur, dolunca sil.

### [x] C11. Soket, süresi dolmuş token'la yeniden bağlanıyor

**Nerede:** [LiveConnection.swift:80](ios/Sources/KlinikApp/LiveConnection.swift:80)

Yorum "her bağlantıda token taze alınır" diyor. Gerçekte token bir kez alınıp
`SocketManager`'ın `.extraHeaders`'ına gömülüyor; kütüphanenin kendi otomatik
yeniden bağlanması aynı başlığı tekrar kullanıyor. Token ömrü dolduktan sonra her
reconnect handshake'te reddedilir ve canlı teslimat sessizce ölür.

**Düzeltme:** `.disconnect` olayında `manager`'ı yıkıp `start()`'ı taze token'la
tekrar çağır; ya da `SocketManager.config`'i her denemeden önce güncelle.

### [x] C12. Kuyruk boşaldığında ekranlar haberdar olmuyor

**Nerede:** [SyncCoordinator.swift:82](ios/Sources/KlinikApp/SyncCoordinator.swift:82)

`appliedRevision` yazılıyor ama **hiçbir yerde okunmuyor**. Belgelenmiş amacı
("ekran bir kez yenilesin") gerçekleşmemiş.

**Neden:** Çevrimdışı yazılan ölçüm/mesaj gönderildikten sonra da ekranda
"gönderilmedi" rozetiyle durmaya devam ediyor; ancak ekrandan çıkıp girince
düzeliyor.

**Düzeltme:** İlgili ekranlarda `.onChange(of: sync.appliedRevision)` ile yeniden
yükle.

### [x] C13. Reddedilen yazı sonsuza kadar yeniden gönderiliyor

**Nerede:** [SyncEngine.swift:182](ios/Sources/KlinikSync/SyncEngine.swift:182)

`.rejected` ("bu hâliyle asla başarılı olmayacak") olan bir kayıt kuyruktan
çıkarılmıyor ve `sync()` içinde `attempts >= maxAttempts` kontrolü **yok**. Her
senkron turunda tekrar gönderiliyor, `attempts` sınırsız büyüyor. Ayrıca
kullanıcıya durum ancak 5 turdan sonra "ilgi bekliyor" olarak bildiriliyor;
o zamana kadar "gönderilmeyi bekliyor" yazıyor.

**Düzeltme:** Döngünün başına `guard entry.attempts < maxAttempts else { continue }`
ekle (dosya kuyruğunda `UploadQueue.drain` bunu zaten yapıyor). `.rejected`
durumunda `attempts`'i doğrudan `maxAttempts`'e çek — bir kere reddedilen zaten
reddedilmiştir.

---

## D — Düşük / temizlik

### [x] D1. Çakışma çözme mekanizmasının tamamı erişilemez durumda

`baseVersion` alanı `PendingWrite`'ta var, SQLite'ta sütunu var, ama **hiçbir
çağıran onu doldurmuyor** ([grep: yalnızca tanım satırları](ios/Sources/KlinikAPI/PendingWrite.swift:32)).
Kuyruğa girebilen beş uç noktanın hepsi POST/PATCH-create. Dolayısıyla sunucu
`VERSION_CONFLICT` üretemiyor; `SyncConflict`, `recordConflict`, `resendMine`,
`keepTheirs` ve `PendingChangesScreen`'in çakışma bölümü **hiç çalışmıyor**.
**Yapıldı: belgelendi, silinmedi.** Mekanizmanın kendisi test edilmiş ve
doğru; eksik olan tek şey onu tetikleyecek bir *düzenleme* ucu. Silmek, ilk
kuyruğa alınan düzenlemede yeniden yazmak demek olurdu. Gerekçe ve neyin onu
açacağı [PendingWrite.swift:32](ios/Sources/KlinikAPI/PendingWrite.swift:32)
içine yazıldı.

### [x] D2. Geçici dosyalar temizlenmiyor

- [FilePicker.swift:85](ios/Sources/KlinikApp/FilePicker.swift:85) seçilen dosyayı
  `temporaryDirectory`'ye kopyalıyor; yükleme başarılı olunca **silinmiyor**.
- [DocumentsModel.swift:191](ios/Sources/KlinikDocumentsFeature/DocumentsModel.swift:191)
  indirilen belgeyi `tmp/documents/<id>/` altına yazıyor, hiç temizlemiyor.
- `ChatScreen.attach` seçilen dosyayı silmiyor (ses kaydını siliyor — tutarsız).

Sonuç: pasaport, laboratuvar raporu ve yara fotoğrafı kopyaları telefonda
birikiyor.

### [x] D3. Kuyruktaki dosya yolu mutlak yol olarak saklanıyor

**Nerede:** [SQLiteStore.swift:367](ios/Sources/KlinikSyncStore/SQLiteStore.swift:367)

iOS'ta uygulama konteyner yolu (`/var/mobile/Containers/Data/Application/<UUID>/`)
**güncellemede değişir**. Güncelleme sonrası bekleyen yüklemelerin `fileExists`
kontrolü `false` döner → "dosya kayıp" denir, oysa dosya duruyor.

**Düzeltme:** Yalnızca dosya adını sakla, dizini her açılışta
`PendingUpload.directory()` ile yeniden çöz.

### [x] D4. Yazma işlemi başarılı olunca "çevrimdışı" bandı kalkmıyor

**Nerede:** [APIClient.swift:198](ios/Sources/KlinikAPI/APIClient.swift:198)

`connection?.reachedServer()` yalnızca `cacheable` (yani GET) dalında çağrılıyor.
Başarılı bir POST bağlantının döndüğünü kanıtlar ama sayaç sıfırlanmaz ve
`connectionProved()` tetiklenmez.

### [x] D5. Kilit ekranı biyometri yokken bozuk etiket gösteriyor

**Nerede:** [BiometricLock.swift:227](ios/Sources/KlinikApp/BiometricLock.swift:227)

Cihazda parmak izi/yüz yoksa ama parola varsa `kind == .none` → `localizedName`
boş string. Düğme `"%@ ile aç"` formatıyla **" ile aç"** yazıyor, ikon da
`faceid` kalıyor.

**Düzeltme:** `.none` için `biometrics.unlockWithPasscode` diye ayrı bir metin.

### [x] D6. Face ID istemi sırasında gizlilik örtüsü yanıp sönüyor

**Nerede:** [RootView.swift:47](ios/Sources/KlinikApp/RootView.swift:47)

Sistem izin/biyometri diyalogları uygulamayı `.inactive` yapıyor; örtü
`scenePhase == .active` şartına bağlı olduğu için her diyalogda bir an beliriyor.
`.background` ve `.inactive` ayrımını yap (uygulama anahtarı görüntüsü yalnızca
`.background`'da alınır — `.inactive` için de örtmek isteniyorsa bilinçli bir
karar olmalı).

### [x] D7. `.constant(...)` ile açılan sayfalar kapatılamıyor

**Nerede:** [HomeScreen.swift:44](ios/Sources/KlinikHomeFeature/HomeScreen.swift:44) ·
[DocumentScreens.swift:74](ios/Sources/KlinikDocumentsFeature/DocumentScreens.swift:74) ·
[PrescribingScreen.swift:98](ios/Sources/KlinikMedicationsFeature/PrescribingScreen.swift:98)

Sabit binding'e SwiftUI `false` yazamaz. Acil sayfası aşağı kaydırılarak
kapatılırsa model **silahlanmış hâlde kalır** ve durum tutarsızlaşır.

**Düzeltme:** `Binding(get:set:)` kullan; `set` içinde modeli de `.idle`'a al.

### [x] D8. On ekranda başlık yok

`.navigationTitle` yok: `ChatScreen`, `DocumentListView`, `BodyChartView`,
`LabTrendScreen`, `LabReviewScreen`, `FollowUpScreen`, `PhotoScreens`,
`ComplicationScreens`, `PatientFileScreen`, `StaffHomeScreen`. Yönlendirme
tarafında da yalnızca `.patient(id:name:)` başlık veriyor
([StaffNavigation.swift:256](ios/Sources/KlinikApp/StaffNavigation.swift:256)).
Bu ekranlara girildiğinde gezinme çubuğunda sadece geri oku var.

### [x] D9. On yedi ekranda aşağı çekip yenileme yok

`.task` var ama `.refreshable` yok: AISettings, Appointments, Complications,
Consents, SignConsent, Documents, Home, FollowUp, LabTrend, LabReview,
Medications, NotificationSettings, Chat, Measurements, Patients, Photos, Survey.
Bir hata durumunda kullanıcının tek çıkışı ekrandan çıkıp girmek.

### [x] D10. Ölü API yüzeyi

**Yapıldı.** `wasKept`, `LabResult.numericValue`, `SQLiteUploadStore.update` ve
`InMemoryUploadStore.update` silindi. `requiresReauthentication` artık
kullanılıyor: `RootView` kimlik çağrısında 401/kilit alırsa "tekrar dene"
göstermek yerine oturumu kapatıyor. `appliedRevision` C12 ile bağlandı.

İki tanesi silinmedi:
- `PendingUpload.contentType` — sunucu dosyanın türünü baytlarından tespit
  ediyor (istemcinin `Content-Type` iddiası güvenilmez), yani gönderilecek bir
  yer yok. Kuyruğun kendi kaydı olarak kalıyor, sütunu bir migration'a değmez;
  neden orada olduğu koda yazıldı.
- **Katalogda 121 "kullanılmayan" anahtar** taramada çıktı ama sayı güvenilir
  değil: `AuditAPI` gibi yerler anahtarı `let key = "audit.entity.\(x)"` diye
  kuruyor ve düz arama bunu göremiyor. Gerçekten boşta olanların çoğu da henüz
  yazılmamış ekranların (hasta acil rehberi, oturum listesi) sözlüğü. Silmek
  hastaya ham anahtar gösterme riski taşıdığı için dokunulmadı.

### [x] D11. Ağ zaman aşımı ayarlanmamış

**Nerede:** [HTTPTransport.swift:42](ios/Sources/KlinikAPI/HTTPTransport.swift:42)

`URLSession.shared` varsayılan 60 saniyelik istek zaman aşımıyla kullanılıyor.
Çevrimdışı hikâyesinin çalışması için hızlı başarısız olmak gerekir; kötü bir
otel bağlantısında kullanıcı bir dakika donmuş ekrana bakar.

**Düzeltme:** `timeoutIntervalForRequest = 15`, `timeoutIntervalForResource = 120`
olan kendi `URLSessionConfiguration`'ını kur.

Ayrıca `URLSession.shared` iki yerde doğrudan kullanılıyor
([DocumentsModel.swift:191](ios/Sources/KlinikDocumentsFeature/DocumentsModel.swift:191),
[PatientNavigation.swift:417](ios/Sources/KlinikApp/PatientNavigation.swift:417))
— bu istekler uygulamanın hata eşlemesinden, zaman aşımından ve gelecekteki
sertifika sabitlemesinden muaf.

---

## E — CI'ya eklenecek mekanik kontroller

Bu hataların yeniden girmesini engelleyecek, insan gözü gerektirmeyen kontroller.

### [x] E1. Sözlükte yinelenen anahtar testi

`LocalizationTests` katalogları **sözlüğe** okuyor
([LocalizationTests.swift:36](ios/Tests/KlinikCoreTests/LocalizationTests.swift:36)),
bu yüzden yinelenenler sessizce eziliyor. Anahtarları diziye toplayıp
`Set(keys).count == keys.count` iddiası ekle. C1'in on maddesi böyle kaçtı.

### [x] E2. `L10n.string` / `String(format:)` uyum testi

Yer tutucu içeren bir anahtarın `String(format:)` olmadan kullanılmadığını
doğrula. C2 tam olarak budur. (Bu analiz sırasında yazılan tarama zaten çalışıyor
— testleştir.)

### [x] E3. Sabit locale kullanımı yasağı

`Calendar(identifier:` + `weekdaySymbols`/`monthSymbols` birleşimini yasakla
(C3). `design/scripts/check-isolation.mjs` yanına ikinci bir tarayıcı olarak
konabilir.

### [x] E4. Gezinilebilir her ekranın başlığı olmalı

`navigationDestination` içinde üretilen her görünümün ya kendisinde ya da
çağrıldığı yerde `.navigationTitle` bulunmalı (D8).

### [x] E5. Markdown blok testi

`Markdown.attributed`'in çıktısında satır sonlarının hayatta kaldığını iddia et
(B2). Mevcut test yalnızca harflere bakıyor.

---

## F — Koddan doğrulanamayanlar

> **Durum — 2026-09-12:** Simülatör çalıştırıldı. Uygulamanın tamamı, `docs/openapi.json`
> yüzeyinin tamamını cevaplayan yerel bir *stub klinik*'e (kendi imzalı sertifikasıyla
> HTTPS; `KlinikAPIBaseURL` DEBUG geçersiz kılması ile bağlandı) karşı XCUITest ile
> baştan sona gezildi: personel kabuğu, hasta kabuğu, açık/koyu tema ve
> `UICTContentSizeCategoryAccessibilityXXXL`. Altı madde kapandı, üçü cihaz/insan
> gerektirdiği için açık kaldı.

- [x] Dynamic Type XXXL'de `ResultRow` ve `ChecklistRow` taşıyor mu? **Taşıyordu, ve
      yalnız onlar değil.** O boyutta SwiftUI sığmayan kelimeyi ikiye bölüyor:
      hasta listesi "Ayşe Yılma / z", dosya başlığındaki üç rozet harf harf alt alta,
      tahlil tablosu "analyte / Name" · "val / ue", inceleme düğmeleri "Ona / yla"
      ve "Düz / elt". Düzeltildi (`97adb17`): `Badge` kırpmak yerine sarıyor,
      yeni `FlowRow` düzeni rozetleri kendi genişliklerinde alt satıra indiriyor,
      `AdaptiveStack` çiftleri erişilebilirlik boyutlarında alt alta diziyor.
- [x] `SignaturePad` içinde imza gerçekten çiziliyor mu (B3)? **Çiziliyor.** Pad'in
      üstünde sürükleme çizgi bıraktı, sayfa kaymadı, "İzin ver" düğmesi imza
      alınınca etkinleşti.
- [x] Onam metni ekranda tek blok mu akıyor (B2)? **Akmıyor.** Başlıklar, madde
      işaretleri ve tablo ayrı ayrı çiziliyor; tablo etiket/değer kartı olarak.
- [x] Karanlık modda `Tokens.Palette`: gündem, hasta listesi, hasta dosyası, onaylar,
      tahlil onayı ve ilaç ekranları koyu temada okunur; renkli kart yüzeyleri ve
      rozetler doğru tonlarda.
- [ ] VoiceOver ile kritik akışlar (acil, onam imzası, laboratuvar tablosu). **Bir
      insan gerekiyor**; mekanik kontrol bunu göremez (bkz. ERISILEBILIRLIK.md).
- [ ] Uygulama güncellemesinden sonra bekleyen yüklemelerin hayatta kalması (D3).
      İki ayrı sürümün üst üste kurulmasını gerektiriyor.
- [ ] Face ID istemi sırasında gizlilik örtüsünün yanıp sönmesi (D6). Simülatörde
      biyometri kurulu değil; gerçek cihaz gerekiyor.

### F bloğu çalışırken bulunan ve düzeltilenler

Gezinti sırasında koddan görülmemiş olanlar — hepsi `d94a567`'de:

- Finans, istatistik, denetim ve dışa aktarım ekranları, **her türlü** hata için
  "bu hesabın erişimi yok" diyordu; sunucuya ulaşılamaması da, 500 de, çözümlenemeyen
  yanıt da. Artık yalnız 403 reddi; gerisi hatayı söylüyor ve tekrar denetiyor.
- Sunucudan gelen tanınmayan değerler ekrana ham anahtar olarak çıkıyordu
  (`photo.finding.…`, `ai.missing.…`). `L10n.name(_:_:)` değerin kendisine düşüyor.
- Personel tarafındaki hasta dosyası hastanın kendi menü etiketlerini kullanıyordu:
  "Ölçümlerim", "Belgelerim", "Tahlil sonuçlarım". Seyahat ekranı doktora
  "Doktorunuz uçabileceğinizi onayladı" diyordu.
- "Onay bekleyen yorumlar" ve "Ameliyat öncesi belgeler" başlıkları çubuğa sığmıyordu.
- Yüklenemeyen fotoğraf 220 puntoluk boşluk bırakıyordu; imzalı bağlantı hiç
  gelmezse spinner sonsuza dönüyordu.
- Hesap ekranında art arda iki "Güvenlik" başlığı vardı.
- Ameliyat öncesi kontrol listesi klinik tarafından işlenemiyordu (yükleme yok).
- Hasta ana ekranında beş kutu iki sütuna sığmayıp acil düğmesini yalnız bırakıyordu.

---

## Not

Aşağıdakiler **kontrol edildi ve temiz çıktı**, tekrar bakmaya gerek yok:

- Zorlama açma (`!`), `try!`, `fatalError`: hiç yok.
- Türkçe/İngilizce anahtar sayısı ve kümesi birebir aynı (1046).
- Format yer tutucuları iki dilde tam uyumlu (0 uyuşmazlık).
- `Root.route` saf fonksiyon, hasta/personel ayrımı testli.
- `SessionManager`'ın eşzamanlı yenileme birleştirmesi (tek kullanımlık refresh
  token'ı iki kez harcamıyor) doğru yazılmış.
- `Idempotency-Key` ilk denemede de gönderiliyor; backend hatada anahtarı serbest
  bırakıyor, yani başarısız bir yazı tekrar denenebiliyor.
- `SyncCoordinator.sync()`'in yeniden girme koruması (bayrak `await`'ten önce
  kaldırılıyor) doğru.
- `keep()` içindeki hata değişkeni gölgeleme sorunu daha önce düzeltilmiş.
