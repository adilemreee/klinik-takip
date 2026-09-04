# Klinikten İstenenler

Yazılımda **eksik kod yok**. Aşağıdaki on bir maddede eksik olan şey veri ve
karar — ve bunları uydurmak, olmamalarından kötü olur. Bir eczacının
onaylamadığı etkileşim tablosu, doğrulanmamış bir acil numara ya da uydurulmuş
bir AI fiyatı, **doğru görünen ve olmayan** şeylerdir.

Bu dosya doldurulmak için. Yanındaki `klinikten/` klasöründe beş CSV var,
**şu anki veriyle önceden doldurulmuş** — boş sayfaya bakmak yerine mevcut
satırları onaylayın, düzeltin ya da silin.

> **2026-09-04 güncellemesi:** Doldurabileceklerimi doldurdum. İlaç tablosu
> **20 bileşen / 18 çiftten 52 bileşen / 87 çifte**, triyaj ifadeleri **105'ten
> 239'a** çıktı. Bu tabloları *büyüttüm*, **onaylamadım** — borç zaten
> "bir eczacı/klinisyen gözden geçirdi" özelliğiydi ve onu ben veremem.
> Aşağıda her maddede ne yaptığımı ve neyi yapamadığımı ayrı ayrı yazdım.

> **CSV'ler noktalı virgülle ayrılmıştır ve BOM taşır**, yani Türkçe Excel'de
> çift tıklayınca düzgün açılır. Türkçe karakterler bozuk görünüyorsa dosyayı
> bana söyleyin, biçimi değiştiririm.

---

## Önce: Ne Nereye Gider

Depo **herkese açık**. Doldurduğunuz her şey oraya girmez.

| | Nereye |
|---|---|
| 1–5 arası CSV'ler, klinik logosu, fotoğraf kararı | **Depoya girer** — bunlar klinik referans verisi, gizli değil |
| Kur kaynağı, AI sözleşmesi, AI fiyatları | **Depoya girmez** — işletme yapılandırması, `OPERASYON-LOCAL.md`'ye ya da sunucu ortam değişkenlerine |
| **Yedek şifreleme parolası** | **Hiçbir dosyaya yazmayın.** Aşağıda yalnız "kasaya alındı mı" diye soruyorum |

---

# A. Klinik İçeriği (bir uzmanın gözden geçirmesi gerekiyor)

## 1. İlaç etkileşim tablosu — **bir eczacı**

📄 `klinikten/1-ilac-bilesenleri.csv` (20 satır) ve
`klinikten/2-ilac-etkilesimleri.csv` (18 satır)

**Neden gerekiyor:** Etrafındaki mekanizma hazır ve testli — marka/jenerik isim
eşleştirme, doz ve form temizleme, çift karşılaştırma, uyarının nasıl gösterildiği.
Tablonun kendisi bu depo için yazılmış bir başlangıç seti ve **hiçbir eczacı
görmedi**.

**Şu an ne oluyor:** Uyarılar çalışıyor ama tablo küçük. Sistem bunu saklamıyor —
her yanıt tanımadığı ilaçları ve kaç çift karşılaştırdığını söylüyor, ve arayüzde
sabit bir uyarı var: *"Uyarı olmaması güvenli olduğu anlamına gelmez."*

