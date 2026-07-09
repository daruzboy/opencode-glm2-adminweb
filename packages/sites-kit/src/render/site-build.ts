// packages/sites-kit/render — rakit artifact statis siap-deploy (T-062, SRS §8, FR-SEO-001).
// Site Document → daftar file (HTML per halaman + sitemap.xml + robots.txt). Murni &
// deterministik; worker menulis/mengunggah hasilnya ke object storage → shared hosting.

import type { SiteDocument } from '../site-document.js';
import { renderSite, type RenderOptions } from './page.js';
import { buildSitemap, buildRobots } from './sitemap.js';

export interface StaticFile {
  readonly path: string;
  readonly contents: string;
  readonly contentType: string;
}

/** Rakit seluruh artifact statis situs. */
export function buildStaticSite(doc: SiteDocument, options: RenderOptions = {}): readonly StaticFile[] {
  const files: StaticFile[] = renderSite(doc, options).map((p) => ({
    path: p.path,
    contents: p.html,
    contentType: 'text/html; charset=utf-8',
  }));

  // sitemap hanya untuk situs terindeks (publish) dengan baseUrl absolut.
  if (options.baseUrl && !options.noindex) {
    files.push({
      path: 'sitemap.xml',
      contents: buildSitemap(doc, options.baseUrl),
      contentType: 'application/xml; charset=utf-8',
    });
  }

  files.push({
    path: 'robots.txt',
    contents: buildRobots({ baseUrl: options.baseUrl, noindex: options.noindex }),
    contentType: 'text/plain; charset=utf-8',
  });

  return files;
}
