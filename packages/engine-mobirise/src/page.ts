// Rakit satu halaman lengkap (semua blok) → dokumen HTML mandiri untuk preview/ekspor.
// Menggabungkan: aset dasar (bootstrap/tema), font tema, CSS palet+tipografi (compileTheme),
// CSS per-blok (.cid-*), lalu body semua blok.

import { renderBlock, type BlockInstance, type PathResolver } from './render.js';
import { compileTheme, themeFontLinks, type SiteFont, type ThemeStyling } from './theme.js';

export interface PageRenderInput {
  readonly components: readonly BlockInstance[];
  readonly styling: ThemeStyling;
  readonly siteFonts: readonly SiteFont[];
  readonly paths: PathResolver;
  /** <link rel=stylesheet> aset dasar (bootstrap, ikon, tema style.css). */
  readonly baseStylesheets: readonly string[];
  /**
   * <script src> runtime blok (bootstrap bundle, dropdown menu, slider embla, mbr-tabs,
   * switch-arrow, smoothscroll, form, script tema). WAJIB: tanpa ini blok interaktif
   * (slider/tab/akordeon/menu mobile/form) TIDAK berfungsi di situs hasil.
   */
  readonly baseScripts?: readonly string[];
  /**
   * CSS lapisan tema siap-pakai (palet+tipografi+CSS kustom tema). Bila template
   * dimuat apa adanya, ini = header mbr-additional.css bawaan tema (pixel-perfect,
   * termasuk CSS kustom tema yang tak diturunkan dari param). Bila TIDAK diberikan,
   * di-generate deterministik dari `styling` via compileTheme (jalur regenerasi saat
   * user mengubah warna/font). CSS kustom tema (mis. tombol pill) TIDAK ikut di jalur
   * generate — itu aset per-tema yang dipertahankan terpisah.
   */
  readonly themeCss?: string;
  /**
   * Bila diisi, lapisan tema + CSS blok TIDAK di-inline sebagai <style>, melainkan
   * ditautkan sebagai <link href="cssHref">. Dipakai saat ekspor (CSS jadi file
   * terpisah `mbr-additional.css`). blockCss/themeCss tetap dikembalikan untuk ditulis.
   */
  readonly cssHref?: string;
  /**
   * URL favicon situs (biasanya logo di menu bar). Template Mobirise memasangnya lewat
   * <link rel="shortcut icon">; renderPage kita dulu tidak memancarkannya sama sekali,
   * sehingga situs hasil tak punya favicon.
   */
  readonly favicon?: string;
  /**
   * <base href> dokumen. Dibutuhkan untuk situs IMPOR: HTML-nya memakai path relatif
   * (mis. images/x.png) yang, di dalam iframe srcdoc / halaman blob, akan diresolusi ke
   * origin editor — bukan ke folder impor. Untuk template Mobirise ini tidak dipakai
   * (path sudah diresolusi lewat @PROJECT_PATH@).
   */
  readonly baseHref?: string;
  /**
   * CSS yang dimuat PALING AWAL (sebelum <link> aset). Dipakai situs IMPOR: baseline
   * Mobirise (agar blok yang ditambahkan tampil benar) harus kalah prioritas dari CSS
   * situs itu sendiri — kalau ditaruh belakangan, tampilan situs user malah berubah.
   */
  readonly preCss?: string;
  readonly lang?: string;
  readonly title?: string;
  /**
   * Kode sisipan GLOBAL user (analytics, pixel, meta tag, widget, chatbot, PHP, dsb.)
   * yang ditempatkan pada posisi tertentu di SETIAP halaman hasil (preview/build/ekspor).
   * Sengaja mentah (tidak di-escape) — ini fitur "custom code" milik pemilik situs
   * untuk situsnya sendiri, seperti Mobirise/WordPress. Hanya `lang` yang divalidasi.
   */
  readonly globalInsert?: GlobalInsert;
}

export interface GlobalInsert {
  /** Nilai atribut <html lang="…">. Divalidasi; kosong/invalid → 'en'. */
  readonly lang?: string;
  /** Disisipkan tepat sebelum </head> pada tiap halaman. */
  readonly beforeHeadEnd?: string;
  /** Disisipkan tepat setelah <body> pada tiap halaman. */
  readonly afterBodyStart?: string;
  /** Disisipkan tepat sebelum </body> pada tiap halaman. */
  readonly beforeBodyEnd?: string;
  /** Disisipkan di paling awal dokumen, sebelum <!doctype html> (mis. PHP server-side). */
  readonly beforeDoctype?: string;
  /** ID tracking siap-pakai → snippet standar digenerate otomatis di tiap halaman. */
  readonly tracking?: TrackingConfig;
}

export interface TrackingConfig {
  /** Google Analytics 4 Measurement ID, mis. G-XXXXXXX. */
  readonly ga4?: string;
  /** Google Tag Manager ID, mis. GTM-XXXXXX. */
  readonly gtm?: string;
  /** Meta (Facebook) Pixel ID (numerik). */
  readonly metaPixel?: string;
  /** Google Ads Conversion ID, mis. AW-XXXXXXXXX. */
  readonly googleAds?: string;
}

