// Dukungan edit teks inline. Mobirise menyimpan teks hasil edit LANGSUNG di _customHTML
// (bukan sebagai param) — direktif binding (mbr-if dsb.) hidup berdampingan dengan teks.
// Agar editor bisa menulis balik hasil edit ke titik yang tepat, tiap elemen editable
// diberi `data-edit-id` stabil sekali saat blok dimuat. Id itu ikut ke output render,
// sehingga saat user mengedit elemen ber-id X, kita temukan elemen yang sama di template
// dan ganti isinya.

import { parse, type HTMLElement } from 'node-html-parser';
import { isBrandLink } from './branding.js';

// Teks yang dapat diedit.
//
// KUNCI: Mobirise menandai SETIAP teks bertema dengan kelas `mbr-fonts-style` (judul
// kartu, deskripsi, tanggal, daftar, …) — bukan hanya .mbr-text/.mbr-section-title.
// Memakai kelas spesifik saja membuat sebagian besar teks TAK bisa diedit (mis. blok
// features: hanya 1 dari 7 elemen tertangkap). Jadi `mbr-fonts-style` adalah selektor
// utamanya; sisanya jaring pengaman untuk blok yang tak memakainya (mis. menu).
const EDITABLE_SELECTORS = [
  '.mbr-fonts-style',
  '.mbr-text',
  '.mbr-section-title',
  '.mbr-section-subtitle',
  '.mbr-label',
  '.mbr-list-title',
  // Menu: nama brand & tautan navigasi.
  '.navbar-caption',
  '.nav-link',
];

// Tautan tombol (dalam grup [mbr-buttons] maupun .btn lepas) editable teksnya.
const EDITABLE_BUTTON = '[mbr-buttons] a, a.btn';

// Elemen MEDIA yang bisa diganti (klik ganda di kanvas → pustaka media).
const EDITABLE_MEDIA = ['img', 'video'];

export function editableSelector(): string {
  return [...EDITABLE_SELECTORS, EDITABLE_BUTTON, ...EDITABLE_MEDIA].join(', ');
}

// Kandidat editable, dirapikan:
//  • Daftar (<ul>/<ol>) dipecah jadi tiap <li> → user mengedit ITEM, bukan HTML mentah.
//  • Bila sebuah kandidat MENGANDUNG kandidat lain, ambil yang TERDALAM saja — mencegah
//    pembungkus ikut jadi contenteditable dan merusak struktur blok.
function editableTargets(root: HTMLElement): HTMLElement[] {
  const raw = root.querySelectorAll(editableSelector());

  const expanded: HTMLElement[] = [];
  for (const el of raw) {
    const tag = el.rawTagName?.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      const items = el.querySelectorAll('li');
      if (items.length > 0) {
        expanded.push(...items);
        continue;
      }
    }
    expanded.push(el);
  }

  // Buang PEMBUNGKUS: bila kandidat lain punya leluhur di antara kandidat, leluhur itu
  // dibuang. (node-html-parser tak punya contains(), jadi telusuri parentNode.)
  const all = new Set(expanded);
  const wrappers = new Set<HTMLElement>();
  for (const el of expanded) {
    let p = el.parentNode as HTMLElement | null;
    while (p) {
      if (all.has(p)) wrappers.add(p);
      p = p.parentNode as HTMLElement | null;
    }
  }

  return expanded.filter((el) => {
    const tag = el.rawTagName?.toLowerCase();
    if (tag === 'img' || tag === 'video') return true; // media selalu ikut
    return !wrappers.has(el);
  });
}

// Beri data-edit-id unik pada tiap elemen editable yang belum punya. Kembalikan
// _customHTML termodifikasi (id disematkan permanen; tak mengganggu render/publish).
export function annotateEditable(customHTML: string): string {
  const root = parse(customHTML, { comment: true });
  const targets = editableTargets(root);

  // Id yang SUDAH terpakai dipertahankan; id baru dipilih agar tak bertabrakan.
  // (Penting: daftar selektor bisa bertambah — mis. media — sehingga penomoran
  // berurutan naif akan menabrak id lama pada dokumen yang sudah tersimpan.)
  const used = new Set<string>();
  for (const el of root.querySelectorAll('[data-edit-id]')) {
    const id = el.getAttribute('data-edit-id');
    if (id) used.add(id);
  }

  let n = 0;
  let changed = false;
  for (const el of targets) {
    if (el.getAttribute('data-edit-id')) continue;
    let id: string;
    do {
      id = `e${n++}`;
    } while (used.has(id));
    used.add(id);
    el.setAttribute('data-edit-id', id);
    changed = true;
  }
  return changed ? root.toString() : customHTML;
}

// Tulis balik isi HTML sebuah elemen editable (dikenali data-edit-id) ke _customHTML.
export function setEditableContent(customHTML: string, editId: string, innerHTML: string): string {
  const root = parse(customHTML, { comment: true });
  const el = root.querySelector(`[data-edit-id="${editId}"]`) as HTMLElement | null;
  if (!el) return customHTML;
  el.set_content(innerHTML);
  return root.toString();
}

// Daftar id editable pada sebuah blok (untuk introspeksi bila perlu).
export function editableIds(customHTML: string): string[] {
  const root = parse(customHTML, { comment: false });
  return root
    .querySelectorAll('[data-edit-id]')
    .map((e) => e.getAttribute('data-edit-id')!)
    .filter(Boolean);
}

