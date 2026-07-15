// Preview PUBLIK (temuan uji nyata 2026-07-15): tautan /api/preview lama menunjuk VPS
// yang hanya terjangkau via tailnet — pelanggan tanpa VPN menatap timeout; dan endpoint
// itu tak punya renderer mobirise. Kini pratinjau = bundel situs UTUH (engine-aware,
// pipeline publish yang sama) diunggah ke folder tak-tertebak di domain publik:
// https://<rootDomain>/preview/<slug>-<token>/ (noindex).
//
// Satu folder pratinjau per WEBSITE (token deterministik) — pratinjau baru menimpa yang
// lama, pelanggan selalu melihat versi termutakhir, tak ada tumpukan folder yatim.

import { publicSiteUrl } from '@digimaestro/shared';
import type { PublishQueuePort, PublishSourcePort, TenantId } from '@digimaestro/shared';

export interface PreviewRequestDeps {
  readonly source: PublishSourcePort;
  readonly queue: PublishQueuePort;
  readonly rootDomain: string;
  // Token folder pratinjau per website — HMAC(secret, websiteId) di composition root.
  // Absen → potongan websiteId (cuid, sudah tak tertebak; hanya "membocorkan" id internal).
  readonly previewToken?: (websiteId: string) => string;
}

export interface PreviewRequest {
  readonly tenantId: TenantId;
  readonly websiteId: string;
  readonly revisionNumber: number;
}

export type PreviewOutcome =
  | { readonly ok: true; readonly jobId: string; readonly url: string }
  | { readonly ok: false; readonly message: string };

export function previewSlug(slug: string, websiteId: string, token?: (id: string) => string): string {
  const t = token ? token(websiteId) : websiteId.slice(-12);
  return `preview/${slug}-${t}`;
}

export async function requestPreview(
  deps: PreviewRequestDeps,
  req: PreviewRequest,
): Promise<PreviewOutcome> {
  const src = await deps.source.getPublishSource(req.tenantId, {
    websiteId: req.websiteId,
    revisionNumber: req.revisionNumber,
  });
  if (!src.ok) return { ok: false, message: src.error.message };
  if (!src.value) return { ok: false, message: 'revisi tidak ditemukan' };

  const { slug, siteDocument, websiteId, revisionNumber, renderEngine } = src.value;
  const dir = previewSlug(slug, websiteId, deps.previewToken);
  // Pratinjau SELALU path-mode: subfolder domain utama langsung ber-HTTPS tanpa
  // provisioning apa pun (alasan yang sama dengan ADR-13).
  const url = publicSiteUrl(dir, deps.rootDomain, 'path');

  const enq = await deps.queue.enqueuePublish({
    tenantId: req.tenantId,
    websiteId,
    revisionNumber,
    slug: dir,
    baseUrl: url,
    siteDocument,
    urlMode: 'path',
    mode: 'preview',
    ...(renderEngine ? { renderEngine } : {}),
    rootDomain: deps.rootDomain,
  });
  if (!enq.ok) return { ok: false, message: enq.error.message };

  return { ok: true, jobId: enq.value.jobId, url };
}
