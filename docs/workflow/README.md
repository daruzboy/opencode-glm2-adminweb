# AI Workflow — digimaestro (Kolaborasi Multi-Agent)

> **Tujuan:** mendefinisikan cara berkolaborasi antar-agent AI di repo ini — siapa
> mengerjakan apa, kapan, dan bagaimana hand-off antar peran — agar setiap backlog
> ID berjalan konsisten, rapi secara arsitektur, dan lolos gerbang kualitas.
>
> **Audiens:** semua agent (Codex, OpenCode+GLM 5.2, TestSprite, Claude Code) dan PO.
>
> **Sumber kebenaran:** `decision.md` (status & keputusan FIX) · `AGENTS.md`
> (aturan teknis agent) · `context.md` (resume sesi) · `doc/` (BRD/PRD/FRD/SRS).
> Jika ada konflik, `decision.md` + `doc/` yang menang.
>
> _Dokumen ini = **alur kolaborasi antar-agent**. Aturan teknis coding tetap hidup
> di `AGENTS.md` & `doc/SRS.md` §4 — dokumen ini merujuk, bukan menggandakan._

---

## 1. Peran & Division of Labor

| Agent | Peran | Lingkup | Output utama | Kapan aktif |
| --- | --- | --- | --- | --- |
| **PO** (Darusman) | Product Owner | Prioritas backlog, spec, persetujuan, merge | Backlog ID, kriteria terima, approval | Tiap awal & akhir tugas, akhir sprint |
| **OpenAI/Codex** | Architect & Reviewer | Design brief pra-coding, review arsitektur & spec-alignment | Design brief, checklist review, approval/reject PR | Sebelum implementasi & sebelum merge |
| **OpenCode + GLM 5.2** | Developer (implementer) | Implementasi + unit test + dok. status | Kode, tes, PR, update `decision.md`/`context.md` | Saat implementasi tugas aktif |
| **TestSprite** | QA otomatis (e2e via MCP) | Suite e2e dari PRD/FRD terhadap staging | Test plan + laporan temuan ber-severity | Akhir sprint (jalur kritis), bukan per-PR |
| **Claude Code** | Cadangan (opsional) | Menggantikan Developer bila GLM 5.2 tersendat/blocked | Sama dgn Developer | Hanya saat dipanggil PO |

> **Konvensi penting:** satu sesi agent = **satu** backlog ID (AGENTS.md §5). Konteks
> kecil = akurat. Jangan campur ID dalam satu PR/sesi.

---

## 2. Matriks RACI per Fase Tugas

Fase: **Plan → Design → Implement → Test → Review → Merge → QA Sprint**
Peran: **PO · Codex (Arch/Reviewer) · OpenCode+GLM 5.2 (Developer) · TestSprite (QA) · Claude Code (cadangan)**

`R` = Responsible (mengerjakan) · `A` = Accountable (pengambil keputusan akhir) ·
`C` = Consulted · `I` = Informed · `–` = tidak terlibat

| Fase | PO | Codex | Developer (OpenCode+GLM 5.2) | TestSprite | Claude Code |
| --- | --- | --- | --- | --- | --- |
| **Plan** (assign ID + kriteria terima) | **A** | C | C | I | – |
| **Design** (design brief) | A | **R** | C | I | – |
| **Implement** (kode + unit test) | I | C | **R** | I | R (cadangan) |
| **Test** (unit/integrasi, gate) | I | C | **R** | I | R (cadangan) |
| **Review** (PR) | A | **R** | C | I | – |
| **Merge** (squash via PR) | **A/R** | C | I | I | – |
| **QA Sprint** (e2e jalur kritis) | A | I | C (perbaiki temuan) | **R** | R (cadangan) |

> **Satu A per baris** — tidak ada "joint ownership". PO selalu A pada approval;
> eksekusi diserahkan ke R.

---

## 3. Alur End-to-End per Satu Backlog ID

