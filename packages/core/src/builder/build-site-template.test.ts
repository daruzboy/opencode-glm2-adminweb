// P4: build dari template — LLM hanya MEMILIH & MENGISI; kode yang merakit. Diuji penuh
// offline dengan port fake (pola repo: use case murni + fake, tanpa DB/HTTP).

import { describe, expect, it, vi } from 'vitest';
import { err, ok, tenantId } from '@digimaestro/shared';
import type {
  LlmJsonPort,
  LlmJsonRequest,
  TemplateCatalogPort,
  TemplateContract,
  TemplateSummary,
} from '@digimaestro/shared';
import { buildSiteFromTemplateBrief, fillSchema } from './build-site-template.js';

const T = tenantId('t1');

const SUMMARIES: TemplateSummary[] = [
  { id: 'tpl-rental', name: 'Rental', description: 'utk rental', businessTypes: ['rental'], tags: [], pageCount: 1, textSlots: 2, imageSlots: 1 },
  { id: 'tpl-toko', name: 'Toko', description: 'utk toko', businessTypes: ['toko'], tags: [], pageCount: 1, textSlots: 2, imageSlots: 0 },
];

const CONTRACT: TemplateContract = {
  templateId: 'tpl-rental',
  pages: [
    {
      slug: 'index',
      title: 'Beranda',
      slots: [
        { editId: 'e0', blockIndex: 0, kind: 'text', hint: 'hero · Judul', current: 'Judul Bawaan' },
        { editId: 'e1', blockIndex: 0, kind: 'image', hint: 'hero · foto', current: 'a.jpg' },
      ],
    },
  ],
};

function fakeCatalog(over: Partial<TemplateCatalogPort> = {}): TemplateCatalogPort {
  return {
    shortlist: vi.fn(async () => ok(SUMMARIES)),
    getContract: vi.fn(async () => ok(CONTRACT)),
    materialize: vi.fn(async (id) => ok({ templateId: id, pages: [] })),
    ...over,
  };
}

// LLM fake: jawab per task (template_pick lalu slot_fill), MELALUI schema seperti adapter
// nyata (schema yang menyanitasi harus benar-benar dipakai).
function fakeLlm(answers: Record<string, unknown>): LlmJsonPort & { calls: LlmJsonRequest<unknown>[] } {
  const calls: LlmJsonRequest<unknown>[] = [];
  return {
    name: 'LlmJsonPort' as never,
    calls,
    async completeJson(req) {
      calls.push(req as LlmJsonRequest<unknown>);
      const raw = answers[req.task];
      const parsed = req.schema.safeParse(raw);
      if (!parsed.success) return err({ code: 'INVALID_SCHEMA', message: parsed.error.message, retryable: false, attempt: 1 });
      return ok(parsed.data);
    },
  } as never;
}

function fakeRepos() {
  return {
    websites: {
      findByTenantId: vi.fn(async () => ok({ id: 'w1', slug: 's', status: 'DRAFTING' })),
    } as never,
    revisions: {
      create: vi.fn(async (_t: unknown, input: Record<string, unknown>) =>
        ok({ id: 'r1', number: 1, ...input }),
      ),
      update: vi.fn(async () => ok({ id: 'r1', number: 1 })),
    } as never,
  };
}

const REQ = {
  tenantId: T,
  websiteId: 'w1',
  brief: { businessName: 'Sewabos', businessType: 'rental mobil' },
};

