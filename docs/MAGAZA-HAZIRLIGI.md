# App Store Hazırlığı (T7.6)

Bu belge **koddan çıkarıldı**, genel bir şablon değil. Apple'ın gizlilik
beyanı yanlış doldurulduğunda sonuç yalnız ret değil: sağlık verisi hakkında
gerçek olmayan bir beyandır.

Doldurma sırası: App Store Connect → uygulama → *App Privacy*, sonra
*App Information*, sonra sürüm.

---

## 1. App Privacy (veri beyanı)

### "Sizi izlemek için kullanılan veri"

**Hiçbiri.** Uygulamada reklam kimliği, üçüncü taraf analitik SDK'sı, çökme
raporlayıcı ve tanımlama bilgisi yok. Bağımlılıklar GRDB (yerel veritabanı) ve
socket.io (kendi sunucumuza bağlantı) — ikisi de hiçbir yere veri göndermiyor.

> `KlinikAnalyticsFeature` modülü **kliniğin kendi iş istatistikleri ekranı**
> (ciro, doluluk). Kullanıcı takibi değil; adı yüzünden yanlış anlaşılmasın.

### "Sizinle ilişkilendirilen veri"

Hepsi hesabınıza bağlı, çünkü bu bir hasta dosyası — anonim toplanan hiçbir şey
yok.

| Apple kategorisi | Ne | Amaç |
|---|---|---|
| **Contact Info** — Ad, e-posta, telefon | Hasta kaydı | Uygulama işlevi |
| **Health & Fitness** — Sağlık | Ölçümler, ilaçlar, şikâyetler, anket yanıtları, tahliller, Apple Health'ten kilo ve nabız | Uygulama işlevi |
| **User Content** — Fotoğraflar/videolar, ses, diğer | Yara fotoğrafları, belgeler, sesli mesaj, imza | Uygulama işlevi |
| **User Content** — Müşteri desteği | Klinikle mesajlaşma | Uygulama işlevi |
| **Identifiers** — Kullanıcı kimliği | Hesap kimliği, bildirim cihaz jetonu | Uygulama işlevi |
| **Location** — Hassas konum | **Yalnız acil durum butonuna basıldığında** | Uygulama işlevi |
| **Sensitive Info** | *Toplanmıyor* | — |
| **Diagnostics** | *Toplanmıyor* | — |
| **Usage Data** | *Toplanmıyor* | — |

**Konum için not:** izin metni bunu yazıyor ve kod da böyle davranıyor — alarm
konumu beklemeden gidiyor, konum varsa arkasından ekleniyor. "Uygulama
kullanılırken" izni isteniyor, arka planda hiç istenmiyor.

**Üçüncü taraf paylaşımı:** yok. Veri yalnız kliniğin kendi sunucusuna gidiyor.

> **Yapay zekâ katmanı istisnası:** klinik AI sağlayıcısını açtıysa, mesaj
> triyajı, tahlil yorumu ve çeviri için **kimliksizleştirilmiş** metin
> sağlayıcıya gidiyor — ad, dosya numarası, telefon ve e-posta çıkarılarak, ve
> sıfır-saklama sözleşmesi yoksa istek reddedilerek. Bu, uygulamanın değil
> kliniğin veri işleyen seçimi; aydınlatma metninde anlatılıyor. Apple'ın
> formunda ayrı bir kutusu yok, ama App Review notlarında yazın.

## 2. Yaş sınırı

Anketi doldururken **"Medical/Treatment Information" → Infrequent/Mild**
işaretleyin. Uygulama tıbbi takip bilgisi gösteriyor ama tanı koymuyor, ilaç
önermiyor ve tedavi tavsiyesi vermiyor — bu ayrım ürünün her yerinde yazılı.

Diğer kategorilerin hepsi **None**. Beklenen sonuç: **12+**.

## 3. App Review notları (zorunlu)

Apple bu uygulamayı **açamaz**: davetle hesap açılıyor, personel tarafında
iki faktör var, ve boş bir hesapta gösterilecek hiçbir şey yok. Not alanına
şunlar girilmeli:

```
Bu uygulama bir kliniğin hasta takip sistemine bağlanır. Hesaplar davetle
açılır, bu yüzden inceleme için hazır iki hesap bırakıyoruz:

Hasta:    <e-posta> / <parola>
Personel: <e-posta> / <parola>   (2FA kodu: <TOTP secret> veya kod isteyin)

Sunucu: <adres>  (demo verisiyle dolu)

Görmek istediğiniz akış:
- Hasta girişi → ana ekran → ölçüm ekleme → mesaj gönderme
- İlaçlar ekranı → "İçtim" işaretleme
- Personel girişi → ajanda → bir hasta dosyası

Acil durum butonu gerçek bir çağrı başlatmaz; kliniğin kuyruğuna kayıt düşer.
Sağlık verisi izni yalnız kilo ve nabız okur, hiçbir şey yazmaz.
```

