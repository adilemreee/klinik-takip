# Yedekleme ve Geri Yükleme

## Tasarım

Sunucuda **backrest** (restic) zaten çalışıyor ve `/opt/backups` dizinini şifreli
olarak **off-site** bir sağlayıcıya (Oracle'dan farklı) taşıyor. Sunucunun mevcut
deseni şudur: her uygulama kendi verisini `/opt/backups/<isim>` altına döker,
backrest oradan alır.

**Bu projede aynı desen izlenir. Backrest yapılandırmasına dokunulmaz** — böylece
mevcut yedekleme kurulumunda bozma riski sıfırdır.

```
/opt/klinik/backup.sh        günlük 02:20  ──┐
/opt/klinik/restore-test.sh  Pazar 04:40     │
                                             ▼
                        /opt/backups/klinik/<ortam>/
                          ├── pg-<ts>.dump.zst.gpg   (AES-256, 0600)
                          └── minio/                 (artımlı mirror)
                                             │
                                             ▼
                        backrest 'kritik' planı → off-site (şifreli)
```

## Neden `pg_dump`, neden volume kopyası değil?

Çalışan bir PostgreSQL'in veri dizinini dosya seviyesinde kopyalamak **tutarlı bir
yedek vermez** — kopyalama sırasında yazılan sayfalar yarım kalır. `pg_dump` işlemsel
olarak tutarlı bir anlık görüntü üretir.

MinIO nesneleri bir kez yazılır ve değişmez; orada artımlı `mc mirror` hem tutarlı
hem de hızlıdır.

## Şifreleme

Dump'lar `gpg --symmetric --cipher-algo AES256` ile şifrelenir. Parola
`/opt/klinik/backup.passphrase` dosyasındadır (0600, yalnız root), ilk çalıştırmada
otomatik üretilir.

> 🔑 **Bu anahtar off-site yedeğe DAHİL DEĞİLDİR — bilinçli olarak.**
> Anahtar şifreli veriyle aynı yere gitseydi şifrelemenin anlamı kalmazdı.
>
> **Sonuç:** Sunucu tamamen kaybolursa, off-site yedekler bu anahtar olmadan
> **açılamaz.** Anahtarın bir kopyası mutlaka sunucu dışında bir parola
> yöneticisinde saklanmalıdır.

## Geri Yükleme Testi (Şartname §3.3)

Geri yüklenebildiği kanıtlanmamış bir yedek, yedek değildir. Haftalık test:

1. En güncel şifreli dump'ı alır
2. Çözer ve açar (başarısızsa: dump bozuk)
3. **Ağı olmayan, kalıcı diski olmayan** tek kullanımlık bir PostgreSQL konteynerine
   geri yükler — çalışan hiçbir şeye değemez
4. Veritabanının sorgulanabilir ve yazılabilir olduğunu doğrular
5. Yedek 2 günden bayatsa, geri yükleme başarılı olsa bile **arıza** sayar
6. Sonucu ntfy ile bildirir (başarısızlıkta `kritik` kanalı)

Testin kendisi de doğrulandı: kasten bozulmuş bir dump ile çalıştırıldığında
hatayı yakalıyor, sağlam dump ile geçiyor.

## Elle Çalıştırma

```bash
/opt/klinik/backup.sh          # yedek al
/opt/klinik/restore-test.sh    # geri yüklenebilirliği doğrula
```

## Gerçek Bir Geri Yükleme

```bash
# 1. Dump'ı çöz
gpg --batch --decrypt --passphrase-file /opt/klinik/backup.passphrase \
    /opt/backups/klinik/production/pg-<ts>.dump.zst.gpg | zstd -d > /tmp/restore.dump

# 2. Uygulamayı durdur (veri yazarken geri yükleme yapılmaz)
cd /opt/klinik/production/infra/compose
docker compose -f docker-compose.base.yml -f docker-compose.production.yml stop api worker

# 3. Geri yükle
docker exec -i klinik-prod-postgres-1 pg_restore -U klinik -d klinik --clean --if-exists \
    < /tmp/restore.dump

# 4. Uygulamayı başlat ve doğrula
docker compose -f docker-compose.base.yml -f docker-compose.production.yml start api worker
curl -s http://127.0.0.1:8120/health/ready

# 5. Temizle
shred -u /tmp/restore.dump
```

## Saklama

| Konum | Süre |
|---|---|
| Yerel (`/opt/backups/klinik`) | 7 gün |
| Off-site (backrest/restic) | backrest planının saklama politikası |
| Loki logları | 30 gün |
| GlitchTip olayları | 30 gün |

Şartname §13, denetim günlüğü için en az 2 yıl saklama istiyor; bu, Faz 1'de
`audit_logs` tablosu geldiğinde ayrıca ele alınacaktır.
