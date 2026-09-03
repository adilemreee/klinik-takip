# AI Kırmızı Çizgileri — Doğrulama Seti

Şartname §14, §M4, T5.7. Kod: [`backend/src/ai/red-lines.ts`](../backend/src/ai/red-lines.ts) ·
[`red-lines.spec.ts`](../backend/src/ai/red-lines.spec.ts) ·
[`test/ai-red-lines.integration.spec.ts`](../backend/test/ai-red-lines.integration.spec.ts)

## Neyi Doğruluyor

Şartname kuralların "sistem prompt'unda sabit olduğunu ve testlerle
doğrulandığını" söylüyor. Bunun yarısı kolay, diğer yarısı asıl mesele:

> **Prompt'ta yazılı bir kural, modele yapılmış bir ricadır.** Model, okuduğu
> metnin kendisi tarafından o ricadan vazgeçirilebilir.

Bu yüzden set iki ayrı şeyi kontrol ediyor, ve ikincisi daha önemli:

1. **Kuralların yazıldığı** — sonraki bir düzenlemenin bir satırı düşürmesini ve
   yeni bir prompt'un onlarsız yazılmasını engelliyor.
2. **Model tutmadığında etrafındaki yapının tuttuğu** — sınıflandırma yalnız
   yükseltebiliyor, alarm veren bir rapor okunmadan hastaya gidemiyor, kimlikler
   çıkamıyor, ve sağlayıcıya ulaşmanın hepsini uygulayan tek kapı dışında bir
   yolu yok.

## Tek Kaynak

Dört cümle iki prompt dosyasında, iki farklı ifadeyle duruyordu. Bir kuralın
kural olmaktan çıkma biçimi tam olarak budur: üçüncü prompt gördüğü sürümü
kopyalar, dördüncüsü başka türlü söyler, bir yıl sonra sistemin ne vaat ettiğini
kimse söyleyemez.

Artık [`src/ai/red-lines.ts`](../backend/src/ai/red-lines.ts) içinde bir kez
duruyorlar ve her prompt aynı bloğu basıyor.

## Kaynak Taraması

Set dosya listelemek yerine **kaynak ağacını tarıyor**, çünkü asıl korunulan
hata gelecek yıl eklenecek çağrı noktası.

| Tarama | Ne yakalar |
|---|---|
| `*.prompt.ts` içindeki her `SYSTEM_PROMPT` dört kırmızı çizgiyi içeriyor mu | Kuralsız yazılmış yeni prompt |
| Her prompt maskeleme yer tutucularını açıklıyor mu | Modelin `[ad]`'ı hastanın yazdığı sanıp geri doldurmaya çalışması |
| `containsHealthData: true` geçen her `ai.complete({...})` çağrısı `identifiers` veriyor mu | Sızıntı kontrolüne bakacak bir şey vermeyen klinik çağrı |
| `src/ai/` dışında hiçbir dosya sağlayıcı sınıfını ya da API adresini anmıyor mu | Kapıyı atlayıp modele doğrudan konuşan modül |

Çağrı taraması **süslü parantez eşleyerek** yapılıyor, düzenli ifadeyle değil:
çok satırlı bir nesne üzerinde regex ilk kapanan parantezde durur, ki bu bu
çağrılarda `identifiers` bloğunun ortasıdır — ve tam da bulmak için yazıldığı
şeyi eksik diye raporlardı.

Her taramanın kendini doğrulayan bir testi var ("hiçbir şeyle eşleşmeyen bir
tarama aşağıdaki bütün iddiaları sessizce geçirir").

## Yapısal Doğrulamalar

### §14.3 — tüketici değil, tüketici olmayan

`raiseTo` için **bütün kombinasyonlar** deneniyor, örnekler değil: iddia
"aciliyeti düşüren hiçbir bileşim yok" ve bir avuç örnek bunu söyleyemez.
`mayAutoRelease` için HIGH ve CRITICAL, ayarın iki durumunda da kapalı.

### Prompt enjeksiyonu

Modeli talimatlarından vazgeçirmeye çalışan bir mesaj test ediliyor. **Başarılı
olup olmadığı önemli değil**: anahtar kelime taraması zaten bir taban koydu ve
taban modele sorulan bir şey değil. Uçtan uca hâli de var — model INFO dese bile
mesaj EMERGENCY kalıyor ve hemşirenin telefonu çalıyor.

### Telin üstündeki baytlar

Prompt kurucuları ayrı ayrı test ediliyor; entegrasyon seti aynı iddiayı
**gerçekten çıkan istek gövdesi** üzerinde kuruyor — temizleyici, kapı ve
servisin eklediği her şeyden sonra. Yakalayıcı taşıma isteği kaydediyor,
`findLeaks` onun üzerinde çalışıyor.

Aynı testler klinik içeriğin **hâlâ orada** olduğunu da doğruluyor: temizlemek
hiçbir şey göndermemek demek değil.

### §14.5 — kapı çağrıcıda değil, kapıda

Sıfır saklama kapalıyken **her iki çağrı noktası** ayrı ayrı deneniyor ve
hiçbiri ağa ulaşamıyor. Bu, ihtiyaç duyduğu bayrağı doğru bayrak yerine geçiren
yeni bir modülü yakalayacak iddia.

Ve mesaj yine de triyaj ediliyor — anahtar kelime taramasıyla. **Klinik,
evrak tamamlanmadı diye özelliği kaybetmiyor.**

### §14.6 — izlenebilirlik

`ai_jobs` satırında cevabı veren model (istenen takma ad değil), token
sayıları, maliyet ve zaman damgaları; `ai_reports` satırında model ve
oluşturulma zamanı.

## Bu Setin Yapamadığı

- **Modelin hasta metninde tanı koymadığını doğrulayamıyor.** Çıktıya regex
  atmak tiyatro olurdu. Tutan şey, metnin bir klinisyen okumadan hastaya
  gitmemesi (T5.4).
- **Modelin kurallara uyduğunu doğrulayamıyor** — yalnız kuralların gittiğini ve
  uymadığında sistemin ne yaptığını doğruluyor. Zaten savunulabilir tek iddia bu.
- **Gerçek bir sağlayıcıya karşı çalışmıyor.** Bütün testler yakalayıcı bir
  taşıma kullanıyor; gerçek modelin davranışını ölçmek ayrı bir iş ve ayrı bir
  bütçe.
