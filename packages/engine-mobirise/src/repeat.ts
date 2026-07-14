// Item BERULANG di dalam blok (mis. 3 kartu bersaudara). Dideteksi otomatis, lalu
// user bisa menambah/mengurangi item dari panel "Pengaturan blok".
//
// Deteksi: sebuah kontainer dianggap "repeater" bila punya ≥2 anak-elemen yang
// STRUKTURNYA sama — tag sama + tanda-tangan kelas sama. Kontainernya ditandai
// `data-repeat-id` agar bisa dirujuk stabil (seperti data-edit-id untuk teks).

import { parse, type HTMLElement } from 'node-html-parser';

export interface RepeaterInfo {
  readonly repeatId: string;
  /** Label ramah, mis. "Kartu" / "Item" / "Slide". */
  readonly label: string;
  readonly count: number;
}

// Tanda-tangan struktur sebuah elemen: tag + daftar kelas terurut.
function signature(el: HTMLElement): string {
  const tag = el.rawTagName?.toLowerCase() ?? '';
  const cls = (el.classNames ?? '').split(/\s+/).filter(Boolean).sort().join('.');
  return `${tag}|${cls}`;
}

function elementChildren(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter((n) => n.nodeType === 1) as HTMLElement[];
}

// Label dari kelas anak (card/item/slide) — supaya UI bicara bahasa user.
function labelFrom(child: HTMLElement): string {
  const cls = (child.classNames ?? '').toLowerCase();
  if (cls.includes('card')) return 'Kartu';
  if (cls.includes('slide')) return 'Slide';
  if (child.rawTagName?.toLowerCase() === 'li') return 'Item daftar';
  return 'Item';
}

// Kontainer berulang: ≥2 anak dengan tanda-tangan SAMA, dan anak itu punya isi.
function findRepeaters(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    const kids = elementChildren(el);
    if (kids.length >= 2) {
      const sig = signature(kids[0]!);
      const same = kids.every((k) => signature(k) === sig);
      // Abaikan anak kosong / pembungkus tanpa isi (mis. spacer).
      const hasContent = kids.some((k) => k.text.trim().length > 0 || k.querySelector('img'));
      if (same && sig !== '|' && hasContent) out.push(el);
    }
    for (const k of kids) walk(k);
  };
  walk(root);
  return out;
}

// Tandai kontainer berulang dengan data-repeat-id (idempoten).
export function annotateRepeaters(customHTML: string): string {
  const root = parse(customHTML, { comment: true });
  const used = new Set<string>();
  for (const el of root.querySelectorAll('[data-repeat-id]')) {
    const id = el.getAttribute('data-repeat-id');
    if (id) used.add(id);
  }

  let n = 0;
  let changed = false;
  for (const el of findRepeaters(root)) {
    if (el.getAttribute('data-repeat-id')) continue;
    let id: string;
    do {
      id = `r${n++}`;
    } while (used.has(id));
    used.add(id);
    el.setAttribute('data-repeat-id', id);
    changed = true;
  }
  return changed ? root.toString() : customHTML;
}

export function listRepeaters(customHTML: string): RepeaterInfo[] {
  const root = parse(customHTML, { comment: false });
  const out: RepeaterInfo[] = [];
  for (const el of root.querySelectorAll('[data-repeat-id]')) {
    const repeatId = el.getAttribute('data-repeat-id');
    if (!repeatId) continue;
    const kids = elementChildren(el as HTMLElement);
    if (kids.length === 0) continue;
    out.push({ repeatId, label: labelFrom(kids[0]!), count: kids.length });
  }
  return out;
}

// Tambah item: klon anak TERAKHIR. data-edit-id dibuang agar annotateEditable memberi
// id baru (kalau tidak, dua elemen berbagi id → edit satu ikut mengubah yang lain).
export function addRepeatItem(customHTML: string, repeatId: string): string {
  const root = parse(customHTML, { comment: true });
  const container = root.querySelector(`[data-repeat-id="${repeatId}"]`) as HTMLElement | null;
  if (!container) return customHTML;
  const kids = elementChildren(container);
  const last = kids[kids.length - 1];
  if (!last) return customHTML;

  const clone = parse(last.outerHTML, { comment: true }).firstChild as HTMLElement;
  if (!clone) return customHTML;
  for (const el of clone.querySelectorAll('[data-edit-id]')) el.removeAttribute('data-edit-id');
  clone.removeAttribute('data-edit-id');

  container.appendChild(clone);
  return root.toString();
}

// Kurangi item: buang anak TERAKHIR (sisakan minimal 1).
export function removeRepeatItem(customHTML: string, repeatId: string): string {
  const root = parse(customHTML, { comment: true });
  const container = root.querySelector(`[data-repeat-id="${repeatId}"]`) as HTMLElement | null;
  if (!container) return customHTML;
  const kids = elementChildren(container);
  if (kids.length <= 1) return customHTML;
  kids[kids.length - 1]!.remove();
  return root.toString();
}
