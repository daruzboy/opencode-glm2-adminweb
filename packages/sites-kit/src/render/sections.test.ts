import { describe, it, expect } from 'vitest';
import { sectionSchema, SECTION_TYPES, SECTION_REGISTRY } from '../sections.js';
import { renderSection } from './sections.js';

function section(input: unknown) {
  return sectionSchema.parse(input);
}

describe('renderSection (FR-CMP-004)', () => {
  it('hero: heading, subheadline, cta ter-render dalam wrapper berkelas varian', () => {
    const html = renderSection(
      section({ type: 'hero', variant: 'centered', props: { headline: 'Halo', subheadline: 'Sub', cta: { label: 'Pesan', href: '/pesan' } } }),
    );
    expect(html).toContain('dm-section dm-hero dm-hero--centered');
    expect(html).toContain('<h1>Halo</h1>');
    expect(html).toContain('Sub');
    expect(html).toContain('href="/pesan"');
    expect(html).toContain('>Pesan</a>');
  });

  it('meng-escape konten dari klien (anti-XSS)', () => {
    const html = renderSection(
      section({ type: 'hero', variant: 'split', props: { headline: '<img src=x onerror=alert(1)>' } }),
    );
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('memblok href berbahaya via safeUrl', () => {
    const html = renderSection(
      section({ type: 'cta-banner', variant: 'centered', props: { headline: 'Aksi', cta: { label: 'Klik', href: 'javascript:alert(1)' } } }),
    );
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });

  it('faq: memakai <details>/<summary> (zero-JS)', () => {
    const html = renderSection(
      section({ type: 'faq', variant: 'accordion', props: { items: [{ question: 'Q?', answer: 'A.' }] } }),
    );
    expect(html).toContain('<details><summary>Q?</summary>');
  });

  it('product-grid: harga & nama produk ter-render', () => {
    const html = renderSection(
      section({ type: 'product-grid', variant: 'grid-3', props: { title: 'Menu', products: [{ name: 'Kopi', price: 'Rp10.000' }] } }),
    );
    expect(html).toContain('Kopi');
    expect(html).toContain('Rp10.000');
  });

  it('setiap tipe section merender HTML non-kosong tanpa lempar error', () => {
    // fixture minimal valid per tipe via nilai default sederhana
    const fixtures: Record<string, unknown> = {
      hero: { headline: 'H' },
      about: { title: 'T', body: 'B' },
      services: { title: 'T', items: [{ name: 'X' }] },
      'product-grid': { title: 'T', products: [{ name: 'P' }] },
      gallery: { images: [{ assetId: 'a1', alt: 'alt' }] },
      testimonials: { items: [{ quote: 'q', author: 'a' }] },
      features: { title: 'T', items: [{ title: 'F' }] },
      'cta-banner': { headline: 'H', cta: { label: 'L', href: '/x' } },
      faq: { items: [{ question: 'Q', answer: 'A' }] },
      'contact-map': { address: 'Jl. Mawar', phone: '0812', email: 'a@b.com', mapQuery: 'Jakarta' },
      catalog: { categories: [{ name: 'C', items: [{ name: 'I' }] }] },
      'article-list': { articles: [{ title: 'Judul', href: '/artikel' }] },
      footer: { businessName: 'Warung', links: [{ label: 'Home', href: '/' }] },
    };
    for (const type of SECTION_TYPES) {
      const variant = SECTION_REGISTRY[type].variants[0];
      const html = renderSection(section({ type, variant, props: fixtures[type] }));
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain(`dm-${type}--${variant}`);
    }
  });
});

// T-033 — BUG NYATA (ditemukan dengan membuka halaman live, bukan dari tes): foto pelanggan
// dititipkan ke `assetId`, lalu renderer memetakannya ke `/_assets/<encodeURIComponent(...)>`
// → URL ter-encode ganda (`https%3A%2F%2F...`) dan <img> menunjuk alamat 404. Gambarnya sehat,
// HTML-nya yang salah.
describe('render image — URL absolut foto pelanggan (T-033)', () => {
  it('url absolut dipakai APA ADANYA (tidak di-encode sebagai segmen path)', () => {
    const url = 'https://digimaestro.id/media/t1/abc123.webp';
    const html = renderSection({
      type: 'gallery',
      variant: 'masonry',
      props: { images: [{ url, alt: 'Sate ayam' }] },
    } as never);

    expect(html).toContain(`src="${url}"`);
    expect(html).not.toContain('%2F'); // inti bug-nya
    expect(html).not.toContain('/_assets/https');
  });

  it('assetId (aset internal) tetap dipetakan ke /_assets/', () => {
    const html = renderSection({
      type: 'gallery',
      variant: 'masonry',
      props: { images: [{ assetId: 'logo-warung', alt: 'Logo' }] },
    } as never);

    expect(html).toContain('/_assets/logo-warung');
  });

  // safeUrl tetap menjaga anti-XSS meski kini menerima URL absolut.
  it('skema berbahaya di url → disaring (anti-XSS)', () => {
    const html = renderSection({
      type: 'gallery',
      variant: 'masonry',
      props: { images: [{ url: 'javascript:alert(1)', alt: 'x' }] },
    } as never);

    expect(html).not.toContain('javascript:');
  });
});
