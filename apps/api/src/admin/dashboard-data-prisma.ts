// Implementasi DashboardDataPort di atas Prisma + Redis + os (dashboard admin).
//
// Baca LINTAS-tenant memakai $queryRawUnsafe (melewati tenant-guard — SATU-SATUNYA
// pintu lintas-tenant selain laporan T-082, dan dua-duanya di balik gerbang admin).
// Tulis selalu menyertakan tenantId/id eksplisit.

import { loadavg, totalmem, freemem, cpus, uptime } from 'node:os';
import { statfs } from 'node:fs/promises';
import { buildUsageReport, type UsageReportDeps } from '@digimaestro/core';
import type {
  DashboardCustomer,
  DashboardDataPort,
  DashboardFeedback,
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
}

export function createDashboardData(opts: DashboardDataOptions): DashboardDataPort {
  const { db } = opts;
  return {
    async customers(): Promise<readonly DashboardCustomer[]> {
      const rows = await db.$queryRawUnsafe<
        {
          id: string; name: string; slug: string; status: string; trialEndsAt: Date | null;
          usedMessages: number; quotaMessages: number; websiteSlug: string | null;
          websiteStatus: string | null; lastInboundAt: Date | null; openTickets: bigint;
          unresolvedFeedback: bigint;
        }[]
      >(
        `SELECT t."id", t."name", t."slug", t."status"::text AS "status", t."trialEndsAt",
                t."usedMessages", t."quotaMessages",
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
        lastInboundAt: r.lastInboundAt?.toISOString() ?? null,
        openTickets: Number(r.openTickets),
        unresolvedFeedback: Number(r.unresolvedFeedback),
      }));
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
      const rows = await db.$queryRawUnsafe<
        { id: string; tenantName: string; subject: string; body: string | null; status: string; createdAt: Date }[]
      >(
        `SELECT k."id", t."name" AS "tenantName", k."subject", k."body", k."status", k."createdAt"
           FROM "Ticket" k JOIN "Tenant" t ON t."id" = k."tenantId"
          ORDER BY (k."status" = 'DONE') ASC, k."createdAt" DESC LIMIT 200`,
      );
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    },

    async createTicket(tenantId, subject, body) {
      await db.$executeRawUnsafe(
        `INSERT INTO "Ticket" ("id", "tenantId", "subject", "body", "updatedAt")
         VALUES ('tkt' || md5(random()::text || clock_timestamp()::text), $1, $2, $3, NOW())`,
        tenantId,
        subject,
        body ?? null,
      );
    },

    async setTicketStatus(id, status) {
      await db.$executeRawUnsafe(
        `UPDATE "Ticket" SET "status" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
        id,
        status,
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
      const report = await buildUsageReport(opts.usageDeps, {
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
      return {
        load1: Math.round(loadavg()[0]! * 100) / 100,
        cpuCount: cpus().length,
        memUsedMb: Math.round((totalmem() - freemem()) / 1048576),
        memTotalMb: Math.round(totalmem() / 1048576),
        diskUsedGb: fs ? Math.round(((fs.blocks - fs.bfree) * blk) / 1073741824) : -1,
        diskTotalGb: fs ? Math.round((fs.blocks * blk) / 1073741824) : -1,
        queues,
        model: opts.model,
        pricePer1M: opts.pricePer1M,
        uptimeHours: Math.round((uptime() / 3600) * 10) / 10,
      };
    },
  };
}
