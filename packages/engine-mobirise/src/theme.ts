// Kompilasi theme.styling (param global tema) → CSS palet + tipografi, meniru bagian
// atas mbr-additional.css Mobirise. Ini melengkapi CSS per-blok (.cid-*) dari render.ts.
// Formula tipografi fluid diturunkan dari output resmi: min = 0.35*size + 0.65.

import { lighten, contrast } from './color.js';

export interface ThemeStyling {
  primaryColor: string;
  secondaryColor: string;
  successColor: string;
  infoColor: string;
  warningColor: string;
  dangerColor: string;
  mainFont: string;
  display1Font: string;
  display1Size: number;
  display2Font: string;
  display2Size: number;
  display4Font: string;
  display4Size: number;
  display5Font: string;
  display5Size: number;
  display7Font: string;
  display7Size: number;
  isRoundedButtons?: boolean;
  isRoundedImages?: boolean;
  isLargeButtons?: boolean;
  isGhostButtonBorder?: boolean;
  underlinedLinks?: boolean;
  // Opsi Mobirise lain (belum berdampak CSS di sini, disimpan agar dokumen utuh).
  isAnimatedOnScroll?: boolean;
  isScrollToTopButton?: boolean;
}

export interface SiteFont {
  css: string;
  name: string;
  url: string;
}

const DISPLAYS = [1, 2, 4, 5, 7] as const;
// Pengali line-height per preset display (dari output resmi Mobirise).
const LINE_HEIGHT: Record<number, number> = { 1: 1.1, 2: 1.3, 4: 1.4, 5: 1.4, 7: 1.4 };
// Line-height dasar (desktop) per preset display.
const BASE_LH: Record<number, number> = { 1: 1, 2: 1, 4: 1.5, 5: 1.3, 7: 1.5 };

function fontFor(styling: ThemeStyling, n: number): string {
  const key = `display${n}Font` as keyof ThemeStyling;
  return String(styling[key]);
}
function sizeFor(styling: ThemeStyling, n: number): number {
  const key = `display${n}Size` as keyof ThemeStyling;
  return Number(styling[key]);
}

