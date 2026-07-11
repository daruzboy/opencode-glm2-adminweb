// T-031tg: rate limit pesan keluar per tenant (FR-CHN-002). Dekorator ChannelPort →
// berlaku untuk SEMUA jenis kirim (teks & tombol) tanpa menyentuh logika Telegram, dan
// kanal lain (WABA nanti) dapat pembatasan yang sama gratis.
//
// Kenapa perlu: (1) Telegram membatasi ~1 pesan/detik per chat dan akan membalas 429 —
// lebih baik kita yang menahan diri daripada dihukum; (2) bug/loop di agent bisa
// membanjiri pengguna; batas ini menahannya di tepi keluar.
//
// Kunci = `to` (chat_id). Karena allowlist memetakan satu chat ke satu tenant (ADR-12),
// per-chat = per-tenant. CATATAN: state ada di MEMORI PROSES — dengan >1 replika worker,
// batas efektifnya adalah N×limit. Cukup untuk Fase 0 (satu worker); bila nanti diskalakan
// horizontal, ganti isi kelas ini dengan token bucket di Redis — kontraknya tak berubah.

import { err } from '@digimaestro/shared';
import type {
  ChannelButton,
  ChannelError,
  ChannelPort,
  ConversationChannel,
  Result,
  SendResult,
} from '@digimaestro/shared';

export interface RateLimitOptions {
  // Jumlah pesan yang boleh dikirim per jendela waktu, per chat/tenant.
  readonly limit: number;
  readonly windowMs: number;
  // Disuntik agar teruji tanpa menunggu waktu nyata.
  readonly now?: () => number;
}

export const DEFAULT_RATE_LIMIT: Omit<Required<RateLimitOptions>, 'now'> = {
  limit: 20,
  windowMs: 60_000,
};

export class RateLimitedChannel implements ChannelPort {
  readonly channel: ConversationChannel;

  // chat_id → timestamp pengiriman dalam jendela berjalan.
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(
    private readonly inner: ChannelPort,
    options: RateLimitOptions = DEFAULT_RATE_LIMIT,
  ) {
    this.channel = inner.channel;
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  // true = boleh kirim (dan kuota dicatat). Jendela geser: buang jejak yang sudah lewat.
  private allow(to: string): boolean {
    const t = this.now();
    const cutoff = t - this.windowMs;
    const recent = (this.hits.get(to) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= this.limit) {
      // Simpan hasil pemangkasan supaya Map tak menumpuk timestamp basi.
      this.hits.set(to, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(to, recent);
    return true;
  }

  private limitError(to: string): ChannelError {
    return {
      code: 'RATE_LIMIT',
      message: `batas kirim tercapai untuk chat ${to} (${this.limit}/${this.windowMs}ms).`,
    };
  }

  async sendText(to: string, text: string): Promise<Result<SendResult, ChannelError>> {
    if (!this.allow(to)) return err(this.limitError(to));
    return this.inner.sendText(to, text);
  }

  async sendButtons(
    to: string,
    text: string,
    buttons: readonly ChannelButton[],
  ): Promise<Result<SendResult, ChannelError>> {
    if (!this.allow(to)) return err(this.limitError(to));
    return this.inner.sendButtons(to, text, buttons);
  }

  // TIDAK dibatasi: ini bukan pesan ke pengguna, melainkan ACK teknis agar tombol berhenti
  // berputar. Menahannya justru membuat UI tampak menggantung saat tenant kena limit.
  async answerCallback(callbackId: string, notice?: string): Promise<Result<void, ChannelError>> {
    return this.inner.answerCallback(callbackId, notice);
  }
}
