// P3: indexer — folder template (sumber kebenaran) → baris DB `Template` (registry query).
//
// Kenapa perlu DB padahal sumbernya folder: shortlist AI butuh filter/skoring cepat atas
// ratusan template + folder di-mount hanya ke worker/api (bukan tempat query nyaman).
// Baris yang folder-nya hilang DI-NONAKTIFKAN (bukan dihapus): revisi lama masih menunjuk
// templateId itu — sejarah tak boleh menggantung.

import { createHash } from 'node:crypto';
import { extractPageContract } from './slot-contract.js';
import { listTemplateIds, readTemplateSource } from './template-source.js';

// Delegate Prisma sempit → teruji dengan fake tanpa DB.
export interface TemplateDelegate {
  upsert(args: {
    where: { id: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<unknown>;
  updateMany(args: {
    where: { id: { notIn: string[] } };
    data: { active: boolean };
  }): Promise<{ count: number }>;
}

export interface IndexReport {
  readonly indexed: string[];
  readonly deactivated: number;
  // Template yang GAGAL dibaca — dilaporkan, bukan ditelan: satu template rusak tak boleh
  // menghentikan indeks ratusan lainnya, tapi PO harus tahu.
  readonly errors: string[];
}

export interface IndexerDeps {
  readonly templatesDir: string;
  readonly delegate: TemplateDelegate;
  readonly now?: () => Date;
}

export async function indexTemplates(deps: IndexerDeps): Promise<IndexReport> {
  const ids = await listTemplateIds(deps.templatesDir);
  const indexed: string[] = [];
  const errors: string[] = [];
  const now = deps.now ?? (() => new Date());

  for (const id of ids) {
    const src = await readTemplateSource(deps.templatesDir, id);
    if (!src.ok) {
      errors.push(src.message);
      continue;
    }
    const t = src.value;

    // Ringkasan slot untuk prompt pemilihan (derive, bukan tulis tangan).
    let textSlots = 0;
    let imageSlots = 0;
    for (const page of t.pages) {
      const contract = extractPageContract(page);
      textSlots += contract.slots.filter((s) => s.kind !== 'image').length;
      imageSlots += contract.slots.filter((s) => s.kind === 'image').length;
    }
    const slotSummary = {
      pageCount: t.pages.length,
      pageSlugs: t.pages.map((p) => p.slug),
      blockCount: t.pages.reduce((n, p) => n + p.components.length, 0),
      textSlots,
      imageSlots,
    };

    const row = {
      name: t.manifest.name,
      description: t.manifest.description,
      businessTypes: t.manifest.businessTypes,
      tags: t.manifest.tags,
      slotSummary,
      active: t.manifest.active,
      sourceHash: createHash('sha256').update(t.raw).digest('hex'),
      indexedAt: now(),
      updatedAt: now(),
    };
    await deps.delegate.upsert({ where: { id }, create: { id, ...row }, update: row });
    indexed.push(id);
  }

  const gone = await deps.delegate.updateMany({
    where: { id: { notIn: indexed } },
    data: { active: false },
  });

  return { indexed, deactivated: gone.count, errors };
}
