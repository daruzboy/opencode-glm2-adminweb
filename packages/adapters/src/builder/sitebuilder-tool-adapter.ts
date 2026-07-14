// T-053b: Implementasi SitebuilderToolPort di atas RevisionRepository + LlmJsonPort.
// Dipakai oleh agent loop (tools: get_site_outline, apply_patch).
// getSiteOutline: load latest revision → ekstrak outline (pages + section types).
// applyPatch: load latest revision → LLM revision_patch → persist revision baru.

import { err, ok } from '@digimaestro/shared';
import type {
  AgentToolError,
  LlmJsonPort,
  LlmJsonSchema,
  Result,
  RevisionRepository,
  TenantId,
  WebsiteRepository,
} from '@digimaestro/shared';

// Tipe kontrak struktural (kompatibel dgn SitebuilderToolPort di core — tak perlu
// import core; dependency rule: adapters → shared saja, bukan adapters → core).
export interface SiteOutline {
  readonly websiteId: string;
  readonly title: string;
  readonly pages: readonly {
    readonly slug: string;
    readonly title: string;
    readonly sections: readonly string[];
  }[];
}

export interface RevisionPatchResult {
  readonly revisionId: string;
  readonly summary: string;
}

export interface SitebuilderToolPort {
  getSiteOutline(tenantId: TenantId, input: { readonly websiteId?: string }): Promise<Result<SiteOutline | null, AgentToolError>>;
  applyPatch(
    tenantId: TenantId,
    input: { readonly websiteId: string; readonly instruction: string },
  ): Promise<Result<RevisionPatchResult, AgentToolError>>;
}

// Schema untuk LLM revision_patch output (Site Document lengkap hasil revisi).
// Di-inject dari composition root; default = permissive (validasi penuh di worker).
const PERMISSIVE_SCHEMA: LlmJsonSchema<unknown> = {
  safeParse(value: unknown) {
    return { success: true as const, data: value };
  },
};

export interface SitebuilderAdapterDeps {
  readonly revisions: RevisionRepository;
  readonly websites: WebsiteRepository;
  readonly llm: LlmJsonPort;
  readonly siteDocSchema?: LlmJsonSchema<unknown>;
}

const REVISION_PATCH_SYSTEM_PROMPT = [
  'Kamu adalah asisten revisi website UMKM Indonesia.',
  'Tugasmu: terapkan instruksi revisi pada Site Document JSON yang diberikan.',
  'Kembalikan Site Document LENGKAP yang sudah direvisi (bukan hanya bagian yang diubah).',
  'Pertahankan struktur dan section yang tidak diminta diubah.',
  'Bahasa konten: Indonesia santai-profesional.',
].join('\n');

export class SitebuilderToolAdapter implements SitebuilderToolPort {
  private readonly schema: LlmJsonSchema<unknown>;

  constructor(private readonly deps: SitebuilderAdapterDeps) {
    this.schema = deps.siteDocSchema ?? PERMISSIVE_SCHEMA;
  }

  async getSiteOutline(
    tenantId: TenantId,
    input: { readonly websiteId?: string },
  ): Promise<Result<SiteOutline | null, AgentToolError>> {
    try {
      const website = await deps_websites(this.deps, tenantId, input.websiteId);
      if (!website.ok) return website;
      if (!website.value) return ok(null);

      const latest = await this.deps.revisions.findLatest(tenantId, website.value.id);
      if (!latest.ok) return err({ code: 'UNKNOWN', message: latest.error.message });
      if (!latest.value) return ok(null);

      return ok(extractOutline(website.value.id, latest.value.siteDoc));
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async applyPatch(
    tenantId: TenantId,
    input: { readonly websiteId: string; readonly instruction: string },
  ): Promise<Result<RevisionPatchResult, AgentToolError>> {
    try {
      // 1. Load latest revision.
      const latest = await this.deps.revisions.findLatest(tenantId, input.websiteId);
      if (!latest.ok) return err({ code: 'UNKNOWN', message: latest.error.message });
      if (!latest.value) {
        return err({ code: 'NOT_FOUND', message: 'belum ada revisi untuk website ini' });
      }

      // 2. LLM: terapkan instruksi revisi pada Site Document.
      const llmResult = await this.deps.llm.completeJson({
        tenantId,
        task: 'revision_patch',
        system: REVISION_PATCH_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Instruksi revisi: ${input.instruction}` },
          { role: 'user', content: `Site Document saat ini:\n${JSON.stringify(latest.value.siteDoc, null, 2)}` },
        ],
        schema: this.schema,
        // 8192: revisi mengembalikan SELURUH dokumen — dokumen multi-halaman tak muat di
        // 4096 (insiden produksi 2026-07-14, lihat build-site.ts). Desain "LLM tulis ulang
        // seluruh dokumen" memang tak skalabel; digantikan pengisian slot di mesin template.
        maxTokens: 8192,
        temperature: 0.1,
      });
      if (!llmResult.ok) {
        return err({ code: 'UNKNOWN', message: llmResult.error.message });
      }

      // 3. Persist revision baru.
      const created = await this.deps.revisions.create(tenantId, {
        websiteId: input.websiteId,
        siteDoc: llmResult.value,
        summary: input.instruction.slice(0, 200),
        status: 'DRAFT',
        createdBy: 'agent',
      });
      if (!created.ok) {
        return err({ code: 'UNKNOWN', message: created.error.message });
      }

      return ok({
        revisionId: created.value.id,
        summary: `Revisi #${created.value.number}: ${input.instruction.slice(0, 100)}`,
      });
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// Helper: resolve website untuk tenant (by tenantId atau websiteId eksplisit).
async function deps_websites(
  deps: SitebuilderAdapterDeps,
  tenantId: TenantId,
  websiteId?: string,
): Promise<Result<{ id: string } | null, AgentToolError>> {
  if (websiteId) {
    // Verifikasi websiteId milik tenant.
    const rev = await deps.revisions.findLatest(tenantId, websiteId);
    if (!rev.ok) return err({ code: 'UNKNOWN', message: rev.error.message });
    return ok(rev.value ? { id: websiteId } : null);
  }
  // Default: website untuk tenant ini (tenantId @unique → 0 atau 1).
  const website = await deps.websites.findByTenantId(tenantId);
  if (!website.ok) return err({ code: 'UNKNOWN', message: website.error.message });
  return ok(website.value ? { id: website.value.id } : null);
}

// Ekstrak outline dari Site Document JSON (struktur longgar — sites-kit punya schema ketat).
function extractOutline(websiteId: string, siteDoc: unknown): SiteOutline {
  const doc = siteDoc as Record<string, unknown>;
  const pages = Array.isArray(doc.pages) ? doc.pages : [];
  return {
    websiteId,
    title: typeof doc.name === 'string' ? doc.name : 'Untitled',
    pages: pages.map((p) => {
      const page = p as Record<string, unknown>;
      const sections = Array.isArray(page.sections) ? page.sections : [];
      return {
        slug: typeof page.slug === 'string' ? page.slug : 'unknown',
        title: typeof page.title === 'string' ? page.title : 'Untitled',
        sections: sections.map((s) => {
          const section = s as Record<string, unknown>;
          return typeof section.type === 'string' ? section.type : 'unknown';
        }),
      };
    }),
  };
}
