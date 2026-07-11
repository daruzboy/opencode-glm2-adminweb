#!/usr/bin/env bash
# T-073: restore Postgres dari dump. Backup yang TIDAK PERNAH DIUJI RESTORE bukan backup —
# ia hanya perasaan aman. Script ini dipakai untuk (a) latihan berkala, (b) bencana nyata.
#
# Default: restore ke DB UJI (bukan produksi) supaya bisa dilatih kapan saja tanpa risiko.
# Menimpa DB produksi HARUS eksplisit: RESTORE_TARGET=production CONFIRM=SAYA-YAKIN
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER wajib}"
: "${POSTGRES_DB:?POSTGRES_DB wajib}"
CONTAINER="${PG_CONTAINER:-glm2-postgres}"
DUMP="${1:?pemakaian: pg-restore.sh <file.dump> [--check]}"
TARGET="${RESTORE_TARGET:-test}"

if [ ! -f "$DUMP" ]; then
  echo "[restore] file tidak ada: $DUMP" >&2
  exit 1
fi

# Dump terenkripsi (off-site) → dekripsi dulu.
if [[ "$DUMP" == *.enc ]]; then
  : "${BACKUP_OFFSITE_PASSPHRASE:?dump terenkripsi - BACKUP_OFFSITE_PASSPHRASE wajib}"
  PLAIN="${DUMP%.enc}"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$DUMP" -out "$PLAIN" -pass env:BACKUP_OFFSITE_PASSPHRASE
  echo "[restore] didekripsi -> $PLAIN"
  DUMP="$PLAIN"
fi

if [ "$TARGET" = "production" ]; then
  # Menimpa produksi = tak bisa dibatalkan. Butuh konfirmasi eksplisit, bukan sekadar flag.
  if [ "${CONFIRM:-}" != "SAYA-YAKIN" ]; then
    echo "[restore] MENOLAK menimpa PRODUKSI tanpa CONFIRM=SAYA-YAKIN" >&2
    exit 1
  fi
  DB="$POSTGRES_DB"
  echo "[restore] !!! MENIMPA DATABASE PRODUKSI: $DB"
else
  DB="${POSTGRES_DB}_restore_test"
  echo "[restore] target: DB UJI '$DB' (produksi TIDAK disentuh)"
  docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$DB\";" -c "CREATE DATABASE \"$DB\";" > /dev/null
fi

docker exec -i "$CONTAINER" pg_restore -U "$POSTGRES_USER" -d "$DB" --clean --if-exists \
  --no-owner --no-privileges < "$DUMP" 2>&1 | grep -vE "^pg_restore: (connecting|creating|processing)" || true

# Verifikasi: DB yang hidup harus punya data, bukan sekadar tabel kosong.
echo "[restore] verifikasi isi:"
docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d "$DB" -t -A -F' | ' -c "
  SELECT 'Tenant', COUNT(*) FROM \"Tenant\"
  UNION ALL SELECT 'Website', COUNT(*) FROM \"Website\"
  UNION ALL SELECT 'Revision', COUNT(*) FROM \"Revision\"
  UNION ALL SELECT 'Message', COUNT(*) FROM \"Message\"
  UNION ALL SELECT 'MediaAsset', COUNT(*) FROM \"MediaAsset\"
  UNION ALL SELECT 'LlmUsage', COUNT(*) FROM \"LlmUsage\";" | sed 's/^/  /'

echo "[restore] selesai -> $DB"
[ "$TARGET" != "production" ] && echo "[restore] (DB uji dibiarkan agar bisa diperiksa; hapus manual bila selesai)"
