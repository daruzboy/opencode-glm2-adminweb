// Port: konsol admin via chat (PO 2026-07-15) — chat Telegram ADMIN mengelola BANYAK
// konsumen: daftar, buat baru, lalu "bertindak sebagai" satu konsumen sehingga seluruh
// alur (wawancara → build → review → preview → publish) berjalan atas nama tenant itu
// dan semua notifikasinya mendarat di chat admin.
//
// Keamanan: HANYA chat_id admin (env) yang bisa memakai perintah & pemetaan acting;
// pesan tenant lain tak pernah menyentuh jalur ini (NFR-09 tetap: satu pesan = satu
// tenantId efektif).

import type { Port, Result } from '../index.js';

export interface AdminCustomerSummary {
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly websiteSlug: string | null;
  readonly websiteStatus: string | null;
}

export interface AdminConsoleError {
  readonly code: 'CONFLICT' | 'NOT_FOUND' | 'UNKNOWN';
  readonly message: string;
}

// Direktori tenant LINTAS-tenant — hanya boleh dipakai di balik gerbang chat admin.
export interface AdminDirectoryPort extends Port {
  readonly name: 'AdminDirectory';
  list(): Promise<Result<readonly AdminCustomerSummary[], AdminConsoleError>>;
  findBySlug(slug: string): Promise<Result<AdminCustomerSummary | null, AdminConsoleError>>;
  // Buat tenant konsumen baru (tanpa binding chat — konsumen bisa diikat belakangan
  // via kode undangan). Kuota trial default berlaku.
  create(name: string): Promise<Result<AdminCustomerSummary, AdminConsoleError>>;
}

// Pemetaan "chat admin sedang bertindak sebagai tenant mana".
export interface ActingStorePort extends Port {
  readonly name: 'ActingStore';
  get(chatId: string): Promise<string | null>;
  set(chatId: string, tenantId: string): Promise<void>;
  clear(chatId: string): Promise<void>;
}