```
 ┌──────────────┐
 │ 1. PO assign │  PO menetapkan SATU backlog ID + kriteria terima
 │    ID        │  (dari doc/07-Backlog-Fase0-*.docx)
 └──────┬───────┘
        ▼
 ┌──────────────────┐
 │ 2. Codex design  │  Architect terbitkan DESIGN BRIEF:
 │    brief         │  cakupan file, port/interface baru, risiko,
 └──────┬───────────┘  dependensi, peta ke spec (FRD/SRS)
        ▼
 ┌──────────────────┐
 │ 3. PO approve    │  PO setujui brief (atau Developer langsung
 │    brief         │  eksekusi bila tugas kecil & jelas — AGENTS.md §6)
 └──────┬───────────┘
        ▼
 ┌──────────────────┐
 │ 4. Developer     │  Branch feature/<id>-<ringkas> → implementasi +
 │    implement+    │  unit test (happy + ≥1 error path). Update
 │    test          │  decision.md/context.md DLM COMMIT YG SAMA.
 └──────┬───────────┘
        ▼
 ┌──────────────────┐
 │ 5. Gate hijau    │  pnpm lint && pnpm test && pnpm build  → semua lolos
 └──────┬───────────┘
        ▼
 ┌──────────────────┐
 │ 6. PR ke main    │  Deskripsi: ID, kriteria terima, ringkas
 │                  │  perubahan, hasil gate, catatan/risk
 └──────┬───────────┘
        ▼
 ┌──────────────────┐
 │ 7. Codex review  │  Cek boundary arsitektur + spec-alignment +
 │                  │  cakupan tes + tidak ada file di luar lingkup
 └──────┬───────────┘
        ▼
 ┌──────────────────┐
 │ 8. PO merge      │  Squash merge via PR (branch --delete-branch)
 │    (squash)      │  Push langsung ke main DIBLOK branch protection
 └──────┬───────────┘
        ▼
 ┌──────────────────┐
 │ 9. QA Sprint     │  TestSprite jalankan suite e2e terhadap staging
 │    (akhir sprint)│  → jalur kritis WAJIB hijau (lihat docs/qa/README.md)
 └──────────────────┘
```

---

## 4. Aturan Kerja SEBELUM Coding

1. **Satu backlog ID per sesi** (AGENTS.md §5) — dilarang campur ID dalam satu PR.
2. **Developer wajib baca berurutan:** `decision.md` → `context.md` → `AGENTS.md`
   → bagian `doc/FRD.md`/`doc/SRS.md` yang relevan dengan ID.
3. **Architect (Codex) terbitkan design brief** sebelum developer menulis kode,
   berisi minimal: kriteria terima, daftar file yang disentuh, port/interface baru,
   risiko arsitektur, dan dependensi.
4. **PO menyetujui design brief** — kecuali tugas kecil & jelas, developer boleh
   langsung eksekusi (AGENTS.md §6).
5. **Cek dependency rule sebelum sentuh file:** `core`/`shared` TIDAK boleh import
   `adapters`/`apps`/SDK vendor mana pun (dijaga ESLint `no-restricted-imports`).
6. **Buat branch `feature/<id>-<ringkas>`** sebelum menulis apa pun (lihat §7).
7. **Jangan mulai tugas yang masih terblokir** jalur kritis EPIC-00 (cek status di
   `decision.md` §2) — pilih ID lain yang tidak bergantung blocker.

---

## 5. Aturan Kerja SAAT Implementasi

1. **Ikuti SOLID & dependency rule** (SRS §4.2) — vendor SDK (Meta, Xendit, cPanel,
   DeepSeek, OpenAI, Prisma, dll.) **hanya** di `packages/adapters`.
2. **Semua I/O eksternal lewat Port** di `packages/shared`; use case bergantung pada
   Port, bukan implementasi. Implementasi disuntikkan di composition root (`apps/*`).
3. **Validasi Zod di tepi sistem** (webhook, REST, form publik).
4. **Hasil operasi pakai `Result<T,E>`** (`@digimaestro/shared`); `throw` hanya untuk
   kegagalan infrastruktur tak terduga.
5. **Setiap query DB lewat repository ber-`tenantId`** (NFR-09) — tanpa pengecualian.
   Tidak ada query lintas tenant.
6. **`sites-kit`:** wajib skema Zod + styling **hanya via design token** (bukan
   nilai warna/spacing lepas).
7. **Tidak ada `any`** tanpa komentar justifikasi (ESLint memblokir); tidak
   menambah komentar kecuali diminta.
