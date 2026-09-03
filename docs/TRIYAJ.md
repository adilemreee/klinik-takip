# Mesaj Triyajı ve Özetleme

Şartname §M4, §M5, §14.3, T5.2. Kod: [`backend/src/triage/`](../backend/src/triage/)

## Tehlikeli Yarı

"Kritik hiçbir durum yalnızca AI'ya bırakılmaz" cümlesi genelde **kritik
sınıflandırmadan sonra** ne olduğuyla ilgili okunur. Tehlikeli yarı diğeri:

> Model "göğsüm ağrıyor" mesajını okur, **INFO** der, mesaj kimsenin bakmadığı
> bir yığına düşer, ve bunun yanlış okunduğunu kimse hiç öğrenmez.

Bu yüzden sınıflandırma bir **atama değil, taban** olarak uygulanıyor:

```
seviye = max(anahtar kelime taraması, modelin cevabı)
```

**Model seviyeyi yükseltebilir, asla düşüremez.** Kapalı, parası ödenmemiş,
hız sınırına takılmış, zaman aşımına uğramış, okuduğu mesaj tarafından ikna
edilmiş ya da sadece yanılmış bir model, kliniği tam olarak onsuz olacağı yerde
bırakıyor. Bu yolun içine bir modeli koymayı güvenli kılan tek özellik bu.

## İki Geçiş

### 1. Anahtar kelime taraması — her zaman çalışır

AI kapalıyken de çalışıyor, ki sistem **şu anda o hâlde**. Kaba olması kasıtlı:
hatalarının yönü seviyeyi **yükseltmek**, ve buradaki bir hatanın gidebileceği
tek meşru yön bu. Bir şey çıkmayan mesajı okuyan hemşire bir dakika kaybeder;
diğer hata başka bir şey kaybettirir.

En düşük verdiği seviye **ROUTINE** — yani "bir insan okur". Bir şeyin *hiç
insan gerektirmediğine* karar vermek, bu taramanın yakınından geçemeyeceği bir
karar; model de veremiyor.

> **Bu liste klinik içeriktir ve bir klinisyen tarafından gözden geçirilmedi.**
> Tek dosyada, tek biçimde duruyor ki bir doktor onu liste olarak okuyup
> düzeltebilsin. Kliniğin sahiplendiği bir başlangıç noktası olarak görün.

> **Bilinen boşluk: yalnız Türkçe ve İngilizce.** Şartnamenin başlangıç dil seti
> Almanca, Rusça ve Arapça'yı da içeriyor. Bu dillerde yazan hasta anahtar
> kelime taraması almıyor — AI açıkken onun geçişini alıyor, ve her hâlükârda
> bir insana ulaşıyor, çünkü altındaki taban ROUTINE.

Türkçe eklemeli bir dil: "alamıyorum", "alamıyor", "alamadım" aynı şikayet. Bu
yüzden tam kelime değil **kök** eşleşmesi var. Ayrıca hem metin hem kökler
diyakritiklerini kaybediyor: Türkçe klavyesi olmayan hasta "nefes alamiyorum"
yazar, olan "alamıyorum" — ikisi de aynı klinik içerik.

### 2. Model — yükseltebilir

Aynı mesajı okuyup üç satırlık özet (Şikayet / Ölçülen değerler / Süre) ve bir
seviye döndürüyor. Cevabı **JSON**; okunamayan her cevap `null` dönüyor ve taban
olduğu yerde kalıyor.

**Parser'ın varsayılan seviyesi yok.** Modeli anlayamadığında INFO'ya düşen bir
parser, sessizce "bu mesajı kimsenin okumasına gerek yok" kararını veren şey
hâline gelmiştir.

## Erişim Penceresini Deliyor

Özelliğin asıl varlık sebebi bu. Hasta gece üçte "nefes alamıyorum" yazıyor,
pencere "klinik mesajları 18:00'de okur" diyor, ve bu olmadan mesaj **on beş
saat görünmez** kalıyor.

URGENT veya EMERGENCY çıkan mesaj kuyruktan **çıkarılıyor**: durumu SENT'e
dönüyor, konuşma saati güncelleniyor, WebSocket'e düşüyor ve bakım ekibine
bildirim gidiyor. Pencere, doktorun rutin sorular için bütün gece nöbette
olmaması için var — bunu tutmak için değil.

