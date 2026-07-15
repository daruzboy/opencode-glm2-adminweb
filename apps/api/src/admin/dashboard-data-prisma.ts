// Implementasi DashboardDataPort di atas Prisma + Redis + os (dashboard admin).
//
// Baca LINTAS-tenant memakai $queryRawUnsafe (melewati tenant-guard — SATU-SATUNYA
// pintu lintas-tenant selain laporan T-082, dan dua-duanya di balik gerbang admin).
// Tulis selalu menyertakan tenantId/id eksplisit.

import { loadavg, totalmem, freemem, cpus, uptime } from 'node:os';
import { statfs } from 'node:fs/promises';
import { buildUsageReport, previewSlug, type UsageReportDeps } from '@digimaestro/core';
import { publicSiteUrl, type PublishUrlMode } from '@digimaestro/shared';
import type { RuntimeLlmConfig } from '@digimaestro/adapters';
import type {
  DashboardCustomer,
  DashboardDataPort,
  DashboardFeedback,
  DashboardProfile,
  DashboardSystem,
  DashboardTicket,
} from './dashboard-routes.js';

export interface RawDb {
  $queryRawUnsafe<T>(q: string, ...v: unknown[]): Promise<T>;
  $executeRawUnsafe(q: string, ...v: unknown[]): Promise<unknown>;
}

export interface QueueCounter {
  (name: string): Promise<{ waiting: number; active: number; failed: number }>;
}

export interface DashboardDataOptions {
  readonly db: RawDb;
  readonly usageDeps: UsageReportDeps;
  readonly queueCounts?: QueueCounter;
  readonly model: string;
  readonly pricePer1M: { input: number; output: number };
  // Path utk ukuran disk (root container ≈ disk VPS pada setup satu-disk ini).
  readonly diskPath?: string;
  // Tautan situs konsumen di kolom Situs (URL sama dengan yang dijanjikan pipeline publish).
  readonly site?: {
    readonly rootDomain: string;
    readonly urlMode: PublishUrlMode;
    readonly previewToken?: (websiteId: string) => string;
  };
  // Override runtime (dashboard Pengaturan): model & harga efektif utk laporan biaya/sistem.
  readonly runtimeConfig?: () => RuntimeLlmConfig;
}

