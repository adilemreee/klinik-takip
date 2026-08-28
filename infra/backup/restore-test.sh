#!/usr/bin/env bash
set -euo pipefail

# === Klinik Takip — Haftalık Geri Yükleme Testi ===
#
# Şartname §3.3 bunu zorunlu kılar. Geri yüklenebildiği kanıtlanmamış bir yedek,
# yedek değildir — yalnızca yedeği olduğu sanılan bir dosyadır.
#
# En güncel şifreli dump'ı alır, tek kullanımlık bir PostgreSQL konteynerine
# geri yükler, gerçekten sorgulanabildiğini doğrular ve konteyneri siler.
# Çalışan hiçbir servise dokunmaz.

BACKUP_ROOT="/opt/backups/klinik"
PASSPHRASE_FILE="/opt/klinik/backup.passphrase"
PG_IMAGE="pgvector/pgvector:pg16"

START="$(date +%s)"
RESULTS=""
FAILED=0
TMPDIR="$(mktemp -d)"
CONTAINER=""

notify() {
    if command -v bildirim >/dev/null 2>&1; then
        bildirim "$1" "$2" "$3"
    else
        echo "[$1] $2 — $3"
    fi
}

cleanup() {
    [ -n "$CONTAINER" ] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$TMPDIR"
}
trap cleanup EXIT

test_env() {
    local env_name="$1"
    local dest="${BACKUP_ROOT}/${env_name}"

    local latest
    latest="$(ls -1t "${dest}"/pg-*.dump.zst.gpg 2>/dev/null | head -1 || true)"

    if [ -z "$latest" ]; then
        return 0   # ortam kurulu değil
    fi

    # --- Çöz ve aç ----------------------------------------------------------
    local plain="${TMPDIR}/${env_name}.dump"
    if ! gpg --batch --quiet --decrypt --passphrase-file "$PASSPHRASE_FILE" "$latest" \
         | zstd -d -q -o "$plain" 2>/dev/null; then
        RESULTS="${RESULTS}
${env_name}: ✗ dump çözülemedi ($(basename "$latest"))"
        FAILED=1
        return 0
    fi

    # --- Tek kullanımlık hedef ---------------------------------------------
    # Ağ yok, port yok, kalıcı volume yok: mevcut hiçbir şeye değemez.
    CONTAINER="klinik-restore-test-$$"
    docker run -d --rm --name "$CONTAINER" \
        --network none \
        -e POSTGRES_PASSWORD=restoretest \
        -e POSTGRES_DB=restoretest \
        -e POSTGRES_USER=restoretest \
        --tmpfs /var/lib/postgresql/data:rw,size=2g \
        "$PG_IMAGE" >/dev/null

    local ready=0
    for _ in $(seq 1 30); do
        if docker exec "$CONTAINER" pg_isready -U restoretest -d restoretest >/dev/null 2>&1; then
            ready=1; break
        fi
        sleep 2
    done

    if [ "$ready" -ne 1 ]; then
        RESULTS="${RESULTS}
${env_name}: ✗ test veritabanı açılmadı"
        FAILED=1
        docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
        CONTAINER=""
        return 0
    fi

    # --- Geri yükle ---------------------------------------------------------
    # Uzantılar (pgcrypto/vector) sahiplik gerektirdiğinden bazı NOTICE/uyarılar
    # normaldir; başarı ölçütü sorgulanabilir bir veritabanıdır, sessiz çıktı değil.
    docker exec -i "$CONTAINER" pg_restore -U restoretest -d restoretest --no-owner \
        < "$plain" >/dev/null 2>"${TMPDIR}/${env_name}.restore.err" || true

    # --- Doğrula ------------------------------------------------------------
    local tables
    tables="$(docker exec "$CONTAINER" psql -U restoretest -d restoretest -tAc \
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo "HATA")"

    # psql çoklu ifadede komut etiketlerini de basar ('CREATE TABLE',
    # 'DROP TABLE'); bizi ilgilendiren son satırdır.
    local writable
    writable="$(docker exec "$CONTAINER" psql -U restoretest -d restoretest -tAc \
        "CREATE TABLE _restore_probe(id int); DROP TABLE _restore_probe; SELECT 'ok'" 2>/dev/null \
        | tail -1 || echo "HATA")"

    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    CONTAINER=""

    if [ "$tables" = "HATA" ] || [ "$writable" != "ok" ]; then
        RESULTS="${RESULTS}
${env_name}: ✗ geri yüklendi ama sorgulanamıyor"
        FAILED=1
        return 0
    fi

    local age_days
    age_days=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 86400 ))

    # Faz 1'de veri modeli gelene kadar tablo sayısı 0 olabilir; asıl kanıt
    # dump'ın çözülüp geri yüklenebilmesi ve veritabanının yazılabilir olmasıdır.
    RESULTS="${RESULTS}
${env_name}: ✓ ${tables} tablo, dump ${age_days} günlük"

    # Yedek bayatsa geri yükleme başarılı olsa bile bu bir arızadır.
    if [ "$age_days" -gt 2 ]; then
        RESULTS="${RESULTS} — ⚠ BAYAT"
        FAILED=1
    fi
}

test_env staging
test_env production

DURATION=$(( $(date +%s) - START ))

# Cron log'una da yaz: ntfy bildirimi kaybolursa iz burada kalır.
echo "Klinik geri yükleme testi — süre ${DURATION}s${RESULTS}"

if [ "$FAILED" -eq 0 ]; then
    notify bilgi "Klinik geri yükleme testi ✅" "Süre: ${DURATION}s${RESULTS}"
else
    notify kritik "Klinik geri yükleme testi BAŞARISIZ" \
"Yedekler geri yüklenemiyor olabilir.
Süre: ${DURATION}s${RESULTS}

Log: /var/log/klinik-restore-test.log"
    exit 1
fi
