import { describe, it, expect } from 'vitest';
import { ok, type PublishSourcePort, type PublishQueuePort } from '@digimaestro/shared';
import { buildServer } from '../../index.js';
import type { PublishRequestDeps } from '../handle-publish.js';

const source: PublishSourcePort = {
  async getPublishSource(_t, input) {
    if (input.websiteId !== 'w1' || input.revisionNumber !== 3) return ok(null);
    return ok({ websiteId: 'w1', revisionNumber: 3, slug: 'warung-demo', siteDocument: { website: { name: 'W' } } });
  },
};
const queue: PublishQueuePort = { async enqueuePublish() { return ok({ jobId: 'job-9' }); } };
const deps: PublishRequestDeps = { source, queue, rootDomain: 'digimaestro.id' };

describe('POST /api/websites/:websiteId/publish (BRU-02)', () => {
  it('header tenant + body valid + revisi ada → 202 + jobId', async () => {
    const app = await buildServer({ publish: deps });
    const res = await app.inject({
      method: 'POST',
      url: '/api/websites/w1/publish',
      headers: { 'x-tenant-id': 't1' },
      payload: { revisionNumber: 3 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ jobId: 'job-9', url: 'https://warung-demo.digimaestro.id' });
    await app.close();
  });

  it('tanpa x-tenant-id → 401', async () => {
    const app = await buildServer({ publish: deps });
    const res = await app.inject({ method: 'POST', url: '/api/websites/w1/publish', payload: { revisionNumber: 3 } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('body invalid (revisionNumber bukan int positif) → 400', async () => {
    const app = await buildServer({ publish: deps });
    const res = await app.inject({
      method: 'POST',
      url: '/api/websites/w1/publish',
      headers: { 'x-tenant-id': 't1' },
      payload: { revisionNumber: -1 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('revisi tak ada → 404', async () => {
    const app = await buildServer({ publish: deps });
    const res = await app.inject({
      method: 'POST',
      url: '/api/websites/w1/publish',
      headers: { 'x-tenant-id': 't1' },
      payload: { revisionNumber: 99 },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
