// Implementasi Port MessageRepository di atas Prisma (packages/adapters — SOLID-D).
// Tiap method MENYUNTIK tenantId ke `where`/`data` (NFR-09). Map row Prisma (Date) →
// entity (ISO string). Dipakai oleh web chat (T-040) & webhook WABA (T-030) — kanal
// berbeda, riwayat terpadu karena same Conversation/Message per tenant.

import type { Message as PrismaMessage } from '@prisma/client';
import { err, ok } from '@digimaestro/shared';
import type {
  MessageCreateInput,
  MessageEntity,
  MessageRepository,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';

// Subset delegate Prisma `message`. Interface sempit → fake di test tanpa DB.
export interface MessageDelegate {
  findMany(args: {
    where: { tenantId: string; conversationId: string };
    orderBy: { createdAt: 'asc' };
  }): Promise<PrismaMessage[]>;
  create(args: {
    data: {
      tenantId: string;
      conversationId: string;
      direction: string;
      type: string;
      text?: string | null;
      mediaId?: string | null;
      providerMsgId: string;
      status: string;
    };
  }): Promise<PrismaMessage>;
}

function toEntity(row: PrismaMessage): MessageEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    direction: row.direction,
    type: row.type,
    text: row.text,
    mediaId: row.mediaId,
    providerMsgId: row.providerMsgId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function toError(e: unknown): RepositoryError {
  // P2002 = pelanggaran unique. Di Message satu-satunya unique adalah providerMsgId →
  // pesan ini sudah pernah tercatat. Ini BUKAN kegagalan: webhook kanal (Telegram/WABA)
  // me-retry kiriman yang sama saat kita lambat/5xx, jadi INSERT ke-2 = duplikat yang
  // harus diabaikan (FR-CHN-005 idempotensi). Dipetakan ke CONFLICT agar use case bisa
  // membedakannya dari error DB sungguhan. Constraint DB = sumber kebenaran → aman
  // terhadap race dua worker memproses update yang sama bersamaan.
  if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') {
    return { code: 'CONFLICT', message: 'providerMsgId sudah tercatat (pesan duplikat).' };
  }
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
}

export class MessageRepositoryPrisma implements MessageRepository {
  readonly name = 'MessageRepository' as const;

  constructor(private readonly delegate: MessageDelegate) {}

  async findManyByConversation(
    tenantId: TenantId,
    conversationId: string,
  ): Promise<Result<MessageEntity[], RepositoryError>> {
    try {
      const rows = await this.delegate.findMany({
        where: { tenantId, conversationId },
        orderBy: { createdAt: 'asc' },
      });
      return ok(rows.map(toEntity));
    } catch (e) {
      return err(toError(e));
    }
  }

  async create(
    tenantId: TenantId,
    input: MessageCreateInput,
  ): Promise<Result<MessageEntity, RepositoryError>> {
    try {
      const row = await this.delegate.create({
        data: {
          tenantId,
          conversationId: input.conversationId,
          direction: input.direction,
          type: input.type,
          text: input.text ?? null,
          mediaId: input.mediaId ?? null,
          providerMsgId: input.providerMsgId,
          status: input.status ?? 'QUEUED',
        },
      });
      return ok(toEntity(row));
    } catch (e) {
      return err(toError(e));
    }
  }
}
