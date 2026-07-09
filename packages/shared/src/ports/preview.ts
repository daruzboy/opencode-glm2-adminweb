// Port: preview draft revisi (T-064, FR-PUB-001). URL preview unik ber-token, noindex.
// Implementasi konkret (Prisma Revision + validasi token) di packages/adapters menyusul
// setelah desain token preview final (domain publish). Handler api bergantung ke Port ini.

import type { Result } from '../index.js';
import type { RepositoryError } from './repository.js';

export interface PreviewRevision {
  readonly revisionId: string;
  readonly websiteId: string;
  // Site Document tersimpan (JSONB Revision.siteDoc). Divalidasi saat render via
  // parseSiteDocument (sites-kit) — Port sengaja `unknown` agar shared tak bergantung
  // ke sites-kit.
  readonly siteDocument: unknown;
}

export interface PreviewLookup {
  readonly revisionId: string;
  readonly token: string;
}

export interface PreviewPort {
  // Kembalikan revisi bila token cocok; null bila revisi tak ada ATAU token salah
  // (tak membedakan keduanya → tidak membocorkan keberadaan revisi).
  getPreview(input: PreviewLookup): Promise<Result<PreviewRevision | null, RepositoryError>>;
}
