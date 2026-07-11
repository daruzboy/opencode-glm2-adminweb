// T-053e: Tool agent `sitebuilder_build_site` — bungkus use case core buildSiteFromBrief
// (T-053b) sebagai AgentToolDefinition. Diletakkan di composition root (apps/api) karena
// menyatukan use case core + adapter repo/LLM; core builtin-tools tetap generik (port).
//
// execute: parse brief dari argumen tool → resolve website tenant → buildSiteFromBrief →
// Revision DRAFT pertama. Menutup jalur "situs baru" pada loop agent (interview→build).

import { buildSiteFromBrief, type BuildDeps, type BuildResult, type InterviewBrief } from '@digimaestro/core';
import { err, ok } from '@digimaestro/shared';
import type { AgentToolDefinition, AgentToolError, Result } from '@digimaestro/shared';

// Parse argumen tool (dari LLM) → InterviewBrief. businessName+businessType wajib; sisanya opsional.
export function parseBriefInput(input: unknown): Result<InterviewBrief, AgentToolError> {
  if (typeof input !== 'object' || input === null) {
    return err({ code: 'INVALID_INPUT', message: 'input harus object' });
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.businessName !== 'string' || raw.businessName.trim().length === 0) {
    return err({ code: 'INVALID_INPUT', message: 'businessName wajib string' });
  }
  if (typeof raw.businessType !== 'string' || raw.businessType.trim().length === 0) {
    return err({ code: 'INVALID_INPUT', message: 'businessType wajib string' });
  }
  const brief: InterviewBrief = {
    businessName: raw.businessName.trim(),
    businessType: raw.businessType.trim(),
    ...(typeof raw.targetCustomer === 'string' ? { targetCustomer: raw.targetCustomer } : {}),
    ...(Array.isArray(raw.desiredPages)
      ? { desiredPages: raw.desiredPages.filter((p): p is string => typeof p === 'string') }
      : {}),
    ...(typeof raw.colorPreference === 'string' ? { colorPreference: raw.colorPreference } : {}),
    ...(typeof raw.notes === 'string' ? { notes: raw.notes } : {}),
  };
  return ok(brief);
}

// Factory tool build-site. `deps` = BuildDeps (llm JSON, repo Revision/Website, schema
// Site Document nyata). Website tenant diambil via repo (tenantId @unique → 0/1 website).
export function createSitebuilderBuildSiteTool(deps: BuildDeps): AgentToolDefinition<unknown, BuildResult> {
  return {
    name: 'sitebuilder_build_site',
    description:
      'Buat Site Document (situs) baru dari brief wawancara pelanggan. Pakai HANYA setelah ' +
      'mengumpulkan minimal nama usaha & jenis usaha. Menghasilkan revisi DRAFT untuk direview.',
    scope: 'sitebuilder',
    inputSchema: {
      type: 'object',
      properties: {
        businessName: { type: 'string', description: 'Nama usaha (wajib).' },
        businessType: { type: 'string', description: 'Jenis usaha, mis. "warung makan" (wajib).' },
        targetCustomer: { type: 'string' },
        desiredPages: { type: 'array', items: { type: 'string' } },
        colorPreference: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['businessName', 'businessType'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const brief = parseBriefInput(input);
      if (!brief.ok) return brief;

      // Onboarding otomatis (opsi A): tenant baru belum punya Website → buat (DRAFTING)
      // dgn slug dari nama usaha, agar loop chat→bangun jalan tanpa langkah onboarding manual.
      const existing = await deps.websites.findByTenantId(context.tenantId);
      if (!existing.ok) return err({ code: 'UNKNOWN', message: existing.error.message });
      let websiteId: string;
      if (existing.value) {
        websiteId = existing.value.id;
      } else {
        const created = await deps.websites.create(context.tenantId, {
          slug: deriveSlug(brief.value.businessName),
        });
        if (!created.ok) {
          return err({ code: 'UNKNOWN', message: `gagal membuat website: ${created.error.message}` });
        }
        websiteId = created.value.id;
      }

      const built = await buildSiteFromBrief(deps, {
        tenantId: context.tenantId,
        websiteId,
        brief: brief.value,
      });
      if (!built.ok) {
        const code: AgentToolError['code'] = built.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN';
        return err({ code, message: built.error.message });
      }
      return ok(built.value);
    },
  };
}

// Slug situs dari nama usaha: kebab-case + sufiks acak pendek (slug @unique global).
export function deriveSlug(businessName: string): string {
  const base =
    businessName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'situs';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}
