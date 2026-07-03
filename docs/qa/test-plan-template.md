# Test Plan Template — TestSprite (per slice/sprint)

> Salin template ini per slice. Diisi bersama PO sebelum TestSprite mengeksekusi.
> Referensi normatif: `doc/PRD.md`, `doc/FRD.md`. Severity: Kritis (blocker) · Mayor · Minor.

## Sprint / Slice

- Sprint: 0.x —
- Backlog ID: T-0xx
- Staging URL:
- Tenant uji (slug + kredensial):
- Tanggal:

## Cakupan (rujuk FR ID)

| # | Skenario | Langkah singkat | Ekspektasi | Jalur kritis? | Severity-min |
| --- | --- | --- | --- | --- | --- |
| 1 | Build website end-to-end | wawancara → preview → approve → publish | situs live ber-HTTPS di subdomain | ya | Kritis |
| 2 | Idempotensi webhook | kirim payload WA duplikat (providerMsgId sama) | tidak ada efek ganda | ya | Kritis |
| 3 | Guard tenant | akses data tenant A sebagai tenant B | ditolak (NFR-09) | ya | Kritis |
| 4 | NEEDS_INFO | brief dengan slot wajib kosong | agent bertanya balik, bukan menebak | ya | Mayor |
| 5 | Approval-first | edit tanpa persetujuan | tidak ada perubahan tayang | ya | Kritis |

## Prasyarat data

- Seed tenant uji: minimal 1 tenant aktif + 1 trial + 1 suspend.
- Media contoh (foto produk) untuk ingest.
- Form kontak situs staging aktif untuk uji lead forwarding.

## Klasifikasi hasil

- [ ] Jalur kritis semua hijau → GERBANG SPRINT LEWAT
- [ ] Ada Kritis gagal → masuk puncak backlog sprint berikutnya, loop kembali

## Catatan / temuan

-