**Ne yaptım:** Tabloyu bu kliniğin gerçekten yaptığı ameliyatlara göre
genişlettim — DOAC'lar (Xarelto, Eliquis, Pradaxa), ameliyat sonrası ağrı
kesiciler (diklofenak, metamizol, morfin, petidin), peri-operatif antibiyotik ve
antifungaller, bariatrik sonrası reflü/bulantı ilaçları (pantoprazol,
ondansetron, metoklopramid), hastanın **zaten kullanarak geldiği** ilaçlar
(SSRI'lar, amiodaron, digoksin, tamoksifen, izotretinoin, semaglutid/Ozempic) ve
ilaç saymadığı iki bitkisel: **sarı kantaron ve ginkgo**.

Eklediğim kural sınıfları: serotonin sendromu yolları, QT uzatan kombinasyonlar,
statin + makrolid/antifungal, SSRI'nın kanama riski, NSAİİ + kortikosteroid,
ACE/ARB + spironolakton.

**Ne yapamadım:** Bunların hiçbirini bir eczacı görmedi. Tablo büyüdü, güvenilir
*olmadı* — ve büyüdüğü için daha yetkili görünüyor, ki bu tek başına bir risk.
Başlıktaki uyarı yerinde duruyor.

**Nasıl doldurulur:**
- `1-ilac-bilesenleri.csv` → her bileşenin **hastanın yazacağı** isimleri. Marka
  adları önemli: hasta "Augmentin" yazar, "amoksisilin/klavulanik asit" değil.
  Türkiye'de satılan marka adlarını ekleyin.
- `2-ilac-etkilesimleri.csv` → çiftler. Şiddet dört değerden biri:
  - `CONTRAINDICATED` — birlikte kullanılmamalı
  - `MAJOR` — ciddi, klinisyeni **kesintiye uğratır**
  - `MODERATE` — gösterilir, kesintiye uğratmaz
  - `MINOR` — gösterilir
  - *Yalnız ilk ikisi diyalog açar. Hafif bir etkileşimde kesintiye uğratmak,
    kliniğe diyaloğu okumadan kapatmayı öğretmenin yoludur.*
- "not" sütunu klinisyenin ekranda göreceği cümledir; kısa ve eylem bildiren olsun.
- Kliniğin sık kullandığı ilaçlar listede yoksa **satır ekleyin**.

---

## 2. Triyaj kırmızı bayrak listesi — **bir klinisyen**

📄 `klinikten/3-triyaj-kirmizi-bayraklar.csv` (15 bayrak)

**Neden gerekiyor:** Hangi ifadelerin acil sayılacağı klinik içeriktir. Bu tarama
**yapay zekâ kapalıyken de çalışan** deterministik katmandır — yani kırmızı bayrak
listesi, modelin bozulduğu gün geriye kalan tek şeydir.

**Şu an ne oluyor:** 15 bayrak var (8 `EMERGENCY`, 7 `URGENT`). Model triyaj
seviyesini **yükseltebilir ama asla düşüremez** — yani bu liste bir tabandır.

**Ne yaptım:** İfade kapsamını 105'ten 239'a çıkardım. **Kategorileri
değiştirmedim** — hangi durumun acil sayılacağı klinik içerik ve olduğu gibi
duruyor. Eklediğim şey dilbilimsel: hastanın gerçekten yazdığı biçimler
("nefesim daralıyor", "dikişim attı", "her yediğimi çıkarıyorum", "ağrım 10",
"göğsümde baskı"), ve İngilizce karşılıkları.

Genişletilmiş ağı gerçekçi mesajlara karşı denedim: 12 acil/öncelikli mesajın
hepsi yakalandı, ve *"Yara yerim güzel iyileşiyor, dikişler duruyor"* gibi içinde
"dikiş" geçen sıradan bir mesaj **yanlış alarm üretmedi**.

**Ne yapamadım:** Kategorilerin doğruluğu — hangi şikâyetin `EMERGENCY`, hangisinin
`URGENT` olduğu — hâlâ klinik bir karar.

**Nasıl doldurulur:**
- "kökler" hastanın yazabileceği ifadelerin **başlangıçlarıdır** ("nefes alam" →
  "nefes alamıyorum", "nefes alamadım" hepsini yakalar). Büyük/küçük harf ve
  Türkçe karakterler otomatik katlanıyor, siz normal yazın.
- Eksik bulduğunuz ifadeleri ekleyin — özellikle **hastaların gerçekten yazdığı**
  günlük ifadeleri, tıbbi terimleri değil.
- **Bilinen sınır:** tarama yalnız TR ve EN. Almanca/Rusça/Arapça yazan hasta bu
  taramadan geçmez; yalnız AI geçişini alır (o da kapalıyken hiç). Her hâlükârda
  bir insana ulaşır, ama bunu bilerek kabul ediyorsunuz.

---

## 3. PROM anketi ve alarm eşikleri — **bir klinisyen**

📄 `klinikten/5-prom-anketi.csv` (5 soru + kilometre taşları)

**Neden gerekiyor:** Sorular şartnamenin kendi listesinden (ağrı, şişlik, uyku,
memnuniyet), ifadeler bu depo için yazıldı. **Alarm eşikleri savunulabilir yer
tutucular, klinik rehber değil.**

**Nasıl doldurulur:**
- `yon` alanı kritik: **ters yazılırsa her uyarı tersine döner.** Ağrı
  `higher-is-worse`, uyku `higher-is-better`.
- `alarm esigi` → bu değere ulaşan cevap, eğilimden bağımsız olarak klinisyene
  gösterilir. Ağrı için tavan (≥8), uyku için taban (≤2).
- Kilometre taşları şu an 7 / 30 / 90 / 180 gün.
- **Bilerek yapmadığım şey:** beklenen iyileşme eğrisi. "İkinci gün ağrı 6" ile
  "altıncı hafta ağrı 6" farklı klinik olgular. Sistem hastayı **kendisiyle**
  karşılaştırıyor ve kaçıncı gün olduğunu gösteriyor. Ameliyat tipine göre farklı
  eşik istiyorsanız söyleyin, bunu yapabilirim — ama içeriği siz vermelisiniz.

---

## 4. Acil numara tablosu — **operasyon, resmi kaynaktan**

📄 `klinikten/4-acil-numaralar.csv` (81 ülke)

**Neden gerekiyor:** Yanlış numara, kazanılmak istenen dakikayı harcar. Tablo
derlendi ama **yetkili bir kaynağa karşı doğrulanmadı**.

**Ne yapamadım — ve bu önemli:** Bu tabloyu gözden geçirdim ama **doğrulanmış
olarak işaretlemedim.** Benim hatırladığım bir numarayı "doğrulandı" diye
yazmak, tam olarak bu tablonun tehlikeli olma biçimidir: yetkili görünür,
kimsenin ne zaman kontrol ettiğini söylemez, ve yanlış olduğu ancak birinin
aradığı gün anlaşılır. Doğrulama, resmi bir kaynağa bakmakla olur.

**Nasıl doldurulur:** Her satır için doğru mu diye bakın ve **hangi resmi siteden
baktığınızı** yazın. Hepsini yapmak zorunda değilsiniz — **kliniğin gerçekten
hasta aldığı ülkelerle başlayın**, gerisi 112 uluslararası varsayılanına düşer.

---

# B. Sizin Kararlarınız

## 5. Klinik logosu

📎 Bana bir dosya verin: **PNG veya SVG, şeffaf zeminli, en az 600 px genişlik.**

Hasta özet PDF'inin başında kullanılacak. Klinik adı zaten `CLINIC_NAME` ortam
değişkeninden okunuyor — depoda sabit değil.

**Şu an ne oluyor:** PDF logosuz basılıyor, adla birlikte.

---

## 6. Fotoğraf ön değerlendirmesi açılsın mı?

☐ Evet, açılsın   ☐ Hayır, kapalı kalsın

**Karar şu:** `AI_PHOTO_ASSESSMENT` varsayılan **kapalı**. Bir görüntü, metnin
küçültülebildiği gibi küçültülemez — **yüzü ya da dövmeyi hiçbir tarama
çıkarmaz.** Metin isteminde adı, telefonu, dosya numarasını tarayıp
temizleyebiliyorum; bir fotoğrafta bunu yapamam.

Açarsanız: bulgular kapalı bir sözlükten geliyor, hastaya asla gitmiyor, ve
kendi API anahtarını kullanıyor.

**Şu an ne oluyor:** Kapalı. Fotoğraflar yükleniyor, saklanıyor, klinisyen
görüyor — yalnız AI'ya gitmiyor.

---

## 7. Döviz kuru kaynağı — *depoya girmez*

Hangisi? ☐ TCMB  ☐ Kliniğin bankası: ______  ☐ Aracı kurumla anlaşılan kur
☐ Diğer: ______

Kur girişini kim yapacak? ______________  Ne sıklıkla? ______________

**Neden depoda yok:** Uydurulmuş bir kur kaynağı, üzerine fatura kesilecek bir
sayıdır. Kurlar elle giriliyor (`POST /finance/rates`).

**Şu an ne oluyor:** Kuru olmayan tutar **çevrilmiyor ve düşürülmüyor** — rapor
toplamın eksik olduğunu ve hangi para biriminde ne kaldığını söylüyor.

---

## 8. AI sağlayıcı sözleşmesi — *depoya girmez*

> **Artık dört seçenek var ve seçimi uygulamadan yapıyorsunuz:** Anthropic
> (Claude), OpenAI (GPT), Google (Gemini), DeepSeek. Ayarlar → yapay zekâ
> sağlayıcısı: sağlayıcıyı ve modeli seçin, API anahtarını girin, fiyatı yazın.
> Anahtar şifrelenerek saklanır ve bir daha gösterilmez.
>
> **Sağlayıcıyı değiştirdiğinizde bu beyan sıfırlanır** — dört servisin şartları
> aynı değil, özellikle Google'ın ücretsiz katmanı ve DeepSeek (Çin'de
> barındırılıyor). Her sağlayıcının uyarısı ekranda yazılı.

