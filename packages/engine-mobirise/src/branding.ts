// Pembersih branding Mobirise dari keluaran situs. Template yang dibeli tetap
// mengandung teks "Mobirise", alt bawaan, dan tautan placeholder ke mobiri.se.
// Situs milik user harus bersih dari itu, jadi dibersihkan saat render (berlaku
// untuk kanvas editor MAUPUN hasil ekspor). _customHTML asli tidak diubah.

import type { HTMLElement } from 'node-html-parser';

// Domain milik Mobirise (tautan placeholder / kredit).
const BRAND_LINK = /(^|\/\/|\.)(mobiri\.se|mobirise\.com)(\/|$)/i;
const BRAND_WORD = /mobirise/i;
const BRAND_WORD_G = /mobirise/gi;

export function isBrandLink(href: string | undefined): boolean {
  return Boolean(href && BRAND_LINK.test(href));
}

// Email contoh berbranding (mis. placeholder form: "mobirise@email.com").
const BRAND_EMAIL = /mobirise@[\w.-]+/gi;

// Bersihkan teks: ganti email contoh, buang kata "Mobirise", rapikan sisa pemisah/spasi.
export function cleanText(text: string): string {
  if (!BRAND_WORD.test(text)) return text;
  return text
    .replace(BRAND_EMAIL, 'email@contoh.com')
    .replace(BRAND_WORD_G, '')
    .replace(/\s*[-–—|]\s*(?=[-–—|]|$)/g, '') // pemisah yang jadi menggantung
    .replace(/[ \t]{2,}/g, ' ');
}

// Terapkan pada satu elemen (dipanggil dari processNode saat render).
// - href/src ke domain Mobirise → '#'
// - alt/title yang menyebut Mobirise → dikosongkan
// Kembalikan false bila elemen ini adalah tautan KREDIT (harus dibuang).
export function sanitizeElement(el: HTMLElement): boolean {
  const href = el.getAttribute('href');
  if (isBrandLink(href)) {
    // Tautan kredit ("Made with Mobirise") → buang elemennya.
    if (BRAND_WORD.test(el.text)) return false;
    // Tautan placeholder pada tombol → netralkan tujuannya.
    el.setAttribute('href', '#');
  }

  // Atribut yang TERLIHAT user (placeholder form, alt, tooltip) dibersihkan.
  // Catatan: href aset seperti .../mobirise-icons2/... TIDAK disentuh — itu path
  // font ikon, bukan branding; menghapusnya akan merusak ikon.
  for (const attr of ['alt', 'title', 'aria-label', 'placeholder', 'value'] as const) {
    const v = el.getAttribute(attr);
    if (v && BRAND_WORD.test(v)) el.setAttribute(attr, cleanText(v).trim());
  }
  return true;
}