// ID tracking hanya boleh huruf/angka/_/- (masuk ke dalam <script>). Karakter lain dibuang
// agar tak bisa keluar dari string/tag. Kosong → '' (snippet tak digenerate).
function safeId(v: string | undefined): string {
  return (v ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

/** Snippet tracking untuk <head>. */
export function trackingHead(t: TrackingConfig | undefined): string {
  if (!t) return '';
  const ga4 = safeId(t.ga4);
  const ads = safeId(t.googleAds);
  const gtm = safeId(t.gtm);
  const px = safeId(t.metaPixel);
  const out: string[] = [];
  const gtagIds = [ga4, ads].filter(Boolean);
  if (gtagIds.length) {
    out.push(
      `<!-- Google tag (gtag.js) -->\n` +
        `<script async src="https://www.googletagmanager.com/gtag/js?id=${gtagIds[0]}"></script>\n` +
        `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
        `gtag('js',new Date());${gtagIds.map((id) => `gtag('config','${id}');`).join('')}</script>`,
    );
  }
  if (gtm) {
    out.push(
      `<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];` +
        `w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],` +
        `j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;` +
        `j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);` +
        `})(window,document,'script','dataLayer','${gtm}');</script>`,
    );
  }
  if (px) {
    out.push(
      `<!-- Meta Pixel -->\n<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){` +
        `n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
        `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
        `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',` +
        `'https://connect.facebook.net/en_US/fbevents.js');fbq('init','${px}');fbq('track','PageView');</script>\n` +
        `<noscript><img height="1" width="1" style="display:none" ` +
        `src="https://www.facebook.com/tr?id=${px}&ev=PageView&noscript=1"/></noscript>`,
    );
  }
  return out.join('\n');
}

/** Snippet tracking untuk tepat setelah <body> (GTM noscript). */
export function trackingBodyStart(t: TrackingConfig | undefined): string {
  const gtm = safeId(t?.gtm);
  if (!gtm) return '';
  return (
    `<!-- Google Tag Manager (noscript) -->\n` +
    `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtm}" ` +
    `height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`
  );
}

// Kode bahasa BCP-47 sederhana (mis. en, id, en-US, id-ID). Karena masuk ke atribut
// HTML, harus bebas karakter yang bisa keluar dari atribut. Invalid/kosong → null.
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export function sanitizeLang(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return LANG_RE.test(t) ? t : null;
}

export interface PageRenderResult {
  readonly html: string;
  readonly blockCss: string;
  readonly themeCss: string;
}

export function renderPage(input: PageRenderInput): PageRenderResult {
  const bodies: string[] = [];
  const blockCssParts: string[] = [];
  for (const c of input.components) {
    const r = renderBlock(c, input.paths);
    bodies.push(r.html);
    if (r.css) blockCssParts.push(r.css);
  }

  const themeCss = input.themeCss ?? compileTheme(input.styling);
  const blockCss = blockCssParts.join('\n');
  const baseLinks = input.baseStylesheets.map((h) => `<link rel="stylesheet" href="${h}">`).join('\n');
  const fontLinks = themeFontLinks(input.siteFonts);
  // Inline <style> (preview) atau <link> ke file CSS eksternal (ekspor).
  const generatedCss = input.cssHref
    ? `<link rel="stylesheet" href="${input.cssHref}">`
    : `<style>\n${themeCss}\n${blockCss}\n</style>`;
  const scripts = (input.baseScripts ?? [])
    .map((src) => `<script src="${src}"></script>`)
    .join('\n');
  const baseTag = input.baseHref ? `<base href="${input.baseHref}">` : '';
  const preCssTag = input.preCss ? `<style>\n${input.preCss}\n</style>` : '';
  const faviconLink = input.favicon
    ? `<link rel="icon" href="${input.favicon}">\n<link rel="shortcut icon" href="${input.favicon}">`
    : '';

  // Sisipan global user (per posisi). Ditempatkan mentah pada tiap halaman hasil.
  const gi = input.globalInsert;
  const lang = sanitizeLang(gi?.lang) ?? sanitizeLang(input.lang) ?? 'en';
  const preDoctype = gi?.beforeDoctype?.trim() ? `${gi.beforeDoctype}\n` : '';
  // Tracking (snippet standar) DULU, lalu kode manual user.
  const headParts = [trackingHead(gi?.tracking), gi?.beforeHeadEnd?.trim() ? gi!.beforeHeadEnd! : '']
    .filter(Boolean)
    .join('\n');
  const headExtra = headParts ? `${headParts}\n` : '';
  const bodyStartParts = [
    trackingBodyStart(gi?.tracking),
    gi?.afterBodyStart?.trim() ? gi!.afterBodyStart! : '',
  ]
    .filter(Boolean)
    .join('\n');
  const bodyStart = bodyStartParts ? `${bodyStartParts}\n` : '';
  const bodyEnd = gi?.beforeBodyEnd?.trim() ? `\n${gi.beforeBodyEnd}` : '';

  const html = `${preDoctype}<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${baseTag}
<title>${input.title ?? ''}</title>
${faviconLink}
${preCssTag}
${baseLinks}
${fontLinks}
${generatedCss}
${headExtra}</head>
<body>
${bodyStart}${bodies.join('\n')}
${scripts}${bodyEnd}
</body>
</html>`;

  return { html, blockCss, themeCss };
}
