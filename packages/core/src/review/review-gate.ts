// P5: gerbang review PO (keputusan PO 2026-07-14, dua gerbang).
//
// Aturan: revisi mobirise dengan TEMPLATE BARU untuk tenant itu (templateId !=
// Website.approvedTemplateId; null = build pertama) menunggu review PO di editor-web
// (PENDING_ADMIN_REVIEW). Perubahan isi pada template yang SAMA lewat langsung — review
// manusia hanya di tempat yang nilainya nyata. Pelanggan TETAP pemegang keputusan akhir
// (tombol "Setuju & publish" tak berubah).
//
// Sumber kebenaran: editor-web otoritatif SELAMA review; "Kirim ke pelanggan" membekukan
// dokumen EDITAN sebagai Revision baru glm2 (immutable). Publish hanya membaca Revision.
//
// Murni Port — teruji offline dengan fake.

import { err, ok } from '@digimaestro/shared';
import type {
  ChannelPort,
  ConversationRepository,
  MessageRepository,
  RepositoryError,
  Result,
  RevisionRepository,
  TenantId,
  WebsiteRepository,
} from '@digimaestro/shared';
import { approvalButtons } from '../conversation/handle-inbound.js';

// Aturan gerbang O(1). null approvedTemplateId = belum pernah ada yang lolos review →
// build pertama SELALU direview.
export function needsAdminReview(
  revisionTemplateId: string | null | undefined,
  approvedTemplateId: string | null | undefined,
): boolean {
  if (!revisionTemplateId) return false; // sections-v1 legacy: tanpa gerbang (alur lama)
  return revisionTemplateId !== approvedTemplateId;
}

// ── Penyelesaian review (dipanggil callback "Kirim ke pelanggan" dari editor-web) ──

export interface ReviewCompleteDeps {
  readonly revisions: RevisionRepository;
  readonly websites: WebsiteRepository;
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly channel: ChannelPort;
  // Validasi dokumen editan (mobiriseProjectSchema, di-inject — core tak import sites-kit).
  readonly parseDocument: (value: unknown) => { ok: true } | { ok: false; message: string };
  // Tautan preview ber-token (opsional — tanpa PREVIEW_TOKEN_SECRET pesan tetap terkirim).
  readonly previewUrl?: (revisionId: string) => string;
  readonly logger?: { error(msg: string): void };
}

export interface ReviewCompleteCmd {
  readonly tenantId: TenantId;
  readonly websiteId: string;
  // Revisi PENDING_ADMIN_REVIEW yang di-handoff (korelasi, BUKAN isi yang dipakai).
  readonly revisionId: string;
  readonly editorProjectId: string;
  // Dokumen HASIL EDIT PO — inilah yang dibekukan jadi revisi baru.
  readonly document: unknown;
}

export type ReviewCompleteError =
  | { readonly code: 'NOT_FOUND'; readonly message: string }
  | { readonly code: 'INVALID'; readonly message: string }
  | { readonly code: 'CORRELATION'; readonly message: string }
  | RepositoryError;

export interface ReviewCompleteResult {
  readonly revisionId: string;
  readonly revisionNumber: number;
  // false = tenant tanpa percakapan Telegram (mis. web-only) — bukan kegagalan.
  readonly customerNotified: boolean;
}

export function reviewedReadyMessage(previewUrl?: string): string {
  const preview = previewUrl ? `\n\nIntip dulu di sini:\n${previewUrl}` : '';
  return (
    'Situsmu sudah siap! 🎉 Tim kami sudah memeriksa dan merapikannya.' +
    preview +
    '\n\nKalau sudah pas, tekan "Setuju & publish" ya — atau bilang apa yang mau diubah.'
  );
}

