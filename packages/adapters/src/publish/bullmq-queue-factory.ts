// Factory konkret PublishQueuePort di atas bullmq Queue (T-063, ADR-2). Mengisolasi impor
// vendor bullmq (producer) dari BullMqPublishQueue yang tetap offline-testable via JobQueueClient.

import { Queue, type ConnectionOptions } from 'bullmq';
import { PUBLISH_QUEUE_NAME, type PublishQueuePort } from '@digimaestro/shared';
import { BullMqPublishQueue, type JobQueueClient } from './bullmq-publish-queue.js';

export function createBullMqPublishQueue(connection: ConnectionOptions): PublishQueuePort {
  const queue = new Queue(PUBLISH_QUEUE_NAME, { connection });
  const client: JobQueueClient = {
    add: (name, data) => queue.add(name, data as Record<string, unknown>),
  };
  return new BullMqPublishQueue(client);
}
