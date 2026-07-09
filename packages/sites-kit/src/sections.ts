// packages/sites-kit — Registry section + skema properti Zod (T-060, FR-CMP-001/002/004/005).
// Kontrak: setiap tipe section punya skema properti (Zod) + ≥2 varian layout. Registry ini
// adalah SATU sumber kebenaran; menambah tipe section = tambah entri di sini (open/closed,
// FR-CMP-005) — engine agent (core) TIDAK berubah, ia hanya membaca skema/registry.
// Props hanya berisi KONTEN; styling mengacu design token tema (lihat design-tokens.ts).

import { z } from 'zod';

// ── Fragmen properti yang dipakai ulang ──────────────────────────────────────
const ctaSchema = z.object({
  label: z.string().min(1).max(60),
  href: z.string().min(1),
});

// Referensi aset tenant (bukan URL lepas) — media dikelola per tenant (FR-MED-*).
const imageRefSchema = z.object({
  assetId: z.string().min(1),
  alt: z.string().min(1).max(160),
});

const linkSchema = z.object({
  label: z.string().min(1).max(60),
  href: z.string().min(1),
});

// ── Skema properti per tipe section ──────────────────────────────────────────
const heroProps = z.object({
  headline: z.string().min(1).max(120),
  subheadline: z.string().max(240).optional(),
  cta: ctaSchema.optional(),
  image: imageRefSchema.optional(),
});

const aboutProps = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
  image: imageRefSchema.optional(),
});

const servicesProps = z.object({
  title: z.string().min(1).max(120),
  items: z
    .array(z.object({ name: z.string().min(1).max(80), description: z.string().max(300).optional() }))
    .min(1)
    .max(12),
});

const productGridProps = z.object({
  title: z.string().min(1).max(120),
  products: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        price: z.string().max(40).optional(),
        image: imageRefSchema.optional(),
        href: z.string().optional(),
      }),
    )
    .min(1)
    .max(24),
});

const galleryProps = z.object({
  title: z.string().max(120).optional(),
  images: z.array(imageRefSchema).min(1).max(24),
});

const testimonialsProps = z.object({
  title: z.string().max(120).optional(),
  items: z
    .array(
      z.object({
        quote: z.string().min(1).max(400),
        author: z.string().min(1).max(80),
        role: z.string().max(80).optional(),
      }),
    )
    .min(1)
    .max(12),
});

const featuresProps = z.object({
  title: z.string().min(1).max(120),
  items: z
    .array(z.object({ title: z.string().min(1).max(80), description: z.string().max(300).optional() }))
    .min(1)
    .max(12),
});

const ctaBannerProps = z.object({
  headline: z.string().min(1).max(160),
  cta: ctaSchema,
});

const faqProps = z.object({
  title: z.string().max(120).optional(),
  items: z
    .array(z.object({ question: z.string().min(1).max(200), answer: z.string().min(1).max(1000) }))
    .min(1)
    .max(30),
});

const contactMapProps = z.object({
  title: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(120).optional(),
  mapQuery: z.string().max(300).optional(),
});

const catalogProps = z.object({
  title: z.string().max(120).optional(),
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        items: z
          .array(z.object({ name: z.string().min(1).max(120), price: z.string().max(40).optional() }))
          .min(1)
          .max(50),
      }),
    )
    .min(1)
    .max(20),
});

const articleListProps = z.object({
  title: z.string().max(120).optional(),
  articles: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        excerpt: z.string().max(300).optional(),
        href: z.string().min(1),
      }),
    )
    .min(1)
    .max(24),
});

const footerProps = z.object({
  businessName: z.string().min(1).max(120),
  links: z.array(linkSchema).max(20).optional(),
  socials: z
    .array(z.object({ platform: z.string().min(1).max(40), href: z.string().min(1) }))
    .max(10)
    .optional(),
});

