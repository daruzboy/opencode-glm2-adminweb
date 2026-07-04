# QA Loop — digimaestro (TestSprite + Vitest)

Loop kualitas per sprint. Acuan: DevSetup dok. 09 §5, Backlog Fase 0 T-014 & T-080.

## 1. Pembagian tanggung jawab uji

| Lapisan uji | Alat | Pemilik |
| --- | --- | --- |
| Unit (use case, skema, aturan bisnis) | Vitest | Developer (ditulis agent, direview dev) |
| Kontrak adapter (LLM, Deploy, Storage, …) | Vitest suite tunggal lintas adapter | Developer |
| Regresi visual `sites-kit` | Playwright screenshot di CI | Developer |
| E2E fungsional & eksplorasi dari PRD/FRD | **TestSprite** | PO + TestSprite |
| UAT rasa-pakai (nada bot, alur WA) | Manual | PO |

> Piramida uji tetap berlaku: unit paling banyak. Jangan validasi logika kecil lewat
> TestSprite (e2e lambat & mahal).

## 2. Loop per sprint

```
            ┌──────────────────────────────────────────────────────────┐
            │  INPUT: PRD/FRD bagian terkait + URL staging + tenant uji │
            ▼                                                           │
   TestSprite buat TEST PLAN  ──►  REVIEW PO (buang tak relevan,       │
   (lihat test-plan-template.md)      tandai JALUR KRITIS)             │
            │                                                           │
            ▼                                                           │
   TestSprite jalankan suite terhadap staging                          │
            │                                                           │
            ▼                                                           │
   Klasifikasi temuan:  Kritis (blocker) · Mayor · Minor               │
            │                                                           │
   ┌────────┴────────┐                                                  │
   │ jalur kritis    │ hijau → GERBANG SPRINT LEWAT                     │
   │ ada Kritis?     │ merah  → temuan masuk puncak backlog sprint+1 ──┘
   └─────────────────┘             (loop kembali setelah diperbaiki)
```

### Jalur kritis wajib hijau di akhir tiap sprint (T-080)

1. Wawancara → preview → approve → publish (FR-PUB-001..004).
2. Webhook idempoten: duplikat `providerMsgId` tidak berefek ganda (FR-CHN-005).
3. Guard tenant: query tanpa `tenantId` gagal (NFR-09).
4. Form error & alur NEEDS_INFO (FR-AGT-006).

## 3. Cara TestSprite dijalankan

TestSprite terhubung sebagai **MCP server** ke harness agent (opencode), sudah
didaftarkan di `opencode.json`:

```jsonc
"mcp": { "TestSprite": { "command": ["npx","-y","@testsprite/testsprite-mcp@latest"],
   "environment": { "API_KEY": "{env:TESTSPRITE_API_KEY}" } } }
```

> **Catatan field:** nama field env MCP lokal opencode adalah **`environment`**
> (lihat `McpLocalConfig` di `https://opencode.ai/config.json`, `additionalProperties:
> false`). Field `env` DIABAIKAN → MCP di-spawn tanpa `API_KEY` → selalu "No API Key".
> Interpolasi `{env:VAR}` berlaku pada nilai string mana pun (termasuk di dalam
> `environment`). Config dimuat sekali saat startup; **setiap perubahan `opencode.json`
> wajib diikuti restart opencode** (tidak ada hot-reload).

**Prasyarat** (sebelum loop jalan):

1. Set env `TESTSPRITE_API_KEY` (ambil dari akun TestSprite). **Belum di-set** saat
   scaffold — agent tidak bisa memanggil TestSprite sebelum ini diisi.
2. Staging hidup: `docker compose up` di VPS + seed tenant uji (lihat Backlog T-002).
3. Berikan TestSprite konteks: `doc/PRD.md` + `doc/FRD.md` (referensi di
   `opencode.json` → `references.spec.path`).

Saat dijalankan dari opencode, minta agent: "jalankan test plan untuk slice builder
terhadap staging `<url>`". Hasilnya berupa laporan temuan ber-severity.

## 4. Gerbang CI vs Gerbang QA

- **CI (`.github/workflows/ci.yml`)** — setiap PR/push: `lint + typecheck + vitest`.
  Wajib hijau untuk bisa merge (branch protection).
- **QA gate (`.github/workflows/qa-gate.yml`)** — akhir sprint / manual: menjalankan
  suite TestSprite + e2e terhadap staging. Temuan **Kritis = blocker rilis**.

## 5. Catatan retensi temuan

- Semua temuan TestSprite dicatat dengan severity + ID tugas terkait.
- Temuan Kritis yang belum selesai **wajib** di puncak backlog sprint berikutnya.
- Simpan plan yang lolos review sebagai artifact sprint (reproducible).
