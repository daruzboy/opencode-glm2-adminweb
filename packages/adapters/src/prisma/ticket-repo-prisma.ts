// Implementasi TicketRepository di atas Prisma (tiket per topik, PO 2026-07-15).

import type { Ticket as PrismaTicket } from '@prisma/client';
import { err, ok } from '@digimaestro/shared';
import type {
  RepositoryError,
  Result,
  TenantId,
  TicketCreateInput,
  TicketEntity,
  TicketRepository,
} from '@digimaestro/shared';

export interface TicketDelegate {
  create(args: {
    data: { tenantId: string; subject: string; body?: string | null; topic?: string | null; priority?: string };
  }): Promise<PrismaTicket>;
}

export class TicketRepositoryPrisma implements TicketRepository {
  readonly name = 'TicketRepository' as const;

  constructor(private readonly delegate: TicketDelegate) {}

  async create(tenantId: TenantId, input: TicketCreateInput): Promise<Result<TicketEntity, RepositoryError>> {
    try {
      const row = await this.delegate.create({
        data: {
          tenantId,
          subject: input.subject,
          body: input.body ?? null,
          topic: input.topic ?? null,
          priority: input.priority ?? 'normal',
        },
      });
      return ok({
        id: row.id,
        tenantId: row.tenantId,
        subject: row.subject,
        body: row.body,
        topic: row.topic,
        priority: row.priority,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      });
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }
}
