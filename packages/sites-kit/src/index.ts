// packages/sites-kit — library komponen Astro + tema + skema Zod (SRS §2, FRD 3.4 CMP).
// Komponen Astro & dependensi (astro, @astrojs/*, zod, tailwind) ditambahkan saat T-060.
// Di sini disimpan model tipe section & design token yang netral framework.

export type SectionType =
  | 'hero'
  | 'about'
  | 'services'
  | 'product-grid'
  | 'gallery'
  | 'testimonials'
  | 'features'
  | 'cta-banner'
  | 'faq'
  | 'contact-map'
  | 'catalog'
  | 'article-list'
  | 'footer';

export interface SectionSchema {
  readonly type: SectionType;
  readonly variant: string;
}

export interface DesignTokens {
  readonly colors: Record<string, string>;
  readonly radius: string;
  readonly spacing: string;
}

export const MVP_SECTION_TYPES: readonly SectionType[] = Object.freeze([
  'hero',
  'about',
  'services',
  'gallery',
  'testimonials',
  'contact-map',
]);
