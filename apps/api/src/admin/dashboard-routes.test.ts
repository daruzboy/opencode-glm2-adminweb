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
        liveUrl: null, previewUrl: null, adminNote: null,
        lastInboundAt: null, openTickets: 0, unresolvedFeedback: 1,
      },
    ]),
    profile: vi.fn(async () => ({
      customerName: 'Bu Kopi', brief: { businessName: 'Kopi' }, notes: ['suka hijau'], updatedAt: null,
    })),
    setNote: vi.fn(async () => undefined),
    extendTrial: vi.fn(async () => undefined),
    setStatus: vi.fn(async () => undefined),
    addQuotaMessages: vi.fn(async () => undefined),
    tickets: vi.fn(async () => []),
    createTicket: vi.fn(async () => undefined),
    setTicketStatus: vi.fn(async () => undefined),
    setTicketPriority: vi.fn(async () => undefined),
    feedback: vi.fn(async () => []),
    resolveFeedback: vi.fn(async () => undefined),
    usage: vi.fn(async () => ({ totalCostUsd: 0 })),
    system: vi.fn(async () => ({
      load1: 0.5, cpuCount: 4, memUsedMb: 1, memTotalMb: 2, diskUsedGb: 1, diskTotalGb: 2,
      queues: {}, model: 'deepseek-v4-flash', pricePer1M: { input: 0.14, output: 0.28 }, uptimeHours: 1,
    })),
  } as never;
}

function fakeSop() {
  const docs = [
    { which: 'konsumen' as const, title: 'SOP Pelayanan Konsumen', path: '/sop/a.md', text: 'sapa dulu' },
    { which: 'admin' as const, title: 'SOP Konsol Admin', path: '/sop/b.md', text: 'tanya konsumen' },
  ];
  return { list: vi.fn(async () => docs), save: vi.fn(async () => undefined) };
}

function fakeSettings() {
  return {
    get: vi.fn(async () => ({
      model: 'deepseek-v4-flash', modelOverridden: false, apiKeyMasked: 'sk-a…wxyz',
      apiKeyOverridden: false, priceInputPer1M: 0.14, priceOutputPer1M: 0.28, priceOverridden: false,
    })),
    save: vi.fn(async () => ({
      model: 'deepseek-v4-pro', modelOverridden: true, apiKeyMasked: 'sk-a…wxyz',
      apiKeyOverridden: false, priceInputPer1M: 0.6, priceOutputPer1M: 1.7, priceOverridden: true,
    })),
  };
}

