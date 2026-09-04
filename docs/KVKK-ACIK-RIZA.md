# Açık Rıza Metinleri

> **Taslak; avukat incelemesi gerektirir.** Bkz. [KVKK-AYDINLATMA-METNI](KVKK-AYDINLATMA-METNI.md).

## Bu belge neden dört ayrı metin içeriyor

Kurul'un **2026/347** sayılı ilke kararı iki şey söylüyor:

1. Aydınlatma ve açık rıza **ayrı** metinler olacak — bu yüzden bu ayrı bir dosya.
2. İşleme açık rıza dışındaki bir şarta dayanıyorsa **açık rıza istenmeyecek.**

İkincisi, "her şeye onay al" refleksinin tam tersi. Tedavi için rıza istemek
yanlıştır: dayanak m.6/3'tür, rıza istemek hastaya *reddedebileceği* izlenimini
verir — oysa reddederse tedavi edilemez, yani rıza gerçek anlamda özgür değildir.
Kurul buna "geçersiz rıza" diyor.

Bu yüzden aşağıda **yalnız dört** rıza var ve hepsi tek tek verilir. Hiçbiri
tedavinin şartı değildir; hepsi ayrı ayrı reddedilebilir ve geri alınabilir.

Uygulama karşılığı: `ConsentType` = `TREATMENT`, `DATA_PROCESSING`,
`PHOTO_USAGE`, `MARKETING`. **`TREATMENT` bir KVKK rızası değildir** — tıbbi
müdahale onamıdır (hasta hakları mevzuatı), ayrı bir şeydir ve bu belgeye
girmez.

---

## 1. Fotoğrafların tanıtımda kullanılması

> `[KLİNİK ADI]` tarafından tedavi sürecimde çekilen fotoğrafların, kimliğimi
> belirli veya belirlenebilir kılmayacak şekilde, klinik tanıtım materyallerinde
> ve internet sitesinde kullanılmasına **açık rıza veriyorum.**
>
> Bu rızayı vermemem tedavimi etkilemez. Rızamı dilediğim zaman geri
> alabilirim; geri aldığımda fotoğraflarım yayından kaldırılır.

☐ Rıza veriyorum ☐ Rıza vermiyorum

**Not:** Tedavi ve takip için çekilen klinik fotoğraflar bu rızaya bağlı
değildir; onlar m.6/3 kapsamında işlenir. Bu rıza yalnız **tanıtım** kullanımı
içindir. İkisinin karıştırılması, rıza vermeyen bir hastanın yara takibinin
yapılamaması demek olurdu.

## 2. Yapay zekâ ile işleme

> Tedavi sürecimle ilgili metinlerin (mesajlarım, şikayet bildirimlerim, tahlil
> raporlarımın metni) özetleme, çeviri ve ön değerlendirme amacıyla
> `[AI SAĞLAYICI]` hizmetine gönderilerek işlenmesine **açık rıza veriyorum.**
>
> Bu rızayı vermemem tedavimi etkilemez; klinik değerlendirmeyi her hâlükârda
> bir sağlık personeli yapar. Yapay zekâ çıktısı tek başına teşhis değildir.

☐ Rıza veriyorum ☐ Rıza vermiyorum

**Klinik için not:** Sağlayıcı yurt dışındaysa bu rıza **tek başına yetmez** —
m.9 uyarınca ayrıca uygun güvence (standart sözleşme + Kuruma beş iş günü içinde
bildirim) gerekir. Uygulama, sağlayıcının sıfır saklama politikası onaylanmadan
klinik istem göndermeyi reddeder.

## 3. Yurt dışına aktarım

> Kişisel verilerimin, hizmetin sunulabilmesi için `[ÜLKE/SAĞLAYICI]`
> bulunan sunuculara aktarılmasına **açık rıza veriyorum.**
>
> Aktarımın yapıldığı ülkede Türkiye'dekiyle aynı düzeyde koruma bulunmayabilir.

☐ Rıza veriyorum ☐ Rıza vermiyorum

**Klinik için not:** Açık rıza, m.9/6'daki istisnalardan biridir ve
**süreklilik arz eden aktarımlar için uygun değildir.** Barındırma gibi sürekli
bir aktarım varsa doğru yol standart sözleşmedir, rıza değil. Bu metin yalnız
arızi aktarımlar için kullanılmalıdır.

## 4. Pazarlama iletisi

> `[KLİNİK ADI]` tarafından kampanya, tanıtım ve bilgilendirme iletileri
> gönderilmesine ve bu amaçla iletişim bilgilerimin işlenmesine **açık rıza
> veriyorum.**

☐ E-posta ☐ SMS ☐ WhatsApp ☐ Hiçbiri

**Not:** Randevu hatırlatması, ilaç hatırlatması ve tahlil sonucu bildirimi
pazarlama değildir; sözleşmenin ifasıdır ve bu rızaya bağlı değildir. Hasta
pazarlamayı reddettiğinde klinik bildirimleri almaya devam eder — aksi, bir
hastanın kontrol randevusunu kaçırması demek olurdu.

---

## Rızanın geri alınması

Her rıza, verildiği yerden geri alınabilir: uygulamada ilgili ekrandan veya
`[E-POSTA]` adresine bildirimle. Geri alma **ileriye etkilidir**; geri alınana
kadar yapılan işleme hukuka uygundur.

Sistem geri almayı `consents.revoked_at` ile kaydeder ve o andan itibaren ilgili
işlemeyi durdurur. Refakatçi erişimi de aynı şekilde çalışır.

## Kayıt altına alınanlar

Her rıza için saklanan: hangi tip, hangi metin sürümü, ne zaman, hangi IP ve
tarayıcı/uygulama bilgisiyle, geri alındıysa ne zaman. Bu, rızanın varlığını
ispat yükümlülüğü veri sorumlusunda olduğu içindir.