export function createDashboardData(opts: DashboardDataOptions): DashboardDataPort {
  const { db } = opts;

  const siteUrls = (
    websiteId: string | null,
    websiteSlug: string | null,
    websiteStatus: string | null,
  ): { liveUrl: string | null; previewUrl: string | null } => {
    if (!opts.site || !websiteId || !websiteSlug) return { liveUrl: null, previewUrl: null };
    const { rootDomain, urlMode, previewToken } = opts.site;
    return {
      liveUrl: websiteStatus === 'PUBLISHED' ? publicSiteUrl(websiteSlug, rootDomain, urlMode) : null,
      // Pratinjau selalu path-mode (sama dengan requestPreview).
      previewUrl: publicSiteUrl(previewSlug(websiteSlug, websiteId, previewToken), rootDomain, 'path'),
    };
  };

  return {
    async customers(): Promise<readonly DashboardCustomer[]> {
      const rows = await db.$queryRawUnsafe<
        {
          id: string; name: string; slug: string; status: string; trialEndsAt: Date | null;
          usedMessages: number; quotaMessages: number; adminNote: string | null;
          websiteId: string | null; websiteSlug: string | null;
          websiteStatus: string | null; lastInboundAt: Date | null; openTickets: bigint;
          unresolvedFeedback: bigint;
        }[]
      >(
        `SELECT t."id", t."name", t."slug", t."status"::text AS "status", t."trialEndsAt",
                t."usedMessages", t."quotaMessages", t."adminNote",
                w."id"    AS "websiteId",
                w."slug"  AS "websiteSlug",
                w."status"::text AS "websiteStatus",
                (SELECT MAX(m."createdAt") FROM "Message" m
                  WHERE m."tenantId" = t."id" AND m."direction" = 'IN') AS "lastInboundAt",
                (SELECT COUNT(*) FROM "Ticket" k
                  WHERE k."tenantId" = t."id" AND k."status" <> 'DONE') AS "openTickets",
                (SELECT COUNT(*) FROM "Feedback" f
                  WHERE f."tenantId" = t."id" AND f."resolvedAt" IS NULL) AS "unresolvedFeedback"
           FROM "Tenant" t
           LEFT JOIN "Website" w ON w."tenantId" = t."id"
          ORDER BY t."createdAt" ASC`,
      );
      return rows.map((r) => ({
        tenantId: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
        usedMessages: Number(r.usedMessages),
        quotaMessages: Number(r.quotaMessages),
        websiteSlug: r.websiteSlug,
        websiteStatus: r.websiteStatus,
        ...siteUrls(r.websiteId, r.websiteSlug, r.websiteStatus),
        adminNote: r.adminNote,
        lastInboundAt: r.lastInboundAt?.toISOString() ?? null,
        openTickets: Number(r.openTickets),
        unresolvedFeedback: Number(r.unresolvedFeedback),
      }));
    },

    async profile(tenantId): Promise<DashboardProfile | null> {
      const rows = await db.$queryRawUnsafe<
        { customerName: string | null; brief: unknown; notes: string[]; updatedAt: Date }[]
      >(
        `SELECT p."customerName", p."brief", p."notes", p."updatedAt"
           FROM "TenantProfile" p WHERE p."tenantId" = $1`,
        tenantId,
      );
      const r = rows[0];
      if (!r) return null;
      return {
        customerName: r.customerName,
        brief: r.brief,
        notes: r.notes ?? [],
        updatedAt: r.updatedAt?.toISOString() ?? null,
      };
    },

    async setNote(tenantId, note) {
      await db.$executeRawUnsafe(
        `UPDATE "Tenant" SET "adminNote" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
        tenantId,
        note,
      );
    },

    async extendTrial(tenantId, days) {
      // Basis perpanjangan = trialEndsAt yang belum lewat, atau SEKARANG bila sudah lewat.
      await db.$executeRawUnsafe(
        `UPDATE "Tenant"
            SET "trialEndsAt" = GREATEST(COALESCE("trialEndsAt", NOW()), NOW()) + ($2 || ' days')::interval,
                "updatedAt" = NOW()
          WHERE "id" = $1`,
        tenantId,
        String(days),
      );
    },

    async setStatus(tenantId, status) {
      await db.$executeRawUnsafe(
        `UPDATE "Tenant" SET "status" = $2::"TenantStatus", "updatedAt" = NOW() WHERE "id" = $1`,
        tenantId,
        status,
      );
    },

    async addQuotaMessages(tenantId, amount) {
      await db.$executeRawUnsafe(
        `UPDATE "Tenant" SET "quotaMessages" = "quotaMessages" + $2, "updatedAt" = NOW() WHERE "id" = $1`,
        tenantId,
        amount,
      );
    },

    async tickets(): Promise<readonly DashboardTicket[]> {
      // Urutan: yang paling LAMA duluan (permintaan PO) — pemisahan "prioritas dulu"
      // dilakukan UI dari kolom priority.
      const rows = await db.$queryRawUnsafe<
        {
          id: string; tenantName: string; subject: string; body: string | null;
          topic: string | null; priority: string; status: string; createdAt: Date;
        }[]
      >(
        `SELECT k."id", t."name" AS "tenantName", k."subject", k."body", k."topic",
                k."priority", k."status", k."createdAt"
           FROM "Ticket" k JOIN "Tenant" t ON t."id" = k."tenantId"
          ORDER BY k."createdAt" ASC LIMIT 300`,
      );
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    },

    async createTicket(tenantId, input) {
      await db.$executeRawUnsafe(
        `INSERT INTO "Ticket" ("id", "tenantId", "subject", "body", "topic", "priority", "updatedAt")
         VALUES ('tkt' || md5(random()::text || clock_timestamp()::text), $1, $2, $3, $4, $5, NOW())`,
        tenantId,
        input.subject,
        input.body ?? null,
        input.topic ?? null,
        input.priority ?? 'normal',
      );
    },

    async setTicketStatus(id, status) {
      await db.$executeRawUnsafe(
        `UPDATE "Ticket" SET "status" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
        id,
        status,
      );
    },

    async setTicketPriority(id, priority) {
      await db.$executeRawUnsafe(
        `UPDATE "Ticket" SET "priority" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
        id,
        priority,
      );
    },

    async feedback(): Promise<readonly DashboardFeedback[]> {
      const rows = await db.$queryRawUnsafe<
        { id: string; tenantName: string; kind: string; text: string; resolvedAt: Date | null; createdAt: Date }[]
      >(
        `SELECT f."id", t."name" AS "tenantName", f."kind", f."text", f."resolvedAt", f."createdAt"
           FROM "Feedback" f JOIN "Tenant" t ON t."id" = f."tenantId"
          ORDER BY (f."resolvedAt" IS NOT NULL) ASC, f."createdAt" DESC LIMIT 200`,
      );
      return rows.map((r) => ({
        ...r,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
    },

    async resolveFeedback(id) {
      await db.$executeRawUnsafe(`UPDATE "Feedback" SET "resolvedAt" = NOW() WHERE "id" = $1`, id);
    },

    async usage(since, until) {
      // Harga efektif = override runtime (dashboard Pengaturan) > env.
      const rc = opts.runtimeConfig?.() ?? {};
      const price =
        rc.priceInputPer1M !== undefined && rc.priceOutputPer1M !== undefined
          ? { inputPer1M: rc.priceInputPer1M, outputPer1M: rc.priceOutputPer1M }
          : opts.usageDeps.price;
      const report = await buildUsageReport({ ...opts.usageDeps, price }, {
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
      });
      if (!report.ok) throw new Error(report.error.message);
      return report.value;
    },

    async system(): Promise<DashboardSystem> {
      // /proc di kontainer menampilkan load & memori HOST (VPS) — cukup utk laporan kasar.
      const fs = await statfs(opts.diskPath ?? '/').catch(() => null);
      const blk = fs ? fs.bsize : 0;
      const queues: DashboardSystem['queues'] = {};
      if (opts.queueCounts) {
        for (const name of ['chat-inbound', 'publish']) {
          queues[name] = await opts.queueCounts(name).catch(() => ({ waiting: -1, active: -1, failed: -1 }));
        }
      }
      const rc = opts.runtimeConfig?.() ?? {};
      return {
        load1: Math.round(loadavg()[0]! * 100) / 100,
        cpuCount: cpus().length,
        memUsedMb: Math.round((totalmem() - freemem()) / 1048576),
        memTotalMb: Math.round(totalmem() / 1048576),
        diskUsedGb: fs ? Math.round(((fs.blocks - fs.bfree) * blk) / 1073741824) : -1,
        diskTotalGb: fs ? Math.round((fs.blocks * blk) / 1073741824) : -1,
        queues,
        model: rc.model ?? opts.model,
        pricePer1M:
          rc.priceInputPer1M !== undefined && rc.priceOutputPer1M !== undefined
            ? { input: rc.priceInputPer1M, output: rc.priceOutputPer1M }
            : opts.pricePer1M,
        uptimeHours: Math.round((uptime() / 3600) * 10) / 10,
      };
    },
  };
}
