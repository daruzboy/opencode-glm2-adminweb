# context.md — Resume Sesi

> **Baca paling awal** (bersama `decision.md` & `AGENTS.md`) agar tidak kehilangan
> konteks saat memulai sesi baru. Perbarui di akhir tiap sesi kerja berarti.

- Sesi: T-040 backend slice (web chat) · Tanggal: 2026-07-04
- Cabang aktif: `feature/t-040-web-chat-backend` (PR ke `main`)
- Status umum: **T-021 merged (PR #7). T-040 backend slice (apps/api Fastify + WS
  chat + MessageRepository + createPrismaClient) selesai di branch, gate 21/21 hijau
  (api 8 test, adapters 25). Menunggu PR + CI. Widget portal = PR lanjutan T-040.**

## Di mana kita sekarang
Fase 0 — Sprint 0.2 mulai. EPIC-01 (T-010/011/013) & EPIC-02 (T-020/021) selesai &
merged ke `main`. **T-040 web chat (EPIC-04) — backend slice** di branch ini (Fastify
composition root pertama, guard T-021 ter-wire via `createPrismaClient`). EPIC-03 (WABA)
terblokir T-001 (verifikasi Meta+WABA belum dijalan PO). `.git` sudah di luar Google
Drive (`C:\dev\glm2-adminweb.git`).

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
- **TestSprite MCP dikonfigurasi & terverifikasi (T-014 sebagian).** Ditemukan: env
  lokal berisi key **lama invalid** (`sk-user-03w3e...j4Qmw`) → `testsprite_check_
  account_info` membalas "Invalid TestSprite API Key". Fix: key valid (`sk-user-
  gvm7n...`, account `daruzboy`) diset ke **User env** `TESTSPRITE_API_KEY` +
  di-mirror ke **secret repo** (CI qa-gate). Verifikasi end-to-end via probe MCP
  stdio (initialize → `tools/call check_account_info`) → `firstName: daruzboy`.
  `opencode mcp list` → `✓ TestSprite connected` (8 tool: `testsprite_bootstrap`,
  `generate_code_summary`, `generate_standardized_prd`, `generate_frontend/
  backend_test_plan`, `generate_code_and_execute`, `open_test_result_dashboard`,
  `check_account_info`). **BUTUH RESTART opencode** agar tool-termuat ke toolbelt
  agent (MCP hanya load saat startup). `opencode.json` sudah benar; key TIDAK
  ditulis ke file ter-track (repo public) — memakai referensi `{env:...}`.
  _Catatan:_ menjalankan tes terhadap endpoint butuh app API hidup (EPIC-03+);
  tool berbasis repo (`bootstrap`, `code_summary`, `*_test_plan`) sudah pakai.
