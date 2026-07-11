// T-030tg: adapter ChannelPort di atas Telegram Bot API (pengirim pesan keluar).
//
// Tanpa SDK vendor — Bot API adalah HTTPS+JSON biasa, jadi cukup `fetch` (tak ada
// dependensi baru; lihat AGENTS.md §5). `fetch` disuntik → adapter teruji offline.

import { err, ok } from '@digimaestro/shared';
import type {
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

export class TelegramChannel implements ChannelPort {
  readonly channel: ConversationChannel = 'TELEGRAM';

  constructor(private readonly options: TelegramChannelOptions) {}

  async sendText(to: string, text: string): Promise<Result<SendResult, ChannelError>> {
    const base = this.options.baseUrl ?? TELEGRAM_API;
    const url = `${base}/bot${this.options.botToken}/sendMessage`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const res = await this.options.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: to, text: truncateForTelegram(text) }),
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

      const body = (await res.json()) as {
        ok?: boolean;
        description?: string;
        result?: { message_id?: number; chat?: { id?: number } };
      };
      // Bot API bisa membalas HTTP 200 dengan ok:false — sukses HTTP ≠ pesan terkirim.
      if (body.ok !== true || typeof body.result?.message_id !== 'number') {
        return err({
          code: 'UNKNOWN',
          message: `Telegram menolak pesan: ${body.description ?? 'respons tak terduga'}`,
        });
      }

      const chatId = body.result.chat?.id ?? to;
      return ok({ providerMsgId: `tg-${chatId}-${body.result.message_id}` });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ code: 'NETWORK', message: `gagal menghubungi Telegram: ${message}` });
    } finally {
      clearTimeout(timer);
    }
  }
}