// ── Registry (open/closed) ───────────────────────────────────────────────────
// `as const` menjaga tuple varian tetap literal. Setiap entri: label UI, ≥2 varian, props.
export const SECTION_REGISTRY = {
  hero: { label: 'Hero', variants: ['centered', 'split', 'overlay'], props: heroProps },
  about: { label: 'Tentang Kami', variants: ['text', 'image-left'], props: aboutProps },
  services: { label: 'Layanan', variants: ['grid', 'list'], props: servicesProps },
  'product-grid': { label: 'Produk Grid', variants: ['grid-3', 'grid-4'], props: productGridProps },
  gallery: { label: 'Galeri', variants: ['masonry', 'carousel'], props: galleryProps },
  testimonials: { label: 'Testimoni', variants: ['cards', 'single'], props: testimonialsProps },
  features: { label: 'Keunggulan', variants: ['grid', 'alternating'], props: featuresProps },
  'cta-banner': { label: 'CTA Banner', variants: ['centered', 'split'], props: ctaBannerProps },
  faq: { label: 'FAQ', variants: ['accordion', 'two-column'], props: faqProps },
  'contact-map': { label: 'Kontak + Peta', variants: ['map-right', 'map-full'], props: contactMapProps },
  catalog: { label: 'Katalog', variants: ['tabs', 'sections'], props: catalogProps },
  'article-list': { label: 'Daftar Artikel', variants: ['cards', 'list'], props: articleListProps },
  footer: { label: 'Footer', variants: ['simple', 'columns'], props: footerProps },
} as const;

export type SectionType = keyof typeof SECTION_REGISTRY;

export const SECTION_TYPES = Object.keys(SECTION_REGISTRY) as SectionType[];

// 12 tipe MVP wajib (FR-CMP-001) — subset yang dijamin tayang di rilis awal.
export const MVP_SECTION_TYPES: readonly SectionType[] = Object.freeze([
  'hero',
  'about',
  'services',
  'product-grid',
  'gallery',
  'testimonials',
  'features',
  'cta-banner',
  'faq',
  'contact-map',
  'catalog',
  'footer',
]);

export function sectionVariants(type: SectionType): readonly string[] {
  return SECTION_REGISTRY[type].variants;
}

// ── Skema section (discriminated union) ──────────────────────────────────────
// Anggota di-inline (bukan via helper generik) agar zod mengkorelasikan type↔props
// sehingga narrowing `switch (section.type)` mempersempit `section.props` dgn benar.
// Varian tetap bersumber dari registry (single source).
export const sectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hero'), variant: z.enum(SECTION_REGISTRY.hero.variants), props: heroProps }),
  z.object({ type: z.literal('about'), variant: z.enum(SECTION_REGISTRY.about.variants), props: aboutProps }),
  z.object({ type: z.literal('services'), variant: z.enum(SECTION_REGISTRY.services.variants), props: servicesProps }),
  z.object({ type: z.literal('product-grid'), variant: z.enum(SECTION_REGISTRY['product-grid'].variants), props: productGridProps }),
  z.object({ type: z.literal('gallery'), variant: z.enum(SECTION_REGISTRY.gallery.variants), props: galleryProps }),
  z.object({ type: z.literal('testimonials'), variant: z.enum(SECTION_REGISTRY.testimonials.variants), props: testimonialsProps }),
  z.object({ type: z.literal('features'), variant: z.enum(SECTION_REGISTRY.features.variants), props: featuresProps }),
  z.object({ type: z.literal('cta-banner'), variant: z.enum(SECTION_REGISTRY['cta-banner'].variants), props: ctaBannerProps }),
  z.object({ type: z.literal('faq'), variant: z.enum(SECTION_REGISTRY.faq.variants), props: faqProps }),
  z.object({ type: z.literal('contact-map'), variant: z.enum(SECTION_REGISTRY['contact-map'].variants), props: contactMapProps }),
  z.object({ type: z.literal('catalog'), variant: z.enum(SECTION_REGISTRY.catalog.variants), props: catalogProps }),
  z.object({ type: z.literal('article-list'), variant: z.enum(SECTION_REGISTRY['article-list'].variants), props: articleListProps }),
  z.object({ type: z.literal('footer'), variant: z.enum(SECTION_REGISTRY.footer.variants), props: footerProps }),
]);

export type Section = z.infer<typeof sectionSchema>;
