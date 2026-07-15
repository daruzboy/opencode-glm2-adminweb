// T-053e: Tool agent `sitebuilder_build_site` — bungkus use case core buildSiteFromBrief
// (T-053b) sebagai AgentToolDefinition.
//
// T-030tg: dipindah dari apps/api ke core. Isinya murni (hanya Port + use case core), dan
// sejak kanal Telegram hadir, agent loop dirakit di DUA composition root (api utk web chat,
// worker utk pesan kanal) — tool yang tinggal di dalam salah satu app tak bisa dipakai app
// lain. Tempatnya memang di core (apps/* = composition root saja, AGENTS.md §2).
//
// execute: parse brief dari argumen tool → resolve website tenant (auto-onboarding bila
// belum ada) → buildSiteFromBrief → Revision DRAFT pertama.

import { buildSiteFromBrief } from '../builder/build-site.js';
import type { BuildDeps, BuildError, BuildRequest, BuildResult, InterviewBrief } from '../builder/build-site.js';
import { buildSiteFromTemplateBrief, type TemplateBuildDeps } from '../builder/build-site-template.js';
import { err, ok } from '@digimaestro/shared';
import type {
  AgentToolDefinition,
  AgentToolError,
  RepositoryError,
  Result,
  TenantProfileRepository,
  WebsiteRepository,
} from '@digimaestro/shared';

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

type BuildRunner = (req: BuildRequest) => Promise<Result<BuildResult, BuildError | RepositoryError>>;

// Factory tool build-site (jalur legacy sections-v1). Website tenant diambil via repo
// (tenantId @unique → 0/1 website).
export function createSitebuilderBuildSiteTool(deps: BuildDeps): AgentToolDefinition<unknown, BuildResult> {
  return buildSiteTool(deps.websites, (req) => buildSiteFromBrief(deps, req), deps.profile);
}

// P4: tool yang SAMA (nama/deskripsi/skema input identik — agent tak perlu tahu bedanya)
// tapi membangun dari TEMPLATE Mobirise. Dipilih composition root via env SITE_ENGINE.
export function createTemplateBuildSiteTool(
  deps: TemplateBuildDeps,
): AgentToolDefinition<unknown, BuildResult> {
  return buildSiteTool(deps.websites, (req) => buildSiteFromTemplateBrief(deps, req), deps.profile);
}

function buildSiteTool(
  websites: WebsiteRepository,
  run: BuildRunner,
  profile?: TenantProfileRepository,
): AgentToolDefinition<unknown, BuildResult> {
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
      const existing = await websites.findByTenantId(context.tenantId);
      if (!existing.ok) return err({ code: 'UNKNOWN', message: existing.error.message });
      let websiteId: string;
      if (existing.value) {
        websiteId = existing.value.id;
      } else {
        const created = await websites.create(context.tenantId, {
          slug: deriveSlug(brief.value.businessName),
        });
        if (!created.ok) {
          return err({ code: 'UNKNOWN', message: `gagal membuat website: ${created.error.message}` });
        }
        websiteId = created.value.id;
      }

      const built = await run({
        tenantId: context.tenantId,
        websiteId,
        brief: brief.value,
      });
      if (!built.ok) {
        const code: AgentToolError['code'] = built.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN';
        return err({ code, message: built.error.message });
      }

      // Memori tenant (PO 2026-07-15): brief yang BERHASIL di-build = konteks paling
      // berharga utk sesi edit berikutnya. Auto-capture, best-effort (gagal ≠ build gagal).
      if (profile) {
        await profile
          .upsert(context.tenantId, { brief: brief.value })
          .catch(() => undefined);
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
