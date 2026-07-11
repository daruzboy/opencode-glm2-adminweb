// T-030tg/T-031tg: use case pesan masuk dari kanal eksternal (Telegram; nanti WABA).
// FR-CHN-001/002/004/005. Murni Port — tak kenal Telegram, Prisma, maupun BullMQ.
//
// Dijalankan di worker (bukan webhook) karena melibatkan LLM: webhook wajib balas cepat
// atau Telegram menganggapnya gagal lalu mengirim ulang update yang sama.
//
// Alur pesan teks:
//   1. Resolve Conversation via (tenant, kanal, chat_id) — buat bila belum ada.
//   2. Persist pesan IN. providerMsgId @unique → CONFLICT = duplikat (retry webhook /
//      tombol ditekan dua kali) → BERHENTI tanpa membalas. Titik idempotensi (FR-CHN-005).
//   3. Balasan agent (ConversationReplier). Gagal → teks fallback, chat tak pernah mati.
//   4. Bila giliran ini MENGHASILKAN revisi baru → kirim balasan BESERTA tombol
//      "Setuju & publish" / "Minta revisi" (T-031tg). Selain itu → teks biasa.
//
// Alur tombol (type INTERACTIVE): parse aksi → jalankan (publish = persetujuan eksplisit
// klien, BRU-02) → jawab callback agar tombol berhenti berputar.

import { err, ok } from '@digimaestro/shared';
import type {
  ChannelButton,
  ChannelPort,
  ConversationRepository,
  InboundChannelMessage,
  MessageRepository,
  MessageStatus,
  RepositoryError,
  Result,
  RevisionRepository,
  TenantId,
  WebsiteRepository,
} from '@digimaestro/shared';
import { handlePublishRequest, type PublishRequestDeps } from '../publish/handle-publish.js';
import { encodeChannelAction, parseChannelAction, type ChannelAction } from './channel-actions.js';
import type { ConversationReplier } from './replier.js';

// Kemampuan approval lewat chat. Opsional: tanpa ini bot tetap bisa mengobrol & membangun
// situs, hanya tombol persetujuan yang tak muncul (mis. lingkungan tanpa Redis/publish).
export interface ApprovalDeps {
  readonly websites: WebsiteRepository;
  readonly revisions: RevisionRepository;
  readonly publish: PublishRequestDeps;
  // URL preview draft ber-token (T-064). Tanpa ini, pesan tetap dikirim tanpa tautan.
  readonly previewUrl?: (revisionId: string) => string;
}

// Logger opsional (disuntik dari worker). Core tak boleh bergantung pada console/pino —
// cukup kontrak sempit ini.
export interface InboundLogger {
  error(message: string): void;
}

// T-033: penerimaan foto. Opsional — tanpa ini bot tetap jalan, foto saja yang ditolak
// sopan (mis. lingkungan tanpa kredensial hosting).
export interface MediaDeps {
  readonly ingest: (tenantId: TenantId, mediaRef: string) => Promise<Result<{ url: string }, { message: string }>>;
  readonly count: (tenantId: TenantId) => Promise<number>;
}

export interface InboundDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly channel: ChannelPort;
  readonly reply?: ConversationReplier;
  readonly approval?: ApprovalDeps;
  readonly media?: MediaDeps;
  readonly logger?: InboundLogger;
}

export interface InboundRequest {
  readonly tenantId: TenantId;
  readonly message: InboundChannelMessage;
}

export interface InboundResult {
  readonly conversationId: string;
  // true → pesan sudah pernah diproses; tidak ada balasan yang dikirim (idempoten).
  readonly duplicate: boolean;
  readonly replyText?: string;
  // false → balasan tersusun tapi gagal dikirim ke kanal (pesan OUT tercatat FAILED).
  readonly sent?: boolean;
  // Revisi yang tombolnya ditawarkan / ditindak pada giliran ini.
  readonly revisionNumber?: number;
  readonly action?: ChannelAction['kind'];
}

// Balasan saat agent tak tersedia/gagal. Chat tidak boleh mati bisu (PRD: persona
// Indonesia santai-profesional).
export function inboundFallbackReply(): string {
  return 'Maaf ya, aku lagi tersendat sebentar. Coba kirim ulang pesannya sebentar lagi 🙏';
}

