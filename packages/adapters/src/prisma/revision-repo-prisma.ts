// Implementasi Port RevisionRepository di atas Prisma (T-020ext, SRS §8; NFR-09).
// Revision TIDAK punya tenantId langsung → tiap method memverifikasi Website milik
// tenant DULU (where tenantId), baru operasi Revision via websiteId. Cross-tenant
// query → null/NOT_FOUND (tak membocorkan keberadaan, konsisten PublishSourcePrisma).
//
// Number auto-increment per website: count existing + 1. Race condition ditangkap
// oleh @@unique([websiteId, number]) di schema (Konflik → error, retry pemanggil).

import type { Revision as PrismaRevision } from '@prisma/client';
import { err, ok } from '@digimaestro/shared';
import type {
  RepositoryError,
  Result,
  RevisionCreateInput,
  RevisionEntity,
  RevisionRepository,
  RevisionUpdateInput,
  TenantId,
} from '@digimaestro/shared';

// Subset delegate — nested website + revision (kompatibel struktural dgn PrismaClient).
export interface RevisionDelegate {
  readonly website: {
    findFirst(args: { where: { id: string; tenantId: string } }): Promise<{ id: string } | null>;
  };
  readonly revision: {
    findFirst(args: {
      where: { id?: string; websiteId: string };
      orderBy?: { number: 'desc' };
    }): Promise<PrismaRevision | null>;
    count(args: { where: { websiteId: string } }): Promise<number>;
    create(args: {
      data: {
        websiteId: string;
        number: number;
        siteDoc: unknown;
        summary?: string | null;
        status: string;
        createdBy: string;
      };
    }): Promise<PrismaRevision>;
    updateMany(args: {
      where: { id: string; websiteId: string };
      data: { status?: string; summary?: string };
    }): Promise<{ count: number }>;
  };
}

function toEntity(row: PrismaRevision): RevisionEntity {
  return {
    id: row.id,
    websiteId: row.websiteId,
    number: row.number,
    siteDoc: row.siteDoc,
    summary: row.summary,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toError(e: unknown): RepositoryError {
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
}

export class RevisionRepositoryPrisma implements RevisionRepository {
  readonly name = 'RevisionRepository' as const;

  constructor(private readonly delegate: RevisionDelegate) {}

  // Guard: pastikan website milik tenant sebelum operasi revision.
  private async assertOwned(
    tenantId: TenantId,
    websiteId: string,
  ): Promise<Result<boolean, RepositoryError>> {
    try {
      const website = await this.delegate.website.findFirst({
        where: { id: websiteId, tenantId: String(tenantId) },
      });
      return ok(website !== null);
    } catch (e) {
      return err(toError(e));
    }
  }

  async findById(
    tenantId: TenantId,
    websiteId: string,
    revisionId: string,
  ): Promise<Result<RevisionEntity | null, RepositoryError>> {
    const owned = await this.assertOwned(tenantId, websiteId);
    if (!owned.ok) return err(owned.error);
    if (!owned.value) return ok(null); // website bukan milik tenant
    try {
      const row = await this.delegate.revision.findFirst({
        where: { id: revisionId, websiteId },
      });
      return ok(row ? toEntity(row) : null);
    } catch (e) {
      return err(toError(e));
    }
  }

  async findLatest(
    tenantId: TenantId,
    websiteId: string,
  ): Promise<Result<RevisionEntity | null, RepositoryError>> {
    const owned = await this.assertOwned(tenantId, websiteId);
    if (!owned.ok) return err(owned.error);
    if (!owned.value) return ok(null);
    try {
      const row = await this.delegate.revision.findFirst({
        where: { websiteId },
        orderBy: { number: 'desc' },
      });
      return ok(row ? toEntity(row) : null);
    } catch (e) {
      return err(toError(e));
    }
  }

  async create(
    tenantId: TenantId,
    input: RevisionCreateInput,
  ): Promise<Result<RevisionEntity, RepositoryError>> {
    const owned = await this.assertOwned(tenantId, input.websiteId);
    if (!owned.ok) return err(owned.error);
    if (!owned.value) {
      return err({ code: 'NOT_FOUND', message: `Website ${input.websiteId} tidak ditemukan.` });
    }
    try {
      const count = await this.delegate.revision.count({
        where: { websiteId: input.websiteId },
      });
      const row = await this.delegate.revision.create({
        data: {
          websiteId: input.websiteId,
          number: count + 1,
          siteDoc: input.siteDoc,
          summary: input.summary ?? null,
          status: input.status ?? 'DRAFT',
          createdBy: input.createdBy,
        },
      });
      return ok(toEntity(row));
    } catch (e) {
      return err(toError(e));
    }
  }

  async update(
    tenantId: TenantId,
    websiteId: string,
    revisionId: string,
    input: RevisionUpdateInput,
  ): Promise<Result<RevisionEntity, RepositoryError>> {
    if (input.status === undefined && input.summary === undefined) {
      return err({ code: 'CONFLICT', message: 'Tidak ada field untuk diperbarui.' });
    }
    const owned = await this.assertOwned(tenantId, websiteId);
    if (!owned.ok) return err(owned.error);
    if (!owned.value) {
      return err({ code: 'NOT_FOUND', message: `Website ${websiteId} tidak ditemukan.` });
    }
    try {
      const data: { status?: string; summary?: string } = {};
      if (input.status !== undefined) data.status = input.status;
      if (input.summary !== undefined) data.summary = input.summary;

      const res = await this.delegate.revision.updateMany({
        where: { id: revisionId, websiteId },
        data,
      });
      if (res.count === 0) {
        return err({ code: 'NOT_FOUND', message: `Revision ${revisionId} tidak ditemukan.` });
      }
      const row = await this.delegate.revision.findFirst({
        where: { id: revisionId, websiteId },
      });
      if (row === null) {
        return err({ code: 'NOT_FOUND', message: `Revision ${revisionId} tidak ditemukan.` });
      }
      return ok(toEntity(row));
    } catch (e) {
      return err(toError(e));
    }
  }
}
