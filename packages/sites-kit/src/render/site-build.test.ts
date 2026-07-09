import { describe, it, expect } from 'vitest';
import { THEMES } from '../design-tokens.js';
import { siteDocumentSchema, type SiteDocument } from '../site-document.js';
import { buildSitemap, buildRobots } from './sitemap.js';
import { buildStaticSite } from './site-build.js';
import { renderPage } from './page.js';

function doc(): SiteDocument {
  return siteDocumentSchema.parse({
    websiteId: 'w1',
    title: 'Warung Demo',
    themeId: 'umkm-fresh',
    tokens: THEMES[0].tokens,
    pages: [
      { slug: 'index', title: 'Beranda', sections: [{ type: 'hero', variant: 'centered', props: { headline: 'Hai' } }] },
      { slug: 'kontak', title: 'Kontak', sections: [{ type: 'contact-map', variant: 'map-full', props: { address: 'Jl. A' } }] },
    ],
  });
}

const BASE = 'https://warung.digimaestro.id';

describe('sitemap & robots (FR-SEO-001)', () => {
  it('sitemap.xml memuat URL absolut tiap halaman', () => {
    const xml = buildSitemap(doc(), BASE);
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain(`<loc>${BASE}/</loc>`);
    expect(xml).toContain(`<loc>${BASE}/kontak</loc>`);
  });

  it('robots publish mengizinkan + referensi sitemap', () => {
    const txt = buildRobots({ baseUrl: BASE });
    expect(txt).toContain('Allow: /');
    expect(txt).toContain(`Sitemap: ${BASE}/sitemap.xml`);
  });

  it('robots preview (noindex) memblok semua & tanpa sitemap', () => {
    const txt = buildRobots({ baseUrl: BASE, noindex: true });
    expect(txt).toContain('Disallow: /');
    expect(txt).not.toContain('Sitemap:');
  });
});

describe('buildStaticSite (SRS §8 artifact)', () => {
  it('publish: html tiap halaman + sitemap.xml + robots.txt', () => {
    const files = buildStaticSite(doc(), { baseUrl: BASE });
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['index.html', 'kontak/index.html', 'robots.txt', 'sitemap.xml']);
    const robots = files.find((f) => f.path === 'robots.txt');
    expect(robots?.contentType).toContain('text/plain');
    expect(robots?.contents).toContain('Allow: /');
  });

  it('preview (noindex): tanpa sitemap, robots blokir, halaman ber-meta noindex', () => {
    const files = buildStaticSite(doc(), { baseUrl: BASE, noindex: true });
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('sitemap.xml');
    expect(files.find((f) => f.path === 'robots.txt')?.contents).toContain('Disallow: /');
    expect(files.find((f) => f.path === 'index.html')?.contents).toContain('name="robots" content="noindex,nofollow"');
  });

  it('tanpa baseUrl: tetap ada robots (relatif), tanpa sitemap', () => {
    const files = buildStaticSite(doc());
    const paths = files.map((f) => f.path);
    expect(paths).toContain('robots.txt');
    expect(paths).not.toContain('sitemap.xml');
  });

  it('baseUrl membuat canonical & og:url absolut', () => {
    const d = doc();
    const html = renderPage(d, d.pages[1], { baseUrl: BASE });
    expect(html).toContain(`<link rel="canonical" href="${BASE}/kontak">`);
    expect(html).toContain(`<meta property="og:url" content="${BASE}/kontak">`);
  });
});
