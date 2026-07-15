// Konsol admin via chat (PO 2026-07-15) — adapter Prisma untuk AdminDirectoryPort
// (direktori tenant LINTAS-tenant; hanya dipakai di balik gerbang chat_id admin) dan
// ActingStorePort (pemetaan chat admin → tenant yang sedang "diperankan").

import { err, ok } from '@digimaestro/shared';
import type {
  ActingStorePort,
  AdminConsoleError,
  AdminCustomerSummary,
  AdminDirectoryPort,
  Result,
} from '@digimaestro/shared';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  websites?: { slug: string; status: string }[];
}

export interface AdminConsoleClient {
  readonly tenant: {
    findMany(args: {
      orderBy: { createdAt: 'asc' };
      include: { websites: { select: { slug: true; status: true } } };
    }): Promise<TenantRow[]>;
    findUnique(args: {
      where: { slug: string };
      include: { websites: { select: { slug: true; status: true } } };
    }): Promise<TenantRow | null>;
    create(args: {
      data: {
        name: string;
        slug: string;
        status: string;
        waNumbers: string[];
        quotaMessages: number;
        quotaWebsites: number;
        trialEndsAt: Date;
      };
    }): Promise<TenantRow>;
  };
  readonly adminActing: {
    findUnique(args: { where: { chatId: string } }): Promise<{ tenantId: string } | null>;
    upsert(args: {
      where: { chatId: string };
      update: { tenantId: string };
      create: { chatId: string; tenantId: string };
    }): Promise<unknown>;
    deleteMany(args: { where: { chatId: string } }): Promise<unknown>;
  };
}

function toSummary(row: TenantRow): AdminCustomerSummary {
  const site = row.websites?.[0];
  return {
    tenantId: row.id,
    name: row.name,
    slug: row.slug,
    websiteSlug: site?.slug ?? null,
    websiteStatus: site?.status ?? null,
  };
}

function toError(e: unknown): AdminConsoleError {
  if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') {
    return { code: 'CONFLICT', message: 'slug sudah terpakai — coba nama lain.' };
  }
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
}

// Kuota trial konsumen buatan admin — sama dgn self-serve (keputusan PO 2026-07-12).
const TRIAL = { messages: 100, websites: 1, days: 14 } as const;

export class AdminDirectoryPrisma implements AdminDirectoryPort {
  readonly name = 'AdminDirectory' as const;

  // slugify di-inject (deriveSlug dari core) — adapters tak boleh import core (AGENTS §3).
  constructor(
    private readonly db: AdminConsoleClient,
    private readonly slugify: (name: string) => string,
  ) {}

  async list(): Promise<Result<readonly AdminCustomerSummary[], AdminConsoleError>> {
    try {
      const rows = await this.db.tenant.findMany({
        orderBy: { createdAt: 'asc' },
        include: { websites: { select: { slug: true, status: true } } },
      });
      return ok(rows.map(toSummary));
    } catch (e) {
      return err(toError(e));
    }
  }

  async findBySlug(slug: string): Promise<Result<AdminCustomerSummary | null, AdminConsoleError>> {
    try {
      const row = await this.db.tenant.findUnique({
        where: { slug },
        include: { websites: { select: { slug: true, status: true } } },
      });
      return ok(row ? toSummary(row) : null);
    } catch (e) {
      return err(toError(e));
    }
  }

  async create(name: string): Promise<Result<AdminCustomerSummary, AdminConsoleError>> {
    try {
      const row = await this.db.tenant.create({
        data: {
          name,
          slug: this.slugify(name),
          status: 'TRIALING',
          waNumbers: [],
          quotaMessages: TRIAL.messages,
          quotaWebsites: TRIAL.websites,
          trialEndsAt: new Date(Date.now() + TRIAL.days * 864e5),
        },
      });
      return ok(toSummary(row));
    } catch (e) {
      return err(toError(e));
    }
  }
}

export class ActingStorePrisma implements ActingStorePort {
  readonly name = 'ActingStore' as const;

  constructor(private readonly db: AdminConsoleClient) {}

  async get(chatId: string): Promise<string | null> {
    try {
      const row = await this.db.adminActing.findUnique({ where: { chatId } });
      return row?.tenantId ?? null;
    } catch {
      return null; // fail-soft: gagal baca = tanpa acting (jatuh ke tenant admin sendiri)
    }
  }

  async set(chatId: string, tenantId: string): Promise<void> {
    await this.db.adminActing.upsert({
      where: { chatId },
      update: { tenantId },
      create: { chatId, tenantId },
    });
  }

  async clear(chatId: string): Promise<void> {
    await this.db.adminActing.deleteMany({ where: { chatId } });
  }
}
