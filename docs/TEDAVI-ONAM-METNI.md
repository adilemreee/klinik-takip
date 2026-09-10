# Tıbbi Müdahale Aydınlatılmış Onam Formu

> **Bu metin klinik tarafından hekim ve avukat incelemesinden geçirilmelidir.**
> Yapısı Hasta Hakları Yönetmeliği m.15 ve m.24'ün saydığı unsurlara göre
> yazıldı, ama hukuki görüş değildir ve hiçbir metin hekimin hastayla yaptığı
> konuşmanın yerine geçmez.
>
> Köşeli parantezli alanlar klinik tarafından doldurulur:
> `[KLİNİK ADI]`, `[ADRES]`, `[TELEFON]`, `[ACİL TELEFON]`.
>
> `{{...}}` alanlarını **sunucu dolduruyor** — hastanın kayıtlı ameliyat
> bilgisinden. İşlem kayıtlı değilse form hiç sunulmuyor: işlemi adıyla anmayan
> bir belge aydınlatılmış onam değildir.
>
> İşleme özel riskler ayrı bir dosyada: `TEDAVI-ONAM-<İŞLEM KODU>.md`. Varsa
> sunucu bu metnin sonuna ekliyor. Bkz. [KLINIKTEN-ISTENENLER](KLINIKTEN-ISTENENLER.md) 13.

---

## Kim, neyi onaylıyor

| | |
|---|---|
| Sağlık kuruluşu | `[KLİNİK ADI]`, `[ADRES]` |
| Planlanan işlem | **{{islem}}** |
| İşlemi yapacak hekim | {{hekim}} |
| Planlanan tarih | {{tarih}} |

Bu formu okuyup imzaladığınızda, yukarıdaki işlemin size anlatıldığını ve
sorularınızın yanıtlandığını beyan etmiş olursunuz.

## 1. İşlemin amacı ve nasıl yapılacağı

İşlem `[KLİNİK ADI]` bünyesinde, yukarıda adı geçen hekim ve ekibi tarafından
yapılacaktır. İşlemin amacı, süresi, uygulanacak yöntem ve hastanede kalış
süresi hekiminiz tarafından size sözlü olarak ayrıca anlatılır.

Ekibin bir üyesinin değişmesi gerekebilir. Bu durumda işlemi yapacak hekim yine
aynı yetkinlikte bir hekim olur ve size önceden bildirilir.

## 2. Diğer seçenekler

Her tıbbi durumun birden fazla seçeneği vardır ve **hiçbir işlemi yaptırmamak da
bir seçenektir**. Hekiminiz size:

- başka bir tedavi yöntemi olup olmadığını,
- bekleyip izlemenin ne anlama geldiğini,
- ve **hiçbir şey yapılmazsa** ne olabileceğini

anlatmakla yükümlüdür. Bunları duymadan imzalamayın.

## 3. Riskler ve olası komplikasyonlar

Her cerrahi ve tıbbi işlem risk taşır. Bunların bir kısmı her işlemde
görülebilir:

- Kanama ve buna bağlı kan verilmesi ihtiyacı
- Enfeksiyon
- Yara iyileşmesinde gecikme, iz kalması
- Anesteziye bağlı istenmeyen etkiler (bkz. bölüm 4)
- Damar tıkanıklığı (tromboz) ve akciğer embolisi
- Beklenen sonucun elde edilememesi ve **düzeltme işlemi gerekmesi**
- Nadiren, hayatı tehdit eden durumlar

**Bu liste genel bir listedir.** Sizin yaptıracağınız işleme özel riskler
hekiminiz tarafından anlatılır ve — klinik tanımlamışsa — bu formun sonundaki
ek bölümde yazılıdır.

Sigara kullanımı, şeker hastalığı, kan sulandırıcı ilaçlar, obezite ve daha
önce geçirilmiş ameliyatlar bu risklerin hepsini artırır. Hekiminize
söylemediğiniz bir ilacın veya hastalığın sorumluluğu size aittir.

## 4. Anestezi

İşlem için genel anestezi, sedasyon veya lokal anestezi uygulanabilir. Hangisinin
uygulanacağı ve nedenleri anestezi hekimi tarafından ayrıca anlatılır ve
gerekiyorsa ayrı bir anestezi onamı alınır.

Anestezi öncesi **aç kalma** talimatına uymamak işlemin ertelenmesine ya da
ciddi solunum komplikasyonlarına yol açar.

