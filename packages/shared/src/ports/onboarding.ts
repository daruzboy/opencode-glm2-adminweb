// Port: self-serve onboarding + kuota (langkah #6 roadmap §7; ADR-12).
//
// Sebelum ini: tenant dibuat MANUAL lewat SQL, dan chat dipetakan MANUAL di env
// (`TELEGRAM_ALLOWLIST`). Artinya tiap pelanggan baru menuntut PO menyunting server —
// mustahil untuk produk yang dijual.
//
// Tapi membuka pendaftaran TANPA pagar = lubang biaya: tiap pesan memanggil LLM berbayar
// (~$0.0034/pesan terukur di produksi). Karena itu dua gerbang, keduanya WAJIB:
//   1. KODE UNDANGAN — orang iseng yang menemukan bot tak bisa membakar token (PO 2026-07-12).
//   2. KUOTA per tenant — bahkan pelanggan sah tak bisa menghabiskan anggaran tanpa batas.

import type { RepositoryError } from './repository.js';
import type { ConversationChannel } from './repository.js';
import type { Result, TenantId } from '../index.js';

// ── Pemetaan chat → tenant (menggantikan allowlist env) ───────────────────────

export interface ChannelBindingPort {
  // null = chat belum dikenal → jalur pendaftaran.
  resolve(
    channel: ConversationChannel,
    externalId: string,
  ): Promise<Result<TenantId | null, RepositoryError>>;

  bind(
    tenantId: TenantId,
    channel: ConversationChannel,
    externalId: string,
  ): Promise<Result<void, RepositoryError>>;
}

// ── Kode undangan ────────────────────────────────────────────────────────────

export interface InviteCodeEntity {
  readonly id: string;
  readonly code: string;
  readonly maxUses: number;
  readonly usedCount: number;
  readonly expiresAt: string | null;
  readonly active: boolean;
}

export type InviteError =
  | { readonly code: 'NOT_FOUND'; readonly message: string }
  | { readonly code: 'EXPIRED'; readonly message: string }
  | { readonly code: 'EXHAUSTED'; readonly message: string }
  | { readonly code: 'UNKNOWN'; readonly message: string };

export interface InviteCodePort {
  // Menukarkan kode SECARA ATOMIK (increment usedCount dalam satu operasi bersyarat).
  // Kalau dipisah jadi cek-lalu-tulis, dua pendaftar bersamaan bisa menembus maxUses.
  redeem(code: string): Promise<Result<InviteCodeEntity, InviteError>>;
}

// ── Provisioning tenant ──────────────────────────────────────────────────────

export interface TenantProvisionInput {
  readonly name: string;
  readonly slug: string;
  readonly inviteCodeId: string;
  readonly quotaMessages: number;
  readonly quotaWebsites: number;
  readonly trialDays: number;
}

export interface TenantProvisionPort {
  create(input: TenantProvisionInput): Promise<Result<TenantId, RepositoryError>>;
}

// ── Kuota ────────────────────────────────────────────────────────────────────

export type QuotaReason = 'MESSAGES' | 'TRIAL_EXPIRED' | 'SUSPENDED';

export interface QuotaDecision {
  readonly allowed: boolean;
  readonly reason?: QuotaReason;
  readonly remaining: number;
}

export interface QuotaPort {
  // Diperiksa SEBELUM LLM dipanggil — kuota yang dicek setelah biaya terjadi tak melindungi
  // apa pun (pelajaran dari audit P0: rate limit keluar tak menjaga anggaran token).
  check(tenantId: TenantId): Promise<Result<QuotaDecision, RepositoryError>>;
  // Increment atomik. Dipanggil hanya saat pesan BENAR-BENAR diproses.
  consume(tenantId: TenantId): Promise<Result<void, RepositoryError>>;
}
