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
import type { Result, TenantId } from '../index.js';

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
  // T-031tg — pengguna MENEKAN TOMBOL (type INTERACTIVE). Isi `action` (lihat
  // ChannelAction) yang kita sendiri kirim di tombol; jangan pernah dipercaya mentah
  // (bisa dipalsukan) → selalu divalidasi ulang terhadap DB tenant.
  readonly callbackData?: string;
  // Id callback query; WAJIB dijawab (answerCallback) atau tombol berputar terus di UI.
  readonly callbackId?: string;
}

// ── Tombol interaktif (T-031tg, FR-CHN-002; alur approval-first BRU-02) ────────
//
// `action` masuk ke callback_data Telegram yang DIBATASI 64 byte → pakai bentuk pendek
// `<verb>:<arg>`. websiteId tidak perlu ikut: satu website per tenant (BRU-01), jadi
// tenant sudah menentukan website-nya.
export interface ChannelButton {
  readonly label: string;
  readonly action: string;
}

// Batas keras Telegram untuk callback_data.
export const CHANNEL_ACTION_MAX_BYTES = 64;

export interface SendResult {
  readonly providerMsgId: string;
}

export interface ChatInboundJob {
  // OPSIONAL (self-serve, langkah #6): null/undefined = chat BELUM dikenal → worker
  // mengarahkannya ke jalur PENDAFTARAN (kode undangan), TANPA memanggil LLM.
  // Sebelumnya wajib, karena tenant hanya bisa datang dari allowlist env yang disunting
  // manual — mustahil untuk self-serve.
  readonly tenantId?: string;
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

// Pengirim pesan keluar. Disuntik ke use case percakapan (core) → balasan agent terkirim
// tanpa core mengenal Telegram. `to` = externalId (chat_id) kanal terkait.
export interface ChannelPort {
  readonly channel: ConversationChannel;
  sendText(to: string, text: string): Promise<Result<SendResult, ChannelError>>;
  // Pesan + tombol (T-031tg). Kanal tanpa dukungan tombol boleh mem-fallback ke teks.
  sendButtons(
    to: string,
    text: string,
    buttons: readonly ChannelButton[],
  ): Promise<Result<SendResult, ChannelError>>;
  // Wajib dipanggil setelah menangani penekanan tombol: Telegram menampilkan spinner di
  // tombol sampai callback query dijawab. `notice` = toast singkat di UI (opsional).
  answerCallback(callbackId: string, notice?: string): Promise<Result<void, ChannelError>>;
}

// ── Batas laju pesan MASUK (P0 audit Telegram) ────────────────────────────────
//
// Kenapa terpisah dari rate limit pesan KELUAR: `RateLimitedChannel` membungkus
// `ChannelPort`, sedangkan LLM dipanggil SEBELUM balasan dikirim. Jadi rate limit keluar
// TIDAK melindungi anggaran LLM sama sekali — token sudah terbakar saat balasan ditahan.
//
// Gerbang ini menolak SEBELUM LLM tersentuh. Allowlist (ADR-12) menahan orang asing;
// ini menahan tenant TERDAFTAR yang membanjiri (sengaja, atau karena bug klien).
export interface RateDecision {
  readonly allowed: boolean;
  // Peringatkan pengguna HANYA sekali per jendela — kalau tidak, tiap pesan spam dibalas
  // peringatan dan kita justru ikut membanjiri pengguna (amplifikasi).
  readonly shouldWarn: boolean;
  readonly retryAfterSec: number;
}

export interface InboundRateLimiterPort {
  check(tenantId: TenantId): Promise<RateDecision>;
}