8. **Commit kecil & sering** — satu commit = satu perubahan logis.
9. **Tidak menyentuh file di luar lingkup tugas** (AGENTS.md §4).
10. **Tidak menulis kredensial/rahasia** di kode, test, atau contoh.

---

## 6. Aturan Kerja SETELAH Coding

1. **Unit test Vitest** untuk setiap use case/fungsi publik baru: **happy path +
   minimal 1 error path** (AGENTS.md §4).
2. **Gerbang wajib hijau:** `pnpm lint && pnpm test && pnpm build` (detail §8).
3. **Perbarui `decision.md`/`context.md`** dalam **commit yang sama** dengan
   perubahan: status tugas, keputusan desain baru, blocker baru.
4. **Review diff manual** sebelum commit — baca apa yang akan dikirim.
5. **Buka PR ke `main`** — jangan push langsung (diblok branch protection).
6. **Reviewer (Codex) cek:** boundary arsitektur, spec-alignment (FRD/PRD), cakupan
   tes, tidak ada file di luar lingkup, tidak ada `@ts-ignore`/`eslint-disable`
   sebagai jalan pintas.
7. **QA TestSprite dijalankan di akhir sprint** (bukan per-PR) terhadap staging —
   jalur kritis wajib hijau (`docs/qa/README.md`).

---

## 7. Git: Branch / Commit / PR

| Item | Aturan |
| --- | --- |
| **Branch** | `feature/<id-tugas>-<ringkas>` (mis. `feature/t-052-mcp-sdk`) |
| **Base** | `main` saja |
| **Commit message** | `<ID-TUGAS>: ringkasan` (mis. `T-052: MCP server bridge`) |
| **Push ke `main` langsung** | **DIBLOK** (branch protection: require `lint + typecheck + vitest`, strict, up-to-date, `enforce_admins`, linear history) |
| **Merge strategy** | **Squash merge** via PR |
| **Branch pasca-merge** | Dihapus (`--delete-branch`) |
| **PR description wajib** | ID tugas, kriteria terima, ringkas perubahan, hasil gate, catatan/risk |
| **Dependensi baru** | Sebutkan **alasan** di deskripsi PR (AGENTS.md §4) |
| **File di luar lingkup** | Jangan sentuh (AGENTS.md §4) |

> Repo bersifat **public** (dipilih PO agar branch protection jalan di akun free);
> secret tetap tersembunyi — jangan commit `.env` atau kredensial apa pun.

---

## 8. Command Wajib

| Command | Fungsi | Kapan |
| --- | --- | --- |
| `pnpm lint` | `turbo run lint` — ESLint 9 flat per workspace | Sebelum commit |
| `pnpm build` | `turbo run build` — `tsc` per workspace (juga = typecheck, output `dist/`) | Sebelum commit |
| `pnpm test` | `turbo run test` — Vitest (`dependsOn: ["build"]` → build jalan otomatis lebih dulu) | Sebelum commit |
| `pnpm typecheck` | Alias ke `turbo run build` — cek tipe cepat | Cek tipe cepat |
| `pnpm format` / `pnpm format:check` | Prettier write / check | Sebelum commit (disarankan) |
| **Gerbang penuh** | **`pnpm lint && pnpm test && pnpm build`** | **Wajib hijau sebelum PR/merge** |

> **Catatan:**
> - `pnpm test` sudah memicu `build` lebih dulu (lihat `turbo.json`), sehingga
>   gerbang penuh di atas menjalankan `build` dua kali (cached oleh Turbo).
>   Urutan ini dipakai agar `lint` gagal cepat sebelum test/build yang lebih berat.
> - Jangan gunakan `pnpm turbo lint test build` — tidak terdaftar sebagai script di
>   `package.json`. Gunakan `pnpm lint && pnpm test && pnpm build`.
> - CI (`.github/workflows/ci.yml`) sudah menjalankan `lint + typecheck + vitest`
>   lewat branch protection — gerbang lokal di atas = cermin gerbang CI.

---

## 9. Hand-off Antar Agent (Kontrak)

