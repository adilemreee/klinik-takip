# Veri Modeli

Şema: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma) · 43 tablo, 127 indeks.

## Genel Kurallar

| Karar | Gerekçe |
|---|---|
| **UUIDv7 birincil anahtar** | Sıralı bir `id` kaç hasta olduğunu sızdırır ve aralığı gezmeye izin verir. UUIDv7 tahmin edilemez ama zaman sıralı — hem imleç (cursor) olarak kullanılabilir hem indeks yerelliğini korur. |
| **Para ve klinik değerler `Decimal`** | Asla `Float`. Bir dozdaki veya faturadaki yuvarlama hatası kabul edilemez. İkili kayan noktalı sayılar 0.1'i tam gösteremez. |
| **`patient_id` + sıralama kolonu bileşik indeks** | Her ekran "bu hasta, en yeni önce" sorar (§9). |
| **Silme yumuşak veya anonimleştirici** | Klinik kayıtların yasal saklama süresi vardır; talep üzerine satır yok edilmez, kimlik alanları temizlenir (§8, KVKK). |
| **Zaman damgaları `timestamptz`** | Hastalar farklı ülkelerde; saat dilimi olmayan bir zaman damgası sağlık turizminde anlamsızdır. |

## Şartname §5'e Eklediklerim

Şartnamedeki varlık listesinde olmayan ama modülleri çalışır kılmak için gereken tablolar:

| Tablo | Neden |
|---|---|
| `surgeries` | Kontrol takvimi (M10) ameliyat tarihinden üretiliyor, finans paneli (M11) ameliyat tipine göre kırılım istiyor. Gevşek bir alan yerine birinci sınıf kayıt olmalı. |
| `device_sessions` | §2 "cihaz bazlı oturum listesi ve uzaktan çıkış" istiyor; tek bir refresh token bunu yapamaz. |
| `invitations` | §2 self-signup yok diyor; davet akışının kendi kaydı gerekiyor. |
| `permissions` / `role_permissions` / `user_permissions` | §2 "yetkiler koda gömülmez" diyor. |
| `follow_up_milestones` | Ayrı satır, JSON değil — aşağıya bakın. |
| `analyte_mappings` | §M16 "doktor bir kez eşleştirir → sistem öğrenir". |
| `exchange_rates` | §M11 kur çevrimi; tarihli kur olmadan geçmiş rapor sonradan değişir. |
| `push_tokens`, `notification_preferences` | §M6 kanal tercihleri ve sessiz saatler. |
| `protocol_documents` / `protocol_chunks` | §M4 RAG kaynağı, pgvector ile. |
| `access_windows` | §M3 erişim penceresi. |
| `caregiver_links` | §2 CAREGIVER rolü, geri alınabilir onayla. |
| `document_requirements` | §M17 ameliyat öncesi belge kontrol listesi. |

**`follow_up_milestones` neden ayrı tablo?** §5 `follow_up_schedules.milestones` için JSON öneriyor. Ama zamanlayıcının her dakika sorduğu soru "bugün hangi kontroller vadesi geldi — tüm hastalar arasında". Bu, bir kolon üzerinde indeks taramasıdır; JSON içinde gezinme değil. Her kilometre taşı ayrı satır.

## Veritabanı Seviyesinde Zorlanan Garantiler

Prisma'nın şema dilinin ifade edemediği, ayrı bir migration'da SQL ile yazılanlar:

### Değiştirilemez denetim günlüğü (§13)

`audit_logs` üzerinde `UPDATE`, `DELETE` ve `TRUNCATE`'i reddeden trigger'lar.

**Neden `REVOKE` değil trigger?** Uygulama veritabanı sahibi olarak bağlanıyor ve bir sahibin yetkileri ondan anlamlı şekilde geri alınamaz — her zaman kendine geri verebilir. Trigger yazma işleminin kendisini durdurur, dolayısıyla ne ORM katmanındaki bir hata ne de ele geçirilmiş bir uygulama hesabı geçmişi yeniden yazabilir.

`TRUNCATE` için ayrı bir statement-level trigger var: satır seviyesindeki trigger'lar `TRUNCATE`'te tetiklenmez ve tabloyu tek komutta boşaltırdı.

Bu, entegrasyon testlerinde **veritabanı sahibi kimliğiyle** doğrulanıyor.

### Arama indeksleri (§M2)

`patients` üzerinde ad, soyad ve dosya no için trigram GIN indeksleri. Personel kısmi ve yanlış yazılmış isimlerle arıyor; sağlık turizminde sistemdeki yazım ile aranan yazım sık sık farklı. B-tree baştaki joker karaktere hiç hizmet edemez.

### Vektör indeksi (§M4)

`protocol_chunks.embedding` üzerinde HNSW. IVFFlat yerine HNSW: IVFFlat eğitilmek için önceden temsili veri ister, bu tablo boş başlıyor.

### Kısmi indeksler

Zamanlayıcı ve bildirim dağıtıcısı yalnızca `PENDING` satırlara bakıyor; indekse yalnız onları koymak taramayı ucuzlatıyor.

## Migration ve Geri Alma

```bash
npx prisma migrate deploy   # deploy sırasında otomatik çalışır (migrate servisi)
npm run seed                # izin matrisi, idempotent
```

> ⚠️ **Prisma "down migration" üretmez.** Şartname §12 "geri alınabilir" istiyor; Prisma'da bunun karşılığı şudur:
>
> 1. **Veri kaybı olmayan değişiklikler** (kolon/tablo ekleme): ileri yönlü bir düzeltme migration'ı yazılır.
> 2. **Yıkıcı değişiklikler** (kolon düşürme, tip daraltma): geri dönüş yolu **yedekten geri yüklemedir** — bkz. [YEDEKLEME.md](YEDEKLEME.md). Bu yüzden yıkıcı bir migration'ı içeren her deploy öncesi elle yedek alınır.
>
> Bu bir eksiklik değil, bilinçli bir kabul: sahte bir "down migration" veri kaybını geri getiremez ve getirdiği güven yanlıştır.

## Yerel Geliştirme

```bash
docker run -d --name klinik-dev-db -e POSTGRES_USER=klinik -e POSTGRES_PASSWORD=klinik \
  -e POSTGRES_DB=klinik -p 55432:5432 pgvector/pgvector:pg16
```

`backend/.env` içine (repoya girmez):

```
DATABASE_URL=postgresql://klinik:klinik@localhost:55432/klinik?schema=public
```

Sonra `npx prisma migrate deploy && npm run seed && npm run test:integration`.

## İzin Matrisi

42 izin, 7 rol, 113 atama. Kaynak: [`backend/prisma/permissions.ts`](../backend/prisma/permissions.ts) — ama bu yalnızca **seed**; çalışma anındaki doğruluk kaynağı veritabanıdır.

§2'nin iki ayrımı test ile korunuyor:
- **NURSE hiçbir finansal izne sahip değil**
- **FINANCE hiçbir klinik izne sahip değil**

| Rol | İzin sayısı |
|---|---|
| SUPER_ADMIN | 42 |
| DOCTOR | 37 |
| NURSE | 14 |
| COORDINATOR | 10 |
| FINANCE | 4 |
| PATIENT | 4 |
| CAREGIVER | 2 |
