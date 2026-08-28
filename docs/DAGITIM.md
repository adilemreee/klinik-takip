# Dağıtım

> Otomatik dağıtım T0.5'te (GitHub Actions) gelecek. Bu doküman şu anki **elle**
> prosedürü ve her adımda neyin doğrulanacağını tanımlar.

## Sunucudaki Yerleşim

```
/opt/klinik/staging/
├── backend/                 rsync ile senkronlanır (node_modules, dist, .env hariç)
└── infra/
    ├── compose/
    │   ├── docker-compose.base.yml
    │   ├── docker-compose.staging.yml
    │   ├── .env             chmod 600, SUNUCUDA üretilir, asla repoda değil
    │   └── init/
    ├── nginx/
    └── cloudflared/
/opt/klinik/production/      aynı yapı
```

## İlk Kurulum (ortam başına bir kez)

`.env` **sunucuda** üretilir; sırlar ağ üzerinden düz metin geçmez ve hiçbir zaman
yerel makinede durmaz:

```bash
cd /opt/klinik/staging/infra/compose
PGPW=$(openssl rand -hex 24); RDPW=$(openssl rand -hex 24)
S3SEC=$(openssl rand -hex 24)
JWTA=$(openssl rand -base64 48 | tr -d '\n'); JWTR=$(openssl rand -base64 48 | tr -d '\n')
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PGPW|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://klinik:$PGPW@postgres:5432/klinik?schema=public|" \
    -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$RDPW|" \
    -e "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$S3SEC|" \
    -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$JWTA|" \
    -e "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$JWTR|" \
    env.staging.example > .env
chmod 600 .env
```

DB parolası **hex** üretilir (base64 değil): `DATABASE_URL` içine gömüldüğü için
URL-güvenli olmalıdır.

## Dağıtım

```bash
# 1. Yerelde: kalite kapıları
cd backend && npm run lint && npm run typecheck && npm test

# 2. Kod senkronu
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .env --exclude coverage \
  backend infra <sunucu>:/opt/klinik/staging/

# 3. Sunucuda: derle ve başlat
cd /opt/klinik/staging/infra/compose
docker compose -f docker-compose.base.yml -f docker-compose.staging.yml up -d --build
```

## Doğrulama — Her Dağıtımdan Sonra Zorunlu

```bash
# a) Kendi servisimiz sağlıklı mı?
docker inspect -f '{{.State.Health.Status}}' klinik-staging-api-1     # healthy
curl -s http://127.0.0.1:8123/health/ready                            # status: ok

# b) Mevcut servisler zarar gördü mü? (baseline: 21)
docker ps --format '{{.Names}}' | grep -vc '^klinik-'                 # 21
systemctl is-active nginx fail2ban cloudflared                        # hepsi active
ip link show wg0                                                      # UP
iptables -S INPUT | wc -l                                             # 17

# c) Güvenlik duruşu
ss -tuln | grep -E ':812[0-9] '        # yalnız 127.0.0.1 olmalı, 0.0.0.0 ASLA
docker ps --filter name=klinik-staging-postgres --format '{{.Ports}}'  # host eşlemesi YOK
```

(b) şıkkındaki sayılardan biri değiştiyse **dağıtım geri alınır ve sebep bulunur.**

## Geri Alma

```bash
cd /opt/klinik/staging/infra/compose
docker compose -f docker-compose.base.yml -f docker-compose.staging.yml down   # volume'lara dokunmaz
```

Volume'ları da silmek (`-v`) **veri kaybıdır** — production'da asla.
