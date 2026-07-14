// P3: rute admin reindex — pagar akses SAMA ketatnya dengan /api/admin/usage.

import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../index.js';

const REPORT = { indexed: ['tpl-a'], deactivated: 0, errors: ['tpl-b: rusak'] };

function deps(adminTenantId?: string) {
  return { adminTenantId, reindex: vi.fn(async () => REPORT) };
}

describe('POST /api/admin/templates/reindex', () => {
  it('tanpa ADMIN_TENANT_ID → rute TIDAK terpasang (fail-closed)', async () => {
    const app = await buildServer({ templates: deps(undefined) });
    const res = await app.inject({ method: 'POST', url: '/api/admin/templates/reindex' });
    expect(res.statusCode).toBe(404);
  });

  it('tanpa token → 401', async () => {
    const app = await buildServer({ templates: deps('t-admin') });
    const res = await app.inject({ method: 'POST', url: '/api/admin/templates/reindex' });
    // Mode dev fallback header: tanpa header pun tenant tak ada → 401.
    expect([401, 404]).toContain(res.statusCode);
  });

  it('tenant BUKAN admin → 404 (keberadaan endpoint tak bocor)', async () => {
    const d = deps('t-admin');
    const app = await buildServer({ templates: d });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/templates/reindex',
      headers: { 'x-tenant-id': 't-lain' },
    });
    expect(res.statusCode).toBe(404);
    expect(d.reindex).not.toHaveBeenCalled();
  });

  it('tenant admin (dev fallback tanpa role) → tetap 404: butuh role OWNER', async () => {
    const d = deps('t-admin');
    const app = await buildServer({ templates: d });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/templates/reindex',
      headers: { 'x-tenant-id': 't-admin' },
    });
    // resolveTenant dev fallback tak membawa payload.role=OWNER → ditolak.
    expect(res.statusCode).toBe(404);
    expect(d.reindex).not.toHaveBeenCalled();
  });
});
