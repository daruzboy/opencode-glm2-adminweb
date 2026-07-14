# VENDORED — jangan edit langsung

Paket ini adalah **salinan verbatim** dari `editor-web/packages/block-engine/src`
(repo `/opt/dig/projects/editor-web`, milik PO). Sumber kebenaran pengembangan engine
tetap di editor-web; glm2 hanya KONSUMEN.

- **Sumber:** editor-web commit `4eabc2552bd7bf5e9f2253bdeb3c08aaa50b950d`
- **Disinkron:** 2026-07-14
- **Cara update:** jalankan `ops/sync-block-engine.sh` (menyalin src, menstempel SHA baru
  di file ini, lalu build + test). JANGAN menyunting `src/` di sini — perubahan akan
  tertimpa sync berikutnya; perbaiki di editor-web lalu sync.

Kenapa vendored (bukan `file:../editor-web` atau pindah kepemilikan):
- CI GitHub glm2 tidak bisa melihat repo editor-web (privat, terpisah) dan konteks build
  Docker berhenti di root repo → dependensi lintas-repo mustahil di-build.
- Memindah engine ke glm2 membalik kepemilikan dan mengganggu alur kerja editor PO.
- Engine jarang berubah setelah stabil; sync = satu perintah, ber-gerbang test.

Test vendored (`src/engine.test.ts`, node:test) ikut disalin dan dijalankan di CI glm2
(`pnpm --filter @digimaestro/engine-mobirise test`) — drift terdeteksi saat sync, bukan
di produksi.
