Software Requirement Specification (SRS)
Platform Website Builder Berbasis Chatbot & Agentic AI — digimaestro.id


| Field | Keterangan |
| --- | --- |
| Versi Dokumen | 1.2 (Rebrand ke digimaestro.id; fokus tunggal produk) |
| Tanggal | 2 Juli 2026 |
| Pemilik Dokumen | Darusman (Product Owner) |
| Audiens | Tim pengembang (1–2 developer) |
| Standar Acuan | Diadaptasi dari IEEE 830 / ISO 29148; panduan web modern Google (web.dev) |
| Dokumen Terkait | BRD v1.1, PRD v1.1, FRD v1.1 |



# Daftar Isi

# 1. Pendahuluan

## 1.1 Tujuan
Menetapkan spesifikasi perangkat lunak — arsitektur, teknologi, model data, antarmuka, dan kebutuhan non-fungsional — sebagai acuan implementasi kebutuhan fungsional pada FRD v1.1. Versi 1.1 merevisi arsitektur publikasi: situs klien dibangun statis (Astro) dan di-deploy ke shared hosting terpisah, sementara platform (chatbot, agent, portal, n8n) berjalan di VPS.

## 1.2 Definisi & Singkatan


| Istilah | Arti |
| --- | --- |
| Tenant | Satu akun klien beserta website, media, langganan, dan percakapannya. |
| WABA | WhatsApp Business API (Meta Cloud API). |
| Site Document | Representasi terstruktur website (pages → sections → props) dalam JSON tervalidasi. |
| AgentJob | Unit pekerjaan AI asinkron (build/edit/konten) yang diproses worker. |
| Revision | Snapshot immutable Site Document pada satu titik waktu. |
| Build Artifact | Hasil build statis Astro (folder HTML/aset) dari satu Revision, disimpan di object storage. |
| DeployPort | Antarmuka abstraksi pengiriman artefak ke target hosting (cPanel/SSH, dsb.). |
| CWV | Core Web Vitals (Google): LCP, INP, CLS — metrik pengalaman pengguna web. |



## 1.3 Keputusan Arsitektural Kunci (ADR Ringkas)


