import { describe, it, expect } from 'vitest';
import {
  ok,
  err,
  tenantId,
  type PublishSourcePort,
  type PublishQueuePort,
  type PublishJobRequest,
  type Result,
  type EnqueueResult,
  type PublishError,
  type PublishSource,
  type RepositoryError,
} from '@digimaestro/shared';
import { handlePublishRequest, type PublishRequestDeps } from '../handle-publish.js';

const TENANT = tenantId('t1');
const SITE_DOC = { website: { name: 'Warung' } };

function fakeSource(value: PublishSource | null, error?: RepositoryError): PublishSourcePort {
  return {
    async getPublishSource(): Promise<Result<PublishSource | null, RepositoryError>> {
      return error ? err(error) : ok(value);
    },
  };
}

function fakeQueue(over: { err?: boolean; capture?: (j: PublishJobRequest) => void } = {}): PublishQueuePort {
  return {
    async enqueuePublish(job): Promise<Result<EnqueueResult, PublishError>> {
      over.capture?.(job);
      return over.err ? err({ code: 'QUEUE', message: 'redis down' }) : ok({ jobId: 'job-123' });
    },
  };
}

const source: PublishSource = { websiteId: 'w1', revisionNumber: 3, slug: 'warung-demo', siteDocument: SITE_DOC };
const req = { tenantId: TENANT, websiteId: 'w1', revisionNumber: 3 };

describe('handlePublishRequest (BRU-02 approval-first)', () => {
  it('sukses: muat sumber tenant-scoped → enqueue → 202 + jobId + url; konten dari DB (bukan body)', async () => {
    let enqueued: PublishJobRequest | undefined;
    const deps: PublishRequestDeps = { source: fakeSource(source), queue: fakeQueue({ capture: (j) => (enqueued = j) }), rootDomain: 'digimaestro.id' };
    const res = await handlePublishRequest(deps, req);

    expect(res).toEqual({ ok: true, status: 202, jobId: 'job-123', url: 'https://warung-demo.digimaestro.id' });
    expect(enqueued).toEqual({
      websiteId: 'w1',
      revisionNumber: 3,
      slug: 'warung-demo',
      baseUrl: 'https://warung-demo.digimaestro.id',
      siteDocument: SITE_DOC,
      rootDomain: 'digimaestro.id',
    });
  });

  it('revisi tak ada / lintas tenant → 404 (tak enqueue)', async () => {
    let enqueued = false;
    const deps: PublishRequestDeps = { source: fakeSource(null), queue: fakeQueue({ capture: () => (enqueued = true) }), rootDomain: 'digimaestro.id' };
    const res = await handlePublishRequest(deps, req);
    expect(res).toMatchObject({ ok: false, status: 404 });
    expect(enqueued).toBe(false);
  });

  it('error sumber (repo) → 500', async () => {
    const deps: PublishRequestDeps = { source: fakeSource(null, { code: 'UNKNOWN', message: 'db' }), queue: fakeQueue(), rootDomain: 'digimaestro.id' };
    expect(await handlePublishRequest(deps, req)).toMatchObject({ ok: false, status: 500 });
  });

  it('enqueue gagal → 500', async () => {
    const deps: PublishRequestDeps = { source: fakeSource(source), queue: fakeQueue({ err: true }), rootDomain: 'digimaestro.id' };
    expect(await handlePublishRequest(deps, req)).toMatchObject({ ok: false, status: 500 });
  });
});
