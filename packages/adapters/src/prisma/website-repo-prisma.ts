// Implementasi Port WebsiteRepository di atas Prisma (T-020ext, SRS §8; NFR-09).
// tenantId @unique di schema = satu website per tenant (BRU-01). Tiap method
// menyuntik tenantId ke where (compile + runtime guard). Map row → entity (ISO string).

import type { Website as PrismaWebsite } from '@prisma/client';
import { err, ok } from '@digimaestro/shared';
import type {
  RepositoryError,
  Result,
  TenantId,
  WebsiteCreateInput,
  WebsiteEntity,
  WebsiteRepository,
  WebsiteUpdateInput,
} from '@digimaestro/shared';

// Subset delegate Prisma `website`. Interface sempit → fake di test tanpa DB.
export interface WebsiteDelegate {
  findFirst(args: {
    where: { tenantId: string };
  }): Promise<PrismaWebsite | null>;
  // updateMany (bukan update) karena Prisma update menolak field non-unik di where
  // (tenantId bukan @id/@unique meski @unique — tetap perlu composite). Re-read findFirst.
  updateMany(args: {
    where: { tenantId: string; id: string };
    data: { status?: string; publishedRevisionId?: string | null };
  }): Promise<{ count: number }>;
  create(args: {
    data: { tenantId: string; slug: string; status: string; themeId?: string | null };
  }): Promise<PrismaWebsite>;
}

// Prisma P2002 = pelanggaran unique constraint (tenantId/slug) → CONFLICT (BRU-01: satu
// website/tenant; slug global unik). Cek berbasis `code` tanpa import tipe error vendor.
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}

function toEntity(row: PrismaWebsite): WebsiteEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    status: row.status,
    publishedRevisionId: row.publishedRevisionId,
    themeId: row.themeId,
    deploymentTargetId: row.deploymentTargetId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toError(e: unknown): RepositoryError {
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
}

export class WebsiteRepositoryPrisma implements WebsiteRepository {
  readonly name = 'WebsiteRepository' as const;

  constructor(private readonly delegate: WebsiteDelegate) {}

  async findByTenantId(
    tenantId: TenantId,
  ): Promise<Result<WebsiteEntity | null, RepositoryError>> {
    try {
      const row = await this.delegate.findFirst({ where: { tenantId } });
      return ok(row ? toEntity(row) : null);
    } catch (e) {
      return err(toError(e));
    }
  }

  // Onboarding: buat Website (DRAFTING) untuk tenant. tenantId disuntik (NFR-09). Tenant
  // sudah punya website ATAU slug terpakai → CONFLICT (BRU-01: satu website/tenant).
  async create(
    tenantId: TenantId,
    input: WebsiteCreateInput,
  ): Promise<Result<WebsiteEntity, RepositoryError>> {
    try {
      const row = await this.delegate.create({
        data: {
          tenantId,
          slug: input.slug,
          status: input.status ?? 'DRAFTING',
          themeId: input.themeId ?? null,
        },
      });
      return ok(toEntity(row));
    } catch (e) {
      if (isUniqueViolation(e)) {
        return err({ code: 'CONFLICT', message: 'Website sudah ada untuk tenant ini atau slug terpakai.' });
      }
      return err(toError(e));
    }
  }

  async update(
    tenantId: TenantId,
    websiteId: string,
    input: WebsiteUpdateInput,
  ): Promise<Result<WebsiteEntity, RepositoryError>> {
    if (input.status === undefined && input.publishedRevisionId === undefined) {
      return err({ code: 'CONFLICT', message: 'Tidak ada field untuk diperbarui.' });
    }
    try {
      const data: { status?: string; publishedRevisionId?: string | null } = {};
      if (input.status !== undefined) data.status = input.status;
      if (input.publishedRevisionId !== undefined) data.publishedRevisionId = input.publishedRevisionId;

      const res = await this.delegate.updateMany({
        where: { tenantId, id: websiteId },
        data,
      });
      if (res.count === 0) {
        return err({ code: 'NOT_FOUND', message: `Website ${websiteId} tidak ditemukan.` });
      }
      const row = await this.delegate.findFirst({ where: { tenantId } });
      if (row === null) {
        return err({ code: 'NOT_FOUND', message: `Website ${websiteId} tidak ditemukan.` });
      }
      return ok(toEntity(row));
    } catch (e) {
      return err(toError(e));
    }
  }
}
