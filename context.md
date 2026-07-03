# context.md — Resume Sesi

> **Baca paling awal** (bersama `decision.md` & `AGENTS.md`) agar tidak kehilangan
> konteks saat memulai sesi baru. Perbarui di akhir tiap sesi kerja berarti.

- Sesi: T-020 Prisma schema inti · Tanggal: 2026-07-03
- Cabang aktif: `feature/t-020-prisma-schema` (PR ke `main`)
- Status umum: **PR #1 (fondasi) sudah merged ke `main`; T-020 (schema+migrasi+seed)
  selesai di branch, gerbang lokal hijau, menunggu CI (service Postgres menjalankan
  migrate deploy + db seed).**

## Di mana kita sekarang
Fase 0 — Sprint 0.1. EPIC-01 (T-010/T-011/T-013) **selesai & merged** ke `main`
(commit `50ebd50`, PR #1). Branch protection `main` aktif; repo public. T-020
(EPIC-02) sedang dikerjakan: Prisma schema 9 model + migrasi awal + seed, schema &
client hidup di `packages/adapters/prisma` (SOLID-D — vendor SDK hanya di adapters).

## Yang baru saja terjadi
- **PR #1 di-merge** ke `main` (konflik versi pnpm di CI lama sudah diselesaikan sebelumnya).
- **T-020** diimplementasi di `feature/t-020-prisma-schema`:
  - `packages/adapters/prisma/schema.prisma` — 9 model (Tenant+`brandId`, User,
    Conversation, Message, Website, Revision, AgentJob, LlmUsage, AuditLog) + enum;
    semua tabel domain bawa `tenantId` + timestamps (NFR-09, ADR-5).
  - `packages/adapters/prisma/migrations/00000000000000_init/migration.sql` di-generate
    via `prisma migrate diff` (tanpa DB), tanpa-BOM; + `migration_lock.toml`.
  - `packages/adapters/prisma/seed.ts` — seed 1 tenant uji (`warung-demo`) + 1 user OWNER.
  - `packages/adapters/package.json`: deps `@prisma/client`/`prisma`/`tsx` + script
    `db:generate|migrate|seed|validate` + `prisma.seed`.
  - `pnpm-workspace.yaml`: `allowBuilds` Prisma di-set `true` (pnpm 11 di mesin ini
    memakai `allowBuilds` map, bukan hanya `onlyBuiltDependencies`).
  - `.github/workflows/ci.yml`: tambah service container Postgres 16 + langkah
    `prisma generate` + `migrate deploy` + `db seed` (memenuhi kriteria terima T-020).
  - `decision.md` + `context.md` diperbarui.
- `pnpm exec turbo run lint build test` → **21/21 task sukses, exit 0** lokal.

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
1. Push `feature/t-020-prisma-schema` → buka PR → tunggu CI hijau (migrate+seed di
   Postgres service) → merge. (`gh` CLI belum terpasang; buka PR via web atau pasang gh.)
2. **Restart opencode** → TestSprite MCP ter-load; uji 1 endpoint (T-014).
3. Mulai **T-021** (repository layer + tenant guard + uji kebocoran lintas tenant)
   di branch `feature/t-021-tenant-guard`.

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
