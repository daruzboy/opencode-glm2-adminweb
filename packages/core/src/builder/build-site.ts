// T-053b: Use case build site document dari brief wawancara (FR-AGT-001/002; SRS §5.2).
// Murni: bergantung hanya pada Port (LlmJsonPort, RevisionRepository, WebsiteRepository).
// Schema validasi di-inject dari composition root (sites-kit) — core tak import sites-kit.
//
// Alur (SRS §5.2 Plan→Act→Validate):
//   1. Verifikasi website milik tenant (NFR-09).
//   2. Susun prompt dari brief → LlmJsonPort.completeJson(task: 'site_plan').
//   3. LLM menghasilkan Site Document JSON (divalidasi via schema yang di-inject).
//   4. Persist sebagai Revision (status DRAFT) → return revisionId + number.
//   5. Update website status → DRAFTING.

import type { LlmJsonSchema, LlmJsonPort, LlmTask } from '@digimaestro/shared';
import type { LlmChatMessage } from '@digimaestro/shared';
import { DEFAULT_TEMPERATURE_BY_TASK } from '@digimaestro/shared';
import { err, ok } from '@digimaestro/shared';
import type {
  RepositoryError,
  Result,
  RevisionRepository,
  TenantId,
  WebsiteRepository,
} from '@digimaestro/shared';
import type { LlmError } from '@digimaestro/shared';

// ── Brief wawancara minimal (FR-CNV-003 slot-filling) ──────────────────────────

export interface InterviewBrief {
  readonly businessName: string;
  readonly businessType: string;
  readonly targetCustomer?: string;
  readonly desiredPages?: readonly string[];
  readonly colorPreference?: string;
  readonly contactInfo?: {
    readonly phone?: string;
    readonly email?: string;
    readonly address?: string;
  };
  readonly socialMedia?: readonly string[];
  readonly notes?: string;
}

export type BuildErrorCode = 'NOT_FOUND' | 'LLM_FAILED' | 'REVISION_FAILED';

export interface BuildError {
  readonly code: BuildErrorCode;
  readonly message: string;
}

// ── Deps ───────────────────────────────────────────────────────────────────────

export interface BuildDeps {
  readonly llm: LlmJsonPort;
  readonly revisions: RevisionRepository;
  readonly websites: WebsiteRepository;
  // Schema validasi Site Document (dari sites-kit, di-inject di composition root).
  // LLM adapter memakai safeParse untuk self-repair bila output tak valid.
  readonly siteDocSchema: LlmJsonSchema<unknown>;
}

export interface BuildRequest {
  readonly tenantId: TenantId;
  readonly websiteId: string;
  readonly brief: InterviewBrief;
  readonly systemPrompt?: string;
  readonly jobId?: string;
}

export interface BuildResult {
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly summary: string;
}

// ── System prompt default (persona Indonesia santai-profesional, PRD §6.1) ────

export const DEFAULT_BUILD_SYSTEM_PROMPT = [
  'Kamu adalah desainer website profesional untuk UMKM Indonesia.',
  'Tugasmu: ubah brief wawancara klien menjadi Site Document JSON lengkap.',
  'Aturan:',
  '- Bahasa seluruh konten: Indonesia santai-profesional.',
  '- Pilih section yang relevan untuk jenis usaha ini (minimum: Hero, Tentang, Layanan, Kontak).',
  '- Tulis copywriting konkret (bukan placeholder) berdasarkan info brief.',
  '- Format: { "name": string, "theme": string, "pages": [{ "slug": string, "title": string, "sections": [{ "type": string, "variant": string, "props": object }] }] }',
  '- Jika info kurang, isi dengan teks wajar yang bisa direvisi nanti.',
].join('\n');

const BUILD_TASK: LlmTask = 'site_plan';

export async function buildSiteFromBrief(
  deps: BuildDeps,
  req: BuildRequest,
): Promise<Result<BuildResult, BuildError | RepositoryError>> {
  // 1. Verifikasi website milik tenant.
  const website = await deps.websites.findByTenantId(req.tenantId);
  if (!website.ok) return err(website.error);
  if (!website.value || website.value.id !== req.websiteId) {
    return err({ code: 'NOT_FOUND', message: `Website ${req.websiteId} tidak ditemukan untuk tenant ini.` });
  }

  // 2. Generate Site Document via LLM.
  const system = req.systemPrompt ?? DEFAULT_BUILD_SYSTEM_PROMPT;
  const userMessage = formatBriefForLlm(req.brief);
  const messages: readonly LlmChatMessage[] = [{ role: 'user', content: userMessage }];

  const llmResult = await deps.llm.completeJson({
    tenantId: req.tenantId,
    jobId: req.jobId,
    task: BUILD_TASK,
    system,
    messages,
    schema: deps.siteDocSchema,
    maxTokens: 4096,
    temperature: DEFAULT_TEMPERATURE_BY_TASK[BUILD_TASK],
  });
  if (!llmResult.ok) {
    return err({ code: 'LLM_FAILED', message: llmResult.error.message });
  }

  // 3. Persist sebagai Revision (status DRAFT).
  const summary = generateSummary(req.brief);
  const created = await deps.revisions.create(req.tenantId, {
    websiteId: req.websiteId,
    siteDoc: llmResult.value,
    summary,
    status: 'DRAFT',
    createdBy: 'agent',
  });
  if (!created.ok) return err(created.error);

  return ok({
    revisionId: created.value.id,
    revisionNumber: created.value.number,
    summary,
  });
}

function formatBriefForLlm(brief: InterviewBrief): string {
  const lines: string[] = [
    `Nama Usaha: ${brief.businessName}`,
    `Jenis Usaha: ${brief.businessType}`,
  ];
  if (brief.targetCustomer) lines.push(`Target Pelanggan: ${brief.targetCustomer}`);
  if (brief.desiredPages?.length) lines.push(`Halaman Diminta: ${brief.desiredPages.join(', ')}`);
  if (brief.colorPreference) lines.push(`Preferensi Warna: ${brief.colorPreference}`);
  if (brief.contactInfo) {
    const c = brief.contactInfo;
    const parts: string[] = [];
    if (c.phone) parts.push(`Telp: ${c.phone}`);
    if (c.email) parts.push(`Email: ${c.email}`);
    if (c.address) parts.push(`Alamat: ${c.address}`);
    if (parts.length) lines.push(`Kontak: ${parts.join(' | ')}`);
  }
  if (brief.socialMedia?.length) lines.push(`Media Sosial: ${brief.socialMedia.join(', ')}`);
  if (brief.notes) lines.push(`Catatan: ${brief.notes}`);
  return lines.join('\n');
}

function generateSummary(brief: InterviewBrief): string {
  return `Build awal untuk ${brief.businessName} (${brief.businessType}).`;
}

// Re-export untuk konsumen
export type { LlmError };
