# Fotoğraf Ön Değerlendirme

Şartname §M5, T5.5. Kod: [`backend/src/photos/assessment.ts`](../backend/src/photos/assessment.ts) ·
[`assessment.service.ts`](../backend/src/photos/assessment.service.ts)

## Bayrak, Tanı Değil

Şartname burada alışılmadık ölçüde kesin, ve kesinliği tasarımın kendisi:

> yara fotoğrafında kızarıklık/akıntı/şişlik şüphesi → **flag** (tanı değil,
> "doktor incelemesi önerilir" uyarısı)

Bu yüzden modele "bu yarada ne var" diye **sorulmuyor**. **Kapalı bir listeden**
hangilerini gördüğü soruluyor, ve bayrak cevaptan hesaplanıyor, cevapta
istenmiyor.

| Bulgu | Ne demek |
|---|---|
| `redness` | yara çevresinde kızarıklık |
| `discharge` | yaradan akıntı |
| `swelling` | yara çevresinde şişlik |
| `wound-open` | yara kenarlarının ayrılmış görünmesi |

"selülit şüphesi" yazan bir model **cevabını çöpe atmış olur**: "selülit"
sözlükte yok ve gidecek bir yeri yok. Jailbreak edilmiş bir yanıtın sisteme
sokabileceği en kötü şey, sözlükte olmayan bir kelime ve o da düşüyor.

**Eşik ve güven skoru yok.** Herhangi bir bulgu varsa klinisyen bakıyor. Bir ön
değerlendirmeye eşik koymak, bir makinenin bir yaranın insan zamanına
değmediğine karar vermesidir — ki bu özelliğin **yapmaması gereken** karar tam
olarak budur.

**Model kendiyle çelişirse gözlem kazanıyor.** Akıntı bildirip sonra "inceleme
gerekmiyor" diyen bir modelin, üzerine iş yapılacak yarısı gözlemdir.

## Hastaya Asla Gitmiyor

Yapısal olarak: bütün fotoğraf uçları `photos.read` istiyor ve **hiçbir hastada
o yetki yok**. Bir hastaya kendi yarası hakkında bir makinenin görüşünü, bir
klinisyen görmeden gösteren bir yol yok — unutulabilecek bir kontrol değil,
olmayan bir uç.

Değerlendirme istemek `ai.review` istiyor, `photos.read` değil: bu bir klinik
fotoğrafı üçüncü tarafa göndermek demek.

## Kliniğin Açması Gereken Anahtar

`AI_PHOTO_ASSESSMENT` varsayılan **kapalı** ve AI katmanının geri kalanından
ayrı.

> **Bir görüntü, metnin küçültülebildiği gibi küçültülemez.** Temizleyici bir
> cümleden adı çıkarır; bir yara fotoğrafından yüzü ya da dövmeyi hiçbir şey
> çıkarmaz.

Bu yüzden fotoğraf göndermek, AI katmanını açmaktan **miras alınan** bir şey
değil, kliniğin ayrıca vermesi gereken bir karar.

Aynı sebeple: **sızıntı taraması resmi inceleyemiyor.** Metin tarafında ad,
telefon, TC yakalanıyor; resimde tanımlayıcı olabilecek şey (yüz, dövme, arka
planda bir belge) hiçbir metin taramasının göreceği bir şey değil. Bu sınır
kodda `render()` yorumunda ve testte yazılı — kapsıyormuş gibi görünen bir
kontrolün arkasına saklanmıyor.

EXIF konumu yüklemede zaten temizleniyor (T3.5).

## Üç Durum

| `aiReviewSuggested` | Ne demek |
|---|---|
| `null` | **Kimse bakmadı** |
| `false` | Bakıldı, bulgu görülmedi |
| `true` | Klinisyen daha önce baksın |

`null` ile `false` arasındaki fark bütün mesele. Okunamayan bir yanıt fotoğrafı
**olduğu gibi bırakıyor** — "değerlendirildi, temiz" diye kaydetmek, bir
klinisyene kontrol edilmemiş bir şeyin kontrol edildiğini söylemek olurdu.

## Sağlayıcı Dikişi Sınandı

Bu, sisteme modele **kelimeden başka bir şey** gönderten ilk iş, ve dikişin ilk
gerçek sınavı: Anthropic görüntüyü base64 kaynak bloğu, OpenAI veri URL'i olarak
alıyor. Fark iki dosyada, dikişin üstündeki hiçbir şey hangisi olduğunu
bilmiyor.

Görüntü **4 MB'ta reddediliyor**: iki sağlayıcı da birkaç megabaytlık görüntüyü
reddediyor, ve bunu yükledikten sonra gelen bir 400'den öğrenmek hem daha yavaş
hem yüklemeye mal oluyor.

## T5.7'nin Taraması Bunu Yakaladı

Yazdığım ilk hâlde `containsHealthData: true` diyen çağrı `identifiers`
geçirmiyordu — bu prompt'ta hasta metni olmadığı için taramanın bulacağı bir şey
de yoktu. Kırmızı çizgi seti yine de düşürdü, çünkü kural "klinik çağrı sızıntı
kontrolüne bakacak bir şey verir". Geçirdim: **birinin bu prompt'a hastanın kendi
notunu ekleyeceği gün, kontrolün zaten kurulu olması gerekiyor.**

## Uçlar

| Uç | Yetki | Ne yapar |
|---|---|---|
| `POST /photos/{id}/assess` | `ai.review` | Bayrak koyar ya da koymaz |
| `GET /photos/flagged` | `photos.read` | İşaretliler, **en eski önce** |

İş listesi en eskiden başlıyor: en yeniden sıralanmış bir iş listesi, en
eskisinin sonsuza kadar beklediği listedir.

## Yapmadıklarım

- **Otomatik değerlendirme.** Her yüklemede çalıştırmak mümkün ama hem harcama
  hem de "her fotoğraf üçüncü tarafa gider" demek. Şu an klinisyen istiyor.
- **Modelin doğru gördüğünün ölçülmesi.** Gerçek yara fotoğrafı olmadan bunu
  ölçemem; test edilen şey yapı — bayrak tanı olarak sunulamıyor, sözlük dışı
  kelime giremiyor, hastaya gitmiyor, kapılar çalışıyor. Kliniğin bunu kendi
  görselleriyle değerlendirmesi gerekiyor.
- **Yüz bulanıklaştırma** (§M7 "opsiyonel otomatik"). `isFaceBlurred` alanı var
  ve boş; bir görüntü işleme adımı, ayrı iş.
