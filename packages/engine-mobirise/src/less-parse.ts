// Parser LESS → StyleTree (format _styles Mobirise). Blok tema menyimpan style.less
// MENTAH; project.mobirise menyimpannya sebagai JSON bersarang. Ini melakukan konversi
// yang sama seperti Mobirise saat memuat blok tema, agar compileStyles bisa merendernya.
//
// Struktur: `selector { prop: val; nested {..} }`, guard `& when (...)`, `@media (...)`.
// Kunci objek = selektor/guard/media; nilai string = deklarasi CSS.

import type { StyleTree } from './styles.js';

// Buang komentar /* */ dan // (baris). Tak ada URL // di style.less tema.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function flushDecl(buffer: string, tree: StyleTree): void {
  const s = buffer.trim();
  if (!s) return;
  const idx = s.indexOf(':');
  if (idx === -1) return;
  const prop = s.slice(0, idx).trim();
  const val = s.slice(idx + 1).trim();
  if (prop) tree[prop] = val;
}

// Parse mulai posisi `pos` (setelah `{`), kembalikan subtree + posisi setelah `}`.
function parseBlock(src: string, pos: number): { tree: StyleTree; pos: number } {
  const tree: StyleTree = {};
  let buffer = '';
  while (pos < src.length) {
    const ch = src[pos]!;
    if (ch === '{') {
      const prelude = buffer.trim();
      const inner = parseBlock(src, pos + 1);
      if (prelude) {
        // Selektor kembar (jarang) → gabung.
        const existing = tree[prelude];
        tree[prelude] =
          existing && typeof existing === 'object' ? { ...existing, ...inner.tree } : inner.tree;
      }
      buffer = '';
      pos = inner.pos;
    } else if (ch === '}') {
      flushDecl(buffer, tree);
      return { tree, pos: pos + 1 };
    } else if (ch === ';') {
      flushDecl(buffer, tree);
      buffer = '';
      pos += 1;
    } else {
      buffer += ch;
      pos += 1;
    }
  }
  flushDecl(buffer, tree);
  return { tree, pos };
}

export function parseLess(lessText: string): StyleTree {
  return parseBlock(stripComments(lessText), 0).tree;
}
