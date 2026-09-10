# Personel Kılavuzu

Klinik personeli için. Hastanın gördüğü uygulama farklı:
[KILAVUZ-HASTA](KILAVUZ-HASTA.md).

---

## Giriş ve iki faktör

Personel hesapları **iki faktörlü**. İlk girişte uygulama sizi kurulum ekranına
alır: kodu bir doğrulayıcıya (Google Authenticator, 1Password, Authy) ekleyip
altı haneli kodu girersiniz.

> **Kod tek kullanımlıktır.** Aynı otuz saniye içinde ikinci kez giriş
> denerseniz reddedilir — bu bir hata değil, bekleyip yeni kodu kullanın.

Üst üste yanlış parola hesabı geçici olarak kilitler ve ekran **ne kadar süre
kaldığını** söyler.

## Üç sekme

| Sekme | Ne için |
|---|---|
| **Ajanda** | Günü buradan açarsınız |
| **Hastalar** | Arama ve dosya |
| **Acil** | Açık acil çağrılar |

Acil kendi sekmesinde, menüde değil: menüde bulunamayan çağrı, cevaplanmayan
çağrıdır.

## Ajanda

Sabah açtığınızda dört şey:

- **Bugün gelenler** — randevusu olanlar
- **Bekleyen raporlar** — yapay zekânın yazdığı, sizin onaylamadığınız
- **İşaretli fotoğraflar** — bakılması istenen yara fotoğrafları
- **Acil kuyruğu** — açık çağrı varsa

Bir isme dokunmak dosyayı açar.

## Hasta dosyası

Üstte kimlik ve uyarılar, altında bölümler. Rozetler sayı taşır: okunmamış
mesaj, onay bekleyen tahlil, işlenmekte olan belge.

| Bölüm | Ne var |
|---|---|
| Mesajlar | Konuşma, hızlı yanıtlar, çeviri |
| Ölçümler | Eğriler; buradan da ölçüm girebilirsiniz |
| İlaçlar | Reçete yazma, onay, kesme, uyum skoru, etkileşim uyarısı |
| Belgeler | Yüklenenler ve OCR durumu |
| Tahlil onayı | Yapay zekânın okuduğu değerleri **siz** onaylarsınız |
| Fotoğraflar | Öncesi/sonrası karşılaştırma |
| Kontrol takvimi | Ameliyat tarihinden üretilen plan |
| Randevular | Verme, erteleme, iptal |
| Anketler | PROM eğilimleri |
| Yolculuk | Uçuş, otel, karşılama, uçuş onayı |
| Ameliyat öncesi belgeler | Kontrol listesi |
| Onaylar ve izinler | İmzalı onam ve imzanın kendisi |

## Çalışma saatleriniz

⋯ → Çalışma saatlerim.

> **Saat yayımlamadıysanız kimse sizden randevu alamaz.** Sistem, saat
> tanımlamamış bir hekime randevu vermiyor — bilerek, çünkü uydurmak kimsenin
> kabul etmediği bir zamana hasta yerleştirmek olurdu.

Gün ve saat aralığı ekleyin. Bir haftalığına kapanacaksanız **anahtarı
kapatın**, kaldırmayın: kaldırırsanız dönüşte yeniden girmeniz gerekir.

Bir aralığı kaldırmak, o aralıkta **alınmış randevuları iptal etmez** —
takvimde durmaya devam ederler.

## Tahlil onayı

Yapay zekâ tahlil belgesini okur ve değerleri çıkarır. **Hasta bunları
onaylanana kadar görmez.**

Her satırda okunan değer ve belgedeki hâli yan yana. Yanlış okunan varsa
düzeltin. Onaylamadan hiçbir şey hastaya gitmez ve hiçbir şey klinik kayda
geçmez.

## Yapay zekânın yazdıkları

Rapor, tahlil yorumu ve mesaj özeti **taslaktır**. Ajandadaki "bekleyen
raporlar" sizin imzanızı bekler.

- Yapay zekâ triyaj seviyesini **yükseltebilir, düşüremez**.
- Özet mesajın **yanında** gösterilir, yerine değil.
- Sağlayıcıya giden metinden ad, dosya numarası, telefon ve e-posta çıkarılır.

## Mesajlaşma

Hızlı yanıtlar (şablonlar) sağ üstte. Hastanın kendi dilinde yazdığı mesajı
**"Çevir"** ile okuyabilirsiniz; orijinal bir dokunuş ötede durur ve klinik
kayıt orijinaldir.

Klinik erişim penceresi dışında hastanın yazdığı mesaj beklemede kalır ve
açılışta iletilir; ekran ikisine de bunu söyler.

## Acil çağrılar

Acil sekmesi açık çağrıları en yenisi üstte gösterir. Hastanın konumu varsa
haritada. Çağrıyı üstlendiğinizde kayda geçer.

> Bir hastanın dosyasına acil durum üzerinden girmek **denetim kaydında ayrı
> bir işlem olarak** görünür (`EMERGENCY_ACCESS`). Normal okuma değildir ve
> öyle de raporlanır.

## Bekleyen değişiklikler

⋯ → Bekleyen değişiklikler. Sinyalsiz bir viziteden girdiğiniz her şey burada
birikir ve bağlantı gelince gider.

İki liste var:

- **Sırada** — bağlantı bekliyor, kendi kendine çözülür
- **Gönderilemiyor** — sunucu reddetti, **sizin bakmanız gerekiyor**

Hiçbir şey kendi kendine silinmez. Bir kayıttan vazgeçmenin tek yolu
"Vazgeç" demenizdir.

**Çıkış yaparsanız gönderilmemişler silinir** — uygulama önce kaç tane
olduğunu söyler.

## Denetim günlüğü

⋯ → Denetim günlüğü. Kim neye baktı, kim neyi değiştirdi.

Okumalar da kaydedilir. Sağlık verisinde kimin *baktığı*, kimin değiştirdiği
kadar önemlidir.

## Hasta kaydı ve davet

Hastalar → **Yeni hasta**. Kayıt açıldıktan sonra dosyadan **davet
gönderirsiniz**; hasta o bağlantıyla kendi parolasını belirler.

Ameliyat kaydını (planlanan tarihiyle birlikte) girmeyi unutmayın: ameliyat
öncesi kontrol listesi ve onam formu ikisi de ondan okuyor. Ameliyat kaydı
yoksa hasta onam formunu göremez.
