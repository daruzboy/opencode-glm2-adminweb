// Preview PUBLIK (2026-07-15): pratinjau = bundel di hosting, bukan tautan API tailnet.

import { describe, expect, it } from 'vitest';
import {
  err,
  ok,
  tenantId,
  type EnqueueResult,
  type PublishError,
  type PublishJobRequest,
  type PublishQueuePort,
  type PublishSource,
  type PublishSourcePort,
  type RepositoryError,
  type Result,
} from '@digimaestro/shared';
import { previewSlug, requestPreview } from './request-preview.js';

const TENANT = tenantId('t1');
const SOURCE: PublishSource = {
  websiteId: 'w-abcdef123456',
  revisionNumber: 7,
  slug: 'kopi-senja',
  siteDocument: { pages: [] },
  renderEngine: 'mobirise-v1',
};

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
      return over.err ? err({ code: 'QUEUE', message: 'redis down' }) : ok({ jobId: 'job-9' });
    },
  };
}

const req = { tenantId: TENANT, websiteId: 'w-abcdef123456', revisionNumber: 7 };

describe('requestPreview', () => {
  it('enqueue mode preview: slug berprefiks preview/, url path-mode publik, engine ikut', async () => {
    let job: PublishJobRequest | undefined;
    const res = await requestPreview(
      {
        source: fakeSource(SOURCE),
        queue: fakeQueue({ capture: (j) => (job = j) }),
        rootDomain: 'digimaestro.id',
        previewToken: () => 'tok123abc456',
      },
      req,
    );

    expect(res).toEqual({ ok: true, jobId: 'job-9', url: 'https://digimaestro.id/preview/kopi-senja-tok123abc456/' });
    expect(job).toMatchObject({
      mode: 'preview',
      slug: 'preview/kopi-senja-tok123abc456',
      urlMode: 'path',
      renderEngine: 'mobirise-v1',
      revisionNumber: 7,
      tenantId: 't1',
    });
    expect(job?.baseUrl).toBe('https://digimaestro.id/preview/kopi-senja-tok123abc456/');
  });

  it('tanpa previewToken → potongan websiteId (cuid, tak tertebak) dipakai', () => {
    expect(previewSlug('kopi-senja', 'w-abcdef123456')).toBe('preview/kopi-senja-abcdef123456');
  });

  it('revisi tak ditemukan / enqueue gagal → ok:false ber-pesan (pemanggil fallback)', async () => {
    const notFound = await requestPreview(
      { source: fakeSource(null), queue: fakeQueue(), rootDomain: 'digimaestro.id' },
      req,
    );
    expect(notFound.ok).toBe(false);

    const queueDown = await requestPreview(
      { source: fakeSource(SOURCE), queue: fakeQueue({ err: true }), rootDomain: 'digimaestro.id' },
      req,
    );
    expect(queueDown.ok).toBe(false);
    if (!queueDown.ok) expect(queueDown.message).toContain('redis');
  });
});
