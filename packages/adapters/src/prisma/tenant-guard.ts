// Runtime tenant guard — NFR-09 (isolasi tenant). Vendor SDK (@prisma/client) hanya
// di sini (packages/adapters — SOLID-D). Dua lapis penegakan:
//   1. assertTenantScoped() — validator murni (throw TenantGuardError bila tenantId
//      hilang pada model ter-scope). Diuji langsung tanpa DB.
//   2. tenantGuardExtension() — Prisma $extends; mencegah pemakaian raw prisma tanpa
//      tenantId. Aplikasikan via prisma.$extends(tenantGuardExtension()) di composition
//      root (apps/*, EPIC-03+).
// Lapis compile-time: signature Port repository memaksa tenantId (shared/ports).

import { Prisma } from '@prisma/client';

// Model domain yang WAJIB scoped tenantId (lihat schema.prisma T-020).
// Tenant sendiri tak punya tenantId; Revision ter-scope via Website (tidak langsung).
export const TENANT_SCOPED_MODELS = [
  'User',
  'Conversation',
  'Message',
  'Website',
  'AgentJob',
  'LlmUsage',
  'AuditLog',
  // Audit 2026-07-16: model pasca-T-020 yang sempat LOLOS guard — ber-tenantId di schema
  // dan semua jalur bacanya memang tenant-scoped, jadi masuk tingkat penuh (where + data).
  'TenantProfile',
  'Ticket',
  'Feedback',
  'MediaAsset',
] as const;
export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

// Tingkat kedua (audit 2026-07-16): ber-tenantId di schema, WAJIB tenantId saat MENULIS
// baris baru, tapi DIBACA/di-update lewat identitas non-tenant BY DESIGN — mewajibkan
// tenantId di `where` justru mematahkan use case-nya:
//   - Invoice: poller billing membaca semua PENDING lintas-tenant & menandai status by id.
//   - ChannelBinding: resolusi tenant DARI (channel, externalId) — tenant belum diketahui.
//   - AdminActing: state konsol admin ber-kunci chatId admin; tenantId adalah NILAI target.
export const TENANT_WRITE_SCOPED_MODELS = ['Invoice', 'ChannelBinding', 'AdminActing'] as const;
export type TenantWriteScopedModel = (typeof TENANT_WRITE_SCOPED_MODELS)[number];

export class TenantGuardError extends Error {
  readonly code = 'TENANT_GUARD_VIOLATION' as const;
  constructor(
    public readonly model: string,
    public readonly operation: string,
    message: string,
  ) {
    super(message);
    this.name = 'TenantGuardError';
  }
}

// Operasi yang membaca/menulis lewat `where` (perlu tenantId di where).
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findFirst',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

// Operasi yang menulis lewat `data` (perlu tenantId di data).
const DATA_OPERATIONS = new Set(['create', 'createMany', 'upsert']);

export function isTenantScopedModel(model: string): model is TenantScopedModel {
  return (TENANT_SCOPED_MODELS as readonly string[]).includes(model);
}

export function isTenantWriteScopedModel(model: string): model is TenantWriteScopedModel {
  return (TENANT_WRITE_SCOPED_MODELS as readonly string[]).includes(model);
}

function rowHasTenantId(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false;
  const v = (row as Record<string, unknown>).tenantId;
  return v !== undefined && v !== null;
}

function hasTenantIdInData(data: unknown): boolean {
  if (data == null) return false;
  if (Array.isArray(data)) return data.length > 0 && data.every((row) => rowHasTenantId(row));
  return rowHasTenantId(data);
}

// Validator murni — no DB, no side-effect. Throw TenantGuardError bila tenantId
// hilang pada model ter-scope. `args` diterima sebagai unknown agar call-site
// (Prisma $extends maupun test) bebas dari cast rumit.
export function assertTenantScoped(model: string, operation: string, args: unknown): void {
  const fullyScoped = isTenantScopedModel(model);
  if (!fullyScoped && !isTenantWriteScopedModel(model)) return;

  const record = (args ?? {}) as Record<string, unknown>;

  if (fullyScoped && WHERE_OPERATIONS.has(operation)) {
    const where = (record.where ?? {}) as Record<string, unknown>;
    if (where.tenantId === undefined || where.tenantId === null) {
      throw new TenantGuardError(
        model,
        operation,
        `NFR-09: ${model}.${operation} memerlukan tenantId di \`where\` (tidak boleh kosong).`,
      );
    }
  }

  if (DATA_OPERATIONS.has(operation)) {
    // upsert menulis baris BARU lewat `create` (args-nya { where, update, create }) —
    // memeriksa `data` di sana selalu gagal walau tenantId lengkap.
    const data = operation === 'upsert' ? record.create : record.data;
    if (!hasTenantIdInData(data)) {
      throw new TenantGuardError(
        model,
        operation,
        `NFR-09: ${model}.${operation} memerlukan tenantId di \`${operation === 'upsert' ? 'create' : 'data'}\` (tidak boleh kosong).`,
      );
    }
  }
}

// Wrapper operasi — primitif yang dipakai $extends interceptor & diuji tanpa DB:
// bila validator throw, `next` (query ke DB) tak pernah dipanggil.
export async function guardOperation<T>(
  model: string,
  operation: string,
  args: unknown,
  next: () => Promise<T>,
): Promise<T> {
  assertTenantScoped(model, operation, args);
  return next();
}

// Prisma extension — intercept SEMUA operasi (top-level $allOperations), validasi
// tiap model ter-scope. Args divalidasi sebelum `query(args)` (DB) dipanggil.
export const tenantGuardExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: 'tenant-guard',
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (!model) return query(args);
        return guardOperation(model, operation, args, () => query(args));
      },
    },
  }),
);
