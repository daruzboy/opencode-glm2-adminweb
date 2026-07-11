import { describe, it, expect } from 'vitest';
import { THEMES } from './design-tokens.js';
import { parseSiteDocument, isSiteDocument, siteDocumentSchema, siteDraftSchema, assembleSiteDocument, type SiteDocument } from './site-document.js';
import { THEME_IDS } from './design-tokens.js';

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

// T-053g — bug ditemukan saat uji bot NYATA: siteDocumentSchema utuh dipakai sebagai target
// output LLM, padahal LLM tak mungkin tahu websiteId (id DB kita) dan design token harus
// deterministik dari tema. Validasi SELALU gagal → situs tak pernah terbangun.
describe('assembleSiteDocument — draft LLM → Site Document sah', () => {
  const draft = {
    title: 'Sate Pak Dar',
    themeId: THEME_IDS[0],
    pages: [
      { slug: 'index', title: 'Beranda', sections: [{ type: 'hero', variant: 'centered', props: { headline: 'Sate Pak Dar', subheadline: 'Sate ayam & kambing khas Bandung' } }] },
    ],
  };

  it('draft + websiteId → dokumen LOLOS siteDocumentSchema', () => {
    const doc = assembleSiteDocument(draft, 'w-123');
    const parsed = parseSiteDocument(doc);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // websiteId dari KITA (bukan karangan LLM), token dari tema (bukan warna karangan).
      expect(parsed.value.websiteId).toBe('w-123');
      expect(parsed.value.tokens.colors.primary).toMatch(/^#/);
    }
  });

  // Satu halusinasi themeId tak boleh menggagalkan seluruh build.
  it('themeId tak dikenal → jatuh ke tema default, dokumen tetap sah', () => {
    const doc = assembleSiteDocument({ ...draft, themeId: 'tema-karangan-llm' }, 'w-1');
    const parsed = parseSiteDocument(doc);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(THEME_IDS).toContain(parsed.value.themeId);
  });

  it('draft yang sah lolos siteDraftSchema (tanpa websiteId/tokens)', () => {
    expect(siteDraftSchema.safeParse(draft).success).toBe(true);
  });
})
