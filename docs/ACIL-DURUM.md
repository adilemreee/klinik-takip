# Acil Durum Butonu

Şartname §M8, T4.5. Kod: [`backend/src/emergency/`](../backend/src/emergency/) ·
[`ios/Sources/KlinikEmergencyFeature/`](../ios/Sources/KlinikEmergencyFeature/) ·
[`android/feature/emergency/`](../android/feature/emergency/)

## Tek Soru

Bu modülün her satırı tek bir soruya bakıyor: **birinin telefonu gerçekten çaldı mı?**
Alarmın *kaydedilmesi* kolay yarısı, ve demoda sorunsuz görünen yarısı. Diğer yarısı hiç
çalışmamış olabilir ve bunu kimse fark etmez.

## Eskalasyon Merdiveni

Şartnamenin verdiği süreler: **anında**, **2 dk**, **5 dk**. Şartnamenin söylemediği, ve asıl
işi yapan kısım: her basamağın *kim* olduğu, ve bir basamağın **kimse** çıkması hâlinde ne
olacağı.

| Basamak | Ne zaman | Kim |
|---|---|---|
| 0 | anında | hastaya atanmış hemşireler |
| 1 | 2 dk | hastaya atanmış koordinatörler |
| 2 | 5 dk | hastanın sorumlu doktoru |
| taban | — | `emergency.receive` yetkisi olan herkes |

Üç kural, her biri sessizce bozulan bir durum yüzünden var:

1. **Boş basamak çökertiliyor.** Hemşiresi atanmamış bir hastada basamak 0 kimseye gitmezdi:
   alarm iki dakika sessiz beklerdi — ki bu, bu özelliğin sahip olduğu sürenin çoğu.
   Hemşire yoksa ilk alarm koordinatöre, o da yoksa doktora gider.
2. **Kimse iki basamakta olmuyor.** Hem koordinatör hem doktor olan bir kişi tek telefondur;
   iki basamağa yazmak, bir eskalasyon adımını zaten ekranında alarm duran bir cihazı
   tekrar dürtmeye harcar.
3. **Zincirin sonu, alarm alabilecek herkes.** Hiç ekibi olmayan hasta, tam olarak kimsenin
   izlemediği hastadır.

Zincir yine de **boş** çıkabilir — klinikte `emergency.receive` tutan hiçbir hesap yoksa. Bu bir
veri sorunu değil, yapılandırma sorunu: kod uyduracak bir alıcı icat etmiyor, `logger.error`
ile bağırıyor ve olay yine de kayda giriyor.

### Süpürme, zamanlayıcı değil

Merdiveni bir zamanlayıcı değil, 30 saniyede bir çalışan bir kuyruk işi tırmandırıyor.
Zamanlayıcı tek bir worker sürecinin belleğinde yaşar — ve o sürecin yeniden başlaması nadir
bir olay değil, her dağıtımda oluyor. Dağıtımdan 90 saniye önce basılan bir butonun yine de
eskale olması gerekiyor.

Süpürme **basamak basamak** çıkıyor. Geç kalmış bir süpürme (worker yeni ayağa kalktı,
kuyruk birikti) iki basamağı birden görür; ikisini birlikte ateşlemek merdiveni tek adımda
harcamak ve yedekte kimseyi bırakmamaktır.

### Merdivenin bittiği yer

Şartname 5 dakikadan sonrası için bir şey söylemiyor, bu yüzden kod da uydurmuyor. Ama sessizce
susmuyor: merdiven tükendiği hâlde hâlâ yanıtlanmamış çağrılar personel listesinde
`unanswered` işaretiyle görünüyor. **Bu, kliniğin karar vermesi gereken bir boşluk** — sürekli
tekrar eden bir alarm, alarm yorgunluğunun kendi zararını getirir.

## Alarmı Hiçbir Şey Engellemiyor

Bu uçtaki her karar aynı yöne bakıyor: istek **bitsin**.

- **Konum isteğe bağlı ve doğrulaması reddetmiyor.** DTO'da `@Min(-90)` yok. Olsaydı, henüz
  konum kilidi almamış bir telefon 400 alırdı — ve bu uçta 400, hastanın butona basıp
  **hiçbir şey olmaması** demektir. Aralık kontrolü `sanitiseLocation` içinde: bozuk değer
  iğneye mal oluyor, alarma değil.
