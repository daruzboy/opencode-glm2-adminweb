// Port: produsen antrean publish (T-063, FR-PUB-004; SRS §3.2, ADR-2). api meng-enqueue
// job publish (approval-first BRU-02) → worker mengkonsumsi (publish-worker). Nama antrean
// = kontrak bersama api (produsen) & worker (konsumen). Adapter BullMQ di packages/adapters.

import type { PublishError } from './publish.js';
import type { Result } from '../index.js';

export const PUBLISH_QUEUE_NAME = 'publish';

// Payload job publish (selaras PublishJobData di worker). siteDocument sudah divalidasi
// worker via parseSiteDocument (Port `unknown` agar shared tak bergantung sites-kit).
export interface PublishJobRequest {
  // Pemilik job. Dibawa di payload (T-032tg) karena worker perlu tahu HARUS MENGABARI
  // SIAPA saat situs selesai/gagal terbit — Website/Revision bisa di-query, tapi tanpa
  // tenantId worker tak punya titik awal yang tenant-scoped (NFR-09).
  readonly tenantId: string;
  readonly websiteId: string;
  readonly revisionNumber: number;
  readonly slug: string;
  readonly baseUrl: string;
  readonly siteDocument: unknown;
  // P2 dual-mode: 'sections-v1' (default bila absen) | 'mobirise-v1'. Ikut payload supaya
  // worker memilih perakit berkas yang benar tanpa query balik.
  readonly renderEngine?: string;
  readonly docroot?: string;
  readonly rootDomain?: string;
  // Bentuk URL yang dijanjikan ke pengguna → worker memverifikasi URL yang SAMA.
  readonly urlMode?: 'subdomain' | 'path';
  // 'preview' (P5/P6 UX): unggah ke digimaestro.id/preview/<slug-token>/ (noindex, tanpa
  // artifact rollback, notifikasi = pesan pratinjau + tombol approval — BUKAN "sudah live").
  // Kenapa preview statis di hosting publik: VPS hanya terjangkau via tailnet — tautan
  // /api/preview tak bisa dibuka pelanggan (temuan uji nyata 2026-07-15). Default 'live'.
  readonly mode?: 'live' | 'preview';
}

export interface EnqueueResult {
  readonly jobId: string;
}

export interface PublishQueuePort {
  enqueuePublish(job: PublishJobRequest): Promise<Result<EnqueueResult, PublishError>>;
}
