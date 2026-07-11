# Backup & Restore Postgres (T-073)

> **Backup yang tidak pernah diuji restore bukan backup — ia hanya perasaan aman.**
> Runbook ini sudah dijalankan sungguhan (lihat "Bukti uji" di bawah).

## Kenapa ada

Sebelum ini: **nol backup**. Postgres hidup di bind-mount `/opt/containers/glm2/postgres`
di satu VPS. Kalau VPS hilang atau disk rusak → **semua tenant, situs, percakapan, foto, dan
riwayat biaya hilang permanen**. Tidak ada jalan pulang.

## Dua lapis

| Lapis | Melindungi dari | Wajib? |
|---|---|---|
| **Dump lokal** (`/opt/containers/glm2/backups`, retensi 14 hari) | migrasi rusak, penghapusan tak sengaja, bug aplikasi | ya |
| **Salinan off-site terenkripsi** (cPanel via FTPS) | **kehilangan VPS itu sendiri** | disarankan |

Backup yang **hanya ada di mesin yang sama** tidak melindungi dari kehilangan mesin itu.

## ⚠️ Kenapa off-site WAJIB terenkripsi

Akun FTP kita **di-chroot ke document root** hosting. Artinya **apa pun yang diunggah bisa
diakses publik** lewat `https://<domain>/<path>`. Dump mentah di sana = **membocorkan seluruh
data pelanggan** (percakapan, kontak, konfigurasi).

Karena itu salinan off-site **selalu dienkripsi AES-256 (PBKDF2, 200k iterasi)** sebelum
diunggah, dan ditaruh di folder ber-`.htaccess deny`. **Enkripsi adalah pertahanan utama;**
`.htaccess` hanya lapis kedua — server bisa salah konfigurasi, enkripsi tidak.

> Passphrase (`BACKUP_OFFSITE_PASSPHRASE`) **tidak boleh** disimpan di VPS yang sama dengan
> backup-nya. Kalau VPS hilang bersama passphrase-nya, backup off-site jadi sampah terenkripsi.
> Simpan di password manager PO.

## Pemakaian

```bash
# Backup (cron menjalankan ini tiap hari 02:00 WIB)
BACKUP_DIR=/opt/containers/glm2/backups ops/backup/pg-backup.sh

# Latihan restore — ke DB UJI, produksi TIDAK disentuh
ops/backup/pg-restore.sh /opt/containers/glm2/backups/glm2-<stamp>.dump

# Bencana nyata — menimpa PRODUKSI (butuh konfirmasi eksplisit)
RESTORE_TARGET=production CONFIRM=SAYA-YAKIN ops/backup/pg-restore.sh <file.dump>
```

## Yang dicegah script (kegagalan diam-diam)

- **Dump < 1 KB → gagal keras.** Tanpa cek ini, cron bisa "sukses" tiap hari sambil menulis
  file 0 byte, dan baru ketahuan saat kita benar-benar membutuhkannya.
- **Dump diverifikasi terbaca `pg_restore --list`**, bukan sekadar "file ada".
- **Restore default ke DB uji**, bukan produksi → latihan bisa dilakukan kapan saja tanpa risiko.
- **Menimpa produksi butuh `CONFIRM=SAYA-YAKIN`** — tidak bisa terjadi karena salah ketik.
- **Restore memverifikasi ISI** (jumlah baris per tabel), bukan cuma "perintah sukses".

## Bukti uji (2026-07-11)

Backup + restore dijalankan sungguhan terhadap data produksi:

```
[backup] ukuran: 52K
[backup] verifikasi: dump terbaca pg_restore OK

[restore] target: DB UJI 'digimaestro_restore_test' (produksi TIDAK disentuh)
  Tenant | 2      Website | 2       Revision | 10
  Message | 104   MediaAsset | 1    LlmUsage | 57
```

Angka-angka itu **identik dengan produksi** → dump utuh, restore terbukti bekerja.

## Env

| Variabel | Guna |
|---|---|
| `BACKUP_DIR` | folder dump lokal (default `/opt/containers/glm2/backups`) |
| `BACKUP_KEEP_DAYS` | retensi lokal (default 14) |
| `BACKUP_OFFSITE_PASSPHRASE` | **kosong → off-site dilewati.** Simpan di password manager, BUKAN di VPS |
| `BACKUP_REMOTE_DIR` | folder di hosting (default `_backups`) |
| `CPANEL_FTP_*` | dipakai ulang dari konfigurasi deploy |

## Yang belum

- **Restore terjadwal otomatis** (uji berkala tanpa manusia) — sekarang masih manual.
- **Backup media** (`media/<tenantId>/` di hosting) — foto pelanggan belum ikut di-backup;
  ia hidup di hosting cPanel, terpisah dari VPS, jadi risikonya berbeda.
