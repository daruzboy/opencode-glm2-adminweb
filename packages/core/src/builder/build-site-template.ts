// P4: build situs dari TEMPLATE Mobirise — pengganti jalur "LLM mengarang seluruh dokumen"
// (build-site.ts, kini legacy sections-v1).
//
// Kenapa: (1) renderer lama = 3 tema token di atas 1 kerangka — variasi visual terbatas;
// (2) "LLM tulis ulang seluruh dokumen" tak skalabel — dokumen 6 halaman memotong batas
// output & membakar token 3× (insiden 2026-07-14). Di sini LLM hanya MEMILIH template
// (dari shortlist) lalu MENGISI nilai slot per halaman — output kecil, tervalidasi, dan
// struktur/desain template tak mungkin rusak.
//
// Alur: shortlist (deterministik) → template_pick (LLM, ber-schema enum) → kontrak slot →
// slot_fill per halaman (LLM, tervalidasi + disanitasi) → materialize → Revision
// 'mobirise-v1'. Murni Port — teruji offline dengan LLM deterministik.

import { DEFAULT_TEMPERATURE_BY_TASK, err, ok } from '@digimaestro/shared';
import type {
  LlmChatMessage,
  LlmJsonPort,
  LlmJsonSchema,
  PageFills,
  RepositoryError,
  Result,
  RevisionRepository,
  SlotFill,
  TemplateCatalogPort,
  TemplateContract,
  TemplatePageContract,
  TemplateSummary,
  TenantId,
  WebsiteRepository,
} from '@digimaestro/shared';
import type { BuildError, BuildRequest, BuildResult, InterviewBrief } from './build-site.js';

export interface TemplateBuildDeps {
  readonly llm: LlmJsonPort;
  readonly revisions: RevisionRepository;
  readonly websites: WebsiteRepository;
  readonly catalog: TemplateCatalogPort;
  // Foto milik tenant — HANYA URL di sini yang boleh dipakai slot gambar (P4).
  // Slot tanpa foto cocok → 'keep' (gambar bawaan template). Stok Unsplash/Pexels = P6.
  readonly mediaUrls?: (tenantId: TenantId) => Promise<readonly string[]>;
}

// ── Pemilihan template ─────────────────────────────────────────────────────────

function pickSchema(validIds: readonly string[]): LlmJsonSchema<{ templateId: string }> {
  return {
    safeParse(value: unknown) {
      const v = value as { templateId?: unknown };
      if (typeof v?.templateId === 'string' && validIds.includes(v.templateId)) {
        return { success: true, data: { templateId: v.templateId } };
      }
      return {
        success: false,
        error: { message: `templateId harus salah satu dari: ${validIds.join(', ')}` },
      };
    },
  };
}

function pickPrompt(summaries: readonly TemplateSummary[]): string {
  const daftar = summaries
    .map(
      (t) =>
        `- id: ${t.id} · ${t.name} — ${t.description} (cocok: ${t.businessTypes.join(', ')}; ` +
        `${t.pageCount} halaman, ${t.imageSlots} slot gambar)`,
    )
    .join('\n');
  return [
    'Kamu memilihkan TEMPLATE website yang paling cocok untuk sebuah usaha.',
    'Pilih SATU dari daftar berikut (berdasar jenis usaha, bukan selera pribadi):',
    daftar,
    '',
    'Jawab JSON: { "templateId": string } — persis salah satu id di atas.',
  ].join('\n');
}

// ── Pengisian slot per halaman ─────────────────────────────────────────────────

