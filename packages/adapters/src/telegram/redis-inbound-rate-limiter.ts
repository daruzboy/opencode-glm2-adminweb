// P0 (audit Telegram): batas laju pesan MASUK per tenant, ditegakkan SEBELUM LLM dipanggil.
//
// Masalah yang ditutup: `RateLimitedChannel` hanya membatasi pesan KELUAR, sedangkan LLM
// dipanggil lebih dulu → rate limit lama TIDAK melindungi anggaran token sama sekali.
// Satu chat yang membanjiri = satu panggilan `deepseek-v4-pro` (model reasoning) per pesan.
//
// State di REDIS, bukan memori proses: (a) tahan restart worker; (b) tetap benar saat worker
// diskalakan >1 replika (batas memori-proses akan jadi N×limit — temuan P1 audit).
//
// Tanpa dependensi baru: klien Redis diambil dari `Queue.client` BullMQ (API publik), jadi
// kita memakai koneksi yang MEMANG sudah ada — tak perlu menambah `ioredis` (pnpm melarang
// impor dep transitif, dan menambahnya hanya untuk ini tak sepadan).

import type { InboundRateLimiterPort, RateDecision, TenantId } from '@digimaestro/shared';

// Perintah Redis yang dipakai — interface SEMPIT (bukan ioredis penuh) → teruji offline.
export interface RedisRateCommands {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  // SET key val NX PX ms → 'OK' bila baru diset, null bila sudah ada.
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttl: number,
    nx: 'NX',
  ): Promise<string | null>;
}

export interface InboundRateLimitOptions {
  // Pesan per jendela, per tenant.
  readonly limit: number;
  readonly windowMs: number;
  readonly logger?: { error(msg: string): void };
}

export const DEFAULT_INBOUND_LIMIT = 15;
export const DEFAULT_INBOUND_WINDOW_MS = 60_000;

export class RedisInboundRateLimiter implements InboundRateLimiterPort {
  constructor(
    private readonly getClient: () => Promise<RedisRateCommands>,
    private readonly options: InboundRateLimitOptions,
  ) {}

  async check(tenantId: TenantId): Promise<RateDecision> {
    const { limit, windowMs } = this.options;
    const retryAfterSec = Math.ceil(windowMs / 1000);

    try {
      const client = await this.getClient();
      const key = `rl:in:${tenantId}`;

      const count = await client.incr(key);
      // Set TTL hanya pada hit PERTAMA → jendela tetap (fixed window) yang tak pernah
      // diperpanjang oleh pesan berikutnya. Kalau TTL di-refresh tiap pesan, pengirim
      // banjir bisa menahan kunci selamanya.
      if (count === 1) await client.pexpire(key, windowMs);

      if (count <= limit) return { allowed: true, shouldWarn: false, retryAfterSec };

      // Melewati batas. Peringatkan HANYA sekali per jendela — kalau tiap pesan spam
      // dibalas peringatan, kita ikut membanjiri pengguna (dan membakar kuota kirim).
      const first = await client.set(`rl:warn:${tenantId}`, '1', 'PX', windowMs, 'NX');
      return { allowed: false, shouldWarn: first === 'OK', retryAfterSec };
    } catch (e) {
      // FAIL-OPEN yang disengaja: Redis tersendat → jangan matikan bot. Aman karena kalau
      // Redis benar-benar mati, antrean `chat-inbound` juga mati → tak ada pesan yang
      // sampai ke LLM sama sekali. Tapi kegagalannya HARUS terlihat.
      const msg = e instanceof Error ? e.message : String(e);
      this.options.logger?.error(`[rate-limit] Redis gagal, membiarkan pesan lewat: ${msg}`);
      return { allowed: true, shouldWarn: false, retryAfterSec };
    }
  }
}
