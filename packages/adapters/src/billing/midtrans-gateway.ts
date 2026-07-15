// Adapter Midtrans (E1 billing, keputusan PO 2026-07-15: Midtrans, bukan Xendit).
//
// - Buat link bayar: Snap API POST /snap/v1/transactions → redirect_url (halaman bayar
//   ter-hosting Midtrans; semua metode aktif di akun tampil di sana).
// - Cek status: Core API GET /v2/{order_id}/status. PENTING: transaksi Snap belum muncul
//   di Core sebelum pelanggan MEMULAI pembayaran → 404 berarti PENDING, bukan gagal.
// - Auth: Basic base64(serverKey + ':'). Server key = kredensial (env saja, jangan log).
// fetch di-inject → offline-testable (pola adapter LLM/gambar).

import { err, ok } from '@digimaestro/shared';
import type { BillingError, PaymentGatewayPort, PaymentLink, PaymentStatus, Result } from '@digimaestro/shared';

export interface MidtransFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type MidtransFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<MidtransFetchResponse>;

export interface MidtransGatewayConfig {
  readonly serverKey: string;
  // sandbox (default, uji) | production.
  readonly environment?: 'sandbox' | 'production';
  readonly fetch?: MidtransFetch;
  // Masa berlaku link bayar (jam). Default 24 — kebijakan PO: bayar <24 jam setelah
  // publish, selebihnya situs ditahan.
  readonly expiryHours?: number;
}

const STATUS_MAP: Record<string, PaymentStatus> = {
  settlement: 'PAID',
  capture: 'PAID',
  pending: 'PENDING',
  authorize: 'PENDING',
  expire: 'EXPIRED',
  cancel: 'FAILED',
  deny: 'FAILED',
  failure: 'FAILED',
};

export class MidtransGateway implements PaymentGatewayPort {
  readonly name = 'PaymentGateway' as const;
  readonly provider = 'midtrans';

  private readonly auth: string;
  private readonly snapBase: string;
  private readonly coreBase: string;
  private readonly fetchFn: MidtransFetch;
  private readonly expiryHours: number;

  constructor(config: MidtransGatewayConfig) {
    const prod = config.environment === 'production';
    this.auth = `Basic ${Buffer.from(`${config.serverKey}:`).toString('base64')}`;
    this.snapBase = prod ? 'https://app.midtrans.com/snap/v1' : 'https://app.sandbox.midtrans.com/snap/v1';
    this.coreBase = prod ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2';
    this.fetchFn = config.fetch ?? (globalThis.fetch as unknown as MidtransFetch);
    this.expiryHours = config.expiryHours ?? 24;
  }

  async createPaymentLink(input: {
    orderId: string;
    amountIdr: number;
    customerName?: string;
    description?: string;
  }): Promise<Result<PaymentLink, BillingError>> {
    try {
      const res = await this.fetchFn(`${this.snapBase}/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: this.auth },
        body: JSON.stringify({
          transaction_details: { order_id: input.orderId, gross_amount: input.amountIdr },
          ...(input.customerName ? { customer_details: { first_name: input.customerName.slice(0, 50) } } : {}),
          ...(input.description
            ? { item_details: [{ id: 'langganan', name: input.description.slice(0, 50), price: input.amountIdr, quantity: 1 }] }
            : {}),
          expiry: { unit: 'hours', duration: this.expiryHours },
        }),
      });
      if (res.status === 401) return err({ code: 'AUTH', message: 'server key Midtrans ditolak (401)' });
      if (!res.ok) return err({ code: 'HTTP', message: `Midtrans Snap HTTP ${res.status}` });

      const body = (await res.json()) as { redirect_url?: string };
      if (!body.redirect_url) return err({ code: 'UNKNOWN', message: 'respons Snap tanpa redirect_url' });
      return ok({ paymentUrl: body.redirect_url });
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async getStatus(orderId: string): Promise<Result<PaymentStatus, BillingError>> {
    try {
      const res = await this.fetchFn(`${this.coreBase}/${encodeURIComponent(orderId)}/status`, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: this.auth },
      });
      // Transaksi Snap yang belum dibuka pelanggan belum ada di Core → 404 = masih menunggu.
      if (res.status === 404) return ok('PENDING');
      if (res.status === 401) return err({ code: 'AUTH', message: 'server key Midtrans ditolak (401)' });
      if (!res.ok) return err({ code: 'HTTP', message: `Midtrans status HTTP ${res.status}` });

      const body = (await res.json()) as { transaction_status?: string; fraud_status?: string };
      // capture + fraud "challenge" = tahan dulu (belum lunas).
      if (body.transaction_status === 'capture' && body.fraud_status === 'challenge') return ok('PENDING');
      return ok(STATUS_MAP[body.transaction_status ?? ''] ?? 'PENDING');
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }
}