// Tipe yang memang belum kita dukung (video, audio, dokumen, lokasi).
export function unsupportedTypeReply(): string {
  return 'Untuk sekarang aku baru bisa baca pesan teks dan foto ya 🙂';
}

// T-033: foto diterima & tersimpan → dipakai agent untuk galeri situs.
export function mediaReceivedReply(total: number): string {
  return (
    `Foto kesimpan ✅ (total ${total} foto)\n\n` +
    'Kirim foto lain kalau masih ada, atau bilang "udah cukup" biar aku pasang di galeri situsmu.'
  );
}

export function mediaFailedReply(): string {
  return 'Waduh, fotonya gagal kuproses 😔 Coba kirim ulang ya, atau pakai foto lain.';
}

export function approvalButtons(revisionNumber: number): ChannelButton[] {
  return [
    { label: '✅ Setuju & publish', action: encodeChannelAction({ kind: 'publish', revisionNumber }) },
    { label: '✏️ Minta revisi', action: encodeChannelAction({ kind: 'revise', revisionNumber }) },
  ];
}

export async function handleInboundMessage(
  deps: InboundDeps,
  req: InboundRequest,
): Promise<Result<InboundResult, RepositoryError>> {
  const { tenantId, message } = req;

  // 1) Resolve/buat percakapan untuk chat ini (tenant-scoped, NFR-09).
  const conv = await resolveConversation(deps, tenantId, message);
  if (!conv.ok) return err(conv.error);
  const conversationId = conv.value;

  // 2) Persist pesan masuk. CONFLICT = providerMsgId sudah ada = kiriman ulang webhook
  //    ATAU tombol ditekan dua kali → hentikan supaya tak ada aksi/balasan dobel.
  //    Untuk tombol ini penting: menekan "Setuju & publish" 2× tidak boleh publish 2×.
  const incoming = await deps.messages.create(tenantId, {
    conversationId,
    direction: 'IN',
    type: message.type,
    text: message.text ?? message.callbackData ?? null,
    mediaId: message.mediaRef ?? null,
    providerMsgId: message.providerMsgId,
    status: 'DELIVERED',
  });
  if (!incoming.ok) {
    if (incoming.error.code === 'CONFLICT') return ok({ conversationId, duplicate: true });
    return err(incoming.error);
  }

  // 3) Penekanan tombol → jalur aksi (bukan LLM).
  if (message.type === 'INTERACTIVE') {
    return handleAction(deps, tenantId, conversationId, message);
  }

  // 4) Foto (T-033): unduh → optimasi → simpan. Tak memanggil LLM (buang biaya token).
  if (message.type === 'IMAGE' && message.mediaRef && deps.media) {
    const ingested = await deps.media.ingest(tenantId, message.mediaRef);
    if (!ingested.ok) {
      deps.logger?.error(`[media] gagal memproses foto: ${ingested.error.message}`);
      return replyAndPersist(deps, tenantId, conversationId, message, mediaFailedReply(), []);
    }
    const total = await deps.media.count(tenantId);
    return replyAndPersist(deps, tenantId, conversationId, message, mediaReceivedReply(total), []);
  }

  // 5) Tipe lain yang belum didukung → jawab jujur tanpa memanggil LLM.
  if (message.type !== 'TEXT' || !message.text) {
    return replyAndPersist(deps, tenantId, conversationId, message, unsupportedTypeReply(), []);
  }

  // Snapshot revisi SEBELUM agent bekerja → pembanding untuk mendeteksi build baru.
  const before = await latestRevisionNumber(deps, tenantId);
  const replyText = await resolveReplyText(deps, tenantId, conversationId, message.text);
  const after = await latestRevisionNumber(deps, tenantId);

  // Giliran ini menghasilkan revisi baru (agent memanggil build/patch) → tawarkan approval.
  // Deteksi berbasis nomor revisi, bukan menebak dari teks LLM — teks bisa berubah-ubah,
  // nomor revisi tidak.
  const built = after !== null && (before === null || after > before);
  if (!built) {
    return replyAndPersist(deps, tenantId, conversationId, message, replyText, []);
  }

  const withPreview = appendPreviewLink(deps, replyText, await latestRevisionId(deps, tenantId));
  const res = await replyAndPersist(
    deps,
    tenantId,
    conversationId,
    message,
    withPreview,
    approvalButtons(after),
  );
  if (!res.ok) return res;
  return ok({ ...res.value, revisionNumber: after });
}

