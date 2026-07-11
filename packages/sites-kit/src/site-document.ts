// packages/sites-kit — Site Document: model situs terstruktur (T-060, FR-CMP-004).
// Website → Pages → Sections (tipe, varian, props) + tema/token. Dapat dirender
// deterministik oleh renderer (Astro/React) di slice berikutnya (SRS §8, glosarium
// "Site Document"). Disimpan sebagai JSONB (Prisma) dan snapshot immutable = Revision.

import { z } from 'zod';
import { designTokensSchema, findTheme, THEMES } from './design-tokens.js';
import { sectionSchema } from './sections.js';

// Slug halaman: huruf kecil, angka, strip; '' = root/beranda diizinkan lewat 'index'.
const pageSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug harus kebab-case (a-z, 0-9, strip)');

export const pageSchema = z.object({
  slug: pageSlugSchema,
  title: z.string().min(1).max(160),
  // SEO per halaman (FR-SEO-*): opsional di sini, diperkaya slice SEO.
  metaDescription: z.string().max(320).optional(),
  sections: z.array(sectionSchema).min(1).max(30),
});

export type Page = z.infer<typeof pageSchema>;

export const siteDocumentSchema = z
  .object({
    websiteId: z.string().min(1),
    title: z.string().min(1).max(160),
    // Tema terpilih + token teresolusi (styling hanya via token, FR-CMP-003).
    themeId: z.string().min(1),
    tokens: designTokensSchema,
    pages: z.array(pageSchema).min(1).max(50),
  })
  // Slug halaman wajib unik dalam satu situs.
  .refine(
    (doc) => new Set(doc.pages.map((p) => p.slug)).size === doc.pages.length,
    { message: 'slug halaman harus unik dalam satu situs', path: ['pages'] },
  );

export type SiteDocument = z.infer<typeof siteDocumentSchema>;

// ── Draft LLM (T-053g) ────────────────────────────────────────────────────────
// Bagian Site Document yang BOLEH dikarang LLM: judul, pilihan tema, dan isi halaman.
//
// `websiteId` & `tokens` SENGAJA TIDAK di sini. Sebelumnya siteDocumentSchema utuh
// dipakai sebagai target output LLM — padahal LLM tak mungkin tahu websiteId (itu id DB
// kita), dan design token harus deterministik dari tema (FR-CMP-003: styling hanya via
// token), bukan warna karangan model. Akibatnya validasi SELALU gagal dan situs tak
// pernah bisa dibangun. Keduanya kini diisi kode saat merakit dokumen final.
export const siteDraftSchema = z
  .object({
    title: z.string().min(1).max(160),
    themeId: z.string().min(1),
    pages: z.array(pageSchema).min(1).max(50),
  })
  .refine((d) => new Set(d.pages.map((p) => p.slug)).size === d.pages.length, {
    message: 'slug halaman harus unik dalam satu situs',
    path: ['pages'],
  });

export type SiteDraft = z.infer<typeof siteDraftSchema>;

export type SiteDocumentParseResult =
  | { readonly ok: true; readonly value: SiteDocument }
  | { readonly ok: false; readonly issues: readonly string[] };

// Validasi tepi: kembalikan Result ringkas (pesan issue siap-tampil) alih-alih throw,
// selaras konvensi Result<T,E> proyek tanpa menarik dependency @digimaestro/shared.
export function parseSiteDocument(input: unknown): SiteDocumentParseResult {
  const result = siteDocumentSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues.map((i) => {
    const path = i.path.join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
  return { ok: false, issues };
}

export function isSiteDocument(input: unknown): input is SiteDocument {
  return siteDocumentSchema.safeParse(input).success;
}

// T-053g: rakit Site Document final dari draft LLM. `websiteId` datang dari DB kita dan
// `tokens` dari tema terpilih (deterministik) — dua hal yang TIDAK boleh dikarang model.
// Tema tak dikenal → jatuh ke tema pertama, supaya satu halusinasi themeId tak
// menggagalkan seluruh build.
export function assembleSiteDocument(draft: unknown, websiteId: string): unknown {
  const d = (draft ?? {}) as { title?: unknown; themeId?: unknown; pages?: unknown };
  const themeId = typeof d.themeId === 'string' ? d.themeId : '';
  const theme = findTheme(themeId) ?? THEMES[0];

  return {
    websiteId,
    title: d.title,
    themeId: theme?.id,
    tokens: theme?.tokens,
    pages: d.pages,
  };
}

// T-053g: JSON Schema draft untuk disisipkan ke prompt build. Sebelumnya prompt cuma
// menyebut bentuk secara naratif, jadi model menebak-nebak props tiap section (mis. lupa
// `image.alt`) dan schema menolaknya berulang kali — boros token, sering gagal total.
// Memberi model kontrak yang PERSIS memvalidasinya menutup celah tebakan itu.
export function siteDraftJsonSchema(): unknown {
  return z.toJSONSchema(siteDraftSchema, { io: 'input' });
}
