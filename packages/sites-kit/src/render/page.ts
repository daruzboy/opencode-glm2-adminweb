// packages/sites-kit/render — render halaman & situs penuh (T-061, FR-CMP-004, FR-SEO-001/002).
// Output = dokumen HTML5 statis zero-JS (ADR-3): head lengkap (title unik, meta description,
// canonical, OG), CSS token, JSON-LD; body = section ter-render. Deterministik.

import type { Page, SiteDocument } from '../site-document.js';
import { escapeAttr, escapeHtml } from './escape.js';
import { renderStyles } from './tokens-css.js';
import { renderSection } from './sections.js';
import { buildJsonLd, renderJsonLd } from './json-ld.js';

function pagePath(slug: string): string {
  return slug === 'index' ? '/' : `/${slug}`;
}

function pageTitle(doc: SiteDocument, page: Page): string {
  return page.slug === 'index' ? doc.title : `${page.title} — ${doc.title}`;
}

/** Render satu halaman menjadi dokumen HTML lengkap. */
export function renderPage(doc: SiteDocument, page: Page): string {
  const title = pageTitle(doc, page);
  const canonical = pagePath(page.slug);
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    page.metaDescription ? `<meta name="description" content="${escapeAttr(page.metaDescription)}">` : '',
    `<link rel="canonical" href="${escapeAttr(canonical)}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    '<meta property="og:type" content="website">',
    renderStyles(doc.tokens),
    renderJsonLd(buildJsonLd(doc, page)),
  ].join('');

  const body = `<main>${page.sections.map((s) => renderSection(s)).join('')}</main>`;

  return `<!doctype html><html lang="id"><head>${head}</head><body>${body}</body></html>`;
}

export interface RenderedPage {
  readonly slug: string;
  /** Path file relatif untuk artifact statis (URL bersih). */
  readonly path: string;
  readonly html: string;
}

/** Render seluruh situs menjadi daftar file HTML statis siap-deploy. */
export function renderSite(doc: SiteDocument): readonly RenderedPage[] {
  return doc.pages.map((page) => ({
    slug: page.slug,
    path: page.slug === 'index' ? 'index.html' : `${page.slug}/index.html`,
    html: renderPage(doc, page),
  }));
}
