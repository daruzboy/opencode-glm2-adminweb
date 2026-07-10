// BullMQ Worker untuk antrean publish (T-063, ADR-2; SRS §3.2). Wrapper TIPIS di atas
// dispatcher murni processPublishJob: satu-satunya bagian yang menyentuh BullMQ/Redis.
// Job gagal → throw agar BullMQ menandai failed & retry sesuai opts job (attempts/backoff
// diset produsen via defaultPublishJobOptions). Observability: log siklus-hidup + dead-letter.

import { Worker, type ConnectionOptions } from 'bullmq';
import { PUBLISH_QUEUE, processPublishJob, type PublishQueueJob } from './publish-job.js';
import {
  formatJobFailure,
  formatJobStart,
  formatJobSuccess,
  type JobLogView,
  type Logger,
} from './publish-observability.js';
import type { PublishDeps } from './publish.js';

export interface PublishWorkerOptions {
  readonly connection: ConnectionOptions;
  readonly concurrency?: number;
  // Logger terinjeksi (default console) → memudahkan uji & routing log terstruktur.
  readonly logger?: Logger;
}

export function startPublishWorker(deps: PublishDeps, options: PublishWorkerOptions): Worker<PublishQueueJob> {
  const logger = options.logger ?? console;

  const worker = new Worker<PublishQueueJob>(
    PUBLISH_QUEUE,
    async (job) => {
      logger.info(formatJobStart(job as unknown as JobLogView));
      const startedAt = Date.now();
      const result = await processPublishJob(deps, job.data);
      if (!result.ok) {
        // Throw = BullMQ tandai job gagal → retry (attempts/backoff dari produsen job).
        throw new Error(`[${result.error.code}] ${result.error.message}`);
      }
      logger.info(formatJobSuccess(job as unknown as JobLogView, Date.now() - startedAt));
      return result.value;
    },
    { connection: options.connection, concurrency: options.concurrency ?? 1 },
  );

  // Event failed dipancarkan tiap percobaan gagal; formatter menandai DEAD-LETTER saat
  // percobaan terakhir habis (attemptsMade >= attempts) → mudah di-grep/alert di stdout.
  worker.on('failed', (job, err) => {
    if (job) logger.error(formatJobFailure(job as unknown as JobLogView, err.message));
    else logger.error(`[publish-worker] gagal tanpa konteks job: ${err.message}`);
  });

  return worker;
}
