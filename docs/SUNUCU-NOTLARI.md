# Sunucu Notları ve Şartnameden Sapmalar

> Sunucu IP'si, SSH anahtarı ve tüm sırlar **bu repoda tutulmaz** (Şartname §8, §10).
> Erişim bilgileri yerelde `~/.ssh/config` ve sunucuda `/opt/klinik/*/.env` içindedir.

## Sunucunun Gerçek Durumu

Hedef sunucu **boş bir VPS değildir.** Ubuntu 24.04, 4 vCPU, 23 GB RAM. Üzerinde bu
projeyle ilgisi olmayan, sahibi için kritik olan çok sayıda servis zaten çalışmaktadır:
uygulamalar, bir reverse proxy, bir VPN ve bir yedekleme sistemi.

**Temel kural: Çalışan hiçbir servis durdurulmaz, portu alınmaz, kuralı ezilmez.**

> Servislerin tam envanteri, gerçek hostname'ler ve baseline sayıları repoya
> **girmez** — bunlar yerel `docs/OPERASYON-LOCAL.md` dosyasındadır (`.gitignore`'da).

## Şartnameden Bilinçli Sapmalar

Şartnamenin §3.3 ve §10'u boş bir sunucu varsayımıyla yazılmıştır. Aşağıdaki maddeler
harfiyen uygulansaydı mevcut servisleri keserdi:

### 1. UFW kurulmaz — iptables korunur
`ufw` kurulu değildir. Firewall, elle yazılmış iptables kurallarıyla yönetilir ve bu
kurallar fail2ban zincirlerini, WireGuard'ı, shadowsocks'u ve docker bridge'lerini içerir.
UFW etkinleştirmek bunları ezerek **VPN ve konteyner erişimini keserdi.**

Zaten ihtiyacımız olan portlar (80/443) açıktır; yeni firewall kuralı gerekmez.

### 2. Caddy kurulmaz — mevcut nginx kullanılır
Host nginx 80 ve 443'ü tutar; Caddy bind edemezdi. Şartname §3.3 "Caddy **veya** Nginx"
dediği için bu bir sapma değil, izin verilen seçenektir. Bizim uygulamamız için
`/etc/nginx/sites-enabled/` altına **ayrı bir server bloğu** eklenecek; mevcut bloklara
dokunulmayacaktır.

### 3. SSH sertleştirmesi ertelendi — GÜVENLİK BORCU
Sunucunun SSH yapılandırması şartname §8'in gerektirdiği sertleştirmeyi karşılamıyor.
Sunucu sahibinin talimatıyla (2026-08-28) şimdilik dokunulmamıştır. Detay yerel
operasyon notlarındadır.

> ⚠️ **Sağlık verisi (özel nitelikli kişisel veri) canlıya çıkmadan önce kapatılmalıdır.**
> Şartname §8 ve KVKK uyumu için Faz 7 (T7.2) öncesinde ele alınacak.

### 4. nginx, şartnamedeki "rate limit + WAF" katmanı değildir
Şartname §4'te nginx/Caddy'ye rate limit ve WAF görevi verilmiştir. Bu sunucuda public
trafik **cloudflared tunnel** ile gelir ve nginx'e hiç uğramaz. Dolayısıyla:

- **WAF ve kenar rate limit:** Cloudflare (tunnel zaten kurulu ve kullanımda)
- **Uygulama seviyesi rate limit:** NestJS `ThrottlerGuard` (T1.2'de eklenecek)
- **nginx:** yalnız VPN'e kapalı dahili uçların (MinIO Console, Grafana, Prometheus) önünde

> ⚠️ **Sertifika pinning notu (Şartname §8):** TLS Cloudflare kenarında sonlandığı için
> mobil istemciler Cloudflare'in sertifikasını pinlemek zorundadır; bu sertifika rotasyona
> girer. Faz 2'de pinning stratejisi (yedek pin + kademeli yenileme) ayrıca kararlaştırılacak.

> ⚠️ **KVKK/GDPR notu:** Sağlık verisi Cloudflare üzerinden akacaktır; Cloudflare bu
> durumda **veri işleyendir** ve bir DPA (veri işleme sözleşmesi) gerekir. Faz 7 (T7.3)
> kapsamında ele alınacak.

### 5. Docker ve fail2ban kurulmaz — mevcut
Docker 29.1.3, Compose 2.40, fail2ban aktif. Kurulum adımları gereksizdir.

## Bu Projeye Ayrılan İzole Alan

| Kaynak | Tahsis | Gerekçe |
|---|---|---|
| Dizin | `/opt/klinik/staging`, `/opt/klinik/production` | Şartname §10, ortam ayrımı |
| Port bloğu | **8120–8129** | 8080–8115 dolu; tek tek boş doğrulandı |
| Docker subnet | **172.24.0.0/16** | 172.17–172.23 kullanımda |

| Public giriş | cloudflared tunnel (mevcut) | nginx public trafik görmez |

Detaylı port dağılımı için bkz. [PORTS.md](PORTS.md).

## Değişiklik Öncesi/Sonrası Doğrulama

Sunucuda herhangi bir işlem yaptıktan sonra bu kontrol **her seferinde** çalıştırılır ve
çıktı işlem öncesiyle aynı olmalıdır:

```bash
# Beklenen değerler docs/OPERASYON-LOCAL.md içindeki baseline tablosundadır.
docker ps --format '{{.Names}}' | grep -vc '^klinik-'   # baseline ile aynı olmalı
systemctl is-active nginx fail2ban cloudflared          # hepsi active
iptables -S INPUT | wc -l                               # baseline ile aynı olmalı
```