| No | Keputusan | Alasan |
| --- | --- | --- |
| ADR-1 | Modular monolith (bukan microservices), TypeScript end-to-end | Tim 1–2 dev; batas modul ditegakkan lewat struktur paket & dependency rule, bukan jaringan. |
| ADR-2 | Proses web (api) & worker terpisah, berbagi codebase; antrean BullMQ (Redis) | Job AI & build berdurasi panjang tidak boleh memblokir webhook; retry & rate limit bawaan. |
| ADR-3 | Situs klien = statis penuh: Site Document → build Astro → deploy ke shared hosting | CWV terbaik (zero-JS default), biaya hosting sangat rendah, aman (tanpa runtime di sisi situs), sejalan panduan web.dev. |
| ADR-4 | LLM abstraction layer (Port/Adapter) | DeepSeek default berbiaya rendah; provider dapat diganti/dicampur per jenis tugas (BR-12). |
| ADR-5 | PostgreSQL tunggal multi-tenant dengan tenantId di semua tabel domain | Sederhana, cukup untuk 500 tenant; isolasi via kolom + guard di repository layer. |
| ADR-6 | Hosting situs klien: satu akun cPanel (subdomain via cPanel API, custom domain via addon domain, TLS via AutoSSL); deploy rsync/SSH | Memanfaatkan aset yang sudah dimiliki; otomatis penuh via API; dibungkus DeployPort agar mudah bermigrasi (risiko SPOF, lihat BRD RSK-09). |
| ADR-7 | n8n hybrid: logika inti (percakapan, agent, pipeline publish) di kode; n8n untuk notifikasi terjadwal, laporan, alert & integrasi sekunder | Inti tetap testable & SOLID; pekerjaan repetitif berpindah cepat tanpa menyita waktu dev. |
| ADR-8 | VPS & data di data center Indonesia (mis. IDCloudHost/Biznet) | Latensi pengguna lokal & dukungan kepatuhan residensi data UU PDP. |
| ADR-9 | Lapisan tools agent dibangun di atas MCP (Model Context Protocol): kemampuan platform diekspos sebagai MCP server internal | Definisi tool tunggal & terstandar untuk semua model LLM (DeepSeek/pengganti); tool dapat diakses host MCP lain (asisten operator, otomasi masa depan) tanpa integrasi khusus — memperkuat portabilitas vendor. |
| ADR-10 | SEO diperlakukan sebagai subsistem kelas satu (bukan fitur tempelan): terlibat sejak generasi konten, build, hingga pelaporan | SEO adalah alasan utama UMKM membuat website (ditemukan di Google); menjadi nilai jual & pembeda produk. |
| ADR-11 | **Kanal Fase 0 = Telegram Bot API**, bukan WhatsApp/WABA (T-030tg, rencana B). WABA tidak dibatalkan — ditunda sampai verifikasi Meta selesai (T-001). | Verifikasi Meta Business + WABA punya lead time di luar kendali tim dan memblokir SELURUH vertical slice (chat→situs live), padahal seluruh hilirnya sudah jadi. Telegram: tanpa verifikasi, tanpa biaya, webhook+bot API setara untuk kebutuhan Fase 0. Kedua kanal dinormalisasi ke `InboundChannelMessage` di balik `ChannelPort` (`packages/shared/src/ports/channel.ts`), jadi WABA masuk belakangan = menambah adapter, bukan membongkar core. |
| ADR-12 | Bot Telegram dijaga **allowlist chat_id → tenant** (env `TELEGRAM_ALLOWLIST`); chat asing ditolak sebelum LLM dipanggil. Auto-provision tenant + kuota = follow-up. | Bot Telegram bersifat terbuka: siapa pun yang menemukannya bisa mengirim pesan, dan tiap pesan yang lolos akan membakar token LLM berbayar. Allowlist = nol eksposur biaya untuk Fase 0 & demo (T-083), tanpa mengunci pilihan self-serve nanti. |
| ADR-13 | **URL situs klien berbasis path** — `https://digimaestro.id/<slug>/`, BUKAN subdomain `<slug>.digimaestro.id` (env `PUBLISH_URL_MODE=path`). Kode mode subdomain (FR-PUB-004b) tetap ada & teruji, tinggal diaktifkan bila arah berubah. | Kenyataan hosting (diverifikasi lewat FTPS nyata): akun FTP deploy di-chroot ke document root domain utama, sehingga folder `<slug>` LANGSUNG tayang ber-HTTPS memakai sertifikat domain utama yang sudah aktif — tanpa cPanel UAPI, tanpa provisioning DNS, tanpa menunggu AutoSSL per subdomain. Subdomain menambah lapisan yang bisa gagal (DNS lambat, sertifikat belum terbit → publish sukses dilaporkan gagal) demi keuntungan kosmetik; PO memilih tidak menanggungnya di Fase 0. Konsekuensi: kredensial cPanel UAPI TIDAK disimpan di server (tak ada rahasia menganggur), dan tak ada perubahan DNS produksi. |



# 2. Teknologi & Versi (Stack Terkini)
Prinsip: pakai versi LTS/stabil terbaru saat implementasi dimulai; tabel ini mencantumkan generasi minimum. Dependensi dikunci via lockfile dan diperbarui terjadwal (Renovate/Dependabot).


