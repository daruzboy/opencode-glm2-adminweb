// Use case preview draft (T-064, FR-PUB-001). Bergantung hanya pada Port `PreviewPort`
// + renderer sites-kit → diuji dengan fake tanpa DB. Selalu noindex; token salah/revisi
// tak ada = 404 (tak membocorkan keberadaan). Site Document divalidasi sebelum render.

import type { PreviewPort } from '@digimaestro/shared';
import { parseSiteDocument, renderPage } from '@digimaestro/sites-kit';

export interface PreviewDeps {
  readonly preview: PreviewPort;
}

export interface PreviewRequest {
  readonly revisionId: string;
  readonly token: string;
  // Slug halaman opsional; default halaman 'index' (atau halaman pertama).
  readonly slug?: string;
}

export type PreviewOutcome =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly status: 404 | 500; readonly message: string };

const NOT_FOUND: PreviewOutcome = { ok: false, status: 404, message: 'preview tidak ditemukan' };

export async function handlePreview(deps: PreviewDeps, req: PreviewRequest): Promise<PreviewOutcome> {
  if (req.token.trim() === '') return NOT_FOUND;

  const found = await deps.preview.getPreview({ revisionId: req.revisionId, token: req.token });
  if (!found.ok) return { ok: false, status: 500, message: found.error.message };
  if (!found.value) return NOT_FOUND;

  const parsed = parseSiteDocument(found.value.siteDocument);
  if (!parsed.ok) {
    return { ok: false, status: 500, message: `dokumen situs revisi tidak valid: ${parsed.issues[0] ?? 'unknown'}` };
  }

  const doc = parsed.value;
  const page = doc.pages.find((p) => p.slug === (req.slug ?? 'index')) ?? doc.pages[0];
  // doc tervalidasi (pages.min(1)), tapi jaga tetap eksplisit untuk type-safety.
  if (!page) return { ok: false, status: 500, message: 'revisi tidak memiliki halaman' };
  const html = renderPage(doc, page, { noindex: true });
  return { ok: true, html };
}
