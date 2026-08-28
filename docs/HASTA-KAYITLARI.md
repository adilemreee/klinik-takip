# Hasta Kayıtları

Şartname §6 M2, §9. Modül: [`backend/src/patients/`](../backend/src/patients/)

Bu modül önceki üç katmanı birleştirir: kapsamlama (T1.3), denetim (T1.4) ve trigram
indeksleri (T1.1).

## Dosya Numarası Rastgeledir

```
2026-K7RMPX
```

Sıralı bir dosya numarası, elinde bir tane olan herkese kliniğin kaç hastası olduğunu
söyler ve aralığı gezmesine izin verir. Yıl öneki personelin bir bakışta yerleştirmesi
için; sayım bilgisi taşımaz.

Alfabe, telefonda okunurken veya basılı bir rapordan kopyalanırken karışabilecek
karakterleri dışarıda bırakır: `0/O` ve `1/I/L`. `U` de çıkarıldı — rastgele altı
karakterin klinik bir belgede talihsiz bir şey yazmasını engellemek için. Kalan 30
karakter yine de 729 milyon kombinasyon veriyor.

Sağlık turizminde bu numara sık sık dil engeli üzerinden sözlü olarak paylaşılıyor;
karışan bir karakter yanlış dosyanın açılması demek.

## Kapsam Sorgunun İçindedir

Arama, çağıranın kapsamını sonuçlara değil **sorguya** koyar:

```ts
const scope = await this.access.scopeFilter(user);
const filters = [scope, ...];
```

Okumadan sonra yapılan filtreleme, unutulmuş bir `count()` veya sayfalamanın bir kenar
durumunun er geç sızdıracağı filtrelemedir.

## Aramanın Şekli

| Filtre | Nasıl |
|---|---|
| Serbest metin (`q`) | Ad, soyad ve dosya no üzerinde `ILIKE '%…%'` — trigram GIN indeksleri hizmet ediyor |
| Ülke, durum, sorumlu doktor | Doğrudan eşleşme |
| Ameliyat tipi ve tarih aralığı | `surgeries` ilişkisi üzerinden |

Kısmi ve yanlış yazılmış isimler aranabiliyor: sağlık turizminde dosyadaki yazım ile
yazılan sıklıkla farklı oluyor (§M2).

Sayfalama **cursor** ile (§9). Kimlikler UUIDv7 olduğu için `id`'ye göre sıralama zamana
göre sıralama: ikinci bir sıralama anahtarı gerekmiyor ve aynı milisaniyede oluşturulan
satırlarda bile imleç kararlı.

## Kapsam Dışı = 404

Kapsam dışı bir hasta ile var olmayan bir hasta **aynı yanıtı** verir. 403 kaydın var
olduğunu doğrular; hesabı olan biri "şu kişi burada hasta mı" sorusunu deneyerek
yanıtlayabilirdi.

**Ama izin ve kapsam farklı sorulardır:** ataması olmayan bir hemşire `GET /patients`
çağırdığında 403 değil, **boş sayfa ile 200** alır. `patients.read` iznine sahiptir;
sadece görebileceği hasta yoktur.

## Denetim

| İşlem | Nasıl kaydedilir |
|---|---|
| Oluşturma, güncelleme, silme | **Aynı işlem içinde** — kaydı olmayan bir değişiklik veya olmamış bir değişikliğin kaydı, başarısız bir istekten kötüdür |
| Okuma (liste ve tekil) | `@Audit` interceptor'ı ile |
| **Personel ataması** | `PERMISSION_CHANGE` olarak — atama, dosyayı kimin görebileceğine karar verir, yani operasyonel olduğu kadar güvenlik değişikliğidir |

Reddedilen bir istek **kaydedilmez**: guard'da durdurulan bir çağrı veriye hiç ulaşmadı,
onu okuma olarak kaydetmek izi yalancı yapardı. Test ile korunuyor.

### Bu task sırasında düzeltilen bir tasarım hatası

Okuma denetimi "ateşle-unut" (`void`) çalışıyordu: yanıt dönerken kayıt henüz
yazılmamıştı. Yalnız testte yarış değil — süreç o anda durursa kayıt **tamamen
kaybolurdu**. *Muhtemelen* eksiksiz olan bir iz, iz değildir.

Artık yanıt yazmayı bekliyor. Maliyet tek bir indeksli `INSERT`; `audit.record` kendi
hatalarını yuttuğu için okumayı başarısız kılamıyor.

## Silme Yumuşaktır

Klinik kayıtların yasal saklama süreleri var. "Verilerimi sil" talebi dosyayı pasife alır;
satır yok edilmez, süresi dolduğunda anonimleştirilir (§8).

## İzin Haritası

| Uç | İzin |
|---|---|
| `POST /patients` | `patients.write` |
| `GET /patients`, `GET /patients/:id` | `patients.read` |
| `PATCH /patients/:id` | `patients.write` |
| `PUT /patients/:id/medical-profile` | `medical.write` |
| `POST/DELETE /patients/:id/assignments` | `patients.assign` |
| `DELETE /patients/:id` | `patients.delete` |

Pratik sonuçları (hepsi test edilmiş): koordinatör hasta oluşturabilir ama **klinik profile
dokunamaz**; hemşire klinik profili yazabilir ama **hasta oluşturamaz ve atama yapamaz**;
finans hiçbirine erişemez.

## Test Kapsamı

| Dosya | Adet | Odak |
|---|---|---|
| `src/patients/mrn.spec.ts` | 17 | Dosya numarası: rastgelelik, karışabilir karakterler |
| `test/patients.integration.spec.ts` | 26 | Kapsamlama, arama, denetim atomikliği, yumuşak silme |
| `test/patients-http.integration.spec.ts` | 22 | Rol bazlı izinler, 404/403 ayrımı, doğrulama |
