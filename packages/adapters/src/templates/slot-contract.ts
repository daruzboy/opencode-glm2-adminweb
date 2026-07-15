// P3: kontrak slot — jembatan antara blok Mobirise (HTML bebas) dan LLM (nilai bernama).
//
// LLM TIDAK PERNAH menulis HTML blok: ia hanya mengisi nilai slot (teks/gambar/tautan)
// yang diekstrak dari blok via annotateEditable (data-edit-id deterministik terhadap HTML
// sumber). materialize menulis balik dengan setEditableText/Attrs — struktur & styling
// template tak mungkin rusak oleh isian.
//
// ALAMAT SLOT = `b<blockIndex>:<data-edit-id>` (komposit). annotateEditable memberi id
// PER BLOK (tiap blok mulai lagi dari e0) → data-edit-id saja BERTABRAKAN antar blok di
// halaman yang sama. Insiden E2E 2026-07-15: isian stock utk slot image ter-lookup ke
// slot text blok lain (Map entri terakhir menang) → dibuang sanitizer; dan satu isian
// bisa tertulis ke SEMUA blok yang kebetulan punya id sama.

import { parse } from 'node-html-parser';
import {
  annotateEditable,
  listLinks,
  listTexts,
  setEditableAttrs,
  setEditableText,
} from '@digimaestro/engine-mobirise';
import type { PageFills, TemplatePageContract, TemplateSlot } from '@digimaestro/shared';
import type { SourcePage } from './template-source.js';

interface ImageSlotInfo {
  readonly editId: string;
  readonly current: string;
  readonly hint: string;
}

// img[data-edit-id] — listTexts sengaja melewati media, jadi dilengkapi di sini.
// (video dilewati: mengganti video butuh kurasi manusia, bukan isian AI.)
function listImageSlots(annotatedHtml: string): ImageSlotInfo[] {
  const root = parse(annotatedHtml, { comment: false });
  return root
    .querySelectorAll('img[data-edit-id]')
    .map((el) => ({
      editId: el.getAttribute('data-edit-id') ?? '',
      current: el.getAttribute('src') ?? '',
      hint: el.getAttribute('alt') || el.classNames || 'gambar',
    }))
    .filter((s) => s.editId);
}

function blockName(block: Record<string, unknown>): string {
  return typeof block._name === 'string' ? block._name : 'blok';
}

// Alamat slot unik se-halaman. LLM menerima & mengembalikan bentuk ini apa adanya.
export function slotAddress(blockIndex: number, editId: string): string {
  return `b${blockIndex}:${editId}`;
}

// null blockIndex = kunci lama tanpa prefiks (kompat: diterapkan ke blok mana pun yang
// memuat id-nya — perilaku sebelum komposit).
function parseSlotAddress(key: string): { blockIndex: number | null; editId: string } {
  const m = /^b(\d+):(.+)$/.exec(key);
  return m ? { blockIndex: Number(m[1]), editId: m[2] as string } : { blockIndex: null, editId: key };
}

// Ekstrak seluruh slot sebuah halaman. Blok di-annotate DULU (idempoten & deterministik)
// — id yang sama akan muncul lagi di materialize maupun di editor-web.
export function extractPageContract(page: SourcePage): TemplatePageContract {
  const slots: TemplateSlot[] = [];

  page.components.forEach((block, blockIndex) => {
    const html = typeof block._customHTML === 'string' ? block._customHTML : '';
    if (!html) return;
    const annotated = annotateEditable(html);
    const name = blockName(block);

    const links = new Set(listLinks(annotated).map((l) => l.editId));
    for (const t of listTexts(annotated)) {
      slots.push({
        editId: slotAddress(blockIndex, t.editId),
        blockIndex,
        kind: links.has(t.editId) ? 'link' : 'text',
        hint: `${name} · ${t.label}`,
        current: t.html,
      });
    }
    for (const img of listImageSlots(annotated)) {
      slots.push({
        editId: slotAddress(blockIndex, img.editId),
        blockIndex,
        kind: 'image',
        hint: `${name} · ${img.hint}`,
        current: img.current,
      });
    }
  });

  return { slug: page.slug, title: page.title, slots };
}

// Terapkan isian ke halaman → components final (HTML ter-annotate + terisi).
// Slot tanpa isian / kind 'keep' → isi template dipertahankan (pengisian parsial tetap
// menghasilkan situs utuh).
export function applyPageFills(
  page: SourcePage,
  fills: PageFills | undefined,
): { readonly slug: string; readonly title: string; readonly components: Record<string, unknown>[] } {
  const byId = fills?.fills ?? {};

  const components = page.components.map((block, blockIndex) => {
    const html = typeof block._customHTML === 'string' ? block._customHTML : '';
    if (!html) return { ...block };
    let out = annotateEditable(html);

    const root = parse(out, { comment: false });
    const idsInBlock = new Set(
      root.querySelectorAll('[data-edit-id]').map((el) => el.getAttribute('data-edit-id') ?? ''),
    );

    for (const [key, fill] of Object.entries(byId)) {
      const addr = parseSlotAddress(key);
      // Alamat komposit menunjuk SATU blok — blok lain dgn data-edit-id sama tak tersentuh.
      if (addr.blockIndex !== null && addr.blockIndex !== blockIndex) continue;
      const editId = addr.editId;
      if (!idsInBlock.has(editId) || fill.kind === 'keep') continue;
      if (fill.kind === 'text') {
        out = setEditableText(out, editId, fill.text);
      } else if (fill.kind === 'image') {
        out = setEditableAttrs(out, editId, { src: fill.url, alt: fill.alt });
      } else if (fill.kind === 'link') {
        out = setEditableAttrs(out, editId, { href: fill.href });
        if (fill.label) out = setEditableText(out, editId, fill.label);
      }
      // kind lain (mis. 'stock' yang lolos tanpa resolver) diabaikan = keep — jangan
      // pernah menulis href/src undefined ke HTML.
    }
    return { ...block, _customHTML: out };
  });

  return { slug: page.slug, title: fills?.title ?? page.title, components };
}
