// T-070: peredam alert. Dekorator AlertPort.
//
// Tanpa ini, alert justru MERUSAK dirinya sendiri: saat LLM tumbang, setiap pesan pelanggan
// gagal → 100 notifikasi dalam semenit. PO akan mematikan notifikasinya, dan alert yang
// dimatikan = tidak ada alert. Satu notifikasi per masalah per jendela cukup untuk bertindak.
//
// State di Redis (bukan memori proses) supaya peredaman tetap benar saat worker >1 replika —
// kalau tidak, N replika = N notifikasi untuk masalah yang sama.

import { ok } from '@digimaestro/shared';
import type { Alert, AlertError, AlertPort, Result } from '@digimaestro/shared';
import type { RedisRateCommands } from '../telegram/redis-inbound-rate-limiter.js';

export interface ThrottleOptions {
  // Jendela redam per `alert.key`.
  readonly cooldownMs: number;
  readonly logger?: { error(msg: string): void };
}

export const DEFAULT_ALERT_COOLDOWN_MS = 15 * 60_000; // 15 menit

export class ThrottledAlert implements AlertPort {
  constructor(
    private readonly inner: AlertPort,
    private readonly getClient: () => Promise<RedisRateCommands>,
    private readonly options: ThrottleOptions,
  ) {}

  async notify(alert: Alert): Promise<Result<void, AlertError>> {
    try {
      const client = await this.getClient();
      // SET NX → hanya yang PERTAMA dalam jendela yang lolos.
      const first = await client.set(
        `alert:${alert.key}`,
        '1',
        'PX',
        this.options.cooldownMs,
        'NX',
      );
      // Sudah pernah dialertkan dalam jendela ini → diamkan (bukan kegagalan).
      if (first !== 'OK') return ok(undefined);
    } catch (e) {
      // Redis mati → JANGAN telan alertnya. Lebih baik PO menerima notifikasi berulang
      // daripada tak menerima apa pun saat sistem sedang sekarat (justru saat paling butuh).
      const msg = e instanceof Error ? e.message : String(e);
      this.options.logger?.error(`[alert] throttle Redis gagal, alert tetap dikirim: ${msg}`);
    }

    return this.inner.notify(alert);
  }
}
