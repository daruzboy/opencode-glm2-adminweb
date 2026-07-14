import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalExpr, evalBool } from './expr.js';
import { compileStyles } from './styles.js';
import { renderBlock, type BlockInstance } from './render.js';
import { compileTheme } from './theme.js';
import { lighten, contrast } from './color.js';
import {
  annotateEditable,
  setEditableContent,
  setEditableText,
  editableIds,
  listTexts,
} from './editable.js';
import { exportSite } from './export.js';
import { renderPage } from './page.js';
import { parseLess } from './less-parse.js';
import { instantiateBlock } from './instantiate.js';
import { importStaticSite } from './import.js';
import type { ThemeStyling } from './theme.js';

const SAMPLE_STYLING: ThemeStyling = {
  primaryColor: '#e2fa0e',
  secondaryColor: '#8476f5',
  successColor: '#2bb59b',
  infoColor: '#f2f2f2',
  warningColor: '#ff8b38',
  dangerColor: '#e3696a',
  mainFont: 'Hubot Sans',
  display1Font: 'Hubot Sans',
  display1Size: 7,
  display2Font: 'Hubot Sans',
  display2Size: 5.8,
  display4Font: 'Hubot Sans',
  display4Size: 1.2,
  display5Font: 'Hubot Sans',
  display5Size: 2.4,
  display7Font: 'Hubot Sans',
  display7Size: 1.6,
};

test('evalExpr: perbandingan & logika', () => {
  assert.equal(evalBool("bg.type == 'color'", { bg: { type: 'color' } }), true);
  assert.equal(evalBool("bg.type !== 'color'", { bg: { type: 'image' } }), true);
  assert.equal(evalBool('overlay && bg.type !== \'color\'', { overlay: true, bg: { type: 'image' } }), true);
  assert.equal(evalBool('fullScreen == false', { fullScreen: false }), true);
  assert.equal(evalExpr('paddingTop', { paddingTop: 5 }), 5);
});