// ── Tautan/tombol ────────────────────────────────────────────────────────────
// Info tiap tombol/tautan editable dalam blok, untuk panel pengaturan tautan.
export interface LinkInfo {
  readonly editId: string;
  readonly text: string;
  readonly href: string;
  /** true bila target="_blank" (buka di tab baru). */
  readonly newWindow: boolean;
}

export function listLinks(customHTML: string): LinkInfo[] {
  const root = parse(customHTML, { comment: false });
  return root
    .querySelectorAll('a[data-edit-id]')
    .map((el) => {
      const raw = el.getAttribute('href') ?? '';
      // Tautan placeholder Mobirise dianggap "belum diisi" (dibersihkan saat render).
      const href = isBrandLink(raw) || raw === '#' ? '' : raw;
      return {
        editId: el.getAttribute('data-edit-id')!,
        text: el.text.trim(),
        href,
        newWindow: el.getAttribute('target') === '_blank',
      };
    })
    .filter((l) => l.editId);
}

// ── Teks editable ────────────────────────────────────────────────────────────
// Semua teks yang bisa disunting dalam blok, untuk panel "Teks" di inspektur.
export interface TextField {
  readonly editId: string;
  /** Label ramah: Judul / Teks / Label / Tombol / … */
  readonly label: string;
  /** Isi HTML elemen (biasanya teks polos). */
  readonly html: string;
  /** true bila elemen tombol/tautan (teksnya pendek). */
  readonly isButton: boolean;
}

function labelFor(el: HTMLElement): string {
  const cls = el.classNames ?? '';
  const tag = el.rawTagName?.toLowerCase();
  // Kelas diperiksa DULU: nav-link/navbar-caption juga <a>, jadi cek tag lebih awal
  // akan salah melabelinya sebagai "Tombol".
  if (cls.includes('navbar-caption')) return 'Nama brand';
  if (cls.includes('nav-link')) return 'Tautan menu';
  if (tag === 'a') return 'Tombol';
  if (cls.includes('mbr-section-title')) return 'Judul';
  if (cls.includes('mbr-section-subtitle')) return 'Subjudul';
  if (cls.includes('mbr-list-title')) return 'Judul daftar';
  if (cls.includes('mbr-label')) return 'Label';
  if (cls.includes('card-title')) return 'Judul kartu';
  if (cls.includes('card-subtitle')) return 'Subjudul kartu';
  if (cls.includes('card-desc') || cls.includes('card-text')) return 'Teks kartu';
  if (cls.includes('card-date')) return 'Tanggal';
  if (cls.includes('navbar-caption')) return 'Nama brand';
  if (cls.includes('nav-link')) return 'Tautan menu';
  if (tag === 'li') return 'Item daftar';
  if (cls.includes('mbr-text')) return 'Teks';
  if (tag && /^h[1-6]$/.test(tag)) return 'Judul';
  return 'Teks';
}

export function listTexts(customHTML: string): TextField[] {
  const root = parse(customHTML, { comment: false });
  const out: TextField[] = [];
  for (const el of root.querySelectorAll('[data-edit-id]')) {
    const tag = el.rawTagName?.toLowerCase();
    if (tag === 'img' || tag === 'video') continue; // media, bukan teks
    const editId = el.getAttribute('data-edit-id');
    if (!editId) continue;
    const isButton = tag === 'a';
    out.push({
      editId,
      label: labelFor(el as HTMLElement),
      // Tombol biasanya berisi <span> IKON + teks. Menampilkan innerHTML akan membocorkan
      // markup ikon ke panel — dan menyimpannya kembali bisa menghapus ikonnya. Jadi untuk
      // tombol kita tampilkan TEKS polos, dan menyimpannya lewat setEditableText().
      html: isButton ? el.text.trim() : el.innerHTML.trim(),
      isButton,
    });
  }
  return out;
}

// Ganti hanya TEKS sebuah elemen; elemen anak (mis. <span> ikon tombol) DIPERTAHANKAN.
// Dipakai panel Teks untuk tombol, supaya ikon tak ikut terhapus saat teksnya diubah.
export function setEditableText(customHTML: string, editId: string, text: string): string {
  const root = parse(customHTML, { comment: true });
  const el = root.querySelector(`[data-edit-id="${editId}"]`) as HTMLElement | null;
  if (!el) return customHTML;

  // Buang seluruh simpul teks langsung, sisakan elemen anak.
  for (const child of [...el.childNodes]) {
    if (child.nodeType === 3) child.remove();
  }
  // Sisipkan teks baru sesudah elemen anak (ikon biasanya di depan teks).
  const keep = el.innerHTML;
  el.set_content(`${keep}${text}`);
  return root.toString();
}

// Set/hapus atribut pada elemen editable (mis. href/target tombol).
// Nilai null → atribut dihapus.
export function setEditableAttrs(
  customHTML: string,
  editId: string,
  attrs: Record<string, string | null>,
): string {
  const root = parse(customHTML, { comment: true });
  const el = root.querySelector(`[data-edit-id="${editId}"]`) as HTMLElement | null;
  if (!el) return customHTML;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
  return root.toString();
}
