import { describe, it, expect } from 'vitest';
import { THEMES } from '../design-tokens.js';
import { siteDocumentSchema, type SiteDocument } from '../site-document.js';
import { renderPage, renderSite } from './page.js';

function doc(): SiteDocument {
  return siteDocumentSchema.parse({
    websiteId: 'w1',
    title: 'Warung Demo',
    themeId: 'umkm-fresh',
    tokens: THEMES[0].tokens,
    pages: [
      {
        slug: 'index',
        title: 'Beranda',
        metaDescription: 'Warung masakan rumahan',
        sections: [
          { type: 'hero', variant: 'centered', props: { headline: 'Selamat datang' } },
          { type: 'footer', variant: 'simple', props: { businessName: 'Warung Demo' } },
        ],
      },
      {
        slug: 'kontak',
        title: 'Kontak',
        sections: [{ type: 'contact-map', variant: 'map-right', props: { address: 'Jl. Mawar' } }],
      },
    ],
  });
}

describe('renderPage / renderSite (FR-CMP-004, FR-SEO-001)', () => {
  it('menghasilkan dokumen HTML5 lengkap lang=id dengan head SEO', () => {
    const d = doc();
    const html = renderPage(d, d.pages[0]);
    expect(html.startsWith('<!doctype html><html lang="id">')).toBe(true);
    expect(html).toContain('<title>Warung Demo</title>');
    expect(html).toContain('<meta name="description" content="Warung masakan rumahan">');
    expect(html).toContain('<link rel="canonical" href="/">');
    expect(html).toContain('<style>');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('<main>');
    expect(html).toContain('Selamat datang');
  });

  it('title unik per halaman & canonical per slug', () => {
    const d = doc();
    const kontak = renderPage(d, d.pages[1]);
    expect(kontak).toContain('<title>Kontak — Warung Demo</title>');
    expect(kontak).toContain('<link rel="canonical" href="/kontak">');
  });

  it('zero-JS: satu-satunya <script> adalah JSON-LD', () => {
    const d = doc();
    const html = renderPage(d, d.pages[0]);
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((s) => s.includes('application/ld+json'))).toBe(true);
  });

  it('renderSite memetakan setiap halaman ke path artifact URL bersih', () => {
    const files = renderSite(doc());
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['index.html', 'kontak/index.html']);
    expect(files.every((f) => f.html.includes('<!doctype html>'))).toBe(true);
  });

  it('deterministik: render dua kali identik', () => {
    const d = doc();
    expect(renderPage(d, d.pages[0])).toBe(renderPage(d, d.pages[0]));
  });
});