| Lapisan | Teknologi | Catatan |
| --- | --- | --- |
| Runtime | Node.js 22 LTS, TypeScript 5.x (strict) | ESM murni; tsx untuk dev. |
| API/webhook | Fastify v5 | Plugin resmi: rate-limit, websocket (web chat), schema validation; alternatif ringan: Hono. |
| ORM & DB | Prisma 6.x + PostgreSQL 16 | JSONB untuk Site Document; Prisma Migrate untuk skema. |
| Antrean | BullMQ 5.x + Redis 7 | Job AI, build, deploy, verifikasi DNS. |
| Validasi | Zod 4 | Skema komponen, structured output LLM, input API. |
| Situs klien | Astro 5.x + Tailwind CSS 4 | Static output; islands hanya untuk komponen interaktif; komponen library dibangun sebagai komponen Astro. |
| Portal & admin | React 19 + Vite 6 (atau Next.js App Router) | TanStack Query, Tailwind 4, shadcn/ui. |
| Monorepo | pnpm workspaces + Turborepo | Paket: api, worker, portal, sites-kit (library komponen), shared. |
| Testing | Vitest 3 + Playwright | Unit, kontrak adapter, e2e, regresi visual komponen. |
| Kualitas | ESLint 9 (flat config) + Prettier; Lighthouse CI | Budget performa dijalankan di pipeline build situs. |
| Tools agent | MCP TypeScript SDK (@modelcontextprotocol/sdk) | MCP server in-process/stdio untuk tools platform; bridge ke function-calling DeepSeek. |
| Otomasi ops | n8n (self-host, container) | Workflow notifikasi/laporan; kredensial di n8n vault. |
| Analytics | Umami (self-host) | Website-id per tenant; tanpa cookie pihak ketiga. |
| Edge platform | Caddy 2 | TLS otomatis untuk domain platform (portal, api, preview, umami, n8n). |



# 3. Deskripsi Umum Sistem

## 3.1 Topologi Runtime
VPS platform (Indonesia, 4 vCPU / 8 GB / NVMe): Docker Compose — api (Fastify), worker (BullMQ), portal (React), n8n, Umami, PostgreSQL, Redis, Caddy. Termasuk hosting URL preview draft (ber-token, noindex).
Shared hosting cPanel (terpisah, sudah dimiliki): hanya berisi file statis situs klien yang sudah publish. Subdomain <slug>.digimaestro.id dan addon custom domain dikelola via cPanel API; TLS via AutoSSL.
Object storage S3-compatible: media tenant + build artifact (10 revisi terakhir per situs) untuk rollback cepat & redeploy lintas target.

## 3.2 Alur Publish (menggantikan render on-the-fly v1.0)
Approve revisi → worker mengambil Site Document → build Astro (library komponen sites-kit) → optimasi aset → Lighthouse CI budget → unggah artifact ke object storage → DeployPort menyalin ke docroot tenant di shared hosting (rsync incremental) → verifikasi HTTP 200 + smoke check → status PUBLISHED + notifikasi. Rollback = redeploy artifact lama tanpa build ulang.

## 3.3 Antarmuka Eksternal


| Sistem | Arah | Protokol/Keterangan |
| --- | --- | --- |
| WhatsApp Cloud API (Meta) | Dua arah | Webhook masuk (verifikasi X-Hub-Signature-256); Graph API keluar (pesan, media, template). |
| Xendit | Dua arah | Invoice/recurring via REST; webhook status bayar (verifikasi callback token, idempoten). |
| DeepSeek API | Keluar | Chat completion (OpenAI-compatible) via LLM Port; timeout, retry, circuit breaker. |
| Provider Image Generation | Keluar | Via ImageGenPort (finalisasi Fase 0; DeepSeek tidak menyediakan image-gen). |
| Stock Photo API | Keluar | Pencarian & unduh berlisensi via StockPhotoPort; lisensi dicatat per aset. |
| cPanel/UAPI shared hosting | Keluar | Buat subdomain, addon domain, cek AutoSSL; deploy file via SSH/rsync (fallback FTP). |
| DNS | Keluar | Verifikasi record custom domain klien sebelum penambahan addon domain. |
| n8n | Dua arah | Platform memicu workflow via webhook n8n; n8n memanggil API platform (service token) untuk data & pengiriman WA. |



# 4. Arsitektur Perangkat Lunak: Clean Architecture & SOLID

## 4.1 Lapisan & Dependency Rule
Kode diorganisasi per modul domain (sesuai peta modul FRD) dengan empat lapisan; ketergantungan hanya boleh mengarah ke dalam:
apps/
api/  worker/  portal/            # entry point (presentation & composition root)
packages/
core/
modules/
conversation/                 # CNV
domain/                     # entity, value object, aturan bisnis murni
application/                # use case (mis. HandleIncomingMessage)
agent/ builder/ media/ publishing/ billing/ admin/ channel/ analytics/
shared/
kernel/                       # Result, DomainEvent, error types
ports/                        # LlmPort, ImageGenPort, StoragePort,
# PaymentPort, MessagingPort, DeployPort,
# HostingControlPort, AnalyticsPort, AutomationPort
adapters/                         # DeepSeekAdapter, XenditAdapter, R2Adapter,
# WabaAdapter, CpanelDeployAdapter, CpanelUapiAdapter,
# UmamiAdapter, N8nWebhookAdapter, ...
sites-kit/                        # library komponen Astro + tema + skema Zod

