// E1 billing: invoice setelah live (reuse/skip/create) + poller status (lunas → aktif).

import { describe, expect, it, vi } from 'vitest';
import { err, ok, tenantId } from '@digimaestro/shared';
import type { BillingTenantPort, InvoiceEntity, InvoiceRepository, PaymentGatewayPort } from '@digimaestro/shared';
import { createSubscriptionInvoice, pollPendingInvoices } from './subscription.js';

const T1 = tenantId('tenant-billing-1');
const NOW = new Date('2026-07-15T12:00:00Z');

function inv(over: Partial<InvoiceEntity> = {}): InvoiceEntity {
  return {
    id: 'inv1', tenantId: String(T1), provider: 'midtrans', orderId: 'dm-x-1', amountIdr: 150_000,
    periodDays: 30, paymentUrl: 'https://pay.example/a', status: 'PENDING', paidAt: null,
    createdAt: NOW.toISOString(), ...over,
  };
}

function gateway(status: 'PAID' | 'PENDING' | 'EXPIRED' = 'PENDING'): PaymentGatewayPort & Record<string, ReturnType<typeof vi.fn>> {
  return {
    name: 'PaymentGateway', provider: 'midtrans',
    createPaymentLink: vi.fn(async () => ok({ paymentUrl: 'https://pay.example/new' })),
    getStatus: vi.fn(async () => ok(status)),
  } as never;
}

function invoices(open: InvoiceEntity | null, pending: InvoiceEntity[] = []): InvoiceRepository & Record<string, ReturnType<typeof vi.fn>> {
  return {
    name: 'InvoiceRepository',
    create: vi.fn(async (_t, input) => ok(inv({ ...input, id: 'baru' }))),
    findOpenByTenant: vi.fn(async () => ok(open)),
    findPending: vi.fn(async () => ok(pending)),
    markStatus: vi.fn(async () => ok(undefined)),
  } as never;
}

function tenants(serviceEndsAt: string | null = null): BillingTenantPort & Record<string, ReturnType<typeof vi.fn>> {
  return {
    name: 'BillingTenant',
    getService: vi.fn(async () => ok({ status: 'TRIALING', serviceEndsAt })),
    activate: vi.fn(async () => ok(undefined)),
    hold: vi.fn(async () => ok(undefined)),
  } as never;
}

const config = { priceIdr: 150_000, periodDays: 30 };

describe('createSubscriptionInvoice', () => {
  it('invoice PENDING yang ada dipakai ulang (tanpa transaksi baru)', async () => {
    const g = gateway();
    const r = await createSubscriptionInvoice(
      { gateway: g, invoices: invoices(inv()), tenants: tenants(), config, now: () => NOW },
      { tenantId: T1 },
    );
    expect(r.ok && r.value.kind).toBe('reused');
    expect(g.createPaymentLink).not.toHaveBeenCalled();
  });

  it('layanan masih aktif → skipped (publish revisi ≠ tagihan baru)', async () => {
    const r = await createSubscriptionInvoice(
      { gateway: gateway(), invoices: invoices(null), tenants: tenants('2026-08-01T00:00:00Z'), config, now: () => NOW },
      { tenantId: T1 },
    );
    expect(r.ok && r.value.kind).toBe('skipped');
  });

  it('tanpa invoice terbuka & layanan habis → transaksi Snap baru + baris invoice', async () => {
    const g = gateway();
    const repo = invoices(null);
    const r = await createSubscriptionInvoice(
      { gateway: g, invoices: repo, tenants: tenants('2026-07-01T00:00:00Z'), config, now: () => NOW },
      { tenantId: T1 },
    );
    expect(r.ok && r.value.kind).toBe('created');
    expect(r.ok && r.value.paymentUrl).toBe('https://pay.example/new');
    expect(repo.create).toHaveBeenCalledWith(T1, expect.objectContaining({ amountIdr: 150_000, periodDays: 30 }));
  });

  it('gateway gagal → error (invoice TIDAK dibuat)', async () => {
    const g = gateway();
    g.createPaymentLink = vi.fn(async () => err({ code: 'AUTH' as const, message: '401' }));
    const repo = invoices(null);
    const r = await createSubscriptionInvoice(
      { gateway: g, invoices: repo, tenants: tenants(), config, now: () => NOW },
      { tenantId: T1 },
    );
    expect(r.ok).toBe(false);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('pollPendingInvoices', () => {
  it('settlement → PAID + ACTIVE + serviceEndsAt (now+period) + notifikasi', async () => {
    const repo = invoices(null, [inv()]);
    const t = tenants(null);
    const notify = vi.fn(async () => undefined);
    const r = await pollPendingInvoices({
      gateway: gateway('PAID'), invoices: repo, tenants: t, notify, now: () => NOW,
    });
    expect(r.ok && r.value.paid).toBe(1);
    expect(repo.markStatus).toHaveBeenCalledWith('inv1', 'PAID', NOW.toISOString());
    const endsAt = new Date(NOW.getTime() + 30 * 86_400_000).toISOString();
    expect(t.activate).toHaveBeenCalledWith(T1, endsAt);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('layanan berjalan diperpanjang dari serviceEndsAt lama, bukan dari sekarang', async () => {
    const lama = '2026-07-20T00:00:00Z';
    const t = tenants(lama);
    await pollPendingInvoices({
      gateway: gateway('PAID'), invoices: invoices(null, [inv()]), tenants: t,
      notify: vi.fn(async () => undefined), now: () => NOW,
    });
    expect(t.activate).toHaveBeenCalledWith(T1, new Date(new Date(lama).getTime() + 30 * 86_400_000).toISOString());
  });

  it('expire → EXPIRED + situs DITAHAN (hold) + pelanggan dikabari; pending dibiarkan', async () => {
    const repo = invoices(null, [inv({ id: 'a' }), inv({ id: 'b', orderId: 'dm-x-2' })]);
    const g = gateway();
    g.getStatus = vi.fn()
      .mockResolvedValueOnce(ok('EXPIRED'))
      .mockResolvedValueOnce(ok('PENDING'));
    const t = tenants();
    const notify = vi.fn(async () => undefined);
    const r = await pollPendingInvoices({ gateway: g, invoices: repo, tenants: t, notify, now: () => NOW });
    expect(r.ok && r.value).toEqual({ checked: 2, paid: 0, expired: 1 });
    expect(repo.markStatus).toHaveBeenCalledWith('a', 'EXPIRED');
    expect(t.hold).toHaveBeenCalledWith(T1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(t.activate).not.toHaveBeenCalled();
  });

  it('invoice basi kedaluwarsa saat layanan MASIH berjalan → tidak ditahan', async () => {
    const t = tenants('2026-08-01T00:00:00Z');
    const notify = vi.fn(async () => undefined);
    await pollPendingInvoices({
      gateway: gateway('EXPIRED'), invoices: invoices(null, [inv()]), tenants: t, notify, now: () => NOW,
    });
    expect(t.hold).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
