// P3: indexer (folder → registry DB) + katalog (shortlist/kontrak/materialize).
// Fixture template SINTETIS dibuat runtime — template asli berlisensi & di-gitignore.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { indexTemplates, type TemplateDelegate } from '../template-indexer.js';
import { TemplateCatalogFs, overlapScore, type TemplateQueryDelegate } from '../template-catalog.js';

let root: string;

const PROJECT = {
  settings: {
    theme: { styling: { primaryColor: '#0a0' } },
    siteFonts: [],
  },
  pages: {
    'index.html': {
      settings: { title: 'Beranda' },
      components: [
        {
          _cid: 'c1',
          _name: 'hero',
          _customHTML:
            '<section class="hero"><h1 class="mbr-section-title">Halo</h1>' +
            '<img src="a.jpg" alt="foto"></section>',
        },
      ],
    },
  },
};

const MANIFEST = {
  name: 'Tema Uji',
  description: 'Template uji untuk usaha rental.',
  businessTypes: ['rental', 'transportasi'],
  tags: ['biru'],
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tpl-reg-'));
  const tpl = join(root, 'tpl-rental');
  await mkdir(tpl, { recursive: true });
  await writeFile(join(tpl, 'project.mobirise'), JSON.stringify(PROJECT));
  await writeFile(join(tpl, 'template.json'), JSON.stringify(MANIFEST));
  // Folder rusak (tanpa template.json) → error terlaporkan, tak menghentikan yang lain.
  const rusak = join(root, 'tpl-rusak');
  await mkdir(rusak, { recursive: true });
  await writeFile(join(rusak, 'project.mobirise'), '{}');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function fakeDelegate() {
  const rows = new Map<string, Record<string, unknown>>();
  const delegate: TemplateDelegate = {
    upsert: vi.fn(async (args) => {
      rows.set(args.where.id, { id: args.where.id, ...args.update });
      return {};
    }),
    updateMany: vi.fn(async () => ({ count: 2 })),
  };
  return { rows, delegate };
}

describe('indexTemplates', () => {
  it('folder valid terindeks dengan slotSummary hasil derive; yang rusak dilaporkan', async () => {
    const { rows, delegate } = fakeDelegate();
    const report = await indexTemplates({ templatesDir: root, delegate });

    expect(report.indexed).toEqual(['tpl-rental']);
    // Folder rusak TIDAK menghentikan indeks, tapi HARUS terlihat.
    expect(report.errors.some((e) => e.includes('tpl-rusak'))).toBe(true);
    expect(report.deactivated).toBe(2);

    const row = rows.get('tpl-rental') as {
      businessTypes: string[];
      slotSummary: { pageCount: number; textSlots: number; imageSlots: number };
      sourceHash: string;
    };
    expect(row.businessTypes).toEqual(['rental', 'transportasi']);
    expect(row.slotSummary.pageCount).toBe(1);
    expect(row.slotSummary.textSlots).toBeGreaterThan(0);
    expect(row.slotSummary.imageSlots).toBe(1);
    expect(row.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('folder kosong → laporan kosong, nonaktifkan semua baris (folder = sumber kebenaran)', async () => {
    const { delegate } = fakeDelegate();
    const report = await indexTemplates({ templatesDir: join(root, 'tak-ada'), delegate });
    expect(report.indexed).toEqual([]);
  });
});

describe('overlapScore + shortlist', () => {
  it('skor dua arah: "rental mobil" cocok dgn keyword "rental" maupun "rental kendaraan"', () => {
    expect(overlapScore('rental mobil', ['rental'])).toBeGreaterThan(0);
    expect(overlapScore('rental mobil', ['rental kendaraan'])).toBeGreaterThan(0);
    expect(overlapScore('warung sate', ['rental'])).toBe(0);
  });

  it('shortlist mengurutkan yang paling cocok dulu; tanpa kecocokan → tetap top-N (bukan kosong)', async () => {
    const rowsDb = [
      { id: 'tpl-toko', name: 'Toko', description: 'd', businessTypes: ['toko', 'retail'], tags: [], slotSummary: {} },
      { id: 'tpl-rental', name: 'Rental', description: 'd', businessTypes: ['rental'], tags: [], slotSummary: {} },
    ];
    const delegate: TemplateQueryDelegate = { findMany: async () => rowsDb };
    const catalog = new TemplateCatalogFs({ templatesDir: root, delegate });

    const res = await catalog.shortlist({ businessType: 'rental mobil' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value[0]?.id).toBe('tpl-rental');

    const tanpaCocok = await catalog.shortlist({ businessType: 'zzz' });
    // Daftar kosong = build mati; LLM masih bisa menimbang deskripsi.
    expect(tanpaCocok.ok && tanpaCocok.value.length).toBe(2);
  });
});

describe('TemplateCatalogFs kontrak + materialize (dari folder)', () => {
  const delegate: TemplateQueryDelegate = { findMany: async () => [] };

  it('getContract membaca folder → slot per halaman', async () => {
    const catalog = new TemplateCatalogFs({ templatesDir: root, delegate });
    const res = await catalog.getContract('tpl-rental');

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.pages[0]?.slug).toBe('index');
    expect(res.value.pages[0]?.slots.some((s) => s.kind === 'image')).toBe(true);
  });

  it('materialize → MobiriseProject bentuk bersama, isian terpasang', async () => {
    const catalog = new TemplateCatalogFs({ templatesDir: root, delegate });
    const contract = await catalog.getContract('tpl-rental');
    if (!contract.ok) throw new Error('kontrak gagal');
    const teksSlot = contract.value.pages[0]?.slots.find((s) => s.kind === 'text');

    const res = await catalog.materialize('tpl-rental', [
      { slug: 'index', fills: { [teksSlot?.editId ?? '']: { kind: 'text', text: 'Sewabos!' } } },
    ]);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const doc = res.value as { templateId: string; styling: unknown; pages: { components: { _customHTML: string }[] }[] };
    expect(doc.templateId).toBe('tpl-rental');
    expect(doc.styling).toEqual({ primaryColor: '#0a0' });
    expect(doc.pages[0]?.components[0]?._customHTML).toContain('Sewabos!');
  });

  it('template tak ada → NOT_FOUND', async () => {
    const catalog = new TemplateCatalogFs({ templatesDir: root, delegate });
    const res = await catalog.getContract('tpl-hilang');
    expect(!res.ok && res.error.code).toBe('NOT_FOUND');
  });
});
