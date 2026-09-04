# KVKK'nın Koda Karşılığı

Şartname §8, T7.3. Kod: [`backend/src/consents/`](../backend/src/consents/) ·
[`backend/src/audit/`](../backend/src/audit/)

Hukuki metinler [KVKK-AYDINLATMA-METNI](KVKK-AYDINLATMA-METNI.md),
[KVKK-ACIK-RIZA](KVKK-ACIK-RIZA.md) ve [KVKK-SAKLAMA-IMHA](KVKK-SAKLAMA-IMHA.md)
belgelerinde. Bu belge, onların **kodda ne karşılığı olduğunu** anlatıyor —
çünkü politikası olup uygulaması olmayan bir klinik, hiç politikası olmayandan
daha kötü durumda olur: yazılı bir taahhüdü ihlal etmiş olur.

## Bulunan ve kapatılan boşluk

Onam kayıtları **yalnız okunuyordu.** `Consent` tablosu vardı, fotoğraf yükleme
onun aktif bir `PHOTO_USAGE` kaydını arıyordu — ama sistemde onam **alan** hiçbir
uç yoktu. Yani hukuki metinlerin tarif ettiği akışı sistem yapamıyordu.

`ConsentsModule` bunu kapatıyor: verme, listeleme, geri alma; hem hasta hem
personel tarafında.

## Kurul kararının koda geçen hâli

**2026/347 (18.02.2026)**: işleme açık rıza dışında bir şarta dayanıyorsa açık
rıza metni sunulmayacak.

Bunun kodda karşılığı bir yorum değil, bir **ret**:

```
DATA_PROCESSING onamı istendiğinde → 400
"Processing for treatment rests on KVKK art. 6/3, and Board decision
 2026/347 forbids presenting a consent text where a non-consent ground applies."
```

Neden ret, neden uyarı değil: tedavi için rıza istemek, hastaya reddedebileceği
izlenimini verir. Reddederse tedavi edilemez — yani rıza özgür değildir, yani
geçersizdir. Üstelik alınmış bir kayıt, kliniğin dayanamayacağı bir şeye
dayandığını gösteren bir belge bırakır. Bir ekran bunu yanlışlıkla bağlamasın
diye kapı servisin içinde.

Toplanabilen üç tip:

| Tip | Ne | Dayanak |
|---|---|---|
| `TREATMENT` | tıbbi müdahale onamı | hasta hakları mevzuatı — **KVKK rızası değil** |
| `PHOTO_USAGE` | fotoğrafın tanıtımda kullanılması | açık rıza |
| `MARKETING` | pazarlama iletisi | açık rıza |

## Geri alma ileriye etkilidir

`revoke` bir zaman damgası yazar, satırı **silmez**. Rızanın var olduğunu ispat
yükü veri sorumlusundadır ve silinmiş bir satır hiçbir şey ispat etmez.

İki kez geri almak hata değil: kişinin iradesi iki seferde de aynı ve bir hata,
geri alınamamış gibi okunur.

Aynı tipte ikinci bir rıza, öncekini **geçersiz kılar** — üst üste binmez. İki
aktif fotoğraf rızası farklı metinlerle dururken, hastanın hangisini kabul
ettiğini kimse söyleyemez.

## Kanıt olarak saklananlar

Her kayıtta: hangi tip, **hangi metin sürümü**, tam metin, ne zaman, hangi IP,
hangi uygulama sürümü. "Onay verdi" bunlar olmadan bir iddiadır, kayıt değil.

## Silinemez denetim günlüğü

`audit_logs` veritabanı seviyesinde salt-eklemedir: `UPDATE` ve `DELETE`
tetikleyici ile reddedilir. Aylık bölümlenmiştir, yani süresi dolan dönem bütün
olarak düşürülür — seçmeli satır silme denetim günlüğünün amacını ortadan
kaldırırdı.

## Hasta kendi verisine erişiyor

KVKK m.11 hastaya verisine erişme hakkı verir. Uygulamada bu, hastanın kendi
belgelerine, fotoğraflarına, tahlillerine ve onamlarına `me/` uçlarından
ulaşabilmesi demek. Bu uçlar `self.*` izniyle çalışır ve arayanın kendi
dosyasını token'dan çözer — üzerinde oynanacak bir kimlik yoktur.

## Henüz yapılmayanlar

Dürüstlük gereği, bu belgenin tarif ettiği ama sistemin **yapmadığı** şeyler:

| Eksik | Sonucu | Ne zaman |
|---|---|---|
| Periyodik imha işi | süresi dolan kayıtlar kendiliğinden silinmiyor | T7 |
| Veri taşınabilirliği dışa aktarımı (m.11) | hasta verisini makine okunur alamıyor | T7 |
| Uygulamada onam ekranı | uçlar var, arayüz yok | T2.6 devamı |
| VERBİS kaydı | klinik tarafından yapılacak | klinik |
| Standart sözleşme + Kuruma bildirim | yurt dışı sağlayıcı kullanılacaksa zorunlu | klinik + avukat |

**Sunucudaki açık:** parola ile root SSH girişi açık. Klinik sahibi 2026-09-04'te
kapatmama kararı verdi; T7.2 bunu kapatılmış bir bulgu olarak değil, **kabul
edilmiş risk** olarak raporlayacak.
