#!/usr/bin/env bash
# Wrapper cron T-073: muat env deploy, jalankan backup, catat ke log.
set -euo pipefail

# Muat .env SAMA seperti docker env_file: literal KEY=VALUE, TANPA interpretasi shell.
# `. .env` (sebelumnya) menjalankan nilai lewat parser bash → nilai yang mengandung
# $ ` \ " RUSAK. CPANEL_FTP_PASSWORD memuat karakter demikian → login FTPS off-site
# gagal `530 Access denied` (2026-07-17), padahal deploy publish (docker env_file, literal)
# jalan normal. Loader di bawah memberi nilai literal — cocok dengan yang dipakai kontainer.
ENV_FILE=/opt/containers/glm2/.env
while IFS= read -r _ln || [ -n "$_ln" ]; do
  case "$_ln" in ''|'#'*) continue ;; esac
  _key=${_ln%%=*}
  _val=${_ln#*=}
  export "$_key=$_val"
done < "$ENV_FILE"

export BACKUP_DIR=/opt/containers/glm2/backups
exec /opt/containers/glm2/pg-backup.sh
