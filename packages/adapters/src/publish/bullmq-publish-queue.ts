// Adapter: PublishQueuePort produsen via BullMQ (T-063, ADR-2). api meng-enqueue job
// publish → worker (publish-worker) mengkonsumsi. Bergantung interface sempit `JobQueueClient`
// (bukan bullmq langsung) → offline-testable. Klien konkret (bullmq Queue) via factory.

import { err, ok } from '@digimaestro/shared';
import {
  PUBLISH_QUEUE_NAME,
  type EnqueueResult,
  type PublishError,
  type PublishJobRequest,
  type PublishQueuePort,
  type Result,
} from '@digimaestro/shared';

// Interface sempit ke antrean job: hanya add(). Kompatibel struktural dgn bullmq Queue.add.
export interface JobQueueClient {
  add(jobName: string, data: unknown): Promise<{ readonly id?: string | null }>;
}

export class BullMqPublishQueue implements PublishQueuePort {
  constructor(private readonly queue: JobQueueClient) {}

  async enqueuePublish(job: PublishJobRequest): Promise<Result<EnqueueResult, PublishError>> {
    try {
      // Job data selaras PublishQueueJob konsumen (kind discriminant).
      const added = await this.queue.add('publish', { kind: 'publish', ...job });
      return ok({ jobId: added.id ?? 'unknown' });
    } catch (e) {
      return err({ code: 'QUEUE', message: `gagal enqueue job publish: ${(e as Error).message}` });
    }
  }
}

export { PUBLISH_QUEUE_NAME };