// ── Tombol ────────────────────────────────────────────────────────────────────

async function handleAction(
  deps: InboundDeps,
  tenantId: TenantId,
  conversationId: string,
  message: InboundChannelMessage,
): Promise<Result<InboundResult, RepositoryError>> {
  const action = parseChannelAction(message.callbackData);

  // callback_data datang dari luar dan bisa dikarang → aksi tak dikenal ditolak, bukan
  // ditebak-tebak.
  if (!action || !deps.approval) {
    await answer(deps, message, 'Aksi ini tidak tersedia.');
    const text = !deps.approval
      ? 'Maaf, tombol persetujuan lagi tidak aktif. Coba lagi nanti ya 🙏'
      : 'Aku nggak paham tombol itu. Coba ketik permintaanmu ya 🙂';
    return replyAndPersist(deps, tenantId, conversationId, message, text, []);
  }

  if (action.kind === 'revise') {
    await answer(deps, message, 'Oke, ceritakan revisinya.');
    const text = 'Siap! Bagian mana yang mau diubah? Tulis aja detailnya, nanti aku perbaiki ✏️';
    const res = await replyAndPersist(deps, tenantId, conversationId, message, text, []);
    if (!res.ok) return res;
    return ok({ ...res.value, action: 'revise', revisionNumber: action.revisionNumber });
  }

  // publish = persetujuan eksplisit klien (BRU-02). Konten diambil dari DB tepercaya
  // (PublishSourcePort, tenant-scoped) — nomor revisi dari tombol TETAP divalidasi di sana,
  // jadi menempel nomor revisi milik tenant lain tidak akan menemukan apa pun.
  const website = await deps.approval.websites.findByTenantId(tenantId);
  if (!website.ok) return err(website.error);
  if (!website.value) {
    await answer(deps, message, 'Website belum ada.');
    const text = 'Hmm, aku belum nemu website kamu. Coba mulai dari bikin situsnya dulu ya 🙏';
    return replyAndPersist(deps, tenantId, conversationId, message, text, []);
  }

  const outcome = await handlePublishRequest(deps.approval.publish, {
    tenantId,
    websiteId: website.value.id,
    revisionNumber: action.revisionNumber,
  });

  if (!outcome.ok) {
    await answer(deps, message, 'Gagal publish.');
    const text =
      outcome.status === 404
        ? 'Revisi itu nggak ketemu. Coba minta aku bangun ulang situsnya ya 🙏'
        : `Aduh, publish-nya gagal: ${outcome.message}. Coba lagi sebentar lagi ya 🙏`;
    const res = await replyAndPersist(deps, tenantId, conversationId, message, text, []);
    if (!res.ok) return res;
    return ok({ ...res.value, action: 'publish', revisionNumber: action.revisionNumber });
  }

  await answer(deps, message, 'Oke, dipublikasikan!');
  const text =
    `Sip! Situsmu lagi dipublikasikan 🚀\n\nSebentar lagi bisa dibuka di:\n${outcome.url}\n\n` +
    'Aku kabari lagi kalau sudah live ya.';
  const res = await replyAndPersist(deps, tenantId, conversationId, message, text, []);
  if (!res.ok) return res;
  return ok({ ...res.value, action: 'publish', revisionNumber: action.revisionNumber });
}

// Callback WAJIB dijawab atau tombol berputar terus di UI Telegram. Kegagalan di sini
// tidak boleh menggagalkan job — aksi utamanya (mis. publish) sudah terjadi.
async function answer(deps: InboundDeps, message: InboundChannelMessage, notice: string): Promise<void> {
  if (!message.callbackId) return;
  await deps.channel.answerCallback(message.callbackId, notice);
}

