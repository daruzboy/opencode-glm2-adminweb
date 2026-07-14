// packages/sites-kit — library model situs (Site Document), skema section & design token
// (SRS §2/§8, FRD CMP). Komponen render Astro/Tailwind ditambahkan di slice T-06x berikutnya;
// paket ini menyediakan kontrak tervalidasi Zod yang dipakai agent (FR-AGT-001/004) & renderer.

export {
  colorTokensSchema,
  typographyTokensSchema,
  designTokensSchema,
  themeSchema,
  THEMES,
  THEME_IDS,
  findTheme,
  type DesignTokens,
  type Theme,
} from './design-tokens.js';

export {
  SECTION_REGISTRY,
  SECTION_TYPES,
  MVP_SECTION_TYPES,
  sectionVariants,
  sectionSchema,
  type SectionType,
  type Section,
} from './sections.js';

export {
  pageSchema,
  siteDraftSchema,
  siteDocumentSchema,
  parseSiteDocument,
  isSiteDocument,
  assembleSiteDocument,
  siteDraftJsonSchema,
  type SiteDraft,
  type Page,
  type SiteDocument,
  type SiteDocumentParseResult,
} from './site-document.js';

// Engine Mobirise (P2): dokumen situs bentuk BERSAMA dengan editor-web — dipakai
// Revision.siteDoc saat renderEngine 'mobirise-v1'. Renderer-nya @digimaestro/engine-mobirise.
export {
  mobiriseBlockSchema,
  mobirisePageSchema,
  mobiriseProjectSchema,
  parseMobiriseProject,
  type MobiriseProject,
  type MobirisePage,
} from './mobirise/project-schema.js';

// Renderer statis (T-061): Site Document → HTML zero-JS + CSS token + JSON-LD.
export {
  escapeHtml,
  escapeAttr,
  safeUrl,
  designTokensToCssVars,
  renderStyles,
  renderSection,
  buildJsonLd,
  renderJsonLd,
  renderPage,
  renderSite,
  absoluteUrl,
  buildSitemap,
  buildRobots,
  buildStaticSite,
  type RenderedPage,
  type RenderOptions,
  type RobotsOptions,
  type StaticFile,
} from './render/index.js';