### 9.1 Architect (Codex) → Developer (OpenCode+GLM 5.2): Design Brief
Wajib berisi:
- Backlog ID + ringkasan tujuan.
- Kriteria terima (testable).
- Daftar file yang akan disentuh (baru/modifikasi).
- Port/interface baru yang perlu dibuat di `packages/shared`.
- Pemetaan ke spec (`doc/FRD.md`/`doc/SRS.md` section).
- Risiko arsitektur + dependensi baru (jika ada, + alasannya).

### 9.2 Developer → Reviewer (Codex): PR Description
Wajib berisi:
- Backlog ID.
- Kriteria terima + bukti pemenuhan (tes yang ditulis).
- Ringkas perubahan (apa & mengapa).
- Hasil gate (`pnpm lint && pnpm test && pnpm build` → semua hijau).
- Catatan/risk + dependensi baru (+ alasan).
- Penanda bila dok. status (`decision.md`/`context.md`) ikut diperbarui.

### 9.3 Reviewer (Codex) → Developer: Checklist Review
- [ ] Boundary arsitektur terjaga (core/shared tak import adapters/apps/vendor).
- [ ] Spec-alignment (FRD/PRD) — fitrus sesuai kriteria terima.
- [ ] Cakupan tes cukup (happy + error path).
- [ ] Tidak ada file di luar lingkup tugas.
- [ ] Tidak ada `@ts-ignore`/`eslint-disable` tanpa justifikasi.
- [ ] Query DB ber-`tenantId` (NFR-09).

### 9.4 Kapan TestSprite Dipanggil
- **Bukan per-PR.** Dipanggil di **akhir sprint** terhadap staging.
- PO meminta via opencode: "jalankan test plan untuk <modul> terhadap staging `<url>`".
- Prasyarat: staging hidup + seed tenant uji + API key TestSprite valid
  (`TESTSPRITE_API_KEY`).
- Jalur kritis wajib hijau: wawancara→preview→approve→publish, webhook idempoten,
  guard tenant, form error & alur NEEDS_INFO (rinci di `docs/qa/README.md` §2).

---

## 10. Eskalasi & Blocker

- **Arsitektur dilanggar 2× berturut-turut oleh agent:** **STOP**. Perbaiki
  `AGENTS.md`/`doc/SRS.md` (aturannya kurang eksplisit), jangan dilawan di prompt.
  (AGENTS.md §6.)
- **QA TestSprite temuan Kritis:** wajib di **puncak backlog sprint berikutnya**;
  rilis diblokir sampai hijau (`docs/qa/README.md` §2).
- **Jalur kritis EPIC-00 tersendat** (T-001 verifikasi WABA, T-002 kredensial):
  dorong PO; development tetap jalan pada ID non-blocked.
- **Claude Code masuk** hanya saat PO memanggil — sebagai cadangan Developer bila
  GLM 5.2 tersendat/blocked. Mengikuti seluruh aturan dokumen ini tanpa pengecualian.
- **Kebocoran lintas tenant (NFR-09):** = blocker mutlak; langsung perbaiki, tidak
  boleh di-skip.

---

## 11. Referensi Silang

| Dokumen | Isi | Kapan dirujuk |
| --- | --- | --- |
| `AGENTS.md` | Aturan teknis agent coding (stack, arsitektur, DoD, larangan) | Setiap sesi, wajib baca |
| `decision.md` | Sumber kebenaran: keputusan FIX, status pekerjaan, risiko | Awal setiap sesi |
| `context.md` | Resume sesi + catatan teknis penting | Awal setiap sesi |
| `docs/qa/README.md` | Loop QA TestSprite per sprint | Akhir sprint, saat hand-off QA |
| `doc/PRD.md` | Prioritas MoSCoW + persona (spec kanonik TestSprite) | Saat menulis/validasi tes |
| `doc/FRD.md` | Modul fungsional (CHN/CNV/AGT/CMP/…) | Saat design brief & review |
| `doc/SRS.md` | Arsitektur, lapisan, port, model data, NFR | Saat implementasi & review |

---

_Prookol update:_ perubahan pada alur kolaborasi → perbarui dokumen ini dalam
commit terpisah dengan pesan `docs/workflow: ringkasan`. Keputusan arsitektur
permanen → tulis ke `decision.md`/`AGENTS.md`/`doc/SRS.md`, bukan prompt ad-hoc.
