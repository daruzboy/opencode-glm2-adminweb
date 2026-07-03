# context.md — Resume Sesi

> **Baca paling awal** (bersama `decision.md` & `AGENTS.md`) agar tidak kehilangan
> konteks saat memulai sesi baru. Perbarui di akhir tiap sesi kerja berarti.

- Sesi: setup awal Fase 0 · Tanggal: 2026-07-03
- Cabang aktif: `feature/initial-setup` (PR #1 ke `main`)
- Status umum: **fondasi monorepo + loop engineering/QA sudah dibuat & di-commit;
  PR terbuka; CI sedang diperbaiki.**

## Di mana kita sekarang
Fase 0 — Sprint 0.1. Fondasi teknis (T-010) selesai: monorepo pnpm+Turborepo,
clean architecture skeleton, gerbang `pnpm turbo lint build test` hijau lokal
(21/21), CI & QA-gate workflow dibuat. Sekarang fokus mengunci CI hijau di PR,
lalu branch protection, sebelum mulai tugas fitur (T-020/T-021).

## Yang baru saja terjadi
- Membaca BRD/FRD/PRD/SRS + DevSetup (09) + Backlog Fase 0 (07).
- Scaffold T-010 selesai → commit `a30d0e1` (di branch `feature/initial-setup`).
- Dibuat: `AGENTS.md`, `docs/qa/README.md`, `docs/qa/test-plan-template.md`,
  `.github/workflows/ci.yml` (T-011), `.github/workflows/qa-gate.yml` (T-014/T-080),
  `.env.example`, config root, 7 workspace package.
- `pnpm` 11.9.0 dipasang; build esbuild di-approve (`pnpm approve-builds --all`).
- `TESTSPRITE_API_KEY` diset (secret repo + env user lokal).
- PR #1 dibuat: https://github.com/daruzboy/opencode-glm2-adminweb/pull/1
- CI pertama **gagal** = konflik versi pnpm (action `version:11` vs `packageManager`
  di package.json) → **sudah diperbaiki** (hapus `version` dari action).
- File ini (`decision.md` + `context.md`) dibuat & didaftarkan di `opencode.json`
  `instructions` agar auto-dibaca di awal sesi.

## Langkah segera berikutnya
1. Commit perbaikan CI + `decision.md` + `context.md` + update `opencode.json` ke
   `feature/initial-setup`; push → CI re-run. Pastikan **hijau**.
2. Aktifkan **branch protection** `main`: require status check
   `CI / lint + typecheck + vitest`, strict (up-to-date), wajib via PR.
3. Merge PR #1 (setelah CI hijau).
4. **Restart opencode** → TestSprite MCP ter-load; uji 1 endpoint (T-014).
5. Mulai **T-020** (Prisma schema inti) lalu **T-021** (tenant guard repository).

## Hal yang ditunggu dari PO (jalur kritis, EPIC-00)
- Ajukan verifikasi Meta + WABA (T-001) — lead time terpanjang.
- Kumpulkan: akun Xendit, VPS DC Indonesia, SSH cPanel, API key DeepSeek+GLM (T-002).

## Catatan teknis penting (jangan lupa)
- Jangan push langsung ke `main` → selalu PR dari `feature/*`.
- Konflik pnpm di CI sudah diselesaikan: biarkan `packageManager` (package.json)
  yang menentukan versi; jangan tambah `version` di `pnpm/action-setup`.
- Output build ke `dist/` (di-gitignore); pastikan tak ada artefak `.js`/`.d.ts`
  bocor ke `src/` (pakai `noEmitOnError: true`, sudah diset).
- SOLID-D dijaga ESLint: `core`/`shared` dilarang import adapter/app/vendor.
- Env lokal saat ini: Node 24 (CI 22), pnpm via `npm i -g pnpm`.

## Cara melanjutkan sesi baru
1. Baca `decision.md` → `context.md` → `AGENTS.md` (sudah auto-load via
   `opencode.json`). Rujuk `doc/` untuk detail normatif.
2. Cek `git status`, `git log --oneline -5`, dan status PR #1.
3. Ambil **satu** backlog ID; buat branch `feature/<id>-<ringkas>`; kerjakan sesuai
   AGENTS.md; `pnpm turbo lint build test` hijau; PR ke `main`.
