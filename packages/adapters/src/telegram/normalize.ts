// T-030tg: normalisasi payload Telegram Bot API → InboundChannelMessage.
// Bentuk payload vendor BERHENTI di sini; core hanya melihat bentuk netral kanal.
//
// Divalidasi Zod (AGENTS.md §3: input di tepi sistem wajib Zod). Skema sengaja longgar
// (passthrough field yang tak kita pakai) — Telegram rutin menambah field baru, dan
// menolak update hanya karena ada field asing akan membuat bot mati tanpa sebab.

import { z } from 'zod';
import type { InboundChannelMessage, MessageType } from '@digimaestro/shared';

const chatSchema = z.object({ id: z.number() });

const fromSchema = z
  .object({
    first_name: z.string().optional(),
    username: z.string().optional(),
  })
  .optional();

// Hanya field yang benar-benar kita pakai. Media diwakili file_id (unduhan = T-033).
const messageSchema = z.object({
  message_id: z.number(),
  chat: chatSchema,
  from: fromSchema,
  text: z.string().optional(),
  caption: z.string().optional(),
  photo: z.array(z.object({ file_id: z.string() })).optional(),
  document: z.object({ file_id: z.string() }).optional(),
  voice: z.object({ file_id: z.string() }).optional(),
  audio: z.object({ file_id: z.string() }).optional(),
  video: z.object({ file_id: z.string() }).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
});

// T-031tg: penekanan tombol inline. `data` = callback_data yang KITA kirim di tombol —
// tetap diperlakukan sebagai input tak tepercaya (pengguna bisa mengarangnya via Bot API).
const callbackQuerySchema = z.object({
  id: z.string(),
  from: fromSchema,
  data: z.string().optional(),
  message: z.object({ message_id: z.number(), chat: chatSchema }).optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: messageSchema.optional(),
  edited_message: messageSchema.optional(),
  callback_query: callbackQuerySchema.optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
type TelegramMessage = z.infer<typeof messageSchema>;

// Update yang bukan pesan/tombol (my_chat_member, channel_post, …) → null. Bot tetap
// balas 200 ke Telegram; mengabaikan diam-diam lebih baik daripada error karena Telegram
// akan me-retry update yang gagal berulang kali.
export function toInboundMessage(update: TelegramUpdate): InboundChannelMessage | null {
  const cb = update.callback_query;
  if (cb) {
    // Tanpa chat, balasan tak punya tujuan → tak bisa diproses.
    if (!cb.message) return null;
    return {
      channel: 'TELEGRAM',
      externalId: String(cb.message.chat.id),
      // Id callback query unik global di Telegram → dedup penekanan tombol ganda
      // (pengguna menekan dua kali / Telegram mengirim ulang) lewat providerMsgId @unique.
      providerMsgId: `tg-cb-${cb.id}`,
      type: 'INTERACTIVE',
      callbackId: cb.id,
      ...(cb.data !== undefined ? { callbackData: cb.data } : {}),
      ...(cbSenderName(cb) !== undefined ? { senderName: cbSenderName(cb) } : {}),
    };
  }

  const msg = update.message ?? update.edited_message;
  if (!msg) return null;

  const { type, mediaRef } = classify(msg);
  const text = msg.text ?? msg.caption;

  return {
    channel: 'TELEGRAM',
    externalId: String(msg.chat.id),
    // message_id hanya unik per-chat, sedangkan Message.providerMsgId unik GLOBAL →
    // wajib diprefiks chat agar pesan dari dua chat berbeda tak saling menganggap duplikat.
    providerMsgId: `tg-${msg.chat.id}-${msg.message_id}`,
    type,
    ...(text !== undefined ? { text } : {}),
    ...(mediaRef !== undefined ? { mediaRef } : {}),
    ...(senderName(msg) !== undefined ? { senderName: senderName(msg) } : {}),
  };
}

function classify(msg: TelegramMessage): { type: MessageType; mediaRef?: string } {
  // photo = array ukuran menaik; ambil resolusi terbesar (elemen terakhir).
  if (msg.photo && msg.photo.length > 0) {
    return { type: 'IMAGE', mediaRef: msg.photo[msg.photo.length - 1]?.file_id };
  }
  if (msg.video) return { type: 'VIDEO', mediaRef: msg.video.file_id };
  if (msg.voice) return { type: 'AUDIO', mediaRef: msg.voice.file_id };
  if (msg.audio) return { type: 'AUDIO', mediaRef: msg.audio.file_id };
  if (msg.document) return { type: 'DOCUMENT', mediaRef: msg.document.file_id };
  if (msg.location) return { type: 'LOCATION' };
  return { type: 'TEXT' };
}

function senderName(msg: TelegramMessage): string | undefined {
  return msg.from?.first_name ?? msg.from?.username;
}

function cbSenderName(cb: z.infer<typeof callbackQuerySchema>): string | undefined {
  return cb.from?.first_name ?? cb.from?.username;
}
