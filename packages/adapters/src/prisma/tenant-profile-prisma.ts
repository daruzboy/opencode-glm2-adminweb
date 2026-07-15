// Implementasi TenantProfileRepository di atas Prisma (memori per tenant, PO 2026-07-15).
// tenantId @unique → upsert; catatan dipangkas ke PROFILE_MAX_NOTES terbaru.

import type { TenantProfile as PrismaTenantProfile } from '@prisma/client';
import { PROFILE_MAX_NOTES, err, ok } from '@digimaestro/shared';
import type {
  RepositoryError,
  Result,
  TenantId,
  TenantProfileEntity,
  TenantProfilePatch,
  TenantProfileRepository,
} from '@digimaestro/shared';

export interface TenantProfileDelegate {
  findUnique(args: { where: { tenantId: string } }): Promise<PrismaTenantProfile | null>;
  upsert(args: {
    where: { tenantId: string };
    update: { customerName?: string; brief?: unknown; notes?: string[] };
    create: { tenantId: string; customerName?: string; brief?: unknown; notes?: string[] };
  }): Promise<PrismaTenantProfile>;
}

function toEntity(row: PrismaTenantProfile): TenantProfileEntity {
  return {
    tenantId: row.tenantId,
    customerName: row.customerName,
    brief: row.brief,
    notes: row.notes ?? [],
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toError(e: unknown): RepositoryError {
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
}

export class TenantProfileRepositoryPrisma implements TenantProfileRepository {
  readonly name = 'TenantProfileRepository' as const;

  constructor(private readonly delegate: TenantProfileDelegate) {}

  async get(tenantId: TenantId): Promise<Result<TenantProfileEntity | null, RepositoryError>> {
    try {
      const row = await this.delegate.findUnique({ where: { tenantId } });
      return ok(row ? toEntity(row) : null);
    } catch (e) {
      return err(toError(e));
    }
  }

  async upsert(
    tenantId: TenantId,
    patch: TenantProfilePatch,
  ): Promise<Result<TenantProfileEntity, RepositoryError>> {
    try {
      // Baca dulu utk merangkai notes (append + pangkas) — profil per tenant jarang
      // ditulis paralel; kalaupun balapan, kehilangan satu catatan bukan bencana.
      const existing = await this.delegate.findUnique({ where: { tenantId } });
      const notes = patch.addNote
        ? [...(existing?.notes ?? []), patch.addNote].slice(-PROFILE_MAX_NOTES)
        : undefined;

      const data = {
        ...(patch.customerName !== undefined ? { customerName: patch.customerName } : {}),
        ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
        ...(notes !== undefined ? { notes } : {}),
      };
      const row = await this.delegate.upsert({
        where: { tenantId },
        update: data,
        create: { tenantId, ...data },
      });
      return ok(toEntity(row));
    } catch (e) {
      return err(toError(e));
    }
  }
}
