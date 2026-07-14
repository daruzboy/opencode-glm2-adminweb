// P2: perakit situs 'mobirise-v1'. Fixture template SINTETIS dibuat saat test (tmp dir) —
// template Mobirise asli berlisensi & di-gitignore, jadi CI tak boleh bergantung padanya.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MobiriseSiteBuilder } from '../mobirise-site-builder.js';

let root: string;

const INDEX_HTML = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="assets/web/bootstrap.min.css">
<link rel="stylesheet" href="https://cdn.example.com/x.css">
<link rel="stylesheet" href="./assets/mobirise/css/mbr-additional.css" type="text/css">
</head><body>
<script src="assets/smoothscroll/smooth-scroll.js"></script>
<script src="https://cdn.example.com/x.js"></script>
</body></html>`;

// Header tema (sebelum aturan blok .cid-*) harus dipertahankan pixel-perfect.
const ADDITIONAL_CSS = `:root{--dominant-color:#112233;}
body{font-family:UjiFont;}
.cid-lama{padding:9rem;}`;

const BLOCK = {
  _cid: 'ujicid1',
  _customHTML: `<section class="hero1" group="Hero">
<mbr-parameters>
<input type="checkbox" title="Full" name="fullScreen">
</mbr-parameters>
<div class="container"><h1 class="mbr-section-title">Judul Uji</h1>
<p class="mbr-text">Teks paragraf uji</p></div>
</section>`,
  _styles: { padding: '2rem' },
  _params: {},
};

const DOC = {
  templateId: 'tpl-uji',
  styling: { primaryColor: '#ff0000', mainFont: 'UjiFont' },
  siteFonts: [],
  pages: [
    { slug: 'index', title: 'Halaman Uji', components: [BLOCK] },
    { slug: 'kontak', title: 'Kontak Uji', components: [BLOCK] },
  ],
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tpl-uji-'));
  const tpl = join(root, 'tpl-uji');
  await mkdir(join(tpl, 'assets/mobirise/css'), { recursive: true });
  await mkdir(join(tpl, 'assets/web'), { recursive: true });
  await writeFile(join(tpl, 'index.html'), INDEX_HTML);
  await writeFile(join(tpl, 'assets/mobirise/css/mbr-additional.css'), ADDITIONAL_CSS);
  await writeFile(join(tpl, 'assets/web/bootstrap.min.css'), 'body{margin:0}');
  await writeFile(join(tpl, 'assets/web/logo.png'), PNG_BYTES); // aset BINER
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function builder() {
  return new MobiriseSiteBuilder({ templatesDir: root });
}

describe('MobiriseSiteBuilder — dokumen + folder template → berkas situs utuh', () => {
  it('merakit HTML per halaman + CSS gabungan + aset template', async () => {
    const res = await builder().build(DOC);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const paths = res.value.map((f) => f.path);

    // Satu HTML per halaman (slug 'index' → index.html; lainnya <slug>.html).
    expect(paths).toContain('index.html');
    expect(paths).toContain('kontak.html');
    // CSS gabungan ala Mobirise.
    expect(paths).toContain('assets/mobirise/css/mbr-additional.css');
    // Aset template ikut terbit; TERMASUK biner.
    expect(paths).toContain('assets/web/bootstrap.min.css');
    expect(paths).toContain('assets/web/logo.png');

    const index = res.value.find((f) => f.path === 'index.html');
    const html = String(index?.contents);
    // Konten blok ter-render (bukan template kosong).
    expect(html).toContain('Judul Uji');
    // Kerangka CSS/JS template terpasang; CDN eksternal TIDAK dibundel.
    expect(html).toContain('assets/web/bootstrap.min.css');
    expect(html).toContain('assets/smoothscroll/smooth-scroll.js');
    expect(html).not.toContain('cdn.example.com');
  });

  it('mbr-additional.css baru berisi lapisan tema template + CSS blok; versi lama tak dibundel dobel', async () => {
    const res = await builder().build(DOC);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const css = String(
      res.value.find((f) => f.path === 'assets/mobirise/css/mbr-additional.css')?.contents,
    );
    // Header tema bawaan dipertahankan (pixel-perfect)…
    expect(css).toContain('--dominant-color:#112233');
    // …tapi aturan blok LAMA tidak ikut (kita generate dari dokumen sekarang).
    expect(css).not.toContain('.cid-lama');
    // CSS blok dokumen ada (scoped ke cid blok).
    expect(css).toContain('ujicid1');
  });

  it('aset biner utuh byte-per-byte (bukan dirusak konversi utf8)', async () => {
    const res = await builder().build(DOC);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const png = res.value.find((f) => f.path === 'assets/web/logo.png');
    expect(png?.contents).toBeInstanceOf(Uint8Array);
    expect(Array.from(png?.contents as Uint8Array)).toEqual(Array.from(PNG_BYTES));
    expect(png?.contentType).toBe('image/png');
  });

  it('dokumen tak valid → BUILD error (bukan crash / render setengah jadi)', async () => {
    const res = await builder().build({ templateId: 'tpl-uji', pages: [] });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BUILD');
  });

  it('template tak ada di disk → BUILD error yang menyebut templateId', async () => {
    const res = await builder().build({ ...DOC, templateId: 'tpl-hilang' });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('BUILD');
      expect(res.error.message).toContain('tpl-hilang');
    }
  });
});
