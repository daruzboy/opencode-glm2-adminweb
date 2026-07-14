// P3: implementasi TemplateCatalogPort — registry DB (shortlist) + folder template (kontrak
// slot & materialisasi). Dua sumber sengaja: DB untuk query cepat ratusan baris, folder untuk
// isi blok yang selalu terkini (indexer boleh sedikit tertinggal tanpa merusak build).

import { err, ok } from '@digimaestro/shared';
import type {
  PageFills,
  Result,
  ShortlistCriteria,
  TemplateCatalogPort,
  TemplateContract,
  TemplateError,
  TemplateSummary,
} from '@digimaestro/shared';
import { applyPageFills, extractPageContract } from './slot-contract.js';
import { readTemplateSource } from './template-source.js';

export interface TemplateQueryDelegate {
  findMany(args: { where: { active: boolean } }): Promise<
    {
      id: string;
      name: string;
      description: string;
      businessTypes: string[];
      tags: string[];
      slotSummary: unknown;
    }[]
  >;
}

const DEFAULT_SHORTLIST_LIMIT = 12;

// Skor kecocokan kata-kunci dua arah (substring): "rental mobil" cocok dengan
// businessType "rental" MAUPUN "rental kendaraan". Sederhana & deterministik —
// embeddings baru dipertimbangkan bila kualitas pemilihan terbukti kurang.
export function overlapScore(businessType: string, keywords: readonly string[]): number {
  const words = businessType.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  let score = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    for (const w of words) {
      if (k.includes(w) || w.includes(k)) score += 1;
    }
  }
  return score;
}

function toSummary(row: {
  id: string;
  name: string;
  description: string;
  businessTypes: string[];
  tags: string[];
  slotSummary: unknown;
}): TemplateSummary {
  const s = (row.slotSummary ?? {}) as {
    pageCount?: number;
    textSlots?: number;
    imageSlots?: number;
  };
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    businessTypes: row.businessTypes,
    tags: row.tags,
    pageCount: s.pageCount ?? 1,
    textSlots: s.textSlots ?? 0,
    imageSlots: s.imageSlots ?? 0,
  };
}

export interface TemplateCatalogOptions {
  readonly templatesDir: string;
  readonly delegate: TemplateQueryDelegate;
}

export class TemplateCatalogFs implements TemplateCatalogPort {
  constructor(private readonly options: TemplateCatalogOptions) {}

  async shortlist(
    criteria: ShortlistCriteria,
  ): Promise<Result<readonly TemplateSummary[], TemplateError>> {
    try {
      const rows = await this.options.delegate.findMany({ where: { active: true } });
      const limit = criteria.limit ?? DEFAULT_SHORTLIST_LIMIT;

      const scored = rows
        .map((row) => ({
          row,
          score: overlapScore(criteria.businessType, [...row.businessTypes, ...row.tags]),
        }))
        .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));

      // Tak ada yang cocok kata kunci → tetap kirim top-N (LLM yang menimbang deskripsi).
      // Daftar kosong = build mati; katalog tipis lebih baik daripada tidak sama sekali.
      return ok(scored.slice(0, limit).map((s) => toSummary(s.row)));
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async getContract(templateId: string): Promise<Result<TemplateContract, TemplateError>> {
    const src = await readTemplateSource(this.options.templatesDir, templateId);
    if (!src.ok) return err({ code: 'NOT_FOUND', message: src.message });
    return ok({
      templateId,
      pages: src.value.pages.map((p) => extractPageContract(p)),
    });
  }

  async materialize(
    templateId: string,
    pages: readonly PageFills[],
  ): Promise<Result<unknown, TemplateError>> {
    const src = await readTemplateSource(this.options.templatesDir, templateId);
    if (!src.ok) return err({ code: 'NOT_FOUND', message: src.message });

    const bySlug = new Map(pages.map((p) => [p.slug, p]));
    return ok({
      templateId,
      styling: src.value.styling,
      siteFonts: src.value.siteFonts,
      pages: src.value.pages.map((p) => applyPageFills(p, bySlug.get(p.slug))),
    });
  }
}
