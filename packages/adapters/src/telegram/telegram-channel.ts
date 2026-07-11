// T-030tg: adapter ChannelPort di atas Telegram Bot API (pengirim pesan keluar).
//
// Tanpa SDK vendor — Bot API adalah HTTPS+JSON biasa, jadi cukup `fetch` (tak ada
// dependensi baru; lihat AGENTS.md §5). `fetch` disuntik → adapter teruji offline.

import { CHANNEL_ACTION_MAX_BYTES, err, ok } from '@digimaestro/shared';
import type {
  ChannelButton,
  ChannelError,
  ChannelPort,
  ConversationChannel,
  Result,
  SendResult,
} from '@digimaestro/shared';
import type { RuntimeFetch } from '../llm/openai-compatible-json-adapter.js';

const TELEGRAM_API = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 15_000;

// Batas keras Telegram: 4096 karakter per pesan. Balasan agent bisa lebih panjang →
// dipotong agar API tidak menolak seluruh pesan (lebih baik terpotong daripada bisu).
export const TELEGRAM_MAX_TEXT = 4096;

export interface TelegramChannelOptions {
  readonly botToken: string;
  readonly fetch: RuntimeFetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export function truncateForTelegram(text: string): string {
  if (text.length <= TELEGRAM_MAX_TEXT) return text;
  return `${text.slice(0, TELEGRAM_MAX_TEXT - 1)}…`;
}

interface TelegramBody {
  ok?: boolean;
  description?: string;
  result?: { message_id?: number; chat?: { id?: number } };
}

export class TelegramChannel implements ChannelPort {
  readonly channel: ConversationChannel = 'TELEGRAM';

  constructor(private readonly options: TelegramChannelOptions) {}

  // Satu pintu ke Bot API: pemetaan status → ChannelError dipusatkan di sini supaya
  // sendText/sendButtons/answerCallback tak menyalin aturan yang sama (dan tak bisa
  // menyimpang satu sama lain).
  private async call(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<Result<TelegramBody, ChannelError>> {
    const base = this.options.baseUrl ?? TELEGRAM_API;
    const url = `${base}/bot${this.options.botToken}/${method}`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const res = await this.options.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (res.status === 429) {
        return err({ code: 'RATE_LIMIT', message: 'Telegram membatasi laju kirim (429).' });
      }
      // 401/403 = token salah/bot diblokir pengguna → bukan sesuatu yang layak di-retry.
      if (res.status === 401 || res.status === 403) {
        return err({ code: 'AUTH', message: `Telegram menolak kredensial/izin (${res.status}).` });
      }
      if (res.status < 200 || res.status >= 300) {
        return err({ code: 'NETWORK', message: `Telegram HTTP ${res.status}.` });
      }

      const body = (await res.json()) as TelegramBody;
      // Bot API bisa membalas HTTP 200 dengan ok:false — sukses HTTP ≠ operasi berhasil.
      if (body.ok !== true) {
        return err({
          code: 'UNKNOWN',
          message: `Telegram menolak permintaan: ${body.description ?? 'respons tak terduga'}`,
        });
      }
      return ok(body);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ code: 'NETWORK', message: `gagal menghubungi Telegram: ${message}` });
    } finally {
      clearTimeout(timer);
    }
  }

  private toSendResult(
    body: TelegramBody,
    to: string,
  ): Result<SendResult, ChannelError> {
    if (typeof body.result?.message_id !== 'number') {
      return err({ code: 'UNKNOWN', message: 'Telegram tak mengembalikan message_id.' });
    }
    const chatId = body.result.chat?.id ?? to;
    return ok({ providerMsgId: `tg-${chatId}-${body.result.message_id}` });
  }

  async sendText(to: string, text: string): Promise<Result<SendResult, ChannelError>> {
    const res = await this.call('sendMessage', {
      chat_id: to,
      text: truncateForTelegram(text),
    });
    if (!res.ok) return err(res.error);
    return this.toSendResult(res.value, to);
  }

  // Tombol inline (T-031tg). callback_data DIBATASI 64 byte oleh Telegram — tombol yang
  // melewatinya ditolak diam-diam oleh API, jadi lebih baik gagal keras di sini daripada
  // mengirim pesan yang tombolnya tak berfungsi.
  async sendButtons(
    to: string,
    text: string,
    buttons: readonly ChannelButton[],
  ): Promise<Result<SendResult, ChannelError>> {
    for (const b of buttons) {
      if (Buffer.byteLength(b.action, 'utf8') > CHANNEL_ACTION_MAX_BYTES) {
        return err({
          code: 'UNKNOWN',
          message: `callback_data "${b.action}" melebihi ${CHANNEL_ACTION_MAX_BYTES} byte.`,
        });
      }
    }

    const res = await this.call('sendMessage', {
      chat_id: to,
      text: truncateForTelegram(text),
      // Satu tombol per baris → label panjang tetap terbaca di layar ponsel.
      reply_markup: {
        inline_keyboard: buttons.map((b) => [{ text: b.label, callback_data: b.action }]),
      },
    });
    if (!res.ok) return err(res.error);
    return this.toSendResult(res.value, to);
  }

  // Tanpa ini, tombol berputar (loading) di UI Telegram sampai timeout.
  async answerCallback(callbackId: string, notice?: string): Promise<Result<void, ChannelError>> {
    const res = await this.call('answerCallbackQuery', {
      callback_query_id: callbackId,
      ...(notice ? { text: notice } : {}),
    });
    if (!res.ok) return err(res.error);
    return ok(undefined);
  }
}
