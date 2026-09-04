# Yük Testi

Şartname T7.1. Kod: [`backend/load/`](../backend/load/)

## Nerede koşturuldu — ve nerede koşturulmadı

**Staging sunucusuna yöneltilmedi.** O makine 21 başka servisi barındırıyor ve
500 eşzamanlı kullanıcı onları etkiler. Testler geliştirme makinesinde, yerel
PostgreSQL/Redis'e karşı koşturuldu.

Bunun anlamı açık olsun: **aşağıdaki sayılar uygulamanın davranışını ölçer,
üretim donanımının kapasitesini değil.** Sorgu şekilleri, indeks kullanımı,
bağlantı havuzu davranışı ve N+1 türü hatalar burada görünür — gerçek disk ve
ağ gecikmesi görünmez.

## Senaryo 1 — Hastanın günü

`load/patient-day.js`. Tek uca döngü değil: uygulamayı aç, kim olduğunu öğren,
ana ekranı oku, sonra ana ekranın sunduklarından birine bak. Kullanıcılar
arasında 1–4 saniye bekleme var; onsuz ölçülen şey k6'nın ne kadar hızlı
sorabildiği olur, kaç kişinin sığdığı değil.

| | |
|---|---|
| Eşzamanlı kullanıcı | **500** (30s'de 100'e, 30s'de 500'e rampa, 60s sabit) |
| İstek | 54.757 |
| **Hata** | **%0** |
| `/me/identity` p95 | 21 ms |
| `/me/summary` p95 | 41 ms |
| Genel p95 | 36 ms |
| Verim | ~381 istek/sn |

Eşikler (`http_req_failed < %1`, identity p95 < 500ms, home p95 < 800ms) geçti.

**Giriş döngünün dışında ölçüldü** (80 ms). Argon2id kasten yavaştır — 46 MiB,
üç geçiş. Her yinelemede giriş yapan bir test parola özetini ölçer ve bilinçli
bir güvenlik özelliğini darboğaz diye raporlar.

## Senaryo 2 — Personel hasta araması

`load/staff-search.js`. Sistemdeki en ağır okuma: 5.000 hasta üzerinde bulanık
ad araması, sıralı ve sayfalı. Sayfalama ölçümün parçası, çünkü imleç
uygulamasının yük altında bozulduğu yer orası.

| | |
|---|---|
| Eşzamanlı personel | **50** (bir klinikte onlarca personel olur, yüzlerce değil) |
| İstek | 3.573 |
| **Hata** | **%0** |
| Arama p95 | 106 ms |
| Arama medyan | 14 ms |
| En kötü | 1,7 sn |

Eşik (arama p95 < 1000ms) geçti. 1,7 sn'lik kuyruk not edildi; p95 106 ms
olduğu için optimizasyon gerektirmiyor, ama üretim donanımında yeniden
ölçülmeli.

## Testin bulduğu üç şey

### 1. Hız sınırlayıcı kodda gömülüydü

İlk koşuda isteklerin **%97'si başarısız** oldu — ama yanıt süreleri 1 ms'ydi.
Darboğaz değil: dakikada 120 istek/IP sınırı. Üretimde doğru olan bu; 500 hasta
500 adresten gelir, bir yük üreteci tek adresten.

Sınır artık `THROTTLE_LIMIT` ve `THROTTLE_TTL_MS` ile yapılandırılabiliyor,
**varsayılanı değişmedi**. Yükseltmek bilinçli bir eylem, izole bir ortamda, ve
izini geçici olarak düzenlenmiş bir kaynak dosyada değil ortamda bırakıyor.

### 2. Arama Türkçe harfleri katlamıyordu

Ölçüm için ürettiğim aramalar sıfır sonuç döndürünce çıktı: **`yil` yazınca
`Yılmaz` bulunmuyordu.** `ILIKE` büyük/küçük harfe duyarsız ama aksana değil.

Bir sağlık turizmi kliniği için bu ciddi: Türkçe klavyesi olmayan bir
koordinatör ya da adı aksansız girilmiş bir hasta aranınca **hiçbir şey
çıkmıyor** — ve klinikte "sonuç yok", "bu hasta sistemde değil" diye okunur.

Düzeltildi: adlar ve dosya numarası, katlanmış hâlleriyle ayrı bir sütunda
saklanıyor ve trigram indeksiyle aranıyor. Ayrıntısı ve neden `normalize('NFD')`
tek başına yetmediği (**ı'nın ayrıştıracak bir aksanı yok**)
[`search-folding.ts`](../backend/src/patients/search-folding.ts) içinde.

### 3. Koordinatör kapsamı doğru çalışıyor

Yük testinin ilk personel hesabı hiçbir hasta göremedi. Hata değil: atanmamış
bir koordinatör yalnız kendi hastalarını görür (T1.3). Ölçüm için hesaba
`canSeeAllPatients` verildi — kliniğin ön masası için gerçekçi olan da bu.

## Nasıl koşturulur

```bash
k6 run -e BASE_URL=http://127.0.0.1:3000 \
  -e IDENTIFIER=... -e PASSWORD=... backend/load/patient-day.js
```

Personel senaryosu ayrıca `-e TOTP=...` istiyor; personel girişinde ikinci
faktör zorunlu ve kodlar tek kullanımlık.

**Paylaşılan bir sunucuya yöneltmeyin.**
