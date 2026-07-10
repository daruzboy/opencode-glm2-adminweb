// Implementasi PreviewPort di atas Prisma (T-064, FR-PUB-001; packages/adapters — SOLID-D).
// Token preview stateless (HMAC, lihat preview-token.ts): verifikasi token DULU → bila cocok
// baru muat Revision.siteDoc. Revisi tak ada ATAU token salah → keduanya null (tak membocorkan
// keberadaan revisi, sesuai kontrak Port). Revision tidak ter-scope tenant langsung (via
// Website) → query by id tanpa memicu tenantGuardExtension.

import { err, ok } from '@digimaestro/shared';
import type { PreviewLookup, PreviewPort, PreviewRevision, RepositoryError, Result } from '@digimaestro/shared';
import { verifyPreviewToken } from './preview-token.js';

// Subset delegate Prisma `revision` yang dipakai adapter. Mendependensi interface (bukan
// PrismaClient penuh) → fake bisa disuntik di test tanpa DB. Kompatibel struktural dgn
// prisma.revision.findUnique.
export interface RevisionPreviewDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<{ id: string; websiteId: string; siteDoc: unknown } | null>;
}

export class PreviewPortPrisma implements PreviewPort {
  constructor(
    private readonly delegate: RevisionPreviewDelegate,
    private readonly tokenSecret: string,
  ) {}

  async getPreview(input: PreviewLookup): Promise<Result<PreviewRevision | null, RepositoryError>> {
    // Verifikasi token sebelum menyentuh DB: token salah = null tanpa mengungkap apakah
    // revisi ada. timing-safe compare (verifyPreviewToken).
    if (!verifyPreviewToken(this.tokenSecret, input.revisionId, input.token)) {
      return ok(null);
    }
    try {
      const rev = await this.delegate.findUnique({ where: { id: input.revisionId } });
      if (!rev) return ok(null);
      return ok({ revisionId: rev.id, websiteId: rev.websiteId, siteDocument: rev.siteDoc });
    } catch (e) {
      return err({ code: 'UNKNOWN', message: `gagal memuat revisi preview: ${(e as Error).message}` });
    }
  }
}
