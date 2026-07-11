// Implementasi Port ConversationRepository di atas Prisma (packages/adapters —
// SOLID-D). Tiap method MENYUNTIK tenantId ke `where`/`data` sebelum mendelegasi,
// sehingga tenant-scoping ditegakkan di lapis repo (NFR-09) terlepas dari guard
// Prisma $extends. Map row Prisma (Date) → entity (ISO string).

import type { Conversation as PrismaConversation } from '@prisma/client';
import { err, ok } from '@digimaestro/shared';
import type {
  ConversationChannel,
  ConversationCreateInput,
  ConversationEntity,
  ConversationFilter,
  ConversationRepository,
  ConversationUpdateInput,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';

// Subset delegate Prisma `conversation` yang dipakai repo. Mendependensi interface
// (bukan PrismaClient penuh) → fake bisa disuntik di test tanpa DB. Kompatibel
// struktural dgn prisma.conversation (method bivariance).
export interface ConversationDelegate {
  findFirst(args: {
    where:
      | { tenantId: string; id: string }
      | { tenantId: string; channel: string; externalId: string };
  }): Promise<PrismaConversation | null>;
  findMany(args: {
    where: { tenantId: string; state?: string; channel?: string };
  }): Promise<PrismaConversation[]>;
  create(args: {
    data: { tenantId: string; channel: string; externalId?: string | null; state?: string };
  }): Promise<PrismaConversation>;
  // update tenant-scoped dipakai via updateMany (Prisma `update` menolak field
  // non-unik di `where`, padahal tenantId wajib di where untuk guard NFR-09).
  // updateMany menerima filter bebas + tetap lolos tenantGuardExtension. Re-read
  // findFirst mengembalikan row terbaru ke pemanggil.
  updateMany(args: {
    where: { tenantId: string; id: string };
    data: { state?: string };
  }): Promise<{ count: number }>;
}

function toEntity(row: PrismaConversation): ConversationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    channel: row.channel,
    externalId: row.externalId,
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

  // Resolusi percakapan kanal eksternal (T-030tg): (tenant, kanal, chat_id) → Conversation.
  // tenantId disuntik ke `where` seperti method lain (NFR-09) — chat_id milik tenant lain
  // tidak akan pernah terlihat di sini.
  async findByExternalId(
    tenantId: TenantId,
    channel: ConversationChannel,
    externalId: string,
  ): Promise<Result<ConversationEntity | null, RepositoryError>> {
    try {
      const row = await this.delegate.findFirst({ where: { tenantId, channel, externalId } });
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
      const where: { tenantId: string; state?: string; channel?: string } = { tenantId };
      if (filter?.state) where.state = filter.state;
      if (filter?.channel) where.channel = filter.channel;
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
        data: {
          tenantId,
          channel: input.channel,
          externalId: input.externalId ?? null,
          state: input.state,
        },
      });
      return ok(toEntity(row));
    } catch (e) {
      return err(toError(e));
    }
  }

  async update(
    tenantId: TenantId,
    id: string,
    input: ConversationUpdateInput,
  ): Promise<Result<ConversationEntity, RepositoryError>> {
    // Tidak ada field untuk diubah → tolak (mencegah no-op tersamar).
    if (input.state === undefined) {
      return err({ code: 'CONFLICT', message: 'Tidak ada field untuk diperbarui.' });
    }
    try {
      const res = await this.delegate.updateMany({
        where: { tenantId, id },
        data: { state: input.state },
      });
      // count 0 = id tak ada ATAU milik tenant lain (isolasi tetap utuh, NFR-09).
      if (res.count === 0) {
        return err({ code: 'NOT_FOUND', message: `Conversation ${id} tidak ditemukan.` });
      }
      const row = await this.delegate.findFirst({ where: { tenantId, id } });
      if (row === null) {
        return err({ code: 'NOT_FOUND', message: `Conversation ${id} tidak ditemukan.` });
      }
      return ok(toEntity(row));
    } catch (e) {
      return err(toError(e));
    }
  }
}
