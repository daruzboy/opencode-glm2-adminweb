import { describe, it, expect } from 'vitest';
import { THEMES } from '../design-tokens.js';
import { siteDocumentSchema, type SiteDocument } from '../site-document.js';
import { buildJsonLd, renderJsonLd } from './json-ld.js';

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
        sections: [
          { type: 'product-grid', variant: 'grid-3', props: { title: 'Menu', products: [{ name: 'Kopi', price: 'Rp10.000' }] } },
          { type: 'faq', variant: 'accordion', props: { items: [{ question: 'Buka jam berapa?', answer: 'Jam 8.' }] } },
          { type: 'contact-map', variant: 'map-right', props: { address: 'Jl. Mawar 1', phone: '0812' } },
          { type: 'footer', variant: 'simple', props: { businessName: 'Warung Demo' } },
        ],
      },
      { slug: 'tentang', title: 'Tentang', sections: [{ type: 'about', variant: 'text', props: { title: 'Kami', body: 'Halo' } }] },
    ],
  });
}

describe('JSON-LD (FR-SEO-002)', () => {
  it('halaman root: LocalBusiness dgn nama+kontak, FAQPage, Product ItemList', () => {
    const d = doc();
    const nodes = buildJsonLd(d, d.pages[0]);
    const types = nodes.map((n) => n['@type']);
    expect(types).toContain('LocalBusiness');
    expect(types).toContain('FAQPage');
    expect(types).toContain('ItemList');
    const lb = nodes.find((n) => n['@type'] === 'LocalBusiness');
    expect(lb?.name).toBe('Warung Demo');
    expect(lb?.telephone).toBe('0812');
  });

  it('halaman non-root: BreadcrumbList, tanpa LocalBusiness (hindari duplikasi)', () => {
    const d = doc();
    const nodes = buildJsonLd(d, d.pages[1]);
    const types = nodes.map((n) => n['@type']);
    expect(types).toContain('BreadcrumbList');
    expect(types).not.toContain('LocalBusiness');
  });

  it('renderJsonLd membungkus <script type=application/ld+json> & escape <', () => {
    const html = renderJsonLd([{ '@type': 'Thing', name: '</script><x>' }]);
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).not.toContain('</script><x>');
    expect(html).toContain('\\u003c');
  });
});