## 4.2 Pemetaan Prinsip SOLID (Wajib Ditaati)


| Prinsip | Penerapan Konkret di Proyek Ini |
| --- | --- |
| S — Single Responsibility | Satu use case = satu kelas/fungsi aplikasi (GenerateSitePlan, ApplyRevisionPatch, PublishRevision). Handler webhook hanya memvalidasi & mengantre; pipeline publish memisahkan build, quality-check, dan deploy sebagai langkah berbeda. |
| O — Open/Closed | Komponen situs baru = registrasi di sites-kit (komponen Astro + skema Zod) tanpa mengubah engine agent. Target hosting baru = adapter DeployPort baru tanpa mengubah pipeline (FR-PUB-009). Intent chatbot baru = handler baru pada router intent. |
| L — Liskov Substitution | Semua adapter (LLM/ImageGen/Storage/Payment/Deploy) harus lolos test suite kontrak yang sama, termasuk perilaku error, sehingga dapat saling dipertukarkan di test maupun produksi. |
| I — Interface Segregation | Port kecil & spesifik: LlmChatPort vs LlmJsonPort; DeployPort (kirim artefak) terpisah dari HostingControlPort (subdomain/addon/SSL); MessagingPort terpisah dari TemplateMessagePort; repository per agregat. |
| D — Dependency Inversion | Use case bergantung pada interface di shared/ports; implementasi disuntik lewat composition root (awilix/tsyringe). Tidak ada import SDK vendor (Meta, Xendit, cPanel, DeepSeek) di domain/application. |



## 4.3 Konvensi Clean Code
TypeScript strict; ESLint 9 + Prettier; larangan any tanpa justifikasi; penamaan Inggris di kode, Bahasa Indonesia di copy pengguna.
Validasi input di tepi sistem dengan Zod; hasil operasi memakai Result<T, E>; domain event untuk efek samping lintas modul (RevisionApproved → publishing + notification).
Semua fungsi publik use case memiliki unit test; PR tanpa test tidak digabung.

## 4.4 Batas Tanggung Jawab n8n (ADR-7)
Boleh di n8n: penjadwalan dunning & pengingat kuota, laporan bulanan Umami → WA, alert operasional (job gagal, webhook error, anggaran AI), sinkronisasi ringan (mis. rekap ke Google Sheets), eksperimen integrasi baru.
Tidak boleh di n8n: state machine percakapan, agent loop & pemanggilan LLM inti, keputusan billing/kuota, pipeline build-deploy, dan apa pun yang butuh unit test atau menyimpan aturan bisnis.
n8n memanggil platform hanya lewat API ber-service-token dengan scope terbatas; workflow diekspor JSON dan disimpan di repositori (version control).

# 5. Desain Subsistem AI

## 5.1 LLM Abstraction Layer
interface LlmJsonPort {
completeJson<T>(req: {
task: 'site_plan'|'section_copy'|'revision_patch'|'article'|'intent'|'interview',
system: string; messages: ChatMessage[];
schema: ZodType<T>; maxTokens: number; temperature?: number;
}): Promise<Result<T, LlmError>>;   // retry + self-repair bila JSON invalid
}
Routing per tugas dikonfigurasi (env/DB): default DeepSeek untuk semua tugas teks; tugas dapat dipetakan ke provider lain tanpa perubahan kode (BR-12, FR-AGT-008).
Setiap panggilan mencatat tenantId, jobId, tugas, provider, token in/out, latensi, biaya estimasi → tabel LlmUsage (dasar FR-BIL-004 & GO-05).
Guardrail: system prompt kebijakan konten; keluaran divalidasi skema Zod; konten pengguna tidak pernah dieksekusi sebagai kode.

