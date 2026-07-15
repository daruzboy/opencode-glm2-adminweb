// Port: tiket pekerjaan per konsumen, dikategorikan per TOPIK (PO 2026-07-15).
// Bot (DeepSeek) mengklasifikasikan permintaan pelanggan di chat → membuat tiket via
// tool create_ticket; admin meninjau/menyelesaikan di dashboard.

import type { RepositoryError } from './repository.js';
import type { Port, Result, TenantId } from '../index.js';

// Topik tiket (bahasa PO): konten = teks/artikel/gambar/banner/isi web · tampilan =
// desain/warna/layout/menu/halaman · ganti-tema = minta tema baru · fitur = formulir/
// tombol WA/integrasi/fungsi baru · akun = billing/hak akses · gangguan = error/lambat/
// fitur tak berjalan · teknis = domain/migrasi/email/keamanan/backup.
export const TICKET_TOPICS = [
  'konten',
  'tampilan',
  'ganti-tema',
  'fitur',
  'akun',
  'gangguan',
  'teknis',
] as const;

export type TicketTopic = (typeof TICKET_TOPICS)[number];

export type TicketPriority = 'normal' | 'tinggi';

export interface TicketCreateInput {
  readonly subject: string;
  readonly body?: string;
  readonly topic?: TicketTopic;
  readonly priority?: TicketPriority;
}

export interface TicketEntity {
  readonly id: string;
  readonly tenantId: string;
  readonly subject: string;
  readonly body: string | null;
  readonly topic: string | null;
  readonly priority: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface TicketRepository extends Port {
  readonly name: 'TicketRepository';
  create(tenantId: TenantId, input: TicketCreateInput): Promise<Result<TicketEntity, RepositoryError>>;
}
