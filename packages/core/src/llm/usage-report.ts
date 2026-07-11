// T-082: laporan biaya AI (FR-OPS; NFR biaya). Murni Port — tak kenal Prisma.
//
// Biaya dihitung dari TOKEN (fakta terukur) × harga terkonfigurasi. Kolom `cost` historis
// SENGAJA tidak dipakai: harga tak pernah diisi di composition, jadi seluruh 57 baris awal
// tercatat $0.0000 meski 123k token terbakar. Menghitung ulang dari token menyelamatkan
// data lama sekaligus membuat laporan tetap benar saat harga berubah.

import { estimateCostUsd, isPriceConfigured } from '@digimaestro/shared';
import { err, ok } from '@digimaestro/shared';
import type {
  LlmTokenPrice,
  LlmUsageQueryPort,
  RepositoryError,
  Result,
  UsageQuery,
} from '@digimaestro/shared';

export interface UsageReportDeps {
  readonly usage: LlmUsageQueryPort;
  readonly price: LlmTokenPrice;
}

export interface DailyCost {
  readonly day: string;
  readonly tokenIn: number;
  readonly tokenOut: number;
  readonly calls: number;
  readonly costUsd: number;
}

export interface TenantCost {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tokenIn: number;
  readonly tokenOut: number;
  readonly calls: number;
  readonly costUsd: number;
}

export interface UsageReport {
  readonly totalTokenIn: number;
  readonly totalTokenOut: number;
  readonly totalCalls: number;
  readonly totalCostUsd: number;
  // false → harga token belum diisi (env). Biaya akan 0 — dan itu HARUS terlihat sebagai
  // "belum dikonfigurasi", bukan disalahartikan sebagai "gratis".
  readonly priceConfigured: boolean;
  readonly daily: readonly DailyCost[];
  readonly byTenant: readonly TenantCost[];
}

export async function buildUsageReport(
  deps: UsageReportDeps,
  query: UsageQuery = {},
): Promise<Result<UsageReport, RepositoryError>> {
  const [days, tenants] = await Promise.all([
    deps.usage.byDay(query),
    deps.usage.byTenant(query),
  ]);
  if (!days.ok) return err(days.error);
  if (!tenants.ok) return err(tenants.error);

  const daily: DailyCost[] = days.value.map((b) => ({
    ...b,
    costUsd: estimateCostUsd(b.tokenIn, b.tokenOut, deps.price),
  }));

  const byTenant: TenantCost[] = tenants.value
    .map((t) => ({
      ...t,
      costUsd: estimateCostUsd(t.tokenIn, t.tokenOut, deps.price),
    }))
    // Boros di atas → PO langsung melihat siapa yang perlu ditindak.
    .sort((a, b) => b.tokenIn + b.tokenOut - (a.tokenIn + a.tokenOut));

  const totalTokenIn = daily.reduce((s, d) => s + d.tokenIn, 0);
  const totalTokenOut = daily.reduce((s, d) => s + d.tokenOut, 0);

  return ok({
    totalTokenIn,
    totalTokenOut,
    totalCalls: daily.reduce((s, d) => s + d.calls, 0),
    totalCostUsd: estimateCostUsd(totalTokenIn, totalTokenOut, deps.price),
    priceConfigured: isPriceConfigured(deps.price),
    daily,
    byTenant,
  });
}