describe('buildSiteFromTemplateBrief', () => {
  it('pilih → isi → materialize → Revision mobirise-v1 ber-templateId', async () => {
    const catalog = fakeCatalog();
    const { websites, revisions } = fakeRepos();
    const llm = fakeLlm({
      template_pick: { templateId: 'tpl-rental' },
      slot_fill: { fills: { e0: { kind: 'text', text: 'Sewabos Rental' } } },
    });

    const res = await buildSiteFromTemplateBrief(
      { llm, revisions, websites, catalog, mediaUrls: async () => [] },
      REQ,
    );

    expect(res.ok).toBe(true);
    expect(catalog.materialize).toHaveBeenCalledWith('tpl-rental', [
      { slug: 'index', fills: { e0: { kind: 'text', text: 'Sewabos Rental' } } },
    ]);
    expect((revisions as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledWith(
      T,
      expect.objectContaining({ renderEngine: 'mobirise-v1', templateId: 'tpl-rental', status: 'DRAFT' }),
    );
  });

  // Template nyata bisa 150+ slot per halaman; satu panggilan memotong batas output
  // (uji kontainer 2026-07-14). Halaman besar HARUS dipecah dan hasilnya digabung.
  it('halaman >40 slot → slot_fill dipecah per kelompok, isian DIGABUNG', async () => {
    const banyakSlot = Array.from({ length: 90 }, (_, i) => ({
      editId: `e${i}`,
      blockIndex: 0,
      kind: 'text' as const,
      hint: 'blok · Teks',
      current: `bawaan ${i}`,
    }));
    const catalog = fakeCatalog({
      getContract: vi.fn(async () =>
        ok({ templateId: 'tpl-rental', pages: [{ slug: 'index', title: 'B', slots: banyakSlot }] }),
      ),
    });
    const { websites, revisions } = fakeRepos();
    // Tiap panggilan slot_fill mengisi slot PERTAMA di kelompoknya → bukti tiap kelompok
    // benar-benar dipanggil & digabung.
    const llm = {
      name: 'LlmJsonPort',
      calls: [] as LlmJsonRequest<unknown>[],
      async completeJson(req: LlmJsonRequest<unknown>) {
        this.calls.push(req);
        if (req.task === 'template_pick') {
          return ok(req.schema.safeParse({ templateId: 'tpl-rental' }) as never).ok
            ? ok({ templateId: 'tpl-rental' } as never)
            : err({ code: 'INVALID_SCHEMA', message: 'x', retryable: false, attempt: 1 });
        }
        // Isi slot pertama yang muncul di prompt kelompok ini.
        const m = req.messages[0]?.content.match(/- (e\d+) \[text\]/);
        const parsed = req.schema.safeParse({
          fills: { [m?.[1] ?? 'e0']: { kind: 'text', text: `isi-${m?.[1]}` } },
        });
        return parsed.success ? ok(parsed.data as never) : err({ code: 'INVALID_SCHEMA', message: parsed.error.message, retryable: false, attempt: 1 });
      },
    };

    const res = await buildSiteFromTemplateBrief(
      { llm: llm as never, revisions, websites, catalog },
      REQ,
    );

    expect(res.ok).toBe(true);
    const fillCalls = llm.calls.filter((c) => c.task === 'slot_fill');
    expect(fillCalls.length).toBe(4); // 90 slot / 25 = 4 kelompok
    const fills = (catalog.materialize as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.[0]?.fills;
    expect(Object.keys(fills)).toEqual(['e0', 'e25', 'e50', 'e75']); // gabungan semua kelompok
  });

  it('LLM memilih id di LUAR shortlist → LLM_FAILED (schema menolak, bukan diam-diam pakai)', async () => {
    const llm = fakeLlm({ template_pick: { templateId: 'tpl-hack' } });
    const { websites, revisions } = fakeRepos();

    const res = await buildSiteFromTemplateBrief(
      { llm, revisions, websites, catalog: fakeCatalog() },
      REQ,
    );

    expect(!res.ok && res.error.code).toBe('LLM_FAILED');
  });

  // P5: gerbang review PO.
  it('handoff aktif + template BARU → revisi PENDING_ADMIN_REVIEW + kirim ke editor + alert PO', async () => {
    const catalog = fakeCatalog();
    const { websites, revisions } = fakeRepos();
    const llm = fakeLlm({
      template_pick: { templateId: 'tpl-rental' },
      slot_fill: { fills: {} },
    });
    const handoff = {
      createProject: vi.fn(async () => ok({ projectId: 'proj-1', editorUrl: 'http://editor/?project=proj-1' })),
    };
    const alert = { notify: vi.fn(async () => ok(undefined)) };

    const res = await buildSiteFromTemplateBrief(
      { llm, revisions, websites, catalog, handoff: handoff as never, alert: alert as never, publicApiUrl: 'http://api' },
      REQ,
    );

    expect(res.ok).toBe(true);
    const create = (revisions as { create: ReturnType<typeof vi.fn> }).create;
    expect(create).toHaveBeenCalledWith(T, expect.objectContaining({ status: 'PENDING_ADMIN_REVIEW' }));
    expect(handoff.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 'tpl-rental',
        source: expect.objectContaining({ returnUrl: 'http://api/api/internal/review/complete' }),
      }),
    );
    // Korelasi disimpan + PO di-alert dgn tautan editor.
    expect((revisions as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(
      T, 'w1', expect.any(String), { editorProjectId: 'proj-1' },
    );
    expect(alert.notify).toHaveBeenCalledWith(expect.objectContaining({ key: 'review-pending' }));
  });

  it('template SAMA dgn approvedTemplateId → DRAFT langsung, TANPA handoff (perubahan isi lewat)', async () => {
    const { revisions } = fakeRepos();
    const websites = {
      findByTenantId: vi.fn(async () =>
        ok({ id: 'w1', slug: 's', status: 'DRAFTING', approvedTemplateId: 'tpl-rental' }),
      ),
    } as never;
    const handoff = { createProject: vi.fn() };
    const llm = fakeLlm({ template_pick: { templateId: 'tpl-rental' }, slot_fill: { fills: {} } });

    const res = await buildSiteFromTemplateBrief(
      { llm, revisions, websites, catalog: fakeCatalog(), handoff: handoff as never },
      REQ,
    );

    expect(res.ok).toBe(true);
    expect((revisions as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledWith(
      T, expect.objectContaining({ status: 'DRAFT' }),
    );
    expect(handoff.createProject).not.toHaveBeenCalled();
  });

  it('handoff GAGAL → build tetap sukses (fail-soft), alert error berisi cara memicu ulang', async () => {
    const { websites, revisions } = fakeRepos();
    const alert = { notify: vi.fn(async () => ok(undefined)) };
    const handoff = { createProject: vi.fn(async () => err({ code: 'HTTP', message: 'editor mati' })) };
    const llm = fakeLlm({ template_pick: { templateId: 'tpl-rental' }, slot_fill: { fills: {} } });

    const res = await buildSiteFromTemplateBrief(
      { llm, revisions, websites, catalog: fakeCatalog(), handoff: handoff as never, alert: alert as never },
      REQ,
    );

    expect(res.ok).toBe(true); // revisi PENDING sudah ada; pelanggan diberi ekspektasi
    expect(alert.notify).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'review-handoff-failed', severity: 'error' }),
    );
  });

  it('katalog kosong → error yang menyebut cara memperbaikinya', async () => {
    const catalog = fakeCatalog({ shortlist: vi.fn(async () => ok([])) });
    const { websites, revisions } = fakeRepos();
    const res = await buildSiteFromTemplateBrief(
      { llm: fakeLlm({}), revisions, websites, catalog },
      REQ,
    );
    expect(!res.ok && res.error.message).toContain('templates:index');
  });
});

describe('fillSchema — sanitasi isian LLM', () => {
  const page = CONTRACT.pages[0]!;

  it('URL gambar di luar media tenant → DIBUANG (slot keep), bukan lolos', () => {
    const s = fillSchema(page, ['https://digimaestro.id/media/t1/asli.webp']);
    const r = s.safeParse({
      fills: {
        e1: { kind: 'image', url: 'https://evil.example/x.jpg', alt: 'x' },
        e0: { kind: 'text', text: 'Halo' },
      },
    });
    expect(r.success && r.data.fills).toEqual({ e0: { kind: 'text', text: 'Halo' } });
  });

  it('editId tak dikenal / kind tak cocok slot → dibuang', () => {
    const s = fillSchema(page, []);
    const r = s.safeParse({
      fills: {
        zzz: { kind: 'text', text: 'X' }, // id asing
        e1: { kind: 'text', text: 'salah kind utk slot image' },
      },
    });
    expect(r.success && Object.keys(r.data.fills)).toEqual([]);
  });

  it('bukan objek fills → gagal (biar adapter self-repair)', () => {
    const s = fillSchema(page, []);
    expect(s.safeParse({ judul: 'x' }).success).toBe(false);
  });
});