test('compileStyles: guard when + aritmetika + scope cid', () => {
  const styles = {
    '& when not (@fullScreen)': { 'padding-top': '(@paddingTop * 1rem)' },
    "& when (@bg-type = 'color')": { 'background-color': '@bg-value' },
    '.card': { 'justify-content': 'center' },
  };
  const css = compileStyles(styles, 'ABC', { fullScreen: false, paddingTop: 5, bg: { type: 'color', value: '#000' } });
  assert.match(css, /\.cid-ABC \{[^}]*padding-top: 5rem/s);
  assert.match(css, /background-color: #000/);
  assert.match(css, /\.cid-ABC \.card \{\s*justify-content: center/);
});

test('compileStyles: guard dgn keyword telanjang (@position = right)', () => {
  // Di LESS, kata telanjang di guard adalah NILAI, bukan variabel. Dulu `right`
  // dikira nama variabel → undefined → guard selalu gagal (tombol WA salah posisi).
  const styles = {
    '.fab': {
      '& when (@position = right)': { right: '24px' },
      '& when (@position = left)': { left: '24px' },
    },
  };
  const kanan = compileStyles(styles, 'P1', { position: 'right' });
  assert.match(kanan, /\.cid-P1 \.fab \{\s*right: 24px/);
  assert.doesNotMatch(kanan, /left: 24px/);

  const kiri = compileStyles(styles, 'P1', { position: 'left' });
  assert.match(kiri, /left: 24px/);
  assert.doesNotMatch(kiri, /right: 24px/);
});

test('compileStyles: guard dgn angka tidak rusak oleh penanda internal', () => {
  const styles = { '& when (@cols > 2) and (@show)': { display: 'grid' } };
  assert.match(compileStyles(styles, 'N1', { cols: 3, show: true }), /display: grid/);
  assert.doesNotMatch(compileStyles(styles, 'N1', { cols: 1, show: true }), /display: grid/);
  assert.doesNotMatch(compileStyles(styles, 'N1', { cols: 3, show: false }), /display: grid/);
});

test('compileStyles: guard false → aturan tidak muncul', () => {
  const css = compileStyles({ "& when (@bg-type = 'image')": { 'background-image': 'url(@bg-value)' } }, 'X', {
    bg: { type: 'color', value: '#fff' },
  });
  assert.doesNotMatch(css, /background-image/);
});

test('renderBlock: mbr-if buang node, mbr-theme-style → kelas', () => {
  const block: BlockInstance = {
    _cid: 'Z1',
    _customHTML:
      '<section class="hero"><mbr-parameters><input type="checkbox" name="showTitle" checked></mbr-parameters>' +
      '<h2 mbr-theme-style="display-2" mbr-if="showTitle">Judul</h2>' +
      '<p mbr-if="showText">Teks</p></section>',
    _params: { showTitle: true, showText: false },
  };
  const r = renderBlock(block, { themePath: 't', projectPath: 'p' });
  assert.match(r.html, /class="hero cid-Z1"/);
  assert.match(r.html, /<h2 class="display-2">Judul<\/h2>/);
  assert.doesNotMatch(r.html, /Teks/); // showText=false → dibuang
  assert.doesNotMatch(r.html, /mbr-parameters/); // panel param dibuang
});

test('renderBlock: mbr-class dgn kunci berisi >1 kelas (d-none d-lg-flex)', () => {
  // Tema Mobirise asli memakai mbr-class yang kuncinya beberapa kelas sekaligus.
  // classList.add menolak string berspasi → dulu melempar; kini dipecah per token.
  const block: BlockInstance = {
    _cid: 'C1',
    _customHTML:
      '<section><div mbr-class="{\'d-none d-lg-flex\': isDesktop, \'hidden\': never}">x</div></section>',
    _params: { isDesktop: true, never: false },
  };
  const r = renderBlock(block, { themePath: 't', projectPath: 'p' });
  assert.match(r.html, /class="d-none d-lg-flex"/);
  assert.doesNotMatch(r.html, /hidden/);
});

test('renderBlock: mbr-style → style inline dari param (ukuran logo, jarak slider)', () => {
  // mbr-style dipakai 74 dari 134 blok pustaka; tanpa dukungan ini banyak param
  // (mis. Logo Size) tampak "tidak berpengaruh".
  const block: BlockInstance = {
    _cid: 'S1',
    _customHTML:
      '<section><img src="logo.png" mbr-style="{\'height\': logoSize + \'rem\'}">' +
      '<div style="color:red" mbr-style="{\'margin-left\': gap + \'px\', \'margin-right\': gap + \'px\'}"></div>' +
      '</section>',
    _params: { logoSize: 3.8, gap: 12 },
  };
  const r = renderBlock(block, { themePath: 't', projectPath: 'p' });
  assert.match(r.html, /<img[^>]*style="height: 3\.8rem;"/);
  // style yang sudah ada dipertahankan, bukan ditimpa.
  assert.match(r.html, /style="color:red; margin-left: 12px; margin-right: 12px;"/);
  assert.doesNotMatch(r.html, /mbr-style/); // direktif dibuang dari keluaran
});

test('color: lighten & contrast (LESS-compatible)', () => {
  // Primer terang → teks gelap; sekunder gelap → teks terang.
  assert.equal(contrast('#e2fa0e'), '#000000');
  assert.equal(contrast('#8476f5'), '#ffffff');
  // lighten menaikkan lightness.
  assert.notEqual(lighten('#e2fa0e', 8), '#e2fa0e');
});

test('compileTheme: hasilkan display preset & warna tombol', () => {
  const css = compileTheme({
    primaryColor: '#e2fa0e',
    secondaryColor: '#8476f5',
    successColor: '#2bb59b',
    infoColor: '#f2f2f2',
    warningColor: '#ff8b38',
    dangerColor: '#e3696a',
    mainFont: 'Hubot Sans',
    display1Font: 'Hubot Sans',
    display1Size: 7,
    display2Font: 'Hubot Sans',
    display2Size: 5.8,
    display4Font: 'Hubot Sans',
    display4Size: 1.2,
    display5Font: 'Hubot Sans',
    display5Size: 2.4,
    display7Font: 'Hubot Sans',
    display7Size: 1.6,
  });
  assert.match(css, /\.display-2 \{[^}]*font-size: 5\.8rem/s);
  assert.match(css, /\.btn-primary[^{]*\{[^}]*background-color: #e2fa0e !important/s);
  assert.match(css, /body \{\s*font-family: Hubot Sans/);
  // Fluid typography untuk 992–1400 memakai min = 0.35*size+0.65 (display-2 → 2.68).
  assert.match(css, /2\.68rem \+ \(5\.8 - 2\.68\)/);
});

test('editable: annotate id, tulis balik isi, id bertahan', () => {
  const html =
    '<section><h2 class="mbr-section-title">Judul</h2><p class="mbr-text">Teks</p>' +
    '<div mbr-buttons><a class="btn">Tombol</a></div></section>';
  const ann = annotateEditable(html);
  const ids = editableIds(ann);
  assert.equal(ids.length, 3); // title, text, button link
  assert.ok(ids.includes('e0') && ids.includes('e2'));

  const upd = setEditableContent(ann, 'e0', 'Judul Baru');
  assert.match(upd, /Judul Baru/);
  assert.doesNotMatch(upd, />Judul</);
  // Menulis ke id tak dikenal = tidak mengubah apa pun.
  assert.equal(setEditableContent(ann, 'e9', 'x'), ann);
});

test('panel teks: tombol tampil sbg teks polos & ikonnya bertahan saat diubah', () => {
  const ann = annotateEditable(
    '<section><div mbr-buttons>' +
      '<a class="btn btn-primary" href="#"><span class="mobi-mbri mobi-mbri-right"></span>Get Started</a>' +
      '</div></section>',
  );
  const btn = listTexts(ann).find((t) => t.isButton)!;
  // Panel menampilkan TEKS, bukan markup ikon.
  assert.equal(btn.html, 'Get Started');
  assert.doesNotMatch(btn.html, /<span/);

  // Menyimpan teks baru TIDAK boleh menghapus <span> ikon.
  const upd = setEditableText(ann, btn.editId, 'Mulai Sekarang');
  assert.match(upd, /Mulai Sekarang/);
  assert.match(upd, /mobi-mbri-right/);
  assert.doesNotMatch(upd, /Get Started/);
  // Teks tetap satu (tak terduplikasi).
  assert.equal(listTexts(upd).find((t) => t.isButton)!.html, 'Mulai Sekarang');
});

test('importStaticSite: pecah body jadi blok + kumpulkan aset', () => {
  const html = `<!doctype html><html><head>
    <title>Situs Saya</title>
    <link rel="icon" href="img/fav.png">
    <link rel="stylesheet" href="css/style.css">
    <link rel="stylesheet" href="https://cdn.example.com/x.css">
    <style>.a{color:red}</style>
  </head><body>
    <header id="atas"><h1>Halo</h1></header>
    <section class="fitur"><p>Isi</p></section>
    <div class="kosong"></div>
    <footer><p>Footer</p></footer>
    <script src="js/app.js"></script>
    <script src="https://cdn.example.com/y.js"></script>
  </body></html>`;

  const page = importStaticSite(html);
  assert.equal(page.title, 'Situs Saya');
  // Tiap elemen top-level berisi jadi satu blok; pembungkus kosong dibuang.
  assert.equal(page.blocks.length, 3);
  assert.deepEqual(
    page.blocks.map((b) => b.name),
    ['atas', 'section-fitur', 'footer-3'],
  );
  assert.equal(page.blocks[0]!.anchor, 'atas'); // id asli dipertahankan
  assert.match(page.blocks[1]!.customHTML, /<section class="fitur">/);
  // Hanya aset LOKAL yang dikumpulkan; CDN dibiarkan di HTML.
  assert.deepEqual(page.stylesheets, ['css/style.css']);
  assert.deepEqual(page.scripts, ['js/app.js']);
  assert.equal(page.favicon, 'img/fav.png');
  assert.match(page.inlineCss, /color:red/);
});

test('importStaticSite: bongkar pembungkus tunggal (mis. <div class=wrapper>)', () => {
  // Banyak situs membungkus semuanya dalam satu div — kalau tidak dibongkar, seluruh
  // situs jadi SATU blok raksasa yang tak berguna di editor.
  const html =
    '<body><div class="wrapper">' +
    '<section><h1>A</h1></section><section><h1>B</h1></section><section><h1>C</h1></section>' +
    '</div></body>';
  const page = importStaticSite(html);
  assert.equal(page.blocks.length, 3);
});

test('importStaticSite: tembus pembungkus BERLAPIS (#root > .page > section…)', () => {
  // Situs hasil builder/framework kerap membungkus ganda. Harus tembus sampai level
  // section, bukan berhenti di lapis pertama (yang menghasilkan 1 blok raksasa).
  const html =
    '<body><div id="root"><div class="page">' +
    '<section>1</section><section>2</section><section>3</section>' +
    '</div></div></body>';
  const page = importStaticSite(html);
  assert.equal(page.blocks.length, 3);
});

test('importStaticSite: section berisi teks TIDAK dipecah jadi heading + paragraf', () => {
  // Pembungkus tata letak boleh ditembus, tapi section konten harus utuh satu blok.
  const html = '<body><div class="wrap"><section><h1>Judul</h1><p>Isi</p></section></div></body>';
  const page = importStaticSite(html);
  assert.equal(page.blocks.length, 1);
});

test('importStaticSite: body tanpa elemen bagian → tetap 1 blok (tak gagal keras)', () => {
  const page = importStaticSite('<body>Halo dunia tanpa elemen blok</body>');
  assert.equal(page.blocks.length, 1);
  assert.match(page.blocks[0]!.customHTML, /Halo dunia/);
});

test('renderPage: globalInsert menyisipkan kode di 5 posisi + lang', () => {
  const block: BlockInstance = { _cid: 'G1', _customHTML: '<section>Hi</section>', _params: {} };
  const { html } = renderPage({
    components: [block],
    styling: {} as never,
    siteFonts: [],
    paths: { themePath: 't', projectPath: 'p' },
    baseStylesheets: [],
    themeCss: '',
    globalInsert: {
      lang: 'id-ID',
      beforeDoctype: '<?php header("X: 1"); ?>',
      beforeHeadEnd: '<meta name="pixel" content="123">',
      afterBodyStart: '<div id="gtm-noscript"></div>',
      beforeBodyEnd: '<script>window.chat=1</script>',
    },
  });
  assert.ok(html.startsWith('<?php header("X: 1"); ?>\n<!doctype html>'), 'beforeDoctype di paling awal');
  assert.match(html, /<html lang="id-ID">/);
  assert.match(html, /<meta name="pixel" content="123">\s*<\/head>/); // sebelum </head>
  assert.match(html, /<body>\s*<div id="gtm-noscript"><\/div>/); // setelah <body>
  assert.match(html, /<script>window\.chat=1<\/script>\s*<\/body>/); // sebelum </body>
});

test('renderPage: tracking ID → snippet gtag/GTM/Pixel digenerate + noscript GTM di body', () => {
  const block: BlockInstance = { _cid: 'T1', _customHTML: '<section>x</section>', _params: {} };
  const { html } = renderPage({
    components: [block], styling: {} as never, siteFonts: [],
    paths: { themePath: 't', projectPath: 'p' }, baseStylesheets: [], themeCss: '',
    globalInsert: { tracking: { ga4: 'G-ABC123', gtm: 'GTM-XYZ9', metaPixel: '998877' } },
  });
  assert.match(html, /gtag\/js\?id=G-ABC123/);
  assert.match(html, /gtag\('config','G-ABC123'\)/);
  assert.match(html, /gtm\.js\?id='\+i/); // loader GTM
  assert.match(html, /fbq\('init','998877'\)/);
  // noscript GTM tepat setelah <body>
  assert.match(html, /<body>\s*<!-- Google Tag Manager \(noscript\) -->/);
});

test('renderPage: tracking ID berbahaya dibersihkan (tak bisa keluar dari script)', () => {
  const block: BlockInstance = { _cid: 'T2', _customHTML: '<section>x</section>', _params: {} };
  const { html } = renderPage({
    components: [block], styling: {} as never, siteFonts: [],
    paths: { themePath: 't', projectPath: 'p' }, baseStylesheets: [], themeCss: '',
    globalInsert: { tracking: { ga4: "G-1');alert(1)//" } },
  });
  assert.doesNotMatch(html, /alert\(1\)/);
  assert.match(html, /gtag\('config','G-1alert1'\)/); // karakter selain [A-Za-z0-9_-] dibuang
});

test('renderPage: lang invalid/kosong → fallback aman (en)', () => {
  const block: BlockInstance = { _cid: 'G2', _customHTML: '<section>x</section>', _params: {} };
  const mk = (lang: string) =>
    renderPage({
      components: [block], styling: {} as never, siteFonts: [],
      paths: { themePath: 't', projectPath: 'p' }, baseStylesheets: [], themeCss: '',
      globalInsert: { lang },
    }).html;
  assert.match(mk('"><script>bad</script>'), /<html lang="en">/); // injeksi ditolak
  assert.match(mk(''), /<html lang="en">/);
  assert.match(mk('en-US'), /<html lang="en-US">/);
});

test('exportSite: index.html menaut CSS eksternal + berkas CSS gabungan', () => {
  const block = {
    _cid: 'B1',
    _customHTML:
      '<section class="hero"><mbr-parameters></mbr-parameters>' +
      '<h1 class="mbr-section-title" mbr-theme-style="display-2">Halo</h1></section>',
    _styles: { '.hero': { color: '#fff' } },
  };
  const { files, cssPath } = exportSite({
    pages: [
      { slug: 'index', title: 'Situs Uji', components: [block] },
      { slug: 'tentang', title: 'Tentang', components: [{ ...block, _cid: 'B2' }] },
    ],
    styling: SAMPLE_STYLING,
    siteFonts: [],
    paths: { themePath: 'assets/theme', projectPath: '.' },
    baseStylesheets: ['assets/bootstrap/css/bootstrap.min.css'],
    themeCss: '.btn{border-radius:4px}',
  });
  // 2 halaman + 1 CSS gabungan.
  assert.equal(files.length, 3);
  assert.ok(files.some((f) => f.path === 'tentang.html'));
  const index = files.find((f) => f.path === 'index.html')!;
  const css = files.find((f) => f.path === cssPath)!;
  // CSS gabungan memuat blok DARI SEMUA halaman.
  assert.match(css.content, /\.cid-B2/);
  // index.html menaut CSS eksternal, BUKAN <style> inline.
  assert.match(index.content, /<link rel="stylesheet" href="assets\/mobirise\/css\/mbr-additional\.css">/);
  assert.doesNotMatch(index.content, /<style>\s*\.btn/);
  assert.match(index.content, /Halo/);
  // Berkas CSS = tema + CSS blok ter-scope .cid-B1.
  assert.match(css.content, /\.btn\{border-radius:4px\}/);
  assert.match(css.content, /\.cid-B1/);
});

test('branding: buang teks Mobirise, netralkan tautan mobiri.se, buang tautan kredit', () => {
  const block = {
    _cid: 'BR',
    _customHTML:
      '<section>' +
      '<a class="btn" href="https://mobiri.se">Get Started</a>' +
      '<img src="x.jpg" alt="Mobirise Website Builder">' +
      '<p>© Copyright 2030 Mobirise - All Rights Reserved</p>' +
      '<a href="https://mobirise.com">Made with Mobirise</a>' +
      '</section>',
  };
  const { html } = renderBlock(block, { themePath: 't', projectPath: 'p' });
  // Tombol tetap ada, tapi tujuannya dinetralkan.
  assert.match(html, /<a class="btn" href="#">\s*Get Started/);
  // alt bawaan dibersihkan.
  assert.doesNotMatch(html, /alt="Mobirise/);
  // Teks kredit tak lagi menyebut Mobirise.
  assert.doesNotMatch(html, /Mobirise/);
  assert.match(html, /© Copyright 2030/);
  // Tautan kredit dibuang seluruhnya.
  assert.doesNotMatch(html, /mobirise\.com/);
  assert.doesNotMatch(html, /mobiri\.se/);
});

test('parseLess: deklarasi, selektor bersarang, guard when, @media', () => {
  const tree = parseLess(`
    padding-top: (@paddingTop * 1rem);
    & when (@bg-type ="color") { background-color: @bg-value; }
    .card { color: #fff; .inner { margin: 0; } }
    @media (max-width: 992px) { .card { color: #000; } }
  `);
  assert.equal(tree['padding-top'], '(@paddingTop * 1rem)');
  assert.ok(typeof tree["& when (@bg-type =\"color\")"] === 'object');
  const card = tree['.card'] as Record<string, unknown>;
  assert.equal(card['color'], '#fff');
  assert.ok(typeof card['.inner'] === 'object');
  assert.ok(typeof tree['@media (max-width: 992px)'] === 'object');
});

test('instantiateBlock: cid baru, @THEME_PATH@ diganti, _styles dari LESS', () => {
  const block = instantiateBlock({
    name: 'content1',
    sourceTheme: 'mobirise5',
    templateHtml: '<section class="content1"><img src="@THEME_PATH@/x.jpg"></section>',
    styleLess: 'padding-top: (@paddingTop * 1rem);',
    themeAssetPath: '/blocks/mobirise5',
  });
  assert.match(block._cid, /^ew/);
  assert.equal(block._name, 'content1');
  assert.match(block._customHTML, /\/blocks\/mobirise5\/x\.jpg/);
  assert.doesNotMatch(block._customHTML, /@THEME_PATH@/);
  assert.ok(block._styles && 'padding-top' in block._styles);
});