## 5.2 Pola Agent (Plan → Act → Validate)
Build: brief → SitePlan (JSON) → per halaman: pilih section & varian → isi props + copywriting → validasi skema komponen → gagal? self-repair maks. 3x → rakit Revision.
Edit: instruksi + Site Document ringkas (outline + section terkait) → RevisionPatch (add/remove/update terbatas) → terapkan → validasi → Revision baru — patch-based menjaga stabilitas & hemat token (FR-AGT-004).
Konten: topik → outline → artikel → metadata SEO → gambar sampul via ImageGen/stock → draft Post.
NEEDS_INFO: agent mengembalikan pertanyaan terstruktur; orchestrator mengubahnya jadi pertanyaan chatbot; jawaban melengkapi konteks lalu job dilanjutkan.

## 5.3 Pengendalian Biaya
Konteks minimal (outline + section relevan saja); cache klasifikasi intent frasa umum; batas token keras per job; anggaran harian per tenant dengan alarm via n8n.

## 5.4 Arsitektur Tools via MCP (Model Context Protocol)
Kemampuan platform diekspos sebagai kumpulan MCP server internal; agent engine berperan sebagai MCP host. Tool didefinisikan sekali (nama, deskripsi, skema input Zod→JSON Schema) dan dipakai oleh model apa pun — DeepSeek via bridge function-calling, atau model MCP-native tanpa bridge.
MCP Servers internal (in-process/stdio):
sitebuilder-mcp : list_components, get_site_outline, apply_patch,
create_page, set_theme_tokens (scope: tenant)
media-mcp       : list_assets, generate_image, search_stock, set_alt_text
content-mcp     : draft_article, keyword_brief, schedule_post
seo-mcp         : get_search_performance, request_indexing, run_onpage_audit
ops-mcp (read)  : get_quota, get_subscription_status, get_job_status
Setiap sesi agent membawa konteks tenant + scope; server MCP menegakkan otorisasi per tool (tenant hanya menyentuh datanya sendiri) dan mencatat setiap invokasi ke AuditLog.
Bridge DeepSeek: definisi tool MCP dikonversi otomatis menjadi skema function-calling; hasil eksekusi dikembalikan sebagai tool result — satu sumber kebenaran, dua protokol.
Manfaat jangka panjang: dashboard operator dapat memakai asisten AI apa pun yang MCP-capable untuk mengoperasikan platform (“suspend tenant X”, “berapa biaya AI minggu ini?”) tanpa endpoint khusus; integrasi eksternal masa depan cukup menambah MCP server baru (open/closed).

# 6. Kepatuhan Panduan Web Modern (web.dev / Google)
Seluruh situs klien wajib memenuhi praktik berikut; sebagian ditegakkan otomatis oleh sites-kit dan Lighthouse CI budget pada pipeline build (FR-PUB-010):


| Area | Praktik Wajib | Penegakan |
| --- | --- | --- |
| Core Web Vitals | LCP ≤ 2,5 dtk; INP < 200 ms; CLS < 0,1 | Lighthouse CI budget saat build; pemantauan lapangan via Umami + sampling CrUX |
| JavaScript | Zero-JS-by-default; hydration hanya pada islands interaktif (galeri, form) | Arsitektur Astro; budget total JS ≤ 50 KB per halaman |
| Gambar | AVIF/WebP dengan fallback, srcset responsif, lazy loading di bawah lipatan, dimensi eksplisit (anti-CLS) | Pipeline media + komponen Image sites-kit |
| Font | Font lokal (self-host), font-display: swap, subset Latin, preload font utama | Konfigurasi tema sites-kit |
| HTML & SEO | HTML semantik, meta/OG lengkap, sitemap & robots otomatis, structured data (LocalBusiness/Article) | Generator build (FR-PUB-008) |
| Aksesibilitas | Kontras AA, alt text (otomatis dari agent), navigasi keyboard, landmark | Aturan lint komponen + audit Lighthouse |
| Keamanan situs | HTTPS (AutoSSL), security headers via .htaccess yang dihasilkan build (CSP dasar, HSTS, no-sniff) | Template .htaccess sites-kit |
| Caching | Cache-Control agresif untuk aset ber-hash, HTML no-cache ringan | .htaccess hasil build |



