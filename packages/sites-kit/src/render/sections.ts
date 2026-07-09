// packages/sites-kit/render — render section → HTML statis (T-061, FR-CMP-004).
// Deterministik & zero-JS. Dispatch via switch atas discriminated union `Section` →
// exhaustive (menambah tipe section tanpa renderer = error kompilasi). Semua konten
// di-escape; URL disaring `safeUrl` (anti-XSS, ADR-3).

import type { Section } from '../sections.js';
import { escapeAttr, escapeHtml, safeUrl } from './escape.js';

/** Path aset tenant (resolusi CDN/objek-storage nyata menyusul). */
function assetPath(assetId: string): string {
  return `/_assets/${encodeURIComponent(assetId)}`;
}

function heading(text: string, level: 1 | 2 | 3 = 2): string {
  return `<h${level}>${escapeHtml(text)}</h${level}>`;
}

function paragraph(text: string, className = ''): string {
  const cls = className ? ` class="${className}"` : '';
  return `<p${cls}>${escapeHtml(text)}</p>`;
}

function ctaButton(cta: { readonly label: string; readonly href: string } | undefined): string {
  if (!cta) return '';
  return `<a class="dm-btn" href="${escapeAttr(safeUrl(cta.href))}">${escapeHtml(cta.label)}</a>`;
}

function image(img: { readonly assetId: string; readonly alt: string } | undefined): string {
  if (!img) return '';
  return `<img src="${escapeAttr(assetPath(img.assetId))}" alt="${escapeAttr(img.alt)}" loading="lazy">`;
}

function list(items: readonly string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
}

/** Bungkus inner HTML dengan wrapper section berkelas hook token-driven. */
function wrap(section: Section, inner: string): string {
  const cls = `dm-section dm-${section.type} dm-${section.type}--${section.variant}`;
  return `<section class="${cls}"><div class="dm-container">${inner}</div></section>`;
}

/** Render satu section menjadi HTML. */
export function renderSection(section: Section): string {
  const inner = renderInner(section);
  return wrap(section, inner);
}

function renderInner(section: Section): string {
  switch (section.type) {
    case 'hero': {
      const p = section.props;
      return [
        heading(p.headline, 1),
        p.subheadline ? paragraph(p.subheadline, 'dm-muted') : '',
        image(p.image),
        ctaButton(p.cta),
      ].join('');
    }
    case 'about': {
      const p = section.props;
      return [heading(p.title), image(p.image), paragraph(p.body)].join('');
    }
    case 'services': {
      const p = section.props;
      const cards = p.items
        .map((it) => `<div class="dm-card">${heading(it.name, 3)}${it.description ? paragraph(it.description, 'dm-muted') : ''}</div>`)
        .join('');
      return `${heading(p.title)}<div class="dm-grid">${cards}</div>`;
    }
    case 'product-grid': {
      const p = section.props;
      const cards = p.products
        .map((pr) => {
          const price = pr.price ? paragraph(pr.price, 'dm-muted') : '';
          const link = pr.href ? `<a href="${escapeAttr(safeUrl(pr.href))}">${escapeHtml(pr.name)}</a>` : escapeHtml(pr.name);
          return `<div class="dm-card">${image(pr.image)}<h3>${link}</h3>${price}</div>`;
        })
        .join('');
      return `${heading(p.title)}<div class="dm-grid">${cards}</div>`;
    }
    case 'gallery': {
      const p = section.props;
      const imgs = p.images.map((im) => image(im)).join('');
      return `${p.title ? heading(p.title) : ''}<div class="dm-grid">${imgs}</div>`;
    }
    case 'testimonials': {
      const p = section.props;
      const cards = p.items
        .map((t) => {
          const role = t.role ? `, ${escapeHtml(t.role)}` : '';
          return `<figure class="dm-card"><blockquote>${escapeHtml(t.quote)}</blockquote><figcaption>${escapeHtml(t.author)}${role}</figcaption></figure>`;
        })
        .join('');
      return `${p.title ? heading(p.title) : ''}<div class="dm-grid">${cards}</div>`;
    }
    case 'features': {
      const p = section.props;
      const cards = p.items
        .map((it) => `<div class="dm-card">${heading(it.title, 3)}${it.description ? paragraph(it.description, 'dm-muted') : ''}</div>`)
        .join('');
      return `${heading(p.title)}<div class="dm-grid">${cards}</div>`;
    }
    case 'cta-banner': {
      const p = section.props;
      return `${heading(p.headline)}${ctaButton(p.cta)}`;
    }
    case 'faq': {
      const p = section.props;
      const items = p.items
        .map((q) => `<details><summary>${escapeHtml(q.question)}</summary>${paragraph(q.answer)}</details>`)
        .join('');
      return `${p.title ? heading(p.title) : ''}${items}`;
    }
    case 'contact-map': {
      const p = section.props;
      const rows: string[] = [];
      if (p.address) rows.push(paragraph(p.address));
      if (p.phone) rows.push(`<p><a href="${escapeAttr(safeUrl(`tel:${p.phone}`))}">${escapeHtml(p.phone)}</a></p>`);
      if (p.email) rows.push(`<p><a href="${escapeAttr(safeUrl(`mailto:${p.email}`))}">${escapeHtml(p.email)}</a></p>`);
      const map = p.mapQuery
        ? `<iframe title="Peta" src="${escapeAttr(`https://www.google.com/maps?q=${encodeURIComponent(p.mapQuery)}&output=embed`)}" loading="lazy"></iframe>`
        : '';
      return `${p.title ? heading(p.title) : ''}${rows.join('')}${map}`;
    }
    case 'catalog': {
      const p = section.props;
      const cats = p.categories
        .map((cat) => {
          const items = cat.items
            .map((it) => `<li>${escapeHtml(it.name)}${it.price ? ` — <span class="dm-muted">${escapeHtml(it.price)}</span>` : ''}</li>`)
            .join('');
          return `<div class="dm-card">${heading(cat.name, 3)}<ul>${items}</ul></div>`;
        })
        .join('');
      return `${p.title ? heading(p.title) : ''}<div class="dm-grid">${cats}</div>`;
    }
    case 'article-list': {
      const p = section.props;
      const items = p.articles
        .map(
          (a) =>
            `<article class="dm-card"><h3><a href="${escapeAttr(safeUrl(a.href))}">${escapeHtml(a.title)}</a></h3>${a.excerpt ? paragraph(a.excerpt, 'dm-muted') : ''}</article>`,
        )
        .join('');
      return `${p.title ? heading(p.title) : ''}<div class="dm-grid">${items}</div>`;
    }
    case 'footer': {
      const p = section.props;
      const links = p.links?.length
        ? list(p.links.map((l) => `<a href="${escapeAttr(safeUrl(l.href))}">${escapeHtml(l.label)}</a>`))
        : '';
      const socials = p.socials?.length
        ? list(p.socials.map((s) => `<a href="${escapeAttr(safeUrl(s.href))}">${escapeHtml(s.platform)}</a>`))
        : '';
      return `${heading(p.businessName, 2)}${links}${socials}`;
    }
    default: {
      // Exhaustiveness: bila ada tipe section baru tanpa renderer, ini error kompilasi.
      return assertNever(section);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Section type tak tertangani: ${JSON.stringify(value)}`);
}
