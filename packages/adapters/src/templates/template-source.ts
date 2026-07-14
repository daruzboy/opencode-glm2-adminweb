// P3: pembaca folder template dari disk. Folder = sumber kebenaran (di-gitignore karena
// lisensi Mobirise); satu folder yang sama juga dilayani editor-web.
//
// Bentuk project.mobirise (asli Mobirise): { settings:{theme:{styling}, siteFonts, ...},
// pages: { "index.html": { settings:{title,...}, components:[BlockInstance] } } }.
// Di sini dinormalkan ke bentuk bersama (pages array ber-slug) — sama dengan
// mobiriseProjectSchema di sites-kit.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { templateManifestSchema, type TemplateManifest } from './template-manifest.js';

export interface SourcePage {
  readonly slug: string;
  readonly title: string;
  // BlockInstance mentah dari project.mobirise (bentuk detail urusan engine).
  readonly components: readonly Record<string, unknown>[];
}

export interface TemplateSource {
  readonly id: string;
  readonly manifest: TemplateManifest;
  readonly styling: Record<string, unknown>;
  readonly siteFonts: readonly unknown[];
  readonly pages: readonly SourcePage[];
  // Isi mentah project.mobirise — untuk hash perubahan (indexer).
  readonly raw: string;
}

// "index.html" → "index"; "Tentang Kami.html" → "tentang-kami" (slug = nama berkas output).
export function pageSlug(fileName: string): string {
  return fileName
    .replace(/\.html?$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'index';
}

export async function listTemplateIds(templatesDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(templatesDir);
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const name of entries) {
    try {
      const st = await stat(join(templatesDir, name));
      if (!st.isDirectory()) continue;
      await stat(join(templatesDir, name, 'project.mobirise'));
      ids.push(name);
    } catch {
      // folder tanpa project.mobirise bukan template — dilewati tanpa ribut
    }
  }
  return ids.sort();
}

export async function readTemplateSource(
  templatesDir: string,
  id: string,
): Promise<{ ok: true; value: TemplateSource } | { ok: false; message: string }> {
  const dir = join(templatesDir, id);

  let raw: string;
  try {
    raw = await readFile(join(dir, 'project.mobirise'), 'utf8');
  } catch {
    return { ok: false, message: `template '${id}': project.mobirise tak ditemukan` };
  }

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(join(dir, 'template.json'), 'utf8');
  } catch {
    return { ok: false, message: `template '${id}': template.json tak ditemukan (wajib — metadata pemilihan AI)` };
  }
  const manifest = templateManifestSchema.safeParse(JSON.parse(manifestRaw));
  if (!manifest.success) {
    const issue = manifest.error.issues[0];
    return { ok: false, message: `template '${id}': template.json tak valid (${issue?.path.join('.')}: ${issue?.message})` };
  }

  let project: {
    settings?: { theme?: { styling?: Record<string, unknown> }; siteFonts?: unknown[] };
    pages?: Record<string, { settings?: { title?: string }; components?: unknown[] }>;
  };
  try {
    project = JSON.parse(raw) as typeof project;
  } catch (e) {
    return { ok: false, message: `template '${id}': project.mobirise bukan JSON valid (${(e as Error).message})` };
  }

  const pagesMap = project.pages ?? {};
  const pages: SourcePage[] = Object.entries(pagesMap).map(([file, page]) => ({
    slug: pageSlug(file),
    title: page.settings?.title ?? manifest.data.name,
    components: (page.components ?? []) as Record<string, unknown>[],
  }));
  if (pages.length === 0) return { ok: false, message: `template '${id}': tanpa halaman` };

  return {
    ok: true,
    value: {
      id,
      manifest: manifest.data,
      styling: project.settings?.theme?.styling ?? {},
      siteFonts: project.settings?.siteFonts ?? [],
      pages,
      raw,
    },
  };
}
