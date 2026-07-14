// Ekspor situs statis (murni, framework-agnostic). Menghasilkan berkas TEKS yang jadi
// tanggung jawab editor: satu HTML per HALAMAN + satu mbr-additional.css berisi lapisan
// tema + CSS semua blok (cid unik lintas halaman, seperti keluaran Mobirise).
// Penyalinan aset (gambar, bootstrap, font tema) adalah urusan pemanggil.

import { renderPage, type PageRenderInput } from './page.js';
import type { BlockInstance } from './render.js';

export interface ExportedFile {
  readonly path: string;
  readonly content: string;
}

/** Satu halaman situs. slug 'index' → index.html; lainnya → <slug>.html */
export interface ExportPage {
  readonly slug: string;
  readonly title: string;
  readonly components: readonly BlockInstance[];
}

export interface ExportSiteInput extends Omit<PageRenderInput, 'cssHref' | 'components' | 'title'> {
  readonly pages: readonly ExportPage[];
  /** Lokasi file CSS gabungan relatif tiap HTML. Default seperti Mobirise. */
  readonly cssPath?: string;
}

export interface ExportResult {
  readonly files: readonly ExportedFile[];
  readonly cssPath: string;
}

export function pageFileName(slug: string): string {
  return slug === 'index' ? 'index.html' : `${slug}.html`;
}

export function exportSite(input: ExportSiteInput): ExportResult {
  const cssPath = input.cssPath ?? 'assets/mobirise/css/mbr-additional.css';
  const files: ExportedFile[] = [];
  const cssParts: string[] = [];
  let themeCssOut = '';

  for (const page of input.pages) {
    const { html, themeCss, blockCss } = renderPage({
      ...input,
      components: page.components as BlockInstance[],
      title: page.title,
      cssHref: cssPath,
    });
    themeCssOut = themeCss; // sama untuk semua halaman
    if (blockCss) cssParts.push(blockCss);
    files.push({ path: pageFileName(page.slug), content: html });
  }

  files.push({ path: cssPath, content: `${themeCssOut}\n${cssParts.join('\n')}\n` });
  return { cssPath, files };
}
