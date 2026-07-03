# context.md — Resume Sesi

> **Baca paling awal** (bersama `decision.md` & `AGENTS.md`) agar tidak kehilangan
> konteks saat memulai sesi baru. Perbarui di akhir tiap sesi kerja berarti.

- Sesi: T-020 wrap-up (merge + bookkeeping) · Tanggal: 2026-07-04
- Cabang aktif: `main` (kembali ke trunk; branch feature terhapus post-merge)
- Status umum: **PR #2 (T-020 Prisma schema + migrasi + seed) sudah merged ke `main`
  (squash `883ab29`, 2026-07-03). CI hijau: `migrate deploy` + `db seed` jalan di
  service Postgres 16. Cabang feature terhapus. Berikutnya: T-021 (repository +
  tenant guard).**

## Di mana kita sekarang
Fase 0 — Sprint 0.1. EPIC-01 (T-010/T-011/T-013) & **EPIC-02 T-020 selesai &
merged** ke `main`. Branch protection `main` aktif; repo public. Schema Prisma 9
model + migrasi awal + seed tenant uji (`warung-demo`) hidup di
`packages/adapters/prisma` (SOLID-D — vendor SDK hanya di adapters), terbukti
jalan di CI. T-021 (repository layer + tenant guard) belum dimulai.

## Yang baru saja terjadi
- **PR #2 (T-020) di-merge** ke `main` (squash commit `883ab29`, 2026-07-03T17:34Z),
  cabang `feature/t-020-prisma-schema` dihapus. CI PR hijau dalam ~1 menit:
  `lint + typecheck + vitest` SUCCESS, lalu langkah "DB migration & seed (T-020
  acceptance)" → `prisma generate` (Client v6.19.3) → `migrate deploy`
  (`Applying migration 00000000000000_init` → `All migrations have been
  successfully applied`) → `db seed` (`Seeded tenant warung-demo ... OWNER Bu Demo`).
  Semua kriteria terima T-020 terpenuhi.
- gh CLI **kini terpasang** (v2.96.0) & ter-autentikasi sebagai `daruzboy` → blokir
  "buka PR via web" teratasi.
- **Catatan teknis**: ada ref lokal rusak `refs/heads/feature/desktop.ini`
  (Windows `desktop.ini` tertangkap sebagai nama branch) yang sempat menggagalkan
  langkah `gh pr merge --delete-branch`; sudah dibersihkan (file ref dihapus).
  Perhatikan agar `desktop.ini` tidak ikut sebagai ref saat branch baru dibuat.
- T-020 implementasi (sebagaimana sudah di-merge): `packages/adapters/prisma/`
  berisi `schema.prisma` (9 model + enum, `tenantId`+timestamps), migrasi
  `00000000000000_init` (tanpa-BOM, via `migrate diff`), `seed.ts` (tenant uji),
  + deps & script `db:*` di `packages/adapters/package.json`, `allowBuilds` Prisma
  di `pnpm-workspace.yaml`, service Postgres 16 di `.github/workflows/ci.yml`.

## Keputusan desain T-020 (catatan)
- **Penempatan Prisma**: schema + client + migrasi + seed di `packages/adapters/prisma`.
  `@prisma/client` di-block import di `core`/`shared` oleh ESLint (boundary rule).
  Repository impl (T-021) nanti juga di adapters, implementasi Port di `shared/ports`.
- **`Message.tenantId` terdenormalisasi**: SRS §8 Message hanya punya `conversationId`;
  ditambah `tenantId` langsung agar guard anti-kebocoran lintas-tenant (NFR-09, diuji
  T-021) bisa ditegakkan per-baris.
- **ID**: `cuid()`. **brandId**: `String @default("digimaestro")` (bantuanpajak.id
  menumpang di masa depan tanpa migrasi enum).

## Langkah segera berikutnya
1. **Mulai T-021** (repository layer + tenant guard + uji kebocoran lintas tenant,
   NFR-09) di branch `feature/t-021-tenant-guard`. Implementasi repository Prisma di
   `packages/adapters` mengikuti Port di `packages/shared/ports`; setiap query wajib
   scoped `tenantId`. Uji: happy path + upaya akses data tenant lain ditolak.
2. (Paralel, non-kode) **Restart opencode** → TestSprite MCP ter-load; uji 1 endpoint (T-014).
3. (Jalur kritis EPIC-00) Dorong PO: verifikasi Meta+WABA (T-001), kumpulkan kredensial (T-002).

## Hal yang ditunggu dari PO (jalur kritis, EPIC-00)
- Ajukan verifikasi Meta + WABA (T-001) — lead time terpanjang.
- Kumpulkan: akun Xendit, VPS DC Indonesia, SSH cPanel, API key DeepSeek+GLM (T-002).

## Catatan teknis penting (jangan lupa)
- Jangan push langsung ke `main` → selalu PR dari `feature/*`.
- Konflik pnpm di CI sudah selesai: biarkan `packageManager` (package.json) yang
  menentukan versi; jangan tambah `version` di `pnpm/action-setup`.
- **pnpm postinstall vendor (Prisma/esbuild)** diizinkan lewat `allowBuilds` map di
  `pnpm-workspace.yaml` (mesin ini). CI pakai `--frozen-lockfile`; build script vendor
  jalan otomatis via postinstall.
- Output build ke `dist/` (di-gitignore); `tsc` adapters `include: ["src"]` sehingga
  folder `prisma/` tidak ikut dikompilasi (seed = script terpisah via `tsx`).
- SOLID-D dijaga ESLint: `core`/`shared` dilarang import adapter/app/vendor
  (termasuk `@prisma/client`).
- Env lokal: Node 24 (CI 22), pnpm 11.9.0 via `npm i -g pnpm`. Docker Desktop ada CLI-
  nya tapi daemon **tidak berjalan** → verifikasi DB lokal belum dilakukan; andalkan
  service Postgres di CI.

## Cara melanjutkan sesi baru
1. Baca `decision.md` → `context.md` → `AGENTS.md` (sudah auto-load via
   `opencode.json`). Rujuk `doc/` untuk detail normatif.
2. Cek `git status`, `git log --oneline -5`, dan status PR aktif.
3. Ambil **satu** backlog ID; buat branch `feature/<id>-<ringkas>`; kerjakan sesuai
   AGENTS.md; `pnpm turbo lint build test` hijau; PR ke `main`.
