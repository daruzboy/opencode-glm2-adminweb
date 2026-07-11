# digimaestro.id

Platform **website builder untuk UMKM Indonesia** lewat percakapan: pelanggan mengobrol dengan
bot, agent AI mewawancarai kebutuhan, membangun situs, meminta persetujuan, lalu menerbitkannya
ber-HTTPS — tanpa pelanggan menyentuh editor apa pun.

Alur inti yang sudah berjalan end-to-end:

```
chat → wawancara → agent bangun situs → tombol "Setuju & publish" → deploy → situs live
```

Kanal Fase 0 memakai **Telegram** (ADR-11); WhatsApp/WABA ditunda menunggu verifikasi Meta, dan
masuk belakangan sebagai adapter di `ChannelPort` yang sama — tanpa mengubah core.

---

## Baca ini dulu

| Dokumen | Isi |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **Kontrak wajib untuk AI coding agent** — aturan arsitektur, larangan, definisi selesai |
| [`decision.md`](decision.md) | **Sumber kebenaran proyek** — keputusan terkunci (ADR), status backlog, hal tertunda |
| [`context.md`](context.md) | Resume sesi — di mana kita sekarang, langkah berikutnya |
| [`docs/workflow/README.md`](docs/workflow/README.md) | Alur kerja multi-agent & konvensi PR |
| [`docs/qa/README.md`](docs/qa/README.md) | Loop QA (TestSprite) |

Spesifikasi normatif: [`doc/BRD.md`](doc/BRD.md) · [`doc/PRD.md`](doc/PRD.md) ·
[`doc/FRD.md`](doc/FRD.md) · [`doc/SRS.md`](doc/SRS.md) (arsitektur, port, model data, ADR).

## Stack

Node 22 · TypeScript 5 (strict) · Fastify 5 · Prisma 6 + PostgreSQL 16 · BullMQ + Redis 7 ·
Zod · Astro 5 (sites-kit) · React 19 (portal) · pnpm + Turborepo · Vitest.

## Struktur monorepo

```
apps/
  api        Fastify — chat, webhook kanal, preview, publish (composition root)
  worker     BullMQ — konsumen antrean: pesan masuk, build & publish situs
  portal     React — widget chat & admin
packages/
  core       Domain + use case. TIDAK boleh menyentuh vendor SDK.
  shared     Kernel (Result, TenantId) + Port (interface I/O)
  adapters   Implementasi Port. SATU-SATUNYA tempat vendor SDK diimpor.
  sites-kit  Model Site Document (Zod), tema/design token, renderer statis
```

**Dependency rule (ditegakkan ESLint):** `core`/`shared` tidak boleh mengimpor `adapters`, `apps`,
maupun SDK vendor. Semua I/O lewat Port; implementasi disuntik di composition root (`apps/*`).
Setiap query DB lewat repository ber-`tenantId` (isolasi multi-tenant, NFR-09). Detail di
[`AGENTS.md`](AGENTS.md) §3.

## Quick start

```bash
pnpm install
pnpm --filter @digimaestro/adapters db:generate   # Prisma client (postinstall tak selalu jalan)
pnpm turbo lint test build                        # gerbang — wajib hijau sebelum PR
```

Menjalankan stack lengkap (Postgres, Redis, api, worker): lihat `docker-compose.yml` dan
`.env.example` (template env — **tanpa nilai**).

## Catatan

- **Repo ini publik.** Tidak ada kredensial di dalamnya: token bot, API key LLM, dan kredensial
  hosting hidup di `.env` deploy **di luar repo**. Jangan pernah meng-commit rahasia.
- Push langsung ke `main` diblokir; semua perubahan lewat PR dengan CI hijau
  (`lint + typecheck + vitest`).
- Bahasa bot ke pelanggan: **Indonesia santai-profesional** (PRD). Komentar kode & dokumen kerja
  juga berbahasa Indonesia; identifier kode berbahasa Inggris.