# 7. Subsistem SEO “Heavy”
SEO ditegakkan di tiga titik siklus hidup situs (merinci modul SEO pada FRD v1.1):


| Titik | Kemampuan | Implementasi |
| --- | --- | --- |
| Saat generasi konten | Riset kata kunci ringan (input klien + data Search Console + saran LLM), brief artikel ber-target keyword, heading terstruktur, internal linking otomatis ke halaman terkait | content-mcp + seo-mcp; graf internal link dihitung dari Site Document & daftar Post |
| Saat build | Title/meta unik per halaman, canonical, OG/Twitter Card, JSON-LD (LocalBusiness, Product, Article, FAQPage, BreadcrumbList) tervalidasi, sitemap.xml, robots.txt, audit on-page (blokir publish bila kritis) | sites-kit + langkah validasi schema.org & audit di pipeline build (FR-SEO-001/002/007) |
| Pasca publish | Ping IndexNow + Search Console API, verifikasi kepemilikan GSC otomatis, tarik performa (klik/impresi/posisi), laporan bulanan & saran topik via WA | Worker + GscAdapter (AnalyticsPort diperluas); pengiriman laporan via n8n (FR-SEO-003/004/006) |


Keyword & performa per tenant disimpan (tabel SeoKeyword, SeoSnapshot) agar agent dapat menjawab pertanyaan SEO dengan data nyata (FR-SEO-008) dan memilih topik artikel yang menaikkan ranking, bukan topik acak.
Prasyarat teknis SEO (kecepatan, mobile, HTTPS, aksesibilitas) sudah dipenuhi bab 6 — kedua bab ini saling melengkapi.

# 8. Model Data (Prisma — Ringkasan Skema)
Skema indikatif; semua tabel domain memuat tenantId + timestamps; akses selalu melalui repository yang memfilter tenantId. Perubahan v1.1 ditandai (*).
model Tenant       { id, name, slug, status, planId, waNumbers[] ... }
model User         { id, tenantId, role(OWNER|STAFF), name, phone, email }
model Conversation { id, tenantId, channel(WA|WEB), state, escalatedAt? }
model Message      { id, conversationId, direction, type, text?, mediaId?,
providerMsgId @unique, status, createdAt }
model InterviewBrief { id, tenantId, data Json, completedAt? }
model Website      { id, tenantId @unique, slug @unique, status,
publishedRevisionId?, themeId, deploymentTargetId (*) }
model Revision     { id, websiteId, number, siteDoc Json, summary,
status(DRAFT|PREVIEW|APPROVED|PUBLISHED|REJECTED), createdBy }
model BuildArtifact(*) { id, revisionId @unique, storageKey, sizeBytes,
lighthouse Json?, builtAt }
model DeploymentTarget(*) { id, kind(CPANEL_SSH|CPANEL_FTP|CF_PAGES),
host, basePath, credsRef, active }
model Deployment(*) { id, websiteId, artifactId, targetId,
status(PENDING|DEPLOYED|FAILED|ROLLED_BACK), finishedAt? }
model ComponentDef { id, type, variant, schema Json, version, deprecated }
model Theme        { id, name, tokens Json }
model MediaAsset   { id, tenantId, kind(UPLOAD|AI|STOCK), storageKey, mime,
width?, height?, license?, altText?, source? }
model Post         { id, tenantId, title, slug, body Json, coverMediaId?,
status(DRAFT|SCHEDULED|PUBLISHED), publishAt? }
model CatalogItem  { id, tenantId, name, price, description, mediaIds[] }
model Lead(*)      { id, tenantId, formId, payload Json, forwardedAt?, spamScore }
model AgentJob     { id, tenantId, kind(BUILD|EDIT|ARTICLE|CATALOG|DOMAIN),
status, input Json, output Json?, error?, attempts,
tokenIn, tokenOut, costEstimate }
model LlmUsage     { id, tenantId, jobId?, provider, task, tokenIn, tokenOut, cost }
model Plan         { id, code(BASIC|PREMIUM), price, quotas Json }
model Subscription { id, tenantId @unique, planId, status, currentPeriodEnd,
xenditCustomerId?, xenditRecurringId? }
model Invoice      { id, tenantId, subscriptionId, amount, status,
xenditInvoiceId @unique, paidAt? }
model QuotaUsage   { id, tenantId, period, metric, used }
model DomainMapping{ id, tenantId, domain @unique, status, verifiedAt?, lastCheckAt }
model EscalationTicket { id, tenantId, conversationId, reason, status, assignee? }
model AuditLog     { id, actor, tenantId?, action, meta Json, createdAt }