## 5. Kullanılacak ilaçlar

İşlemden sonra ağrı kesici, antibiyotik ve gerekiyorsa kan sulandırıcı
reçetelenir. Her ilacın kendi yan etkileri vardır; kutu içindeki kullanma
talimatını okuyun.

Uygulamadaki ilaç takibi hatırlatma amaçlıdır; **hekim talimatının yerine
geçmez**. Bir ilacı bırakmak, dozunu değiştirmek ya da başka bir ilaç eklemek
istiyorsanız önce kliniğe sorun.

## 6. Ameliyat sonrası: sizden beklenenler

Sonucun büyük bölümü işlemden sonraki haftalarda belirlenir. Kabul ediyorsunuz:

- Kontrol randevularına gelmeyi ya da uygulamadan bildirmeyi
- İstenen ölçüm, fotoğraf ve anketleri zamanında göndermeyi
- Yara bakımı, ilaç ve hareket kısıtlaması talimatlarına uymayı
- Beklenmeyen bir durumda **beklemeden** kliniğe haber vermeyi

**Uçuş:** ameliyattan sonra ne zaman uçabileceğinize hekiminiz karar verir.
Onay verilmeden uçmak tromboz riskini ciddi biçimde artırır.

## 7. Acil durumda ne yapmalısınız

| Durum | Ne yapın |
|---|---|
| Şiddetli kanama, nefes darlığı, göğüs ağrısı, bilinç bulanıklığı | **112**'yi arayın |
| Ateş, artan ağrı, yarada kızarıklık/akıntı, ani şişlik | `[ACİL TELEFON]` |
| Diğer sorular | Uygulamadaki mesaj ekranı ya da `[TELEFON]` |

**Uygulama acil durum kanalı değildir.** Mesajlar klinik saatleri içinde
okunur; acil durum butonu kliniği uyarır ama **112'nin yerine geçmez**.

## 8. Yurt dışından geliyorsanız

- Kliniğin sağladığı tercüman hizmetinden yararlanma hakkınız vardır. Anlamadığınız
  bir şey varsa **tercüman isteyin ve imzalamayın**.
- Dönüş uçuşunuzu, olası bir komplikasyon veya ek gün gerekliliğini hesaba katarak
  planlayın.
- Ülkenize döndükten sonraki takip uygulama üzerinden sürer; hangi bulguda hangi
  hekime başvurmanız gerektiği taburcu belgenizde yazar.

## 9. Fotoğraf ve kayıtlar

Tedavinizin takibi için yara ve sonuç fotoğrafları çekilir. Bunlar **tıbbi
kaydınızın parçasıdır** ve bu onamın kapsamındadır.

Fotoğrafların **tanıtım, eğitim veya sosyal medyada kullanımı bu onama dahil
değildir**; ayrı ve ayrıca geri alınabilir bir izin gerektirir. Uygulamadaki
"İzinlerim" ekranından verebilir ve dilediğiniz an geri alabilirsiniz.

## 10. Onamınızı geri alabilirsiniz

İşlem başlamadan önce, **hiçbir gerekçe göstermeden** vazgeçebilirsiniz.
Vazgeçmeniz tedavi hakkınıza zarar vermez.

İşlem başladıktan sonra durdurmak tıbbi olarak mümkün olmayabilir; hekiminiz
sizi bu konuda ayrıca bilgilendirir.

## 11. Beyanınız

Bu formu imzalayarak beyan ediyorsunuz:

1. Formu okudum ya da bana okundu; anlamadığım yerleri sordum ve yanıtlandı.
2. İşlemin amacı, yöntemi, riskleri, diğer seçenekleri ve hiçbir şey
   yapılmaması hâlinde olabilecekler bana anlatıldı.
3. Bana **garanti edilen bir sonuç olmadığını**, tıbbın kesin sonuç taahhüdü
   içermediğini anlıyorum.
4. Geçmiş hastalıklarımı, kullandığım ilaçları ve alerjilerimi eksiksiz bildirdim.
5. Ameliyat sonrası talimatlara uyacağımı ve kontrollere geleceğimi kabul ediyorum.
6. Bu onamı **kendi hür irademle** veriyorum.

---

*Bu metnin sürümü onam kaydınızda saklanır. Metin değişirse sürüm numarası
artar ve eski onamlar hangi metne verildiyse o metne bağlı kalır.*
