// T-033: optimasi gambar (FR-MED-002) via sharp. Satu-satunya tempat sharp diimpor.
//
// Kenapa perlu: foto dari ponsel pelanggan sering 3–6 MB & 4000px. Menaruhnya apa adanya
// di situs UMKM merusak Core Web Vitals (NFR-01 menuntut Lighthouse ≥ 90) dan memakan
// kuota hosting. Resize + WebP biasanya memangkas 70–90% ukuran tanpa beda kasat mata.

import sharp from 'sharp';
import { err, ok } from '@digimaestro/shared';
import type {
  DownloadedMedia,
  MediaError,
  MediaProcessorPort,
  OptimizedMedia,
  Result,
} from '@digimaestro/shared';

export interface SharpProcessorOptions {
  // Sisi terpanjang maksimum. 1600px cukup untuk hero/galeri di layar retina sekalipun.
  readonly maxDimension?: number;
  // Kualitas WebP. 80 = titik temu lazim antara ukuran & kualitas visual.
  readonly quality?: number;
}

export const DEFAULT_MAX_DIMENSION = 1600;
export const DEFAULT_WEBP_QUALITY = 80;

export class SharpMediaProcessor implements MediaProcessorPort {
  constructor(private readonly options: SharpProcessorOptions = {}) {}

  async optimize(input: DownloadedMedia): Promise<Result<OptimizedMedia, MediaError>> {
    const maxDim = this.options.maxDimension ?? DEFAULT_MAX_DIMENSION;
    const quality = this.options.quality ?? DEFAULT_WEBP_QUALITY;

    try {
      const pipeline = sharp(Buffer.from(input.bytes), { failOn: 'none' })
        // withoutEnlargement: foto kecil TIDAK diperbesar (memperbesar hanya menambah byte
        // tanpa menambah detail).
        .rotate() // hormati EXIF orientation → foto ponsel tak tampil miring
        .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
        .webp({ quality });

      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

      return ok({
        bytes: new Uint8Array(data),
        contentType: 'image/webp',
        width: info.width,
        height: info.height,
      });
    } catch (e) {
      // Bukan gambar / format tak dikenal / file rusak → jangan crash worker.
      const message = e instanceof Error ? e.message : String(e);
      return err({ code: 'PROCESS', message: `gagal mengoptimasi gambar: ${message}` });
    }
  }
}
