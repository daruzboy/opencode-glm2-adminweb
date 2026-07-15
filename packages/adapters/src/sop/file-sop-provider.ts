// SOP layanan dari FILE di host (permintaan PO 2026-07-15): PO menyunting satu berkas
// markdown → bot langsung mengikutinya di pesan berikutnya, TANPA rebuild/restart.
//
// Cache ber-mtime: tiap panggilan hanya stat(); isi dibaca ulang HANYA saat file berubah.
// File hilang/tak terbaca → null (bot jalan dengan persona bawaan) — dicatat sekali per
// perubahan keadaan supaya log tak banjir.

import { stat, readFile } from 'node:fs/promises';

export interface FileSopProviderOptions {
  readonly path: string;
  readonly logger?: { warn(msg: string): void };
  // Batas ukuran (token = biaya). SOP > batas dipotong dengan penanda.
  readonly maxChars?: number;
}

const DEFAULT_MAX_CHARS = 8_000;

export function createFileSopProvider(options: FileSopProviderOptions): () => Promise<string | null> {
  let cachedMtimeMs = -1;
  let cachedText: string | null = null;
  let warnedMissing = false;

  return async () => {
    try {
      const s = await stat(options.path);
      if (s.mtimeMs !== cachedMtimeMs) {
        const raw = await readFile(options.path, 'utf8');
        const max = options.maxChars ?? DEFAULT_MAX_CHARS;
        cachedText =
          raw.length <= max ? raw : `${raw.slice(0, max)}\n\n[SOP terpotong di ${max} karakter]`;
        cachedMtimeMs = s.mtimeMs;
        warnedMissing = false;
      }
      return cachedText;
    } catch (e) {
      if (!warnedMissing) {
        const msg = e instanceof Error ? e.message : String(e);
        options.logger?.warn(`[sop] tidak terbaca (${options.path}): ${msg} — bot memakai persona bawaan`);
        warnedMissing = true;
      }
      // Jangan sajikan SOP basi bila file DIHAPUS — kembali ke persona bawaan.
      cachedMtimeMs = -1;
      cachedText = null;
      return null;
    }
  };
}
