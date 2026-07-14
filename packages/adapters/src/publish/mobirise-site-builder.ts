// P2: perakit berkas situs untuk revisi 'mobirise-v1'. Cermin dari buildFromTemplateDir
// di editor-web (apps/api/src/publish.ts) — SATU perilaku render untuk dua sistem, supaya
// yang direview PO di editor persis yang terbit di hosting.
//
// Bedanya dari editor-web: TANPA penulisan-ulang URL media — media pelanggan glm2 sudah
// berupa URL absolut ke hosting yang sama (https://<domain>/media/<tenant>/<file>, lihat
// FtpsMediaStore) dan tetap valid setelah situs terbit.
//
// Aset template dibaca dari TEMPLATES_DIR/<templateId>/ (folder yang SAMA dengan yang
// dilayani editor-web; di-gitignore karena lisensi Mobirise).

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { exportSite, siteLogoSrc } from '@digimaestro/engine-mobirise';
import { parseMobiriseProject } from '@digimaestro/sites-kit';
import { err, ok } from '@digimaestro/shared';
import type { DeployableFile, PublishError, Result } from '@digimaestro/shared';

export interface MobiriseSiteBuilderOptions {
  // Root folder template (berisi <templateId>/index.html + assets/ + project.mobirise).
  readonly templatesDir: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

// Semua berkas dalam folder, path relatif ber-'/'. Folder tak ada → [] (bukan error):
// template tanpa assets/ tetap sah.
async function walk(root: string, sub = ''): Promise<string[]> {
  const dir = join(root, sub);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const rel = sub ? posix.join(sub, name) : name;
    const st = await stat(join(root, rel));
    if (st.isDirectory()) out.push(...(await walk(root, rel)));
    else out.push(rel);
  }
  return out;
}

export class MobiriseSiteBuilder {
  constructor(private readonly options: MobiriseSiteBuilderOptions) {}

  async build(siteDocument: unknown): Promise<Result<readonly DeployableFile[], PublishError>> {
    const parsed = parseMobiriseProject(siteDocument);
    if (!parsed.ok) {
      return err({ code: 'BUILD', message: `dokumen mobirise tak valid: ${parsed.message}` });
    }
    const doc = parsed.value;
    const templateDir = join(this.options.templatesDir, doc.templateId);

    let indexHtml: string;
    let additionalCss: string;
    try {
      indexHtml = await readFile(join(templateDir, 'index.html'), 'utf8');
      additionalCss = await readFile(
        join(templateDir, 'assets/mobirise/css/mbr-additional.css'),
        'utf8',
      );
    } catch (e) {
      return err({
        code: 'BUILD',
        message: `template '${doc.templateId}' tak ditemukan/tak lengkap di ${this.options.templatesDir}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    }

    // Kerangka CSS/JS template, diambil dari index.html bawaan — logika identik editor-web.
    // mbr-additional.css dikecualikan: kita generate sendiri dari dokumen (berisi editan).
    const baseStylesheets = [...indexHtml.matchAll(/<link[^>]+href="([^"]+\.css)[^"]*"[^>]*>/g)]
      .map((m) => m[1] as string)
      .filter((h) => !h.startsWith('http') && !h.includes('mbr-additional'))
      .map((h) => h.replace(/^\.\//, ''));
    // Runtime blok (slider/tab/menu/form) — tanpa ini blok interaktif mati di situs terbit.
    const baseScripts = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/g)]
      .map((m) => m[1] as string)
      .filter((h) => !h.startsWith('http'))
      .map((h) => h.replace(/^\.\//, ''));

    // Lapisan tema bawaan template (pixel-perfect, termasuk CSS kustom tema) = header
    // mbr-additional.css sampai aturan blok pertama (.cid-*).
    const cut = additionalCss.indexOf('.cid-');
    const themeCss = cut === -1 ? additionalCss : additionalCss.slice(0, cut);

    // Logo menu → favicon (perilaku sama dengan editor-web).
    const logo = siteLogoSrc((doc.pages[0]?.components ?? []) as never[]);
    const favicon = logo ? logo.replace('@PROJECT_PATH@/', '').replace(/^\.\//, '') : undefined;

    const { files } = exportSite({
      pages: doc.pages as never,
      ...(favicon ? { favicon } : {}),
      styling: doc.styling as never,
      siteFonts: (doc.siteFonts ?? []) as never[],
      paths: { themePath: 'assets/theme', projectPath: '.' },
      baseStylesheets,
      baseScripts,
      themeCss,
      lang: 'id',
    });

    const out: DeployableFile[] = files.map((f) => ({
      path: f.path,
      contents: f.content,
      contentType: contentTypeFor(f.path),
    }));

    // Aset template (gambar, bootstrap, font, JS blok). mbr-additional.css lama dilewati —
    // versi baru sudah dihasilkan exportSite di atas.
    for (const rel of await walk(join(templateDir, 'assets'))) {
      if (rel === 'mobirise/css/mbr-additional.css') continue;
      out.push({
        path: `assets/${rel}`,
        contents: new Uint8Array(await readFile(join(templateDir, 'assets', rel))),
        contentType: contentTypeFor(rel),
      });
    }

    return ok(out);
  }
}