// Validator + SANITASI isian: entri tak dikenal / bentuk salah / URL gambar di luar media
// tenant → dibuang (slot itu 'keep'). Pengisian parsial menghasilkan situs utuh — lebih
// baik satu judul bawaan tersisa daripada build gagal.
export function fillSchema(
  page: TemplatePageContract,
  allowedImageUrls: readonly string[],
): LlmJsonSchema<PageFills> {
  const byId = new Map(page.slots.map((s) => [s.editId, s]));
  return {
    safeParse(value: unknown) {
      const v = value as { title?: unknown; fills?: unknown };
      if (typeof v !== 'object' || v === null || typeof v.fills !== 'object' || v.fills === null) {
        return { success: false, error: { message: 'wajib objek { fills: { <editId>: ... } }' } };
      }

      const fills: Record<string, SlotFill> = {};
      for (const [editId, raw] of Object.entries(v.fills as Record<string, unknown>)) {
        const slot = byId.get(editId);
        const f = raw as { kind?: unknown; text?: unknown; url?: unknown; alt?: unknown; href?: unknown; label?: unknown };
        if (!slot || typeof f !== 'object' || f === null) continue;

        if (f.kind === 'text' && slot.kind === 'text' && typeof f.text === 'string' && f.text.trim()) {
          fills[editId] = { kind: 'text', text: f.text.trim() };
        } else if (
          f.kind === 'image' &&
          slot.kind === 'image' &&
          typeof f.url === 'string' &&
          allowedImageUrls.includes(f.url)
        ) {
          fills[editId] = {
            kind: 'image',
            url: f.url,
            alt: typeof f.alt === 'string' && f.alt.trim() ? f.alt.trim() : 'foto usaha',
          };
        } else if (f.kind === 'link' && slot.kind === 'link' && typeof f.href === 'string' && f.href.trim()) {
          fills[editId] = {
            kind: 'link',
            href: f.href.trim(),
            ...(typeof f.label === 'string' && f.label.trim() ? { label: f.label.trim() } : {}),
          };
        }
        // selain itu: dibuang → slot mempertahankan isi template ('keep' implisit)
      }

      return {
        success: true,
        data: {
          slug: page.slug,
          ...(typeof v.title === 'string' && v.title.trim() ? { title: v.title.trim() } : {}),
          fills,
        },
      };
    },
  };
}

function shorten(s: string, max = 90): string {
  const bersih = s.replace(/\s+/g, ' ').trim();
  return bersih.length <= max ? bersih : `${bersih.slice(0, max)}…`;
}

export function fillSystemPrompt(): string {
  return [
    'Kamu copywriter website UMKM Indonesia. Isi SLOT konten sebuah halaman template.',
    'Aturan:',
    '- Bahasa Indonesia santai-profesional, konkret dari brief (bukan placeholder).',
    '- Jawab JSON: { "title"?: string, "fills": { "<editId>": isian } }.',
    '- isian teks:   { "kind": "text", "text": string } — panjang senada isi bawaan slot.',
    '- isian gambar: { "kind": "image", "url": string, "alt": string } — url HANYA dari',
    '  daftar FOTO PELANGGAN yang diberikan. Tak ada yang cocok? JANGAN isi slot itu.',
    '- isian tautan: { "kind": "link", "href": string, "label"?: string } — mis. wa.me/<nomor>.',
    '- Slot yang tak kamu isi otomatis memakai isi bawaan template — tak apa-apa.',
    '- JANGAN mengarang URL. JANGAN menulis HTML.',
  ].join('\n');
}

function fillUserMessage(
  briefText: string,
  page: TemplatePageContract,
  mediaUrls: readonly string[],
): string {
  const slots = page.slots
    .map((s) => `- ${s.editId} [${s.kind}] ${s.hint} — bawaan: "${shorten(s.current)}"`)
    .join('\n');
  const media =
    mediaUrls.length > 0
      ? `FOTO PELANGGAN (hanya ini yang boleh dipakai slot gambar):\n${mediaUrls.join('\n')}`
      : 'FOTO PELANGGAN: (belum ada — jangan isi slot gambar sama sekali)';
  return [
    `BRIEF USAHA:\n${briefText}`,
    '',
    `HALAMAN: ${page.slug} — "${page.title}"`,
    `SLOT:\n${slots}`,
    '',
    media,
  ].join('\n');
}

// ── Use case utama ─────────────────────────────────────────────────────────────

const PICK_MAX_TOKENS = 1_536; // reasoning model: jangan < ~1536 (pelajaran v4-pro)
const FILL_MAX_TOKENS = 4_096; // nilai slot saja — bukan dokumen utuh
// Slot per panggilan slot_fill. Template Mobirise nyata bisa 150+ slot per halaman —
// satu panggilan memotong batas output (terbukti di uji kontainer 2026-07-14:
// "Unexpected end of JSON input" pada halaman 112 slot). Kelompok kecil = output kecil,
// prompt fokus, dan kegagalan satu kelompok tak membuang kelompok lain.
const FILL_CHUNK_SIZE = 40;

