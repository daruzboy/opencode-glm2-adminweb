// Implementasi MediaRepository di atas Prisma (T-033). Menyuntik tenantId ke setiap
// where/data (NFR-09) — media satu tenant tak pernah terlihat oleh tenant lain.

import type { MediaAsset as PrismaMediaAsset } from '@prisma/client';
import { err, ok } from '@digimaestro/shared';
import type {
  MediaAssetCreateInput,
  MediaAssetEntity,
  MediaRepository,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';

export interface MediaDelegate {
  findFirst(args: {
    where: { tenantId: string; providerFileId: string };
  }): Promise<PrismaMediaAsset | null>;
  findMany(args: {
    where: { tenantId: string };
    orderBy: { createdAt: 'desc' };
  }): Promise<PrismaMediaAsset[]>;
  create(args: {
    data: {
      tenantId: string;
      providerFileId: string;
      storageKey: string;
      url: string;
      contentType: string;
      width: number;
      height: number;
      sizeBytes: number;
    };
  }): Promise<PrismaMediaAsset>;
}

function toEntity(row: PrismaMediaAsset): MediaAssetEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerFileId: row.providerFileId,
    storageKey: row.storageKey,
    url: row.url,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

function toError(e: unknown): RepositoryError {
  // P2002 = (tenantId, providerFileId) sudah ada → foto yang sama dikirim ulang.
  if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') {
    return { code: 'CONFLICT', message: 'media sudah tercatat untuk tenant ini.' };
  }
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
}

export class MediaRepositoryPrisma implements MediaRepository {
  readonly name = 'MediaRepository' as const;

  constructor(private readonly delegate: MediaDelegate) {}

  async findByProviderFileId(
    tenantId: TenantId,
    providerFileId: string,
  ): Promise<Result<MediaAssetEntity | null, RepositoryError>> {
    try {
      const row = await this.delegate.findFirst({ where: { tenantId, providerFileId } });
      return ok(row ? toEntity(row) : null);
    } catch (e) {
      return err(toError(e));
    }
  }

  async findMany(tenantId: TenantId): Promise<Result<MediaAssetEntity[], RepositoryError>> {
    try {
      const rows = await this.delegate.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return ok(rows.map(toEntity));
    } catch (e) {
      return err(toError(e));
    }
  }

  async create(
    tenantId: TenantId,
    input: MediaAssetCreateInput,
  ): Promise<Result<MediaAssetEntity, RepositoryError>> {
    try {
      const row = await this.delegate.create({ data: { tenantId, ...input } });
      return ok(toEntity(row));
    } catch (e) {
      return err(toError(e));
    }
  }
}