- **T-021 diimplementasi** di `feature/t-021-tenant-guard` (NFR-09):
  - `packages/shared/src/ports/repository.ts` — Port `ConversationRepository` +
    `ConversationEntity`/`RepositoryError`/filter/input. Semua method wajib arg
    `tenantId: TenantId` → **compile-time guard** (query tanpa tenantId = type error).
  - `packages/adapters/src/prisma/tenant-guard.ts` — `assertTenantScoped` (validator
    murni, throw `TenantGuardError` bila tenantId hilang pada 7 model ter-scope),
    `guardOperation` (DB tak tercapai bila violasi), `tenantGuardExtension` (Prisma
    `$extends` top-level `$allOperations` → runtime guard utk raw prisma).
  - `packages/adapters/src/prisma/conversation-repo-prisma.ts` — `ConversationRepositoryPrisma`
    + `ConversationDelegate` (interface sempit → fake di test). Tiap method menyuntik
    tenantId ke where/data; map Date→ISO.
  - `TenantId`/`tenantId` **dipindah core→shared kernel** (agar `shared/ports` bisa
    pakai tanpa import core); core re-export.
  - Refactor: `adapters/src/index.ts` barrel-export prisma/*.
  - `pnpm turbo lint test build` → **21/21 hijau** (adapter 22 test: tenant-guard 13 +
    conversation-repo 6 + index 3). DB-free (mock/fake delegate).

## Keputusan desain T-020 (catatan)
- **Penempatan Prisma**: schema + client + migrasi + seed di `packages/adapters/prisma`.
  `@prisma/client` di-block import di `core`/`shared` oleh ESLint (boundary rule).
  Repository impl (T-021) nanti juga di adapters, implementasi Port di `shared/ports`.
- **`Message.tenantId` terdenormalisasi**: SRS §8 Message hanya punya `conversationId`;
  ditambah `tenantId` langsung agar guard anti-kebocoran lintas-tenant (NFR-09, diuji
  T-021) bisa ditegakkan per-baris.
- **ID**: `cuid()`. **brandId**: `String @default("digimaestro")` (bantuanpajak.id
  menumpang di masa depan tanpa migrasi enum).

## Keputusan desain T-021 (catatan)
- **Dua lapis guard**: (1) compile-time via signature Port (arg `tenantId` wajib);
  (2) runtime via `assertTenantScoped` + Prisma `$extends` (anti raw-prisma bypass).
  Repo sendiri juga menyuntik tenantId (primary guard). Sesuai kriteria terima
  backlog: "Test membuktikan query tanpa tenantId gagal kompilasi/runtime" → keduanya.
- **`TenantId` pindah ke shared kernel** (bukan core) supaya `shared/ports` memakainya
  tanpa melanggar dependency rule (core→shared, bukan sebaliknya). Core re-export
  agar konsumen lama tak rusak.
- **Pola satu repo per agregat** (SRS §4.2-I): T-021 buat `ConversationRepository`
  sebagai kanonik + infrastruktur guard global. Repo agregat lain (Message, Website,
  Revision-via-Website, AgentJob, dll.) menyusul saat use case pemakai dibuat
  (EPIC-03 CHN dst.) — bukan blocker kriteria terima T-021.
- **Delegate interface sempit** (`ConversationDelegate`) di adapters: repo bergantung
  ke interface, bukan PrismaClient penuh → fake di test tanpa DB + kompatibel
  struktural dgn `prisma.conversation` (method bivariance).
- **`tenantGuardExtension` sudah di-wire** di T-040: `createPrismaClient()` (adapters)
  = `new PrismaClient().$extends(tenantGuardExtension)`, dipakai composition root
  `apps/api/src/composition.ts`.

## Keputusan desain T-040 backend (catatan)
- **Pemisahan transport vs otak**: rute WS/REST hanya resolve tenant + persist IN/OUT
  via repository; balasan = stub (persona ID, PRD). Otak LLM/agent hadir EPIC-05/06
  (ganti `stubReply` dgn use case nyata, transport tak berubah).
- **DI di composition root**: `buildServer({ deps })` — handler bergantung pada Port
  (`ChatDeps`), test menyuntik fake → tanpa DB. `createChatDeps()` (Prisma) hanya
  dipanggil saat server nyata berjalan (butuh `DATABASE_URL`).
- **Tenant resolusi v0**: header `x-tenant-id` (REST) / query `tenantId` (WS). Bukan
  auth — guard T-021 tetap mencegah query lintas-tenant; resiko v0 = impersonasi
  tenantId, ditutup oleh auth T-002 (session/JWT) nanti.
- **Cast `as unknown as Delegate`** di `composition.ts`: delegate Prisma (enum literal)
  tak assignable struktural ke interface sempit repo (string) — beda tipe enumer saja.
  Aman di batas adapter; repo tetap menginject tenantId & teruji.
- **zod v4 (^4.4)** terpasang (bukan v3) — API `z.object/.parse` sama. `@fastify/
  websocket` v11 (raw `WebSocket` socket: `.on/.send/.close`).
- **WS belum diuji otomatis** (butuh WS client) — dicakup lewat use-case test +
  smoke manual; REST riwayat teruji via `app.inject()`.

## Langkah segera berikutnya
1. **Push `feature/t-040-web-chat-backend` → buka PR → CI hijau → merge.**
2. **T-040 frontend slice (lanjutan)**: widget minimal di `apps/portal` (React 19 +
   Vite 6) → connect `WS /api/chat` + muat riwayat. Selesai → T-040 penuh.
3. (Paralel, non-kode) **Restart opencode** → tool MCP TestSprite termuat; sekarang
   `apps/api` punya endpoint (`/healthz`, WS chat) untuk diuji TestSprite (T-014).
4. (Jalur kritis EPIC-00) **Dorong PO**: verifikasi Meta+WABA (T-001), kumpulkan
   kredensial (T-002) — agar EPIC-03 (T-030..033) tak tersendat.

## Hal yang ditunggu dari PO (jalur kritis, EPIC-00)
- Ajukan verifikasi Meta + WABA (T-001) — lead time terpanjang.
- Kumpulkan: akun Xendit, VPS DC Indonesia, SSH cPanel, API key DeepSeek+GLM (T-002).

## Catatan teknis penting (jangan lupa)
- **`.git` direlokasi keluar Google Drive (2026-07-04).** Worktree tetap di
  `...\Documents\A_PROJECT\02_digimaestro\glm2-adminweb` (ter-sync Google Drive,
  OK untuk file kerja), tapi `gitdir` sebenarnya di **`C:\dev\glm2-adminweb.git`**
  (di luar Drive). File `.git` di root worktree = pointer 1 baris:
  `gitdir: C:/dev/glm2-adminweb.git`. Sebab: Google Drive menyuntik `desktop.ini`
  ke tiap subfolder `.git/` → ref rusak (`refs/.../desktop.ini` menggagalkan
  `gh pr merge --delete-branch`) + `git fsck` melapor `bad sha1 file` di
  `.git/objects/`. Setelah relokasi + pembersihan 97 `desktop.ini`, `git fsck`
  bersih. Verify: `git rev-parse --git-dir` → `C:/dev/glm2-adminweb.git`.
  _Watch-item:_ jika Drive pernah mengembalikan `.git` sebagai folder (menimpa
  pointer), hapus lalu tulis ulang file pointer tsb. Konvensi `feature/<id>-...`
  (nama branch berslash) AMAN kembali (folder `.git/refs/...` tak lagi di-sync).
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
- Env lokal: Node 24 (CI 22), pnpm 11.9.0 via `npm i -g pnpm`. **gh CLI v2.96.0
  terpasang & ter-autentikasi** (`daruzboy`, scope `repo`/`workflow`). Docker Desktop
  ada CLI-nya tapi daemon **tidak berjalan** → verifikasi DB lokal belum dilakukan;
  andalkan service Postgres di CI.

## Cara melanjutkan sesi baru
1. Baca `decision.md` → `context.md` → `AGENTS.md` (sudah auto-load via
   `opencode.json`). Rujuk `doc/` untuk detail normatif.
2. Cek `git status`, `git log --oneline -5`, dan status PR aktif.
3. Ambil **satu** backlog ID; buat branch `feature/<id>-<ringkas>`; kerjakan sesuai
   AGENTS.md; `pnpm turbo lint build test` hijau; PR ke `main`.
