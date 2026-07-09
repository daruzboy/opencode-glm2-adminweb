// packages/sites-kit/render — structured data JSON-LD (T-061, FR-SEO-002).
// Dihasilkan dari Site Document sesuai konteks: LocalBusiness/Organization (profil),
// FAQPage (section FAQ), Product ItemList (katalog/produk), BreadcrumbList (halaman non-root).
// Deterministik; divalidasi terhadap schema.org di pipeline build (slice audit menyusul).

import type { Page, SiteDocument } from '../site-document.js';
import type { Section } from '../sections.js';

type JsonLd = Record<string, unknown>;

function sectionsOfType<T extends Section['type']>(
  page: Page,
  type: T,
): readonly Extract<Section, { type: T }>[] {
  return page.sections.filter((s): s is Extract<Section, { type: T }> => s.type === type);
}

function findFirstContact(doc: SiteDocument): Extract<Section, { type: 'contact-map' }> | undefined {
  for (const page of doc.pages) {
    const [first] = sectionsOfType(page, 'contact-map');
    if (first) return first;
  }
  return undefined;
}

function findBusinessName(doc: SiteDocument): string {
  for (const page of doc.pages) {
    const [footer] = sectionsOfType(page, 'footer');
    if (footer) return footer.props.businessName;
  }
  return doc.title;
}

function localBusiness(doc: SiteDocument): JsonLd {
  const contact = findFirstContact(doc);
  const node: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: findBusinessName(doc),
  };
  if (contact) {
    if (contact.props.address) node.address = contact.props.address;
    if (contact.props.phone) node.telephone = contact.props.phone;
    if (contact.props.email) node.email = contact.props.email;
  }
  return node;
}

function faqPage(page: Page): JsonLd | undefined {
  const faqs = sectionsOfType(page, 'faq');
  const entries = faqs.flatMap((s) => s.props.items);
  if (entries.length === 0) return undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: q.answer },
    })),
  };
}

function productList(page: Page): JsonLd | undefined {
  const grids = sectionsOfType(page, 'product-grid');
  const products = grids.flatMap((s) => s.props.products);
  if (products.length === 0) return undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: products.map((pr, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: { '@type': 'Product', name: pr.name, ...(pr.price ? { offers: { '@type': 'Offer', price: pr.price } } : {}) },
    })),
  };
}

function breadcrumb(doc: SiteDocument, page: Page): JsonLd | undefined {
  if (page.slug === 'index') return undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: doc.title, item: '/' },
      { '@type': 'ListItem', position: 2, name: page.title, item: `/${page.slug}` },
    ],
  };
}

/** Kumpulan node JSON-LD untuk satu halaman (termasuk profil situs). */
export function buildJsonLd(doc: SiteDocument, page: Page): readonly JsonLd[] {
  const nodes: JsonLd[] = [];
  // Profil bisnis hanya di halaman root untuk hindari duplikasi lintas halaman.
  if (page.slug === 'index') nodes.push(localBusiness(doc));
  const faq = faqPage(page);
  if (faq) nodes.push(faq);
  const products = productList(page);
  if (products) nodes.push(products);
  const crumbs = breadcrumb(doc, page);
  if (crumbs) nodes.push(crumbs);
  return nodes;
}

// `<` di-escape ke < agar konten tak bisa menutup tag <script> (anti-XSS).
function safeJson(node: JsonLd): string {
  return JSON.stringify(node).replace(/</g, '\\u003c');
}

/** Render node JSON-LD menjadi tag <script>. */
export function renderJsonLd(nodes: readonly JsonLd[]): string {
  return nodes.map((n) => `<script type="application/ld+json">${safeJson(n)}</script>`).join('');
}