# 9. Antarmuka API & Port Kunci


| Endpoint | Metode | Fungsi |
| --- | --- | --- |
| /webhooks/whatsapp | GET/POST | Verifikasi & terima event WABA (FR-CHN-001/005). |
| /webhooks/xendit | POST | Status pembayaran (FR-BIL-002), idempoten. |
| /api/chat (WS) | — | Web chat portal klien (FR-CHN-003). |
| /api/tenant/me, /api/billing/* | GET/POST | Profil, langganan, invoice, upgrade paket. |
| /api/preview/:revisionId?t=token | GET | Preview draft di VPS, noindex (FR-PUB-001). |
| /public/forms/:tenantKey | POST | Form kontak situs statis → anti-spam → Lead → WA klien (FR-ANL-003); CORS dibatasi domain situs tenant. |
| /internal/automation/* (token n8n) | GET/POST | Data untuk workflow n8n (laporan, dunning) dengan scope terbatas. |
| /api/admin/* (RBAC) | CRUD | Tenant, eskalasi, job, komponen, deploy, suspend (FR-ADM-*). |



## 9.1 Kontrak DeployPort & HostingControlPort
interface DeployPort {
deploy(a: { artifactKey: string; target: DeploymentTarget;
docrootPath: string }): Promise<Result<DeployReceipt, DeployError>>;
remove(target: DeploymentTarget, docrootPath: string): Promise<Result<void, DeployError>>;
}
interface HostingControlPort {
ensureSubdomain(slug: string): Promise<Result<{ docroot: string }, HostingError>>;
ensureAddonDomain(domain: string): Promise<Result<{ docroot: string }, HostingError>>;
checkSsl(host: string): Promise<Result<SslStatus, HostingError>>;
}
Implementasi MVP: CpanelUapiAdapter (subdomain/addon/AutoSSL) + RsyncSshDeployAdapter (fallback FtpDeployAdapter). Adapter cadangan CfPagesDeployAdapter disiapkan sebagai bukti portabilitas (NFR-12).

# 10. Kebutuhan Non-Fungsional (NFR)


| ID | Kategori | Kebutuhan | Target/Ukuran |
| --- | --- | --- | --- |
| NFR-01 | Kinerja situs | Core Web Vitals situs klien (mobile) | LCP ≤ 2,5 dtk; INP < 200 ms; CLS < 0,1; Lighthouse ≥ 90 |
| NFR-02 | Kinerja bot | Balasan chatbot non-AI (status, menu) | ≤ 2 dtk p95 |
| NFR-03 | Kinerja pipeline | Draft build pertama; publish (build+deploy) | Draft ≤ 10 mnt p90; publish ≤ 5 mnt p90 |
| NFR-04 | Skalabilitas | Kapasitas desain platform | 500 tenant, 200 job AI/jam; ±150 situs per akun hosting sebelum target kedua |
| NFR-05 | Ketersediaan | Uptime webhook & API; situs klien mengikuti SLA shared hosting | ≥ 99,5%/bulan; webhook antre saat worker mati |
| NFR-06 | Keandalan | Konsumsi webhook & job idempoten; deploy atomik (upload ke folder temp → swap) | 0 pesan hilang; tidak ada situs setengah ter-deploy |
| NFR-07 | Keamanan | TLS semua lalu lintas; rahasia (termasuk kredensial cPanel/SSH) di secret manager; RBAC admin; audit log; anti-spam form publik | Wajib |
| NFR-08 | Privasi (UU PDP) | Persetujuan pemrosesan saat onboarding; data platform di DC Indonesia; enkripsi at-rest; hak akses/hapus; retensi 90 hari pasca berhenti; analytics tanpa cookie pihak ketiga (Umami); data tidak dipakai melatih model pihak ketiga | Wajib |
| NFR-09 | Isolasi tenant | Guard tenantId di repository + docroot terpisah per tenant di hosting + uji kebocoran lintas tenant | Wajib |
| NFR-10 | Observabilitas | Log terstruktur, tracing job & deploy, metrik biaya AI per tenant, alerting via n8n (job gagal, webhook error, SSL gagal, inode hosting > 80%) | Dashboard sejak Fase 0 |
| NFR-11 | Maintainability | Coverage unit test lapisan application ≥ 70%; e2e alur kritis (build→approve→publish→situs live, billing) | CI wajib hijau |
| NFR-12 | Portabilitas vendor | Ganti provider LLM/ImageGen/storage/target deploy tanpa menyentuh domain/application | Terbukti via test kontrak adapter ganda |



# 11. Deployment & Operasional

## 11.1 Topologi Produksi Awal
VPS 4 vCPU / 8 GB / NVMe di DC Indonesia (IDCloudHost/Biznet): Docker Compose — caddy, api, worker, portal, postgres, redis, n8n, umami. Estimasi RAM: Postgres 1,5 GB, Redis 0,3 GB, api+worker 1,5 GB (spike build Astro +1–2 GB), n8n 0,4 GB, Umami 0,3 GB — headroom aman di 8 GB; swap 2 GB sebagai pengaman.
Build Astro dijalankan worker dengan konkurensi 1–2 dan nice/cgroup limit agar tidak mengganggu api; antrean build terpisah dari antrean job AI.
Shared hosting: docroot per tenant di bawah satu akun; deploy rsync incremental via SSH key khusus; .htaccess (headers & caching) dihasilkan build.
Backup: dump Postgres harian + object storage versioned; uji restore bulanan; artefak build = disaster recovery situs klien.

## 11.2 Jalur Skala
VPS kedua untuk worker/build saat antrean padat; akun hosting kedua atau reseller WHM saat mendekati ±150 situs (hanya menambah DeploymentTarget); DB managed bila diperlukan. Tanpa perubahan arsitektur kode (ADR-1).

## 11.3 Lingkungan & CI/CD
Lingkungan: development, staging (nomor WA uji + folder staging di hosting), production. Prisma Migrate otomatis di pipeline dengan gerbang persetujuan produksi.
CI (GitHub Actions): lint, typecheck, unit, kontrak adapter, e2e ringkas, build image; deploy otomatis staging, manual approve produksi.

# 12. Strategi Pengujian
Unit: use case dengan fake adapter; validasi skema komponen; aturan kuota & dunning.
Kontrak adapter: satu test suite dijalankan terhadap semua implementasi Port (LSP) — termasuk mock LLM deterministik dan mock DeployPort (server SSH lokal di CI).
Integrasi: webhook WABA & Xendit dengan payload rekaman nyata; idempotensi; alur NEEDS_INFO; cPanel UAPI terhadap akun staging hosting.
E2E: UC-01–UC-05 di staging termasuk publish nyata ke folder staging hosting; regresi visual komponen sites-kit (Playwright screenshot per komponen/tema).
Kualitas AI: golden set 20 brief usaha → evaluasi rubrik (kelengkapan, bahasa, kepatuhan skema) tiap perubahan prompt/model.
Kualitas web: Lighthouse CI budget wajib lolos pada 3 situs sampel setiap perubahan sites-kit.

# 13. Keterlacakan & Ketaatan
Setiap FR pada FRD v1.1 dipetakan ke modul bab 4–8 dokumen ini; setiap NFR memiliki mekanisme verifikasi (test/monitoring). Perubahan kebutuhan mengikuti kontrol versi dokumen: usulan → analisis dampak → persetujuan Product Owner → pembaruan BRD/PRD/FRD/SRS secara konsisten.


| Peran | Nama | Persetujuan |
| --- | --- | --- |
| Product Owner | Darusman |  |
| Lead Developer |  |  |



