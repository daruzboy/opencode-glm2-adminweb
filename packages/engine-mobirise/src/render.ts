// Render satu blok instance Mobirise → { html, css }.
// Terapkan binding pada _customHTML: {{expr}} interpolasi, mbr-if (buang node),
// mbr-class (toggle kelas), lalu buang <mbr-parameters> dan resolusi placeholder path.
// CSS dari compileStyles. Hasil ditandai kelas `cid-<cid>` untuk scoping.

import { parse, type HTMLElement } from 'node-html-parser';
import { evalBool, evalExpr, type ParamContext } from './expr.js';
import { parseParameters, buildContext } from './parameters.js';
import { compileStyles, type StyleTree } from './styles.js';
import { sanitizeElement, cleanText } from './branding.js';

export interface BlockInstance {
  readonly _cid: string;
  readonly _customHTML: string;
  readonly _styles?: StyleTree;
  readonly _params?: ParamContext;
  readonly _anchor?: string;
  readonly _name?: string;
  /** Blok global (dipakai bersama semua halaman, mis. menu & footer). */
  readonly _global?: boolean;
  readonly _sourceTheme?: string;
}

export interface PathResolver {
  /** @THEME_PATH@ → path aset tema (mis. assets/theme atau URL). */
  themePath: string;
  /** @PROJECT_PATH@ → path aset proyek (mis. . atau URL). */
  projectPath: string;
}

export interface RenderedBlock {
  readonly cid: string;
  readonly anchor: string;
  readonly html: string;
  readonly css: string;
}

function resolvePlaceholders(text: string, paths: PathResolver): string {
  return text
    .replaceAll('@THEME_PATH@', paths.themePath)
    .replaceAll('@PROJECT_PATH@', paths.projectPath);
}

function interpolate(text: string, ctx: ParamContext): string {
  return text.replace(/\{\{([^}]*)\}\}/g, (_, expr: string) => {
    const v = evalExpr(expr, ctx);
    return v == null || v === false ? '' : String(v);
  });
}

// mbr-class="{'a': expr, 'b': expr2}" → tambah kelas yang exprnya truthy.
function applyMbrClass(el: HTMLElement, spec: string, ctx: ParamContext): void {
  const body = spec.trim().replace(/^\{/, '').replace(/\}$/, '');
  // Pisah pasangan 'kelas': ekspr — pisah koma di level atas (tanpa nested {} di sini).
  for (const pair of splitTop(body, ',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const cls = pair.slice(0, idx).trim().replace(/^['"]|['"]$/g, '');
    const expr = pair.slice(idx + 1).trim();
    // Kunci bisa berisi >1 kelas (mis. 'd-none d-lg-flex') → tambah per token,
    // karena classList.add menolak string yang mengandung spasi.
    if (cls && evalBool(expr, ctx)) {
      for (const c of cls.split(/\s+/)) if (c) el.classList.add(c);
    }
  }
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '{' || ch === '(') depth++;
    else if (ch === '}' || ch === ')') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// mbr-style="{'height': logoSize + 'rem', 'margin-left': gap + 'px'}" → style inline.
// Dipakai luas oleh Mobirise (ukuran logo, jarak slider, dsb. — 74 dari 134 blok pustaka),
// jadi tanpa dukungan ini banyak parameter tampak "tidak berpengaruh".
function applyMbrStyle(el: HTMLElement, spec: string, ctx: ParamContext): void {
  const body = spec.trim().replace(/^\{/, '').replace(/\}$/, '');
  const decls: string[] = [];
  for (const pair of splitTop(body, ',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const prop = pair.slice(0, idx).trim().replace(/^['"]|['"]$/g, '');
    const value = evalExpr(pair.slice(idx + 1).trim(), ctx);
    // undefined/null/false → properti dilewati (param mati).
    if (!prop || value == null || value === false) continue;
    decls.push(`${prop}: ${String(value)}`);
  }
  if (decls.length === 0) return;
  const existing = el.getAttribute('style')?.trim().replace(/;$/, '');
  el.setAttribute('style', [existing, decls.join('; ')].filter(Boolean).join('; ') + ';');
}

function processNode(el: HTMLElement, ctx: ParamContext): boolean {
  // mbr-if: buang node bila false. Kembalikan false → hapus.
  const ifExpr = el.getAttribute('mbr-if');
  if (ifExpr != null) {
    if (!evalBool(ifExpr, ctx)) return false;
    el.removeAttribute('mbr-if');
  }

  const classSpec = el.getAttribute('mbr-class');
  if (classSpec != null) {
    applyMbrClass(el, classSpec, ctx);
    el.removeAttribute('mbr-class');
  }

  // mbr-theme-style="display-2" → kelas `display-2` (preset tipografi tema).
  // Mobirise mengubah atribut ini menjadi kelas saat publish; wajib agar CSS
  // .display-N dari compileTheme berlaku pada heading/teks.
  const themeStyle = el.getAttribute('mbr-theme-style');
  if (themeStyle != null) {
    for (const cls of themeStyle.split(/\s+/)) if (cls) el.classList.add(cls);
    el.removeAttribute('mbr-theme-style');
  }

  // mbr-style → style inline dari ekspresi param (ukuran logo, jarak slider, dsb.).
  const styleSpec = el.getAttribute('mbr-style');
  if (styleSpec != null) {
    applyMbrStyle(el, styleSpec, ctx);
    el.removeAttribute('mbr-style');
  }

  // Interpolasi {{}} pada nilai atribut.
  for (const [name, value] of Object.entries(el.attributes)) {
    if (value.includes('{{')) el.setAttribute(name, interpolate(value, ctx));
  }

  // Buang branding Mobirise (tautan mobiri.se, alt/title, teks kredit).
  if (!sanitizeElement(el)) return false;

  // Proses anak (salin dulu karena kita bisa menghapus).
  for (const child of [...el.childNodes]) {
    if (child.nodeType === 1) {
      const keep = processNode(child as HTMLElement, ctx);
      if (!keep) child.remove();
    } else if (child.nodeType === 3) {
      const node = child as unknown as { rawText: string };
      let text = node.rawText;
      if (text.includes('{{')) text = interpolate(text, ctx);
      node.rawText = cleanText(text);
    }
  }
  return true;
}

export function renderBlock(block: BlockInstance, paths: PathResolver): RenderedBlock {
  const schema = parseParameters(block._customHTML);
  const ctx = buildContext(schema, block._params ?? {});

  const root = parse(block._customHTML, { comment: false });
  const section = root.querySelector('section') ?? (root.childNodes[0] as HTMLElement);

  // Buang blok definisi parameter — tidak ikut ke output.
  root.querySelectorAll('mbr-parameters').forEach((p) => p.remove());

  if (section) {
    // Scope CSS: pastikan kelas cid-<cid> ada di section.
    section.classList.add(`cid-${block._cid}`);
    if (block._anchor) section.setAttribute('id', block._anchor);
    processNode(section, ctx);
  }

  let html = section ? section.outerHTML : root.innerHTML;
  html = resolvePlaceholders(html, paths);

  const css = block._styles ? compileStyles(block._styles, block._cid, ctx) : '';

  return {
    cid: block._cid,
    anchor: block._anchor ?? block._cid,
    html,
    css,
  };
}
