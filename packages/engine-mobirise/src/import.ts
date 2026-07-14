// Impor SITUS STATIS (HTML/CSS/JS sembarang) ke model blok editor.
//
// Editor bekerja dengan "halaman = tumpukan blok". Situs statis biasa tidak punya konsep
// blok, tapi hampir selalu tersusun sebagai deretan bagian besar di dalam <body>
// (<header>, <section>, <footer>, atau <div> pembungkus). Jadi tiap ELEMEN TOP-LEVEL di
// dalam <body> kita perlakukan sebagai satu blok.
//
// Setelah jadi blok, seluruh mesin yang sudah ada langsung berlaku: teks & gambar bisa
// diedit (annotateEditable), blok bisa diurutkan/dihapus/diduplikasi, dan blok katalog
// Mobirise bisa disisipkan di antaranya.
//
// Styling situs impor datang dari CSS-nya sendiri (dipakai sebagai baseStylesheets) —
// BUKAN dari compileTheme. Karena itu blok hasil impor tidak punya `_styles`.

import { parse, type HTMLElement } from 'node-html-parser';

export interface ImportedBlock {
  /** Nama tampilan blok, mis. 'section-2' / 'header'. */
  readonly name: string;
  /** HTML elemen top-level apa adanya. */
  readonly customHTML: string;
  /** id asli elemen (bila ada) — dipertahankan agar CSS/anchor situs tetap cocok. */
  readonly anchor?: string;
}

export interface ImportedPage {
  readonly title: string;
  readonly blocks: readonly ImportedBlock[];
  /** href <link rel=stylesheet> lokal, apa adanya (mis. 'css/style.css'). */
  readonly stylesheets: readonly string[];
  /** src <script> lokal, apa adanya. */
  readonly scripts: readonly string[];
  /** <style> inline yang ada di dokumen — dipertahankan agar tampilan tak berubah. */
  readonly inlineCss: string;
  /** href favicon bila ada. */
  readonly favicon?: string;
}

const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'link', 'base']);

// Tag "berjenis blok": pembungkus tata letak, bukan konten teks/heading. Dipakai untuk
// membedakan wrapper tata letak (boleh ditembus) dari section konten (jangan dipecah).
const BLOCKISH_TAGS = new Set([
  'section', 'div', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'form', 'ul', 'ol',
]);

/** Elemen anak yang layak jadi blok (punya isi terlihat). */
function blockCandidates(container: HTMLElement): HTMLElement[] {
  return container.childNodes.filter((n) => {
    if (n.nodeType !== 1) return false;
    const el = n as HTMLElement;
    const tag = el.rawTagName?.toLowerCase();
    if (!tag || SKIP_TAGS.has(tag)) return false;
    // Buang pembungkus kosong (mis. div analytics).
    return el.text.trim().length > 0 || el.querySelector('img, svg, video, iframe') != null;
  }) as HTMLElement[];
}

/**
 * Pilih kontainer yang paling masuk akal untuk dipecah.
 * Banyak situs membungkus semuanya dalam SATU div (`#root`, `.wrapper`, `main`) — kadang
 * BERLAPIS (`#root > .page > section…`). Selama sebuah kontainer hanya berisi satu
 * kandidat, kita tembus wrapper tunggal itu dan lihat isinya; berhenti begitu menemukan
 * level dengan >1 kandidat (di situlah blok-blok sebenarnya berada). Tanpa ini, situs
 * berbungkus ganda akan jadi satu blok raksasa yang tak berguna.
 */
function hasBlockishChild(el: HTMLElement): boolean {
  return blockCandidates(el).some((c) => BLOCKISH_TAGS.has(c.rawTagName?.toLowerCase() ?? ''));
}

function pickContainer(body: HTMLElement): HTMLElement {
  let container = body;
  for (let depth = 0; depth < 5; depth++) {
    const kids = blockCandidates(container);
    // Tembus wrapper tunggal HANYA bila isinya elemen berjenis blok (tata letak) —
    // section berisi teks/heading dibiarkan utuh sebagai satu blok.
    if (kids.length === 1 && hasBlockishChild(kids[0]!)) {
      container = kids[0]!;
      continue;
    }
    break;
  }
  return container;
}

// Nama blok dari tag/kelas/id — supaya daftar blok di editor terbaca manusia.
function nameFor(el: HTMLElement, index: number): string {
  const tag = el.rawTagName?.toLowerCase() ?? 'blok';
  const id = el.getAttribute('id');
  if (id) return id;
  const cls = (el.classNames ?? '').split(/\s+/).filter(Boolean)[0];
  if (cls) return `${tag}-${cls}`;
  return `${tag}-${index + 1}`;
}

function localHrefs(root: HTMLElement, selector: string, attr: string): string[] {
  const out: string[] = [];
  for (const el of root.querySelectorAll(selector)) {
    const v = el.getAttribute(attr);
    // Hanya aset LOKAL; CDN/absolut dibiarkan apa adanya di HTML blok.
    if (!v || /^(https?:)?\/\//.test(v) || v.startsWith('data:')) continue;
    out.push(v.replace(/^\.\//, ''));
  }
  return out;
}

/** Parse satu dokumen HTML statis menjadi halaman berisi blok. */
export function importStaticSite(html: string): ImportedPage {
  const root = parse(html, { comment: false });

  const title = root.querySelector('title')?.text.trim() || 'Situs Impor';
  const stylesheets = localHrefs(root, 'link[rel~="stylesheet"]', 'href');
  const scripts = localHrefs(root, 'script[src]', 'src');
  const inlineCss = root
    .querySelectorAll('style')
    .map((s) => s.text)
    .join('\n')
    .trim();

  const iconEl =
    root.querySelector('link[rel="icon"]') ?? root.querySelector('link[rel="shortcut icon"]');
  const favicon = iconEl?.getAttribute('href')?.replace(/^\.\//, '') || undefined;

  const body = (root.querySelector('body') ?? root) as HTMLElement;
  const container = pickContainer(body);

  const blocks: ImportedBlock[] = blockCandidates(container).map((el, i) => ({
    name: nameFor(el, i),
    customHTML: el.outerHTML,
    anchor: el.getAttribute('id') || undefined,
  }));

  // Cadangan: HTML tanpa elemen bagian (mis. isi teks langsung di body) tetap bisa diimpor
  // — seluruh isi body dibungkus jadi satu blok agar impor tak pernah gagal keras.
  if (blocks.length === 0) {
    const inner = body.innerHTML.trim();
    if (inner) blocks.push({ name: 'konten', customHTML: `<section>${inner}</section>` });
  }

  return { title, blocks, stylesheets, scripts, inlineCss, favicon };
}
