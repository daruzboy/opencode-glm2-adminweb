// BullMQ Worker untuk antrean publish (T-063, ADR-2; SRS §3.2). Wrapper TIPIS di atas
// dispatcher murni processPublishJob: satu-satunya bagian yang menyentuh BullMQ/Redis.
// Job gagal → throw agar BullMQ menandai failed & retry sesuai opts job (attempts/backoff).

import { Worker, type ConnectionOptions } from 'bullmq';
import { PUBLISH_QUEUE, processPublishJob, type PublishQueueJob } from './publish-job.js';
import type { PublishDeps } from './publish.js';

export interface PublishWorkerOptions {
  readonly connection: ConnectionOptions;
  readonly concurrency?: number;
}

export function startPublishWorker(deps: PublishDeps, options: PublishWorkerOptions): Worker<PublishQueueJob> {
  return new Worker<PublishQueueJob>(
    PUBLISH_QUEUE,
    async (job) => {
      const result = await processPublishJob(deps, job.data);
      if (!result.ok) {
        // Throw = BullMQ tandai job gagal → retry (attempts/backoff dari produsen job).
        throw new Error(`[${result.error.code}] ${result.error.message}`);
      }
      return result.value;
    },
    { connection: options.connection, concurrency: options.concurrency ?? 1 },
  );
}
