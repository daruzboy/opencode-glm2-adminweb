// Dokumen situs engine Mobirise (renderEngine 'mobirise-v1') — BENTUK BERSAMA dengan
// editor-web (apps/api/src/schemas.ts di repo editor-web): satu skema yang sama untuk
// Revision.siteDoc glm2, Project.document editor-web, dan input exportSite. Handoff
// review PO (P5) jadi murni pass-through — tanpa konversi, tanpa kehilangan data.
//
// Sengaja LONGGAR (passthrough) seperti di editor-web: detail blok divalidasi block-engine
// saat render, bukan di tepi. Yang dikunci di sini hanya yang membuat render/publish aman:
// slug halaman (jadi nama berkas!), keunikan slug, dan _cid+_customHTML per blok (tanpa
// keduanya renderBlock tak bisa bekerja).

import { z } from 'zod';

// Blok Mobirise (BlockInstance di @digimaestro/engine-mobirise). _customHTML berisi
// <mbr-parameters> + markup; _styles LESS-as-JSON; _params nilai kontrol.
export const mobiriseBlockSchema = z
  .looseObject({
    _cid: z.string().min(1),
    _customHTML: z.string().min(1),
    _anchor: z.string().optional(),
    _name: z.string().optional(),
    _global: z.boolean().optional(),
    _sourceTheme: z.string().optional(),
  })
  .describe('Blok Mobirise — bentuk detail divalidasi block-engine saat render');

export const mobirisePageSchema = z.object({
  // Slug menjadi NAMA BERKAS output (index.html / <slug>.html) — dikunci ketat.
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'slug hanya huruf kecil, angka, dan strip'),
  title: z.string().min(1).max(160),
  components: z.array(mobiriseBlockSchema).min(1).max(60),
});

export const mobiriseProjectSchema = z
  .looseObject({
    templateId: z.string().min(1).max(80),
    // theme.styling Mobirise (primaryColor, mainFont, display1Font, …) — kunci & nilai
    // bebas; compileTheme yang menafsirkan.
    styling: z.record(z.string(), z.unknown()),
    siteFonts: z.array(z.unknown()).optional(),
    pages: z.array(mobirisePageSchema).min(1).max(50),
  })
  .refine((d) => new Set(d.pages.map((p) => p.slug)).size === d.pages.length, {
    message: 'slug halaman harus unik',
  });

export type MobiriseProject = z.infer<typeof mobiriseProjectSchema>;
export type MobirisePage = z.infer<typeof mobirisePageSchema>;

export function parseMobiriseProject(value: unknown):
  | { ok: true; value: MobiriseProject }
  | { ok: false; message: string } {
  const parsed = mobiriseProjectSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'dokumen mobirise tak valid',
  };
}
