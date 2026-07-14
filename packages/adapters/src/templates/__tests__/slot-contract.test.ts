// P3: kontrak slot — LLM mengisi NILAI bernama, bukan HTML. Round-trip ekstrak→isi harus
// mempertahankan struktur blok (kalau rusak di sini, SEMUA situs hasil AI rusak).

import { describe, expect, it } from 'vitest';
import { applyPageFills, extractPageContract } from '../slot-contract.js';
import type { SourcePage } from '../template-source.js';

const BLOCK_HTML = `<section class="header2" group="Hero">
<mbr-parameters><input type="checkbox" title="Full" name="fullScreen"></mbr-parameters>
<div class="container">
<h1 class="mbr-section-title">Judul Bawaan</h1>
<p class="mbr-text">Teks bawaan template</p>
<div mbr-buttons="true"><a class="btn" href="#kontak"><span class="icon"></span>Hubungi</a></div>
<img src="assets/images/bawaan.jpg" alt="Foto bawaan">
</div></section>`;

const PAGE: SourcePage = {
  slug: 'index',
  title: 'Beranda',
  components: [{ _cid: 'c1', _name: 'header2', _customHTML: BLOCK_HTML }],
};

describe('extractPageContract', () => {
  it('menemukan slot teks, tautan/tombol, dan gambar — dengan hint & isi bawaan', () => {
    const c = extractPageContract(PAGE);

    const kinds = c.slots.map((s) => s.kind).sort();
    expect(kinds).toContain('text');
    expect(kinds).toContain('link');
    expect(kinds).toContain('image');

    const judul = c.slots.find((s) => s.current === 'Judul Bawaan');
    expect(judul?.kind).toBe('text');
    expect(judul?.hint).toContain('header2');

    const img = c.slots.find((s) => s.kind === 'image');
    expect(img?.current).toBe('assets/images/bawaan.jpg');
  });

  it('deterministik: dua ekstraksi menghasilkan editId yang sama (materialize & editor bergantung padanya)', () => {
    const a = extractPageContract(PAGE);
    const b = extractPageContract(PAGE);
    expect(a.slots.map((s) => s.editId)).toEqual(b.slots.map((s) => s.editId));
  });
});

describe('applyPageFills', () => {
  it('mengisi teks/gambar/tautan; slot tanpa isian MEMPERTAHANKAN isi template', () => {
    const c = extractPageContract(PAGE);
    const judul = c.slots.find((s) => s.current === 'Judul Bawaan');
    const img = c.slots.find((s) => s.kind === 'image');
    const btn = c.slots.find((s) => s.kind === 'link');

    const out = applyPageFills(PAGE, {
      slug: 'index',
      title: 'Sewabos — Rental Mobil',
      fills: {
        [judul?.editId ?? '']: { kind: 'text', text: 'Sewabos Rental' },
        [img?.editId ?? '']: {
          kind: 'image',
          url: 'https://digimaestro.id/media/t1/foto.webp',
          alt: 'Armada Sewabos',
        },
        [btn?.editId ?? '']: { kind: 'link', href: 'https://wa.me/628991213280', label: 'Chat WA' },
      },
    });

    const html = String(out.components[0]?._customHTML);
    expect(out.title).toBe('Sewabos — Rental Mobil');
    expect(html).toContain('Sewabos Rental');
    expect(html).not.toContain('Judul Bawaan');
    expect(html).toContain('https://digimaestro.id/media/t1/foto.webp');
    expect(html).toContain('alt="Armada Sewabos"');
    expect(html).toContain('https://wa.me/628991213280');
    expect(html).toContain('Chat WA');
    // Ikon di dalam tombol TIDAK terhapus oleh penggantian teks (setEditableText).
    expect(html).toContain('class="icon"');
    // Slot yang tak diisi tetap utuh.
    expect(html).toContain('Teks bawaan template');
    // Struktur blok tak berubah.
    expect(html).toContain('mbr-parameters');
    expect(html).toContain('class="container"');
  });

  it("kind 'keep' & editId asing → tidak mengubah apa pun", () => {
    const out = applyPageFills(PAGE, {
      slug: 'index',
      fills: { e0: { kind: 'keep' }, 'tak-ada': { kind: 'text', text: 'X' } },
    });
    const html = String(out.components[0]?._customHTML);
    expect(html).toContain('Judul Bawaan');
    expect(html).not.toContain('>X<');
  });

  it('tanpa fills sama sekali → halaman apa adanya (ter-annotate)', () => {
    const out = applyPageFills(PAGE, undefined);
    expect(out.title).toBe('Beranda');
    expect(String(out.components[0]?._customHTML)).toContain('data-edit-id');
  });
});
