# Saklama ve İmha Politikası

> **Taslak; avukat incelemesi gerektirir.** Süreler mevzuata ve kliniğin
> faaliyet iznine göre teyit edilmelidir.

## İlke

Kişisel veri, işleme amacı ortadan kalktığında silinir, yok edilir veya anonim
hâle getirilir (KVKK m.7). Ama tıbbi kayıtlar için amacın ortadan kalkması tek
başına yetmez: mevzuat asgari saklama süresi öngörür ve o süre dolmadan silme
**yapılamaz.**

Bu gerilim hastaya dürüstçe anlatılmalıdır. "Verilerimi silin" talebi, tıbbi
kayıt için çoğu zaman "süre dolduğunda silinecek" cevabını alır — bu bir ret
değil, kanuni bir yükümlülüktür.

## Süreler

| Veri | Saklama süresi | Dayanak / gerekçe |
|---|---|---|
| Tıbbi kayıt (dosya, ameliyat, tahlil, ölçüm, klinik fotoğraf) | `[TEYİT EDİLECEK — genel uygulama en az 20 yıl]` | sağlık mevzuatı; klinik faaliyet iznine göre teyit edilmeli |
| Onam kayıtları | tıbbi kayıtla aynı süre | ispat yükümlülüğü |
| Finans ve fatura kayıtları | 10 yıl | TTK m.82, VUK |
| Denetim günlüğü (`audit_logs`) | `[TEYİT EDİLECEK — asgari 2 yıl önerilir]` | 5651 ve KVKK hesap verebilirlik |
| Oturum ve cihaz kayıtları | 2 yıl | işlem güvenliği |
| Mesajlaşma | tıbbi kayıtla aynı süre (klinik içerik taşır) | tedavi sürecinin parçası |
| Pazarlama izni ve iletişim bilgisi | rıza geri alınana kadar | rıza |
| Yapay zekâ iş kayıtları | 90 gün | teşhis/hata ayıklama; klinik karar değil |
| Yüklenmemiş/yarım kalan yükleme oturumları | 7 gün | teknik |

## İmha yöntemi

| Yöntem | Ne zaman |
|---|---|
| **Silme** | kaydın erişilemez ve kullanılamaz hâle getirilmesi; yumuşak silme (`deleted_at`) süre dolduğunda kalıcıya çevrilir |
| **Yok etme** | dosya nesnelerinin depodan kalıcı kaldırılması |
| **Anonim hâle getirme** | `anonymized_at` — kimlik alanları geri döndürülemez şekilde kaldırılır, klinik istatistik korunur |

**Denetim günlüğü istisnası:** `audit_logs` tablosu veritabanı seviyesinde
salt-eklemedir; güncelleme ve silme tetikleyici ile reddedilir. Süresi dolan
bölümler *bütün olarak* düşürülür (aylık bölümleme), tek tek satır silinerek
değil. Bir denetim günlüğünde seçmeli silme, günlüğün amacını ortadan kaldırırdı.

## Periyodik imha

Altı ayda bir, `[SORUMLU]` tarafından. Süresi dolan kayıtlar tespit edilir,
imha edilir ve imha tutanağı tutulur.

**Bugünkü durum: iş yazıldı ve günde bir kez koşuyor** (`retentionSweep`).
Ayrıntısı ve neye bilerek dokunmadığı [KVKK-UYGULAMA-NOTLARI](KVKK-UYGULAMA-NOTLARI.md)'nda.

Kalan: imha tutanağının otomatik üretilmesi. Şu an her koşu log'a düşüyor —
kaç kayıt, hangi türden — ama bu bir tutanak değil, bir log satırı. Denetimde
istenirse log'dan çıkarılabilir; kalıcı bir tutanak tablosu T7'de.
