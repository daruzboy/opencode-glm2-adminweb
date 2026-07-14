// Logo situs = gambar di dalam blok MENU BAR (navbar). Dipakai juga sebagai FAVICON,
// supaya situs punya ikon tab yang konsisten tanpa user harus mengaturnya dua kali.

import { parse } from 'node-html-parser';
import type { BlockInstance } from './render.js';

function isMenuBlock(b: BlockInstance): boolean {
  return /^menu/i.test(b._name ?? '') || /class="[^"]*navbar/.test(b._customHTML);
}

/** Ambil src logo (gambar pertama di blok menu). null bila tak ada. */
export function siteLogoSrc(components: readonly BlockInstance[]): string | null {
  const menu = components.find(isMenuBlock);
  if (!menu) return null;
  const root = parse(menu._customHTML, { comment: false });
  // Utamakan gambar di dalam brand/navbar; kalau tidak ada, gambar pertama apa pun.
  const img =
    root.querySelector('.navbar-brand img') ??
    root.querySelector('.navbar-logo img') ??
    root.querySelector('img');
  const src = img?.getAttribute('src');
  return src && src.trim() ? src.trim() : null;
}
