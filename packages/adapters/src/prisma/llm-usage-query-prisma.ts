// T-082: agregasi pemakaian LLM di atas Prisma.
//
// Memakai $queryRaw (bukan groupBy Prisma) karena kita perlu bucket HARIAN (date_trunc) +
// join nama tenant — dua hal yang tak bisa diungkapkan lewat groupBy typed. Query di sini
// bersifat LINTAS-TENANT secara sengaja (laporan admin/PO), sehingga TIDAK boleh memakai
// klien ber-tenantGuard. Filter `tenantId` disediakan untuk laporan per-tenant.

import { err, ok } from '@digimaestro/shared';
import type {
  LlmUsageQueryPort,
  RepositoryError,
  Result,
  TenantUsage,
  UsageBucket,
  UsageQuery,
} from '@digimaestro/shared';

// Interface sempit → teruji tanpa DB.
export interface RawQueryClient {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
}

const DEFAULT_DAYS = 30;

function range(query: UsageQuery): { since: Date; until: Date } {
  const until = query.until ? new Date(query.until) : new Date();
  const since = query.since
    ? new Date(query.since)
    : new Date(until.getTime() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
  return { since, until };
}

export class LlmUsageQueryPrisma implements LlmUsageQueryPort {
  constructor(private readonly client: RawQueryClient) {}

  async byDay(query: UsageQuery = {}): Promise<Result<UsageBucket[], RepositoryError>> {
    const { since, until } = range(query);
    try {
      const rows = await this.client.$queryRawUnsafe<
        { day: Date; token_in: bigint; token_out: bigint; calls: bigint }[]
      >(
        `SELECT date_trunc('day', "createdAt") AS day,
                SUM("tokenIn")  AS token_in,
                SUM("tokenOut") AS token_out,
                COUNT(*)        AS calls
         FROM "LlmUsage"
         WHERE "createdAt" >= $1 AND "createdAt" <= $2
           AND ($3::text IS NULL OR "tenantId" = $3)
         GROUP BY 1
         ORDER BY 1 ASC`,
        since,
        until,
        query.tenantId ?? null,
      );

      return ok(
        rows.map((r) => ({
          day: new Date(r.day).toISOString().slice(0, 10),
          tokenIn: Number(r.token_in),
          tokenOut: Number(r.token_out),
          calls: Number(r.calls),
        })),
      );
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async byTenant(query: UsageQuery = {}): Promise<Result<TenantUsage[], RepositoryError>> {
    const { since, until } = range(query);
    try {
      const rows = await this.client.$queryRawUnsafe<
        { tenant_id: string; tenant_name: string; token_in: bigint; token_out: bigint; calls: bigint }[]
      >(
        `SELECT u."tenantId"           AS tenant_id,
                COALESCE(t."name", '?') AS tenant_name,
                SUM(u."tokenIn")       AS token_in,
                SUM(u."tokenOut")      AS token_out,
                COUNT(*)               AS calls
         FROM "LlmUsage" u
         LEFT JOIN "Tenant" t ON t."id" = u."tenantId"
         WHERE u."createdAt" >= $1 AND u."createdAt" <= $2
           AND ($3::text IS NULL OR u."tenantId" = $3)
         GROUP BY 1, 2
         ORDER BY (SUM(u."tokenIn") + SUM(u."tokenOut")) DESC`,
        since,
        until,
        query.tenantId ?? null,
      );

      return ok(
        rows.map((r) => ({
          tenantId: r.tenant_id,
          tenantName: r.tenant_name,
          tokenIn: Number(r.token_in),
          tokenOut: Number(r.token_out),
          calls: Number(r.calls),
        })),
      );
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }
}
