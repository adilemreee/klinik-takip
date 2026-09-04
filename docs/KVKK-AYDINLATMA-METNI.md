# Aydınlatma Metni (KVKK m.10)

> **Bu bir taslaktır ve avukat incelemesi gerektirir.** Sağlık verisi KVKK m.6
> anlamında *özel nitelikli kişisel veri*dir; hatalı bir metin hem idari para
> cezası hem de hasta güveni anlamına gelir. Metin güncel mevzuat ve Kurul
> kararlarına göre yazıldı (kaynaklar sonda), ama hukuki görüş değildir.
>
> Köşeli parantezli alanlar klinik tarafından doldurulacak:
> `[KLİNİK ADI]`, `[ADRES]`, `[VERBİS NO]`, `[KEP]`, `[E-POSTA]`.

## Neden ayrı bir belge

Kurul'un **18.02.2026 tarihli 2026/347 sayılı ilke kararı**, aydınlatma metni
ile açık rıza metninin **ayrı başlıklar altında ayrı metinler** olmasını zorunlu
kılıyor. Aynı sayfada gösterilecekse bile alt alta, iki ayrı beyanla.

Kararın ikinci yarısı daha da belirleyici: işleme açık rıza dışındaki bir şarta
dayanıyorsa **açık rıza metni hiç sunulmamalı**. Ve aydınlatma metni için
onay/rıza istenmemeli — yalnızca *okunduğuna* dair geri bildirim alınmalı.

Bu, uygulamanın onam ekranını doğrudan belirliyor. Bkz. [KVKK-UYGULAMA-NOTLARI](KVKK-UYGULAMA-NOTLARI.md).

---

## 1. Veri sorumlusu

| | |
|---|---|
| Unvan | `[KLİNİK ADI]` |
| Adres | `[ADRES]` |
| VERBİS kayıt no | `[VERBİS NO]` |
| KEP | `[KEP]` |
| Başvuru e-postası | `[E-POSTA]` |

## 2. İşlenen kişisel veriler

Aşağıdaki tablo uygulamanın veri modelinden çıkarıldı; genel bir liste değil,
sistemin gerçekten tuttuğu alanlar.

| Kategori | Veriler | Özel nitelikli mi |
|---|---|---|
| Kimlik | ad, soyad, doğum tarihi, cinsiyet, uyruk, dosya numarası | hayır |
| İletişim | e-posta, telefon, ülke, şehir, tercih edilen dil | hayır |
| Sağlık | kan grubu, alerjiler, kronik hastalıklar, kullanılan ilaçlar, sigara/alkol kullanımı, ameliyat kayıtları, ölçümler (kilo, tansiyon, VKİ), tahlil sonuçları, klinik fotoğraflar, komplikasyon bildirimleri, anket yanıtları, ilaç uyum kayıtları | **evet (m.6)** |
| Belge | pasaport, tahlil raporu, reçete, onam formu ve benzeri yüklenen dosyalar | içeriğine göre **evet** |
| İşlem güvenliği | giriş kayıtları, cihaz oturumları, IP adresi, denetim günlüğü | hayır |
| Finans | ödeme kayıtları, tutar, para birimi, tahsilat durumu | hayır |
| Konum | acil durum bildirimine iliştirilen yaklaşık konum (yalnız hasta gönderdiğinde) | hayır |

Biyometrik veri, genetik veri, din, siyasi görüş, sendika üyeliği ve ceza
mahkûmiyeti verisi **işlenmiyor**.

## 3. İşleme amaçları ve hukuki sebepleri

Bu bölüm metnin en önemli kısmı: her amacın hangi şarta dayandığı, çünkü
**dayanak açık rıza değilse rıza istenmeyecek.**

| Amaç | Hukuki sebep | Açık rıza gerekli mi |
|---|---|---|
| Tıbbi teşhis, tedavi, bakım ve takip hizmetinin yürütülmesi | **m.6/3** — sır saklama yükümlülüğü altındaki sağlık personeli tarafından | **hayır** |
| Randevu, kontrol takvimi ve ilaç hatırlatmaları | m.5/2-c (sözleşmenin ifası) | hayır |
| Hasta–klinik mesajlaşması | m.5/2-c | hayır |
| Acil durum bildirimi ve müdahale | m.5/2-a (hayati menfaat) ve m.6/3 | hayır |
| Faturalama, tahsilat, muhasebe | m.5/2-ç (hukuki yükümlülük) | hayır |
| Yasal saklama ve denetim günlüğü | m.5/2-ç | hayır |
| Hizmet kalitesi anketleri (PROM) | m.5/2-f (meşru menfaat) | hayır |
| **Fotoğrafların tanıtım/pazarlamada kullanılması** | **açık rıza** | **evet** |
| **Yapay zekâ sağlayıcısına klinik metin gönderilmesi** | **açık rıza** | **evet** |
| **Yurt dışına aktarım (yurt dışı sağlayıcı/sunucu)** | **açık rıza** veya uygun güvence (bkz. §6) | duruma göre |
| **Pazarlama iletisi gönderilmesi** | **açık rıza** | **evet** |

İlk yedi satır için **açık rıza metni sunulmayacak** — 2026/347 bunu açıkça
yasaklıyor. Yalnız kalın yazılan dört satır için ayrı ve tek tek rıza alınacak.

## 4. Toplama yöntemi

Veriler; mobil uygulama, klinik personelinin girdiği kayıtlar, yüklenen belgeler
ve bunların otomatik işlenmesi (OCR) yoluyla, kısmen otomatik ve otomatik
yollarla toplanır.

## 5. Aktarılan taraflar

