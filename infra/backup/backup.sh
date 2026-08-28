#!/usr/bin/env bash
set -euo pipefail

# === Klinik Takip — Otomatik Yedekleme ===
# Yedekler : PostgreSQL (şifreli dump) + MinIO nesneleri
# Hedef    : /opt/backups/klinik  → backrest 'kritik' planı bunu zaten
#            Google Drive'a (off-site, farklı sağlayıcı) taşır
# Bildirim : ntfy, 'bildirim' helper'ı üzerinden
#
# Bu script backrest yapılandırmasına DOKUNMAZ. Yalnızca zaten yedeklenen bir
# dizine yazar, böylece mevcut kurulumda değişiklik riski yoktur.

BACKUP_ROOT="/opt/backups/klinik"
KLINIK_ROOT="/opt/klinik"
PASSPHRASE_FILE="/opt/klinik/backup.passphrase"
RETENTION_DAYS=7   # yerelde; off-site geçmişi restic tutar
PG_IMAGE="pgvector/pgvector:pg16"   # dump doğrulaması ve geri yükleme testi için

TS="$(date +%Y-%m-%d_%H%M)"
START="$(date +%s)"
SUMMARY=""

notify() {
    # bildirim <kanal> "<baslik>" "<mesaj>"
    if command -v bildirim >/dev/null 2>&1; then
        bildirim "$1" "$2" "$3"
    else
        echo "[$1] $2 — $3"
    fi
}

on_exit() {
    local code=$?
    local duration=$(( $(date +%s) - START ))

    if [ $code -eq 0 ]; then
        local size
        size="$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)"
        notify bilgi "Klinik yedekleme ✅" \
"Zaman: ${TS}
Toplam: ${size:-?}
Süre: ${duration}s
${SUMMARY}"
    else
        notify kritik "Klinik yedekleme BAŞARISIZ" \
"Zaman: ${TS}
Çıkış kodu: ${code}
Süre: ${duration}s

Log: /var/log/klinik-backup.log"
    fi
}
trap on_exit EXIT

# Şifreleme anahtarı yoksa üret. Sağlık verisi dump'ı diskte açık durmaz.
if [ ! -f "$PASSPHRASE_FILE" ]; then
    umask 077
    openssl rand -base64 48 | tr -d '\n' > "$PASSPHRASE_FILE"
    chmod 600 "$PASSPHRASE_FILE"
    notify sunucu "Klinik yedek anahtarı üretildi" \
"$PASSPHRASE_FILE oluşturuldu.
Bu anahtar OLMADAN yedekler geri yüklenemez — güvenli bir yerde ayrıca saklayın."
fi

backup_env() {
    local env_name="$1"
    local project="$2"
    local env_file="${KLINIK_ROOT}/${env_name}/infra/compose/.env"
    local pg_container="${project}-postgres-1"

    # Ortam kurulu değilse sessizce atla (production henüz yok).
    if ! docker inspect "$pg_container" >/dev/null 2>&1; then
        return 0
    fi

    local dest="${BACKUP_ROOT}/${env_name}"
    mkdir -p "$dest/minio"

    # --- PostgreSQL ---------------------------------------------------------
    # pg_dump, çalışan bir veri dizinini dosya olarak kopyalamanın aksine
    # tutarlı bir anlık görüntü verir.
    local pg_user pg_db pg_pass
    pg_user="$(grep -m1 '^POSTGRES_USER=' "$env_file" | cut -d= -f2-)"
    pg_db="$(grep -m1 '^POSTGRES_DB=' "$env_file" | cut -d= -f2-)"
    pg_pass="$(grep -m1 '^POSTGRES_PASSWORD=' "$env_file" | cut -d= -f2-)"

    local dump_file="${dest}/pg-${TS}.dump.zst.gpg"

    docker exec -e PGPASSWORD="$pg_pass" "$pg_container" \
        pg_dump -U "$pg_user" -d "$pg_db" --format=custom --no-owner \
      | zstd -q -3 \
      | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
            --passphrase-file "$PASSPHRASE_FILE" -o "$dump_file"

    chmod 600 "$dump_file"

    # Dump'ı yapısal olarak doğrula: çöz, aç ve pg_restore'a içindekileri
    # listelet. Boyut sezgisinden üstündür — boş bir veritabanının geçerli
    # dump'ı da küçüktür, bozuk bir dump ise büyük olabilir.
    local dump_size
    dump_size="$(stat -c %s "$dump_file")"

    if ! gpg --batch --quiet --decrypt --passphrase-file "$PASSPHRASE_FILE" "$dump_file" \
         | zstd -d -q \
         | docker run --rm -i --network none "$PG_IMAGE" pg_restore --list >/dev/null 2>&1; then
        echo "HATA: ${env_name} dump'ı geçerli bir arşiv değil (${dump_size} bayt)" >&2
        return 1
    fi

    # --- MinIO --------------------------------------------------------------
    # Nesneler bir kez yazılır; artımlı mirror hem hızlı hem tutarlıdır.
    local minio_out
    minio_out="$(docker run --rm --entrypoint sh \
        --network "${project}_internal" \
        --env-file "$env_file" \
        -v "${dest}/minio:/backup" \
        minio/mc:latest -c '
            set -e
            mc alias set src "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
            mc mirror --overwrite --remove --quiet "src/$S3_BUCKET_DOCUMENTS" "/backup/$S3_BUCKET_DOCUMENTS"
            mc mirror --overwrite --remove --quiet "src/$S3_BUCKET_PHOTOS" "/backup/$S3_BUCKET_PHOTOS"
        ' 2>&1)" || { echo "MinIO mirror basarisiz: $minio_out" >&2; return 1; }

    # --- Yerel saklama ------------------------------------------------------
    find "$dest" -maxdepth 1 -name 'pg-*.dump.zst.gpg' -mtime "+${RETENTION_DAYS}" -delete

    SUMMARY="${SUMMARY}
${env_name}: pg $(numfmt --to=iec "$dump_size" 2>/dev/null || echo "${dump_size}B")"
}

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

backup_env staging     klinik-staging
backup_env production  klinik-prod