> **Bunu doldurmadan göndermeyin.** Giremediği bir uygulamayı inceleyen
> Apple'ın verdiği yanıt "Guideline 2.1 — hesap bilgisi eksik" oluyor ve tur
> bir hafta sürüyor.

## 4. Mağaza metni

### Türkçe

**İsim:** Klinik Takip
**Alt başlık:** Ameliyat sonrası takibiniz, tek yerde

**Açıklama:**

```
Kliniğinizle aranızdaki her şey tek uygulamada: ameliyat öncesi belgeleriniz,
ilaç saatleriniz, kontrol randevularınız ve doğrudan klinikle mesajlaşma.

• İlaçlarınız — hangi ilacı ne zaman alacağınız, ve tek dokunuşla "içtim"
• Ölçümleriniz — kilo, tansiyon, ateş; hepsi bir eğride
• Belgeleriniz — pasaport, tahlil, EKG: neyin eksik olduğunu görün ve yükleyin
• Mesajlaşma — kendi dilinizde yazın, klinik kendi dilinde okusun
• Şikâyet bildirimi — bir şey ters giderse fotoğrafıyla anlatın
• Yolculuğunuz — uçuş, otel, karşılama ve uçuş onayınız

Çevrimdışıyken de çalışır: bağlantı yokken yazdığınız her şey telefonda durur
ve bağlantı gelince kendiliğinden gönderilir.

Bu uygulama tanı koymaz ve tedavi önermez. Kliniğinizin takip aracıdır.
Acil bir durumda 112'yi arayın.
```

**Anahtar kelimeler:** klinik,hasta takip,ameliyat sonrası,ilaç hatırlatma,
sağlık turizmi,kontrol randevusu,tahlil

### English

**Subtitle:** Your after-surgery follow-up, in one place

Açıklamanın İngilizcesi aynı sırayla; çeviri değil, aynı şeyi İngilizce
söyleyen bir metin olmalı — İngilizce konuşan hasta bu kliniğin asıl hedef
kitlesi.

## 5. Ekran görüntüleri

Altı ekran, sırayla. Hepsi **demo verisiyle** alınmalı — gerçek hasta
görüntüsü mağazaya konmaz:

1. Hasta ana ekranı (beş büyük eylem)
2. İlaçlar — bugünün dozları
3. Ölçümler — kilo eğrisi ve hedef çizgisi
4. Belgeler — ameliyat öncesi kontrol listesi, ikisi eksik
5. Mesajlaşma — çeviri düğmesi görünür
6. Yolculuk — uçuş ve uçuş onayı

Gerekli boyutlar: 6.9" ve 6.5" iPhone. iPad'i desteklemiyoruz, o yüzden
istenmiyor.

## 6. Teknik kutucuklar

| Alan | Değer | Neden |
|---|---|---|
| İhracat uyumu | `ITSAppUsesNonExemptEncryption: false` | Yalnız TLS ve platformun kendi Keychain/Data Protection'ı; kendi kriptografimiz yok |
| Kategori | Medical (birincil), Health & Fitness (ikincil) | |
| Desteklenen cihaz | iPhone, iOS 17+ | |
| Diller | Türkçe (temel), İngilizce | |

`ITSAppUsesNonExemptEncryption` artık Info.plist'te — her yüklemede sorulmasın
diye.

## 7. Gönderim öncesi son kontrol

- [ ] APNs anahtarı sunucuda ve bildirim gerçek cihaza düşüyor (KLINIKTEN 12)
- [ ] Onam metni hekim ve avukattan geçti, `[KLİNİK ADI]` alanları dolu (KLINIKTEN 13)
- [ ] Belge listesi gözden geçirildi (KLINIKTEN 14)
- [ ] Gizlilik politikası URL'i canlı ve erişilebilir
- [ ] Destek URL'i ve destek e-postası çalışıyor
- [ ] Demo hesapları açık ve iki faktörü çalışıyor
- [ ] VoiceOver ile bir insan gezdi ([ERISILEBILIRLIK](ERISILEBILIRLIK.md))
- [ ] İlaç etkileşim tablosu ve triyaj ifadeleri bir eczacı/klinisyenden geçti
