// T-030tg: use case pesan masuk dari kanal eksternal (Telegram; nanti WABA).
// FR-CHN-001/004/005. Murni Port — tak kenal Telegram, tak kenal Prisma, tak kenal BullMQ.
//
// Dijalankan di worker (bukan webhook) karena melibatkan LLM: webhook wajib balas cepat
// atau Telegram menganggapnya gagal lalu mengirim ulang update yang sama.
//
// Alur:
//   1. Resolve Conversation via (tenant, kanal, chat_id) — buat bila belum ada.
//   2. Persist pesan IN. providerMsgId @unique → CONFLICT = duplikat (retry webhook)
//      → BERHENTI tanpa membalas. Ini titik idempotensi (FR-CHN-005).
//   3. Balasan agent (ConversationReplier). Gagal → teks fallback, chat tak pernah mati.
//   4. Kirim via ChannelPort, lalu persist pesan OUT dengan status hasil kirim.

import { err, ok } from '@digimaestro/shared';
import type {
  ChannelPort,
  ConversationRepository,
  InboundChannelMessage,
  MessageRepository,
  MessageStatus,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';
import type { ConversationReplier } from './replier.js';

export interface InboundDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly channel: ChannelPort;
  readonly reply?: ConversationReplier;
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
}

// Balasan saat agent tak tersedia/gagal. Chat tidak boleh mati bisu (PRD: persona
// Indonesia santai-profesional).
export function inboundFallbackReply(): string {
  return 'Maaf ya, aku lagi tersendat sebentar. Coba kirim ulang pesannya sebentar lagi 🙏';
}

// Pesan untuk tipe non-teks: media belum diproses (unduh media = T-033).
export function unsupportedTypeReply(): string {
  return 'Untuk sekarang aku baru bisa baca pesan teks ya. Boleh tulis pesannya? 🙂';
}

export async function handleInboundMessage(
  deps: InboundDeps,
  req: InboundRequest,
): Promise<Result<InboundResult, RepositoryError>> {
  const { tenantId, message } = req;

  // 1) Resolve/buat percakapan untuk chat ini (tenant-scoped, NFR-09).
  const found = await deps.conversations.findByExternalId(
    tenantId,
    message.channel,
    message.externalId,
  );
  if (!found.ok) return err(found.error);

  let conversationId: string;
  if (found.value) {
    conversationId = found.value.id;
  } else {
    const created = await deps.conversations.create(tenantId, {
      channel: message.channel,
      externalId: message.externalId,
    });
    if (!created.ok) return err(created.error);
    conversationId = created.value.id;
  }

  // 2) Persist pesan masuk. CONFLICT = providerMsgId sudah ada = kiriman ulang webhook →
  //    hentikan di sini supaya pengguna tidak menerima balasan dobel.
  const incoming = await deps.messages.create(tenantId, {
    conversationId,
    direction: 'IN',
    type: message.type,
    text: message.text ?? null,
    mediaId: message.mediaRef ?? null,
    providerMsgId: message.providerMsgId,
    status: 'DELIVERED',
  });
  if (!incoming.ok) {
    if (incoming.error.code === 'CONFLICT') return ok({ conversationId, duplicate: true });
    return err(incoming.error);
  }

  // 3) Susun balasan. Non-teks belum didukung → jawab jujur, jangan panggil LLM.
  const replyText =
    message.type === 'TEXT' && message.text
      ? await resolveReplyText(deps, tenantId, conversationId, message.text)
      : unsupportedTypeReply();

  // 4) Kirim ke kanal, lalu catat pesan OUT dengan status sebenarnya (SENT/FAILED) —
  //    jangan mengklaim terkirim kalau Telegram menolak.
  const sent = await deps.channel.sendText(message.externalId, replyText);
  const status: MessageStatus = sent.ok ? 'SENT' : 'FAILED';
  const providerMsgId = sent.ok
    ? sent.value.providerMsgId
    : `${message.channel.toLowerCase()}-out-failed-${message.providerMsgId}`;

  const outgoing = await deps.messages.create(tenantId, {
    conversationId,
    direction: 'OUT',
    type: 'TEXT',
    text: replyText,
    providerMsgId,
    status,
  });
  if (!outgoing.ok) return err(outgoing.error);

  return ok({ conversationId, duplicate: false, replyText, sent: sent.ok });
}

async function resolveReplyText(
  deps: InboundDeps,
  tenantId: TenantId,
  conversationId: string,
  text: string,
): Promise<string> {
  if (!deps.reply) return inboundFallbackReply();
  const result = await deps.reply.reply({ tenantId, conversationId, text });
  return result.ok ? result.value.text : inboundFallbackReply();
}
