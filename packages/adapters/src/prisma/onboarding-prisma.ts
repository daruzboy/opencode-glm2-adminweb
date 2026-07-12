// Self-serve onboarding + kuota di atas Prisma (langkah #6).
//
// Dua operasi di sini WAJIB atomik, dan keduanya adalah tempat bug konkurensi biasanya
// bersembunyi:
//   1. Menukarkan kode undangan — cek-lalu-tulis membuat dua pendaftar bersamaan bisa
//      menembus `maxUses`.
//   2. Mengonsumsi kuota — cek-lalu-tulis membuat tenant bisa melewati kuota saat dua pesan
//      diproses paralel (worker concurrency = 2).
// Keduanya memakai UPDATE bersyarat (WHERE ... AND used < max) → DB yang menjadi wasit,
// bukan kode kita.

import { err, ok } from '@digimaestro/shared';
import type {
  ChannelBindingPort,
  ConversationChannel,
  InviteCodeEntity,
  InviteCodePort,
  InviteError,
  QuotaDecision,
  QuotaPort,
  RepositoryError,
  Result,
  TenantId,
  TenantProvisionInput,
  TenantProvisionPort,
} from '@digimaestro/shared';

// Klien Prisma yang dipakai — sengaja TANPA tenantGuard: operasi di sini justru BELUM punya
// tenant (pendaftaran), atau mengubah baris Tenant itu sendiri.
export interface OnboardingClient {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
  channelBinding: {
    findUnique(args: {
      where: { channel_externalId: { channel: string; externalId: string } };
    }): Promise<{ tenantId: string } | null>;
    create(args: {
      data: { tenantId: string; channel: string; externalId: string };
    }): Promise<unknown>;
  };
  tenant: {
    create(args: {
      data: {
        name: string;
        slug: string;
        status: string;
        waNumbers: string[];
        inviteCodeId: string;
        quotaMessages: number;
        quotaWebsites: number;
        trialEndsAt: Date;
      };
    }): Promise<{ id: string }>;
    findUnique(args: { where: { id: string } }): Promise<{
      status: string;
      quotaMessages: number;
      usedMessages: number;
      trialEndsAt: Date | null;
    } | null>;
  };
}

function toError(e: unknown): RepositoryError {
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
}

// ── Binding chat → tenant ────────────────────────────────────────────────────

export class ChannelBindingPrisma implements ChannelBindingPort {
  constructor(private readonly db: OnboardingClient) {}

  async resolve(
    channel: ConversationChannel,
    externalId: string,
  ): Promise<Result<TenantId | null, RepositoryError>> {
    try {
      const row = await this.db.channelBinding.findUnique({
        where: { channel_externalId: { channel, externalId } },
      });
      return ok(row ? (row.tenantId as TenantId) : null);
    } catch (e) {
      return err(toError(e));
    }
  }

  async bind(
    tenantId: TenantId,
    channel: ConversationChannel,
    externalId: string,
  ): Promise<Result<void, RepositoryError>> {
    try {
      await this.db.channelBinding.create({ data: { tenantId, channel, externalId } });
      return ok(undefined);
    } catch (e) {
      // P2002 = chat sudah terikat (race: dua pesan pertama diproses paralel). Bukan
      // kegagalan — pemilik binding-nya sudah ada.
      if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') {
        return ok(undefined);
      }
      return err(toError(e));
    }
  }
}

// ── Kode undangan (penukaran ATOMIK) ─────────────────────────────────────────

export class InviteCodePrisma implements InviteCodePort {
  constructor(private readonly db: OnboardingClient) {}

