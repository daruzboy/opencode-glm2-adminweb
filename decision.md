# decision.md — Sumber Kebenaran Proyek (Single Source of Truth)

> **Baca pertama di setiap sesi.** File ini = kebenaran tunggal tentang keputusan,
> status pekerjaan, dan hal tertunda. Jika ada konflik dengan ingatan sesi/chat,
> **yang menang adalah file ini + `doc/` (SRS/FRD/PRD/BRD)**.
>
> _Protocol update:_ setiap keputusan fix / tugas selesai / blocker baru →
> perbarui bagian terkait di sini **dalam commit yang sama**. Simpan ringkas &
> bertanggal.

- Repo: `github.com/daruzboy/opencode-glm2-adminweb`
- Lokal: `C:\Users\daruzboy\Documents\A_PROJECT\02_digimaestro\glm2-adminweb`
- Produk: **digimaestro.id** (platform website builder chatbot & agentic AI untuk UMKM)
- Pemilik/PO: Darusman · Model coding agent: GLM 5.2 · QA: TestSprite
- Terakhir diperbarui: 2026-07-04

---

## 1. Keputusan FIX (Locked — jangan diubah tanpa persetujuan PO)

### 1.1 Stack (SRS §2)
Node 22 LTS · TypeScript 5 (strict) · Fastify v5 · Prisma 6 + PostgreSQL 16 ·
BullMQ + Redis 7 · Zod · Astro 5 + Tailwind 4 (sites-kit) · React 19 + Vite 6
(portal/admin) · pnpm + Turborepo · Vitest + Playwright · MCP TypeScript SDK ·
n8n (self-host) · Umami · Caddy.

### 1.2 Arsitektur (SRS §4 — Clean Architecture + SOLID)
- **Modular monolith**, TS end-to-end (ADR-1). Proses web (api) & worker terpisah,
  berbagi codebase, antrean BullMQ (ADR-2).
- **Lapisan & dependency rule**: `core`/`shared` **TIDAK boleh** import
  `adapters`/`apps`/SDK vendor. Dijaga mesin via ESLint `no-restricted-imports`
  (SOLID-D). Vendor SDK hanya di `packages/adapters`.
- Semua I/O eksternal lewat **Port** di `packages/shared`; implementasi disuntik
  di composition root (`apps/*`). Hasil operasi pakai **`Result<T,E>`**.
- Setiap query DB lewat **repository ber-`tenantId`** (NFR-09).
- Komponen `sites-kit`: **wajib skema Zod** + styling **hanya via design token**.

### 1.3 Topologi runtime (SRS §3, ADR-6/8)
- **VPS** (DC Indonesia): platform inti (api, worker, portal, n8n, Umami, Postgres,
  Redis, Caddy). Juga hosting URL preview draft (ber-token, noindex).
- **Shared hosting cPanel** (terpisah, sudah dimiliki): hanya file statis situs
  klien yang sudah publish. Subdomain `<slug>.digimaestro.id` + addon custom domain
  via cPanel API; TLS AutoSSL; deploy rsync/SSH (fallback FTP).
- **Object storage S3-compatible**: media tenant + build artifact (10 revisi/situs).
- **Situs klien = statis penuh** (Astro, zero-JS default) → diekspor/deploy ke
  shared hosting. Fitur dinamis (form, analytics) memanggil API pusat di VPS.

### 1.4 Prinsip produk
- **Approval-first** (BRU-02): tidak ada publikasi tanpa persetujuan eksplisit klien.
- **SEO heavy** sebagai kelas satu (ADR-10): terlibat sejak generasi konten → build
  → pelaporan.
- **LLM abstraction** (BR-12/ADR-4): vendor dapat diganti; tools agent via MCP (ADR-9).
- Bahasa bot: Indonesia santai-profesional.

### 1.5 Struktur monorepo (SRS §4.1)
```
apps/      api · worker · portal
packages/  core · shared · adapters · sites-kit
```
Setiap workspace: `build` (tsc) · `test` (Vitest) · `lint` (ESLint 9 flat).

### 1.6 Konvensi kerja
- Satu backlog ID = satu sesi agent; konteks kecil = akurat.
- Commit: `<ID-TUGAS>: ringkasan` (mis. `T-021: tenant guard`).
- Branch: `feature/*` → PR ke `main`. Push langsung ke `main` **diblok** mesin
  (branch protection: require `lint + typecheck + vitest`, strict, enforce_admins).
- Repo **public** (dipilih PO agar branch protection jalan di akun free; secret
  tetap tersembunyi).
- Gerbang: `pnpm turbo lint build test` wajib hijau sebelum PR/merge.
- Keputusan permanen → tulis ke sini/SRS/AGENTS.md, bukan prompt ad-hoc.
- File kontrak agent: **`AGENTS.md`** (wajib ada & ter-commit).

---

## 2. Status Pekerjaan (Backlog Fase 0)

Legenda: ✅ selesai · 🔧 berjalan · ⏳ pending · 🚫 blocked

### EPIC-00 — Jalur Kritis Eksternal (paralel, lead time panjang)
- ⏳ **T-001** Verifikasi Meta Business + nomor WABA digimaestro (sandbox kirim-terima)
- ⏳ **T-002** Xendit (recurring), VPS 4vCPU/8GB DC ID, kredensial cPanel/SSH shared
  hosting, DNS digimaestro.id, API key DeepSeek & GLM (teruji curl)
- 🚫 _Catatan:_ development tetap jalan pakai web chat + sandbox tanpa WABA.