export async function completeAdminReview(
  deps: ReviewCompleteDeps,
  cmd: ReviewCompleteCmd,
): Promise<Result<ReviewCompleteResult, ReviewCompleteError>> {
  // 1. Dokumen editan wajib valid — dokumen rusak berhenti DI SINI, bukan saat publish.
  const parsed = deps.parseDocument(cmd.document);
  if (!parsed.ok) return err({ code: 'INVALID', message: `dokumen editan tak valid: ${parsed.message}` });

  // 2. Korelasi: revisi harus ada, milik website+tenant ini, berstatus menunggu review,
  //    dan editorProjectId cocok — panggilan palsu tak bisa memajukan situs orang lain.
  const rev = await deps.revisions.findById(cmd.tenantId, cmd.websiteId, cmd.revisionId);
  if (!rev.ok) return err(rev.error);
  if (!rev.value) return err({ code: 'NOT_FOUND', message: 'revisi handoff tidak ditemukan' });
  if (rev.value.status !== 'PENDING_ADMIN_REVIEW') {
    return err({ code: 'CORRELATION', message: `revisi berstatus ${rev.value.status}, bukan menunggu review` });
  }
  if (!rev.value.editorProjectId || rev.value.editorProjectId !== cmd.editorProjectId) {
    return err({ code: 'CORRELATION', message: 'editorProjectId tidak cocok dengan revisi handoff' });
  }

  // 3. Bekukan dokumen EDITAN sebagai revisi baru. Revisi PENDING dibiarkan sebagai
  //    jejak sejarah ("versi asli AI" tetap bisa dibandingkan).
  const created = await deps.revisions.create(cmd.tenantId, {
    websiteId: cmd.websiteId,
    siteDoc: cmd.document,
    summary: `Hasil review admin (editor ${cmd.editorProjectId}).`,
    status: 'DRAFT',
    createdBy: 'admin-review',
    renderEngine: rev.value.renderEngine ?? 'mobirise-v1',
    ...(rev.value.templateId ? { templateId: rev.value.templateId } : {}),
  });
  if (!created.ok) return err(created.error);

  // 4. Template ini kini LOLOS review untuk tenant ini — build berikutnya dgn template
  //    sama lewat tanpa gerbang.
  if (rev.value.templateId) {
    const upd = await deps.websites.update(cmd.tenantId, cmd.websiteId, {
      approvedTemplateId: rev.value.templateId,
    });
    if (!upd.ok) deps.logger?.error(`[review] gagal set approvedTemplateId: ${upd.error.message}`);
  }

  // 5. Kabari pelanggan: preview + tombol approval (mesin lama, pelanggan pemegang akhir).
  const notified = await notifyCustomer(deps, cmd.tenantId, created.value.id, created.value.number);

  return ok({
    revisionId: created.value.id,
    revisionNumber: created.value.number,
    customerNotified: notified,
  });
}

async function notifyCustomer(
  deps: ReviewCompleteDeps,
  tenantId: TenantId,
  revisionId: string,
  revisionNumber: number,
): Promise<boolean> {
  const convs = await deps.conversations.findMany(tenantId, { channel: 'TELEGRAM' });
  if (!convs.ok || convs.value.length === 0) return false;
  const conv = convs.value[0];
  if (!conv?.externalId) return false;

  const text = reviewedReadyMessage(deps.previewUrl?.(revisionId));
  const sent = await deps.channel.sendButtons(conv.externalId, text, approvalButtons(revisionNumber));
  if (!sent.ok) {
    deps.logger?.error(`[review] gagal kirim notifikasi review-selesai: ${sent.error.message}`);
    return false;
  }

  // Catat OUT (riwayat percakapan tetap utuh; gagal catat ≠ gagal kirim).
  const persisted = await deps.messages.create(tenantId, {
    conversationId: conv.id,
    direction: 'OUT',
    type: 'TEXT',
    text,
    providerMsgId: sent.value.providerMsgId,
    status: 'SENT',
  });
  if (!persisted.ok) deps.logger?.error(`[review] gagal catat pesan OUT: ${persisted.error.message}`);
  return true;
}
