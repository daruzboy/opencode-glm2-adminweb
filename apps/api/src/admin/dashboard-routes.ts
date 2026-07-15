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
  // E1 billing: layanan berbayar aktif s.d. tanggal ini (null = belum pernah bayar).
  readonly serviceEndsAt: string | null;
  readonly usedMessages: number;
  readonly quotaMessages: number;
  readonly websiteSlug: string | null;
  readonly websiteStatus: string | null;
  // Tautan situs konsumen: live (hanya bila PUBLISHED) dan pratinjau publik (folder
  // deterministik — bisa 404 bila belum pernah ada pratinjau terunggah).
  readonly liveUrl: string | null;
  readonly previewUrl: string | null;
  // Catatan bebas admin (Tenant.adminNote).
  readonly adminNote: string | null;
  readonly lastInboundAt: string | null;
  readonly openTickets: number;
  readonly unresolvedFeedback: number;
}

// Memori/konteks per konsumen (TenantProfile — diisi bot: nama pelanggan, brief build
// terakhir, catatan preferensi).
export interface DashboardProfile {
  readonly customerName: string | null;
  readonly brief: unknown;
  readonly notes: readonly string[];
  readonly updatedAt: string | null;
}

export interface DashboardTicket {
  readonly id: string;
  readonly tenantName: string;
  readonly subject: string;
  readonly body: string | null;
  // Topik (konten|tampilan|ganti-tema|fitur|akun|gangguan|teknis) + prioritas
  // (normal|tinggi) — diisi bot via create_ticket atau admin.
  readonly topic: string | null;
  readonly priority: string;
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
  profile(tenantId: string): Promise<DashboardProfile | null>;
  setNote(tenantId: string, note: string | null): Promise<void>;
  extendTrial(tenantId: string, days: number): Promise<void>;
  setStatus(tenantId: string, status: string): Promise<void>;
  addQuotaMessages(tenantId: string, amount: number): Promise<void>;
  tickets(): Promise<readonly DashboardTicket[]>;
  createTicket(
    tenantId: string,
    input: { subject: string; body?: string; topic?: string; priority?: string },
  ): Promise<void>;
  setTicketStatus(id: string, status: string): Promise<void>;
  setTicketPriority(id: string, priority: string): Promise<void>;
  feedback(): Promise<readonly DashboardFeedback[]>;
  resolveFeedback(id: string): Promise<void>;
  // Laporan token+biaya (T-082, lintas tenant) — bentuk longgar, langsung diteruskan.
  usage(since?: string, until?: string): Promise<unknown>;
  system(): Promise<DashboardSystem>;
}

// SOP yang diikuti bot (dua berkas: konsumen & admin) — dilihat + disunting dari dashboard.
export interface DashboardSopDoc {
  readonly which: 'konsumen' | 'admin';
  readonly title: string;
  readonly path: string;
  readonly text: string;
}

export interface DashboardSopPort {
  list(): Promise<readonly DashboardSopDoc[]>;
  save(which: 'konsumen' | 'admin', text: string): Promise<void>;
}

// Pengaturan LLM runtime (model/API key/harga) — override di atas env, berlaku tanpa restart.
export interface DashboardSettingsView {
  readonly model: string;
  readonly modelOverridden: boolean;
  // API key tak pernah dikirim penuh — hanya bentuk tersamar utk konfirmasi visual.
  readonly apiKeyMasked: string | null;
  readonly apiKeyOverridden: boolean;
  readonly priceInputPer1M: number;
  readonly priceOutputPer1M: number;
  readonly priceOverridden: boolean;
}

export interface DashboardSettingsPatch {
  readonly model?: string;
  readonly apiKey?: string;
  readonly priceInputPer1M?: number | string;
  readonly priceOutputPer1M?: number | string;
}

export interface DashboardSettingsPort {
  get(): Promise<DashboardSettingsView>;
  save(patch: DashboardSettingsPatch): Promise<DashboardSettingsView>;
}

export interface DashboardDeps {
  readonly token: string;
  readonly data: DashboardDataPort;
  // Halaman HTML dashboard (string, self-contained).
  readonly page: string;
  // Opsional (fail-soft): tanpa konfigurasi, endpoint terkait menjawab error yang jelas.
  readonly sop?: DashboardSopPort;
  readonly settings?: DashboardSettingsPort;
}

