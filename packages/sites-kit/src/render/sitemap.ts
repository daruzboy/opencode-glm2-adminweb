// packages/sites-kit/render — sitemap.xml & robots.txt (T-062, FR-SEO-001).
// Dihasilkan deterministik dari Site Document. sitemap butuh baseUrl absolut; robots
// menyesuaikan preview (noindex → blokir semua, tanpa sitemap) vs publish (izinkan + sitemap).

import type { SiteDocument } from '../site-document.js';
import { absoluteUrl } from './page.js';

function pagePath(slug: string): string {
  return slug === 'index' ? '/' : `/${slug}`;
}

// Escape 5 karakter yang wajib di-escape dalam XML.
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** sitemap.xml dengan URL absolut untuk setiap halaman. */
export function buildSitemap(doc: SiteDocument, baseUrl: string): string {
  const urls = doc.pages
    .map((p) => `<url><loc>${xmlEscape(absoluteUrl(baseUrl, pagePath(p.slug)))}</loc></url>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export interface RobotsOptions {
  readonly baseUrl?: string;
  readonly noindex?: boolean;
}

/** robots.txt. Preview (noindex) memblok semua crawler; publish mengizinkan + sitemap. */
export function buildRobots(options: RobotsOptions = {}): string {
  if (options.noindex) {
    return 'User-agent: *\nDisallow: /\n';
  }
  const lines = ['User-agent: *', 'Allow: /'];
  if (options.baseUrl) {
    lines.push(`Sitemap: ${absoluteUrl(options.baseUrl, '/sitemap.xml')}`);
  }
  return `${lines.join('\n')}\n`;
}