async function app(data = fakeData(), extra: { sop?: ReturnType<typeof fakeSop>; settings?: ReturnType<typeof fakeSettings> } = {}) {
  const a = Fastify();
  registerDashboardRoutes(a, { token: 'rahasia-dash', data, page: '<h1>dash</h1>', ...extra });
  return { a, data, ...extra };
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
    const okTicket = await a.inject({ method: 'POST', url: '/api/admin/dashboard/tickets', headers: H, payload: { tenantId: 't1', subject: 'Ganti foto', topic: 'konten', priority: 'tinggi' } });
    expect(okTicket.statusCode).toBe(200);
    expect(data.createTicket).toHaveBeenCalledWith('t1', { subject: 'Ganti foto', topic: 'konten', priority: 'tinggi' });

    const badTopic = await a.inject({ method: 'POST', url: '/api/admin/dashboard/tickets', headers: H, payload: { tenantId: 't1', subject: 'x', topic: 'ngaco' } });
    expect(badTopic.statusCode).toBe(500);
    const okPri = await a.inject({ method: 'POST', url: '/api/admin/dashboard/tickets/tk1/priority', headers: H, payload: { priority: 'tinggi' } });
    expect(okPri.statusCode).toBe(200);
    expect(data.setTicketPriority).toHaveBeenCalledWith('tk1', 'tinggi');
    expect((await a.inject({ method: 'POST', url: '/api/admin/dashboard/tickets/tk1/priority', headers: H, payload: { priority: 'x' } })).statusCode).toBe(500);

    expect((await a.inject({ method: 'POST', url: '/api/admin/dashboard/feedback/f1/resolve', headers: H, payload: {} })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/api/admin/dashboard/usage', headers: H })).statusCode).toBe(200);
    const sys = await a.inject({ method: 'GET', url: '/api/admin/dashboard/system', headers: H });
    expect(sys.json().model).toBe('deepseek-v4-flash');
  });

  it('memori konsumen tersaji; catatan admin tersimpan (kosong = hapus, dipangkas 2000)', async () => {
    const { a, data } = await app();

    const prof = await a.inject({ method: 'GET', url: '/api/admin/dashboard/customers/t1/profile', headers: H });
    expect(prof.statusCode).toBe(200);
    expect(prof.json().profile.customerName).toBe('Bu Kopi');

    const okNote = await a.inject({ method: 'POST', url: '/api/admin/dashboard/customers/t1/note', headers: H, payload: { note: '  VIP, follow up Senin  ' } });
    expect(okNote.statusCode).toBe(200);
    expect(data.setNote).toHaveBeenCalledWith('t1', 'VIP, follow up Senin');

    await a.inject({ method: 'POST', url: '/api/admin/dashboard/customers/t1/note', headers: H, payload: { note: '' } });
    expect(data.setNote).toHaveBeenLastCalledWith('t1', null);

    const bad = await a.inject({ method: 'POST', url: '/api/admin/dashboard/customers/t1/note', headers: H, payload: { note: 5 } });
    expect(bad.statusCode).toBe(500);
  });

  it('SOP: daftar tersaji, simpan tervalidasi (which enum, batas panjang); tanpa deps → error jelas', async () => {
    const sop = fakeSop();
    const { a } = await app(fakeData(), { sop });

    const list = await a.inject({ method: 'GET', url: '/api/admin/dashboard/sop', headers: H });
    expect(list.json().sop).toHaveLength(2);

    const okSave = await a.inject({ method: 'PUT', url: '/api/admin/dashboard/sop', headers: H, payload: { which: 'admin', text: 'baru' } });
    expect(okSave.statusCode).toBe(200);
    expect(sop.save).toHaveBeenCalledWith('admin', 'baru');

    expect((await a.inject({ method: 'PUT', url: '/api/admin/dashboard/sop', headers: H, payload: { which: 'x', text: 'a' } })).statusCode).toBe(500);
    expect((await a.inject({ method: 'PUT', url: '/api/admin/dashboard/sop', headers: H, payload: { which: 'admin', text: 'x'.repeat(20_001) } })).statusCode).toBe(500);

    const { a: tanpa } = await app();
    const res = await tanpa.inject({ method: 'GET', url: '/api/admin/dashboard/sop', headers: H });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('SOP');
  });

  it('pengaturan LLM: get/save diteruskan, harga & tipe tervalidasi', async () => {
    const settings = fakeSettings();
    const { a } = await app(fakeData(), { settings });

    const cur = await a.inject({ method: 'GET', url: '/api/admin/dashboard/settings', headers: H });
    expect(cur.json().model).toBe('deepseek-v4-flash');
    // API key tidak pernah bocor penuh.
    expect(JSON.stringify(cur.json())).not.toContain('apiKey":"sk-');

    const ok = await a.inject({ method: 'POST', url: '/api/admin/dashboard/settings', headers: H, payload: { model: ' deepseek-v4-pro ', priceInputPer1M: 0.6, priceOutputPer1M: '1.7' } });
    expect(ok.statusCode).toBe(200);
    expect(settings.save).toHaveBeenCalledWith({ model: 'deepseek-v4-pro', priceInputPer1M: 0.6, priceOutputPer1M: 1.7 });

    expect((await a.inject({ method: 'POST', url: '/api/admin/dashboard/settings', headers: H, payload: { priceInputPer1M: -1 } })).statusCode).toBe(500);
    expect((await a.inject({ method: 'POST', url: '/api/admin/dashboard/settings', headers: H, payload: { model: 7 } })).statusCode).toBe(500);
  });
});
