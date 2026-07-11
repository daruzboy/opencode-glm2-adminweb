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
  // T-053g: schema DRAFT (title/themeId/pages) — bagian yang boleh dikarang LLM.
  // BUKAN Site Document utuh: websiteId & design token diisi kode (lihat assembleDoc).
  // Sebelumnya schema utuh dipakai sebagai target LLM → validasi selalu gagal (LLM tak
  // mungkin tahu websiteId, dan token harus deterministik dari tema) → situs tak pernah
  // terbangun. Ditemukan saat uji bot NYATA.
  readonly siteDocSchema: LlmJsonSchema<unknown>;
  // Rakit dokumen final dari draft LLM: suntik websiteId + token tema (sites-kit).
  // Di-inject agar core tak bergantung sites-kit (dependency rule AGENTS.md §3).
  readonly assembleDoc: (draft: unknown, websiteId: string) => unknown;
  // Nilai sah (tema & tipe section) untuk disisipkan ke prompt.
  readonly catalog?: SiteCatalog;
  // T-033: URL foto milik tenant (hasil ingest). Disisipkan ke prompt agar galeri memakai
  // foto NYATA pelanggan. Tanpa ini LLM akan mengarang URL gambar yang tak pernah ada →
  // galeri penuh <img> rusak.
  readonly mediaUrls?: (tenantId: TenantId) => Promise<readonly string[]>;
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
  'Tugasmu: ubah brief wawancara klien menjadi DRAFT situs dalam JSON.',
  'Aturan:',
  '- Bahasa seluruh konten: Indonesia santai-profesional.',
  '- Tulis copywriting konkret (bukan placeholder) berdasarkan info brief.',
  '- Pilih section yang relevan untuk jenis usaha ini (minimum: hero, about, services, contact).',
  '- Halaman pertama WAJIB ber-slug "index" (beranda).',
  '',
  'Format JSON yang WAJIB diikuti:',
  '{ "title": string, "themeId": string, "pages": [ { "slug": string (kebab-case), "title": string, "sections": [ { "type": string, "variant": string, "props": object } ] } ] }',
  '',
  'JANGAN menyertakan "websiteId" maupun "tokens" — keduanya diisi sistem, bukan kamu.',
  // themeId & tipe/varian section di-inject dari registry sites-kit (bukan dihafal di sini)
  // supaya prompt tak pernah lagi menyimpang dari schema yang memvalidasinya.
].join('\n');

// Prompt sistem + daftar tema & section yang SAH menurut registry. Nilai di luar daftar
// akan ditolak schema → self-repair boros token; lebih baik model diberi tahu di awal.
export function buildSystemPrompt(catalog: SiteCatalog): string {
  const sections = Object.entries(catalog.sections)
    .map(([type, variants]) => `- ${type}: variant ${variants.join(' | ')}`)
    .join('\n');

  const lines = [
    DEFAULT_BUILD_SYSTEM_PROMPT,
    '',
    `themeId yang tersedia (pilih SATU): ${catalog.themeIds.join(', ')}`,
    '',
    'type section & variant yang SAH (pakai PERSIS salah satunya):',
    sections,
  ];

  if (catalog.draftJsonSchema) {
    lines.push(
      '',
      'Output HARUS lolos JSON Schema berikut (perhatikan field wajib tiap props —',
      'mis. image WAJIB punya "alt"). Jangan menambah field di luar schema:',
      JSON.stringify(catalog.draftJsonSchema),
    );
  }

  return lines.join('\n');
}

// Katalog nilai sah dari sites-kit, di-inject (core tak boleh import sites-kit).
// `sections` memetakan type → varian yang SAH. Varian wajib disebut eksplisit: model tak
// bisa menebaknya ("default" bukan varian sah untuk type mana pun) dan schema akan menolak.
export interface SiteCatalog {
  readonly themeIds: readonly string[];
  readonly sections: Readonly<Record<string, readonly string[]>>;
  // JSON Schema draft (dari sites-kit). Diberikan ke model supaya ia tak menebak bentuk
  // props tiap section — tebakan itulah yang bikin build gagal berulang di uji nyata.
  readonly draftJsonSchema?: unknown;
}

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
  const media = deps.mediaUrls ? await deps.mediaUrls(req.tenantId) : [];
  const base =
    req.systemPrompt ??
    (deps.catalog ? buildSystemPrompt(deps.catalog) : DEFAULT_BUILD_SYSTEM_PROMPT);
  const system = media.length > 0 ? `${base}\n\n${mediaInstruction(media)}` : base;
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

  // 3. Rakit Site Document final: draft LLM + websiteId (dari kita) + token tema.
  const siteDoc = deps.assembleDoc(llmResult.value, req.websiteId);

  // 4. Persist sebagai Revision (status DRAFT).
  const summary = generateSummary(req.brief);
  const created = await deps.revisions.create(req.tenantId, {
    websiteId: req.websiteId,
    siteDoc,
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

// Foto pelanggan yang sudah masuk (T-033). Model HANYA boleh memakai URL dari daftar ini —
// URL karangan akan menghasilkan galeri dengan gambar rusak.
export function mediaInstruction(urls: readonly string[]): string {
  return [
    `Pelanggan sudah mengirim ${urls.length} foto. Pakai foto ini di situs (section "gallery",`,
    'dan boleh juga sebagai image di hero/about bila cocok).',
    'GUNAKAN HANYA url berikut PERSIS seperti tertulis — JANGAN mengarang url gambar lain,',
    'jangan memakai placeholder, jangan mengubah huruf/pathnya:',
    ...urls.map((u) => `- ${u}`),
    'Setiap image WAJIB punya "alt" deskriptif dalam bahasa Indonesia.',
  ].join('\n');
}
