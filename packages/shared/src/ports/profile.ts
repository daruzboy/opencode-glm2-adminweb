// Port: memori per tenant (permintaan PO 2026-07-15) — konteks yang MENGIKAT antar sesi:
// nama panggilan pelanggan, brief usaha terakhir, catatan preferensi. Riwayat chat hanya
// membawa 20 pesan terakhir; tanpa memori ini, sesi edit minggu depan mulai dari nol.
//
// Ditulis dari dua arah: (1) tool agent `remember_customer` (LLM mencatat nama/preferensi
// saat mengetahuinya), (2) auto-capture brief saat build sukses (deterministik, gratis).
// Dibaca replier tiap giliran → bagian "KONTEKS PELANGGAN" di system prompt.

import type { RepositoryError } from './repository.js';
import type { Port, Result, TenantId } from '../index.js';

export interface TenantProfileEntity {
  readonly tenantId: string;
  readonly customerName: string | null;
  // InterviewBrief terakhir yang berhasil di-build (bentuk longgar — core yang tahu).
  readonly brief: unknown | null;
  readonly notes: readonly string[];
  readonly updatedAt: string;
}

export interface TenantProfilePatch {
  readonly customerName?: string;
  readonly brief?: unknown;
  // Catatan baru DITAMBAHKAN (bukan mengganti); repo memangkas ke N terbaru.
  readonly addNote?: string;
}

// Maksimum catatan tersimpan — konteks ini masuk prompt TIAP pesan (biaya token).
export const PROFILE_MAX_NOTES = 20;

export interface TenantProfileRepository extends Port {
  readonly name: 'TenantProfileRepository';
  get(tenantId: TenantId): Promise<Result<TenantProfileEntity | null, RepositoryError>>;
  upsert(
    tenantId: TenantId,
    patch: TenantProfilePatch,
  ): Promise<Result<TenantProfileEntity, RepositoryError>>;
}
