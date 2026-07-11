// Port: kanal percakapan masuk-keluar (EPIC-03; FR-CHN-001/002/004/005).
//
// Rencana A (WABA/Meta Cloud API) DIPARKIR menunggu verifikasi Meta — lead time di luar
// kendali tim. Rencana B: Telegram Bot API sebagai kanal Fase 0 (T-030tg). Kedua kanal
// dinormalisasi ke `InboundChannelMessage` di adapter, sehingga use case percakapan
// (core) tidak tahu-menahu soal vendor: menukar/menambah kanal = menambah adapter saja.
//
// Alur: webhook (apps/api) → verifikasi keaslian → normalisasi → allowlist → antrean
// BullMQ → worker → use case percakapan → balasan via ChannelPort.sendText.

import type { ConversationChannel, MessageType } from './repository.js';
import type { Result } from '../index.js';

// Nama antrean = kontrak bersama produsen (api) & konsumen (worker), seperti antrean
// `publish` (T-063). Satu antrean untuk semua kanal — payload membawa `channel`.
export const CHAT_INBOUND_QUEUE_NAME = 'chat-inbound';

export type ChannelErrorCode = 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'QUEUE' | 'UNKNOWN';

export interface ChannelError {
  readonly code: ChannelErrorCode;
  readonly message: string;
}

// Pesan masuk yang SUDAH dinormalisasi (bentuk payload vendor tidak bocor ke core).
export interface InboundChannelMessage {
  readonly channel: ConversationChannel;
  // Id chat di sisi penyedia (Telegram chat_id) → kunci resolusi Conversation.
  readonly externalId: string;
  // Id pesan di sisi penyedia. Message.providerMsgId @unique → dasar idempotensi:
  // kiriman ulang webhook (Telegram me-retry saat 5xx/timeout) tidak berefek ganda
  // karena INSERT ke-2 melanggar unique constraint → CONFLICT → diperlakukan duplikat.
  readonly providerMsgId: string;
  readonly type: MessageType;
  readonly text?: string;
  // Referensi media di sisi penyedia (Telegram file_id). Unduhan → object storage = T-033.
  readonly mediaRef?: string;
  readonly senderName?: string;
}

export interface ChatInboundJob {
  readonly tenantId: string;
  readonly message: InboundChannelMessage;
}

export interface EnqueueInboundResult {
  readonly jobId: string;
}

// Produsen antrean pesan masuk (api → worker). Webhook HARUS balas cepat (Telegram
// menganggap lambat = gagal lalu me-retry), jadi kerja berat (LLM) pindah ke worker.
export interface ChatInboundQueuePort {
  enqueueInbound(job: ChatInboundJob): Promise<Result<EnqueueInboundResult, ChannelError>>;
}

export interface SendResult {
  readonly providerMsgId: string;
}

// Pengirim pesan keluar. Disuntik ke use case percakapan (core) → balasan agent terkirim
// tanpa core mengenal Telegram. `to` = externalId (chat_id) kanal terkait.
export interface ChannelPort {
  readonly channel: ConversationChannel;
  sendText(to: string, text: string): Promise<Result<SendResult, ChannelError>>;
}