### EPIC-01 — Monorepo, CI, AI Dev Tooling
- ✅ **T-010** Monorepo pnpm+Turborepo (ter-merge ke `main` via PR #1, commit `50ebd50`)
- ✅ **T-011** CI GitHub Actions (lint+typecheck+vitest) — **PR #1 merged**, CI hijau.
  Branch protection `main` aktif: require `lint + typecheck + vitest`, strict
  (up-to-date), wajib via PR, linear history, enforce_admins.
- ⏳ **T-012** Docker Compose dev & prod (postgres/redis/caddy/api/worker/n8n/umami) — belum dibuat.
- ✅ **T-013** Harness agent GLM 5.2 + `AGENTS.md` + template prompt
  (opencode + AGENTS.md aktif; template prompt di `docs/prompts/` ⏳)
- ⏳ **T-014** TestSprite via MCP — terdaftar di `opencode.json`; API key sudah diset
  (secret repo + env lokal). **Butuh restart opencode** agar MCP ter-load, lalu uji
  1 endpoint.

### EPIC-02 — Skema Data & Tenant Guard
- ✅ **T-020** Prisma schema inti (9 model: Tenant+`brandId`, User, Conversation,
  Message, Website, Revision, AgentJob, LlmUsage, AuditLog; +enum, tenantId &
  timestamps di semua tabel domain), migrasi awal (`00000000000000_init`), seed
  tenant uji (`warung-demo` + OWNER). Schema+client di `packages/adapters/prisma`
  (vendor SDK `@prisma/client` hanya di sini — SOLID-D, dijaga ESLint). **Ter-merge
  ke `main` via PR #2** (squash `883ab29`, 2026-07-03). CI hijau: `migrate deploy`
  (`00000000000000_init` applied) + `db seed` (`Seeded tenant warung-demo`) jalan
  pada service Postgres 16 — kriteria terima terpenuhi.
- ⏳ **T-021** Repository layer + tenant guard + uji kebocoran lintas tenant (NFR-09) — _berikutnya_

### EPIC-03..08 (Sprint 0.2–0.4): semua ⏳
- CHN (WABA gateway, web chat), AGT (LLM+MCP), slice builder, ops (n8n/Umami/billing
  sandbox), QA otomatis (T-080 TestSprite plan), demo end-to-end (T-083).

---

## 3. Keputusan Tertunda / Pertanyaan Terbuka
- **Default LLM produksi** (DeepSeek vs GLM 5.2) — diputuskan lewat T-050
  (bandingkan 20 prompt: biaya vs kualitas).
- **Harga paket & kuota job AI** — finalisasi sebelum Fase 1 (input: COGS dari Fase 0).
- **Kebijakan trial** — preview-gratis-lalu-bayar vs bayar-depan (rekomendasi: preview gratis).
- **Provider image generation & stock photo** — dievaluasi Fase 0 (DeepSeek tak punya image-gen).
- **Shared hosting: rsync/SSH vs fallback FTP** — dibuktikan minggu pertama (T-002).

---

## 4. Risiko Aktif (ringkas, rinci di BRD §9)
- RSK-01 Verifikasi WABA lambat → web chat sbg kanal cadangan penuh.
- RSK-09 Satu akun shared hosting = SPOF → DeployPort bisa pindah target; backup
  artifact di object storage.
- AI biaya membengkak → kuota per paket + monitoring (RSK-02).
- Kode AI melanggar arsitektur → **AGENTS.md + lint boundary + review tiap PR**.

---

## 5. Environment & Secrets (status, BUKAN nilai)
- `TESTSPRITE_API_KEY`: ✅ **valid (dirotasi 2026-07-04)**. Sebelumnya env lokal
  memuat key lama invalid (`sk-user-03w3e...`); kini dirotasi ke key valid
  (`sk-user-gvm7n...`, account `daruzboy`). Diset di **env user lokal** + **secret
  repo** `TESTSPRITE_API_KEY` (CI qa-gate). MCP terverifikasi: `opencode mcp list`
  → `✓ TestSprite connected`; probe `tools/call testsprite_check_account_info` →
  `firstName: daruzboy`. **Butuh restart opencode** agar 8 tool MCP termuat ke
  toolbelt agent (load hanya saat startup).
- `GLM_API_KEY`, `DEEPSEEK_API_KEY`: ⏳ belum diisi.
- WABA / Xendit / cPanel / S3 / Umami / n8n: ⏳ belum (EPIC-00).
- `.env.example` ada (template, tanpa nilai). Produksi via secret manager, bukan `.env`.
- **Relokasi `.git` (2026-07-04):** worktree tetap di
  `...\Documents\A_PROJECT\02_digimaestro\glm2-adminweb` (ter-sync Google Drive,
  OK), tapi `gitdir` dipindah ke **`C:\dev\glm2-adminweb.git`** (di luar Drive)
  via separate-git-dir. Sebab: Google Drive menyuntik `desktop.ini` ke subfolder
  `.git/` → ref rusak (`gh pr merge --delete-branch` gagal 2×) + `git fsck`
  "bad sha1 file" (97 file). Post-relokasi `git fsck` bersih. Detail & watch-item
  di `context.md` §"Catatan teknis penting".
- Env quirik lokal: pnpm 11.9.0 dipasang via `npm i -g pnpm` (corepack EPERM);
  Node lokal v24 (CI pin 22); **gh CLI v2.96.0 terpasang & ter-autentikasi
  (`daruzboy`, scope `repo`/`workflow`)**; build esbuild sudah di-approve (tersimpan
  di `pnpm-workspace.yaml`); `.npmrc`: `verify-deps-before-run=false`.

---

## 6. Referensi
- Spec: `doc/BRD.md`, `doc/PRD.md`, `doc/FRD.md`, `doc/SRS.md`
- Backlog: `doc/07-Backlog-Fase0-*.docx` · Setup: `doc/09-DevSetup-*.docx`
- Kontrak agent: `AGENTS.md` · Loop QA: `docs/qa/README.md`
- Resume sesi: `context.md`
