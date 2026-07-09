import { describe, it, expect } from 'vitest';
import {
  SECTION_REGISTRY,
  SECTION_TYPES,
  MVP_SECTION_TYPES,
  sectionVariants,
  sectionSchema,
} from './sections.js';

describe('section registry (FR-CMP-001/002/005)', () => {
  it('menyediakan ≥12 tipe section', () => {
    expect(SECTION_TYPES.length).toBeGreaterThanOrEqual(12);
  });

  it('MVP mencakup ≥12 tipe dan semuanya terdaftar di registry (FR-CMP-001)', () => {
    expect(MVP_SECTION_TYPES.length).toBeGreaterThanOrEqual(12);
    for (const t of MVP_SECTION_TYPES) {
      expect(SECTION_TYPES).toContain(t);
    }
  });

  it('setiap tipe punya ≥2 varian layout (FR-CMP-002)', () => {
    for (const t of SECTION_TYPES) {
      expect(sectionVariants(t).length).toBeGreaterThanOrEqual(2);
      // varian unik per tipe
      expect(new Set(SECTION_REGISTRY[t].variants).size).toBe(SECTION_REGISTRY[t].variants.length);
    }
  });

  it('hero valid: type/variant/props sesuai skema', () => {
    const parsed = sectionSchema.safeParse({
      type: 'hero',
      variant: 'centered',
      props: { headline: 'Selamat datang di Warung Demo' },
    });
    expect(parsed.success).toBe(true);
  });

  it('menolak varian yang tak terdaftar untuk tipe (FR-CMP-002)', () => {
    const parsed = sectionSchema.safeParse({
      type: 'hero',
      variant: 'tidak-ada',
      props: { headline: 'x' },
    });
    expect(parsed.success).toBe(false);
  });

  it('menolak props tak valid (mis. faq tanpa items)', () => {
    const parsed = sectionSchema.safeParse({ type: 'faq', variant: 'accordion', props: {} });
    expect(parsed.success).toBe(false);
  });

  it('menolak tipe section tak dikenal', () => {
    const parsed = sectionSchema.safeParse({ type: 'banner-3d', variant: 'x', props: {} });
    expect(parsed.success).toBe(false);
  });
});
