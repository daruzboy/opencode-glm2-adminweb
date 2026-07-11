import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '@digimaestro/shared';
import { buildUsageReport, type UsageReportDeps } from './usage-report.js';

const PRICE = { inputPer1M: 0.27, outputPer1M: 1.1 };

function deps(over: Partial<UsageReportDeps> = {}): UsageReportDeps {
  return {
    price: over.price ?? PRICE,
    usage: over.usage ?? {
      byDay: vi.fn(async () =>
        ok([
          { day: '2026-07-10', tokenIn: 1_000_000, tokenOut: 500_000, calls: 10 },
          { day: '2026-07-11', tokenIn: 2_000_000, tokenOut: 1_000_000, calls: 20 },
        ]),
      ),
      byTenant: vi.fn(async () =>
        ok([
          { tenantId: 't1', tenantName: 'Warung', tokenIn: 1_000_000, tokenOut: 500_000, calls: 10 },
          { tenantId: 't2', tenantName: 'Sate', tokenIn: 2_000_000, tokenOut: 1_000_000, calls: 20 },
        ]),
      ),
    },
  } as UsageReportDeps;
}

describe('buildUsageReport — biaya dihitung dari TOKEN × harga', () => {
  it('total token & biaya benar', async () => {
    const res = await buildUsageReport(deps());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.totalTokenIn).toBe(3_000_000);
    expect(res.value.totalTokenOut).toBe(1_500_000);
    // 3M×0.27 + 1.5M×1.10 = 0.81 + 1.65 = 2.46
    expect(res.value.totalCostUsd).toBeCloseTo(2.46, 6);
    expect(res.value.totalCalls).toBe(30);
  });

  // Kolom `cost` historis TIDAK dipakai — di produksi ia terlanjur $0.0000 untuk 123k token
  // karena harga tak pernah diisi. Menghitung ulang dari token menyelamatkan data lama.
  it('biaya ikut harga TERKINI (bukan kolom cost lama)', async () => {
    const murah = await buildUsageReport(deps({ price: { inputPer1M: 0.1, outputPer1M: 0.1 } }));
    const mahal = await buildUsageReport(deps({ price: { inputPer1M: 1, outputPer1M: 1 } }));

    expect(murah.ok && mahal.ok).toBe(true);
    if (!murah.ok || !mahal.ok) return;
    expect(mahal.value.totalCostUsd).toBeGreaterThan(murah.value.totalCostUsd);
  });

  // Harga 0 tak boleh disalahartikan sebagai "gratis".
  it('harga belum diisi → priceConfigured=false (bukan diam-diam $0)', async () => {
    const res = await buildUsageReport(deps({ price: { inputPer1M: 0, outputPer1M: 0 } }));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.priceConfigured).toBe(false);
    expect(res.value.totalCostUsd).toBe(0);
    // Tokennya tetap FAKTA — tak ikut nol.
    expect(res.value.totalTokenIn).toBe(3_000_000);
  });

  it('tenant paling boros di urutan atas (PO langsung lihat siapa)', async () => {
    const res = await buildUsageReport(deps());

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.byTenant[0]?.tenantId).toBe('t2');
  });

  it('query gagal → err', async () => {
    const res = await buildUsageReport(
      deps({
        usage: {
          byDay: vi.fn(async () => err({ code: 'UNKNOWN' as const, message: 'db mati' })),
          byTenant: vi.fn(async () => ok([])),
        },
      }),
    );

    expect(res.ok).toBe(false);
  });
});