- **(0, 0) atılıyor.** Fix alamamış bir GPS tam olarak bunu bildirir. Kaydedilirse Atlantik'e
  bir iğne koyar — ki bu, *konum yok* gibi değil, *konum var* gibi okunur ve birini oraya
  baktırır.
- **İki kez basmak ikinci alarm açmıyor.** Hiçbir şey olmadığını gören hasta tekrar basar,
  kopuk bağlantı isteği kendiliğinden tekrarlar. İki olay iki merdiven demektir; ikincisi,
  birincisi yanıtlandıktan sonra da tırmanmaya devam eder.
- **Bildirim fan-out'u işlemin dışında.** Alarmın kaydı, push ağ geçidine bağlı değil.
- **Bildirimler `deliverNow` ile gidiyor**, 30 saniyelik teslim süpürmesini beklemeden — yarım
  dakika, ilk basamağın sahip olduğu sürenin dörtte biri.

## Kapatılamayan Bildirim

Şablonlarda yeni bir bayrak var: `mandatory`. Yalnız acil durum bildirimlerinde açık, ve
kullanıcı tercihini geçersiz kılıyor — hem ilk kanalda hem fallback zincirinde.

Gerekçe: **kapatabildiğiniz bir alarm, önemli olduğu gece kapalı olan alarmdır**, ve kapatan
kişi kapattığını hatırlamaz. Diğer her bildirim kapatılabilir ve kapatılabilmelidir.

Sessiz saatler de acil bildirimleri tutmuyor (`urgent: true`).

## Camı Kırmak

Sistemin her yerinde, atanmamış bir hemşireye hasta **yok** denir — 404, 403 değil, çünkü 403
kaydın varlığını doğrular. Burada bu kural **yanlış**:

Merdivenin son basamağı bilerek "alarm alabilecek herkes", çünkü atanmış hemşire vardiyada
olmayabilir. Birini uyandırıp sonra ona 404 göstermek, hiç uyandırmamaktan kötüdür.

Genişletme bu yüzden bilinçli, ve çitli:

- yalnız `emergency.receive` — hasta ve finans hesapları kapsam dışı;
- yalnız **açık** çağrı; kapanan çağrı tarihtir ve olağan kapsama geri döner;
- **özet**, dosya değil: belge yok, fotoğraf yok, mesaj geçmişi yok;
- denetim günlüğüne **kendi eylemiyle** yazılıyor: `EMERGENCY_ACCESS`.

Son madde genişletmenin bütün gerekçesi. Sıradan bir `READ` olarak yazılsaydı, "kim atanmadığı
bir dosyayı açtı" sorusu yüz bin satırın içinde arkeoloji olurdu; ayrı bir eylem olarak bu bir
sorgu.

## Ekrandaki Özet

Klinisyenin ilk beş saniyede ihtiyaç duyduğu şey bir dosya değil, bir kart: kan grubu ve
alerjiler en başta, çünkü bir ambulans ekibinin ne yapacağını değiştiren iki bilgi bunlar.
Ardından kronik hastalıklar, kullanılan ilaçlar, son ameliyat (kaç gün önce), sorumlu doktor,
telefon ve konum.

## "Biz Ulaşana Kadar" Kartı

Kart bilerek **lojistik, tedavi değil**. Her satır ya kliniğin hastaya daha hızlı ulaşmasını
sağlıyor ya da sonraki saati kolaylaştırıyor; hiçbiri hastanın durumu hakkında tavsiye değil.
Bu sınır çekingenlik değil: başka bir ülkedeki ameliyat sonrası bir hastaya, tahmin ettiği bir
dilde, onu görmeden semptomları hakkında ne yapacağını söyleyen bir uygulama, telefondan
hekimlik yapıyordur.

Klinik bu metni kendi metniyle değiştirmeli. Kodun garanti ettiği şey, kartın **hiç boş
olmaması** ve ilk satırı **hiç atlamaması**.

### İlk satır kliniğin dışını gösteriyor

Tek `critical` satır, hastaya *bizi bekleme, hemen yerel ambulansı ara* diyor. Nefes darlığı
olan bir hasta dakikalarını bir mesaj kanalında beklemekle geçirmemeli.

