// packages/sites-kit/render — barrel renderer statis (T-061).
export { escapeHtml, escapeAttr, safeUrl } from './escape.js';
export { designTokensToCssVars, renderStyles } from './tokens-css.js';
export { renderSection } from './sections.js';
export { buildJsonLd, renderJsonLd } from './json-ld.js';
export { renderPage, renderSite, absoluteUrl, type RenderedPage, type RenderOptions } from './page.js';
export { buildSitemap, buildRobots, type RobotsOptions } from './sitemap.js';
export { buildStaticSite, type StaticFile } from './site-build.js';
