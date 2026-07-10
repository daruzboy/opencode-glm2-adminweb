// Port: produsen antrean publish (T-063, FR-PUB-004; SRS §3.2, ADR-2). api meng-enqueue
// job publish (approval-first BRU-02) → worker mengkonsumsi (publish-worker). Nama antrean
// = kontrak bersama api (produsen) & worker (konsumen). Adapter BullMQ di packages/adapters.

import type { PublishError } from './publish.js';
import type { Result } from '../index.js';

export const PUBLISH_QUEUE_NAME = 'publish';

// Payload job publish (selaras PublishJobData di worker). siteDocument sudah divalidasi
// worker via parseSiteDocument (Port `unknown` agar shared tak bergantung sites-kit).
export interface PublishJobRequest {
  readonly websiteId: string;
  readonly revisionNumber: number;
  readonly slug: string;
  readonly baseUrl: string;
  readonly siteDocument: unknown;
  readonly docroot?: string;
  readonly rootDomain?: string;
}

export interface EnqueueResult {
  readonly jobId: string;
}

export interface PublishQueuePort {
  enqueuePublish(job: PublishJobRequest): Promise<Result<EnqueueResult, PublishError>>;
}
