// Implementasi FeedbackRepository di atas Prisma (dashboard admin, PO 2026-07-15).

import type { Feedback as PrismaFeedback } from '@prisma/client';
import { err, ok } from '@digimaestro/shared';
import type {
  FeedbackEntity,
  FeedbackKind,
  FeedbackRepository,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';

export interface FeedbackDelegate {
  create(args: {
    data: { tenantId: string; kind: string; text: string };
  }): Promise<PrismaFeedback>;
}

export class FeedbackRepositoryPrisma implements FeedbackRepository {
  readonly name = 'FeedbackRepository' as const;

  constructor(private readonly delegate: FeedbackDelegate) {}

  async create(
    tenantId: TenantId,
    input: { kind: FeedbackKind; text: string },
  ): Promise<Result<FeedbackEntity, RepositoryError>> {
    try {
      const row = await this.delegate.create({
        data: { tenantId, kind: input.kind, text: input.text },
      });
      return ok({
        id: row.id,
        tenantId: row.tenantId,
        kind: row.kind as FeedbackKind,
        text: row.text,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      });
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }
}
