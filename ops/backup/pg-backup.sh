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

# --- Salinan off-site ke Google Drive (opsional, via rclone) ------------------
# Dipilih PO 2026-07-12: TANPA enkripsi. Trade-off yang disadari — restore jadi sederhana
# (langsung pg_restore), tapi folder Drive ini BERISI DATA PELANGGAN mentah (percakapan,
# kontak). JANGAN pernah di-share, dan jangan taruh di Drive bersama tim.
#
# Kenapa rclone (bukan diunggah lewat perantara): cron harus bisa mengunggah SENDIRI tiap
# malam. Backup yang butuh manusia (atau agent) untuk menyalinnya bukan backup otomatis —
# ia akan berhenti diam-diam pada hari pertama tak ada yang menjalankannya.
if [ -n "${BACKUP_GDRIVE_REMOTE:-}" ]; then
  DEST="${BACKUP_GDRIVE_REMOTE}:${BACKUP_GDRIVE_DIR:-glm2-backups}"
  if rclone copy "$FILE" "$DEST" --config "${RCLONE_CONFIG:-/root/.config/rclone/rclone.conf}" 2>&1; then
    echo "[backup] Google Drive: $(basename "$FILE") -> $DEST OK"
  else
    # Gagal unggah TIDAK boleh menggagalkan seluruh backup: dump lokal sudah aman & valid.
    # Tapi harus TERLIHAT — off-site yang diam-diam mati = backup yang tak pernah keluar VPS.
    echo "[backup] PERINGATAN: unggah ke Google Drive GAGAL (dump lokal tetap aman)" >&2
  fi

  # Retensi di Drive — jangan biarkan kuota Drive PO habis diam-diam.
  rclone delete "$DEST" --min-age "${BACKUP_GDRIVE_KEEP_DAYS:-30}d" \
    --config "${RCLONE_CONFIG:-/root/.config/rclone/rclone.conf}" 2>/dev/null || true
fi

# Retensi lokal.
find "$DIR" -name 'glm2-*.dump' -type f -mtime "+${KEEP_DAYS}" -delete
echo "[backup] selesai. Dump tersimpan: $(find "$DIR" -name 'glm2-*.dump' | wc -l)"