| Alıcı | Ne için | Dayanak |
|---|---|---|
| Klinik personeli (doktor, hemşire, koordinatör) | tedavi ve takip | m.6/3 |
| Aracı kurum / acente (varsa) | organizasyon | m.5/2-c, yalnız gerekli alanlar |
| Barındırma ve altyapı sağlayıcısı | sistemin çalışması | m.5/2-f, veri işleyen sözleşmesi ile |
| Yapay zekâ sağlayıcısı | seçilmişse ve rıza varsa | açık rıza |
| Yetkili kamu kurumları | kanunen talep hâlinde | m.5/2-ç |

Refakatçi/vekil erişimi ayrı bir bağdır: yalnız hastanın verdiği ve **geri
alabildiği** onamla açılır, kapsamı sınırlıdır ve onam kaldırıldığı anda biter.

## 6. Yurt dışına aktarım

Sağlık turizmi doğası gereği yurt dışı unsuru taşır. KVKK m.9, 7499 sayılı Kanun
ile değişti; aktarım ancak şu yollardan biriyle yapılabilir:

1. **Yeterlilik kararı** bulunan ülkeye aktarım,
2. **Standart sözleşme** — imzalanmasından itibaren **beş iş günü içinde**
   Kuruma bildirilmesi zorunlu,
3. Bağlayıcı şirket kuralları,
4. İstisnai hâller (m.9/6) — süreklilik arz etmemek kaydıyla.

**Bu proje için pratik sonuç:** kullanılacak yapay zekâ sağlayıcısı ve barındırma
sağlayıcısı yurt dışındaysa, hasta verisi gönderilmeden önce bu dört yoldan biri
tamamlanmış olmalı. Uygulama, sağlayıcı seçimi ekranında her sağlayıcının veri
saklama politikasını gösterir ve sıfır saklama onaylanmadan klinik istem
göndermeyi reddeder; ama bu **teknik bir kapıdır, hukuki dayanağın yerine
geçmez**.

## 7. İlgili kişinin hakları (m.11)

Hasta; verisinin işlenip işlenmediğini öğrenme, bilgi talep etme, amacına uygun
kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme,
eksik/yanlış işlenmişse düzeltilmesini, şartları oluştuğunda silinmesini veya yok
edilmesini isteme, bu işlemlerin aktarılan taraflara bildirilmesini isteme,
münhasıran otomatik sistemlerle analiz sonucu aleyhine bir sonuç çıkmasına itiraz
etme ve zararının giderilmesini talep etme haklarına sahiptir.

Başvuru: `[E-POSTA]` veya `[KEP]`. Başvurular en geç **otuz gün** içinde
sonuçlandırılır.

**Silme talebinin sınırı dürüstçe söylenmelidir:** tıbbi kayıtlar için mevzuatın
öngördüğü saklama süresi dolmadan silme yapılamaz. Bu bir ret değil, kanuni bir
yükümlülüktür ve gerekçesiyle birlikte bildirilir. Ayrıntı:
[KVKK-SAKLAMA-IMHA](KVKK-SAKLAMA-IMHA.md).

## 8. Saklama süresi

Özet: tıbbi kayıtlar için mevzuattaki süre, diğerleri için amacın gerektirdiği
süre. Tablo hâlinde [KVKK-SAKLAMA-IMHA](KVKK-SAKLAMA-IMHA.md) belgesinde.

## 9. Güvenlik tedbirleri

Sistemin gerçekten uyguladıkları — söz değil, kodda karşılığı olanlar:

- Rol bazlı yetkilendirme; hasta yalnız kendi dosyasına erişir, personel
  yetkisinin kapsadığı dosyalara
- Personel hesaplarında zorunlu iki adımlı doğrulama
- Parolalar Argon2id ile saklanır; oturum belirteçleri cihazda şifreli tutulur
- Tüm trafik TLS üzerinden
- Değişiklik yapan her işlem için **silinemez** denetim günlüğü
- Fotoğraflardan konum ve cihaz bilgisi (EXIF) yüklemede temizlenir
- Belgeler imzalı ve süreli bağlantılarla sunulur

**Açık hâldeki eksik:** sunucuda parola ile root SSH girişi açıktır. Klinik
sahibi bunu kabul edilmiş risk olarak değerlendirmiştir. Gerçek hasta verisi
girmeden önce yeniden değerlendirilmelidir.

---

## Kaynaklar

- [Aydınlatma Yükümlülüğü — KVKK](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-)
- [Özel Nitelikli Kişisel Veriler — KVKK](https://www.kvkk.gov.tr/Icerik/2051/Ozel-Nitelikli-Kisisel-Veriler)
- [2026/347 sayılı ilke kararı kamuoyu duyurusu — KVKK](https://www.kvkk.gov.tr/Icerik/8710/veri-sorumlulari-tarafindan-acik-riza-ve-aydinlatma-metinlerinin-ayri-ayri-duzenlenmesi-gerektigi-hakkinda-kisisel-verileri-koruma-kurulunun-18-02-2026-tarihli-ve-2026-347-sayili-ilke-kararina-iliskin-kamuoyu-duyurusu)
- [Kişisel Verilerin İşlenme Şartları — KVKK](https://www.kvkk.gov.tr/Icerik/4190/Kisisel-Verilerin-Islenme-Sartlari)
- [Yurt Dışına Aktarım — KVKK](https://www.kvkk.gov.tr/Icerik/2053/Yurtdisina-Aktarim)
- [Standart Sözleşme Bildirim Modülü — KVKK](https://www.kvkk.gov.tr/Icerik/8043/Standart-Sozlesme-Bildirim-Modulu-Hakkinda-Kamuoyu-Duyurusu)
