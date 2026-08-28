# Port ve Ağ Tahsisi

Sunucuda 8080–8115 aralığı mevcut servislerle doludur. Bu projeye **8120–8129** bloğu
tahsis edilmiştir (boş olduğu tek tek doğrulandı).

## Temel Kurallar

1. **Her port `127.0.0.1`'e bind edilir.** Hiçbir konteyner doğrudan internete açılmaz.
   Dışarıya yalnız host nginx üzerinden, TLS ile çıkılır. (Sunucudaki mevcut servislerin
   izlediği desen budur; aynısını uyguluyoruz.)
2. **PostgreSQL ve Redis host'a hiç bind edilmez.** Yalnızca docker ağı içinden erişilir.
   Sağlık verisi tutan bir DB'nin host portu açılmaz.
3. Blok dışına taşmak gerekirse önce `ss -tuln` ile boşluk doğrulanır.

## Dağılım

| Port | Ortam | Servis | Not |
|---|---|---|---|
| 8120 | production | API (NestJS) | nginx → `api.<domain>` |
| 8121 | production | MinIO S3 API | imzalı URL üretimi |
| 8122 | production | MinIO Console | yalnız VPN üzerinden açılacak |
| 8123 | staging | API (NestJS) | |
| 8124 | staging | MinIO S3 API | |
| 8125 | staging | MinIO Console | |
| 8126 | ortak | Grafana | **varsayılan 3000 dolu** (host'ta node) |
| 8127 | ortak | Prometheus | **varsayılan 9090 dolu** (bazel-remote) |
| 8128 | ortak | Loki | |
| 8129 | ortak | GlitchTip (hata izleme UI) | Sentry protokolü, self-hosted |

## Dışarıya Açılış

> Gerçek hostname'ler ve VPN adresi repoda tutulmaz; yerel `docs/OPERASYON-LOCAL.md`
> dosyasındadır.

Bu sunucuda public erişim **host nginx ile değil, mevcut cloudflared tunnel ile** sağlanır
(TLS Cloudflare kenarında sonlanır). Mobil istemcilerin gördüğü adresler:

| Hostname | Hedef |
|---|---|
| `<production-hostname>` | `localhost:8120` (production API) |
| `<staging-hostname>` | `localhost:8123` (staging API) |

nginx bizim için yalnız **VPN'e kapalı dahili uçlar** için kullanılır: MinIO Console,
Grafana, Prometheus. Bunlar VPN arayüzü üzerinden dinler ve `deny all` ile
korunur — sunucudaki mevcut servislerin izlediği desenin aynısı.

Şablonlar: [`infra/cloudflared/ingress-snippet.yml.example`](../infra/cloudflared/ingress-snippet.yml.example),
[`infra/nginx/klinik-internal.conf.example`](../infra/nginx/klinik-internal.conf.example)

### Host portu almayan servisler

| Servis | Erişim |
|---|---|
| PostgreSQL 16 | yalnız docker ağı (`postgres:5432`) |
| Redis 7 | yalnız docker ağı (`redis:6379`) |
| Worker (BullMQ) | yalnız docker ağı (metrik portu `9464`) |
| API metrik ucu | yalnız docker ağı (`9464`) — **API portunda değil** |
| GlitchTip postgres / redis | yalnız docker ağı |

> Host'ta zaten 6379'da bir redis ve 5432'de konteyner postgres'ler vardır.
> Bizimkiler **ayrı konteynerlerdir**, mevcutlarla paylaşılmaz — sağlık verisi izole kalır.

## Metrik Ucu Neden Ayrı Portta?

API, tünel üzerinden internete açıktır ve tünel **her yolu** iletir. `/metrics`
API portunda sunulsaydı herkese açık olurdu. Bu yüzden metrikler konteyner içinde
**9464**'te ayrı bir dinleyicide sunulur; bu port host'a hiç yayınlanmaz, yalnız
`klinik-observability` docker ağından Prometheus tarafından okunur.

## Docker Ağı

| Ortam | Subnet |
|---|---|
| production | `172.24.0.0/16` |
| staging | `172.25.0.0/16` |
| observability (paylaşılan) | `172.26.0.0/16` |

`klinik-observability` ağı **external**'dır, bir kez elle oluşturulur:

```bash
docker network create --subnet 172.26.0.0/16 klinik-observability
```

172.17–172.23 mevcut stack'ler tarafından kullanılmaktadır. Yeni ağ eklemeden önce:

```bash
docker network ls --format '{{.Name}}' | while read n; do \
  docker network inspect "$n" --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}'; done
```
