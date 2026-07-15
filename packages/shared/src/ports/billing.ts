// Port: billing langganan (E1, PO 2026-07-15 — gateway MIDTRANS, menggantikan rencana
// Xendit). Alur: publish live sukses → buat transaksi Snap → kirim link bayar ke chat
// konsumen → poller memeriksa status (webhook mustahil: VPS tanpa domain publik) →
// settlement → Tenant ACTIVE + serviceEndsAt + notifikasi.

import type { Port, Result, TenantId } from '../index.js';
import type { RepositoryError } from './repository.js';

export type PaymentStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';

export interface BillingError {
  readonly code: 'AUTH' | 'HTTP' | 'CONFIG' | 'UNKNOWN';
  readonly message: string;
}

export interface PaymentLink {
  readonly paymentUrl: string;
}

export interface PaymentGatewayPort extends Port {
  readonly name: 'PaymentGateway';
  readonly provider: string;
  createPaymentLink(input: {
    readonly orderId: string;
    readonly amountIdr: number;
    readonly customerName?: string;
    readonly description?: string;
  }): Promise<Result<PaymentLink, BillingError>>;
  getStatus(orderId: string): Promise<Result<PaymentStatus, BillingError>>;
}

export interface InvoiceEntity {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly orderId: string;
  readonly amountIdr: number;
  readonly periodDays: number;
  readonly paymentUrl: string;
  readonly status: string;
  readonly paidAt: string | null;
  readonly createdAt: string;
}

export interface InvoiceRepository extends Port {
  readonly name: 'InvoiceRepository';
  create(
    tenantId: TenantId,
    input: {
      readonly provider: string;
      readonly orderId: string;
      readonly amountIdr: number;
      readonly periodDays: number;
      readonly paymentUrl: string;
    },
  ): Promise<Result<InvoiceEntity, RepositoryError>>;
  // Invoice PENDING milik satu tenant (dipakai ulang saat publish berulang).
  findOpenByTenant(tenantId: TenantId): Promise<Result<InvoiceEntity | null, RepositoryError>>;
  // SEMUA invoice PENDING lintas tenant — untuk poller sistem (bukan jalur tenant).
  findPending(limit: number): Promise<Result<readonly InvoiceEntity[], RepositoryError>>;
  markStatus(
    id: string,
    status: PaymentStatus,
    paidAt?: string,
  ): Promise<Result<void, RepositoryError>>;
}

// Status layanan tenant utk billing (aktivasi + basis perpanjangan).
export interface BillingTenantPort extends Port {
  readonly name: 'BillingTenant';
  getService(
    tenantId: TenantId,
  ): Promise<Result<{ status: string; serviceEndsAt: string | null }, RepositoryError>>;
  activate(tenantId: TenantId, serviceEndsAt: string): Promise<Result<void, RepositoryError>>;
}
