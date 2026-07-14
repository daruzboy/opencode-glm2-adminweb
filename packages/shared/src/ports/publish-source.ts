// Port: sumber publish tepercaya (T-063, BRU-02 approval-first). Konten yang dipublikasikan
// diambil dari DB (Website+Revision milik tenant), BUKAN dari body request klien — mencegah
// publikasi konten sembarang. Adapter Prisma (tenant-scoped) di packages/adapters.

import type { RepositoryError } from './repository.js';
import type { Result, TenantId } from '../index.js';

export interface PublishSource {
  readonly websiteId: string;
  readonly revisionNumber: number;
  readonly slug: string;
  // Site Document tersimpan (Revision.siteDoc, JSONB). Divalidasi saat build (worker).
  readonly siteDocument: unknown;
  // P2 dual-mode: engine revisi ('sections-v1' | 'mobirise-v1'); absen = sections-v1.
  readonly renderEngine?: string;
  // mobirise-v1: template asal (resolusi aset saat publish).
  readonly templateId?: string | null;
}

export interface PublishSourceLookup {
  readonly websiteId: string;
  readonly revisionNumber: number;
}

export interface PublishSourcePort {
  // Tenant-scoped: revisi harus milik website milik tenant. null bila tak ada / lintas tenant
  // (tak membedakan → tak membocorkan keberadaan).
  getPublishSource(
    tenantId: TenantId,
    input: PublishSourceLookup,
  ): Promise<Result<PublishSource | null, RepositoryError>>;
}
