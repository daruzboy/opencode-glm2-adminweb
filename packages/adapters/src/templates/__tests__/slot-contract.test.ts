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

  // annotateEditable memberi id PER BLOK (tiap blok mulai dari e0) — alamat slot komposit
  // b<idx>:<id> wajib unik se-halaman. Insiden E2E 2026-07-15: tanpa ini isian stock utk
  // slot image ter-lookup ke slot text blok lain → dibuang sanitizer.
  it('editId unik se-halaman meski blok-blok punya data-edit-id sama', () => {
    const twoBlocks: SourcePage = {
      slug: 'index',
      title: 'Beranda',
      components: [
        { _cid: 'c1', _name: 'header2', _customHTML: BLOCK_HTML },
        { _cid: 'c2', _name: 'gallery1', _customHTML: BLOCK_HTML },
      ],
    };
    const c = extractPageContract(twoBlocks);
    const ids = c.slots.map((s) => s.editId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith('b0:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('b1:'))).toBe(true);
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
      fills: { 'b0:e0': { kind: 'keep' }, 'tak-ada': { kind: 'text', text: 'X' } },
    });
    const html = String(out.components[0]?._customHTML);
    expect(html).toContain('Judul Bawaan');
    expect(html).not.toContain('>X<');
  });

  // Regresi tabrakan id antar blok: isian beralamat b0:* TIDAK boleh menyentuh blok lain
  // yang kebetulan punya data-edit-id sama.
  it('alamat komposit mengunci isian ke SATU blok', () => {
    const twoBlocks: SourcePage = {
      slug: 'index',
      title: 'Beranda',
      components: [
        { _cid: 'c1', _name: 'header2', _customHTML: BLOCK_HTML },
        { _cid: 'c2', _name: 'gallery1', _customHTML: BLOCK_HTML },
      ],
    };
    const c = extractPageContract(twoBlocks);
    const judulB0 = c.slots.find((s) => s.current === 'Judul Bawaan' && s.blockIndex === 0);
    const imgB1 = c.slots.find((s) => s.kind === 'image' && s.blockIndex === 1);

    const out = applyPageFills(twoBlocks, {
      slug: 'index',
      fills: {
        [judulB0?.editId ?? '']: { kind: 'text', text: 'Hanya Blok Nol' },
        [imgB1?.editId ?? '']: { kind: 'image', url: 'https://digimaestro.id/media/t1/b1.webp', alt: 'foto b1' },
      },
    });

    const html0 = String(out.components[0]?._customHTML);
    const html1 = String(out.components[1]?._customHTML);
    // Teks hanya di blok 0; blok 1 mempertahankan judul bawaan.
    expect(html0).toContain('Hanya Blok Nol');
    expect(html1).not.toContain('Hanya Blok Nol');
    expect(html1).toContain('Judul Bawaan');
    // Gambar hanya di blok 1; blok 0 tetap gambar bawaan.
    expect(html1).toContain('https://digimaestro.id/media/t1/b1.webp');
    expect(html0).not.toContain('https://digimaestro.id/media/t1/b1.webp');
    expect(html0).toContain('assets/images/bawaan.jpg');
  });

  it('tanpa fills sama sekali → halaman apa adanya (ter-annotate)', () => {
    const out = applyPageFills(PAGE, undefined);
    expect(out.title).toBe('Beranda');
    expect(String(out.components[0]?._customHTML)).toContain('data-edit-id');
  });
});
