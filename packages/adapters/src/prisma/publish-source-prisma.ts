// Implementasi PublishSourcePort di atas Prisma (T-063, BRU-02; packages/adapters — SOLID-D).
// Konten publish diambil dari DB tepercaya (Website+Revision), tenant-scoped: verifikasi Website
// milik tenant DULU (guard NFR-09 via where.tenantId) → baru ambil Revision by number di website
// itu. Website/revisi tak cocok tenant → null (tak membocorkan keberadaan).

import { err, ok } from '@digimaestro/shared';
import type {
  PublishSource,
  PublishSourceLookup,
  PublishSourcePort,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';

// Subset delegate Prisma yang dipakai adapter (interface sempit → fake di test tanpa DB).
export interface PublishSourceDelegate {
  readonly website: {
    findFirst(args: { where: { id: string; tenantId: string } }): Promise<{ id: string; slug: string } | null>;
  };
  readonly revision: {
    findFirst(args: { where: { websiteId: string; number: number } }): Promise<{ siteDoc: unknown } | null>;
  };
}

export class PublishSourcePrisma implements PublishSourcePort {
  constructor(private readonly delegate: PublishSourceDelegate) {}

  async getPublishSource(
    tenantId: TenantId,
    input: PublishSourceLookup,
  ): Promise<Result<PublishSource | null, RepositoryError>> {
    try {
      const website = await this.delegate.website.findFirst({
        where: { id: input.websiteId, tenantId: String(tenantId) },
      });
      if (!website) return ok(null); // website tak ada / lintas tenant

      const revision = await this.delegate.revision.findFirst({
        where: { websiteId: input.websiteId, number: input.revisionNumber },
      });
      if (!revision) return ok(null);

      return ok({
        websiteId: input.websiteId,
        revisionNumber: input.revisionNumber,
        slug: website.slug,
        siteDocument: revision.siteDoc,
      });
    } catch (e) {
      return err({ code: 'UNKNOWN', message: `gagal memuat sumber publish: ${(e as Error).message}` });
    }
  }
}