☐ Sıfır saklama / iş ortaklığı sözleşmesi **imzalandı**
   Sağlayıcı: ______________  Tarih: ______________

**Neden sizde:** Şartname §14.5 bunu şart koşuyor. `AI_ZERO_RETENTION` bayrağı
**kod tarafından doğrulanamaz** — operatörün beyanıdır. Beyan yokken sistem
klinik istemleri **hiç göndermiyor**.

**Şu an ne oluyor:** Beyan yok → AI özellikleri kapalı → sistem AI olmadan tam
çalışıyor (triyajın deterministik katmanı, lab, mesajlaşma hepsi ayakta).

---

## 9. AI model fiyatları — *ayarlar ekranından*

**Bunu ben dolduramam ve doldurmamalıyım.** Bütçe koruması verdiğiniz sayıya
karşı gerçek para harcıyor; benim hatırladığım bir fiyat, doğru görünen ve
kimsenin ne zaman baktığını söylemeyen bir sayı olurdu — tam olarak bu projede
boyunca kaçındığım şey.

Ayarlar ekranında her sağlayıcının **fiyat sayfasının bağlantısı** var. Oradan
bakıp iki alanı doldurun (1M token başına giriş/çıkış, USD). **Fiyatsız model
açılmaz** — bu kuralı yumuşatmadım.

