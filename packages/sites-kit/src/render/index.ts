// packages/sites-kit/render — barrel renderer statis (T-061).
export { escapeHtml, escapeAttr, safeUrl } from './escape.js';
export { designTokensToCssVars, renderStyles } from './tokens-css.js';
export { renderSection } from './sections.js';
export { buildJsonLd, renderJsonLd } from './json-ld.js';
export { renderPage, renderSite, type RenderedPage } from './page.js';
