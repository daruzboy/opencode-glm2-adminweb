// Kebijakan retry/retensi job publish (T-063 hardening, ADR-2). Modul MURNI (tanpa impor
// bullmq) → teruji offline; dipakai factory Queue sebagai defaultJobOptions. Kegagalan
// transien (jaringan cPanel, Redis sesaat) → retry backoff eksponensial; job final gagal
// TETAP tersimpan di failed-set (dead-letter) utk inspeksi, sukses dipangkas agar Redis ramping.

// Bentuk struktural kompatibel bullmq JobsOptions (subset yang kita pakai) — dipertahankan
// lokal agar modul tak bergantung tipe vendor.
export interface PublishJobOptions {
  readonly attempts: number;
  readonly backoff: { readonly type: 'exponential'; readonly delay: number };
  // Retensi: pangkas job sukses (batasi jumlah), pertahankan job gagal utk dead-letter audit.
  readonly removeOnComplete: number | boolean;
  readonly removeOnFail: number | boolean;
}

export interface PublishJobPolicy {
  // Total percobaan termasuk yang pertama (attempts=1 → tanpa retry).
  readonly attempts?: number;
  // Delay dasar backoff eksponensial (ms): retry ke-n ≈ delay * 2^(n-1).
  readonly backoffDelayMs?: number;
  // Berapa job sukses terakhir yang disimpan (true=semua, angka=batas, default 50).
  readonly keepCompleted?: number | boolean;
  // Berapa job gagal disimpan sbg dead-letter (true=semua → default; audit manual).
  readonly keepFailed?: number | boolean;
}

export const PUBLISH_JOB_POLICY_DEFAULTS = {
  attempts: 3,
  backoffDelayMs: 5000,
  keepCompleted: 50,
  keepFailed: true,
} as const;

// Bangun opsi job final dari kebijakan (+ default). Dipanggil sekali di factory Queue.
export function defaultPublishJobOptions(policy: PublishJobPolicy = {}): PublishJobOptions {
  return {
    attempts: policy.attempts ?? PUBLISH_JOB_POLICY_DEFAULTS.attempts,
    backoff: {
      type: 'exponential',
      delay: policy.backoffDelayMs ?? PUBLISH_JOB_POLICY_DEFAULTS.backoffDelayMs,
    },
    removeOnComplete: policy.keepCompleted ?? PUBLISH_JOB_POLICY_DEFAULTS.keepCompleted,
    removeOnFail: policy.keepFailed ?? PUBLISH_JOB_POLICY_DEFAULTS.keepFailed,
  };
}
