// Dashboard admin: auth token statis + validasi input (data port di-fake — tanpa DB).

import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerDashboardRoutes, type DashboardDataPort } from './dashboard-routes.js';

function fakeData(): DashboardDataPort & Record<string, ReturnType<typeof vi.fn>> {
  return {
    customers: vi.fn(async () => [
      {
        tenantId: 't1', name: 'Kopi', slug: 'kopi', status: 'TRIALING', trialEndsAt: null,
        usedMessages: 3, quotaMessages: 100, websiteSlug: null, websiteStatus: null,
        lastInboundAt: null, openTickets: 0, unresolvedFeedback: 1,
      },
    ]),
    extendTrial: vi.fn(async () => undefined),
    setStatus: vi.fn(async () => undefined),
    addQuotaMessages: vi.fn(async () => undefined),
    tickets: vi.fn(async () => []),
    createTicket: vi.fn(async () => undefined),
    setTicketStatus: vi.fn(async () => undefined),
    feedback: vi.fn(async () => []),
    resolveFeedback: vi.fn(async () => undefined),
    usage: vi.fn(async () => ({ totalCostUsd: 0 })),
    system: vi.fn(async () => ({
      load1: 0.5, cpuCount: 4, memUsedMb: 1, memTotalMb: 2, diskUsedGb: 1, diskTotalGb: 2,
      queues: {}, model: 'deepseek-v4-flash', pricePer1M: { input: 0.14, output: 0.28 }, uptimeHours: 1,
    })),
  } as never;
}

async function app(data = fakeData()) {
  const a = Fastify();
  registerDashboardRoutes(a, { token: 'rahasia-dash', data, page: '<h1>dash</h1>' });
  return { a, data };
}

const H = { 'x-admin-token': 'rahasia-dash', 'content-type': 'application/json' };

describe('dashboard admin', () => {
  it('halaman /admin tersaji tanpa token; data 401 tanpa/dengan token salah', async () => {
    const { a } = await app();
    expect((await a.inject({ method: 'GET', url: '/admin' })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/api/admin/dashboard/customers' })).statusCode).toBe(401);
    expect(
      (await a.inject({ method: 'GET', url: '/api/admin/dashboard/customers', headers: { 'x-admin-token': 'salah' } }))
        .statusCode,
    ).toBe(401);
  });

  it('token benar → daftar konsumen', async () => {
    const { a } = await app();
    const res = await a.inject({ method: 'GET', url: '/api/admin/dashboard/customers', headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json().customers[0].slug).toBe('kopi');
  });

  it('aksi tervalidasi: trial 1..365, status enum, kuota 1..10000, tiket status enum', async () => {
    const { a, data } = await app();

    const badDays = await a.inject({ method: 'POST', url: '/api/admin/dashboard/customers/t1/trial', headers: H, payload: { days: 0 } });
    expect(badDays.statusCode).toBe(500);
    const okDays = await a.inject({ method: 'POST', url: '/api/admin/dashboard/customers/t1/trial', headers: H, payload: { days: 14 } });
    expect(okDays.statusCode).toBe(200);
    expect(data.extendTrial).toHaveBeenCalledWith('t1', 14);

    const badStatus = await a.inject({ method: 'POST', url: '/api/admin/dashboard/customers/t1/status', headers: H, payload: { status: 'NGACO' } });
    expect(badStatus.statusCode).toBe(500);
    const okStatus = await a.inject({ method: 'POST', url: '/api/admin/dashboard/customers/t1/status', headers: H, payload: { status: 'ACTIVE' } });
    expect(okStatus.statusCode).toBe(200);

    const okQuota = await a.inject({ method: 'POST', url: '/api/admin/dashboard/customers/t1/quota', headers: H, payload: { amount: 100 } });
    expect(okQuota.statusCode).toBe(200);

    const badTicket = await a.inject({ method: 'POST', url: '/api/admin/dashboard/tickets/x/status', headers: H, payload: { status: 'HILANG' } });
    expect(badTicket.statusCode).toBe(500);
  });

  it('tiket dibuat (tenantId+subject wajib); feedback resolve; usage & system diteruskan', async () => {
    const { a, data } = await app();

    const noSubj = await a.inject({ method: 'POST', url: '/api/admin/dashboard/tickets', headers: H, payload: { tenantId: 't1' } });
    expect(noSubj.statusCode).toBe(500);
    const okTicket = await a.inject({ method: 'POST', url: '/api/admin/dashboard/tickets', headers: H, payload: { tenantId: 't1', subject: 'Ganti foto' } });
    expect(okTicket.statusCode).toBe(200);
    expect(data.createTicket).toHaveBeenCalledWith('t1', 'Ganti foto', undefined);

    expect((await a.inject({ method: 'POST', url: '/api/admin/dashboard/feedback/f1/resolve', headers: H, payload: {} })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/api/admin/dashboard/usage', headers: H })).statusCode).toBe(200);
    const sys = await a.inject({ method: 'GET', url: '/api/admin/dashboard/system', headers: H });
    expect(sys.json().model).toBe('deepseek-v4-flash');
  });
});
