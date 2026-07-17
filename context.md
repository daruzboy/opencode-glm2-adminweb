# context.md — Resume Sesi

> **Baca paling awal** (bersama `decision.md` & `AGENTS.md`) agar tidak kehilangan
> konteks saat memulai sesi baru. Perbarui di akhir tiap sesi kerja berarti.

- Sesi terakhir: **audit keamanan repo → 3 PR merged & DEPLOY LIVE** · Tanggal: **2026-07-17**
- Cabang aktif: `main` (trunk) @ `2ab718b`. Branch audit/cleanup dihapus post-merge.

---

## ⭐ RINGKASAN 2026-07-16/17 — Audit keamanan repo + deploy ulang LIVE (PR #100–#102)

Audit menyeluruh (kebersihan / SOLID / keamanan) → **3 PR merged berurutan #100→#101→#102**,
CI hijau tiap tahap, lalu **rebuild image + recreate kontainer live TERVERIFIKASI**.

**Yang diperbaiki (kini AKTIF di produksi):**
1. **Tenant-guard bolong utk model pasca-T-020** (#100) — `TENANT_SCOPED_MODELS` +
   TenantProfile/Ticket/Feedback/MediaAsset; tingkat baru `TENANT_WRITE_SCOPED_MODELS`
   (Invoice/ChannelBinding/AdminActing: tulis wajib tenantId, baca via identitas non-tenant
   by design); bug laten cek `upsert` (baca `create`, bukan `data`).
2. **Web chat WS tanpa gerbang biaya** (#100) — rate limit + kuota SEBELUM LLM, paritas jalur
   Telegram (P0/#6); satu tenant bisa membakar token LLM tanpa batas via WebSocket. Fail-open
   saat Redis tersendat; env `INBOUND_RATE_*` sama dgn worker.
3. **Sabuk AUTH_DEV_TOKEN** (#101) — start DITOLAK bila `AUTH_DEV_TOKEN=1` + `NODE_ENV=production`;
   endpoint dev menolak cetak token utk `ADMIN_TENANT_ID` (403).
4. **Pinning JWT HS256** (#101) — verify+sign eksplisit; tutup kelas alg-confusion.
5. **Redaksi token di log** (#101) — serializer `req` pino meredaksi `?token=`/`?t=` (redact pino
   tak bisa menyunting substring `req.url`; token WS wajib lewat query).
6. **Kebersihan** (#102) — `sharedPrismaClient()` SATU client/pool per proses (sebelumnya ±9
   pool/proses di api & worker); `createPreviewDirToken` & `secureTokenEquals` (adapters)
   menggantikan masing-masing 3 salinan inline; komentar basi "T-082 BUG" dihapus.

**Deploy live TERVERIFIKASI (2026-07-17):** image `glm2:staging` rebuild dari `2ab718b` (exit 0)
→ `docker compose up -d glm2-api glm2-worker` → api **healthy**, `/readyz`=`{status:ready,db:ok,
redis:ok}`, migrasi "No pending", worker: poller Telegram + konsumen `publish`/`chat-inbound`
aktif. Kode audit dibuktikan hidup di kontainer (`secureTokenEquals`/`sharedPrismaClient` ADA di
dist). Dockerfile TIDAK menyisipkan git SHA → verifikasi commit via keberadaan artefak, bukan
penanda. Build cache Docker di-prune (klaim ~13,6 GB; disk / 51%→41%).

**Temuan audit TERSISA (terjadwal, decision.md §2):** throttle percobaan `x-admin-token`, pecah
`DashboardDataPort` (ISP) & `chat-composition.ts` (1.040 baris), dedup resep replier produksi
api↔worker. **Utang PO (non-kode):** rotasi kredensial ter-ekspos, `BACKUP_OFFSITE_PASSPHRASE`,
matikan `can_join_groups` bot di BotFather.

---

## ⭐ RINGKASAN 2026-07-11 — Fase 0 TUNTAS end-to-end (PR #51–#62)

**T-083 (gerbang keluar Fase 0) TERCAPAI di produksi nyata, tanpa intervensi manual:**
chat Telegram → wawancara (agent ingat konteks) → agent bangun situs → tombol approval →
tap "✅ Setuju & publish" → job antrean → deploy FTPS → verify HTTP 200 → **notifikasi
"Situsmu sudah LIVE 🎉"** ke chat.

- **Situs live:** https://digimaestro.id/sate-pak-dar-pap917/ (+ foto pelanggan di galeri, WebP)
- **Bot produk:** **@Opencode1993_bot** (long-polling; ≠ bot ops @vps_boy_1993_bot)
- **Kanal:** Telegram (ADR-11) — **WABA ditunda, bukan dibatalkan**; masuk belakangan sbg adapter
  `ChannelPort` tanpa membongkar core.
- **URL situs:** path `digimaestro.id/<slug>/` (**ADR-13**), bukan subdomain.
- **Media:** foto chat → `sharp` (WebP, hemat 95%) → hosting `media/<tenantId>/` → galeri (T-033).
- Gerbang: `pnpm turbo lint test build` **21/21 hijau, 549 tes**.

**Delapan bug ditemukan HANYA karena produknya dijalankan sungguhan** — tak satu pun terdeteksi
test suite yang hijau (detail per-PR di `decision.md` §2):
1. **Agent amnesia** — riwayat tak pernah dimuat → wawancara mustahil selesai (#56).
2. **Prompt vs schema bertabrakan** — LLM diminta mengarang `websiteId` & design token → build
   SELALU gagal (#56).
3. **Markup tool-call bocor** ke pengguna — tools dimatikan tapi prompt masih menyuruh memanggil (#57).
4. **Timeout 30 dtk** tak pernah cukup untuk membangun situs (#57).
5. **Worker cuma stub** di compose — container "sehat" tapi antrean TAK PERNAH dikonsumsi (infra).
6. **Verify sekali-tembak** → publish SUKSES dilaporkan gagal (#58).
7. **State percakapan diabaikan** — jawaban singkat pelanggan → prompt penolakan tanpa tool (#61).
8. **Anggaran token habis untuk REASONING** — v4-pro berpikir dulu; 512 token → jawaban 0 char (#62).

**Dua kali dihentikan pengaman — dan benar:** (a) hendak `DELETE` seluruh tabel Website/Revision
di DB live demi uji bersih; (b) hendak membuat DNS record produksi tanpa PO menyebut namanya.
Data & DNS PO utuh.

---
- Status umum: 4 commit lokal yang tadinya hanya ada di VPS (SPOF) sudah didaratkan ke
  `main` lewat 3 PR: **#22** hardening T-050/T-051 lanjutan (`8dbc2e4`), **#23** Docker
  staging image / T-012 sebagian (`cbae68f`), dan **PR docs** (workflow README + update
  decision.md/context.md ini). Gate `pnpm turbo lint build test` **21/21 hijau** + CI
  hijau di tiap PR; Docker diverifikasi `docker build` sukses di VPS. Lingkungan: `gh`
  terautentikasi (`daruzboy`) & git credential helper terpasang di VPS ini.
  Berikutnya: T-012 Docker **Compose** penuh, atau T-060 (builder). EPIC-03 (WABA) tetap
  terblokir T-001.
- **T-012 Docker Compose penuh SELESAI** (PR menyusul di sesi ini): `docker-compose.yml`
  (inti postgres/redis/migrate/api/worker + profil `edge`=caddy, `ops`=n8n/umami),
  `docker-compose.prod.yml`, `deploy/Caddyfile`, bootstrap long-running worker. Diverifikasi
  end-to-end di VPS (api healthy, `/healthz` ok, worker stabil, migrate exit 0) via host
  port 3300 karena **VPS ini menjalankan deploy asli `glm2-api`/`glm2-worker`/`glm2-postgres`
  di 3000** (project compose terpisah, tak terganggu).
- **T-060 slice model SELESAI** (PR menyusul di sesi ini): `packages/sites-kit` kini punya
  model Site Document tervalidasi Zod — `design-tokens.ts` (3 tema), `sections.ts` (13 tipe
  di `SECTION_REGISTRY`, open/closed, ≥2 varian, props Zod, discriminated-union),
  `site-document.ts` (Website→Pages→Sections + `parseSiteDocument`). zod ^4.4.3 ditambah ke
  sites-kit (lockfile ter-update). Gate 21/21 hijau.
- **T-061 slice renderer SELESAI** (PR menyusul di sesi ini): `packages/sites-kit/src/render/`
  — renderer murni deterministik Site Document → HTML statis zero-JS + CSS token + JSON-LD
  (escape/anti-XSS, `safeUrl`, `renderSection` exhaustive, `buildJsonLd`, `renderPage`/
  `renderSite`). Diverifikasi render nyata (HTML5 valid, 3 JSON-LD, 0 script non-JSON-LD).
  Gate 21/21 (+22 tes render).
- **T-062 slice artifact SELESAI** (PR menyusul di sesi ini): `render/sitemap.ts`
  (`buildSitemap`/`buildRobots`) + `render/site-build.ts` (`buildStaticSite` → StaticFile[]:
  HTML + sitemap.xml + robots.txt) + opsi `RenderOptions` (baseUrl → canonical/OG absolut,
  noindex → meta robots utk preview draft FR-PUB-001). Diverifikasi rakit artifact nyata ke
  disk. Gate 21/21 (sites-kit 50 tes).
- **T-064 slice preview-route SELESAI** (PR menyusul di sesi ini): Port `PreviewPort` (shared)
  + `apps/api/src/preview/` (`handlePreview` render noindex + token guard 404/500,
  `registerPreviewRoutes` + `X-Robots-Tag`), `buildServer` terima `preview` opsional. Diuji via
  Fastify inject (200 HTML/404). api sekarang depend `@digimaestro/sites-kit`. Gate 21/21.
- **T-064 adapter Prisma + wiring SELESAI** (PR, 2026-07-10): `packages/adapters/src/prisma/
  preview-token.ts` = **token stateless HMAC** (`createPreviewToken`/`verifyPreviewToken`,
  timing-safe, tanpa migrasi; revoke = rotasi `PREVIEW_TOKEN_SECRET`) + `preview-port-prisma.ts`
  `PreviewPortPrisma` (delegate sempit `RevisionPreviewDelegate`, verifikasi token dulu → muat
  `Revision.siteDoc`; revisi tak ada/token salah = null). `composition.ts createPreviewDeps()` +
  `index.ts start()` daftarkan rute preview bila `PREVIEW_TOKEN_SECRET` diisi. Diverifikasi
  end-to-end (HTTP inject → adapter → HMAC → render): 200 noindex / 404 salah / 404 absen. Gate
  21/21 (adapters +6 tes). **Keputusan desain token = stateless HMAC** (dipilih PO 2026-07-10).
- **T-063 slice publish SELESAI** (PR menyusul di sesi ini): Port `ArtifactStorePort`/
  `DeployPort` (shared) + `apps/worker/src/publish.ts` (`publishSite`/`rollbackSite`, pipeline
  build→store→deploy→verify) + adapter lokal-FS (`LocalArtifactStore`/`LocalFilesystemDeploy`,
  analog rsync docroot). Diverifikasi end-to-end: publish→serve→curl 200 semua rute, rollback ok.
  Gate 21/21. **Blocker sisa (EPIC-00/PO)**: adapter deploy NYATA (S3 @aws-sdk + rsync/SSH
  cPanel ssh2) + subdomain cPanel API + wiring worker BullMQ; CHN WABA (T-001); QA T-08x
  (app hidup + restart opencode). T-050 sudah final (DeepSeek). Perbandingan GLM opsional.
- _Default LLM_: DeepSeek (`DIGIMAESTRO_LLM_PROVIDER=deepseek`) per eval T-050 2026-07-09.
- **T-063 adapter S3 SELESAI** (PR #33, 2026-07-10): `packages/adapters/src/publish/`
  `S3ArtifactStore` (impl `ArtifactStorePort` di S3-compatible) bergantung interface sempit
  `S3ObjectClient` (offline-testable, fake in-memory) + `createAwsS3ObjectClient()` (satu-satunya
  impor `@aws-sdk/client-s3`, dukung MinIO via `endpoint`+`forcePathStyle`). Simpan objek+manifest
  → retrieve utuh (rollback). Diverifikasi end-to-end melawan MinIO nyata (store→bucket→retrieve;
  key absen=null). Gate 21/21 (adapters +4 tes). **Blocker storage S3 tuntas** → sisa: wiring
  worker BullMQ + composition root (env `S3_*`) & deploy cPanel/SSH nyata (nunggu kredensial PO).
- **T-063 worker BullMQ consumer SELESAI** (PR #35, 2026-07-10, stacked di atas #33):
  `apps/worker/src/publish-job.ts` `processPublishJob` (dispatch murni offline-test atas union
  job `publish`/`rollback`) + `PUBLISH_QUEUE`; `publish-worker.ts` `startPublishWorker` (wrapper
  tipis BullMQ, gagal→throw utk retry); `composition.ts` `createPublishDeps(env)` pilih adapter
  (S3 bila `S3_KEY/S3_SECRET`, else lokal-FS; deploy lokal-FS; verify HTTP fetch) +
  `createRedisConnection` (parse `REDIS_URL`). `runWorker()` mulai consumer + shutdown rapi. Dep
  `bullmq ^5.79.3` (`msgpackr-extract:false` di workspace). Diverifikasi E2E (Redis+MinIO nyata):
  enqueue→consume→build→store MinIO→deploy→verify→completed. Gate 21/21 (worker +10 tes). Sisa:
  produsen job di api (approve→enqueue) + deploy cPanel nyata (berikutnya).
- **T-063 deploy cPanel SFTP SELESAI (kode)** (PR #36, 2026-07-10, stacked di atas #35):
  transport **SFTP over SSH** (dipilih PO). `packages/adapters/src/publish/cpanel-sftp-deploy.ts`
  `CpanelSftpDeploy` (impl `DeployPort`, interface sempit `SftpDeployClient`, offline-test; deploy
  bersih upload+hapus-usang; docroot `public_html/{slug}`) + `ssh2-sftp-client.ts`
  `createSsh2SftpDeployClient()` (satu-satunya impor vendor SFTP; auth password/key; list rekursif).
  Dep `ssh2-sftp-client ^12.1.1`. `worker composition.createDeploy()` pilih cPanel bila
  `CPANEL_SFTP_HOST`+`USER` diisi, else lokal-FS. `.env.example` +`CPANEL_SFTP_*`. Gate 21/21
  (adapters +4, worker +1). **E2E ke host nyata MENUNGGU kredensial** (taruh di file scratchpad
  `cpanel.env`, JANGAN commit). Sisa cPanel: subdomain UAPI (FR-PUB-004b).
- **T-063 deploy cPanel FTP/FTPS SELESAI (kode)** (PR #37, 2026-07-10, stacked di atas #36):
  temuan — host shared PO (Rumahweb (host di catatan lokal)) **tak buka SSH/SFTP** (hanya FTP 21 + cPanel
  2083) → **FTPS dipilih PO**. Orkestrasi deploy diekstrak ke `remote-deploy.ts` (`deployToRemote`
  + `RemoteDeployClient`, dipakai bersama SFTP & FTP). `cpanel-ftp-deploy.ts` `CpanelFtpDeploy` +
  `basic-ftp-client.ts` `createBasicFtpDeployClient()` (satu-satunya impor vendor FTP; FTPS
  eksplisit, path absolut, list rekursif). Dep `basic-ftp ^6.0.1`. `worker createDeploy()` prioritas
  SFTP→FTP→lokal. **E2E Rumahweb SUKSES** (akun FTP khusus — casing username
  penting!, FTPS+TLS verified): deploy v1→v2, clean-delete mirror penuh. **Bug ditemukan E2E &
  diperbaiki**: hapus direktori usang (tambah `removeDir` ke `RemoteDeployClient`). Gate 21/21.
  Sisa cPanel: subdomain UAPI (FR-PUB-004b). _Catatan aman: password cPanel ter-paste di chat → rotasi._
- **T-063 wiring subdomain→pipeline SELESAI** (PR #40, 2026-07-10): `publishSite`/`rollbackSite`
  panggil `ensureSubdomainIfConfigured` SEBELUM deploy (bila `deps.subdomain` di-inject → wajib
  `rootDomain`, docroot selaras `public_html/{slug}`; no-op bila tak di-inject = backward-compat).
  `PublishDeps.subdomain?` + `PublishInput.rootDomain?` + job data `+rootDomain`. `composition
  createSubdomain(env)` pilih UAPI bila `CPANEL_UAPI_HOST`+`USER`+(`TOKEN`|`PASSWORD`). Gate 21/21
  (worker +7 tes). **Pipeline publish lengkap**: build→store→ensureSubdomain→deploy→verify.
- **T-063 produsen job api SELESAI** (PR #41, 2026-07-10): `POST /api/websites/:id/publish` (BRU-02
  approval-first) → enqueue. Port `PublishQueuePort`/`PublishSourcePort` (shared, +kode `QUEUE`).
  Adapter `BullMqPublishQueue` (+`createBullMqPublishQueue`) + `PublishSourcePrisma` (tenant-scoped:
  Website milik tenant → Revision.siteDoc). api `handlePublishRequest` (konten dari **DB**, bukan
  body) + rute (x-tenant-id, `{revisionNumber}` zod → 202/401/400/404) + `createPublishRequestDeps`;
  `buildServer` `publish` opsional (aktif bila DATABASE_URL+REDIS_URL). Dep bullmq di adapters. Gate
  21/21 (adapters +7, api +8). **E2E produsen↔konsumen (Redis nyata) SUKSES**. **Jalur approve→publish
  tersambung penuh.** Sisa produksi: load siteDoc real path sudah dari DB; tinggal auth (T-002).
- **T-063 hardening pipeline SELESAI (kode)** (stacked di atas #41, 2026-07-10): job publish kini
  tahan gangguan transien. Retry: `defaultPublishJobOptions()` (murni) → `defaultJobOptions` Queue =
  `attempts:3` + backoff eksponensial 5s, `removeOnComplete:50`, `removeOnFail:true` (dead-letter
  audit di failed-set). Observability: `publish-worker` logger terinjeksi + log terstruktur start/
  sukses(durasi)/gagal, listener `failed` menandai **DEAD-LETTER** saat percobaan habis. Gate 21/21
  (worker +5, adapters +3 tes murni). Stacked-PR: base = branch #41; retarget ke main saat #41 merge.
- **T-020ext adapter Website/Revision repo SELESAI (kode)** (PR tersendiri, 2026-07-10): impl Prisma
  dua Port repo yg sebelumnya baru punya kontrak. `WebsiteRepositoryPrisma` (findByTenantId+update) &
  `RevisionRepositoryPrisma` (findById/findLatest/create/update, tenant-scoped via Website: assertOwned
  cek Website milik tenant dulu → cross-tenant=null/NOT_FOUND, pola PublishSourcePrisma; number=count+1,
  race dijaga @@unique). Delegate sempit → fake test tanpa DB. Gate 21/21 (adapters +28 tes). Dikerjakan
  di git worktree terisolasi krn working tree main dipakai sesi lain paralel (lihat memory).
- **Batch sesi paralel MERGED 2026-07-10** (#44/#45/#46/#47, review + merge berurutan oleh sesi ini):
  **T-053b** (#44) use case `buildSiteFromBrief` + `SitebuilderToolAdapter` (build/edit Site Document
  → persist Revision). **T-053c** (#46) `OpenAiCompatibleAgentAdapter` (LLM HTTP nyata utk agent loop).
  **T-002auth** (#45) `AuthPort`/`JwtAuthPort` + `/api/auth/token` + plugin — **UTANG: belum dipasang
  ke rute + endpoint token tanpa kredensial** (lihat memory `auth-t002-security-debt`). **T-080** (#47)
  integration test — **selalu di-skip + rusak** (cleanup kena tenant-guard). Semua gate 21/21.
- **T-053d wiring agent→tool sitebuilder SELESAI (loop inti)** (PR tersendiri, 2026-07-10):
  `createProductionAgentReplier` kini menyuntik registry tool sitebuilder (repo T-020ext →
  `SitebuilderToolAdapter` T-053b → tool T-051) ke agent loop, **menutup celah `createAgentToolRegistry([])`
  (0 tool)**. Loop **chat→bangun/revisi situs→persist Revision→(preview→approve→publish)** kini
  tersambung. Gate 21/21 (api +4 tes offline). Sisa: inject schema Site Document nyata + auth rute (T-002).
- **T-053e lengkapi loop agent SELESAI** (PR tersendiri, 2026-07-10): (1) inject `siteDocumentSchema`
  nyata (sites-kit) ke `SitebuilderToolAdapter`+`BuildDeps` → validasi+self-repair (bukan permissive);
  (2) tool `sitebuilder_build_site` (bungkus `buildSiteFromBrief` T-053b di apps/api) → situs baru dari
  brief; (3) router `START_INTERVIEW` scope `['sitebuilder']` + prompt → agent membangun DRAFT setelah
  brief cukup. **Jalur situs baru (interview→build→DRAFT) & revisi (patch) kini lengkap**; approval-first
  terjaga (draft≠publish). Gate 21/21 (api +6 tes). Sisa: E2E dgn API key nyata + auth rute (T-002).
- **T-002auth-wiring SELESAI (bayar utang #45)** (PR tersendiri, 2026-07-11): auth JWT kini benar-benar
  MENEGAKKAN. `buildServer` selalu pasang `app.resolveTenant` (JWT bila `JWT_SECRET` → rute wajib Bearer
  token; tanpa JWT → fallback `x-tenant-id` dev). Rute **chat REST + publish** panggil `resolveTenant`
  → 401 tanpa token; `x-tenant-id` tak menembus saat auth aktif. Endpoint `/api/auth/token` **hanya bila
  `AUTH_DEV_TOKEN=1`** (produksi tak ekspos pencetak token tanpa kredensial). Gate 21/21 (api +4 tes
  route-guard). **NFR-07 tegak utk REST.** Sisa: auth WS (query token) + E2E LLM. Lihat memory
  `auth-t002-security-debt` (utang rute & endpoint token: TERTUTUP; WS menyusul).
- **Object storage = MinIO self-host** (2026-07-10): service `minio`+`minio-init` di compose
  (profil `storage`), bucket `digimaestro-artifacts`, kredensial `MINIO_ROOT_*` (=S3_KEY/SECRET),
  `S3_ENDPOINT=http://minio:9000`. Diverifikasi put/get object via S3 API. Sisi S3 T-063 tak
  terblokir lagi → tinggal adapter `@aws-sdk` (kode). Sisi cPanel: PO sedang kumpulkan
  CPANEL_HOST/UAPI token/SSH key (panduan sudah diberikan).
- **T-050 evaluasi DIJALANKAN 2026-07-09** (API DeepSeek nyata): deepseek pass 90%, quality
  0.85, ~$0.003/20 prompt, ~1.5s → **default = DeepSeek** (`DIGIMAESTRO_LLM_PROVIDER=deepseek`).
  GLM belum diuji (butuh GLM_API_KEY). Key DeepSeek dari PO **ter-ekspos di chat → minta rotasi**;
  dipakai inline saja, tak disimpan.
- _Catatan lingkungan_: setelah `pnpm install`, Prisma client perlu `pnpm --filter
  @digimaestro/adapters db:generate` sebelum build adapters/api (postinstall tak selalu jalan).
- _Sejarah_: **T-052 ter-merge via PR #17** (`7e4eaf0`), **T-053** agent loop via PR #21
  (`9e5a783`). Semua sebelum sesi ini.

## Di mana kita sekarang
**Fase 0 — vertical slice TUNTAS & LIVE** (T-083 tercapai, lihat ringkasan di atas).

- **EPIC-03 (kanal) — AKTIF via Telegram** (ADR-11/12). _Catatan lama "EPIC-03 terblokir T-001"
  sudah USANG_: yang terblokir hanya **WABA/WhatsApp**; kanal Telegram jalan penuh & dipakai PO
  sungguhan. Webhook + long-polling keduanya ada; live memakai **polling** (VPS tanpa domain publik).
- **Loop agent tersambung penuh**: chat → router (state-aware) → agent loop (riwayat + tool
  sitebuilder) → build/patch Site Document → Revision DRAFT → tombol approval → publish → notifikasi.
- **Media (T-033) jalan**: foto chat → WebP → hosting → galeri situs.
- **Deploy live** (`/opt/containers/glm2/`, di luar repo): api + worker + redis + postgres, semua
  sehat. Kredensial (DeepSeek, Telegram, cPanel FTPS) terpasang di `.env` deploy — **bukan di repo**.
- EPIC-01/02 (T-010/011/013, T-020/021) & T-040 web chat: merged (tak berubah).
- `.git` sudah di luar Google Drive (`C:\dev\glm2-adminweb.git`).

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
  account_info` membalas "Invalid TestSprite API Key". Fix: key valid diset ke
  **User env** `TESTSPRITE_API_KEY` + di-mirror ke **secret repo** (CI qa-gate).
  Verifikasi end-to-end via probe MCP stdio (initialize →
  `tools/call check_account_info`) → `firstName: daruzboy`.
  `opencode mcp list` → `✓ TestSprite connected` (8 tool: `testsprite_bootstrap`,
  `generate_code_summary`, `generate_standardized_prd`, `generate_frontend/
  backend_test_plan`, `generate_code_and_execute`, `open_test_result_dashboard`,
  `check_account_info`). **BUTUH RESTART opencode** agar tool-termuat ke toolbelt
  agent (MCP hanya load saat startup). `opencode.json` sudah benar; key TIDAK
  ditulis ke file ter-track (repo public) — memakai referensi `{env:...}`.
  **Rotasi key (2026-07-04):** key dirotasi ulang ke `lgWuS15...` (key valid
  terbaru). Riwayat: `03w3e...` (invalid) → `gvm7n...` → `lgWuS15...`. User env +
  secret repo **sudah sinkron** ke key terbaru. Sesi yang berjalan saat rotasi
  tetap melapor "No API Key" (env dirotasi setelah startup MCP) → **wajib restart
  opencode** agar MCP re-spawn dgn env baru.
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

## Keputusan desain kanal Telegram + media + URL (2026-07-11, ADR-11/12/13)
- **Kanal di balik Port** (`ChannelPort`, `ChatInboundQueuePort`): Telegram & WABA sama-sama
  dinormalisasi ke `InboundChannelMessage` di adapter → core tak kenal vendor kanal. Menambah
  WABA nanti = menambah adapter, bukan membongkar core.
- **Idempotensi bertumpu constraint DB, bukan cek-lalu-tulis**: `Message.providerMsgId` @unique →
  P2002 = duplikat (retry webhook / tombol ditekan 2×) → diabaikan. Aman terhadap race dua worker.
  `providerMsgId` diprefiks `chat_id` karena `message_id` Telegram hanya unik **per-chat** — tanpa
  prefiks, pesan #42 dari dua pelanggan berbeda saling dianggap duplikat.
- **`callback_data` = input TAK tepercaya** (bisa dikarang lewat Bot API) → diparse ketat ke bentuk
  tertutup, argumennya TETAP divalidasi ke DB tenant. `websiteId` sengaja tak ikut di payload:
  satu website per tenant (BRU-01) → tombol **secara struktural** tak bisa menunjuk website tenant lain.
- **Tombol approval muncul berbasis NOMOR REVISI** (snapshot sebelum vs sesudah giliran agent),
  bukan menebak dari teks LLM — teks berubah-ubah, nomor revisi tidak.
- **Long-polling, bukan webhook** (live): webhook menuntut HTTPS publik; VPS tak punya domain.
  Jalur sesudah update diambil SAMA PERSIS dgn webhook → tak ada cabang logika kedua yang bisa
  menyimpang. Offset di memori → restart bisa ambil ulang update lama = AMAN (dedup di DB).
- **Media di LUAR docroot situs** (`media/<tenantId>/`): deploy publish = **mirror penuh** (upload +
  hapus file usang) → media di dalam docroot situs akan LENYAP tiap publish ulang. Nama file
  content-addressed (sha256) → foto identik = nama sama → tak menumpuk duplikat, URL stabil.
- **URL foto disisipkan ke prompt build** ("gunakan HANYA url ini, jangan mengarang") — tanpa itu
  LLM mengarang URL dan galeri jadi `<img>` rusak (situs lama memang punya `/_assets/…` yang 404).
- **Satu sumber kebenaran bentuk URL** (`publicSiteUrl` di shared): dipakai produsen job DAN adapter
  deploy. Kalau keduanya menyimpang, publish SUKSES pun dilaporkan gagal (URL dijanjikan ≠ diverifikasi).

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

## ⭐ TARGET: "100% SIAP DIJUAL" (keputusan PO 2026-07-12)
Definisi 100% = **benar-benar siap dijual ke pelanggan nyata**, BUKAN "backlog Fase 0 habis".
**WhatsApp/WABA dikerjakan TERAKHIR** — semua yang lain selesai dulu.
Status: Fase 0 ~80% · **siap-jual ~40%**. **Peta jalan lengkap + urutan kerja: `decision.md` §7.**

Selesai (2026-07-11..12): ✅ auth WS (#67, lubang keamanan) · ✅ T-082 dashboard biaya AI (#68,
+2 bug pencatatan) · ✅ T-073 backup+restore teruji (#69) · ✅ T-070 alert (#70).
Berikutnya: **T-080** (utang: integration test SELALU di-skip → CI hijau yang bohong) →
self-serve+kuota → billing → admin UI → analytics/regresi visual → custom domain → **WABA**.

## Langkah segera berikutnya
1. **T-070** alert n8n (job gagal/webhook error → notifikasi internal) — ops, tak terblokir.
2. **T-082** dashboard biaya AI per tenant (token/biaya harian) — `LlmUsage` sudah dicatat;
   tinggal agregasi + tampilan. Relevan karena anggaran LLM kini benar-benar terbakar.
3. **T-081** regresi visual sites-kit (Playwright screenshot per section × tema) di CI.
4. **Bayar utang T-080** integration test: di-gate `RUN_INTEGRATION_TESTS=1` yang tak pernah
   diset (**selalu skip di CI**) + cleanup `deleteMany()` tanpa `where` kena tenant-guard →
   `TenantGuardError` (tak bisa lulus saat diaktifkan). Butuh klien unguarded + wiring flag CI.
5. **Auth WS** `/api/chat` (masih query `tenantId`; REST sudah tegak lewat T-002auth-wiring).
6. **Rotasi kredensial ter-ekspos** (lihat "Hal yang ditunggu dari PO").

## Hal yang ditunggu dari PO
- ⚠️ **ROTASI kredensial yang ter-ekspos di chat** (plaintext): `DEEPSEEK_API_KEY`,
  `TELEGRAM_BOT_TOKEN`, password FTP `Deploy@…`, password cPanel `digs2416`. Semuanya kini
  terpasang di `.env` deploy (di luar repo) — tapi sudah terlanjur muncul di percakapan.
- **T-001** verifikasi Meta + WABA — **tidak lagi memblokir** Fase 0 (Telegram jadi kanal A),
  tapi tetap perlu untuk WhatsApp.
- **Xendit** (recurring) + `GLM_API_KEY` (perbandingan T-050) — sisa T-002.
- Keputusan produk: buka **auto-provision tenant** (self-serve) atau tetap allowlist? Bila
  dibuka, WAJIB disertai kuota per tenant (ADR-12).

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

## Update terbaru 2026-07-04 (Codex) — kini SUDAH MERGED

- T-040 frontend controller slice: awalnya dibuat di working tree Codex (komit tak
  ter-push → hilang → dipulihkan dari reflog) → **ter-merge ke `main` via PR #10**.
- Catatan lama "cabang `docs/post-t040-merge-status`" sudah tidak relevan; kerjaan
  ini kini di trunk `main` (PR #10/#13/#12).
- File baru: `apps/portal/src/chat-widget.ts`, `apps/portal/src/chat-widget.test.ts`,
  `apps/portal/src/chat-widget-view-model.ts`, dan
  `apps/portal/src/chat-widget-view-model.test.ts`, `apps/portal/src/chat-widget-session.ts`,
  `apps/portal/src/chat-widget-session.test.ts`, `apps/portal/src/chat-widget-presenter.ts`,
  `apps/portal/src/chat-widget-presenter.test.ts`, `apps/portal/src/chat-widget-dom.ts`,
  dan `apps/portal/src/chat-widget-dom.test.ts`. `apps/portal/src/index.ts`
  mengekspor API chat widget.
- Isi slice: `ChatWidgetController`, tipe `PortalChatMessage`, `ChatTransport`,
  browser REST/WS transport, `parseServerEvent`, optimistic local IN message,
  normalisasi conversation pending setelah reply pertama dari backend, dan view-model
  presentation murni untuk copy/status/message list. Session facade menggabungkan
  controller + view-model + `ChatWidgetStorage` port untuk persist `conversationId`
  per tenant. Storage persist bersifat best-effort: read/write error (private mode,
  quota, blocked storage) tidak mematikan chat. Session `stop()` idempoten dan melepas
  listener persist agar cleanup ganda tidak menutup socket/menulis storage berulang.
  Presenter menambahkan lapis form input: draft, placeholder, label kirim,
  `canSubmit`, submit trim/reset, unsubscribe listener, dan factory
  `createBrowserChatWidgetPresenter()` untuk pemakaian browser siap pakai. DOM adapter
  minimal `mountBrowserChatWidget()` bisa render shell/input/message list tanpa
  dependency React/Vite; runtime DOM tetap diinjeksi agar testable. Helper
  `mountBrowserChatWidgetFromDataset()` membaca `data-tenant-id`,
  `data-conversation-id`, `data-api-base-url`, dan `data-ws-base-url` dari root.
  `mountAllBrowserChatWidgets()` auto-mount banyak root dan menerima callback
  `onMountError` untuk root invalid. DOM adapter juga menambahkan atribut aksesibilitas
  dasar: live status, alert error, aria label form/input/submit, `aria-busy`, dan
  `maxlength=4000` sesuai schema backend. `CHAT_MESSAGE_MAX_LENGTH` diekspor sebagai
  kontrak bersama; controller menolak pesan >4000 karakter dan presenter
  menonaktifkan submit + menampilkan helper hitung karakter; saat limit terlampaui,
  helper menjelaskan batas maksimal. DOM mount idempoten
  per-root (WeakMap registry) agar HMR/partial reload tidak membuat double listener;
  `destroy()` idempoten, menghapus registry sehingga root bisa di-mount ulang, dan
  cleanup ganda tidak menutup socket berulang. Helper
  `destroyBrowserChatWidgetMounts()` membersihkan hasil `mountAllBrowserChatWidgets()`
  sebagai grup untuk lifecycle halaman/HMR.
  Message view-model membawa `dateTime` asli; DOM message item menulis `data-tone`,
  `aria-label`, dan `<time datetime="...">` untuk semantik aksesibilitas/styling.
  View-model membawa `status` key stabil; DOM `data-status` memakai key
  (`open`, `connecting`, dst.) bukan label copy Indonesia.
  Test DOM mengunci submit form hingga payload WS backend-compatible
  (`conversationId` + `text`).
- Catatan SOLID: controller hanya state/use-case UI; transport hanya I/O REST/WS;
  parser payload adalah fungsi murni; runtime browser (`fetch`/`WebSocket`) diinjeksi
  agar testable tanpa React/Vite.
- Verifikasi lokal alternatif: `tsc -b`, `vitest run`, `eslint .` hijau. T-040
  frontend slice sudah cukup untuk MVP dasar; pengembangan dilanjutkan ke T-050
  karena T-030..033 masih terblokir verifikasi WABA/T-001.
  `pnpm turbo ...` belum bisa dijalankan di sandbox karena binary `pnpm` tidak ada di
  PATH dan Turbo tidak menemukan package manager.

## Update T-050 2026-07-04 (Codex)

- Dipilih sebagai tugas berikutnya setelah T-040 karena sesuai backlog Sprint 0.3 dan
  tidak bergantung pada WABA: LLM abstraction layer untuk FR-AGT-008.
- File baru: `packages/shared/src/ports/llm.ts`,
  `packages/adapters/src/llm/openai-compatible-json-adapter.ts`,
  `packages/adapters/src/llm/deterministic-json-adapter.ts`,
  `packages/adapters/src/prisma/llm-usage-logger-prisma.ts`, dan test terkait.
- Isi v0: `LlmJsonPort`, `LlmUsageLoggerPort`, request/error/usage types,
  schema `safeParse()` struktural yang kompatibel Zod tanpa import runtime `zod`,
  adapter OpenAI-compatible untuk DeepSeek/GLM dengan injected `fetch`,
  `response_format: json_object`, retry/self-repair untuk JSON/schema invalid,
  usage logging via Port, dan estimasi biaya token. `LlmUsageLoggerPrisma` memetakan
  usage ke tabel `LlmUsage` (`tenantId`, `jobId`, `provider`, `task`, `tokenIn`,
  `tokenOut`, `cost`). `createLlmJsonPort()` di `apps/api/src/composition.ts`
  memilih DeepSeek/GLM dari env dan memasang logger Prisma saat dipakai produksi.
  `DeterministicLlmJsonAdapter` tersedia untuk test/dev agent flow tanpa API key.
  `packages/core/src/llm/provider-evaluation.ts` menambahkan
  `recommendLlmProvider()` untuk menghitung pass rate, kualitas rata-rata, latensi,
  biaya total, dan rekomendasi provider dari hasil golden prompt.
  `.env.example` diselaraskan dengan composition root: `DIGIMAESTRO_LLM_PROVIDER`,
  `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `GLM_MODEL`, dan `GLM_BASE_URL`.
  `LLM_GOLDEN_PROMPTS` berisi 20 brief evaluasi untuk UMKM, revisi operator, dan
  NEEDS_INFO. `createLlmEvaluationReport()` membuat ringkasan coverage prompt,
  jumlah provider, prompt yang belum dievaluasi, dan rekomendasi provider.
  `packages/shared/src/ports/agent-tool.ts` menambahkan kontrak tool agent
  vendor-neutral serta helper `toOpenAiToolDefinition()`. `packages/core/src/agent/
  tool-registry.ts` menambahkan registry in-memory dengan guard scope tenant
  (`NOT_FOUND`/`FORBIDDEN`) sebagai fondasi MCP/function-calling T-051.
  `AuditLogPort` + `AuditLogPrisma` menambahkan pencatatan tenant-scoped ke tabel
  `AuditLog`; registry mencatat outcome `ok/error/forbidden/not_found` dan fail-closed
  jika audit gagal.
- Export publik ditambahkan di `packages/shared/src/index.ts` dan
  `packages/adapters/src/index.ts`; helper evaluasi diekspor dari `packages/core`.
- Verifikasi lokal alternatif terakhir: `tsc -b`, `vitest run` (106/106), `eslint .`
  hijau. `pnpm turbo ...` masih belum tersedia di PATH sandbox.

## Update T-051 2026-07-04 (Codex)

- T-051 dimulai tipis setelah T-050 foundation: tool pertama dibuat tanpa MCP SDK
  dulu agar tetap offline-testable dan tidak menambah dependency.
- File baru: `packages/core/src/agent/builtin-tools.ts` dan testnya.
- Tool awal: `sitebuilder_get_site_outline`, `sitebuilder_apply_patch`, dan
  `ops_get_job_status`. Semua bergantung pada port kecil (`SitebuilderToolPort`,
  `OpsToolPort`), validasi input manual, inject `tenantId` dari `AgentToolContext`,
  dan return `Result`.
  `executeFunctionToolCalls()` menambahkan bridge OpenAI-compatible: parse JSON
  arguments dari model tool call, panggil registry, lalu keluarkan tool result
  message dengan content JSON `{ ok, value/error }`.
- Verifikasi lokal alternatif terakhir: `tsc -b`, `vitest run` (114/114),
  `eslint .` hijau. `pnpm turbo ...` masih belum tersedia di PATH sandbox.
