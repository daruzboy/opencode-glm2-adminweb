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
- Terakhir diperbarui: 2026-07-10

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
  **Belum**: adapter Prisma `PreviewPort` (Revision.siteDoc + **desain token preview** — domain
  publish) + wiring composition root; menyusul bersama T-063.
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
  wiring worker BullMQ = slice BullMQ/PR #35 — lihat di bawah. Sisa: rsync/SSH cPanel + subdomain
  cPanel API FR-PUB-004b.)_
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
- ⏳ Sisanya (**terblokir kredensial/PO**): CHN WABA (T-030..033, terblokir T-001), subdomain
  cPanel UAPI (FR-PUB-004b), adapter Prisma preview (desain token); ops sisa (T-071..073), QA
  (T-080..083, butuh app hidup + TestSprite restart). _(Adapter S3 + deploy cPanel SFTP sudah
  dibuat — lihat slice S3 & cPanel deploy.)_

---

## 3. Keputusan Tertunda / Pertanyaan Terbuka
- **Default LLM produksi** — **DeepSeek dipilih (sementara-final)** per evaluasi T-050
  2026-07-09 (pass 90%, quality 0.85, ~$0.003/20 prompt, ~1.5s). GLM 5.2 **belum**
  dibandingkan (butuh `GLM_API_KEY`); revisit bila GLM diuji atau biaya/kualitas berubah.
  _Env `DIGIMAESTRO_LLM_PROVIDER=deepseek`._ Key DeepSeek diberikan PO 2026-07-09 via chat
  (**ter-ekspos → WAJIB dirotasi**); simpan sebagai secret repo/CI + env VPS, **jangan commit**
  (repo public). Belum diset ke deploy live.
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
- `DEEPSEEK_API_KEY`: ⚠️ **diberikan PO 2026-07-09 via chat (plaintext → ter-ekspos, WAJIB
  dirotasi)**. Dipakai sekali untuk evaluasi T-050 (inline, TIDAK ditulis ke file/commit).
  Belum diset ke secret repo/env VPS/deploy live — lakukan dgn key hasil rotasi.
- `GLM_API_KEY`: ⏳ belum diisi (perbandingan GLM T-050 menunggu).
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
