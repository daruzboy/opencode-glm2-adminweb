// Factory konkret PublishQueuePort di atas bullmq Queue (T-063, ADR-2). Mengisolasi impor
// vendor bullmq (producer) dari BullMqPublishQueue yang tetap offline-testable via JobQueueClient.

import { Queue, type ConnectionOptions } from 'bullmq';
import { PUBLISH_QUEUE_NAME, type PublishQueuePort } from '@digimaestro/shared';
import { BullMqPublishQueue, type JobQueueClient } from './bullmq-publish-queue.js';
import { defaultPublishJobOptions, type PublishJobPolicy } from './publish-job-options.js';

// defaultJobOptions memberi SEMUA job antrean `publish` kebijakan retry/backoff/retensi
// (hardening T-063) → kegagalan transien di-retry backoff eksponensial, job final gagal
// tersimpan sbg dead-letter di failed-set. Policy opsional override default.
export function createBullMqPublishQueue(
  connection: ConnectionOptions,
  policy?: PublishJobPolicy,
): PublishQueuePort {
  const queue = new Queue(PUBLISH_QUEUE_NAME, {
    connection,
    defaultJobOptions: defaultPublishJobOptions(policy),
  });
  const client: JobQueueClient = {
    add: (name, data) => queue.add(name, data as Record<string, unknown>),
  };
  return new BullMqPublishQueue(client);
}
