// P3: CLI indeks template — `pnpm templates:index` (root). Dipakai PO di VPS setelah
// menaruh folder template; padanan HTTP-nya POST /api/admin/templates/reindex.

import { PrismaClient } from '@prisma/client';
import { indexTemplates, type TemplateDelegate } from './template-indexer.js';

export async function runIndexTemplatesCli(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const templatesDir = env.TEMPLATES_DIR;
  if (!templatesDir) {
    console.error('TEMPLATES_DIR wajib diset (root folder template Mobirise).');
    return 1;
  }
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL wajib diset (registry Template di Postgres).');
    return 1;
  }

  // Klien polos tanpa tenant-guard: Template bukan model ber-tenant (katalog platform).
  const prisma = new PrismaClient();
  try {
    const report = await indexTemplates({
      templatesDir,
      delegate: prisma.template as unknown as TemplateDelegate,
    });
    console.log(`terindeks : ${report.indexed.length} → ${report.indexed.join(', ') || '(kosong)'}`);
    console.log(`nonaktif  : ${report.deactivated} (folder hilang)`);
    for (const e of report.errors) console.error(`RUSAK     : ${e}`);

    // Semua gagal & tak satu pun terindeks = konfigurasi salah, bukan "sebagian rusak".
    return report.indexed.length === 0 && report.errors.length > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = process.argv[1]?.endsWith('index-templates-cli.js');
if (isMain) {
  runIndexTemplatesCli().then((code) => process.exit(code));
}