export async function buildSiteFromTemplateBrief(
  deps: TemplateBuildDeps,
  req: BuildRequest,
): Promise<Result<BuildResult, BuildError | RepositoryError>> {
  // 1. Verifikasi website milik tenant (NFR-09) — sama dengan jalur legacy.
  const website = await deps.websites.findByTenantId(req.tenantId);
  if (!website.ok) return err(website.error);
  if (!website.value || website.value.id !== req.websiteId) {
    return err({ code: 'NOT_FOUND', message: `Website ${req.websiteId} tidak ditemukan untuk tenant ini.` });
  }

  // 2. Shortlist deterministik → LLM memilih SATU (schema menolak id di luar shortlist).
  const shortlist = await deps.catalog.shortlist({ businessType: req.brief.businessType });
  if (!shortlist.ok) return err({ code: 'LLM_FAILED', message: shortlist.error.message });
  if (shortlist.value.length === 0) {
    return err({ code: 'LLM_FAILED', message: 'katalog template kosong — jalankan pnpm templates:index' });
  }

  const briefText = formatBrief(req.brief);
  const picked = await deps.llm.completeJson({
    tenantId: req.tenantId,
    ...(req.jobId ? { jobId: req.jobId } : {}),
    task: 'template_pick',
    system: pickPrompt(shortlist.value),
    messages: [{ role: 'user', content: briefText }],
    schema: pickSchema(shortlist.value.map((t) => t.id)),
    maxTokens: PICK_MAX_TOKENS,
    temperature: DEFAULT_TEMPERATURE_BY_TASK.template_pick,
  });
  if (!picked.ok) return err({ code: 'LLM_FAILED', message: picked.error.message });
  const templateId = picked.value.templateId;

  // 3. Kontrak slot template terpilih.
  const contract = await deps.catalog.getContract(templateId);
  if (!contract.ok) return err({ code: 'LLM_FAILED', message: contract.error.message });

  // 4. Isi slot PER HALAMAN (bukan satu panggilan raksasa — batas output & fokus prompt).
  const media = deps.mediaUrls ? await deps.mediaUrls(req.tenantId) : [];
  const filled = await fillAllPages(deps, req, contract.value, briefText, media);
  if (!filled.ok) return filled;

  // 5. Materialize → dokumen MobiriseProject final.
  const doc = await deps.catalog.materialize(templateId, filled.value);
  if (!doc.ok) return err({ code: 'LLM_FAILED', message: doc.error.message });

  // 6. Persist Revision 'mobirise-v1'.
  const summary = `Build dari template ${templateId} untuk ${req.brief.businessName}.`;
  const created = await deps.revisions.create(req.tenantId, {
    websiteId: req.websiteId,
    siteDoc: doc.value,
    summary,
    status: 'DRAFT',
    createdBy: 'agent',
    renderEngine: 'mobirise-v1',
    templateId,
  });
  if (!created.ok) return err(created.error);

  return ok({ revisionId: created.value.id, revisionNumber: created.value.number, summary });
}

async function fillAllPages(
  deps: TemplateBuildDeps,
  req: BuildRequest,
  contract: TemplateContract,
  briefText: string,
  media: readonly string[],
): Promise<Result<PageFills[], BuildError>> {
  const out: PageFills[] = [];
  for (const page of contract.pages) {
    if (page.slots.length === 0) {
      out.push({ slug: page.slug, fills: {} });
      continue;
    }

    // Pecah slot jadi kelompok kecil; gabungkan isian semua kelompok jadi satu PageFills.
    const merged: Record<string, SlotFill> = {};
    let title: string | undefined;
    for (let i = 0; i < page.slots.length; i += FILL_CHUNK_SIZE) {
      const chunk: TemplatePageContract = {
        slug: page.slug,
        title: page.title,
        slots: page.slots.slice(i, i + FILL_CHUNK_SIZE),
      };
      const filled = await deps.llm.completeJson({
        tenantId: req.tenantId,
        ...(req.jobId ? { jobId: req.jobId } : {}),
        task: 'slot_fill',
        system: fillSystemPrompt(),
        messages: [
          { role: 'user', content: fillUserMessage(briefText, chunk, media) },
        ] as readonly LlmChatMessage[],
        schema: fillSchema(chunk, media),
        maxTokens: FILL_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE_BY_TASK.slot_fill,
      });
      // Satu kelompok gagal → build gagal (bukan situs setengah terisi tanpa penjelasan);
      // retry/self-repair sudah dikerjakan adapter LLM di bawah.
      if (!filled.ok) {
        return err({
          code: 'LLM_FAILED',
          message: `slot_fill ${page.slug} (slot ${i + 1}-${i + chunk.slots.length}): ${filled.error.message}`,
        });
      }
      Object.assign(merged, filled.value.fills);
      // Judul halaman diambil dari kelompok PERTAMA saja (slot terpenting ada di awal).
      if (i === 0 && filled.value.title) title = filled.value.title;
    }

    out.push({ slug: page.slug, ...(title ? { title } : {}), fills: merged });
  }
  return ok(out);
}

function formatBrief(brief: InterviewBrief): string {
  const lines = [`Nama Usaha: ${brief.businessName}`, `Jenis Usaha: ${brief.businessType}`];
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
