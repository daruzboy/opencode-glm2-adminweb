import { describe, it, expect } from 'vitest';
import { THEMES } from './design-tokens.js';
import { parseSiteDocument, isSiteDocument, siteDocumentSchema, type SiteDocument } from './site-document.js';

function validDoc(): SiteDocument {
  return {
    websiteId: 'w-123',
    title: 'Warung Demo',
    themeId: 'umkm-fresh',
    tokens: THEMES[0].tokens,
    pages: [
      {
        slug: 'index',
        title: 'Beranda',
        sections: [
          { type: 'hero', variant: 'centered', props: { headline: 'Warung Demo — masakan rumahan' } },
          {
            type: 'services',
            variant: 'grid',
            props: { title: 'Menu', items: [{ name: 'Nasi Goreng' }, { name: 'Mie Ayam' }] },
          },
          { type: 'footer', variant: 'simple', props: { businessName: 'Warung Demo' } },
        ],
      },
      { slug: 'kontak', title: 'Kontak', sections: [{ type: 'contact-map', variant: 'map-right', props: {} }] },
    ],
  };
}

describe('Site Document (FR-CMP-004)', () => {
  it('memvalidasi dokumen lengkap yang benar', () => {
    const res = parseSiteDocument(validDoc());
    expect(res.ok).toBe(true);
    expect(isSiteDocument(validDoc())).toBe(true);
  });

  it('menolak dokumen tanpa halaman', () => {
    const doc = { ...validDoc(), pages: [] };
    const res = parseSiteDocument(doc);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.length).toBeGreaterThan(0);
  });

  it('menolak slug halaman duplikat', () => {
    const base = validDoc();
    const doc = { ...base, pages: [base.pages[0], { ...base.pages[0] }] };
    const res = parseSiteDocument(doc);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.join(' ')).toMatch(/unik/i);
  });

  it('menolak slug bukan kebab-case', () => {
    const base = validDoc();
    const doc = { ...base, pages: [{ ...base.pages[0], slug: 'Tentang Kami' }] };
    expect(parseSiteDocument(doc).ok).toBe(false);
  });

  it('menolak section dengan props salah di dalam halaman', () => {
    const base = validDoc();
    const doc = {
      ...base,
      pages: [{ slug: 'index', title: 'Beranda', sections: [{ type: 'hero', variant: 'centered', props: {} }] }],
    };
    expect(parseSiteDocument(doc).ok).toBe(false);
  });

  it('parseSiteDocument mengembalikan issue berlabel path', () => {
    const res = parseSiteDocument({ websiteId: 'w', title: 't', themeId: 'x', tokens: {}, pages: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.some((m) => m.includes(':'))).toBe(true);
    }
  });

  it('schema tereskpor konsisten dengan helper', () => {
    expect(siteDocumentSchema.safeParse(validDoc()).success).toBe(true);
  });
});
