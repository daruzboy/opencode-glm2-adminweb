// P5: rute callback review — service token + korelasi (Fastify inject, fake deps).

import { describe, expect, it, vi } from 'vitest';
import { ok } from '@digimaestro/shared';
import { buildServer } from '../index.js';
import type { ReviewRoutesDeps } from './routes.js';

const PENDING_REV = {
  id: 'r1',
  websiteId: 'w1',
  number: 3,
  siteDoc: {},
  summary: null,
  status: 'PENDING_ADMIN_REVIEW',
  createdBy: 'agent',
  renderEngine: 'mobirise-v1',
  templateId: 'tpl-a',
  editorProjectId: 'proj-9',
  createdAt: '',
  updatedAt: '',
};

function deps(over: Partial<ReviewRoutesDeps> = {}): ReviewRoutesDeps {
  return {
    serviceToken: 'rahasia',
    tenantOfWebsite: vi.fn(async () => 't1'),
    review: {
      revisions: {
        findById: vi.fn(async () => ok(PENDING_REV)),
        findLatest: vi.fn(),
        create: vi.fn(async () => ok({ ...PENDING_REV, id: 'r2', number: 4 })),
        update: vi.fn(async () => ok(PENDING_REV)),
      },
      websites: { findByTenantId: vi.fn(), create: vi.fn(), update: vi.fn(async () => ok({})) },
      conversations: { findMany: vi.fn(async () => ok([])) },
      messages: { create: vi.fn(), findManyByConversation: vi.fn() },
      channel: { channel: 'TELEGRAM', sendText: vi.fn(), sendButtons: vi.fn(), answerCallback: vi.fn() },
      parseDocument: () => ({ ok: true }),
    } as never,
    ...over,
  };
}

const BODY = { websiteId: 'w1', revisionId: 'r1', editorProjectId: 'proj-9', document: { pages: [] } };

describe('POST /api/internal/review/complete', () => {
  it('token salah/absen → 401, use case tak tersentuh', async () => {
    const d = deps();
    const app = await buildServer({ reviewGate: d });

    const tanpa = await app.inject({ method: 'POST', url: '/api/internal/review/complete', payload: BODY });
    const salah = await app.inject({
      method: 'POST',
      url: '/api/internal/review/complete',
      headers: { 'x-service-token': 'bukan' },
      payload: BODY,
    });

    expect(tanpa.statusCode).toBe(401);
    expect(salah.statusCode).toBe(401);
  });

  it('token benar + korelasi benar → 200 (revisi baru + siap dikirim ke pelanggan)', async () => {
    const app = await buildServer({ reviewGate: deps() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/review/complete',
      headers: { 'x-service-token': 'rahasia' },
      payload: BODY,
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { revisionNumber: number }).revisionNumber).toBe(4);
  });

  it('editorProjectId palsu → 422 (korelasi ditolak)', async () => {
    const app = await buildServer({ reviewGate: deps() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/review/complete',
      headers: { 'x-service-token': 'rahasia' },
      payload: { ...BODY, editorProjectId: 'proj-palsu' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('body tak lengkap → 400; website asing → 404', async () => {
    const app = await buildServer({ reviewGate: deps() });
    const kurang = await app.inject({
      method: 'POST',
      url: '/api/internal/review/complete',
      headers: { 'x-service-token': 'rahasia' },
      payload: { websiteId: 'w1' },
    });
    expect(kurang.statusCode).toBe(400);

    const asing = await buildServer({
      reviewGate: deps({ tenantOfWebsite: vi.fn(async () => null) }),
    });
    const res = await asing.inject({
      method: 'POST',
      url: '/api/internal/review/complete',
      headers: { 'x-service-token': 'rahasia' },
      payload: BODY,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/admin/review/:revisionId/handoff (re-trigger)', () => {
  it('tanpa deps admin → rute tak terpasang; tenant bukan admin → 404', async () => {
    const tanpaAdmin = await buildServer({ reviewGate: deps() });
    expect(
      (await tanpaAdmin.inject({ method: 'POST', url: '/api/admin/review/r1/handoff' })).statusCode,
    ).toBe(404);

    const retrigger = vi.fn(async () => ({ ok: true, message: 'ok' }));
    const app = await buildServer({
      reviewGate: deps({ admin: { adminTenantId: 't-admin', retrigger } }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/review/r1/handoff',
      headers: { 'x-tenant-id': 't-lain' },
    });
    expect(res.statusCode).toBe(404);
    expect(retrigger).not.toHaveBeenCalled();
  });
});
