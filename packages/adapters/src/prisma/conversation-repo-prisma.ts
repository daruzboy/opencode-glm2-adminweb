// Implementasi Port ConversationRepository di atas Prisma (packages/adapters —
// SOLID-D). Tiap method MENYUNTIK tenantId ke `where`/`data` sebelum mendelegasi,
// sehingga tenant-scoping ditegakkan di lapis repo (NFR-09) terlepas dari guard
// Prisma $extends. Map row Prisma (Date) → entity (ISO string).

import type { Conversation as PrismaConversation } from '@prisma/client';
import { err, ok } from '@digimaestro/shared';
import type {
  ConversationCreateInput,
  ConversationEntity,
  ConversationFilter,
  ConversationRepository,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';

// Subset delegate Prisma `conversation` yang dipakai repo. Mendependensi interface
// (bukan PrismaClient penuh) → fake bisa disuntik di test tanpa DB. Kompatibel
// struktural dgn prisma.conversation (method bivariance).
export interface ConversationDelegate {
  findFirst(args: {
    where: { tenantId: string; id: string };
  }): Promise<PrismaConversation | null>;
  findMany(args: {
    where: { tenantId: string; state?: string };
  }): Promise<PrismaConversation[]>;
  create(args: {
    data: { tenantId: string; channel: string; state?: string };
  }): Promise<PrismaConversation>;
}

function toEntity(row: PrismaConversation): ConversationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    channel: row.channel,
    state: row.state,
    escalatedAt: row.escalatedAt ? row.escalatedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toError(e: unknown): RepositoryError {
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
}

export class ConversationRepositoryPrisma implements ConversationRepository {
  readonly name = 'ConversationRepository' as const;

  constructor(private readonly delegate: ConversationDelegate) {}

  async findById(
    tenantId: TenantId,
    id: string,
  ): Promise<Result<ConversationEntity | null, RepositoryError>> {
    try {
      const row = await this.delegate.findFirst({ where: { tenantId, id } });
      return ok(row ? toEntity(row) : null);
    } catch (e) {
      return err(toError(e));
    }
  }

  async findMany(
    tenantId: TenantId,
    filter?: ConversationFilter,
  ): Promise<Result<ConversationEntity[], RepositoryError>> {
    try {
      const where: { tenantId: string; state?: string } = { tenantId };
      if (filter?.state) where.state = filter.state;
      const rows = await this.delegate.findMany({ where });
      return ok(rows.map(toEntity));
    } catch (e) {
      return err(toError(e));
    }
  }

  async create(
    tenantId: TenantId,
    input: ConversationCreateInput,
  ): Promise<Result<ConversationEntity, RepositoryError>> {
    try {
      const row = await this.delegate.create({
        data: { tenantId, channel: input.channel, state: input.state },
      });
      return ok(toEntity(row));
    } catch (e) {
      return err(toError(e));
    }
  }
}
