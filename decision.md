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
- Terakhir diperbarui: 2026-07-12 (sinkron dgn `main`, PR #51–#70)
- **Peta jalan ke "100% siap dijual": lihat §7.** Status: Fase 0 ~80% · siap-jual ~40%.

---

## 1. Keputusan FIX (Locked — jangan diubah tanpa persetujuan PO)

### 1.1 Stack (SRS §2)
Node 22 LTS · TypeScript 5 (strict) · Fastify v5 · Prisma 6 + PostgreSQL 16 ·
BullMQ + Redis 7 · Zod · Astro 5 + Tailwind 4 (sites-kit) · React 19 + Vite 6
(portal/admin) · pnpm + Turborepo · Vitest + Playwright · MCP TypeScript SDK ·
n8n (self-host) · Umami · Caddy.
**Kanal Fase 0 = Telegram Bot API** (HTTPS+JSON, tanpa SDK — ADR-11). **Media**:
`sharp` (resize+WebP; satu-satunya dep native, disetujui PO — T-033).

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

### 1.3 Topologi runtime (SRS §3, ADR-6/8/13)
- **VPS** (DC Indonesia): platform inti (api, worker, portal, n8n, Umami, Postgres,
  Redis, Caddy). Juga hosting URL preview draft (ber-token, noindex).
  **VPS TIDAK punya domain publik** (tak ada DNS yang mengarah ke sana; port 80/443
  belum dibuka) → konsekuensi nyata: webhook Telegram mustahil dipanggil → dipakai
  **long-polling** (ADR-11); media/objek tak bisa disajikan dari VPS ke pengunjung situs.
- **Shared hosting cPanel** (Rumahweb, sudah dimiliki): file statis situs klien.
  **URL situs = path** `https://digimaestro.id/<slug>/` (**ADR-13**, bukan subdomain);
  TLS memakai sertifikat domain utama yang sudah aktif. Deploy **FTPS** (SSH tertutup).
  Kode subdomain (`<slug>.digimaestro.id` via cPanel UAPI + AutoSSL, FR-PUB-004b) tetap
  ada & teruji — tinggal `PUBLISH_URL_MODE=subdomain` bila arah berubah.
- **Media tenant**: diunggah ke hosting di `media/<tenantId>/` — **di luar docroot situs**,
  karena deploy publish = mirror penuh (upload + hapus file usang); media di dalam docroot
  situs akan LENYAP tiap publish ulang (T-033).
- **Object storage S3-compatible (MinIO)**: build artifact (rollback). Ada di compose
  (profil `storage`), **belum dipasang di deploy live**.
- **Situs klien = statis penuh** (Astro, zero-JS default) → diekspor/deploy ke
  shared hosting. Fitur dinamis (form, analytics) memanggil API pusat di VPS.

### 1.3b Keputusan kanal & URL (ADR-11/12/13 — detail di SRS §1)
- **ADR-11 — Kanal Fase 0 = Telegram**, bukan WABA. WABA **ditunda, tidak dibatalkan**
  (verifikasi Meta = lead time di luar kendali tim, memblokir SELURUH vertical slice).
  Kedua kanal dinormalisasi ke `InboundChannelMessage` di balik **`ChannelPort`**
  (`packages/shared/src/ports/channel.ts`) → menambah WABA nanti = menambah adapter,
  bukan membongkar core.
- **ADR-12 — Bot dijaga allowlist** `chat_id → tenant` (env `TELEGRAM_ALLOWLIST`).
  Bot Telegram TERBUKA: siapa pun yang menemukannya bisa mengirim pesan dan tiap pesan
  yang lolos membakar token LLM berbayar. Chat asing ditolak **sebelum** LLM dipanggil.
  Auto-provision tenant + kuota = follow-up sadar, bukan kelalaian.
- **ADR-13 — URL situs klien berbasis path** (`PUBLISH_URL_MODE=path`). Akun FTP deploy
  di-chroot ke document root domain utama → folder `<slug>` langsung tayang ber-HTTPS
  tanpa provisioning apa pun. Subdomain menambah lapisan yang bisa gagal (DNS lambat /
  AutoSSL belum terbit → **publish SUKSES dilaporkan gagal**) demi keuntungan kosmetik.
  Konsekuensi: kredensial cPanel UAPI **tidak disimpan** di server; tak ada perubahan DNS.

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
  — **tidak lagi memblokir** Fase 0: kanal Telegram dipakai sbg rencana A (ADR-11).
- ✅ **T-002** (sebagian besar TUNTAS 2026-07-11): kredensial **cPanel/FTPS** diberikan PO
  → deploy situs nyata SUKSES; **API key DeepSeek** diberikan → agent hidup; DNS
  `digimaestro.id` resolve (Rumahweb). ⏳ _Sisa:_ Xendit (recurring) + `GLM_API_KEY`.
- 🚫 _Catatan lama ("dev jalan pakai web chat tanpa WABA") sudah usang_ — kanal Telegram
  kini kanal utama Fase 0 dan sudah dipakai PO sungguhan.

### EPIC-01 — Monorepo, CI, AI Dev Tooling
- ✅ **T-010** Monorepo pnpm+Turborepo (ter-merge ke `main` via PR #1, commit `50ebd50`)
- ✅ **T-011** CI GitHub Actions (lint+typecheck+vitest) — **PR #1 merged**, CI hijau.
  Branch protection `main` aktif: require `lint + typecheck + vitest`, strict
  (up-to-date), wajib via PR, linear history, enforce_admins.
- ✅ **T-012** Docker Compose dev & prod (postgres/redis/caddy/api/worker/n8n/umami) — image
  staging (PR #23) + Compose penuh (2026-07-09, diverifikasi end-to-end di VPS). Detail di §2.
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
- ✅ **T-021** Repository layer + tenant guard + uji kebocoran lintas tenant
  (NFR-09). `packages/shared/src/ports/repository.ts`: Port `ConversationRepository`
  (semua method wajib arg `tenantId: TenantId` → **compile-time guard**) + entity/error.
  `packages/adapters/src/prisma/tenant-guard.ts`: `assertTenantScoped` (validator murni,
  throw `TenantGuardError` bila tenantId hilang) + `tenantGuardExtension` (Prisma
  `$extends` top-level `$allOperations` → **runtime guard** untuk raw prisma).
  `packages/adapters/src/prisma/conversation-repo-prisma.ts`: implementasi Port
  (tiap method menyuntik tenantId ke where/data). `TenantId` dipindah core→shared
  kernel. Kriteria terima ("query tanpa tenantId gagal kompilasi/runtime") terbukti:
  13 test tenant-guard + 6 test repo (cross-tenant leak: where SELALU berisi tenantId
  kaller). `pnpm turbo lint test build` 21/21 hijau. Extension di-wire di composition
  root apps/* (EPIC-03+); repo lain menyusul per use case pemakai.
- 🔧 **T-020ext (adapter WebsiteRepository + RevisionRepository)** Implementasi Prisma dua
  Port repo yang sebelumnya baru punya kontrak (SRS §8; NFR-09) — **PR tersendiri, 2026-07-10:**
  `packages/adapters/src/prisma/website-repo-prisma.ts` (`WebsiteRepositoryPrisma`: `findByTenantId`
  + `update` via `updateMany` where{tenantId,id} → re-read; kosong→CONFLICT, count 0→NOT_FOUND) &
  `revision-repo-prisma.ts` (`RevisionRepositoryPrisma`: `findById`/`findLatest`/`create`/`update`,
  **tenant-scoped via Website**: `assertOwned` cek Website milik tenant DULU → cross-tenant = null/
  NOT_FOUND tanpa bocor, pola konsisten `PublishSourcePrisma`; `number` auto-increment via count+1,
  race dijaga `@@unique([websiteId,number])`). Delegate sempit → fake test tanpa DB. Gate 21/21
  (adapters +28 tes: 10 website + 18 revision, incl. cross-tenant no-leak & error path).

### EPIC-03..08 (Sprint 0.2–0.4)
- ✅ **T-040** Web Chat (EPIC-04, FR-CHN-003) — **backend + frontend ter-merge ke `main`**
  (PR #8, squash `f508e1b`, 2026-07-04): `MessageRepository` (Port+impl, mirror
  T-021) + `createPrismaClient()` (Prisma `$extends(tenantGuardExtension)` ter-wire
  pertama kali) + `apps/api` Fastify v5 composition root (`/healthz`, `GET
  /api/chat/:id/messages` riwayat tenant-scoped, `WS /api/chat` realtime) + use case
  `handleIncoming` (persist IN/OUT, stub reply v0; agent AI nyata EPIC-05). Test
  DB-free (handle-incoming + REST via inject) hijau; gate 21/21. Deps: `fastify`,
  `@fastify/websocket`, `zod`, `@digimaestro/adapters`. Tenant resolusi v0 via header
  `x-tenant-id`/query (auth T-002 menyusul). **Frontend (widget) slice ter-merge ke
  `main` (PR #10, squash `7278e28`, 2026-07-04):** `apps/portal/src/chat-widget.ts`
  menambahkan `ChatWidgetController`, `ChatTransport`, browser REST/WS transport,
  parser event murni, optimistic local IN message, dan export dari portal index.
  `apps/portal/src/chat-widget-view-model.ts` menambahkan mapping presentation murni
  untuk copy/status/message list sebelum UI React dipasang. `chat-widget-session.ts`
  menambahkan facade headless + `ChatWidgetStorage` port untuk menyimpan
  `conversationId` per tenant. `chat-widget-presenter.ts` menambahkan lapis form
  presenter untuk draft input, submit label, placeholder, dan `canSubmit`, termasuk
  factory `createBrowserChatWidgetPresenter()` untuk pemakaian browser siap pakai.
  Storage `conversationId` bersifat best-effort: read/write error (private mode,
  quota, blocked storage) tidak mematikan chat. Session `stop()` idempoten dan
  melepas listener persist agar cleanup ganda tidak menutup socket/menulis storage
  berulang.
  `chat-widget-dom.ts` menambahkan DOM mount adapter minimal (`mountBrowserChatWidget`)
  tanpa dependency React/Vite, dengan runtime DOM diinjeksi, plus
  `mountBrowserChatWidgetFromDataset()` untuk root element berbasis `data-*` dan
  `mountAllBrowserChatWidgets()` untuk auto-mount banyak root dengan callback
  `onMountError` opsional. DOM adapter juga menambahkan atribut aksesibilitas dasar:
  status live region, error alert, form/input labels, `aria-busy`, dan `maxlength=4000`
  selaras schema backend. `CHAT_MESSAGE_MAX_LENGTH` diekspor sebagai kontrak bersama;
  controller menolak pesan >4000 karakter dan presenter menonaktifkan submit + memberi
  helper hitung karakter; saat melewati limit, helper menampilkan alasan eksplisit.
  DOM mount bersifat idempoten per-root (WeakMap registry)
  agar HMR/partial reload tidak membuat double listener; `destroy()` juga idempoten
  sehingga cleanup ganda tidak menutup socket berulang. Helper
  `destroyBrowserChatWidgetMounts()` membersihkan hasil `mountAllBrowserChatWidgets()`
  sebagai grup tanpa menambah dependency UI.
  Message view-model membawa `dateTime` asli; DOM message item menulis `data-tone`,
  `aria-label`, dan `<time datetime="...">` untuk semantik aksesibilitas/styling.
  View-model juga membawa `status` key stabil; DOM `data-status` memakai key
  (`open`, `connecting`, dst.) bukan label copy Indonesia.
  Desain SOLID: controller hanya state/use-case UI, transport hanya I/O, parser murni,
  runtime browser diinjeksi agar testable tanpa React/Vite. Test baru
  `apps/portal/src/chat-widget.test.ts` menutup load history, payload WS, reply event,
  pending conversation normalization, invalid payload, error koneksi, derivasi URL
  WebSocket, dan REST header `x-tenant-id`. `chat-widget-view-model.test.ts`
  menutup copy Indonesia, enable send, arah pesan, dan label error.
  `chat-widget-session.test.ts` menutup start/load/connect, submit, persist
  conversation id, browser storage adapter, storage read/write failure, dan stop
  idempotent + detach persistence listener.
  `chat-widget-presenter.test.ts`
  menutup draft state, submit trim/reset, disable blank submit, dan unsubscribe.
  `chat-widget-dom.test.ts` menutup render shell, input event, submit, destroy,
  dataset config, error tenant kosong, dan auto-mount multi-root yang melewati root
  invalid + melaporkan error mount, termasuk atribut aksesibilitas DOM.
  Test controller/presenter menutup guard panjang pesan >4000 dan helper karakter.
  Test DOM menutup double mount, double destroy, dan remount setelah destroy.
  Test DOM juga menutup submit form hingga payload WS backend-compatible
  (`conversationId` + `text`).
  Test view-model/DOM menutup status key stabil, timestamp asli, dan atribut semantik pesan.
  Test DOM menutup cleanup kolektif auto-mounted widgets.
  `apps/portal/src/index.test.ts` menutup export publik API web chat.
  Verifikasi lokal alternatif (karena `pnpm` tidak tersedia di PATH sandbox):
  `tsc -b`, `vitest run`, `eslint .` hijau. Frontend slice dinilai cukup untuk MVP
  T-040: teks, riwayat, WS, tenant header/query, session persistence, aksesibilitas
  dasar, dan lifecycle mount sudah tertutup.
- ✅ **T-050** LLM Abstraction + MCP Skeleton (EPIC-05, FR-AGT-008/010) — **ter-merge
  ke `main` (PR #13, squash `33d4edd`, 2026-07-04):** `packages/shared/src/ports/llm.ts`
  menambahkan Port `LlmJsonPort`, `LlmUsageLoggerPort`, tipe `LlmJsonRequest`,
  `LlmError`, dan `LlmUsageRecord`. Schema menggunakan interface struktural
  `safeParse()` yang kompatibel dengan Zod tanpa shared mengimpor runtime `zod`,
  menjaga dependency rule dan tetap offline-testable. `packages/adapters/src/llm/
  openai-compatible-json-adapter.ts` menambahkan adapter JSON OpenAI-compatible
  generik untuk DeepSeek/GLM: runtime `fetch` diinjeksi, `response_format:
  json_object`, validasi schema, retry/self-repair maks. 3 percobaan, usage logging
  opsional via Port, dan estimasi biaya token. Factory `createDeepSeekJsonAdapter()`
  dan `createGlmJsonAdapter()` diekspor dari `@digimaestro/adapters`.
  `LlmUsageLoggerPrisma` mencatat `LlmUsage` tenant-scoped (token in/out + cost)
  via delegate sempit. `apps/api/src/composition.ts` menambahkan factory
  `createLlmJsonPort()` untuk memilih DeepSeek/GLM via env
  `DIGIMAESTRO_LLM_PROVIDER` tanpa mengubah chat stub. `DeterministicLlmJsonAdapter`
  ditambahkan untuk test/dev agent flow tanpa jaringan/API key. `packages/core/src/
  llm/provider-evaluation.ts` menambahkan helper murni `recommendLlmProvider()`
  untuk merangkum hasil golden prompt (pass rate, kualitas, latensi, biaya) dan
  memberi rekomendasi deterministik; ini menjadi dasar laporan 20 prompt saat API key
  tersedia. `.env.example` diselaraskan dengan env composition root
  (`DIGIMAESTRO_LLM_PROVIDER`, model, base URL opsional). Golden set 20 prompt
  evaluasi (`LLM_GOLDEN_PROMPTS`) ditambahkan di core, mencakup brief UMKM,
  revisi operator, dan NEEDS_INFO; `createLlmEvaluationReport()` merangkum coverage
  prompt, provider count, missing prompt, dan rekomendasi provider. `packages/shared/
  src/ports/agent-tool.ts` menambahkan kontrak tool agent vendor-neutral +
  `toOpenAiToolDefinition()` untuk bridge function-calling tanpa SDK vendor.
  `InMemoryAgentToolRegistry` di core menambahkan list/call tool dengan guard scope
  tenant sebagai fondasi T-051. `AuditLogPort` + `AuditLogPrisma` ditambahkan agar
  setiap invokasi tool agent bisa dicatat ke tabel `AuditLog`; registry fail-closed
  bila audit gagal, sesuai kebutuhan traceability SRS §5.4. Test kontrak adapter
  menutup happy path, retry karena schema invalid, HTTP 5xx, usage/cost log,
  default base URL provider, logger Prisma, factory composition, dan mock
  deterministik; test core/shared menutup golden prompt set, report, scoring provider,
  tool bridge, registry scope guard, dan audit tool call.
  Verifikasi lokal alternatif terakhir: `tsc -b`, `vitest run` (106/106), `eslint .`
  hijau.
- ✅ **T-051** MCP server skeleton + bridge function-calling — **ter-merge ke `main`
  (PR #12, squash `92fc0b2`, 2026-07-04):** `packages/core/src/agent/builtin-tools.ts` menambahkan
  tiga tool pertama sesuai backlog/SRS §5.4: `sitebuilder_get_site_outline`,
  `sitebuilder_apply_patch`, dan `ops_get_job_status`. Tiap tool bergantung pada
  port kecil (`SitebuilderToolPort`, `OpsToolPort`), memvalidasi input di boundary,
  menyuntik `tenantId` dari `AgentToolContext`, dan mengembalikan `Result`.
  `executeFunctionToolCalls()` menambahkan bridge OpenAI-compatible untuk menerima
  tool call model, parse JSON arguments, memanggil registry, dan mengembalikan tool
  result message terstruktur. Implementasi DB/MCP SDK nyata menyusul, tetapi kontrak
  tool sudah dapat masuk registry dan bridge OpenAI-compatible. Verifikasi lokal alternatif terakhir:
  `tsc -b`, `vitest run` (114/114), `eslint .` hijau.
- 🔧 **Hardening T-040/T-050/T-051** (PR hardening, 2026-07-04): T-040 — ID lokal pakai
  `crypto.randomUUID()` (anti-tabrakan), **auto-reconnect WS + backoff eksponensial**
  (status `reconnecting`, max attempt), dedup union `direction`/`status` dari
  `@digimaestro/shared` (anti-drift). T-050 — `temperature` default **per-task**
  (`DEFAULT_TEMPERATURE_BY_TASK`), **evaluation runner** `runLlmEvaluation` di core
  (quality scorer via `requiredSignals`, cost via usage logger) + CLI
  `pnpm --filter @digimaestro/worker eval:llm` (siap jalan begitu API key diisi).
  T-051 — eksekusi tool **paralel** (`Promise.all`, urutan hasil terjaga). Gate 21/21
  (124 tes).
- ✅ **T-050 evaluasi provider DIJALANKAN** (2026-07-09, API DeepSeek nyata via `eval:llm`):
  **deepseek** → pass **90%** (18/20 sinyal kualitas, 0 hard-failure), quality **0.85**,
  cost **~$0.0031/20 prompt**, latency **~1497ms**, score **0.699** → **rekomendasi: deepseek**.
  GLM belum diuji (butuh `GLM_API_KEY`). Lihat §3 keputusan default LLM.
- ✅ **T-052** Router intent + state percakapan (EPIC-05, FR-CNV-001/002; M) —
  **ter-merge ke `main` (PR #17, squash `7e4eaf0`, 2026-07-04):**
  `packages/core/src/conversation/intent.ts` klasifier **hybrid dua tahap** (SRS §5.3
  "cache frasa umum"): `classifyIntentKeyword` murni/deterministik/gratis (rules = data,
  urutan prioritas revision>status>interview) → fallback `LlmJsonPort` (task `intent`,
  temp 0) bila keyword null; tanpa LLM, null dipetakan ke `other`. Intent 4 kelas
  `interview|revision|status|other` (dirancang ekstensible via array `KEYWORD_RULES`).
  `state-machine.ts` transisi murni `(ConversationState, Intent) → {state, action}`:
  interview→INTERVIEW/START_INTERVIEW; revision sah saat ada situs (BUILDING/REVIEW→REVIEW/
  HANDLE_REVISION) else FALLBACK; status→REPORT_STATUS (state tak berubah); other→FALLBACK.
  `router.ts` use case `advanceConversation`: load (tenant-scoped) → klasifikasi → state
  machine → persist state bila berubah. **Tambahan Port `update(tenantId,id,{state})`** di
  `ConversationRepository` (compile-time guard) + impl Prisma via `updateMany({where:
  {tenantId,id}})` + re-read findFirst (guard NFR-09; Prisma `update` menolak field non-
  unik di where, jadi `updateMany`). Count 0 → NOT_FOUND; input kosong → CONFLICT.
  Kriteria terima "20 kalimat uji ≥90% benar" terpenuhi (20/20 via keyword, path LLM
  diuji dengan fake inline — core TIDAK import adapters, dependency rule dijaga ESLint).
  Verifikasi lokal alternatif: `tsc -b`, `vitest run` (147/147, +23 tes), `eslint .` hijau.
- ✅ **T-053** Agent loop orchestration + `ConversationReplier` (EPIC-05) — **ter-merge ke
  `main` (PR #21, squash `9e5a783`, 2026-07-04).** `packages/core/src/agent/agent-loop.ts`
  + `conversation/replier.ts` (+ `DeterministicAgentAdapter` di adapters, Port `llm-agent.ts`
  di shared). Fondasi loop percakapan di atas router T-052.
- ✅ **T-053b** Use case build Site Document → persist Revision + tool sitebuilder (EPIC-05,
  FR-AGT-001/004) — **PR #44, 2026-07-10:** `packages/core/src/builder/build-site.ts`
  `buildSiteFromBrief` (murni, bergantung Port `LlmJsonPort`+`RevisionRepository`+`WebsiteRepository`;
  guard defense-in-depth id website) + adapter `SitebuilderToolAdapter` (`packages/adapters/src/
  builder/`, impl `SitebuilderToolPort`: `getSiteOutline` ekstrak outline dari revisi terbaru,
  `applyPatch` LLM revision_patch → persist Revision baru). Clean-arch: core tak impor vendor;
  adapter redeklarasi port struktural (hindari edge adapters→core). Gate 21/21. _Catatan review:_
  komentar "update status DRAFTING" tak dieksekusi; `PERMISSIVE_SCHEMA` default (validasi di worker).
- ✅ **T-053c** Adapter `LlmAgentPort` HTTP OpenAI-compatible + wiring composition (EPIC-05,
  FR-AGT-008) — **PR #46, 2026-07-10:** `packages/adapters/src/llm/openai-compatible-agent-adapter.ts`
  `OpenAiCompatibleAgentAdapter` (single-shot `completeWithTools`; loop `maxSteps` di core; reuse
  `RuntimeFetch` sempit → offline-test; API key hanya di header, timeout AbortController). `apps/api
  composition` pilih adapter HTTP bila API key ada. Gate 21/21. _Catatan review:_ error jaringan
  `retryable:false` (JSON adapter `true` — inkonsisten); replier produksi awalnya 0 tool → **ditutup T-053d**.
- ✅ **T-053d** Wiring agent produksi → tool sitebuilder (EPIC-05, FR-AGT-004; **loop inti**) —
  **PR tersendiri, 2026-07-10:** `createProductionAgentReplier` (`apps/api/composition.ts`) kini
  membangun `WebsiteRepositoryPrisma`+`RevisionRepositoryPrisma` (T-020ext) → `SitebuilderToolAdapter`
  (T-053b) → registry `createSitebuilderToolRegistry` (tool `sitebuilder_get_site_outline`+
  `sitebuilder_apply_patch`, T-051) disuntik ke agent loop. **Menutup celah**: sebelumnya
  `createAgentToolRegistry([])` (0 tool) → agent tak bisa bangun/edit situs; kini loop
  chat→bangun/revisi Site Document→persist Revision **tersambung**. Helper registry diekspor +
  bergantung Port → teruji offline (fake port). Gate 21/21 (api +4 tes: daftar tool, guard scope,
  dispatch outline/patch). _Sisa:_ inject schema Site Document nyata (kini permissive) + auth rute (T-002).
- ✅ **T-053e** Lengkapi loop agent — build situs baru + validasi schema (EPIC-05, FR-AGT-001/004;
  **melengkapi loop inti**) — **PR tersendiri, 2026-07-10:** (1) **Schema Site Document NYATA**:
  `composition` inject `siteDocumentSchema` (sites-kit, Zod `safeParse` kompatibel `LlmJsonSchema`)
  ke `SitebuilderToolAdapter` + `BuildDeps` → `apply_patch`/`build` kini **memvalidasi output LLM +
  self-repair** (bukan `PERMISSIVE`). (2) **Tool `sitebuilder_build_site`** (`apps/api/src/agent/
  build-site-tool.ts`): bungkus use case core `buildSiteFromBrief` (T-053b) sbg `AgentToolDefinition`
  (parse brief → resolve website tenant → Revision DRAFT pertama); di composition root krn menyatukan
  core+adapter (tanpa duplikasi/langgar dependency rule). Diregistrasi via `createSitebuilderToolRegistry
  (port, [buildTool])`. (3) **Router**: `START_INTERVIEW` kini scope `['sitebuilder']` + prompt interview
  mengarahkan agent memanggil `sitebuilder_build_site` setelah brief cukup → **jalur situs BARU
  (interview→build→DRAFT) tersambung** (approval-first terjaga: draft ≠ publish). Gate 21/21 (api +6
  tes build-tool offline; replier test discope-update). _Sisa:_ E2E dgn API key nyata + auth rute (T-002).
- ✅ **T-002auth** Autentikasi JWT dasar + resolusi tenant (EPIC-00/NFR-07) — **PR #45, 2026-07-10:**
  Port `AuthPort` (shared) + `JwtAuthPort` (adapter, satu-satunya impor `jsonwebtoken`; verify/issue
  → `Result`) + `POST /api/auth/token` + plugin `resolveTenant`. **UTANG (lihat memory):** plugin
  **belum dipasang ke rute** (chat/publish/preview masih `x-tenant-id`) → NFR-07 belum tegak;
  endpoint token mencetak OWNER tanpa kredensial (aktif bila `JWT_SECRET` diisi) → butuh guard
  produksi + wiring rute. Merged atas keputusan PO meski temuan dipaparkan. Gate 21/21.
- ✅ **T-002auth-wiring** Pasang auth ke rute + amankan endpoint token (EPIC-00/NFR-07; **bayar utang #45**) —
  **PR tersendiri, 2026-07-11:** (1) `buildServer` **selalu** memasang `app.resolveTenant` (JWT bila
  `JWT_SECRET` diisi → rute wajib Bearer token; tanpa JWT → fallback `x-tenant-id` dev). Rute
  **chat REST + publish** kini panggil `resolveTenant` (bukan baca `x-tenant-id` langsung) → token
  invalid/absen = 401; `x-tenant-id` TAK menembus saat auth aktif (kecuali `AUTH_DISABLED=1`). (2)
  Endpoint dev `POST /api/auth/token` kini **hanya terpasang bila `AUTH_DEV_TOKEN=1`** → produksi
  tak mengekspos pencetak token tanpa kredensial. `AuthDeps.devTokenEnabled` + `.env.example`
  `AUTH_DEV_TOKEN`. Gate 21/21 (api +4 tes route-guard: 401 tanpa token, 202 dgn token valid, 401
  token sampah, 404 endpoint token tanpa flag). **NFR-07 tegak utk rute REST.** _Sisa (follow-up):_
  auth WS `/api/chat` (masih query `tenantId`; butuh token-query) + slug→tenantId mapping riil.
- ✅ **T-080slice** Integration test repo + tenant guard DB nyata (EPIC-08/NFR-11) — **PR #47,
  2026-07-10:** `repo-integration.test.ts`. **UTANG:** di-gate `RUN_INTEGRATION_TESTS=1` yang tak
  pernah diset → **selalu skip di CI**; cleanup `deleteMany()` tanpa `where` kena tenant-guard →
  `TenantGuardError` (tak bisa lulus saat diaktifkan). Perlu klien unguarded + wiring flag CI.
- ✅ **Hardening T-050/T-051 lanjutan** — **ter-merge ke `main` (PR #22, squash `8dbc2e4`,
  2026-07-09):** T-050 — **retry pada 429/timeout dgn exponential backoff** di
  `openai-compatible-json-adapter` + **ambang (threshold)** di `evaluation-runner`. T-051 —
  hardening `tool-registry` & `function-call-bridge`. Gate lokal 21/21 hijau + CI hijau.
  (Berbeda dari PR #15 yang mencakup temperature per-task + eval runner + tool paralel.)
- ✅ **T-012** Docker Compose dev & prod — **image staging** ter-merge PR #23 (`cbae68f`);
  **Compose penuh** ter-merge PR #… (2026-07-09): `docker-compose.yml` (service inti
  postgres 16 / redis 7 / migrate one-shot `prisma migrate deploy` / api / worker; edge
  `caddy` + ops `n8n`+`umami`+`umami-db` di **profil** `edge`/`ops`), overlay
  `docker-compose.prod.yml` (restart always, port DB/Redis tak di-publish, trafik via
  Caddy), `deploy/Caddyfile` (reverse proxy + WS `/api/*`), env compose di `.env.example`.
  Worker diberi bootstrap long-running (`runWorker` + keep-alive + shutdown SIGTERM/SIGINT)
  agar kontainer tak restart-loop; konsumen BullMQ nyata tetap menyusul EPIC-05/06.
  **Diverifikasi end-to-end di VPS**: `docker compose up --build` → migrate exit 0
  (migrasi `00000000000000_init` applied), api `healthy` + `GET /healthz` → `{status:ok}`,
  worker `running` restarts=0; verifikasi pakai host port 3300 (port 3000 dipakai deploy
  `glm2-*` existing) lalu `down -v`. `config` valid utk base & prod+profil.
- 🔧 **T-060 (slice model)** Site Document + registry section + design token (EPIC-06,
  FR-CMP-001..005) — **ter-merge ke `main` (PR #…, 2026-07-09):** model situs tervalidasi
  Zod di `packages/sites-kit` (framework-neutral; render Astro = slice T-06x berikutnya).
  `design-tokens.ts`: `designTokensSchema` (colors/typography/radius/spacing) + **3 tema**
  bawaan (FR-CMP-003, styling hanya via token). `sections.ts`: **13 tipe section** di
  `SECTION_REGISTRY` (satu sumber kebenaran, open/closed FR-CMP-005 — `SectionType` diturunkan
  dari keys registry), tiap tipe **≥2 varian** (FR-CMP-002) + skema props Zod (konten saja),
  `sectionSchema` discriminated-union. `site-document.ts`: `siteDocumentSchema`
  (Website→Pages→Sections, slug kebab-case unik, FR-CMP-004) + `parseSiteDocument()` (Result
  ringkas berlabel path). Gate 21/21 hijau (sites-kit +21 tes: tema, registry, union, doc
  valid/invalid). **Belum**: wiring build Astro/file-routing (slice lanjutan) — renderer
  deterministik ada di T-061.
- 🔧 **T-061 (slice renderer)** Site Document → HTML statis zero-JS + CSS token + JSON-LD
  (EPIC-06, FR-CMP-004/FR-SEO-001/002, ADR-3) — **ter-merge ke `main` (PR #…, 2026-07-09):**
  renderer murni deterministik di `packages/sites-kit/src/render/`. `escape.ts` (escapeHtml/
  escapeAttr + `safeUrl` blok `javascript:`/`data:` — anti-XSS build-time). `tokens-css.ts`
  (token → CSS custom properties `--dm-*` + stylesheet dasar; styling hanya via token).
  `sections.ts` `renderSection()` — switch **exhaustive** atas discriminated union (tambah
  tipe tanpa renderer = error kompilasi), semua konten di-escape, `<details>` untuk FAQ
  (zero-JS). `json-ld.ts` `buildJsonLd()` — LocalBusiness (root), FAQPage, Product ItemList,
  BreadcrumbList (non-root). `page.ts` `renderPage()`/`renderSite()` — dokumen HTML5
  `lang="id"` (title unik, meta description, canonical, OG) → daftar file URL bersih.
  **Diverifikasi**: render Site Document nyata → HTML5 valid, 3 node JSON-LD, 0 script
  non-JSON-LD (zero-JS), tanpa `javascript:` URI. Gate 21/21 (sites-kit +22 tes render).
  **Belum**: wiring Astro build + Tailwind utilities + audit schema.org di pipeline (slice ops).
- 🔧 **T-062 (slice artifact)** Rakit artifact statis siap-deploy + preview noindex (EPIC-06,
  FR-SEO-001/FR-PUB-001, SRS §8) — **ter-merge ke `main` (PR #…, 2026-07-09):**
  `render/sitemap.ts` `buildSitemap(doc, baseUrl)` (URL absolut, XML-escaped) +
  `buildRobots({baseUrl,noindex})` (publish: allow+sitemap; preview: disallow all).
  `render/site-build.ts` `buildStaticSite(doc, {baseUrl?, noindex?})` → daftar `StaticFile`
  ({path, contents, contentType}) = HTML per halaman + sitemap.xml (hanya publish) + robots.txt.
  `renderPage`/`renderSite` diberi opsi `RenderOptions` (canonical/OG absolut via `baseUrl`,
  `<meta robots noindex,nofollow>` via `noindex`) — backward-compatible. **Diverifikasi**:
  rakit artifact nyata ke disk → `index.html`, `menu/index.html`, `sitemap.xml`, `robots.txt`
  benar (URL absolut). Gate 21/21 (sites-kit 50 tes, +7 artifact). **Belum**: `BuildArtifactPort`/
  upload object storage + `DeployPort` rsync shared hosting (butuh kredensial S3/cPanel — EPIC-00).
- 🔧 **T-064 (slice preview-route)** Rute preview draft ber-token, noindex (EPIC-06,
  FR-PUB-001; SRS §9 `/api/preview/:revisionId?t=token`) — **ter-merge ke `main` (PR #…,
  2026-07-09):** Port `PreviewPort` di shared (`getPreview({revisionId,token})` → revisi/null;
  token salah=null agar tak bocorkan keberadaan). `apps/api/src/preview/`: `handlePreview`
  (token kosong/salah=404, error repo=500, `parseSiteDocument` gagal=500, sukses=render
  halaman `noindex`) + `registerPreviewRoutes` (header `X-Robots-Tag: noindex`). `buildServer`
  menerima `preview` opsional (diregistrasi bila disuntik). **Diverifikasi** via Fastify
  `inject`: token benar → 200 HTML noindex, token salah → 404. Gate 21/21 (api 20 tes, +7).
  **Adapter Prisma + wiring SELESAI** (PR #…, 2026-07-10): `packages/adapters/src/prisma/
  preview-token.ts` — **token stateless HMAC-SHA256(PREVIEW_TOKEN_SECRET, revisionId)**
  (keputusan desain token, §3): `createPreviewToken`/`verifyPreviewToken` (timing-safe,
  tanpa migrasi/kolom DB; revoke = rotasi secret). `preview-port-prisma.ts` `PreviewPortPrisma`
  (impl `PreviewPort` via delegate sempit `RevisionPreviewDelegate.findUnique`; verifikasi token
  DULU → baru muat `Revision.siteDoc`; revisi tak ada/token salah = keduanya null; Revision tak
  ter-scope tenant langsung → aman thd `tenantGuardExtension`). `apps/api/src/composition.ts`
  `createPreviewDeps()` (env `PREVIEW_TOKEN_SECRET`) + `index.ts start()` mendaftarkan rute
  preview hanya bila secret diisi. `.env.example` +`PREVIEW_TOKEN_SECRET`. **Diverifikasi
  end-to-end** (HTTP inject → route → adapter → HMAC verify → render): token HMAC valid → 200
  HTML noindex ter-render, token salah → 404, revisi tak ada → 404. Gate 21/21 (adapters +6 tes).
- 🔧 **T-063 (slice publish)** Pipeline publish + rollback (EPIC-06, FR-PUB-004/005/009;
  SRS §8) — **ter-merge ke `main` (PR #…, 2026-07-09):** Port di shared
  (`ArtifactStorePort`, `DeployPort`, `DeployableFile`, `DeployTarget`, `PublishError`).
  `apps/worker/src/publish.ts`: use case murni `publishSite` (validasi Site Document → build
  statis sites-kit → simpan artifact → deploy → verifikasi HTTP 200 opsional; error berkode
  BUILD/STORE/DEPLOY/VERIFY) + `rollbackSite` (redeploy artifact tersimpan tanpa build ulang,
  FR-PUB-005). `packages/adapters/src/publish/`: `LocalArtifactStore` (+manifest utk retrieve)
  & `LocalFilesystemDeploy` (docroot per slug, deploy bersih ala rsync --delete) — analog
  dev/staging; **S3 (@aws-sdk) + rsync/SSH cPanel (ssh2) menyusul, kontrak Port sama
  (FR-PUB-009)**. worker+api kini depend sites-kit. **Diverifikasi end-to-end**: publish
  Site Document → docroot → serve HTTP → `GET / , /menu/ , /sitemap.xml , /robots.txt` semua
  **200**; rollback ok. Gate 21/21 (worker +8 tes, adapters +4). _(Adapter S3 = slice S3/PR #33;
  wiring worker BullMQ = slice BullMQ/PR #35 — lihat di bawah. Deploy cPanel SFTP+FTPS = slice
  cPanel deploy; subdomain UAPI = slice di bawah.)_
- 🔧 **T-063 (slice subdomain UAPI)** Provisioning subdomain cPanel (EPIC-06, FR-PUB-004b) —
  **PR #38, 2026-07-10:** Port `SubdomainPort` (shared/publish.ts; `ensureSubdomain`
  → `SubdomainResult{subdomain,created}`, idempoten; +kode error `SUBDOMAIN`). Adapter
  `packages/adapters/src/publish/cpanel-uapi-subdomain.ts` `createCpanelUapiSubdomain()` — panggil
  UAPI `SubDomain::addsubdomain` (header `Authorization: cpanel user:token`, panel :2083), **fetch
  di-inject** (offline-testable). Idempoten: errors "already exists" → `ok(created:false)`. **Auth:
  token cPanel ATAU Basic auth password** (fallback host tanpa menu API token, mis. Rumahweb). Gate
  21/21 (adapters +8 tes: sukses/idempoten/error/HTTP/JSON/throw/basic-auth/no-cred). **E2E ke cPanel
  Rumahweb SUKSES** (2026-07-10, Basic auth akun cPanel utama): `addsubdomain` → created:true →
  panggil ulang created:false (idempoten) → cleanup. **Temuan host**: UAPI punya `addsubdomain` tapi
  TAK punya `delsubdomain`/`list_subdomains` (hapus perlu API2 `/json-api/cpanel`) — tak masalah utk
  publish (hanya butuh buat subdomain). Wiring ke pipeline = slice di bawah.
- 🔧 **T-063 (slice wiring subdomain→pipeline)** ensureSubdomain sebelum deploy (EPIC-06,
  FR-PUB-004b) — **PR #40, 2026-07-10:** `publishSite`/`rollbackSite` (worker) memanggil
  `ensureSubdomainIfConfigured` SEBELUM `deploy`: bila `deps.subdomain` di-inject → wajib
  `input.rootDomain` (else `err SUBDOMAIN`), docroot subdomain diselaraskan dgn docroot deploy
  (`public_html/{slug}`); no-op bila subdomain tak di-inject (backward-compatible dev lokal-FS).
  `PublishDeps.subdomain?`, `PublishInput.rootDomain?`, job data `+rootDomain`. `composition.ts`
  `createSubdomain(env)` pilih `CpanelUapiSubdomain` bila `CPANEL_UAPI_HOST`+`USER`+
  (`TOKEN`|`PASSWORD`) diisi → disuntik ke `createPublishDeps`. `.env.example` +`CPANEL_UAPI_*`.
  Gate 21/21 (worker +7 tes: urutan sub→deploy, rootDomain wajib, error→tak deploy, backward-compat,
  seleksi env). **Pipeline publish kini lengkap**: build→store→**ensureSubdomain**→deploy→verify.
- 🔧 **T-063 (slice produsen job api)** POST /api/websites/:id/publish → enqueue (EPIC-06, BRU-02
  approval-first; FR-PUB-004) — **PR #41, 2026-07-10:** Port `PublishQueuePort`+`PublishJobRequest`
  +`PUBLISH_QUEUE_NAME` & `PublishSourcePort`+`PublishSource` (shared); +kode error `QUEUE`. Adapter
  `BullMqPublishQueue` (produsen; interface sempit `JobQueueClient` offline-test) +
  `createBullMqPublishQueue(connection)` (impor vendor bullmq); `PublishSourcePrisma` (**tenant-scoped**:
  verifikasi Website milik tenant DULU → ambil Revision.siteDoc; guard NFR-09). api:
  `handlePublishRequest` (BRU-02: konten dari **DB tepercaya**, BUKAN body → cegah publish
  sembarang) + `registerPublishRoutes` (x-tenant-id header, body `{revisionNumber}` zod → 202+jobId/
  401/400/404) + `createPublishRequestDeps` (env `REDIS_URL`/`PUBLISH_BASE_DOMAIN`); `buildServer`
  terima `publish` opsional (aktif bila DATABASE_URL+REDIS_URL). Dep `bullmq` di adapters. Gate 21/21
  (adapters +7, api +8). **Diverifikasi E2E produsen↔konsumen** (Redis nyata): `enqueuePublish` →
  worker consume → build → deploy → HTML ter-render. **Jalur approve→publish TERSAMBUNG penuh.**
- 🔧 **T-063 (slice hardening pipeline)** Ketahanan job publish (EPIC-06, ADR-2; NFR reliabilitas) —
  **stacked di atas #41, 2026-07-10:** (1) **Retry/backoff/retensi** — `defaultPublishJobOptions()`
  (modul murni offline-test) sbg `defaultJobOptions` di `createBullMqPublishQueue` → semua job dpt
  `attempts:3` + backoff eksponensial `delay:5000ms` (retry kegagalan transien cPanel/Redis),
  `removeOnComplete:50` (Redis ramping), `removeOnFail:true` (job final gagal **tetap tersimpan sbg
  dead-letter** utk audit); policy opsional override. (2) **Observability** — `publish-worker` inject
  logger (default console), log terstruktur satu-baris start/sukses (durasi_ms)/gagal via formatter
  murni; listener `worker.on('failed')` menandai **DEAD-LETTER** saat percobaan habis (attemptsMade≥
  attempts) → mudah di-grep/alert di stdout kontainer. Gate 21/21 (worker +5, adapters +3 tes murni).
- ✅ **Object storage = MinIO self-host DIPUTUSKAN & disediakan** (2026-07-10, ops):
  service `minio` + `minio-init` (profil compose `storage`) di `docker-compose.yml`, bucket
  `digimaestro-artifacts` otomatis, kredensial via `MINIO_ROOT_*`; `.env.example` mengarahkan
  `S3_ENDPOINT=http://minio:9000`. Data di VPS (residensi, ADR-8). **Diverifikasi**: MinIO up →
  bucket dibuat → **put/list/get object via S3 API sukses**. → sisi S3 T-063 **tak lagi
  terblokir**; tinggal adapter `@aws-sdk` (kode) + isi `S3_KEY/S3_SECRET` = `MINIO_ROOT_*`.
- 🔧 **T-063 (slice S3)** Adapter `ArtifactStorePort` di object storage S3-compatible
  (EPIC-06, FR-PUB-009) — **PR #33, 2026-07-10:** `packages/adapters/src/publish/
  s3-artifact-store.ts` `S3ArtifactStore` bergantung interface **sempit** `S3ObjectClient`
  (bukan `@aws-sdk` langsung) → offline-testable dgn fake in-memory; kontrak Port identik
  `LocalArtifactStore`. Simpan tiap file + `_manifest.json` sbg objek terpisah (key
  `/`-separator S3) → `retrieve` utuh utk rollback (FR-PUB-005); artifact rusak (objek
  hilang) → `err STORE`. `aws-s3-client.ts` `createAwsS3ObjectClient()` = **satu-satunya**
  file impor vendor SDK S3 (SOLID-D); dukung **MinIO** via `endpoint`+`forcePathStyle`
  (ADR-8), `NoSuchKey`/404 → `null`. Dep `@aws-sdk/client-s3 ^3.1083.0`. **Diverifikasi
  end-to-end melawan MinIO nyata** (jalur produksi `createAwsS3ObjectClient` →
  `S3ArtifactStore`): store 4 file + manifest → objek mendarat di bucket → retrieve utuh
  (contentType terjaga) → key absen = `null`. Gate 21/21 (adapters 57 tes, +4 S3).
- 🔧 **T-063 (slice BullMQ consumer)** Wiring worker antrean `publish` (EPIC-06, ADR-2;
  SRS §3.2) — **PR #35, 2026-07-10 (stacked di atas PR #33):** `apps/worker/src/publish-job.ts`
  `processPublishJob` (dispatch **murni** offline-testable atas union job `publish`/`rollback`
  → `publishSite`/`rollbackSite`) + `PUBLISH_QUEUE`. `publish-worker.ts` `startPublishWorker`
  (wrapper **tipis** BullMQ `Worker`; job gagal → throw agar retry). `composition.ts`
  `createPublishDeps(env)` pilih adapter dari env: **S3ArtifactStore bila `S3_KEY/S3_SECRET`
  diisi** (incl. MinIO), else `LocalArtifactStore`; deploy = lokal-FS (cPanel menyusul); verify
  = HTTP fetch (FR-PUB-004). `createRedisConnection` parse `REDIS_URL`. `runWorker()` kini
  memulai consumer + shutdown rapi (`worker.close()`). Dep `bullmq ^5.79.3` (native accel
  `msgpackr-extract` di-`false` di workspace, fallback JS). **Diverifikasi end-to-end** (Redis +
  MinIO nyata): enqueue job `publish` → consume → build → **store ke MinIO** → deploy docroot →
  verify → job completed; artifact retrievable dari S3. Gate 21/21 (worker +10 tes). **Belum**:
  produsen job di api (approve→enqueue).
- 🔧 **T-063 (slice cPanel deploy)** Adapter `DeployPort` ke shared hosting cPanel via SFTP/SSH
  (EPIC-06, FR-PUB-004/009; SRS §1.3) — **PR #36, 2026-07-10 (stacked di atas #35):**
  **transport = SFTP over SSH** (dipilih PO 2026-07-10; rsync/FTP ditolak). `packages/adapters/
  src/publish/cpanel-sftp-deploy.ts` `CpanelSftpDeploy` — orkestrasi **murni** atas interface
  **sempit** `SftpDeployClient` (offline-testable); **deploy bersih** ala rsync --delete (upload
  rilis baru + hapus file usang, incl. nested); docroot per subdomain via template
  `public_html/{slug}` (atau `target.docroot`); URL = `https://<slug>.<baseDomain>`; gagal →
  `err DEPLOY` + tutup koneksi. `ssh2-sftp-client.ts` `createSsh2SftpDeployClient()` =
  **satu-satunya** file impor vendor SDK SFTP (SOLID-D); auth password/private-key; list rekursif.
  Dep `ssh2-sftp-client ^12.1.1` (+`@types`), native `ssh2`/`cpu-features` di-`false` (crypto Node
  murni). `apps/worker/src/composition.ts createDeploy()` pilih cPanel bila `CPANEL_SFTP_HOST`+
  `USER` diisi (key via `CPANEL_SFTP_KEY_PATH`), else lokal-FS. `.env.example` +`CPANEL_SFTP_*`.
  Gate 21/21 (adapters +4, worker +1). **E2E SFTP tertunda**: host PO (Rumahweb (host di catatan lokal))
  **tak mengekspos SSH/SFTP** (port 22 & alternatif tertutup; hanya 2083 cPanel + 21 FTP terbuka)
  → adapter SFTP valid utk host SSH lain, tapi tak bisa E2E ke host ini. **Belum**: subdomain
  cPanel UAPI (FR-PUB-004b) + produsen job api.
- 🔧 **T-063 (slice cPanel deploy FTP/FTPS)** Fallback deploy utk host tanpa SSH (EPIC-06,
  FR-PUB-004/009; SRS §1.3 "fallback FTP") — **PR #37, 2026-07-10 (stacked di atas #36):**
  temuan: host shared PO (Rumahweb) hanya buka FTP(21)+cPanel(2083), SSH tertutup → **FTPS dipilih
  PO 2026-07-10**. Orkestrasi deploy **diekstrak** ke `remote-deploy.ts` (`deployToRemote` +
  `RemoteDeployClient`, dipakai bersama SFTP & FTP — DRY). `cpanel-ftp-deploy.ts` `CpanelFtpDeploy`
  (impl `DeployPort` via orkestrasi bersama). `basic-ftp-client.ts` `createBasicFtpDeployClient()`
  = **satu-satunya** impor vendor FTP (SOLID-D); **FTPS eksplisit** (AUTH TLS) default, path
  absolut (bebas CWD), list rekursif, `rejectUnauthorized` konfigurasi. Dep `basic-ftp ^6.0.1`.
  `createDeploy()` prioritas: SFTP → FTP (`CPANEL_FTP_HOST`) → lokal-FS. `.env.example`
  +`CPANEL_FTP_*`. **E2E ke Rumahweb SUKSES** (2026-07-10, FTPS+TLS verified, akun FTP
  akun FTP khusus (casing username penting)): deploy v1 (3 file) → v2 (1 file) →
  listing akhir hanya `index.html` (robots.txt **&** dir `sub/` terhapus). **Bug ditemukan E2E &
  diperbaiki**: clean-delete tak menghapus direktori yang jadi kosong → tambah `removeDir` ke
  `RemoteDeployClient` + orkestrasi hapus **direktori usang** (mirror penuh, terdalam dulu);
  impl `sftp.rmdir(_,true)` & `ftp.removeDir`. Gate 21/21 (adapters +2 FTP incl. assert removeDir,
  worker +2). **Belum**: subdomain cPanel UAPI (FR-PUB-004b) + produsen job api.
### EPIC-03 — KANAL (CHN): Telegram AKTIF (rencana A Fase 0); WABA menyusul

> **Koreksi status:** EPIC-03 **tidak lagi terblokir**. Yang terblokir T-001 hanya
> **WABA/WhatsApp**; kanal Telegram (ADR-11) sudah jalan penuh & dipakai PO sungguhan.

- ✅ **T-020extA** Onboarding otomatis — buat Website saat `build_site` (**PR #51**,
  `4e5855d`, 2026-07-11). Tenant baru belum punya Website → `build_site` gagal `NOT_FOUND`
  → loop chat→bangun mentok. Kini Website (DRAFTING) dibuat on-demand dari nama usaha
  (`deriveSlug` kebab-case + sufiks acak; `slug` @unique global). `WebsiteRepository.create`
  (port+Prisma); P2002 → `CONFLICT` (BRU-01 satu website/tenant).
- ✅ **T-030tg** **Kanal Telegram inbound+outbound** (**PR #52**, `ea2dc3e`, 2026-07-11;
  ADR-11/12). Port `ChannelPort` + `ChatInboundQueuePort` (shared). Adapter: `TelegramChannel`
  (Bot API via `fetch`, **tanpa SDK**), `normalize` (payload → `InboundChannelMessage`),
  `allowlist` (`chat_id→tenant`), `BullMqChatInboundQueue`. Rute webhook
  `/api/webhooks/telegram` (secret token, **timing-safe**). Use case `handleInboundMessage`
  (core). Worker: konsumen antrean `chat-inbound`. **Idempotensi** = `Message.providerMsgId`
  @unique (P2002 → CONFLICT → duplikat diabaikan); `providerMsgId` diprefiks `chat_id` karena
  `message_id` Telegram hanya unik per-chat. Schema: `Channel += TELEGRAM`,
  `Conversation.externalId` + `@@unique(tenantId, channel, externalId)`. Migrasi diuji di
  Postgres 16 nyata (bukan hanya CI). _Refactor:_ `build-site-tool` dipindah `apps/api` → `core`
  (dipakai DUA composition root).
- ✅ **T-031tg** **Tombol interaktif approval** "✅ Setuju & publish" dari chat (**PR #53**,
  `d0607d8`, 2026-07-11; BRU-02). `ChannelButton` + `sendButtons` + `answerCallback` (wajib —
  tanpa itu tombol berputar terus di UI). `channel-actions.ts`: aksi tertutup `<verb>:<arg>`
  (`pub`/`rev`) — **`callback_data` = input TAK tepercaya** (bisa dikarang) → diparse ketat,
  argumennya TETAP divalidasi ke DB tenant via `PublishSourcePort`. `websiteId` sengaja tak ikut
  (BRU-01 → tombol tak bisa menunjuk website tenant lain). **Dobel-tap tidak publish 2×**
  (`providerMsgId` = id callback query, @unique). Tombol muncul saat giliran itu MENGHASILKAN
  revisi baru (deteksi via NOMOR REVISI, bukan menebak teks LLM). `RateLimitedChannel`
  (dekorator, jendela geser per chat = per tenant; `answerCallback` sengaja TIDAK dibatasi).
  _Refactor:_ `handle-publish` dipindah `apps/api` → `core`.
- ✅ **T-032tg** **Notifikasi "situs sudah live"** ke chat (**PR #54**, `1d899c8`, 2026-07-11) —
  menutup lingkaran approval. `PublishJobRequest.tenantId` (worker perlu tahu mengabari siapa;
  OPSIONAL di worker → job lama tanpa tenantId dilewati, bukan crash). `ConversationFilter.channel`.
  Use case `notifyPublishOutcome`. **Kegagalan hanya dikabari saat DEAD-LETTER** (retry habis) —
  kegagalan transien tak boleh bikin pengguna panik. **Kegagalan MENGABARI tidak pernah
  menggagalkan job yang sudah sukses** (throw = BullMQ retry → deploy ulang percuma).
- ✅ **T-030tg-poll** **Long-polling `getUpdates`** (**PR #55**, `03c70b2`, 2026-07-11) —
  `TELEGRAM_MODE=polling`. **Alasan keras:** webhook menuntut HTTPS publik; VPS tak punya domain
  (§1.3) → Telegram TIDAK BISA memanggil kita. Polling membalik arah. Jalur sesudah update diambil
  SAMA PERSIS dgn webhook (normalisasi→allowlist→antrean) → tak ada cabang logika kedua. Offset
  tetap maju untuk update yang diabaikan (kalau tidak → dikirim ulang selamanya); gagal enqueue →
  offset DITAHAN (pesan pengguna tak boleh hilang). Webhook tetap ada utk produksi.
- ✅ **T-033** **Media ingest** — foto pelanggan → WebP → hosting → galeri situs (**PR #60**,
  `5462f1e`, 2026-07-11; FR-MED-001/002). Port `MediaDownloadPort`/`MediaProcessorPort`/
  `MediaStorePort`/`MediaRepository`. Adapter: `TelegramMediaDownload` (getFile; tolak file
  kelewat besar SEBELUM mengunduh), `SharpMediaProcessor` (resize ≤1600 + EXIF-rotate +
  WebP q80; file rusak → err, bukan crash), `FtpsMediaStore` (nama file content-addressed
  sha256 → foto identik = nama sama, URL stabil), `MediaRepositoryPrisma`. Model `MediaAsset`
  + migrasi (`@@unique(tenantId, providerFileId)` → dedup). Foto di chat **tidak memanggil LLM**.
  URL foto disisipkan ke prompt build ("gunakan HANYA url ini") → galeri memakai foto NYATA.
  **Terverifikasi nyata:** 4000×3000 JPEG → 1600×1200 WebP (**hemat 95%**), tampil di situs live.
  _Dep baru:_ `sharp` (disetujui PO; diverifikasi jalan di dalam container Docker).
  _Bug renderer ikut ditutup:_ `imageRefSchema` kini menerima `url` absolut — sebelumnya hanya
  `assetId` → URL foto ter-encode ganda (`%2F`) → `<img>` 404 (TODO lama "resolusi objek-storage
  menyusul" akhirnya tuntas).
- ⏳ **WABA (T-030..033 versi WhatsApp)** — tetap menunggu **T-001**. Bukan blocker Fase 0:
  masuk belakangan sebagai adapter `ChannelPort` (ADR-11), core tak berubah.

### Publish & URL (lanjutan T-063)
- ✅ **ADR-13 — mode URL `path`** (**PR #59**, `b0d6b0a`, 2026-07-11). `publicSiteUrl(slug,
  domain, mode)` + `parsePublishUrlMode` di shared = **SATU sumber kebenaran** bentuk URL,
  dipakai produsen job (core) DAN adapter deploy — sebelumnya URL disusun di dua tempat; kalau
  menyimpang, publish SUKSES pun dilaporkan gagal (URL dijanjikan ≠ URL diverifikasi).
  `urlMode` ikut di payload job. Default tetap `subdomain`; env tak dikenal → `subdomain`.
- ✅ **fix: verifikasi HTTP harus SABAR** (**PR #58**, `cc21dd3`, 2026-07-11). `verify` dulu
  menembak SEKALI → subdomain baru (DNS + AutoSSL belum siap) dilaporkan GAGAL padahal situs
  terbit → retry 3× (build+upload ulang, mahal) → dead-letter → **notifikasi "gagal" yang KELIRU**.
  Kini retry 6× × 15 dtk (±75 dtk); error TLS/DNS = "belum siap", bukan kegagalan final.

### Perbaikan agent (semua ditemukan saat bot DIPAKAI SUNGGUHAN — bukan dari tes)
> Delapan bug di bawah **tidak satu pun** terdeteksi test suite yang hijau. Ini alasan
> menjalankan produknya lebih berharga daripada menambah tes.

- ✅ **fix: tiga bug yang bikin bot tak bisa bangun situs** (**PR #56**, `c10313b`, 2026-07-11):
  (1) **Agent amnesia** — `ConversationReplier` tak pernah memuat riwayat (`agent-loop` mendukung
  `history`, tak ada yang mengisi) → pengguna sebut nama usaha di pesan #1, di pesan #2 agent
  tanya lagi → wawancara slot-filling (FR-CNV-003) TAK PERNAH selesai. Tes lama tak menangkapnya
  karena tiap tes cuma kirim SATU pesan. (2) **Prompt vs schema bertabrakan** — `siteDocumentSchema`
  UTUH dipakai sbg target output LLM, padahal model tak mungkin tahu `websiteId` (id DB kita) dan
  `tokens` harus deterministik dari tema (FR-CMP-003) → validasi SELALU gagal. Kini `siteDraftSchema`
  (title/themeId/pages) + `assembleSiteDocument()` menyuntik websiteId + token. (3) **Prompt
  menyuruh nilai tak sah** — contoh `variant:"default"` tak sah utk type mana pun → prompt kini
  menyisipkan katalog `type→variant` dari registry + **JSON Schema draft** (`z.toJSONSchema`).
- ✅ **fix: markup tool-call bocor + timeout build + default model** (**PR #57**, `6dfaf62`,
  2026-07-11): pengguna menerima markup mentah `<｜｜DSML｜｜tool_calls>…`. **Akar:** agent-loop
  mematikan tools di langkah terakhir TAPI system prompt masih menyuruh memanggil tool → model
  kehilangan saluran protokol → MENULIS pemanggilan tool ke teks. Diperbaiki 2 lapis:
  `NO_TOOLS_INSTRUCTION` (akar) + `stripToolMarkup` di adapter (jaring pengaman; balasan yang
  isinya HANYA markup → err → fallback sopan). Terbukti: dgn `tools` DIKIRIM, v4-flash & v4-pro
  dua-duanya BENAR → ganti model bukan obatnya. **`BUILD_LLM_TIMEOUT_MS`=180 dtk** (composition
  tak pernah kirim `timeoutMs` → selalu 30 dtk → build situs SELALU timeout). Default model →
  **`deepseek-v4-pro`**.
- ✅ **fix: wawancara mati di tengah — state diabaikan + balasan kosong** (**PR #61**, `e993e80`,
  2026-07-11): pelanggan menjawab singkat ("Betul", "Cara 2 saja") → router keyword tak mengenali
  → `FALLBACK` → prompt "TOLAK permintaan di luar lingkup" + `scopes:[]` (agent kehilangan SEMUA
  tool) → model bingung → **teks kosong** → Telegram menolak → pengguna ditinggal BISU. **Router
  sebenarnya sudah menghitung state dengan benar**; replier membuangnya (mengoper `'ONBOARDING'`
  HARDCODED) & `composeAgentPlan` mengabaikan parameternya (`_state`) → state tak pernah
  berpengaruh. Kini `FALLBACK` saat percakapan AKTIF → lanjutkan konteks & pertahankan tool;
  prompt penolakan hanya saat IDLE (FR-CNV-008). Plus: teks kosong TAK PERNAH dikirim ke kanal.
- ✅ **fix: anggaran token habis untuk REASONING** (**PR #62**, `82a0776`, 2026-07-11) — **akar
  sebenarnya** dari "model membalas teks kosong". `deepseek-v4-pro` adalah **model REASONING**:
  ia memakai token untuk *berpikir* DULU. Diukur langsung ke API: `max_tokens=512` → finish
  `length`, **content 0 char**, reasoning 1912 char; `2048` → content 610 char. Anggaran kita
  (peninggalan model non-reasoning) habis sebelum model sempat menulis. Gejalanya **acak**
  (tergantung panjang perenungan) → tampak seperti bug hantu. `DEFAULT_AGENT_MAX_TOKENS` 512→2048;
  interview 2048, revision 2560, status/fallback 1536. Adapter kini menyebut sebabnya
  ("anggaran token habis untuk reasoning") — "teks kosong" saja menyesatkan.

### Audit kanal Telegram (2026-07-11) — temuan & perbaikan
- ✅ **P0** (**PR #65**): (1) **Tidak ada timeout** di poller & unduhan media → `fetch` menggantung
  sampai default undici (**±5 menit**) bila koneksi stall → bot **BERHENTI menerima pesan tanpa
  error/log**, container tetap "sehat" (pola bug yang SAMA dgn worker-stub). → `AbortSignal.timeout`
  eksplisit. (2) **Rate limit TIDAK melindungi anggaran LLM** — `RateLimitedChannel` hanya membungkus
  pesan KELUAR, sedangkan LLM dipanggil LEBIH DULU → tenant terdaftar yang membanjiri 100 pesan =
  100 panggilan `deepseek-v4-pro`. Allowlist (ADR-12) hanya menahan ORANG ASING. → `InboundRateLimiterPort`
  + `RedisInboundRateLimiter`, ditegakkan **sebelum** LLM/media disentuh (15 pesan/60 dtk per tenant).
  State di **Redis** (bukan memori proses) → benar juga saat worker >1 replika. Tanpa dep baru
  (klien Redis dari `Queue.client` BullMQ). Peringatan dikirim **sekali per jendela** (kalau tiap
  pesan spam dibalas, kita ikut membanjiri pengguna). Tombol sengaja tak dibatasi (idempoten).
- ✅ **P1** (**PR #66**): (1) **`answerCallback` dijawab terlambat** — dipanggil SETELAH DB+Redis;
  Telegram membatalkan callback >10 dtk → **tombol berputar meski publish BERHASIL**. → ACK segera.
  (2) **Tidak ada kuota media** → satu tenant bisa memenuhi kuota hosting SHARED (dipakai semua situs
  klien). → `MEDIA_MAX_PER_TENANT`=50, dicek SEBELUM unduh; error `QUOTA` + balasan yang menyebut sebab.
  (3) **Rate limit keluar** dipindah ke Redis (memori proses → N×limit saat >1 replika → 429 Telegram).
- ⏳ **P2 (butuh PO, non-kode):** `can_join_groups` masih aktif → matikan di BotFather
  (`/setjoingroups` → Disable). Chat grup sudah ditolak allowlist, tapi permukaan tak perlu.
- ✅ **Terverifikasi aman** (audit jujur dua arah): token bot **tak pernah bocor ke log** (0 kemunculan);
  webhook **fail-closed** (tanpa secret → rute tak dipasang, terbukti 404 di live); allowlist fail-closed;
  idempotensi bertumpu constraint DB; `callback_data` divalidasi ketat; TLS diverifikasi penuh.

### Jalan menuju "siap dijual" (setelah gerbang Fase 0) — lihat peta jalan §7
- ✅ **T-002auth-ws** Auth WebSocket (**PR #67**, `b7be2d6`, 2026-07-11; NFR-07). **LUBANG
  KEAMANAN NYATA yang ditutup:** rute WS `/api/chat` menerima `?tenantId=` MENTAH → siapa pun
  yang menjangkau API bisa MEMBACA & MENULIS chat tenant lain. REST sudah tegak sejak
  T-002auth-wiring; WS tertinggal. Tak tereksploitasi hanya karena port di-bind ke Tailscale —
  bukan karena kodenya aman; begitu API dibuka publik (WAJIB untuk WABA) langsung terbuka.
  Browser tak bisa kirim header `Authorization` di WS → token lewat query, diverifikasi SAMA
  KETATNYA. Token invalid TIDAK jatuh ke `?tenantId=` (kalau jatuh, token palsu bisa di-bypass
  dgn menambah ?tenantId=<korban>). Mode dev tak berubah.
- ✅ **T-082** Laporan biaya AI per tenant (**PR #68**, `a734ded`, 2026-07-11) + **DUA BUG
  PENCATATAN**: (1) biaya SELALU $0 — JSON adapter `inputTokenCostPer1M ?? 0`, composition tak
  pernah mengisinya → 123.790 token tercatat $0.0000; (2) **chat TIDAK TERCATAT SAMA SEKALI** —
  agent adapter mendukung usageLogger tapi TAK PERNAH disuntik → hanya `site_plan` punya baris;
  percakapan (MAYORITAS pemakaian) nol. Harga TIDAK di-hardcode (berubah & beda per model;
  salah menebak = laporan menyesatkan) → dari env; 0 = "belum dikonfigurasi", DITANDAI. Biaya
  dihitung dari TOKEN × harga terkini, bukan kolom `cost` historis → menyelamatkan data lama.
  `GET /api/usage` (tenant sendiri, dari TOKEN) & `GET /api/admin/usage` (lintas tenant; DUA
  syarat: ADMIN_TENANT_ID + role OWNER; tanpa env → rute tak dipasang; ditolak → 404 bukan 403).
- ✅ **T-073** Backup Postgres + runbook restore TERUJI (**PR #69**, `eaaa67c`, 2026-07-11).
  Sebelumnya **NOL backup** — VPS/disk hilang = SEMUA tenant/situs/percakapan/foto hilang
  permanen. Dua lapis: dump lokal harian (retensi 14 hr) + off-site TERENKRIPSI ke cPanel.
  **Off-site WAJIB AES-256** karena akun FTP di-chroot ke DOCUMENT ROOT → apa pun yang diunggah
  BISA DIAKSES PUBLIK; dump mentah di sana = membocorkan seluruh data pelanggan. Script mencegah
  KEGAGALAN DIAM-DIAM: dump <1KB → gagal keras; dump diverifikasi TERBACA `pg_restore --list`;
  restore default ke DB UJI; menimpa produksi butuh `CONFIRM=SAYA-YAKIN`; restore memverifikasi
  ISI (jumlah baris). **Bukti uji:** restore → Tenant 2 · Website 2 · Revision 10 · Message 104 ·
  MediaAsset 1 · LlmUsage 57 = IDENTIK produksi. **Cron harian 02:00 WIB terpasang & terverifikasi**
  (wrapper sempat tak executable → akan gagal DIAM-DIAM tiap malam; ketahuan karena diuji).
- ✅ **T-070** Alert operasional (**PR #70**, 2026-07-12; ADR-7). Kegagalan selama ini HANYA masuk
  log → tak seorang pun tahu. Tiga alert (dipilih krn BERDAMPAK KE PELANGGAN): **bot tak menerima
  pesan** (poller gagal beruntun — CRITICAL; pelanggan mengirim ke ruang hampa & container tetap
  "sehat"), **publish dead-letter**, **pesan pelanggan gagal diproses**. **Telegram = jalur UTAMA,
  bukan n8n**: alert yang bergantung pada komponen yang bisa IKUT TUMBANG bukan alert; Telegram
  hidup di LUAR infrastruktur kita. `WebhookAlert` tetap ada (ADR-7 dihormati). **PEREDAM wajib**:
  tanpa throttle, LLM tumbang → 100 notifikasi → PO mematikan alert → alert yang dimatikan = TIDAK
  ADA ALERT. 1 notifikasi/masalah/15 mnt (Redis SET NX); Redis mati → alert TETAP dikirim.

- ✅ **T-080** Utang integration test dibayar (**PR #73**, 2026-07-12): test integrasi kini
  jalan saat `DATABASE_URL` ada; guard anti-silent-skip; `turbo.json` meneruskan env (tanpa ini
  CI "hijau" BOHONG — test selalu skip). Backup off-site Google Drive via rclone (**PR #72**).
- ✅ **Self-serve onboarding + kuota trial** (**PR #74**, 2026-07-12/14): kode undangan
  (`InviteCode`, penukaran ATOMIK), `ChannelBinding` chat→tenant (menggantikan allowlist env),
  kuota 100 pesan · 1 situs · 14 hari (keputusan PO), gerbang kuota SEBELUM LLM. **Terbukti di
  produksi 2026-07-14**: PO mendaftar sendiri via `DIGIMAESTRO2026` → tenant "Darusman" TRIALING
  → wawancara → situs **Sewabos** live — tanpa satu pun sentuhan SQL/env.
- ✅ **P0 INSIDEN worker beku** (**PR #75**, 2026-07-14): dua job chat-inbound macet SELAMANYA
  di `active` → worker (concurrency 2) BEKU TOTAL tanpa alert. **Akar:** koneksi Redis BullMQ
  `maxRetriesPerRequest: null` → saat Redis tak terjangkau perintah MENGANTRE tanpa reject →
  `await` di rate-limiter (jalur balasan keluar) menggantung selamanya; catch fail-open tak
  pernah menyala (hanya menangkap reject, bukan promise yang tak selesai). **Perbaikan 2 lapis:**
  deadline 2 dtk semua operasi Redis jalur pesan (`withDeadline`) + batas waktu keras per job
  (`CHAT_JOB_TIMEOUT_MS`, default 5 mnt) → hang sebab APA PUN = job gagal = retry + alert T-070.
- ✅ **fix output terpotong + biaya $0** (**PR #76**, 2026-07-14, ditemukan dari pemakaian
  nyata): (1) `maxTokens` 4096 memotong dokumen situs 6 halaman PERSIS di batas → 3× retry
  semua terpotong → "gangguan teknis" + token terbakar sia-sia → dinaikkan 8192 (interim; desain
  "LLM tulis ulang SELURUH dokumen" digantikan pengisian slot template, lihat §7 revisi); (2)
  adapter JSON tak disuntik `price` → `site_plan` tercatat $0.0000 → dashboard T-082 mencatat
  LEBIH KECIL dari belanja nyata → `tokenPrice(env)` disuntik di kedua composition.
- ✅ **P1 pengerasan produksi** (**PR #77**, 2026-07-14): log terstruktur pino di API (redaksi
  `authorization`/`cookie`); **`/readyz`** (probe DB+Redis berdeadline 2 dtk — kontainer "hidup
  tapi buta DB" tak boleh dianggap sehat, pola insiden worker-stub) — healthcheck compose deploy
  diarahkan ke `/readyz`; graceful shutdown API (SIGTERM → `app.close()`; worker sudah punya).
  **Ditunda sadar:** metrics Prometheus — alert T-070 + pino + failed-count BullMQ = anggaran
  observability v1 untuk operasi 1 orang.
- ✅ **P2–P4 ARAH BARU: engine template Mobirise** (**PR #78, #81, #80**, 2026-07-14; lihat
  peta jalan §7 revisi). Vendor `block-engine` editor-web → `packages/engine-mobirise`
  (SHA di `VENDORED.md`, `ops/sync-block-engine.sh`, 25 test vendored ikut CI); skema dokumen
  BERSAMA dgn editor-web; migrasi dual-mode `Revision.renderEngine` (aditif — situs
  sections-v1 live tak tersentuh); registry template (`TEMPLATES_DIR` mount ro dari folder
  editor-web + `template.json` + indexer + `TemplateCatalogPort`); AI pilih template
  (shortlist→enum ketat) + isi slot (sanitasi URL gambar) → Revision `mobirise-v1`, di balik
  `SITE_ENGINE` (default legacy). **Terindeks 6 template nyata** di produksi.
- ✅ **fix hasil UJI NYATA jalur template** (**PR #82, #83**, 2026-07-14): halaman template
  nyata 112–152 slot → `slot_fill` satu panggilan MEMOTONG output; 40 slot @4096 MASIH
  terpotong (jatah termakan REASONING v4-pro — pola insiden "balasan kosong"). Kini kelompok
  25 slot @8192, isian digabung. Dua-duanya mustahil ketahuan dari unit test hijau — hanya
  dari menjalankan produk nyata (pelajaran T-083 terulang persis).

- ✅ **P5 sisi glm2 — gerbang review PO** (**PR #85**, 2026-07-14): aturan O(1)
  `revision.templateId !== website.approvedTemplateId` → `PENDING_ADMIN_REVIEW` + handoff
  ke editor-web (`X-Service-Token`, fail-soft ber-alert + endpoint picu-ulang) + rute balik
  `POST /api/internal/review/complete` (timing-safe token + korelasi websiteId/revisionId/
  editorProjectId — panggilan palsu tak bisa memajukan situs orang lain). Dokumen HASIL EDIT
  PO dibekukan sebagai revisi baru (`createdBy: 'admin-review'`), pelanggan tetap gerbang
  akhir. Inert sampai `REVIEW_GATE=1`; sisi editor-web menyusul (WIP PO di repo itu).

- ✅ **P6 — gambar stok Unsplash+Pexels** (**PR #86**, 2026-07-15): slot gambar tanpa foto
  pelanggan → LLM menulis isian `{kind:'stock', query(bhs Inggris), alt}` → `resolveSlotImages`
  menukarnya SEBELUM materialize: search (Unsplash→Pexels fallback; kueri sama dicari sekali,
  kursor mencegah foto kembar) → download → Sharp WebP → rehost FTPS → `MediaAsset` +
  atribusi (kolom `sourceProvider/sourceUrl/authorName/authorUrl` dari migrasi P2; syarat
  lisensi — JANGAN hotlink; Unsplash `download_location` di-GET saat foto dipakai).
  Fail-soft total: kegagalan apa pun → slot `keep`, build tak pernah gagal karena gambar.
  Pagar biaya: maks 12 foto stok/build + kuota media tenant (Unsplash demo = 50 req/jam).
  Temuan: indeks kata kunci Indonesia SANGAT tipis ("bengkel motor" = 1 hasil Unsplash;
  "motorcycle repair workshop" = ratusan) → prompt mewajibkan kueri Inggris, alt tetap ID.

- ✅ **fix INSIDEN alamat slot bertabrakan** (**PR #87**, 2026-07-15, temuan UJI NYATA lagi):
  E2E P6 pertama = 0 foto stok padahal probe membuktikan LLM menulis isian stock dengan
  benar. Akar: `annotateEditable` memberi `data-edit-id` PER BLOK (tiap blok mulai lagi
  dari e0) → id bertabrakan antar blok; isian stock slot image ter-lookup ke slot text
  blok lain (dibuang sanitizer), dan satu isian bisa tertulis ke SEMUA blok ber-id sama.
  Fix: alamat komposit `b<blockIndex>:<editId>` (unik se-halaman) + applyPageFills
  mengunci isian ke satu blok. E2E ulang: **11 foto stok** ter-rehost + atribusi + HTTP
  200 publik. **Cutover `SITE_ENGINE=mobirise-v1` LIVE 2026-07-15 (opsi 2 PO).**

- ✅ **P5 sisi editor-web** (repo editor-web, merge `feat/handoff-glm2` 2026-07-15):
  `POST /internal/handoff` (service token timing-safe, fail-closed tanpa env; proyek
  milik akun PO + korelasi `Project.handoff Json` + snapshot "versi asli AI") +
  `POST /projects/:id/send-to-customer` (cookie-JWT; meneruskan dokumen HASIL EDIT ke
  returnUrl glm2; alasan penolakan glm2 diteruskan) + tombol UI "Kirim ke pelanggan"
  (hanya proyek handoff) + deep-link `?project=<id>` + 7 test integrasi. **E2E jalur
  balik LULUS di VPS**: handoff → proyek → send-to-customer → glm2 membuat revisi
  `admin-review` + set `approvedTemplateId`. SISA: (1) rule iptables
  `172.19.0.0/16 → tcp 5181` (kontainer glm2 → API editor di host; INPUT DROP) —
  butuh persetujuan PO; (2) `REVIEW_GATE=1` — keputusan PO kapan menyala.

### Gerbang keluar Fase 0
- ✅ **T-083 — DEMO E2E TERCAPAI** (2026-07-11, produksi nyata, tanpa intervensi manual):
  **chat Telegram → wawancara (agent ingat konteks) → agent bangun situs → tombol approval →
  tap "Setuju & publish" → job antrean → deploy FTPS → verify HTTP 200 → notifikasi "sudah LIVE"
  ke chat.** Situs live: **https://digimaestro.id/sate-pak-dar-pap917/** (+ foto pelanggan di
  galeri, WebP). Bot: **@Opencode1993_bot**.

- ⏳ Sisanya: **WABA** (T-030..033 WA, menunggu T-001); ops (T-070 alert n8n, T-071 Umami,
  T-072 Xendit sandbox, T-073 backup); QA (T-081 regresi visual, T-082 dashboard biaya AI);
  T-080 integration test (**UTANG:** selalu skip + cleanup kena tenant-guard, lihat entri T-080slice).
  _Subdomain cPanel UAPI: kode ADA & teruji, sengaja TIDAK dipakai (ADR-13)._

---

## 3. Keputusan Tertunda / Pertanyaan Terbuka
- **Default LLM produksi** — **DeepSeek**, model **`deepseek-v4-pro`** (PO 2026-07-11;
  konstanta `DEFAULT_DEEPSEEK_MODEL` di shared = satu sumber kebenaran). Alias lama
  `deepseek-chat` kini me-resolve ke `deepseek-v4-flash`; varian tersedia: `v4-flash`, `v4-pro`.
  **PENTING — v4-pro adalah model REASONING**: ia memakai token untuk berpikir DULU, jadi
  `maxTokens` kecil → `content` KOSONG (terukur: 512 → 0 char jawaban, 1912 char reasoning).
  **Jangan pernah set `maxTokens` < ~1536** untuk balasan chat (lihat PR #62). Build situs
  butuh `BUILD_LLM_TIMEOUT_MS`=180 dtk (30 dtk default selalu timeout).
  GLM 5.2 **belum** dibandingkan (butuh `GLM_API_KEY`). _Env `DIGIMAESTRO_LLM_PROVIDER=deepseek`._
- **Bentuk URL situs klien** — **SELESAI: path** (ADR-13, PO 2026-07-11). Bukan lagi pertanyaan
  terbuka. Mode subdomain tetap ada di kode bila arah berubah.
- **Auto-provision tenant dari chat** — **TERTUNDA (sadar)**. Fase 0 memakai allowlist (ADR-12).
  Bila self-serve dibuka: wajib disertai kuota/rate-limit per tenant baru, kalau tidak siapa pun
  di internet bisa membakar anggaran LLM.
- **Harga paket & kuota job AI** — finalisasi sebelum Fase 1 (input: COGS dari Fase 0).
- **Kebijakan trial** — preview-gratis-lalu-bayar vs bayar-depan (rekomendasi: preview gratis).
- **Provider image generation & stock photo** — dievaluasi Fase 0 (DeepSeek tak punya image-gen).
- **Shared hosting deploy transport** — **SFTP DIPILIH** utk host ber-SSH; **FTPS = fallback aktif**
  utk host tanpa SSH (PO 2026-07-10). Temuan: host shared PO (Rumahweb (host di catatan lokal)) **tak buka
  SSH** (hanya FTP 21 + cPanel 2083) → dipakai `CpanelFtpDeploy` (FTPS). Adapter SFTP tetap ada utk
  host lain. **E2E FTP SUKSES** ke Rumahweb (akun FTP khusus, FTPS+TLS verified) —
  deploy + clean-delete mirror penuh terbukti; bug hapus-direktori-usang ditemukan E2E & diperbaiki.

---

## 4. Risiko Aktif (ringkas, rinci di BRD §9)
- RSK-01 Verifikasi WABA lambat → web chat sbg kanal cadangan penuh.
- RSK-09 Satu akun shared hosting = SPOF → DeployPort bisa pindah target; backup
  artifact di object storage.
- AI biaya membengkak → kuota per paket + monitoring (RSK-02).
- Kode AI melanggar arsitektur → **AGENTS.md + lint boundary + review tiap PR**.

---

## 5. Environment & Secrets (status, BUKAN nilai)
- `TESTSPRITE_API_KEY`: ✅ **valid (dirotasi ulang 2026-07-04)**. Riwayat rotasi:
  `03w3e...` (invalid) → `gvm7n...` → `lgWuS15...` (key valid terbaru, account
  `daruzboy`). Diset di **User env** `TESTSPRITE_API_KEY` + **secret repo**
  `TESTSPRITE_API_KEY` (CI qa-gate), keduanya sudah sinkron ke key terbaru.
  `opencode.json` memakai referensi `{env:TESTSPRITE_API_KEY}` (key TIDAK
  ditulis ke file ter-track — repo public). **Catatan startup MCP:** MCP server
  di-spawn saat opencode start & men-resolve `{env:...}` saat itu; bila sesi
  berjalan melaporkan "No API Key" (mis. env dirotasi setelah startup), **wajib
  restart opencode** agar 8 tool MCP ter-load dgn env baru (load hanya saat
  startup; tidak hot-reload).
- `DEEPSEEK_API_KEY`: ✅ **terpasang di deploy live** (`/opt/containers/glm2/.env`, di luar repo).
  ⚠️ Key diberikan PO **via chat (plaintext → TER-EKSPOS, WAJIB DIROTASI)** — 2026-07-09 & lagi
  2026-07-11. **Belum** diset sebagai secret repo/CI. Rotasi lalu perbarui `.env` deploy.
- `GLM_API_KEY`: ⏳ belum diisi (perbandingan GLM T-050 menunggu).
- **Telegram (kanal Fase 0, ADR-11/12):**
  - `TELEGRAM_BOT_TOKEN`: ✅ terpasang di deploy live. Bot **@Opencode1993_bot** (produk;
    BERBEDA dari bot ops @vps_boy_1993_bot). ⚠️ token diberikan PO via chat → **ter-ekspos,
    rotasi disarankan**. Pemegang token bisa menyamar jadi bot.
  - `TELEGRAM_MODE=polling`: ✅ (webhook mustahil — VPS tanpa domain publik, §1.3).
  - `TELEGRAM_ALLOWLIST`: ✅ `chat_id:tenantId`. Kosong → SEMUA chat ditolak (aman by default).
  - `TELEGRAM_WEBHOOK_SECRET`: ⏳ tak dipakai selama mode polling. Bila webhook diaktifkan:
    tanpa secret, rute webhook **tidak dipasang sama sekali**.
- **cPanel / hosting situs:** ✅ **FTPS terpasang di deploy live** (Rumahweb). Dua jebakan yang
  memakan waktu (didokumentasikan di `.env.example`): (1) `CPANEL_FTP_HOST` wajib **NAMA SERVER**
  (`cikapundung.iixcp.rumahweb.net`), BUKAN `digimaestro.id` — sertifikat TLS atas nama server;
  **jangan** disiasati `REJECT_UNAUTHORIZED=false` (itu mengirim password lewat koneksi tak
  terverifikasi). (2) `CPANEL_DOCROOT_TEMPLATE={slug}` — akun di-chroot ke docroot; template
  `public_html/{slug}` akan mendarat di `public_html/public_html/…`. Casing user `Deploy@…` penting.
  ⚠️ password FTP & cPanel diberikan PO via chat → **ter-ekspos, rotasi disarankan**.
  `CPANEL_UAPI_*`: **sengaja TIDAK disimpan** (ADR-13 → tak dipakai; tak ada rahasia menganggur).
- `PUBLISH_URL_MODE=path` (ADR-13) · `PUBLIC_API_URL` (tautan preview) · `PREVIEW_TOKEN_SECRET` ✅
  · `CHANNEL_RATE_LIMIT`/`CHANNEL_RATE_WINDOW_MS` (default 20/60dtk; **state per-proses** → dengan
  >1 replika worker batas efektif = N×limit. Cukup Fase 0 (1 worker); skala horizontal → ganti
  token bucket Redis, kontrak tak berubah).
- **Deploy live** (`/opt/containers/glm2/`, BUKAN di repo): `glm2-api`, `glm2-worker`, `glm2-redis`,
  `glm2-postgres`. Dua bug infra ditemukan & diperbaiki 2026-07-11: (1) **tak ada Redis** (antrean
  BullMQ mustahil) → service ditambah; (2) **worker cuma stub** — compose memanggil `startWorker()`
  yang hanya mengembalikan `{running:true}` lalu diam → **konsumen antrean TIDAK PERNAH menyala**
  meski container tampak "sehat" → diganti `runWorker()`.
- Xendit / S3 (MinIO live) / Umami / n8n: ⏳ belum.
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

## 7. Peta Jalan ke "100% SIAP DIJUAL" (revisi besar PO 2026-07-14; asal 2026-07-12)

> **Definisi "100%" (dipilih PO):** bukan "backlog Fase 0 habis", tapi **benar-benar siap
> dijual ke pelanggan nyata**. **Billing (Xendit) dan WhatsApp/WABA dikerjakan PALING
> AKHIR** — semua yang lain selesai dulu (keputusan PO 2026-07-14, memindahkan billing
> dari posisi #7 lama ke ekor).

**ARAH BARU (PO 2026-07-14) — production-grade via template Mobirise + editor-web:**
Renderer sections-v1 (13 section + 3 tema token) variasi visualnya terbatas dan desain
"LLM menulis ulang seluruh dokumen" terbukti tak skalabel (insiden output terpotong).
Produk beralih ke **ratusan template Mobirise**: AI **memilih** template yang cocok lalu
**mengisi slot kontennya** (teks + gambar); editor visualnya = repo terpisah
**`/opt/dig/projects/editor-web`** milik PO (block-engine pixel-perfect + editor React).
Rujukan arsitektur: `editor-web/docs/integrasi-glm2.md` + memory `production-grade-pivot`.

### Urutan kerja BARU (P0–P7; status per 2026-07-14)

| # | Pekerjaan | Inti | Status |
|---|---|---|---|
| P0 | **Insiden worker beku** | Deadline Redis + timeout per job — hang senyap jadi kegagalan ber-alert | ✅ **PR #75** (+#76 output 4096/biaya $0) — live |
| P1 | **Pengerasan produksi** | pino, `/readyz` (DB+Redis), graceful shutdown API, healthcheck compose → `/readyz` | ✅ **PR #77** — live |
| P2 | **Fondasi engine Mobirise** | Vendor `block-engine` (`packages/engine-mobirise` + sync ber-SHA), `mobiriseProjectSchema` (bentuk BERSAMA dgn editor-web), migrasi dual-mode `Revision.renderEngine` (situs lama aman selamanya), publish mobirise via `exportSite`+aset template | ✅ **PR #78** — live |
| P3 | **Registry template** | Folder (`TEMPLATES_DIR` = folder templates editor-web, mount ro) + `template.json` + indexer `pnpm templates:index` + `TemplateCatalogPort` (shortlist/kontrak slot/materialize) + `POST /api/admin/templates/reindex` | ✅ **PR #81** — live; 6 template terindeks |
| P4 | **AI pilih template + isi slot** | shortlist top-12 → `template_pick` (enum ketat) → `slot_fill` per kelompok 25 slot (sanitasi: URL gambar liar dibuang) → Revision `mobirise-v1`. Di balik `SITE_ENGINE=mobirise-v1` (default masih legacy) | ✅ **PR #80** (+#82/#83 chunking & anggaran reasoning — dua-duanya temuan UJI NYATA) |
| P5 | **Gerbang review PO + handoff editor-web** | Template BARU utk tenant → `PENDING_ADMIN_REVIEW` → Project di editor-web (service token) → PO edit → tombol "Kirim ke pelanggan" → dokumen EDITAN jadi revisi → preview+tombol pelanggan (2 gerbang; pelanggan tetap pemegang akhir) | ✅ KEDUA sisi selesai (**PR #85** + merge editor-web 2026-07-15); E2E jalur balik LULUS. Sisa: rule iptables 172.19/16→5181 (izin PO) + `REVIEW_GATE=1` (keputusan PO) |
| P6 | **Gambar stok Unsplash+Pexels** | `ImageSourcePort`; download→Sharp→rehost FTPS+atribusi (JANGAN hotlink); foto pelanggan selalu prioritas; gagal → slot `keep`. Kedua API key diberikan PO 2026-07-15 | ✅ **PR #86** (+**#87** fix alamat slot — temuan E2E) — E2E LULUS: 11 foto stok ter-rehost + atribusi. **LIVE** (cutover `SITE_ENGINE=mobirise-v1` 2026-07-15, opsi 2 PO) |
| P7 | **Revisi PRD + ADR** | ADR: adopsi engine Mobirise, registry template, gerbang review & aturan SoT, vendoring, sumber gambar. PRD: F-11 via stok+rehost; F-14 sebagian via editor-web | 🔧 berjalan tiap PR |
| — | **Cutover `SITE_ENGINE=mobirise-v1`** | Rollback = env; situs sections-v1 tetap ter-render | ✅ **LIVE 2026-07-15** (keputusan PO: opsi 2 — tanpa menunggu gerbang review) |
| E1 | **Billing** — `Subscription`/`Invoice` + Xendit (T-072) | **EKOR (PO 2026-07-14).** Tanpa ini tak ada uang masuk — dikerjakan setelah produk inti matang | ⏳ |
| E2 | **WhatsApp/WABA** (T-001, T-030..033 WA) | **PALING TERAKHIR (keputusan PO tetap).** Adapter `ChannelPort` — core tak berubah | ⏳ |

Butir lama yang terserap arah baru: **Admin UI** (#8 lama) → sebagian dipenuhi **editor-web**
sebagai konsol admin (review + maintenance template); **T-081 regresi visual** → golden test
engine + fixture sintetis di CI; **T-071 Umami** & **custom domain** → dijadwalkan ulang
setelah cutover. Langkah #5–6 lama (T-080 integration test, self-serve+kuota) **sudah
selesai** (PR #73, #74 — self-serve terbukti di produksi: PO mendaftar sendiri → situs
Sewabos live).

### Yang backlog TIDAK sebut tapi wajib ada sebelum jualan
Ditemukan saat analisa gap 2026-07-12 — **bukan** bagian dari backlog Fase 0, tapi memblokir
"siap dijual": **billing (nol model di schema)**, **admin UI (portal cuma chat widget)**,
**self-serve (tenant & allowlist masih manual)**, **custom domain**.

### Utang yang harus dibayar sebelum klaim "siap jual"
- **Rotasi kredensial ter-ekspos** (DeepSeek, token bot, FTP, cPanel — plaintext di chat). PO.
- **T-080** integration test yang selalu di-skip (CI hijau yang bohong).
- **Off-site backup belum menyala** — backup kini HANYA di VPS yang sama dgn DB-nya; kalau VPS
  hilang, backup ikut hilang. Butuh `BACKUP_OFFSITE_PASSPHRASE` dari PO.
- **P2 audit Telegram**: `can_join_groups` masih aktif (matikan di BotFather).
- **Auto-provision tenant + kuota** (ADR-12 menyiapkan jalannya, belum dibuka).

---

## 6. Referensi
- Spec: `doc/BRD.md`, `doc/PRD.md`, `doc/FRD.md`, `doc/SRS.md`
- Backlog: `doc/07-Backlog-Fase0-*.docx` · Setup: `doc/09-DevSetup-*.docx`
- Kontrak agent: `AGENTS.md` · Loop QA: `docs/qa/README.md`
- Resume sesi: `context.md`
