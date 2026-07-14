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

  it('LLM memilih id di LUAR shortlist → LLM_FAILED (schema menolak, bukan diam-diam pakai)', async () => {
    const llm = fakeLlm({ template_pick: { templateId: 'tpl-hack' } });
    const { websites, revisions } = fakeRepos();

    const res = await buildSiteFromTemplateBrief(
      { llm, revisions, websites, catalog: fakeCatalog() },
      REQ,
    );

    expect(!res.ok && res.error.code).toBe('LLM_FAILED');
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
