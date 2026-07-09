// packages/sites-kit/render — design token → CSS (T-061, FR-CMP-003).
// Token dipetakan ke CSS custom properties; seluruh styling komponen memakai var(--dm-*),
// tak ada nilai warna/ukuran lepas di markup. Deterministik (input sama → output sama).

import type { DesignTokens } from '../design-tokens.js';

const RADIUS_SCALE: Readonly<Record<DesignTokens['radius'], string>> = {
  none: '0',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '1rem',
  full: '9999px',
};

const SPACING_SCALE: Readonly<Record<DesignTokens['spacing'], string>> = {
  tight: '2.5rem',
  default: '4rem',
  relaxed: '6rem',
};

const FONT_SCALE: Readonly<Record<DesignTokens['typography']['scale'], string>> = {
  compact: '15px',
  default: '16px',
  spacious: '18px',
};

/** Custom properties `:root` dari token. */
export function designTokensToCssVars(tokens: DesignTokens): string {
  const c = tokens.colors;
  const lines = [
    `--dm-color-primary:${c.primary}`,
    `--dm-color-secondary:${c.secondary}`,
    `--dm-color-background:${c.background}`,
    `--dm-color-surface:${c.surface}`,
    `--dm-color-text:${c.text}`,
    `--dm-color-muted:${c.muted}`,
    `--dm-color-accent:${c.accent}`,
    `--dm-radius:${RADIUS_SCALE[tokens.radius]}`,
    `--dm-space:${SPACING_SCALE[tokens.spacing]}`,
    `--dm-font-base:${FONT_SCALE[tokens.typography.scale]}`,
    `--dm-font-heading:${tokens.typography.fontHeading}`,
    `--dm-font-body:${tokens.typography.fontBody}`,
  ];
  return `:root{${lines.join(';')}}`;
}

// Stylesheet dasar zero-JS yang HANYA memakai var(--dm-*) (token-driven, FR-CMP-003).
// Layout section memakai kelas hook `.dm-section` + `.dm-<type>--<variant>`.
const BASE_STYLESHEET = [
  '*{box-sizing:border-box}',
  'body{margin:0;font-family:var(--dm-font-body),system-ui,sans-serif;font-size:var(--dm-font-base);color:var(--dm-color-text);background:var(--dm-color-background)}',
  'h1,h2,h3{font-family:var(--dm-font-heading),var(--dm-font-body),sans-serif;line-height:1.2}',
  'a{color:var(--dm-color-primary)}',
  'img{max-width:100%;height:auto;border-radius:var(--dm-radius)}',
  '.dm-section{padding:var(--dm-space) 1.25rem}',
  '.dm-container{max-width:72rem;margin:0 auto}',
  '.dm-grid{display:grid;gap:1.5rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))}',
  '.dm-card{background:var(--dm-color-surface);border-radius:var(--dm-radius);padding:1.25rem}',
  '.dm-btn{display:inline-block;background:var(--dm-color-primary);color:var(--dm-color-background);padding:.75rem 1.25rem;border-radius:var(--dm-radius);text-decoration:none}',
  '.dm-muted{color:var(--dm-color-muted)}',
  '.dm-hero{background:var(--dm-color-surface)}',
  '.dm-hero--centered{text-align:center}',
  '.dm-footer{background:var(--dm-color-surface);color:var(--dm-color-muted)}',
].join('');

/** Blok `<style>` lengkap: custom properties + stylesheet dasar. */
export function renderStyles(tokens: DesignTokens): string {
  return `<style>${designTokensToCssVars(tokens)}${BASE_STYLESHEET}</style>`;
}
