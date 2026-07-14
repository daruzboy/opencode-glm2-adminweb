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
import { DEFAULT_REDIS_DEADLINE_MS, withDeadline } from '../redis/with-deadline.js';

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
  // Prefix kunci Redis. `in` = pesan masuk (gerbang biaya LLM); `out` = pesan keluar
  // (menahan banjir & 429 Telegram). Dipisah agar kuota keduanya tak saling makan.
  readonly keyPrefix?: string;
  // Deadline per pemeriksaan. Koneksi `maxRetriesPerRequest: null` membuat perintah
  // MENGANTRE tanpa reject saat Redis tak terjangkau — tanpa deadline, `await` di sini
  // menggantung selamanya dan fail-open di catch tak pernah menyala (insiden P0 2026-07-12:
  // dua job macet 'active' membekukan seluruh worker).
  readonly deadlineMs?: number;
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
    const retryAfterSec = Math.ceil(this.options.windowMs / 1000);

    try {
      // Seluruh interaksi Redis dalam SATU deadline — perintah yang mengantre tanpa reject
      // (maxRetriesPerRequest: null) dipaksa gagal → jatuh ke fail-open di bawah.
      return await withDeadline(
        this.consult(tenantId, retryAfterSec),
        this.options.deadlineMs ?? DEFAULT_REDIS_DEADLINE_MS,
        `rate-limit ${this.options.keyPrefix ?? 'in'}`,
      );
    } catch (e) {
      // FAIL-OPEN yang disengaja: Redis tersendat → jangan matikan bot. Aman karena kalau
      // Redis benar-benar mati, antrean `chat-inbound` juga mati → tak ada pesan yang
      // sampai ke LLM sama sekali. Tapi kegagalannya HARUS terlihat.
      const msg = e instanceof Error ? e.message : String(e);
      this.options.logger?.error(`[rate-limit] Redis gagal, membiarkan pesan lewat: ${msg}`);
      return { allowed: true, shouldWarn: false, retryAfterSec };
    }
  }

  private async consult(tenantId: TenantId, retryAfterSec: number): Promise<RateDecision> {
    const { limit, windowMs } = this.options;
    const client = await this.getClient();
    const prefix = this.options.keyPrefix ?? 'in';
    const key = `rl:${prefix}:${tenantId}`;

    const count = await client.incr(key);
    // Set TTL hanya pada hit PERTAMA → jendela tetap (fixed window) yang tak pernah
    // diperpanjang oleh pesan berikutnya. Kalau TTL di-refresh tiap pesan, pengirim
    // banjir bisa menahan kunci selamanya.
    if (count === 1) await client.pexpire(key, windowMs);

    if (count <= limit) return { allowed: true, shouldWarn: false, retryAfterSec };

    // Melewati batas. Peringatkan HANYA sekali per jendela — kalau tiap pesan spam
    // dibalas peringatan, kita ikut membanjiri pengguna (dan membakar kuota kirim).
    const first = await client.set(`rl:warn:${prefix}:${tenantId}`, '1', 'PX', windowMs, 'NX');
    return { allowed: false, shouldWarn: first === 'OK', retryAfterSec };
  }
}