### Acil numara

`patients.country` üzerinden, GPS üzerinden değil: ters coğrafi kodlama, dış servise
bağımlı olmaması gereken tek istekte dış servis demek olurdu. Sonucu: seyahat eden hasta kendi
ülkesinin numarasını görür — bu yüzden istemci numaranın yanında **ülke adını** gösteriyor ve
tahmin edilen numaraları (`source: "international"`) uyarıyla işaretliyor.

> **Bu tablo operasyonel veri, mühendislik verisi değil.** Numaralar değişir, bazı ülkeler tıbbi
> çağrıyı polisten ayrı yönlendirir. Tek dosyada, tek biçimde duruyor ki bir klinik onu liste
> olarak gözden geçirebilsin. **Yetkili bir kaynağa karşı doğrulanmadı.**

## İki Adımlı Onay

Sunucuda değil, uygulamalarda — sunucu tarafı bir onay adımı ikinci bir istek demektir, ve
ikinci istek, hastanın karar vermesi ile birinin haberdar olması arasında bağlantının kopması
için ikinci bir fırsattır.

İstemci modeli üç kuralı da taşıyor:

1. **İki basış, bir değil.** Klinik bir alarmı tetikleyen tek düğmeye bir cep basar.
   Kurulma penceresi kendiliğinden kapanıyor, ki onu kuran cep bir sonraki cep için kurulu
   bırakmasın.
2. **Konum alarmı geciktirmiyor.** Soğuk GPS on beş saniye sürer; istek o ana kadar bilinenle,
   hiçbir şey bilinmiyorsa hiçbir şeysiz gidiyor.
3. **Başarısızlık ekranda bir telefon numarası bırakıyor.** Ağ yokken yerel ambulans en çok
   işe yarayan şeydir; kart bu yüzden yanıttan ayrı tutuluyor ve önceden çekiliyor.

## Yanlış Alarm

Hasta **kimse almadan önce** kendi çağrısını iptal edebiliyor. Bir klinisyen çağrıyı aldıktan
sonra edemiyor: o kişi muhtemelen hastayla telefondadır, ve kaydın altından kapanması onu
hiç yaşanmamış gösteren bir olaya baktırır. O noktadan sonra kapatmak klinisyenin işi
(`falseAlarm` ile).

Kimsenin yanıtlamadığı bir çağrıyı kapatmak, onay damgasını da basıyor: tek adımda ilgilenen
klinisyen **yanıt vermiştir**, ve alanı boş bırakmak o çağrıyı "hiç yanıtlanmadı" diye
kaydederek bu özelliğin ürettiği tek sayıyı bozar.

## Uçlar

| Uç | Yetki | Ne yapar |
|---|---|---|
| `POST /me/emergency` | `self.emergency` | Alarmı verir; açık çağrı varsa onu döner |
| `GET /me/emergency/guidance` | `self.read` | Kart — önceden çekilmek için |
| `GET /me/emergency/active` | `self.read` | Açık çağrı, varsa |
| `PATCH /me/emergency/{id}/cancel` | `self.emergency` | Yanlışlıkla bastım |
| `GET /emergency` | `emergency.receive` | Açık çağrılar, en uzun bekleyen önce |
| `GET /emergency/{id}` | `emergency.receive` | Çağrı + klinik özet (**cam kırma**) |
| `PATCH /emergency/{id}/acknowledge` | `emergency.receive` | Ben ilgileniyorum |
| `PATCH /emergency/{id}/resolve` | `emergency.resolve` | Çözüm notuyla kapat |

## Yapılmayanlar

- **Otomatik arama** (§M8 "opsiyonel"): bir telefon sağlayıcısı gerektiriyor, T4.2'nin
  APNs/FCM borcuyla aynı sırada.
- **Bildirimin cihazda görünmesi** doğrulanamıyor — sunucu satırı yazıyor ve kanalı deniyor,
  ama gerçek push sağlayıcısı yok (bkz. [BILDIRIMLER.md](BILDIRIMLER.md)).
- **Merdiven tükendikten sonra tekrar alarm**: şartnamede yok, ve alarm yorgunluğu kendi
  zararını getirdiği için kliniğin kararına bırakıldı. `unanswered` bayrağı boşluğu görünür
  kılıyor.
