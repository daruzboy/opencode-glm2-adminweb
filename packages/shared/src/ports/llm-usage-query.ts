// Port: baca-agregasi pemakaian LLM (T-082 — dashboard biaya AI).
//
// Kenapa perlu: anggaran token terbakar tanpa visibilitas. Tanpa angka ini, PO tak bisa
// menetapkan harga paket (syarat billing) maupun mendeteksi tenant yang boros/nakal.
//
// Baris mentah `LlmUsage` (tokenIn/tokenOut) = FAKTA terukur. Biaya dihitung dari token ×
// harga terkonfigurasi (lihat LlmTokenPrice) — BUKAN dari kolom `cost` historis, yang
// terlanjur 0 karena harga tak pernah diisi.

import type { RepositoryError } from './repository.js';
import type { Result, TenantId } from '../index.js';

export interface UsageBucket {
  // 'YYYY-MM-DD' (UTC).
  readonly day: string;
  readonly tokenIn: number;
  readonly tokenOut: number;
  readonly calls: number;
}

export interface TenantUsage {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tokenIn: number;
  readonly tokenOut: number;
  readonly calls: number;
}

export interface UsageQuery {
  // Rentang inklusif (ISO date). Default: 30 hari terakhir.
  readonly since?: string;
  readonly until?: string;
  // Bila diisi → hanya tenant ini (dipakai tenant melihat pemakaiannya sendiri).
  readonly tenantId?: TenantId;
}

export interface LlmUsageQueryPort {
  // Deret harian (untuk grafik tren).
  byDay(query: UsageQuery): Promise<Result<UsageBucket[], RepositoryError>>;
  // Peringkat per tenant (siapa yang boros).
  byTenant(query: UsageQuery): Promise<Result<TenantUsage[], RepositoryError>>;
}
