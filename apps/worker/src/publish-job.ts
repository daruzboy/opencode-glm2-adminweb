// Dispatcher job publish (T-063, FR-PUB-004/005). Fungsi MURNI (tanpa BullMQ/infra) →
// diuji offline. BullMQ Worker (publish-worker.ts) hanya memanggil processPublishJob dgn
// deps terkomposisi + data job. Job = discriminated union {kind}: publish | rollback.

import { publishSite, rollbackSite, type PublishDeps, type PublishResult } from './publish.js';
import type { PublishError, Result } from '@digimaestro/shared';

export const PUBLISH_QUEUE = 'publish';

export interface PublishJobData {
  readonly kind: 'publish';
  readonly websiteId: string;
  readonly revisionNumber: number;
  readonly slug: string;
  readonly baseUrl: string;
  readonly siteDocument: unknown;
  readonly docroot?: string;
}

export interface RollbackJobData {
  readonly kind: 'rollback';
  readonly websiteId: string;
  readonly revisionNumber: number;
  readonly slug: string;
  readonly docroot?: string;
}

export type PublishQueueJob = PublishJobData | RollbackJobData;

// Dispatch berdasar kind → use case publish/rollback. Result dikembalikan; pemanggil
// (BullMQ) memutuskan throw agar job retry (lihat publish-worker.ts).
export async function processPublishJob(
  deps: PublishDeps,
  data: PublishQueueJob,
): Promise<Result<PublishResult, PublishError>> {
  if (data.kind === 'rollback') {
    return rollbackSite(deps, {
      websiteId: data.websiteId,
      revisionNumber: data.revisionNumber,
      slug: data.slug,
      docroot: data.docroot,
    });
  }
  return publishSite(deps, {
    websiteId: data.websiteId,
    revisionNumber: data.revisionNumber,
    slug: data.slug,
    baseUrl: data.baseUrl,
    siteDocument: data.siteDocument,
    docroot: data.docroot,
  });
}
