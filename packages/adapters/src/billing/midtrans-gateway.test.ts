// Adapter Midtrans: Snap create (redirect_url), pemetaan status Core, 404 = PENDING.

import { describe, expect, it, vi } from 'vitest';
import { MidtransGateway, type MidtransFetch } from './midtrans-gateway.js';

function fetchOnce(status: number, json: unknown): MidtransFetch & ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  })) as never;
}

describe('MidtransGateway', () => {
  it('createPaymentLink → POST Snap sandbox dgn Basic auth; redirect_url dikembalikan', async () => {
    const fetch = fetchOnce(201, { token: 'tok', redirect_url: 'https://app.sandbox.midtrans.com/snap/v4/redirection/tok' });
    const gw = new MidtransGateway({ serverKey: 'SB-server-key', fetch });

    const r = await gw.createPaymentLink({ orderId: 'dm-abc-1', amountIdr: 150_000, customerName: 'Mayang' });
    expect(r.ok && r.value.paymentUrl).toContain('redirection/tok');

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://app.sandbox.midtrans.com/snap/v1/transactions');
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from('SB-server-key:').toString('base64')}`);
    const body = JSON.parse(init.body!);
    expect(body.transaction_details).toEqual({ order_id: 'dm-abc-1', gross_amount: 150_000 });
  });

  it('environment production → host produksi; 401 → AUTH', async () => {
    const fetch = fetchOnce(401, {});
    const gw = new MidtransGateway({ serverKey: 'k', environment: 'production', fetch });
    const r = await gw.createPaymentLink({ orderId: 'x', amountIdr: 1000 });
    expect(!r.ok && r.error.code).toBe('AUTH');
    expect(fetch.mock.calls[0]![0]).toBe('https://app.midtrans.com/snap/v1/transactions');
  });

  it('getStatus: settlement → PAID; expire → EXPIRED; 404 (belum dibuka pelanggan) → PENDING; capture+challenge → PENDING', async () => {
    const cases: [number, unknown, string][] = [
      [200, { transaction_status: 'settlement' }, 'PAID'],
      [200, { transaction_status: 'expire' }, 'EXPIRED'],
      [404, { status_code: '404' }, 'PENDING'],
      [200, { transaction_status: 'capture', fraud_status: 'challenge' }, 'PENDING'],
      [200, { transaction_status: 'deny' }, 'FAILED'],
    ];
    for (const [status, json, expected] of cases) {
      const gw = new MidtransGateway({ serverKey: 'k', fetch: fetchOnce(status, json) });
      const r = await gw.getStatus('dm-abc-1');
      expect(r.ok && r.value).toBe(expected);
    }
  });
});