Bildirim **susturulamıyor** (`mandatory`), acil bildirimlerle aynı gerekçeyle:
bir mesajı yukarı taşımanın bütün değeri, birine **şimdi** söylenmesi.

## Kimin Telefonu Çalıyor

Bakım ekibinin tamamı, **aynı anda** — merdiven değil. Eskalasyon merdiveni acil
buton için var, orada alarmları aralamak yedekte birini tutuyor. Acil bir mesaj
o değil: tek bir bildirim, ve şimdi harekete geçebilecek herkese gitmeli.

Hiç ekibi olmayan hastada taban yine `emergency.receive` olan herkes — T4.5 ile
aynı gerekçe. "Bu hastadan kim sorumlu" sorusu **tek yerde** yanıtlanıyor
(`CareTeamService`): iki yanıt eninde sonunda ayrışır ve biri yanlış kişiyi
uyandırır.

## Kimlik: Reddetmek Değil, Maskelemek

T5.1'in kapısı kimlik taşıyan istemi **reddediyor** — temiz kurulması gereken
bir istem için doğru. Hastanın kendi mesajı için **yanlış**: insanlar mesajlarını
imzalar, ve "Ben Ayşe" diyen her mesajı reddetmek tam da o mesajları özetsiz
bırakırdı.

Bu yüzden metin önce **temizleniyor** (`redact`), sonra kapı hiçbir şey
bulmuyor. Kontrol hâlâ çalışıyor — ve artık temizleyiciyi kontrol ediyor. İkisi
aynı eşleştiriciyi kullanıyor: reddedilen şey ile silinen şey tanım gereği aynı.

## Kayıt

| Alan | Ne |
|---|---|
| `triage_level` | Kliniğin **eylediği** seviye |
| `triage_flags` | Ateşlenen kural id'leri — hastanın kendi kelimeleri asla |
| `ai_triage_level` | Modelin **kendi** cevabı |
| `ai_summary` | Üç satır, mesajın **yanında**, yerine değil |

Modelin cevabı ayrı tutuluyor çünkü ikisi farklı iddia: biri karar, diğeri
yukarı doğru ezilmiş ya da tamamen yok sayılmış bir tavsiye. Anlaşmazlığın
kaydı, birinin sonradan bakmak isteyeceği şey.

## Kuyruk

Triyaj kendi kuyruğunda. Mesaj kuyruğu tek iş çalıştırıyor ki serbest bırakılan
mesaj hastaya söz verilen saatte gitsin; önünde duran bir dakikalık AI çağrısı
tam olarak o sözü bozardı.

İş satırı mesajla **aynı işlemde** yazılıyor: işlemin dışında kuyruğa atmak,
geri alınmış bir mesaj için var olmayan satırı kovalayan bir iş bırakırdı;
içinde atmak, worker'ın commit'ten önce işi almasına izin verirdi.

## §M4'ün Sistem Prompt'unda Sabitlediği Kurallar

- Tanı koymazsın.
- İlaç dozu önermez ve değiştirmezsin.
- Tedavi önermezsin.
- Emin olmadığında daha yüksek aciliyet seçer ve insana devredersin.

Dördü de sabit ve **her biri için bir test** var — şartname böyle istiyor.

Ama bunların hiçbiri etrafındaki yapının yerine geçmiyor: **bir prompt bir rica,
bir kontrol değil**; model okuduğu mesaj tarafından ikna edilebilir. Asıl tutan
şey, sınıflandırmanın yalnız yükseltebilmesi ve mesajın her hâlükârda bir insana
ulaşması.

## Yapmadıklarım

- **AI'nın EMERGENCY demesi acil olay kaydı açmıyor.** §M4 "acil protokolü
  tetiklenir" diyor, §14.3 "kritik durum yalnızca AI'ya bırakılmaz" diyor. İkisini
  birlikte okuyuşum: protokolün **bildirim yarısı** çalışıyor (personel şimdi
  uyandırılıyor), **kayıt yarısı** çalışmıyor — `emergency_events` hastanın
  bastığı butonun kaydı, ve modelin yanlış okumasıyla otomatik açılan bir alarm
  kliniğe alarmları yok saymayı öğretir. **Bu benim yorumum; klinik aksini
  isteyebilir.**
- **Çift yönlü çeviri ve sesli mesaj transkripti** (§M3) — T5.1 zeminini
  kullanacak, ama ayrı iş.
- **Chatbot** (§M4'ün RAG'lı yanıt veren kısmı) — T5.3.