// ── Kirim + persist ───────────────────────────────────────────────────────────

async function replyAndPersist(
  deps: InboundDeps,
  tenantId: TenantId,
  conversationId: string,
  message: InboundChannelMessage,
  text: string,
  buttons: readonly ChannelButton[],
): Promise<Result<InboundResult, RepositoryError>> {
  const sent =
    buttons.length > 0
      ? await deps.channel.sendButtons(message.externalId, text, buttons)
      : await deps.channel.sendText(message.externalId, text);

  const status: MessageStatus = sent.ok ? 'SENT' : 'FAILED';
  const providerMsgId = sent.ok
    ? sent.value.providerMsgId
    : `${message.channel.toLowerCase()}-out-failed-${message.providerMsgId}`;

  const outgoing = await deps.messages.create(tenantId, {
    conversationId,
    direction: 'OUT',
    type: buttons.length > 0 ? 'INTERACTIVE' : 'TEXT',
    text,
    providerMsgId,
    status,
  });
  if (!outgoing.ok) return err(outgoing.error);

  return ok({ conversationId, duplicate: false, replyText: text, sent: sent.ok });
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function resolveConversation(
  deps: InboundDeps,
  tenantId: TenantId,
  message: InboundChannelMessage,
): Promise<Result<string, RepositoryError>> {
  const found = await deps.conversations.findByExternalId(
    tenantId,
    message.channel,
    message.externalId,
  );
  if (!found.ok) return err(found.error);
  if (found.value) return ok(found.value.id);

  const created = await deps.conversations.create(tenantId, {
    channel: message.channel,
    externalId: message.externalId,
  });
  if (!created.ok) return err(created.error);
  return ok(created.value.id);
}

// null = tak ada website/revisi, atau approval tak dikonfigurasi. Kegagalan repo di sini
// sengaja diperlakukan sebagai "tak ada": ini hanya penentu MUNCULNYA tombol — chat tetap
// harus membalas meski deteksi revisi gagal.
async function latestRevisionNumber(deps: InboundDeps, tenantId: TenantId): Promise<number | null> {
  const latest = await latestRevision(deps, tenantId);
  return latest?.number ?? null;
}

async function latestRevisionId(deps: InboundDeps, tenantId: TenantId): Promise<string | null> {
  const latest = await latestRevision(deps, tenantId);
  return latest?.id ?? null;
}

async function latestRevision(
  deps: InboundDeps,
  tenantId: TenantId,
): Promise<{ id: string; number: number } | null> {
  if (!deps.approval) return null;
  const website = await deps.approval.websites.findByTenantId(tenantId);
  if (!website.ok || !website.value) return null;
  const rev = await deps.approval.revisions.findLatest(tenantId, website.value.id);
  if (!rev.ok || !rev.value) return null;
  return { id: rev.value.id, number: rev.value.number };
}

function appendPreviewLink(deps: InboundDeps, text: string, revisionId: string | null): string {
  if (!deps.approval?.previewUrl || !revisionId) return text;
  return `${text}\n\n👀 Lihat dulu preview-nya:\n${deps.approval.previewUrl(revisionId)}`;
}

async function resolveReplyText(
  deps: InboundDeps,
  tenantId: TenantId,
  conversationId: string,
  text: string,
): Promise<string> {
  if (!deps.reply) {
    // Bot tetap membalas, tapi jangan sampai ini SENYAP: tanpa replier, tiap pesan dijawab
    // fallback dan dari luar tampak seperti "agent bodoh", bukan salah konfigurasi.
    deps.logger?.error('[chat] ConversationReplier tidak disuntik — balasan memakai fallback');
    return inboundFallbackReply();
  }
  const result = await deps.reply.reply({ tenantId, conversationId, text });
  if (result.ok) return result.value.text;

  // Ditemukan saat uji nyata: API key LLM kosong → agent gagal tiap pesan → pengguna cuma
  // melihat "aku lagi tersendat" tanpa satu pun petunjuk di log. Sebabnya HARUS terlihat.
  deps.logger?.error(`[chat] agent gagal (${result.error.code}): ${result.error.message}`);
  return inboundFallbackReply();
}
