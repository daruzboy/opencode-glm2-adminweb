// Implementasi Port AuditLogPort di atas Prisma.
// Delegate sempit menjaga test DB-free dan memaksa caller memberi tenant scope.

import { err, ok } from '@digimaestro/shared';
import type { AuditLogError, AuditLogPort, AuditLogRecord, Result } from '@digimaestro/shared';

export interface AuditLogDelegate {
  create(args: {
    data: {
      actor: string;
      tenantId?: string;
      action: string;
      meta: unknown;
    };
  }): Promise<unknown>;
}

export class AuditLogPrisma implements AuditLogPort {
  readonly name = 'AuditLog' as const;

  constructor(private readonly delegate: AuditLogDelegate) {}

  async record(record: AuditLogRecord): Promise<Result<void, AuditLogError>> {
    try {
      await this.delegate.create({
        data: {
          actor: record.actor,
          tenantId: record.tenantId,
          action: record.action,
          meta: record.meta,
        },
      });
      return ok(undefined);
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }
}
