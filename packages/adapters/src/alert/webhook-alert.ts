// T-070: alert → webhook (n8n / endpoint apa pun). Menghormati ADR-7 (n8n sebagai kanal
// notifikasi & integrasi sekunder) TANPA menjadikannya satu-satunya jalur: alert yang
// bergantung pada komponen yang bisa ikut tumbang bukan alert.
//
// Dipakai berdampingan dengan TelegramAlert (lihat composition): Telegram = jalur utama yang
// hidup di luar infrastruktur kita; webhook = integrasi lanjutan (tiket, email, dashboard).

import { err, ok } from '@digimaestro/shared';
import type { Alert, AlertError, AlertPort, Result } from '@digimaestro/shared';

export type AlertFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{ readonly status: number }>;

export interface WebhookAlertOptions {
  readonly url: string;
  readonly fetch: AlertFetch;
  readonly timeoutMs?: number;
  readonly environment?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class WebhookAlert implements AlertPort {
  constructor(private readonly options: WebhookAlertOptions) {}

  async notify(alert: Alert): Promise<Result<void, AlertError>> {
    try {
      const res = await this.options.fetch(this.options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...alert,
          environment: this.options.environment,
          at: new Date().toISOString(),
        }),
        // Alert TIDAK boleh menggantung pemanggilnya: ia dipanggil dari jalur kegagalan,
        // dan menggantung di sana berarti job/worker ikut tersandera.
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });

      if (res.status < 200 || res.status >= 300) {
        return err({ code: 'SEND', message: `webhook alert HTTP ${res.status}` });
      }
      return ok(undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err({ code: 'SEND', message: `gagal mengirim webhook alert: ${msg}` });
    }
  }
}

// Kirim ke BEBERAPA kanal; satu kanal gagal tak boleh membungkam yang lain.
export class MultiAlert implements AlertPort {
  constructor(private readonly targets: readonly AlertPort[]) {}

  async notify(alert: Alert): Promise<Result<void, AlertError>> {
    const results = await Promise.all(this.targets.map((t) => t.notify(alert)));
    const failed = results.filter((r) => !r.ok);

    // Sukses bila SETIDAKNYA satu kanal menerima — tujuan alert adalah "PO tahu", bukan
    // "semua kanal sempurna".
    if (failed.length < results.length) return ok(undefined);
    return err({ code: 'SEND', message: 'semua kanal alert gagal' });
  }
}