function quoteFamily(name: string): string {
  return /['",]/.test(name) ? name : `'${name}', sans-serif`;
}

// Blok tipografi: base + dua media query fluid (mobile & 992–1400) persis Mobirise.
function typography(styling: ThemeStyling): string {
  const out: string[] = [`body {\n  font-family: ${styling.mainFont};\n}`];

  for (const n of DISPLAYS) {
    const size = sizeFor(styling, n);
    const fam = quoteFamily(fontFor(styling, n));
    out.push(
      `.display-${n} {\n  font-family: ${fam};\n  font-size: ${size}rem;\n  line-height: ${BASE_LH[n]};\n}`,
    );
    out.push(`.display-${n} > .mbr-iconfont {\n  font-size: ${+(size * 1.25).toFixed(4)}rem;\n}`);
  }

  // Rentang fluid: mobile (≤768) & tablet–desktop (992–1400), meniru output resmi.
  out.push(fluidRange(styling, 'max-width: 768px', 20, 48));
  out.push(fluidRange(styling, 'min-width: 992px) and (max-width: 1400px', 62, 87));
  return out.join('\n');
}

function fluidRange(styling: ThemeStyling, mediaCond: string, vwLo: number, vwHi: number): string {
  const rules = DISPLAYS.map((n) => {
    const size = sizeFor(styling, n);
    const min = +(0.35 * size + 0.65).toFixed(4);
    const lh = LINE_HEIGHT[n]!;
    const expr = `${min}rem + (${size} - ${min}) * ((100vw - ${vwLo}rem) / (${vwHi} - ${vwLo}))`;
    return (
      `  .display-${n} {\n` +
      `    font-size: calc( ${expr});\n` +
      `    line-height: calc( ${lh} * (${expr}));\n` +
      `  }`
    );
  }).join('\n');
  return `@media (${mediaCond}) {\n${rules}\n}`;
}

interface Named {
  name: string;
  color: string;
}

// Sistem warna: .bg-*, .btn-* (+hover/disabled), .btn-*-outline, .text-* untuk tiap warna.
function colorSystem(styling: ThemeStyling): string {
  const colors: Named[] = [
    { name: 'primary', color: styling.primaryColor },
    { name: 'secondary', color: styling.secondaryColor },
    { name: 'success', color: styling.successColor },
    { name: 'info', color: styling.infoColor },
    { name: 'warning', color: styling.warningColor },
    { name: 'danger', color: styling.dangerColor },
  ];
  const out: string[] = [];

  for (const { name, color } of colors) {
    out.push(`.bg-${name} {\n  background-color: ${color} !important;\n}`);
  }

  for (const { name, color } of colors) {
    const hover = lighten(color, 8);
    const text = contrast(color);
    out.push(
      `.btn-${name},\n.btn-${name}:active {\n` +
        `  background-color: ${color} !important;\n  border-color: ${color} !important;\n` +
        `  color: ${text} !important;\n  box-shadow: none;\n}`,
      `.btn-${name}:hover,\n.btn-${name}:focus,\n.btn-${name}.active {\n` +
        `  color: inherit;\n  background-color: ${hover} !important;\n  border-color: ${hover} !important;\n  box-shadow: none;\n}`,
      `.btn-${name}.disabled,\n.btn-${name}:disabled {\n` +
        `  color: ${text} !important;\n  background-color: ${hover} !important;\n  border-color: ${hover} !important;\n}`,
    );
  }

  // Tombol outline (ghost).
  for (const { name, color } of colors) {
    out.push(
      `.btn-${name}-outline,\n.btn-${name}-outline:active {\n` +
        `  background-color: transparent !important;\n  border-color: ${color};\n  color: ${color};\n}`,
    );
  }

  for (const { name, color } of colors) {
    out.push(`.text-${name} {\n  color: ${color} !important;\n}`);
  }

  // Tautan memakai warna primer.
  out.push(`a,\na:hover {\n  color: ${styling.primaryColor};\n}`);
  if (styling.underlinedLinks) out.push(`a:not(.btn) {\n  text-decoration: underline;\n}`);

  return out.join('\n');
}

// Bentuk tombol/gambar dari flag tema. Padding tombol besar vs standar; radius pill
// vs 4px; gambar kotak vs membulat. Nilai menyamai output resmi Mobirise.
function shapes(styling: ThemeStyling): string {
  const out: string[] = [];
  // Opsi "Rounded Buttons" (Site Styles Mobirise) → sudut pill; selain itu 4px.
  // Padding dari isLargeButtons.
  const btnPad = styling.isLargeButtons ? '1.25rem 2rem' : '0.6rem 1.2rem';
  const radius = styling.isRoundedButtons ? '100px' : '4px';
  out.push(`.btn {\n  padding: ${btnPad};\n  border-radius: ${radius};\n  border-width: 2px;\n}`);
  out.push(`@media (max-width: 767px) {\n  .btn {\n    padding: 0.75rem 1.5rem;\n  }\n}`);
  for (const sz of ['sm', 'md']) {
    out.push(`.btn-${sz} {\n  padding: 0.6rem 1.2rem;\n  border-radius: ${radius};\n}`);
  }
  out.push(`.btn-lg {\n  padding: 1.25rem 2rem;\n  border-radius: ${radius};\n}`);
  if (styling.isRoundedImages === false) {
    out.push(
      `img,\n.card-wrap,\n.card-wrapper,\n.video-wrapper,\n.mbr-figure iframe,\n.slide-content,\n.plan,\n.card,\n.item-wrapper {\n  border-radius: 0 !important;\n}`,
    );
  }
  return out.join('\n');
}

export function compileTheme(styling: ThemeStyling): string {
  return [shapes(styling), typography(styling), colorSystem(styling)].join('\n');
}

// <link> Google Fonts dari siteFonts proyek (URL sudah disediakan Mobirise).
export function themeFontLinks(siteFonts: readonly SiteFont[]): string {
  return siteFonts
    .filter((f) => f.url)
    .map((f) => `<link rel="stylesheet" href="${f.url}&display=swap">`)
    .join('\n');
}
