import { describe, it, expect } from 'vitest';
import { BullMqPublishQueue, type JobQueueClient } from '../bullmq-publish-queue.js';
import type { PublishJobRequest } from '@digimaestro/shared';

const job: PublishJobRequest = {
  websiteId: 'w1',
  revisionNumber: 3,
  slug: 'warung-demo',
  baseUrl: 'https://warung-demo.digimaestro.id',
  siteDocument: { website: { name: 'W' } },
  rootDomain: 'digimaestro.id',
};

describe('BullMqPublishQueue', () => {
  it('enqueuePublish → add job kind:publish + kembalikan jobId', async () => {
    let seen: { name: string; data: unknown } | undefined;
    const client: JobQueueClient = {
      async add(name, data) {
        seen = { name, data };
        return { id: 'job-42' };
      },
    };
    const res = await new BullMqPublishQueue(client).enqueuePublish(job);
    expect(res).toEqual({ ok: true, value: { jobId: 'job-42' } });
    expect(seen?.name).toBe('publish');
    expect(seen?.data).toEqual({ kind: 'publish', ...job });
  });

  it('id null dari antrean → jobId "unknown"', async () => {
    const client: JobQueueClient = { async add() { return { id: null }; } };
    const res = await new BullMqPublishQueue(client).enqueuePublish(job);
    expect(res).toMatchObject({ ok: true, value: { jobId: 'unknown' } });
  });

  it('add melempar → err QUEUE', async () => {
    const client: JobQueueClient = {
      async add() {
        throw new Error('redis unreachable');
      },
    };
    const res = await new BullMqPublishQueue(client).enqueuePublish(job);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('QUEUE');
      expect(res.error.message).toContain('redis unreachable');
    }
  });
});
