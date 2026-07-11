#!/usr/bin/env bash
# T-073: backup Postgres harian. Dipanggil cron di VPS.
#
# Lapis 1 (WAJIB) — dump lokal terkompresi + retensi. Melindungi dari kesalahan aplikasi,
#   migrasi rusak, atau penghapusan tak sengaja.
# Lapis 2 (OPSIONAL) — salinan OFF-SITE ke cPanel via FTPS. Melindungi dari kehilangan VPS
#   itu sendiri: backup yang HANYA ada di mesin yang sama TIDAK melindungi dari kehilangan
#   mesin itu.
#
# KEAMANAN — akun FTP kita di-chroot ke DOCUMENT ROOT, jadi apa pun yang diunggah BISA
#   DIAKSES PUBLIK lewat https://<domain>/<path>. Dump mentah di sana = membocorkan SELURUH
#   data pelanggan (percakapan, kontak, konfigurasi). Karena itu salinan off-site WAJIB
#   terenkripsi (AES-256) dan ditaruh di folder ber-.htaccess deny. Enkripsi = pertahanan
#   utama; .htaccess hanya lapis kedua (server bisa salah konfigurasi, enkripsi tidak).
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER wajib}"
: "${POSTGRES_DB:?POSTGRES_DB wajib}"
CONTAINER="${PG_CONTAINER:-glm2-postgres}"
DIR="${BACKUP_DIR:-/opt/containers/glm2/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/glm2-${STAMP}.dump"

echo "[backup] dump -> $FILE"
# Format custom (-Fc): terkompresi & bisa di-restore selektif via pg_restore.
docker exec "$CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$FILE"

# Dump kosong = kegagalan diam-diam yang PALING berbahaya: cron "sukses" tiap hari, lalu
# saat benar-benar dibutuhkan ternyata semua file 0 byte.
SIZE=$(stat -c%s "$FILE")
if [ "$SIZE" -lt 1024 ]; then
  echo "[backup] GAGAL: dump hanya ${SIZE} byte - dianggap rusak" >&2
  rm -f "$FILE"
  exit 1
fi
echo "[backup] ukuran: $(du -h "$FILE" | cut -f1)"

# Verifikasi dump BISA DIBACA, bukan sekadar ada. Backup yang tak bisa di-restore = tak ada.
if ! docker exec -i "$CONTAINER" pg_restore --list < "$FILE" > /dev/null 2>&1; then
  echo "[backup] GAGAL: dump tidak bisa dibaca pg_restore" >&2
  exit 1
fi
echo "[backup] verifikasi: dump terbaca pg_restore OK"

# --- Salinan off-site terenkripsi (opsional) ---------------------------------
if [ -n "${BACKUP_OFFSITE_PASSPHRASE:-}" ] && [ -n "${CPANEL_FTP_HOST:-}" ]; then
  ENC="${FILE}.enc"
  # AES-256 + PBKDF2. Tanpa passphrase, file yang tersimpan di hosting publik tak berguna.
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "$FILE" -out "$ENC" -pass env:BACKUP_OFFSITE_PASSPHRASE
  echo "[backup] terenkripsi -> $(basename "$ENC")"

  REMOTE_DIR="${BACKUP_REMOTE_DIR:-_backups}"
  curl --ssl-reqd --fail --silent --show-error \
    --user "${CPANEL_FTP_USER}:${CPANEL_FTP_PASSWORD}" \
    --ftp-create-dirs \
    -T "$ENC" "ftp://${CPANEL_FTP_HOST}/${REMOTE_DIR}/$(basename "$ENC")"
  echo "[backup] off-site: ${REMOTE_DIR}/$(basename "$ENC") OK"
  rm -f "$ENC"
fi

# Retensi lokal.
find "$DIR" -name 'glm2-*.dump' -type f -mtime "+${KEEP_DAYS}" -delete
echo "[backup] selesai. Dump tersimpan: $(find "$DIR" -name 'glm2-*.dump' | wc -l)"
