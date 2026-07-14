// Ambil "judul" sebuah blok = teks dengan tipografi TERBESAR di dalamnya.
// Dipakai untuk melabeli blok di daftar halaman (mis. "header02 — Personal Branding").
//
// Ukuran ditentukan preset tema Mobirise, bukan tebakan: display-1 > display-2 >
// display-5 > display-7 > display-4 (lihat theme.ts). Preset ditandai lewat atribut
// `mbr-theme-style` (template) atau kelas `display-N` (HTML terender).

import { parse } from 'node-html-parser';

// Urutan dari yang terbesar.
const PRESET_ORDER = ['display-1', 'display-2', 'display-5', 'display-7', 'display-4'];

// Cadangan bila blok tak memakai preset (mis. blok menu/footer sederhana).
const FALLBACK_SELECTORS = ['.mbr-section-title', 'h1', 'h2', 'h3', '.mbr-label', '.mbr-text'];

const MAX_LEN = 40;

function tidy(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > MAX_LEN ? `${t.slice(0, MAX_LEN - 1).trimEnd()}…` : t;
}

export function blockHeadline(customHTML: string): string {
  const root = parse(customHTML, { comment: false });

  // 1) Preset tipografi terbesar yang punya teks.
  for (const preset of PRESET_ORDER) {
    const els = root.querySelectorAll(`[mbr-theme-style~="${preset}"], .${preset}`);
    for (const el of els) {
      const t = tidy(el.text);
      if (t) return t;
    }
  }

  // 2) Cadangan: judul/heading biasa.
  for (const sel of FALLBACK_SELECTORS) {
    const el = root.querySelector(sel);
    if (el) {
      const t = tidy(el.text);
      if (t) return t;
    }
  }

  return '';
}
