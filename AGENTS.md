# AGENTS.md — Kontrak untuk AI Coding Agent (digimaestro)

> Aturan permanen untuk agent coding (GLM 5.2 / opencode). Pelanggaran aturan
> bertanda **(WAJIB)** = tolak PR. Bukan tempat untuk menyimpan logika bisnis
> sesaat — yang demikian hidup di `doc/SRS.md` & backlog.

## 1. Konteks wajib baca sebelum bekerja

- `doc/SRS.md` → §4 (lapisan & SOLID), §5 (LLM/MCP), §9 (port & API), §8 (model data)
- `doc/FRD.md` → modul yang relevan dengan tugas aktif (CHN/CNV/AGT/CMP/...)
- `doc/PRD.md` → prioritas MoSCoW & persona (bahasa bot, approval-first)
- Tugas aktif: **satu ID** dari `doc/07-Backlog-Fase0-*.docx` (diberikan di prompt awal sesi)
- `docs/qa/README.md` → bagaimana QA berjalan (loop TestSprite)

## 2. Stack & struktur (SRS §2, §4.1)

```
apps/        api  worker  portal            # entry point (composition root)
packages/
  core/      domain + application (use case) # TIDAK boleh sentuh vendor SDK
  shared/    kernel (Result, DomainEvent) + ports (interface I/O)
  adapters/  implementasi Port (vendor SDK hanya di sini)
  sites-kit/ komponen Astro + tema + skema Zod
```

Tech: Node 22 LTS · TypeScript 5 (strict) · Fastify v5 · Prisma 6 + PostgreSQL 16 ·
BullMQ + Redis · Zod · Astro 5 + Tailwind 4 · React 19 + Vite 6 · pnpm + Turborepo ·
Vitest · MCP SDK. Perintah gerbang: `pnpm turbo lint test build`.

## 3. Aturan arsitektur (SRS §4.2 SOLID) — pelanggaran = tolak

- **Dependency rule**: `core` & `shared` **TIDAK boleh** `import` dari `adapters`/
  `apps` atau SDK vendor mana pun (Meta, Xendit, cPanel, DeepSeek, OpenAI, dll.).
  Vendor SDK hanya boleh diimpor di `packages/adapters`.
- Semua I/O eksternal lewat **interface di `packages/shared`** (Port). Use case
  bergantung pada Port, bukan implementasi. Implementasi disuntikkan di composition
  root (`apps/*`).
- Input di tepi sistem (webhook, REST, form publik) **divalidasi Zod**.
- Hasil operasi memakai **`Result<T, E>`** (lihat `@digimaestro/shared`); lempar
  exception hanya untuk kegagalan infrastruktur tak terduga.
- Setiap query DB lewat **repository ber-`tenantId`** — tanpa pengecualian. Tidak
  ada query lintas tenant (NFR-09).
- Komponen `sites-kit`: **wajib skema Zod** + styling **hanya via design token**,
  bukan nilai warna/spacing lepas.
- Tidak ada `any` tanpa komentar justifikasi (`eslint` memblokir).

## 4. Definisi selesai (Definition of Done) per tugas

- Unit test Vitest untuk use case / fungsi publik baru: **happy path + minimal 1 error path**.
- `pnpm turbo lint test build` **hijau**.
- Commit kecil, pesan: `<ID-TUGAS>: ringkasan` (mis. `T-021: tenant guard di repository`).
- Tidak menyentuh berkas di luar lingkup tugas.
- Bila menambah dependensi: sebutkan **alasan** di deskripsi PR.

## 5. Larangan

- Jangan menulis kredensial/rahasia apa pun di kode, test, atau contoh.
- Jangan menambah dependensi tanpa alasan di PR.
- Jangan mengabaikan failure test/lint — perbaiki, jangan `// @ts-ignore`/`eslint-disable`
  sebagai jalan pintas.
- Jangan mengerjakan lebih dari satu ID tugas per sesi (konteks kecil = akurat).
- Jangan menaruh keputusan arsitektur di prompt ad-hoc — tulis ke SRS/AGENTS.md.

## 6. Ritme kerja (DevSetup dok. 09 §4.3)

Satu sesi = satu ID tugas. Alur:
1. Baca tugas + kriteria terima + berkas terkait → buat **rencana singkat**.
2. Tunggu persetujuan rencana (atau langsung eksekusi bila tugas kecil & jelas).
3. Implement + tulis test.
4. Jalankan `pnpm turbo lint test` (dan `build` bila menyentuh struktur paket).
5. Review diff manual → commit/PR dengan pesan `<ID>: ringkasan`.

Jika agent melanggar arsitektur 2× berturut-turut: **berhenti**, perbaiki AGENTS.md/SRS
(aturannya kurang eksplisit), jangan dilawan di prompt.