const TENANT_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED', 'ARCHIVED'];
const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'];
const TICKET_TOPICS = ['konten', 'tampilan', 'ganti-tema', 'fitur', 'akun', 'gangguan', 'teknis'];
const TICKET_PRIORITIES = ['normal', 'tinggi'];

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

  // Memori/konteks konsumen (TenantProfile) — tautan "Memori" di tabel konsumen.
  app.get(
    '/api/admin/dashboard/customers/:tenantId/profile',
    route(async (req) => {
      const { tenantId } = req.params as { tenantId: string };
      return { profile: await deps.data.profile(tenantId) };
    }),
  );

  // Catatan bebas admin per konsumen. Kosong = hapus.
  app.post(
    '/api/admin/dashboard/customers/:tenantId/note',
    route(async (req) => {
      const { tenantId } = req.params as { tenantId: string };
      const raw = (req.body as { note?: unknown })?.note;
      if (raw !== undefined && typeof raw !== 'string') throw new Error('note harus string');
      const note = (raw ?? '').trim().slice(0, 2000);
      await deps.data.setNote(tenantId, note.length ? note : null);
      return { ok: true };
    }),
  );

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
      const b = (req.body ?? {}) as {
        tenantId?: unknown; subject?: unknown; body?: unknown; topic?: unknown; priority?: unknown;
      };
      if (typeof b.tenantId !== 'string' || typeof b.subject !== 'string' || !b.subject.trim()) {
        throw new Error('tenantId dan subject wajib');
      }
      if (b.topic !== undefined && !TICKET_TOPICS.includes(String(b.topic))) {
        throw new Error(`topic harus salah satu: ${TICKET_TOPICS.join(', ')}`);
      }
      if (b.priority !== undefined && !TICKET_PRIORITIES.includes(String(b.priority))) {
        throw new Error(`priority harus salah satu: ${TICKET_PRIORITIES.join(', ')}`);
      }
      await deps.data.createTicket(b.tenantId, {
        subject: b.subject.trim(),
        ...(typeof b.body === 'string' && b.body.trim() ? { body: b.body.trim() } : {}),
        ...(b.topic !== undefined ? { topic: String(b.topic) } : {}),
        ...(b.priority !== undefined ? { priority: String(b.priority) } : {}),
      });
      return { ok: true };
    }),
  );

  app.post(
    '/api/admin/dashboard/tickets/:id/priority',
    route(async (req) => {
      const { id } = req.params as { id: string };
      const priority = String((req.body as { priority?: unknown })?.priority ?? '');
      if (!TICKET_PRIORITIES.includes(priority)) {
        throw new Error(`priority harus salah satu: ${TICKET_PRIORITIES.join(', ')}`);
      }
      await deps.data.setTicketPriority(id, priority);
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

  // ── SOP bot (konsumen + admin): lihat & simpan dari dashboard ──────────────
  const SOP_WHICH = ['konsumen', 'admin'];
  const SOP_MAX_CHARS = 20_000;

  app.get(
    '/api/admin/dashboard/sop',
    route(async () => {
      if (!deps.sop) throw new Error('SOP belum dikonfigurasi (env SOP_PATH / SOP_ADMIN_PATH)');
      return { sop: await deps.sop.list() };
    }),
  );

  app.put(
    '/api/admin/dashboard/sop',
    route(async (req) => {
      if (!deps.sop) throw new Error('SOP belum dikonfigurasi (env SOP_PATH / SOP_ADMIN_PATH)');
      const b = (req.body ?? {}) as { which?: unknown; text?: unknown };
      if (typeof b.which !== 'string' || !SOP_WHICH.includes(b.which)) {
        throw new Error(`which harus salah satu: ${SOP_WHICH.join(', ')}`);
      }
      if (typeof b.text !== 'string') throw new Error('text wajib string');
      if (b.text.length > SOP_MAX_CHARS) throw new Error(`SOP terlalu panjang (maks ${SOP_MAX_CHARS} karakter)`);
      await deps.sop.save(b.which as 'konsumen' | 'admin', b.text);
      return { ok: true };
    }),
  );

  // ── Pengaturan LLM runtime (model / API key / harga) ───────────────────────
  app.get(
    '/api/admin/dashboard/settings',
    route(async () => {
      if (!deps.settings) throw new Error('pengaturan LLM belum dikonfigurasi (env LLM_RUNTIME_CONFIG_PATH)');
      return deps.settings.get();
    }),
  );

  app.post(
    '/api/admin/dashboard/settings',
    route(async (req) => {
      if (!deps.settings) throw new Error('pengaturan LLM belum dikonfigurasi (env LLM_RUNTIME_CONFIG_PATH)');
      const b = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const k of ['model', 'apiKey'] as const) {
        if (b[k] === undefined) continue;
        if (typeof b[k] !== 'string') throw new Error(`${k} harus string`);
        patch[k] = (b[k] as string).trim();
      }
      for (const k of ['priceInputPer1M', 'priceOutputPer1M'] as const) {
        if (b[k] === undefined || b[k] === '') continue;
        const n = Number(b[k]);
        if (!Number.isFinite(n) || n < 0 || n > 1000) throw new Error(`${k} harus angka 0..1000`);
        patch[k] = n;
      }
      return deps.settings.save(patch as DashboardSettingsPatch);
    }),
  );
}
