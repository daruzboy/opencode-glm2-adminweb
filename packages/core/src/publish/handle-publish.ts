// Use case publish request (T-063, BRU-02 approval-first; FR-PUB-004). Memanggil use case ini
// = persetujuan eksplisit klien untuk mempublikasikan sebuah revisi — lewat rute HTTP (portal)
// MAUPUN lewat tombol "Setuju & publish" di chat (T-031tg).
//
// T-031tg: dipindah dari apps/api ke core. Isinya murni (Port saja) dan kini dipakai DUA
// composition root (api utk rute HTTP, worker utk tombol kanal) — AGENTS.md §2: apps/* =
// composition root saja. Konten diambil dari DB
// tepercaya (PublishSourcePort, tenant-scoped) — BUKAN dari body — lalu di-enqueue ke worker
// (PublishQueuePort). Bergantung hanya pada Port → diuji dengan fake tanpa DB/Redis.

import { publicSiteUrl, type PublishUrlMode } from '@digimaestro/shared';
import type { PublishQueuePort, PublishSourcePort, TenantId } from '@digimaestro/shared';

export interface PublishRequestDeps {
  readonly source: PublishSourcePort;
  readonly queue: PublishQueuePort;
  // Domain induk situs klien (mis. 'digimaestro.id') → baseUrl + rootDomain job.
  readonly rootDomain: string;
  // Bentuk URL: subdomain (butuh UAPI) atau path (subfolder domain utama). Default subdomain.
  readonly urlMode?: PublishUrlMode;
}

export interface PublishRequest {
  readonly tenantId: TenantId;
  readonly websiteId: string;
  readonly revisionNumber: number;
}

export type PublishOutcome =
  | { readonly ok: true; readonly status: 202; readonly jobId: string; readonly url: string }
  | { readonly ok: false; readonly status: 404 | 500; readonly message: string };

export async function handlePublishRequest(deps: PublishRequestDeps, req: PublishRequest): Promise<PublishOutcome> {
  const src = await deps.source.getPublishSource(req.tenantId, {
    websiteId: req.websiteId,
    revisionNumber: req.revisionNumber,
  });
  if (!src.ok) return { ok: false, status: 500, message: src.error.message };
  if (!src.value) return { ok: false, status: 404, message: 'revisi tidak ditemukan' };

  const { slug, siteDocument, websiteId, revisionNumber, renderEngine } = src.value;
  const url = publicSiteUrl(slug, deps.rootDomain, deps.urlMode ?? 'subdomain');

  const enq = await deps.queue.enqueuePublish({
    tenantId: req.tenantId,
    websiteId,
    ...(deps.urlMode ? { urlMode: deps.urlMode } : {}),
    revisionNumber,
    slug,
    baseUrl: url,
    siteDocument,
    // P2 dual-mode: worker memilih perakit berkas dari sini (absen = sections-v1).
    ...(renderEngine ? { renderEngine } : {}),
    rootDomain: deps.rootDomain,
  });
  if (!enq.ok) return { ok: false, status: 500, message: enq.error.message };

  return { ok: true, status: 202, jobId: enq.value.jobId, url };
}
