// Implementasi InvoiceRepository + BillingTenantPort di atas Prisma (E1 Midtrans).
//
// findPending = baca LINTAS-tenant (poller sistem, bukan jalur permintaan tenant) →
// memakai delegate findMany TANPA tenantId akan ditolak tenant-guard; karena itu
// di-inject $queryRawUnsafe (pola dashboard admin/T-082 — satu-satunya jenis pintu
// lintas-tenant, hanya untuk proses sistem).

import type { Invoice as PrismaInvoice } from '@prisma/client';
import { err, ok } from '@digimaestro/shared';
import type {
  BillingTenantPort,
  InvoiceEntity,
  InvoiceRepository,
  PaymentStatus,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';

export interface InvoiceDelegate {
  create(args: {
    data: {
      tenantId: string; provider: string; orderId: string; amountIdr: number;
      periodDays: number; paymentUrl: string;
    };
  }): Promise<PrismaInvoice>;
  findFirst(args: {
    where: { tenantId: string; status: string };
    orderBy: { createdAt: 'desc' };
  }): Promise<PrismaInvoice | null>;
  update(args: {
    where: { id: string };
    data: { status: string; paidAt?: Date | null };
  }): Promise<PrismaInvoice>;
}

export interface RawQuery {
  $queryRawUnsafe<T>(q: string, ...v: unknown[]): Promise<T>;
}

function toEntity(row: PrismaInvoice): InvoiceEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider,
    orderId: row.orderId,
    amountIdr: row.amountIdr,
    periodDays: row.periodDays,
    paymentUrl: row.paymentUrl,
    status: row.status,
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class InvoiceRepositoryPrisma implements InvoiceRepository {
  readonly name = 'InvoiceRepository' as const;

  constructor(
    private readonly delegate: InvoiceDelegate,
    private readonly raw: RawQuery,
  ) {}

  async create(
    tenantId: TenantId,
    input: { provider: string; orderId: string; amountIdr: number; periodDays: number; paymentUrl: string },
  ): Promise<Result<InvoiceEntity, RepositoryError>> {
    try {
      const row = await this.delegate.create({ data: { tenantId, ...input } });
      return ok(toEntity(row));
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async findOpenByTenant(tenantId: TenantId): Promise<Result<InvoiceEntity | null, RepositoryError>> {
    try {
      const row = await this.delegate.findFirst({
        where: { tenantId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      return ok(row ? toEntity(row) : null);
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async findPending(limit: number): Promise<Result<readonly InvoiceEntity[], RepositoryError>> {
    try {
      const rows = await this.raw.$queryRawUnsafe<PrismaInvoice[]>(
        `SELECT * FROM "Invoice" WHERE "status" = 'PENDING' ORDER BY "createdAt" ASC LIMIT $1`,
        Math.max(1, Math.min(limit, 100)),
      );
      return ok(rows.map(toEntity));
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async markStatus(id: string, status: PaymentStatus, paidAt?: string): Promise<Result<void, RepositoryError>> {
    try {
      await this.delegate.update({
        where: { id },
        data: { status, ...(paidAt ? { paidAt: new Date(paidAt) } : {}) },
      });
      return ok(undefined);
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }
}

export interface BillingTenantDelegate {
  findUnique(args: {
    where: { id: string };
    select: { status: true; serviceEndsAt: true };
  }): Promise<{ status: string; serviceEndsAt: Date | null } | null>;
  update(args: {
    where: { id: string };
    data: { status: 'ACTIVE'; serviceEndsAt: Date } | { status: 'SUSPENDED' };
  }): Promise<unknown>;
}

export class BillingTenantPrisma implements BillingTenantPort {
  readonly name = 'BillingTenant' as const;

  constructor(private readonly delegate: BillingTenantDelegate) {}

  async getService(
    tenantId: TenantId,
  ): Promise<Result<{ status: string; serviceEndsAt: string | null }, RepositoryError>> {
    try {
      const row = await this.delegate.findUnique({
        where: { id: tenantId },
        select: { status: true, serviceEndsAt: true },
      });
      if (!row) return err({ code: 'NOT_FOUND', message: `tenant ${tenantId} tidak ditemukan` });
      return ok({ status: row.status, serviceEndsAt: row.serviceEndsAt?.toISOString() ?? null });
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async activate(tenantId: TenantId, serviceEndsAt: string): Promise<Result<void, RepositoryError>> {
    try {
      await this.delegate.update({
        where: { id: tenantId },
        data: { status: 'ACTIVE', serviceEndsAt: new Date(serviceEndsAt) },
      });
      return ok(undefined);
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async hold(tenantId: TenantId): Promise<Result<void, RepositoryError>> {
    try {
      await this.delegate.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
      return ok(undefined);
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }
}
