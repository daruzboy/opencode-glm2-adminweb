// Dashboard admin (PO 2026-07-15): kelola konsumen dari browser — profil/kuota,
// billing-lite (perpanjang trial / ubah status), tiketing sederhana, keluhan & saran,
// tinjauan token+model (T-082), dan kinerja VPS.
//
// Akses: halaman /admin di API (VPS = jaringan tailnet PO, seperti editor-web) dengan
// token statis ADMIN_DASHBOARD_TOKEN (header x-admin-token, timing-safe). Tanpa env →
// SELURUH rute tak dipasang (fail-closed). Data lintas-tenant hanya lewat sini.

import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// ── Port data (di-inject dari composition; test memakai fake) ────────────────

export interface DashboardCustomer {
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly trialEndsAt: string | null;
  readonly usedMessages: number;
  readonly quotaMessages: number;
  readonly websiteSlug: string | null;
  readonly websiteStatus: string | null;
  readonly lastInboundAt: string | null;
  readonly openTickets: number;
  readonly unresolvedFeedback: number;
}

export interface DashboardTicket {
  readonly id: string;
  readonly tenantName: string;
  readonly subject: string;
  readonly body: string | null;
  readonly status: string;
  readonly createdAt: string;
}

export interface DashboardFeedback {
  readonly id: string;
  readonly tenantName: string;
  readonly kind: string;
  readonly text: string;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface DashboardSystem {
  readonly load1: number;
  readonly cpuCount: number;
  readonly memUsedMb: number;
  readonly memTotalMb: number;
  readonly diskUsedGb: number;
  readonly diskTotalGb: number;
  readonly queues: Record<string, { waiting: number; active: number; failed: number }>;
  readonly model: string;
  readonly pricePer1M: { input: number; output: number };
  readonly uptimeHours: number;
}

export interface DashboardDataPort {
  customers(): Promise<readonly DashboardCustomer[]>;
  extendTrial(tenantId: string, days: number): Promise<void>;
  setStatus(tenantId: string, status: string): Promise<void>;
  addQuotaMessages(tenantId: string, amount: number): Promise<void>;
  tickets(): Promise<readonly DashboardTicket[]>;
  createTicket(tenantId: string, subject: string, body?: string): Promise<void>;
  setTicketStatus(id: string, status: string): Promise<void>;
  feedback(): Promise<readonly DashboardFeedback[]>;
  resolveFeedback(id: string): Promise<void>;
  // Laporan token+biaya (T-082, lintas tenant) — bentuk longgar, langsung diteruskan.
  usage(since?: string, until?: string): Promise<unknown>;
  system(): Promise<DashboardSystem>;
}

export interface DashboardDeps {
  readonly token: string;
  readonly data: DashboardDataPort;
  // Halaman HTML dashboard (string, self-contained).
  readonly page: string;
}

const TENANT_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED', 'ARCHIVED'];
const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'];

function tokenMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerDashboardRoutes(app: FastifyInstance, deps: DashboardDeps): void {
  // Halaman: publik-baca TIDAK — halaman sendiri tanpa data; data butuh token.
  app.get('/admin', async (_req, reply) => reply.type('text/html; charset=utf-8').send(deps.page));

  const guard = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (tokenMatches(req.headers['x-admin-token'], deps.token)) return true;
    void reply.code(401).send({ error: 'token admin salah' });
    return false;
  };

  // Satu handler pembungkus: guard + error 500 seragam (data port melempar → pesan).
  const route = <T>(fn: (req: FastifyRequest) => Promise<T>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!guard(req, reply)) return;
      try {
        return await fn(req);
      } catch (e) {
        return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) });
      }
    };

  app.get('/api/admin/dashboard/customers', route(async () => ({ customers: await deps.data.customers() })));

  app.post(
    '/api/admin/dashboard/customers/:tenantId/trial',
    route(async (req) => {
      const { tenantId } = req.params as { tenantId: string };
      const days = Number((req.body as { days?: unknown })?.days);
      if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('days harus 1..365');
      await deps.data.extendTrial(tenantId, days);
      return { ok: true };
    }),
  );

  app.post(
    '/api/admin/dashboard/customers/:tenantId/status',
    route(async (req) => {
      const { tenantId } = req.params as { tenantId: string };
      const status = String((req.body as { status?: unknown })?.status ?? '');
      if (!TENANT_STATUSES.includes(status)) throw new Error(`status harus salah satu: ${TENANT_STATUSES.join(', ')}`);
      await deps.data.setStatus(tenantId, status);
      return { ok: true };
    }),
  );

  app.post(
    '/api/admin/dashboard/customers/:tenantId/quota',
    route(async (req) => {
      const { tenantId } = req.params as { tenantId: string };
      const amount = Number((req.body as { amount?: unknown })?.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > 10_000) throw new Error('amount harus 1..10000');
      await deps.data.addQuotaMessages(tenantId, amount);
      return { ok: true };
    }),
  );

  app.get('/api/admin/dashboard/tickets', route(async () => ({ tickets: await deps.data.tickets() })));

  app.post(
    '/api/admin/dashboard/tickets',
    route(async (req) => {
      const b = (req.body ?? {}) as { tenantId?: unknown; subject?: unknown; body?: unknown };
      if (typeof b.tenantId !== 'string' || typeof b.subject !== 'string' || !b.subject.trim()) {
        throw new Error('tenantId dan subject wajib');
      }
      await deps.data.createTicket(b.tenantId, b.subject.trim(), typeof b.body === 'string' ? b.body : undefined);
      return { ok: true };
    }),
  );

  app.post(
    '/api/admin/dashboard/tickets/:id/status',
    route(async (req) => {
      const { id } = req.params as { id: string };
      const status = String((req.body as { status?: unknown })?.status ?? '');
      if (!TICKET_STATUSES.includes(status)) throw new Error(`status harus salah satu: ${TICKET_STATUSES.join(', ')}`);
      await deps.data.setTicketStatus(id, status);
      return { ok: true };
    }),
  );

  app.get('/api/admin/dashboard/feedback', route(async () => ({ feedback: await deps.data.feedback() })));

  app.post(
    '/api/admin/dashboard/feedback/:id/resolve',
    route(async (req) => {
      const { id } = req.params as { id: string };
      await deps.data.resolveFeedback(id);
      return { ok: true };
    }),
  );

  app.get(
    '/api/admin/dashboard/usage',
    route(async (req) => {
      const q = req.query as { since?: string; until?: string };
      return deps.data.usage(q.since, q.until);
    }),
  );

  app.get('/api/admin/dashboard/system', route(async () => deps.data.system()));
}
