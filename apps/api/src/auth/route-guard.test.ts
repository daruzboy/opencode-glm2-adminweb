import { describe, it, expect } from 'vitest';
import { ok, tenantId, type PublishSourcePort, type PublishQueuePort } from '@digimaestro/shared';
import { JwtAuthPort } from '@digimaestro/adapters';
import { buildServer } from '../index.js';
import type { PublishRequestDeps } from '../publish/handle-publish.js';

const SECRET = 'guard-secret';
const auth = new JwtAuthPort({ secret: SECRET });

const source: PublishSourcePort = {
  async getPublishSource(_t, input) {
    if (input.websiteId !== 'w1' || input.revisionNumber !== 3) return ok(null);
    return ok({ websiteId: 'w1', revisionNumber: 3, slug: 'warung-demo', siteDocument: { website: { name: 'W' } } });
  },
};
const queue: PublishQueuePort = { async enqueuePublish() { return ok({ jobId: 'job-9' }); } };
const publish: PublishRequestDeps = { source, queue, rootDomain: 'digimaestro.id' };

// Auth aktif, TANPA fallback header, TANPA endpoint token dev → konfigurasi produksi.
function prodAuthApp() {
  return buildServer({ publish, auth: { auth, allowHeaderFallback: false, devTokenEnabled: false } });
}

async function tokenFor(tid: string): Promise<string> {
  const r = await auth.issueToken({ tenantId: tenantId(tid), userId: 'u1', role: 'OWNER' });
  if (!r.ok) throw new Error('issue token gagal');
  return r.value;
}

describe('Route guard (T-002auth: auth aktif → rute wajib token JWT)', () => {
  it('publish tanpa Authorization → 401 (x-tenant-id TIDAK menembus saat auth aktif)', async () => {
    const app = await prodAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/websites/w1/publish',
      headers: { 'x-tenant-id': 't1' },
      payload: { revisionNumber: 3 },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('publish dengan Bearer token valid → 202 (tenant diambil dari token)', async () => {
    const app = await prodAuthApp();
    const token = await tokenFor('t1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/websites/w1/publish',
      headers: { authorization: `Bearer ${token}` },
      payload: { revisionNumber: 3 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ jobId: 'job-9' });
    await app.close();
  });

  it('publish dengan token sampah → 401', async () => {
    const app = await prodAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/websites/w1/publish',
      headers: { authorization: 'Bearer not.a.jwt' },
      payload: { revisionNumber: 3 },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('endpoint /api/auth/token TIDAK terpasang tanpa AUTH_DEV_TOKEN → 404', async () => {
    const app = await prodAuthApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/token', payload: { tenantSlug: 'x' } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