---

## 10. Yedek şifreleme parolası — **buraya YAZMAYIN**

☐ Parola sunucu **dışında** bir kasada (1Password / Bitwarden / fiziksel kasa)
   Nerede: ______________ *(yalnız yerini yazın, parolayı değil)*

**Neden kritik:** Parola kaybolursa off-site yedekler **açılamaz**. Yedeğiniz
olur ama geri dönemezsiniz — ve bunu ancak geri dönmeniz gereken gün öğrenirsiniz.

---

## 11. SSH sertleştirmesi — *karar sizde, hatırlatma*

Sunucuda `PasswordAuthentication yes` ve `PermitRootLogin yes` açık; tek savunma
fail2ban. "Şimdilik hiç dokunma" dediniz ve dokunmadım.

☐ Gerçek hasta verisi canlıya çıkmadan önce kapatılacak — **tarih:** ______

Bu Faz 7 maddesi değil, **canlıdan önce** maddesi.

---

# Nasıl Geri Verirsiniz

CSV'leri doldurup bana verin — dosya olarak ya da sohbete yapıştırarak, ikisi de
olur. Bu dosyadaki kutuları da işaretleyip gönderin.

**Hepsini birden doldurmanız gerekmiyor.** Hangisi hazırsa onu alırım; her biri
bağımsız. Öncelik sırası önerim:

1. **Yedek parolası** (10) — beş dakika, ve kaybı geri dönülemez
2. **Acil numaralar** (4), kliniğin hasta aldığı ülkeler — hasta güvenliği
3. **Triyaj listesi** (2) ve **etkileşim tablosu** (1) — klinik gözden geçirme
4. Gerisi