  async redeem(code: string): Promise<Result<InviteCodeEntity, InviteError>> {
    try {
      // UPDATE bersyarat: hanya berhasil bila kode aktif, belum kedaluwarsa, dan kuota
      // pakainya masih ada. Satu perintah → tak ada celah antara cek dan tulis.
      const rows = await this.db.$queryRawUnsafe<
        {
          id: string;
          code: string;
          maxUses: number;
          usedCount: number;
          expiresAt: Date | null;
          active: boolean;
        }[]
      >(
        `UPDATE "InviteCode"
            SET "usedCount" = "usedCount" + 1
          WHERE "code" = $1
            AND "active" = true
            AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
            AND ("maxUses" = 0 OR "usedCount" < "maxUses")
          RETURNING "id", "code", "maxUses", "usedCount", "expiresAt", "active"`,
        code,
      );

      if (rows.length > 0) {
        const r = rows[0] as NonNullable<(typeof rows)[0]>;
        return ok({
          id: r.id,
          code: r.code,
          maxUses: r.maxUses,
          usedCount: r.usedCount,
          expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
          active: r.active,
        });
      }

      // Gagal → cari tahu KENAPA, supaya pesan ke pengguna bisa ditindak (bukan "gagal" saja).
      const found = await this.db.$queryRawUnsafe<
        { active: boolean; expiresAt: Date | null; maxUses: number; usedCount: number }[]
      >(`SELECT "active", "expiresAt", "maxUses", "usedCount" FROM "InviteCode" WHERE "code" = $1`, code);

      const f = found[0];
      if (!f || !f.active) return err({ code: 'NOT_FOUND', message: 'kode tidak dikenali' });
      if (f.expiresAt && f.expiresAt.getTime() <= Date.now()) {
        return err({ code: 'EXPIRED', message: 'kode kedaluwarsa' });
      }
      return err({ code: 'EXHAUSTED', message: 'kode habis dipakai' });
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ── Provisioning tenant ──────────────────────────────────────────────────────

export class TenantProvisionPrisma implements TenantProvisionPort {
  constructor(private readonly db: OnboardingClient) {}

  async create(input: TenantProvisionInput): Promise<Result<TenantId, RepositoryError>> {
    try {
      const trialEndsAt = new Date(Date.now() + input.trialDays * 24 * 60 * 60 * 1000);
      const row = await this.db.tenant.create({
        data: {
          name: input.name,
          slug: input.slug,
          status: 'TRIALING',
          waNumbers: [],
          inviteCodeId: input.inviteCodeId,
          quotaMessages: input.quotaMessages,
          quotaWebsites: input.quotaWebsites,
          trialEndsAt,
        },
      });
      return ok(row.id as TenantId);
    } catch (e) {
      return err(toError(e));
    }
  }
}

// ── Kuota ────────────────────────────────────────────────────────────────────

export class QuotaPrisma implements QuotaPort {
  constructor(private readonly db: OnboardingClient) {}

  async check(tenantId: TenantId): Promise<Result<QuotaDecision, RepositoryError>> {
    try {
      const t = await this.db.tenant.findUnique({ where: { id: tenantId } });
      if (!t) return err({ code: 'NOT_FOUND', message: 'tenant tidak ditemukan' });

      if (t.status === 'SUSPENDED' || t.status === 'CANCELED' || t.status === 'ARCHIVED') {
        return ok({ allowed: false, reason: 'SUSPENDED', remaining: 0 });
      }
      if (t.trialEndsAt && t.trialEndsAt.getTime() <= Date.now()) {
        return ok({ allowed: false, reason: 'TRIAL_EXPIRED', remaining: 0 });
      }

      const sisa = t.quotaMessages - t.usedMessages;
      if (sisa <= 0) return ok({ allowed: false, reason: 'MESSAGES', remaining: 0 });

      return ok({ allowed: true, remaining: sisa });
    } catch (e) {
      return err(toError(e));
    }
  }

  async consume(tenantId: TenantId): Promise<Result<void, RepositoryError>> {
    try {
      // Increment bersyarat: DB yang menegakkan batas, bukan kode kita. Tanpa `AND used <
      // quota`, dua pesan paralel (worker concurrency 2) bisa menembus kuota.
      await this.db.$executeRawUnsafe(
        `UPDATE "Tenant"
            SET "usedMessages" = "usedMessages" + 1
          WHERE "id" = $1 AND "usedMessages" < "quotaMessages"`,
        tenantId,
      );
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }
}
